/**
 * Tap in: the reads behind the panel and the routes its actions call.
 *
 * One row is read at a time. The row the panel opens on is read at once; a
 * row the selection moves to is read once it rests (TAP_IN.SETTLE), so ↑/↓
 * through the board reads nothing on the way. On each board pass the light
 * reads run again (the live probe, the tail; for a working row, the files it
 * touched); a session's record is read once per visit and again on a
 * pass only once it is old (TAP_IN.LOOKUP_STALE). It is read small (the
 * summary view: header, title, last turns); an older server sends the full
 * record, and only what the panel shows of it is kept: its events (megabytes
 * for a long session) are dropped once its turns are read. The Tail is also live (the shared tail push,
 * filtered to the row's session, landing together every TAP_IN.PUSH). Each
 * row's last read is kept, so going back to a row shows it at once.
 *
 * Native reply to a live session goes only through the steer route: it
 * types into the live process in place, and never falls back to anything
 * else. Only a session on this host that the steer check found nothing
 * holding (not_live) is replied to through POST /api/sessions/reply, which
 * can resume it; the reply line says so (nativeReply, replyToEndedSession).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api, refreshSessionAuth } from "../../../lib/api.ts";
import type { OutgoingAttachment } from "../../../lib/media-blobs.ts";
import { uploadReplyFiles } from "../../../lib/reply-files.ts";
import {
  companionHostAvailable,
  companionKeepClear,
  noteCompanionPopOutClosed,
  noteCompanionPopOutOpening,
  onCompanionPopOutDone,
  openFromCompanion,
  openSessionInScout,
  pointCompanionAt,
} from "../../../lib/companion-host.ts";
import { routePath } from "../../../lib/router.ts";
import { useTailEvents } from "../../../lib/tail-events.ts";
import type { MeshStatus, Message, TailEvent, WorkDetail } from "../../../lib/types.ts";
import type { SessionAnswerPromptResult, SessionFocusResult, SessionOpenPlaceResult, SessionPromptDecision, SessionSteerAuditEntry, SessionSteerAvailability } from "../../../../shared/api/session-steer.ts";
import { mergeTurnStepEvents } from "../../chat/turn-steps.ts";
import { sessionDeliveryAvailability, sessionSteerPath, type SessionDeliveryTarget } from "../../sessions/session-delivery.ts";
import type { SessionRefLookup, SessionRefObservePayload } from "../../sessions/SessionRefScreen.tsx";
import type { EngageFile } from "./engage-model.ts";
import {
  FOCUS_LINE,
  SCOUT_WEB_ORIGIN,
  focusedApp,
  type FocusedApp,
  TAP_IN,
  TAP_IN_SIZE,
  tailFacts,
  tailSessionOf,
  turnsFromObserve,
  turnsFromSummary,
  type SessionTouched,
  type TapInNativeTarget,
  type TapInPane,
  type TapInPlaceKind,
  type TapInTarget,
  type TapInTerminal,
  type TapInTurnsRead,
  type TapInWorkTarget,
} from "./tap-in-model.ts";
import type { PaneTarget } from "../../../components/pane-terminal-model.ts";
import { canShowQuickTerminal, showQuickTerminal } from "./quick-terminal.ts";

/** Everything the panel reads for one row. Reads that fail keep their last value. */
export type TapInData = {
  key: string;
  /** Native: GET /api/session-ref/:ref?view=summary, without its observed events (see observeTurns). */
  lookup: SessionRefLookup | null;
  /** The turns read off that record before its events were dropped. */
  observeTurns: TapInTurnsRead | null;
  /** Date.now() when the record was last read. */
  lookupAt: number;
  /** Native: GET /api/session-ref/:ref/touched. */
  touched: SessionTouched | null;
  /** Native: GET /api/session-ref/:ref/steer?machine=. */
  steer: SessionSteerAvailability | null;
  /** Work: GET /api/work/:id. */
  detail: WorkDetail | null;
  /** Work or request: GET /api/messages?conversationId=. */
  messages: Message[];
  /** The session's tail, oldest first: GET /api/tail/recent?sessionId=, then the live push. */
  tail: TailEvent[];
  prUrl: string | null;
  aiTitle: string | null;
  /** Date.now() when the newest tool step arrived live: the Tail rolls while it is young. */
  rollAt: number;
  localNodeId: string | null;
  /** The first read is still in flight. */
  loading: boolean;
  /** What the last read could not get, by name ("session", "touched", "steer", "tail", "work", "thread"). */
  failed: string[];
};

export function emptyTapInData(key: string, loading = true): TapInData {
  return {
    key, lookup: null, observeTurns: null, lookupAt: -Infinity, touched: null, steer: null, detail: null, messages: [], tail: [],
    prUrl: null, aiTitle: null, rollAt: -Infinity, localNodeId: null, loading, failed: [],
  };
}

// ── the per-row memory ───────────────────────────────────────────────────

/** Rows kept. Each holds no session events, a tail capped at TURN_STEP_LIMIT and a thread capped at THREAD_READ. */
const CACHE_MAX = 16;
const cache = new Map<string, TapInData>();

function remember(data: TapInData): TapInData {
  cache.delete(data.key);
  cache.set(data.key, data);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return data;
}

/** Test seam: forget every row. */
export function clearTapInCache(): void {
  cache.clear();
}

let meshNode: Promise<string | null> | null = null;

/** This Mac's node id, read once (GET /api/mesh): a native session's steer probe names its machine. */
export function readLocalNodeId(): Promise<string | null> {
  meshNode ??= api<MeshStatus>("/api/mesh")
    .then((mesh) => mesh.localNode?.id ?? mesh.health.nodeId ?? null)
    .catch(() => {
      meshNode = null;
      return null;
    });
  return meshNode;
}

/**
 * A session's record as the panel keeps it: its turns read, its events
 * dropped. Model, usage, subagents, files and the identity a reply needs stay.
 */
export function slimLookup(lookup: SessionRefLookup): { lookup: SessionRefLookup; turns: TapInTurnsRead | null } {
  if (lookup.kind !== "observe") return { lookup, turns: null };
  const data = lookup.observe.data;
  // The summary read carries its turns; an older server ignores view=summary and sends the events.
  const turns = data?.summary ? turnsFromSummary(data.summary) : data?.events?.length ? turnsFromObserve(data) : null;
  const observe = { ...lookup.observe, data: { ...data, events: [] } } as SessionRefObservePayload;
  return { lookup: { ...lookup, observe }, turns };
}

// ── the reads ────────────────────────────────────────────────────────────

type Part = Partial<Omit<TapInData, "key" | "loading" | "rollAt">> & { failed: string[] };

function tailPath(sessionId: string): string {
  const params = new URLSearchParams({ sessionId, limit: String(TAP_IN_SIZE.TAIL_READ), fresh: "1" });
  return `/api/tail/recent?${params.toString()}`;
}

/**
 * A session's record, the small way: header, title and the last few turns,
 * no events or files (a few KB, where the full record runs to megabytes).
 */
export function sessionReadPath(encodedRef: string): string {
  return `/api/session-ref/${encodedRef}?view=summary&turns=${TAP_IN_SIZE.TURNS}`;
}

/** What one native read asks for: the probe and the tail always; the record and the files when due. */
type NativeWant = { lookup: boolean; touched: boolean };

function messagesPath(conversationId: string): string {
  return `/api/messages?conversationId=${encodeURIComponent(conversationId)}&limit=${TAP_IN_SIZE.THREAD_READ}`;
}

async function readNative(target: TapInNativeTarget, localNodeId: string | null, want: NativeWant, signal: AbortSignal): Promise<Part> {
  const ref = encodeURIComponent(target.sessionRef);
  const machineId = target.machineId ?? localNodeId;
  const [lookup, touched, steer, tail, messages] = await Promise.allSettled([
    want.lookup ? api<SessionRefLookup>(sessionReadPath(ref), { signal }) : Promise.resolve(null),
    want.touched ? api<SessionTouched>(`/api/session-ref/${ref}/touched`, { signal }) : Promise.resolve(null),
    machineId
      ? api<SessionSteerAvailability>(sessionSteerPath({ sessionId: target.sessionId, sessionRef: target.sessionRef, machineId }), { signal })
      : Promise.reject(new Error("The session's machine is not known.")),
    api<{ events?: TailEvent[] }>(tailPath(target.sessionId), { signal }),
    // A session Scout started in a conversation: its thread, shown read-only (Scout's notices about it land there).
    target.conversationId ? api<Message[]>(messagesPath(target.conversationId), { signal }) : Promise.resolve(null),
  ]);
  const part: Part = { failed: [] };
  if (want.lookup) {
    if (lookup.status === "fulfilled" && lookup.value) {
      const slim = slimLookup(lookup.value);
      part.lookup = slim.lookup;
      part.observeTurns = slim.turns;
      part.lookupAt = Date.now();
    } else part.failed.push("session");
  }
  if (want.touched) {
    if (touched.status === "fulfilled" && touched.value) part.touched = touched.value;
    else part.failed.push("touched");
  }
  if (steer.status === "fulfilled") part.steer = steer.value;
  else part.failed.push("steer");
  if (tail.status === "fulfilled") part.tail = tail.value.events ?? [];
  else part.failed.push("tail");
  if (target.conversationId) {
    if (messages.status === "fulfilled") part.messages = Array.isArray(messages.value) ? messages.value : [];
    else part.failed.push("thread");
  }
  return part;
}

async function readWork(target: TapInWorkTarget, signal: AbortSignal): Promise<Part> {
  const conversationId = target.conversationId ?? target.request?.conversationId ?? null;
  const [detail, messages] = await Promise.allSettled([
    target.workId ? api<WorkDetail>(`/api/work/${encodeURIComponent(target.workId)}`, { signal }) : Promise.resolve(null),
    conversationId ? api<Message[]>(messagesPath(conversationId), { signal }) : Promise.resolve([] as Message[]),
  ]);
  const part: Part = { failed: [] };
  if (detail.status === "fulfilled") part.detail = detail.value;
  else part.failed.push("work");
  if (messages.status === "fulfilled") part.messages = Array.isArray(messages.value) ? messages.value : [];
  else part.failed.push("thread");
  const sessionId = tailSessionOf(target, part.detail ?? null);
  if (sessionId) {
    try {
      part.tail = (await api<{ events?: TailEvent[] }>(tailPath(sessionId), { signal })).events ?? [];
    } catch {
      part.failed.push("tail");
    }
  }
  return part;
}

function merge(base: TapInData, part: Part, localNodeId: string | null): TapInData {
  const { failed, tail, ...rest } = part;
  const next: TapInData = { ...base, ...rest, localNodeId, loading: false, failed };
  if (tail) {
    next.tail = mergeTurnStepEvents(base.tail, tail);
    Object.assign(next, tailFacts(tail, base));
  }
  return next;
}

/** A string that changes when what a target reads changes. */
function readSig(target: TapInTarget | null): string {
  if (!target) return "";
  return target.kind === "native"
    ? `native|${target.key}|${target.sessionRef}|${target.machineId ?? ""}|${target.conversationId ?? ""}`
    : `work|${target.key}|${target.workId ?? ""}|${target.conversationId ?? ""}|${target.request?.id ?? ""}`;
}

export type TapInReadOptions = {
  /** The board's pass counter: the light reads run again when it changes (without one, every TAP_IN.REFRESH). */
  pass?: number;
  /** Demo rows: nothing is read. */
  demo?: boolean;
  /** A layer on its way out: nothing more is read. */
  frozen?: boolean;
  /** The row the panel opened on: read at once, not after the selection rests. */
  immediate?: boolean;
  /** The row is working or asking: its files and its record can still change, so a pass re-reads them. */
  active?: boolean;
};

/** The panel's data for one target. */
export function useTapInData(target: TapInTarget | null, opts: TapInReadOptions = {}): { data: TapInData | null; reload: () => void } {
  const { pass, demo = false, frozen = false, immediate = false, active = true } = opts;
  const key = target?.key ?? null;
  const [state, setState] = useState<TapInData | null>(() => (key ? cache.get(key) ?? emptyTapInData(key, !demo) : null));
  const [tick, setTick] = useState(0);
  const data = !key ? null : state?.key === key ? state : cache.get(key) ?? emptyTapInData(key, !demo);
  const sig = readSig(target);
  const quiet = demo || frozen || !target;
  /** Reads this hook has started: the first is this visit's, and reads the record. */
  const reads = useRef(0);

  const update = useCallback((k: string, fn: (base: TapInData) => TapInData) => {
    setState((prev) => remember(fn(prev?.key === k ? prev : cache.get(k) ?? emptyTapInData(k))));
  }, []);

  // The first read waits for the selection to rest (unless the panel opened here); a pass or a reload reads at once.
  useEffect(() => {
    if (quiet || !target) return;
    const ctrl = new AbortController();
    const first = reads.current === 0;
    const timer = window.setTimeout(() => {
      reads.current += 1;
      void (async () => {
        const localNodeId = await readLocalNodeId();
        if (ctrl.signal.aborted) return;
        let part: Part;
        if (target.kind === "native") {
          const known = cache.get(target.key);
          const stale = !known?.lookup || Date.now() - known.lookupAt >= TAP_IN.LOOKUP_STALE;
          part = await readNative(target, localNodeId, { lookup: first || (active && stale), touched: first || active }, ctrl.signal);
        } else {
          part = await readWork(target, ctrl.signal);
        }
        if (ctrl.signal.aborted) return;
        update(target.key, (base) => merge(base, part, localNodeId));
      })().catch(() => {});
    }, first && !immediate ? TAP_IN.SETTLE : 0);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
    // `target` is read through `sig`; a new object for the same row reads nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, pass, tick, quiet, update]);

  // No pass from the board: keep the board's rhythm on our own.
  useEffect(() => {
    if (quiet || pass !== undefined) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), TAP_IN.REFRESH);
    return () => window.clearInterval(timer);
  }, [quiet, pass]);

  // The live Tail: only the row you are looking at, landing together every TAP_IN.PUSH.
  const sessionId = target ? tailSessionOf(target, data?.detail ?? null) : null;
  const pushed = useRef<TailEvent[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flushTimer.current), []);
  useTailEvents(
    (event) => {
      if (!key || !sessionId || event.sessionId !== sessionId) return;
      pushed.current.push(event);
      if (flushTimer.current !== undefined) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = undefined;
        const events = pushed.current;
        pushed.current = [];
        if (!events.length) return;
        update(key, (base) => ({
          ...base,
          tail: mergeTurnStepEvents(base.tail, events),
          ...tailFacts(events, base),
          rollAt: events.some((e) => e.kind === "tool") ? Date.now() : base.rollAt,
        }));
      }, TAP_IN.PUSH);
    },
    Boolean(sessionId) && !quiet,
  );

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, reload };
}

// ── the routes the actions call ──────────────────────────────────────────

/**
 * How a reply into a live session settled, read off the steer route's own
 * receipt. Refused: nothing was typed (the text can be sent again).
 * Unconfirmed: input may have been typed (check the session before sending
 * it again); a 5xx or a lost connection is unconfirmed too.
 */
export type TapInSteerResult =
  | { state: "delivered" }
  | { state: "refused"; reason: string }
  | { state: "unconfirmed"; reason: string };

const UNCONFIRMED_LINE = "Check the live session before trying again.";

/**
 * Reply into a native session in place: one POST to the steer route
 * (/api/session-ref/:ref/steer), never a resume. Read directly, not through
 * api(), because a refusal and an unconfirmed dispatch both answer 409 and
 * only the receipt's audit tells them apart.
 */
export async function sendNativeReply(target: SessionDeliveryTarget, text: string): Promise<TapInSteerResult> {
  if (target.blockedReason || !target.sessionRef || !target.machineId || !target.sessionId) {
    return { state: "refused", reason: sessionDeliveryAvailability(target).reason };
  }
  const path = sessionSteerPath(target);
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { state: "unconfirmed", reason: UNCONFIRMED_LINE };
  }
  const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; audit?: SessionSteerAuditEntry } | null;
  if (res.ok && body?.ok) return { state: "delivered" };
  const reason = body?.audit?.reason || body?.error || `HTTP ${res.status}`;
  if (body?.audit?.outcome === "unconfirmed" || res.ok || res.status >= 500) return { state: "unconfirmed", reason };
  return { state: "refused", reason };
}

/** Reply into a work's (or a request's) thread: POST /api/send, as the board's row detail does, with any files as attachments. */
export function sendWorkReply(conversationId: string, text: string, attachments: readonly OutgoingAttachment[] = []): Promise<unknown> {
  return api("/api/send", {
    method: "POST",
    body: JSON.stringify({ body: text, chatId: conversationId, ...(attachments.length ? { attachments } : {}) }),
  });
}

/** Files dropped on a figure: each uploaded to this host's blob store at once (uploadReplyFiles). */
export function attachFiles(files: readonly File[]): Promise<EngageFile[]> {
  return uploadReplyFiles(files);
}

export async function focusTerminal(to: { sessionRef: string; machine: string }): Promise<{ ok: true; app: FocusedApp | null } | { ok: false; reason: string }> {
  const path = `/api/session-ref/${encodeURIComponent(to.sessionRef)}/focus`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machine: to.machine }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { ok: false, reason: "Could not reach Scout." };
  }
  const body = await res.json().catch(() => null) as SessionFocusResult | null;
  if (res.ok && body?.ok) return { ok: true, app: focusedApp(body) };
  return { ok: false, reason: (body?.code && FOCUS_LINE[body.code]) || body?.reason || `HTTP ${res.status}` };
}

async function openSessionPlace(to: { sessionRef: string; machine: string }, action: "open-terminal" | "open-thread"): Promise<SessionPlaceResult> {
  const path = `/api/session-ref/${encodeURIComponent(to.sessionRef)}/${action}`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machine: to.machine }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { ok: false, reason: "Could not reach Scout." };
  }
  const body = await res.json().catch(() => null) as SessionOpenPlaceResult | null;
  if (res.ok && body?.ok) return { ok: true, app: body.app ?? null, ...(body.popOut ? { popOut: body.popOut } : {}), ...(body.terminal ? { terminal: body.terminal } : {}) };
  return { ok: false, reason: body?.reason || `HTTP ${res.status}` };
}

/** Pop-outs this page opened, by token, and the session each was opened for. */
const popOuts = new Map<string, { sessionRef: string; machine: string }>();
const MAX_POP_OUTS = 32;

/**
 * A session no window shows (a Claude background job, or a tmux nobody is
 * attached to): POST /api/session-ref/:ref/open-terminal opens a terminal app
 * on its attach command. Only the ref and machine go up; the server reads the
 * command off the verified binding.
 *
 * That window is a pop-out. In the companion, Scout moves it beside the
 * board, points at it, and gives it a Done tab, which closes it again
 * (`closeSessionPopOut`).
 */
export async function openSessionTerminal(to: { sessionRef: string; machine: string }): Promise<SessionPlaceResult> {
  noteCompanionPopOutOpening();
  const result = await openSessionPlace(to, "open-terminal");
  if (result.ok && result.popOut) adoptSessionPopOut(result.popOut, to, result.terminal);
  return result;
}

/**
 * A pop-out the server just opened for this page (openSessionTerminal, or a
 * permission's Session reveal): remember it so Done can close it, and have the
 * host move its window beside the board and point at it. Call
 * noteCompanionPopOutOpening before the open.
 */
export function adoptSessionPopOut(
  token: string,
  to: { sessionRef: string; machine: string },
  terminal?: { app: string; bundleId: string; appPid: number },
): void {
  popOuts.set(token, { sessionRef: to.sessionRef, machine: to.machine });
  while (popOuts.size > MAX_POP_OUTS) popOuts.delete(popOuts.keys().next().value!);
  if (terminal) pointCompanionAt({ pid: terminal.appPid, bundleId: terminal.bundleId }, { token, clear: companionKeepClear() });
}

/**
 * Done on a pop-out: POST /api/session-ref/:ref/close-terminal hangs up its
 * attach and closes its window. The session keeps running. False for a
 * pop-out this page did not open, or one the server could not close.
 */
export async function closeSessionPopOut(token: string): Promise<boolean> {
  const to = popOuts.get(token);
  if (!to) return false;
  const path = `/api/session-ref/${encodeURIComponent(to.sessionRef)}/close-terminal`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machine: to.machine, popOut: token }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return false;
  }
  const body = await res.json().catch(() => null) as SessionOpenPlaceResult | null;
  // Closed, or already gone: either way nothing runs in it, so the host
  // closes the window if its terminal app left it open.
  if (body?.ok || body?.code === "gone") {
    popOuts.delete(token);
    noteCompanionPopOutClosed(token);
  }
  return Boolean(res.ok && body?.ok);
}

// The companion's message handler is in place before its page loads.
if (typeof window !== "undefined" && companionHostAvailable()) onCompanionPopOutDone((token) => { void closeSessionPopOut(token); });

type SessionPaneBody = { ok: true; pane: PaneTarget; popOut?: string } | { ok: false; code?: string; reason?: string };

/** Who and what the quick terminal's header names. */
export type QuickTerminalContext = { who: string | null; title: string; at: number | null };

/**
 * A background session in the companion's own pop-up: POST
 * /api/session-ref/:ref/open-pane starts its attach in a tmux session of
 * Scout's own, and the quick terminal shows it. When the pop-up goes, the
 * attach is hung up (closeSessionPopOut); the session keeps running. Only the
 * ref and machine go up; the server reads the job off the verified binding.
 */
export async function openSessionPane(to: { sessionRef: string; machine: string }, context: QuickTerminalContext): Promise<SessionPlaceResult> {
  const path = `/api/session-ref/${encodeURIComponent(to.sessionRef)}/open-pane`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machine: to.machine }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { ok: false, reason: "Could not reach Scout." };
  }
  const body = await res.json().catch(() => null) as SessionPaneBody | null;
  if (!res.ok || !body?.ok || body.pane?.backend !== "tmux" || !body.pane.sessionName || !body.popOut) {
    return { ok: false, reason: (body && !body.ok && body.reason) || `HTTP ${res.status}` };
  }
  const token = body.popOut;
  popOuts.set(token, { sessionRef: to.sessionRef, machine: to.machine });
  while (popOuts.size > MAX_POP_OUTS) popOuts.delete(popOuts.keys().next().value!);
  showQuickTerminal({ key: to.sessionRef, kind: "Background session", pane: body.pane, ...context, release: () => { void closeSessionPopOut(token); } });
  return { ok: true, app: null };
}

/**
 * A background session's permission prompt, answered from the card: POST
 * /api/session-ref/:ref/answer-prompt. Only the ref, host, the call the card
 * showed and Yes or No go up; the server finds the job and sends the key only
 * while the session's screen shows that same call.
 */
export async function answerSessionPrompt(to: { sessionRef: string; machine: string; toolUseId: string }, decision: SessionPromptDecision): Promise<SessionAnswerPromptResult> {
  const path = `/api/session-ref/${encodeURIComponent(to.sessionRef)}/answer-prompt`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machine: to.machine, toolUseId: to.toolUseId, decision }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { ok: false, code: "unreachable", reason: "Could not reach Scout. Nothing was sent.", sent: false };
  }
  const body = await res.json().catch(() => null) as SessionAnswerPromptResult | null;
  if (!body || typeof body.ok !== "boolean") return { ok: false, code: "bad_response", reason: `HTTP ${res.status}. Check the session before answering again.`, sent: true };
  return body;
}

/**
 * The quick terminal for any session: POST /api/session-ref/:ref/pane proves
 * the tmux session its live process sits in (nothing is opened or focused
 * there), and the companion's pop-up joins it watching. No terminal app, no
 * new process; closing the pop-up leaves the session running.
 */
export async function openQuickTerminal(to: TapInPane, context: QuickTerminalContext): Promise<SessionPlaceResult> {
  const path = `/api/session-ref/${encodeURIComponent(to.sessionRef)}/pane`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ machine: to.machine }) };
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { ok: false, reason: "Could not reach Scout." };
  }
  const body = await res.json().catch(() => null) as SessionPaneBody | null;
  if (!res.ok || !body?.ok || body.pane?.backend !== "tmux" || !body.pane.sessionName) {
    return { ok: false, reason: (body && !body.ok && body.reason) || `HTTP ${res.status}` };
  }
  showQuickTerminal({ key: to.sessionRef, kind: "Session", pane: body.pane, ...context });
  return { ok: true, app: null };
}

/** A Codex thread the ChatGPT app holds: POST /api/session-ref/:ref/open-thread opens it there. */
export function openInChatGPT(to: { sessionRef: string; machine: string }) {
  return openSessionPlace(to, "open-thread");
}

export type SessionPlaceResult =
  | { ok: true; app: string | null; popOut?: string; terminal?: { app: string; bundleId: string; appPid: number } }
  | { ok: false; reason: string };

/**
 * How to reach the place a terminal route names: bring its window or pane to
 * the front, open a terminal on its attach command, or open the ChatGPT app.
 * Null when Scout can't reach it (a tmux on an unknown machine is only copied).
 * The companion panel and the Scout window both go through this.
 */
export function terminalGo(terminal: TapInTerminal | null, quick?: QuickTerminalContext): { to: Extract<TapInPlaceKind, "terminal" | "open-terminal" | "codex">; run: () => Promise<SessionPlaceResult> } | null {
  if (!terminal) return null;
  switch (terminal.via) {
    case "focus":
      return { to: "terminal", run: async () => {
        const r = await focusTerminal(terminal);
        if (!r.ok) return r;
        // In the companion, Scout then dims the rest and points at the window.
        if (r.app) pointCompanionAt(r.app);
        return { ok: true, app: null };
      } };
    case "herdr":
      return { to: "terminal", run: () => focusHerdrPane(terminal).then((): SessionPlaceResult => ({ ok: true, app: null }), (): SessionPlaceResult => ({ ok: false, reason: "Could not focus the pane." })) };
    case "job":
      // In the companion, our own pop-up; a terminal app where none is drawn, or when the pane can't start.
      return { to: "open-terminal", run: async () => {
        if (quick && canShowQuickTerminal()) {
          const shown = await openSessionPane(terminal, quick);
          if (shown.ok) return shown;
        }
        return openSessionTerminal(terminal);
      } };
    case "attach": {
      const { sessionRef, machine } = terminal;
      return sessionRef && machine ? { to: "open-terminal", run: () => openSessionTerminal({ sessionRef, machine }) } : null;
    }
    case "codex":
      return { to: "codex", run: () => openInChatGPT(terminal) };
  }
}

/** Focus a herdr pane: POST /api/terminal-hosts/herdr/sessions/:name/focus. */
export function focusHerdrPane(pane: { session: string; pane: string }): Promise<unknown> {
  return api(`/api/terminal-hosts/herdr/sessions/${encodeURIComponent(pane.session)}/focus`, {
    method: "POST",
    body: JSON.stringify({ target: pane.pane }),
  });
}

/** Reveal in Finder: POST /api/local-path/reveal. Only paths the observed session touched; by sessionId for a native transcript. */
export function revealPath(input: { path: string; sessionId?: string | null; agentId?: string | null; basePath?: string | null }): Promise<unknown> {
  const body: Record<string, string> = { path: input.path };
  if (input.basePath) body.basePath = input.basePath;
  if (input.agentId) body.agentId = input.agentId;
  if (input.sessionId) body.sessionId = input.sessionId;
  return api("/api/local-path/reveal", { method: "POST", body: JSON.stringify(body) });
}

/** Stop work: cancel the work's ask while its flight runs. */
export function cancelWorkAsk(stop: { conversationId: string; flightId: string }): Promise<unknown> {
  return api(`/api/channels/${encodeURIComponent(stop.conversationId)}/asks/${encodeURIComponent(stop.flightId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Interrupt: stop the agent's current turn, as the Sessions page's Stop does.
 * The runtime's route addresses the live agent, so the session it expects is
 * sent along; offered only where sessionInterruptAgent says it applies (tmux).
 */
export function interruptSession(agentId: string, sessionId: string): Promise<unknown> {
  return api(`/api/agents/${encodeURIComponent(agentId)}/interrupt`, {
    method: "POST",
    body: JSON.stringify({ expectedSessionId: sessionId }),
  });
}

/** Its page in Scout on the web, at the local edge's full address (never a loopback port). */
export function sessionPageUrl(target: Pick<TapInNativeTarget, "sessionRef" | "machineId">): string {
  return `${SCOUT_WEB_ORIGIN}${routePath({ view: "sessions", sessionId: target.sessionRef, ...(target.machineId ? { machineId: target.machineId } : {}) })}`;
}

/** Open session can be offered: only inside the Scout app (the host opens it). */
export function canOpenTapInSession(): boolean {
  return companionHostAvailable();
}

/** Open session: the native session in its own Scout window. False when the host refuses the `session` target. */
export function openTapInSession(target: Pick<TapInNativeTarget, "sessionRef" | "machineId">): Promise<boolean> {
  return openSessionInScout(target.sessionRef, target.machineId);
}

/** Open thread: the conversation in Scout (a request with no work opens by its conversation, as the board does). */
export function openTapInThread(ids: { workId: string | null; conversationId: string }): Promise<unknown> {
  return openFromCompanion("thread", { workId: ids.workId ?? ids.conversationId, conversationId: ids.conversationId });
}

export function openTapInWork(workId: string): Promise<unknown> {
  return openFromCompanion("work", { workId });
}

/**
 * Hear when it is done (core Ready): POST /api/tasks/notify on the running flight. The runtime refuses (409)
 * once the task has finished. Answers with the mark as the runtime now holds it.
 */
export async function setTaskNotify(flightId: string, notify: boolean): Promise<boolean> {
  const result = await api<{ notify: boolean }>("/api/tasks/notify", {
    method: "POST",
    body: JSON.stringify({ ref: flightId, notify }),
  });
  return result.notify === true;
}
