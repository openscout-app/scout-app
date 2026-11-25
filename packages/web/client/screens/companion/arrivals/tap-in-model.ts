/**
 * Tap in: the detail panel beside the arrivals board (Studio:
 * /studies/companion-board-rewrites, its Tap in section; the source is
 * design/studio/views/companion-board-rewrites-tap.tsx). The board holds
 * still; the tapped row's panel opens beside it, or above it in stack mode.
 *
 * Pure: what the panel shows, shaped from the served payloads
 * (GET /api/session-ref/:ref, /touched, /steer, /api/tail/recent,
 * /api/work/:id, /api/messages, the operator-attention item), plus where
 * the panel sits and what a key does. The reads live in tap-in-data.ts and
 * the view in TapInPanel.tsx.
 */

import { EASE_IN, EASE_OUT, ENTER_MS, FOLD_MS, FRAME_MS, PASS_MS } from "./board-motion.ts";
import { remarkOf, rowName, rowSpeaker, sinceClock, sinceOf } from "./arrivals-model.ts";
import { formatSessionRouteRef, parseSessionRouteRef } from "../../../../shared/session-route-ref.ts";
import { canAnswerInPlace, type SessionFocusResult, type SessionPromptDecision, type SessionSteerAvailability } from "../../../../shared/api/session-steer.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { buildCompanionCard, type CompanionCallout } from "../companion-model.ts";
import { isReadyRequest, isRequestDismissal, panePromptNote, requestActionLabel, requestActions, requestKind, terminalScreen, type TerminalLine } from "../../requests/requests-model.ts";
import { madeLinks, type MadeLink } from "../../work/work-summary.ts";
import { toTurnSteps } from "../../chat/turn-steps.ts";
import { observedSessionTurns } from "../../sessions/session-turns.ts";
import { conversationalTargetLabel, conversationFailureNotice, isNoisyConversationStatusMessage } from "../../../lib/message-visibility.ts";
import { sessionResumable, sessionTargetFromObserve, type SessionDeliveryTarget } from "../../sessions/session-delivery.ts";
import type { SessionRefLookup, SessionRefObservePayload } from "../../sessions/SessionRefScreen.tsx";
import type {
  Message,
  ObserveData,
  ObserveFile,
  OperatorAttentionAction,
  NativePermissionDisplay,
  OperatorAttentionItem,
  TailDiscoveredTranscript,
  TailPendingToolCall,
  TailEvent,
  WorkDetail,
} from "../../../lib/types.ts";
import { permissionPresentation } from "../../../lib/permission-presentation.ts";

/** The companion reads permissions the way Home does (lib/permission-presentation.ts). */
export { permissionPresentation };

// ── the clock ────────────────────────────────────────────────────────────

/** The panel's times, in whole 16 ms frames, from board-motion. */
export const TAP_IN = {
  /** The panel grows out of the board's edge. */
  OPEN: ENTER_MS,
  /**
   * Another row: the content crossfades in place; the panel does not move.
   * Beside the board it may grow to fit the new row, never shrink, while open.
   */
  SWAP: ENTER_MS,
  /** Closing: it folds back toward the board. */
  FOLD: FOLD_MS,
  /** A new tail step rolls in at the top, one line. */
  ROLL: ENTER_MS,
  /**
   * The selection rests this long (three entrances) before a row it moved to
   * is read, so ↑/↓ through the board, held or tapped by hand, reads nothing
   * on the way. The row the panel opens on is read at once.
   */
  SETTLE: 3 * ENTER_MS,
  /** The board's pass (30 s): the panel re-reads on it; this is the beat when the board hands none over. */
  REFRESH: PASS_MS,
  /** Live tail lines land together on this beat (the board's push settle, 64 frames), not one render each. */
  PUSH: 64 * FRAME_MS,
  /** A session's full record (model, usage, subagents) is re-read on a pass only once it is this old: four passes. */
  LOOKUP_STALE: 4 * PASS_MS,
  EASE_OUT,
  EASE_IN,
} as const;

/** The tokens as CSS custom properties, set on the panel and the tether. */
export const TAP_IN_VARS: Record<string, string> = {
  "--tap-open": `${TAP_IN.OPEN}ms`,
  "--tap-swap": `${TAP_IN.SWAP}ms`,
  "--tap-fold": `${TAP_IN.FOLD}ms`,
  "--tap-roll": `${TAP_IN.ROLL}ms`,
  "--tap-ease": TAP_IN.EASE_OUT,
  "--tap-ease-in": TAP_IN.EASE_IN,
};

/** The panel's sizes (pt) and how much it reads. Not times. */
export const TAP_IN_SIZE = {
  WIDTH: 440,
  MIN_H: 420,
  GAP: 12,
  /** Kept clear at the screen's edge. */
  INSET: 12,
  TAIL_ROWS: 8,
  /** Steps the panel shows while the session works (Studio /studies/companion-board-light). */
  STEPS: 4,
  TURNS: 3,
  /** Lines of talk the engage panel shows (FigureTalk): yours and its, newest last. */
  HISTORY: 4,
  /** Changed files named; the rest are counted. */
  FILES: 12,
  /** Tail events read per session (the live push keeps it current). */
  TAIL_READ: 40,
  /** Thread messages read, for what it said last. */
  THREAD_READ: 60,
} as const;

/** The panel's hit region id in edge mode; the board treats it as its own. */
export const TAP_IN_HIT_ID = "tap-in";

// ── what was tapped ──────────────────────────────────────────────────────

export type TapInNativeTarget = {
  kind: "native";
  /** The row's id: the panel's identity across passes. */
  key: string;
  /** `session:<harness>:<id>` (a bare id when the harness is unknown). */
  sessionRef: string;
  sessionId: string;
  harness: string | null;
  /** The machine the session runs on; null reads as this Mac. */
  machineId: string | null;
  conversationId: string | null;
  request: OperatorAttentionItem | null;
};
export type TapInWorkTarget = {
  kind: "work";
  key: string;
  /** Null for a request with no work (or a demo row): the panel shows the ask and its thread. */
  workId: string | null;
  conversationId: string | null;
  request: OperatorAttentionItem | null;
};
export type TapInTarget = TapInNativeTarget | TapInWorkTarget;

/**
 * The Codex thread a permission request was raised in. Its `sessionId` is a
 * harness session id only for a Codex approval (codex-app-server.ts: the
 * payload carries the same `threadId`); a tmux permission puts the tmux
 * session's name there, which is no session Scout can read or type into.
 */
export function codexThreadOf(item: OperatorAttentionItem | null | undefined): string | null {
  const id = item?.permission?.sessionId;
  if (!id || !item?.summary) return null;
  try {
    const payload = JSON.parse(item.summary) as { threadId?: unknown } | null;
    return payload && typeof payload === "object" && payload.threadId === id ? id : null;
  } catch {
    return null;
  }
}

/**
 * What a row opens. Work is Scout work. A harness session (a native row, or
 * a Codex approval raised in one) opens its session; anything else is a
 * request with its thread.
 */
export function tapInTarget(t: CornerThread, opts: { machineId?: string | null } = {}): TapInTarget {
  if (t.workId) return { kind: "work", key: t.id, workId: t.workId, conversationId: t.conversationId, request: t.request };
  const parsed = parseSessionRouteRef(t.sessionRef);
  const pinned = t.pinId?.startsWith("session:") ? t.pinId.slice("session:".length) : null;
  const thread = parsed || pinned ? null : codexThreadOf(t.request);
  const sessionId = parsed?.refId ?? pinned ?? thread;
  const harness = t.harness ?? parsed?.harness ?? (thread ? "codex" : null);
  const sessionRef = sessionId ? (parsed?.qualified ? t.sessionRef! : formatSessionRouteRef(harness, sessionId)) : null;
  if (sessionId && sessionRef) {
    return {
      kind: "native", key: t.id, sessionRef, sessionId, harness, machineId: opts.machineId ?? null,
      conversationId: t.conversationId, request: t.request,
    };
  }
  return { kind: "work", key: t.id, workId: null, conversationId: t.conversationId, request: t.request };
}

/**
 * The tail session a target reads: a native session's id; for work, the
 * session its primary flight traced (as the work screen reads it), then the
 * newest flight's, then the ids the work names itself.
 */
export function tailSessionOf(target: TapInTarget, detail: WorkDetail | null): string | null {
  if (target.kind === "native") return target.sessionId;
  if (!detail) return null;
  const flights = detail.allFlights ?? [];
  const primary = flights.find((f) => f.id === detail.primaryInvocation?.flightId) ?? null;
  const newest = [...flights].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null;
  const traced = (f: typeof primary) => f?.sessions.map((s) => s.sessionId).filter(Boolean).at(-1) ?? null;
  return traced(primary) ?? traced(newest) ?? detail.claudeSessionId ?? detail.codexThreadId ?? null;
}

// ── small pieces ─────────────────────────────────────────────────────────

export function tilde(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
export function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
const basename = (path: string | null | undefined) => path?.split("/").filter(Boolean).at(-1) ?? null;
const clean = (s: string | null | undefined) => s?.replace(/\s+/g, " ").trim() || null;
/** The same words, or one is the other cut short (a title made from a prompt). */
export function sameText(a: string, b: string): boolean {
  const x = clean(a)?.replace(/(?:\.\.\.|…)$/u, "") ?? "";
  const y = clean(b)?.replace(/(?:\.\.\.|…)$/u, "") ?? "";
  if (!x || !y) return x === y;
  return x.startsWith(y) || y.startsWith(x);
}

// ── the header ───────────────────────────────────────────────────────────

/** The row's remark on flaps (the board's word) and its clock, each cell turning on its own change. */
export type TapInRemark = {
  word: string;
  /** When the word last changed (page clock, ms): its flaps turn, as on the board. */
  changedAt: number;
  /** When the clock's HH and its MM last changed (BoardRow hhAt, mmAt): only the half that changed turns. */
  hhAt: number;
  mmAt: number;
  /** The time the clock shows. */
  at: number;
};

/**
 * The row's remark as the board shows it (its BoardRow: remark, remarkAt,
 * hhAt, mmAt), or read off the row itself (remarkOf, sinceOf) when the board
 * hands none over. What the board does not hand over is settled: it does not turn.
 */
export function tapInRemark(t: Pick<CornerThread, "state" | "at" | "remark" | "since">, given?: Partial<TapInRemark> | null): TapInRemark {
  return {
    word: given?.word ?? remarkOf(t),
    changedAt: given?.changedAt ?? -Infinity,
    hhAt: given?.hhAt ?? -Infinity,
    mmAt: given?.mmAt ?? -Infinity,
    at: given?.at ?? sinceOf(t),
  };
}
/** As the board's status flaps: the accent while asking, dim once settled. */
export function remarkTone(r: TapInRemark, asking: boolean): "accent" | "dim" | undefined {
  if (asking || r.word === "ASKING") return "accent";
  return r.word === "DONE" || r.word === "ENDED" ? "dim" : undefined;
}
export function remarkClock(r: TapInRemark): { hh: string; mm: string } {
  const [hh = "--", mm = "--"] = sinceClock(r.at).split(":");
  return { hh, mm };
}

export type TapInHeader = {
  /** Who speaks, as on its board row (rowSpeaker). */
  speaker: string;
  /** The project its tile shows; null while Scout doesn't know it. */
  project: string | null;
  title: string;
  /** Hover text: the ref or work id the title stands for. */
  titleHint: string | null;
  /** The harness the coin shows. */
  harness: string | null;
  /** project · branch. */
  where: string;
  /** Where it lives: `herdr main / p3`, `tmux %14`, `ChatGPT app`; empty for Scout work, or when Scout can't place it. */
  lives: string;
};

// ── where a native session lives (GET /api/session-ref/:ref/steer) ───────

/**
 * Where it lives, from the steer target only: herdr's address is
 * session/pane, tmux's the pane id, orca's the terminal handle, and
 * Terminal's the process's tty. A session Scout can't verify live says
 * nothing here: its remark already says it ended (Studio /studies/companion-board-light).
 */
export function whereOf(steer: SessionSteerAvailability | null): string {
  if (!steer) return "";
  const t = steer.target;
  if (steer.code === "not_live") return "";
  if (!t) return steer.code === "native_app_refused" ? "ChatGPT app" : "no reachable pane";
  // Broker-owned background session: no pane or app, input goes through its native owner.
  if (t.host === "broker") return `background · ${t.transport}`;
  // The app it shows in (Ghostty, iTerm), when the server found it; a tmux nobody is attached to says so.
  const app = t.terminal?.app ?? (t.terminal?.attached === false ? "detached" : null);
  if (t.host === "terminal") {
    // A Claude background session's tty belongs to Claude's own pty host: no window shows it.
    if (t.job) return "background session";
    // No GUI app verified: a plain tty, not Terminal.app.
    if (!t.terminal?.app) return `terminal ${t.tty ?? t.address}`;
    return `${t.terminal.app} · ${t.terminal.window ?? t.tty ?? t.address}`;
  }
  const place = t.host === "herdr" ? `herdr ${t.address.replace("/", " / ")}` : `${t.host} ${t.address}`;
  return app ? `${place} · ${app}` : place;
}

/**
 * The herdr pane to focus (`session/pane`): only a pane herdr confirmed holds
 * the session (ready, or blocked on its prompt), never one it could not confirm.
 */
export function herdrPaneOf(steer: SessionSteerAvailability | null): { session: string; pane: string } | null {
  const t = steer?.target;
  if (!t || t.host !== "herdr" || !(steer?.available || steer?.code === "session_blocked")) return null;
  const [session, pane] = t.address.split("/");
  return session ? { session, pane: pane || session } : null;
}

/**
 * The way to the live terminal. A server that reports `focus` has one route
 * for every host (herdr, tmux, Orca, Terminal) and re-proves the binding
 * itself; a tmux nobody is attached to offers its attach command instead.
 * herdr can always focus its own pane, which covers an older server (no
 * `focus`) and a herdr app the server could not verify as a GUI terminal.
 */
export type TapInTerminal =
  | { via: "focus"; sessionRef: string; machine: string; app: string | null }
  /** A Claude background session: no window holds it; the server opens `claude attach` in a terminal app. */
  | { via: "job"; sessionRef: string; machine: string }
  | { via: "herdr"; session: string; pane: string }
  /**
   * A tmux nobody is attached to: its attach command to copy, and, when the
   * machine is known, the server opens a terminal on it (open-terminal).
   */
  | { via: "attach"; command: string; sessionRef: string | null; machine: string | null }
  /** A Codex thread the ChatGPT app holds: the server opens it there (`codex://threads/<id>`). */
  | { via: "codex"; sessionRef: string; machine: string };

export function terminalOf(steer: SessionSteerAvailability | null, at: { sessionRef: string; machine: string | null }): TapInTerminal | null {
  if (!steer) return null;
  if (steer.target && steer.target.host === "terminal" && steer.target.job && at.machine) return { via: "job", sessionRef: at.sessionRef, machine: at.machine };
  if (steer.code === "native_app_refused" && at.sessionRef.startsWith("session:codex:") && at.machine) return { via: "codex", sessionRef: at.sessionRef, machine: at.machine };
  if (steer.focus?.available && at.machine) return { via: "focus", sessionRef: at.sessionRef, machine: at.machine, app: steer.target && steer.target.host !== "broker" ? steer.target.terminal?.app ?? null : null };
  // herdr focuses its own pane, with or without a GUI terminal app the server could verify.
  const pane = herdrPaneOf(steer);
  if (pane) return { via: "herdr", ...pane };
  return steer.focus?.attach
    ? { via: "attach", command: steer.focus.attach, sessionRef: at.machine ? at.sessionRef : null, machine: at.machine }
    : null;
}

/** A session the quick terminal can show: its ref and the host it runs on. */
export type TapInPane = { sessionRef: string; machine: string };

/**
 * The session's tmux pane, for the quick terminal: a live process the steer
 * read placed in a tmux pane on this host. Only a candidate: the server
 * proves the pane again (POST /api/session-ref/:ref/pane) before the pop-up
 * joins it. Herdr, Orca, plain terminal tabs and background jobs have none.
 */
export function quickPaneOf(steer: SessionSteerAvailability | null, at: { sessionRef: string; machine: string | null }, localNodeId: string | null): TapInPane | null {
  const t = steer?.target;
  if (!steer || !t || t.host !== "tmux" || !/^%\d+$/u.test(t.address)) return null;
  if (steer.code === "not_live" || steer.code === "remote_refused") return null;
  // The relay attaches on this host's tmux only.
  if (!at.machine || (localNodeId && at.machine !== localNodeId)) return null;
  return { sessionRef: at.sessionRef, machine: at.machine };
}

// ── where the session is ─────────────────────────────────────────────────

/**
 * One place a session can be gone to, named by where it lands:
 * - `terminal`: its own window, tab or herdr pane, brought to the front;
 * - `quick`: its tmux pane in the companion's own pop-up (no terminal app,
 *   no new process); closing it leaves the session running;
 * - `open-terminal`: a new terminal window on its attach command (a Claude
 *   background job, or a tmux nobody is attached to);
 * - `codex`: the ChatGPT app, on the thread it holds;
 * - `page`: its page in Scout on the web;
 * - `window`: its own Scout window (inside the app);
 * - `thread`, `work`: the Scout thread or work it belongs to.
 */
export type TapInPlaceKind = "terminal" | "quick" | "open-terminal" | "codex" | "page" | "window" | "thread" | "work";

/** The quick terminal's place: ⌘T wherever it is offered. */
export const QUICK_PLACE: TapInPlace = { to: "quick", label: "Quick terminal", title: "Its pane here, beside the board · watching until you jump in. Closing it leaves the session running." };
export type TapInPlace = { to: TapInPlaceKind; label: string; title: string };

/** The live place a terminal route reaches, or null when it reaches none (a tmux whose machine is unknown is only copied). */
export function terminalPlace(terminal: TapInTerminal | null, lives: string): TapInPlace | null {
  if (!terminal) return null;
  const where = lives || "its terminal";
  switch (terminal.via) {
    case "focus":
    case "herdr":
      return { to: "terminal", label: `Go to ${where}`, title: `Bring ${where} to the front` };
    case "job":
      return { to: "open-terminal", label: "Open in a terminal", title: "Attach to the background session (claude attach): in the pop-up here, or your terminal app. Closing it leaves the session running." };
    case "attach":
      return terminal.sessionRef
        ? { to: "open-terminal", label: "Open in a terminal", title: "Open a terminal attached to its tmux session" }
        : null;
    case "codex":
      return { to: "codex", label: "Go to the ChatGPT app", title: "Open the thread in the ChatGPT app" };
  }
}

/**
 * Where the session is, best first: its own window, then its pane in the
 * quick terminal; else the quick terminal in place of a terminal opened on
 * it (a tmux nobody is attached to needs no new window), else that terminal,
 * else the ChatGPT app that holds it, else its page on the web, else its
 * Scout window; then its thread or work. The first is the primary action and
 * ⌘O. One function, so the runtime's place resolver can replace it.
 */
export function tapInPlaces(has: {
  terminal: TapInTerminal | null;
  lives: string;
  /** The quick terminal can show its pane (quickPaneOf, with a pop-up host on the page). */
  quick?: boolean;
  page: boolean;
  window: boolean;
  thread: boolean;
  work: boolean;
}): TapInPlace[] {
  const places: TapInPlace[] = [];
  const live = terminalPlace(has.terminal, has.lives);
  if (has.quick && (!live || has.terminal?.via === "attach")) places.push(QUICK_PLACE);
  else if (live) {
    places.push(live);
    if (has.quick) places.push(QUICK_PLACE);
  }
  if (has.page) places.push({ to: "page", label: "Open the session page", title: "Open the session's page in Scout on the web" });
  if (has.window) places.push({ to: "window", label: "Open in a Scout window", title: "Open the session in its own Scout window" });
  if (has.thread) places.push({ to: "thread", label: "Open thread", title: "Open the thread in Scout" });
  if (has.work) places.push({ to: "work", label: "Open work", title: "Open the work in Scout" });
  return places;
}

/** A session's page in Scout on the web: always the local edge's full address, never a loopback port. */
export const SCOUT_WEB_ORIGIN = "http://scout.local";

/** What a jump that didn't land says (session-terminal.ts's codes); anything else, the server's own reason. */
export const FOCUS_LINE: Record<string, string> = {
  native_activation_required: "Selected it, but macOS kept the terminal app in the background.",
  focus_unconfirmed: "The terminal didn't confirm the jump.",
  binding_changed: "The session moved while jumping. Try again.",
  terminal_unavailable: "No terminal window holds it.",
  tmux_detached: "No terminal is attached to its tmux session.",
};

// ── the request block ────────────────────────────────────────────────────

export type TapInDecision = { label: string; kind: "approve" | "deny" | "dismiss" | "continue" | "hold"; action: OperatorAttentionAction };

/** The one way to answer an ask that raised no request: the window it is asked in, or a terminal for a background session. */
export type TapInAskGo = { label: string; title: string };

/** What the request block shows, from whichever thing carries the ask. */
export type TapInAsk = {
  kindLabel: string;
  at: number;
  heading: string;
  reason: string | null;
  command: string | null;
  cwd: string | null;
  detail: string | null;
  /** The prompt as the harness's terminal drew it, when the request carries one: shown as a terminal, spacing kept. */
  screen?: readonly TerminalLine[] | null;
  /** The tmux pane the prompt sits in, shown live in place of the screen; Jump in answers it there. */
  pane?: OperatorAttentionItem["pane"] | null;
  /** What the action names: a file, a page, a search (a native permission's display). */
  target?: string | null;
  /** The questions a native session asks leave to put, with the answers it offers: read here, answered in the session. */
  questions?: NativePermissionDisplay["questions"] | null;
  /** Any other tool's input, one line per field. */
  fields?: NativePermissionDisplay["fields"] | null;
  /** Answer chips: a declared question's options. */
  options: string[];
  /** Allow / Deny: only a backed permission or approval record. */
  decisions: TapInDecision[];
  /** The runtime ends the request: a permission request or an agent's question. Kept apart from the decisions. */
  dismiss?: TapInDecision;
  /** No answer path from here: said instead of chips. */
  note: string | null;
  /** The pane can be focused to answer it there (herdr). */
  focusable: boolean;
  /** Where it is answered, as the block's action: its window, its pane, or a terminal opened for it. */
  go?: TapInAskGo | null;
  /** Request details: the full payload and the record's own line. */
  technical: string | null;
  techFoot: string | null;
  /** After a delivered answer: where it went. */
  carries: string;
  /** The item behind it, when there is one (its answers go through useRequestActions). */
  item: OperatorAttentionItem | null;
  /** A Ready task: done, the move is the operator's. Drawn in the Ready colour, never as a question. */
  ready?: boolean;
  /**
   * A background session's permission prompt Scout can answer from here
   * (POST /api/session-ref/:ref/answer-prompt): Allow once and Deny, sent only
   * when its screen shows this same call. `go` stays as the way when it doesn't.
   */
  inPlace?: TapInInPlace | null;
};

/** Where an in-place answer goes and which call it answers, with the answers it offers. */
export type TapInInPlace = {
  sessionRef: string;
  machine: string;
  toolUseId: string;
  answers: { label: string; decision: SessionPromptDecision }[];
};

/**
 * A background session waiting on a permission prompt for a call Scout can
 * check on its screen (canAnswerInPlace): answered in place, with Allow once
 * (the prompt's plain Yes, never "always allow") and Deny (its No). Any other
 * ask, or a session with a window, keeps the way it has.
 */
export function backgroundAnswer(ask: TapInAsk, terminal: TapInTerminal | null, pending: TailPendingToolCall | null | undefined): void {
  if (ask.item || terminal?.via !== "job" || !pending || !canAnswerInPlace(pending)) return;
  ask.inPlace = {
    sessionRef: terminal.sessionRef,
    machine: terminal.machine,
    toolUseId: pending.toolUseId,
    answers: [{ label: "Allow once", decision: "approve" }, { label: "Deny", decision: "deny" }],
  };
  ask.note = "A background session. Scout attaches, checks that its screen shows this command, then presses your answer.";
  ask.carries = "the session carries on";
}

/** A permission's summary with no display of its own: its first line heads it, the rest reads under it. */
export function summaryHeading(summary: string | null): { heading: string; rest: string | null } | null {
  const lines = (summary ?? "").split("\n").map((line) => line.trim());
  const first = lines.findIndex(Boolean);
  if (first < 0) return null;
  const heading = lines[first]!.replace(/:$/u, "");
  return { heading, rest: clean(lines.slice(first + 1).join(" ")) };
}

/** A served request: a question's options are chips; a permission is "Run this command?" with Allow / Deny. */
export function askFromItem(item: OperatorAttentionItem): TapInAsk {
  if (isReadyRequest(item)) return readyAsk(item);
  const native = nativeAsk(item);
  if (native) return native;
  const presentation = permissionPresentation(item);
  const decisions = requestActions(item)
    .filter((a) => a.kind === "approve" || a.kind === "deny")
    .map((a): TapInDecision => ({ label: requestActionLabel(a), kind: a.kind as "approve" | "deny", action: a }));
  const dismissal = requestActions(item).find((a) => isRequestDismissal(item, a));
  const options = item.answer?.options ?? [];
  const onScreen = item.id.startsWith("tmux-host-permission:");
  // A prompt captured from a pane reads as the terminal drew it; folded into one sentence it says nothing.
  // The screen stands in for the text it came from; the other still reads under it.
  const summaryScreen = presentation ? null : terminalScreen(item.summary);
  const detailScreen = presentation || summaryScreen ? null : terminalScreen(item.detail);
  const screen = summaryScreen ?? detailScreen;
  // As ScoutbotRequest: the title, then the summary and the detail where each says something new.
  const summary = presentation || summaryScreen ? null : clean(item.summary) !== clean(item.title) ? clean(item.summary) : null;
  const detail = presentation || detailScreen ? null : clean(item.detail) && clean(item.detail) !== clean(item.summary) ? clean(item.detail) : null;
  return {
    kindLabel: requestKind(item),
    at: item.updatedAt,
    heading: presentation ? "Run this command?" : item.title,
    reason: presentation ? presentation.reason : summary,
    command: presentation?.command ?? null,
    cwd: presentation?.cwd ?? null,
    detail,
    screen,
    pane: item.pane ?? null,
    options,
    decisions,
    ...(dismissal ? { dismiss: { label: "Dismiss", kind: "dismiss" as const, action: dismissal } } : {}),
    note: options.length || decisions.length ? null
      : item.pane ? panePromptNote(item.pane) ?? "Jump in to answer it in the pane."
      : onScreen ? "Answer it in the pane, not from here."
        : item.conversationId ? "Answered in the thread, not from here." : "Nothing answers it from here.",
    focusable: false,
    technical: presentation ? item.summary : null,
    techFoot: presentation && item.detail ? item.detail : null,
    carries: item.answer ? "into the thread" : decisions.length ? "the session carries on" : "",
    item,
  };
}

/**
 * A Ready task: "<agent> is ready", the agent's summary line, and what it was
 * asked. Continue hands the next move back to it; Hold takes it off the list.
 */
export function readyAsk(item: OperatorAttentionItem & { ready: NonNullable<OperatorAttentionItem["ready"]> }): TapInAsk {
  const decisions = requestActions(item)
    .filter((a) => a.kind === "continue" || a.kind === "hold")
    .map((a): TapInDecision => ({ label: a.label, kind: a.kind as "continue" | "hold", action: a }));
  const summary = clean(item.ready.summary);
  const task = clean(item.detail);
  return {
    kindLabel: requestKind(item),
    at: item.ready.at,
    heading: item.title,
    reason: summary || null,
    command: null,
    cwd: null,
    detail: task && task !== summary ? `Asked: ${task}` : null,
    options: [],
    decisions,
    note: null,
    focusable: false,
    technical: null,
    techFoot: null,
    carries: "",
    item,
    ready: true,
  };
}

/**
 * A native session's permission request: laid out from the runtime's display,
 * or, from an older runtime, its summary's first line as the heading. Never
 * the kind label twice, and the session id goes under Request details.
 */
function nativeAsk(item: OperatorAttentionItem): TapInAsk | null {
  const native = item.permission?.native;
  if (!item.permission || !native) return null;
  const display = native.display;
  const fallback = display ? null : summaryHeading(item.summary);
  if (!display && !fallback) return null;
  const decisions = requestActions(item)
    .filter((a) => a.kind === "approve" || a.kind === "deny")
    .map((a): TapInDecision => ({ label: requestActionLabel(a), kind: a.kind as "approve" | "deny", action: a }));
  const dismissal = requestActions(item).find((a) => isRequestDismissal(item, a));
  const questions = display?.questions?.length ? display.questions : null;
  return {
    kindLabel: requestKind(item),
    at: item.updatedAt,
    heading: display?.action ?? fallback!.heading,
    reason: display ? display.note ?? (questions ? "Allow it and the question opens in its session, to answer there." : null) : fallback!.rest,
    command: display?.command ?? null,
    cwd: item.permission.projectRoot,
    detail: null,
    target: display?.target ?? null,
    questions,
    fields: display?.fields?.length ? display.fields : null,
    options: [],
    decisions,
    ...(dismissal ? { dismiss: { label: "Dismiss", kind: "dismiss" as const, action: dismissal } } : {}),
    note: decisions.length ? null : "Nothing answers it from here.",
    focusable: false,
    technical: item.summary,
    techFoot: item.detail,
    carries: decisions.length ? "the session carries on" : "",
    item,
  };
}

/** What the server lane reads off a transcript (types.ts TailDiscoveredTranscript); absent on older servers. */
export type TapInTranscript = Pick<TailDiscoveredTranscript, "title" | "status" | "waitingFor" | "attention">;

/**
 * Where to answer a prompt that raised no request, in words the operator can
 * act on: the place it lives, or the plain reason Scout can't name one. Never
 * "answer it in the pane" when there is no pane to point at.
 */
export function waitingNote(steer: SessionSteerAvailability | null, lives: string): string {
  if (steer?.code === "remote_refused") return "It runs on another host. Answer it there.";
  if (steer?.code === "not_live") return "Its process is no longer running, so nothing is waiting on this prompt.";
  if (steer?.code === "native_app_refused") return "Answer it in the ChatGPT app.";
  if (steer && !steer.target) return "Scout can't find the terminal it runs in. Answer it there.";
  // The runtime runs it with no pane or app; an open reply line replaces this note.
  if (steer?.target?.host === "broker") return "It runs in the background, with no terminal to answer it in.";
  // The head offers "copy attach" beside the place for exactly this case.
  if (steer?.target?.host === "tmux" && steer.target.terminal?.attached === false) return "No terminal has its tmux session open. Attach to it and answer there.";
  return `Answer it in ${lives || "its terminal"}.`;
}

/**
 * A native session waiting on a prompt that raised no request: shown
 * read-only, answered where it runs. Herdr can focus the pane.
 */
export function askFromSignal(transcript: TapInTranscript | null | undefined, lives: string, now: number, steer: SessionSteerAvailability | null = null): TapInAsk | null {
  const attention = transcript?.attention;
  if (!attention && transcript?.status !== "waiting") return null;
  const herdr = attention?.source === "herdr";
  // Herdr raised it from its own pane and can focus that pane, so the note names
  // the pane whatever the steer probe made of the process.
  const herdrPlace = steer && !steer.target ? "" : lives;
  const reason = clean(attention?.reason) ?? clean(transcript?.waitingFor);
  const pending = attention?.pending ?? null;
  const more = pending && pending.alsoPending > 0 ? `${pending.alsoPending === 1 ? "One more call waits" : `${pending.alsoPending} more calls wait`} after it.` : null;
  return {
    kindLabel: pending && reason && /permission/iu.test(reason) ? "Permission prompt" : "Waiting for input",
    at: attention?.since ?? pending?.at ?? now,
    heading: pending ? pending.title : reason ?? "Waiting for input in its pane",
    reason: null,
    command: pending?.subject ?? null,
    cwd: null,
    detail: [pending?.detail ?? null, more].filter(Boolean).join(" ") || null,
    options: [],
    decisions: [],
    note: herdr ? `Answer it in ${herdrPlace || "its herdr pane"}.` : waitingNote(steer, lives),
    focusable: herdr,
    technical: null,
    techFoot: null,
    carries: "the pane carries on",
    item: null,
  };
}

// ── the Tail ─────────────────────────────────────────────────────────────

export type TapInTailRow = {
  id: string;
  tool: string;
  /** The plain description: Bash's own description first, else the argument. */
  text: string;
  /** Hover: the full argument. */
  title: string;
  repeat: number;
  running: boolean;
  status: "working" | "success" | "warning" | "error";
  ts: number;
};

/** A Claude Bash call's own description (`input.description` on its tool_use block). */
export function bashDescription(event: TailEvent): string | null {
  const raw = event.raw as { message?: { content?: unknown } } | null | undefined;
  const blocks = raw?.message?.content;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    const b = block as { type?: unknown; name?: unknown; input?: { description?: unknown } } | null;
    if (b?.type === "tool_use" && typeof b.input?.description === "string" && b.input.description.trim()) return b.input.description.trim();
  }
  return null;
}

const CODEX_CALL = /^await tools\.([\w.]+)\(\{\s*"?(?:cmd|command)"?\s*:\s*"((?:[^"\\]|\\.)*)/;

/**
 * A Codex step an older server leaves as raw code (`await
 * tools.exec_command({cmd:"…"})`): its tool and the command's first line.
 */
export function codexCall(text: string): { tool: string; text: string } | null {
  const m = CODEX_CALL.exec(text.trim());
  if (!m) return null;
  let cmd = m[2]!;
  try {
    cmd = JSON.parse(`"${cmd}"`) as string;
  } catch {
    // Cut mid-escape: keep it as written, one line.
    cmd = cmd.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return { tool: m[1] === "exec_command" ? "exec" : m[1]!, text: cmd.split("\n")[0]!.trim() };
}

/**
 * The live Tail: the session's tool steps (as useTurnSteps shapes them),
 * plain description first, consecutive repeats collapsed, newest on top.
 * The newest step reads "running" while the row is working, only while it
 * has no result and nothing was said or asked after it.
 */
/** An MCP tool says its verb (mcp__lattices__browser_screenshot → Screenshot); any other tool its own name. */
export function stepTool(tool: string): string {
  const parts = tool.split("__");
  if (parts[0] !== "mcp" || parts.length < 3) return tool;
  const verb = parts.slice(2).join("__").split("_").filter(Boolean).at(-1) ?? tool;
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

/** A step that names one whole path (absolute or under ~) says its file, not the path. */
export function stepFile(text: string): string {
  const t = text.trim();
  return /^(\/|~\/)\S+$/.test(t) ? t.split("/").filter(Boolean).at(-1) ?? t : text;
}

/** A Claude model by its name (claude-opus-5-5 → Opus 5.5); any other id as it is. */
export function modelName(model: string | null | undefined): string | null {
  const m = model?.trim();
  if (!m) return null;
  const c = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(m);
  if (!c) return m;
  const [, family, major, minor, long] = c;
  return `${family!.charAt(0).toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}${long ? " 1M" : ""}`;
}

export function tailRows(events: readonly TailEvent[], running: boolean, limit: number = TAP_IN_SIZE.TAIL_ROWS): TapInTailRow[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const steps = toTurnSteps([...events]).filter((s) => s.kind === "tool");
  const rows: TapInTailRow[] = [];
  for (const s of steps) {
    const event = byId.get(s.id);
    const described = event ? bashDescription(event) : null;
    const code = described ? null : codexCall(s.arg ?? s.text) ?? codexCall(s.text);
    const raw = code?.tool ?? s.tool ?? "tool";
    const tool = stepTool(raw);
    const said = code?.text ?? described ?? (s.arg && s.text.startsWith(`${raw} `) ? s.arg : s.text);
    // A call with no argument says its name once, in the tool column.
    const plain = said.trim() === raw || said.trim() === tool ? "" : stepFile(said);
    const prev = rows.at(-1);
    if (prev && prev.tool === tool && prev.text === plain) {
      prev.repeat += s.repeatCount;
      prev.ts = s.ts;
      prev.status = s.status;
      continue;
    }
    rows.push({ id: s.id, tool, text: plain, title: s.arg ?? s.text, repeat: s.repeatCount, running: false, status: s.status, ts: s.ts });
  }
  const last = rows.at(-1);
  const newest = steps.at(-1);
  const settled = !newest || Boolean(newest.outcome) || events.some((e) => (e.kind === "user" || e.kind === "assistant") && e.ts > newest.ts);
  if (last && running && last.status !== "error" && !settled) last.running = true;
  return rows.slice(-limit).reverse();
}

/** The newest PR link and AI title a session's tail carries (Claude's pr-link and ai-title lines). */
export function tailFacts(events: readonly TailEvent[], prior: { prUrl: string | null; aiTitle: string | null } = { prUrl: null, aiTitle: null }) {
  let { prUrl, aiTitle } = prior;
  let prAt = -Infinity, titleAt = -Infinity;
  for (const e of events) {
    const raw = e.raw as { type?: unknown; prUrl?: unknown; aiTitle?: unknown } | null | undefined;
    if (raw?.type === "pr-link" && typeof raw.prUrl === "string" && /^https?:\/\//.test(raw.prUrl) && e.ts >= prAt) {
      prUrl = raw.prUrl;
      prAt = e.ts;
    } else if (raw?.type === "ai-title" && typeof raw.aiTitle === "string" && raw.aiTitle.trim() && e.ts >= titleAt) {
      aiTitle = raw.aiTitle.trim();
      titleAt = e.ts;
    }
  }
  return { prUrl, aiTitle };
}

/** "#1350" for a GitHub pull URL, else the host. */
export function prLabel(url: string): string {
  const pull = /\/pull\/(\d+)/.exec(url);
  if (pull) return `#${pull[1]}`;
  try { return new URL(url).host; } catch { return "PR"; }
}

// ── native session ───────────────────────────────────────────────────────

/** GET /api/session-ref/:ref/touched (server/observe-payload.ts sessionTouchedResponse). */
export type SessionTouched = {
  schema: "openscout.session.touched/v1";
  refId: string | null;
  agentId: string | null;
  sessionId: string | null;
  source: SessionRefObservePayload["source"];
  fidelity: SessionRefObservePayload["fidelity"];
  historyPath: string | null;
  worktreePath: string | null;
  counts: { files: number; changedFiles: number; readFiles: number };
  files: ObserveFile[];
};

/** Prompts and what each last said, read once: the answer is null when nothing was said yet. */
export type TapInTurnRead = { id: string; prompt: string; answer: string | null; at: number | null };
/** What the session said last, and when (null when the source has no wall time). */
export type TapInSaid = { text: string; at: number | null };
export type TapInTurnsRead = {
  rows: TapInTurnRead[];
  total: number;
  /** The newest thing the session said to you, whatever turn it was in: what the panel shows when it finds no prompts. */
  said?: TapInSaid | null;
};
export type TapInReply = {
  /** The line takes text: there is a live process (or a thread) to reach; otherwise there is no line. */
  open: boolean;
  placeholder: string;
  /** Nothing holds the session: a reply resumes it (POST /api/sessions/reply), never the steer route. */
  resume?: boolean;
};

export type TapInNativeView = {
  kind: "native";
  header: TapInHeader;
  /** The way to its live terminal (terminalOf). */
  terminal: TapInTerminal | null;
  /** Its tmux pane on this host, for the quick terminal (quickPaneOf). */
  pane?: TapInPane | null;
  pr: { url: string; label: string } | null;
  ask: TapInAsk | null;
  /** The Tail is live (the row is working and no ask holds it). */
  live: boolean;
  tail: TapInTailRow[];
  /** Your latest prompt, when the title is not already it. */
  asked: string | null;
  /**
   * The newest thing it said, whole (its record, else its tail, else its
   * conversation's thread), else the row's own line, so the panel never
   * shows less than the row.
   */
  last: TapInSaid | null;
  /** The last few lines of talk, oldest first, ending on what it said last (historyOf). */
  history: TapInLine[];
  /** What is going on, as label and value: host, harness, model, folder, branch, session, state. */
  facts: Array<[string, string]>;
  /** The files it changed, newest first; the rest are counted. */
  touched: { files: { path: string; name: string }[]; more: number } | null;
  reply: TapInReply;
  /** Where a reply goes; null until the session's identity resolves. */
  delivery: SessionDeliveryTarget | null;
  /** Reveal goes by the observed session: a native transcript's agentId is null. */
  revealBy: { sessionId: string | null; agentId: string | null; basePath: string | null };
};

export type TapInNativeInput = {
  target: TapInNativeTarget;
  thread: CornerThread;
  lookup: SessionRefLookup | null;
  touched: SessionTouched | null;
  steer: SessionSteerAvailability | null;
  tail: readonly TailEvent[];
  aiTitle?: string | null;
  prUrl?: string | null;
  transcript?: TapInTranscript | null;
  localNodeId: string | null;
  now: number;
  /** The row's remark as the board shows it: the Tail is live only while it reads WORKING. */
  remark?: string;
  /** The turns read off the session's record (turnsFromObserve), kept when its events are dropped. */
  observeTurns?: TapInTurnsRead | null;
  /** The thread of a session Scout started in a conversation (GET /api/messages). */
  messages?: readonly Message[];
};

/**
 * The last prompts in an observed record (operator prompts are `ask` events
 * with no `to`), and the newest message it said. A server whose record
 * carries no prompts still carries what the session said (`message` events).
 */
export function turnsFromObserve(data: Pick<ObserveData, "events" | "files">): TapInTurnsRead {
  // A prompt that was only injected context (a Codex environment block) is not one of yours.
  const all = observedSessionTurns(data as ObserveData, false)
    .filter((turn) => turn.boundary === "prompt" && operatorPrompt(turn.prompt.map((e) => e.text).join("\n")));
  const last = [...data.events].reverse().find((e) => e.kind === "message" && e.text.trim());
  return {
    said: last ? { text: last.text.trim(), at: typeof last.at === "number" && Number.isFinite(last.at) ? last.at : null } : null,
    total: all.length,
    rows: all.slice(-TAP_IN_SIZE.TURNS).map((turn) => ({
      id: turn.id,
      prompt: operatorPrompt(turn.prompt.map((e) => e.text).join("\n")) ?? "",
      answer: [...turn.messages].reverse().find((e) => e.kind === "message" && e.text.trim())?.text.trim() ?? null,
      at: turn.prompt[0]?.at ?? null,
    })),
  };
}

/**
 * The turns a summary read carries (GET /api/session-ref/:ref?view=summary):
 * the last few prompts from the transcript's tail, oldest first. A prompt
 * outside the read window comes back null; its answer still counts as said.
 */
export function turnsFromSummary(summary: NonNullable<ObserveData["summary"]>): TapInTurnsRead {
  const rows = summary.turns.flatMap((turn, i): TapInTurnRead[] => {
    const prompt = operatorPrompt(turn.prompt);
    return prompt ? [{ id: `summary:${turn.at ?? i}`, prompt, answer: clean(turn.answer), at: turn.at }] : [];
  });
  const last = [...summary.turns].reverse().find((turn) => clean(turn.answer));
  return {
    rows: rows.slice(-TAP_IN_SIZE.TURNS),
    total: rows.length,
    said: last ? { text: clean(last.answer)!, at: last.at } : null,
  };
}

/**
 * A report's whole text. The work's timeline keeps a cut, one-line copy of
 * what the agent reported; the agent's message keeps every line of it.
 */
export function fullReport(detail: Pick<WorkDetail, "timeline">, text: string): string {
  const head = clean(text.replace(/(?:\.\.\.|…)$/u, ""));
  if (!head) return text;
  const said = detail.timeline.find((item) => item.kind === "message" && clean(item.summary)?.startsWith(head));
  return said?.summary?.trim() || text;
}

/** Home folders as ~, anywhere in a line of text. */
export function tildeAll(text: string): string {
  return text.replace(/\/Users\/[^/\s]+/gu, "~");
}

// Scout's ask delivery (runtime buildInvocationOpener + buildInvocationDispatchLine): "<who> → <to> · ask:<id> › <summary>", then "delivery: … · session: …".
const SCOUT_ASK = /^([^\n]*?) › ([^\n]*)\ndelivery: [^\n]*· session: /;
const SCOUT_ASK_FLAT = /^.*? › (.*?) delivery: \S+ · session: /;
// A Codex environment block, tags kept or already taken off (cwd, shell, date, timezone).
const CODEX_ENVIRONMENT = /^\s*(?:<environment_context>[\s\S]*?<\/environment_context>\s*)+/;
const CODEX_ENVIRONMENT_BARE = /^(?:\/|~)\S*\s+(?:zsh|bash|fish|sh|nu|pwsh|powershell)\s+\d{4}-\d{2}-\d{2}\b[^\n]*$/;

/**
 * A prompt as the operator meant it, on one line: a Scout ask says its task,
 * not the envelope it came in; a Codex environment block says nothing.
 * Null when nothing of yours is left.
 */
export function operatorPrompt(text: string | null | undefined): string | null {
  let t = (text ?? "").replace(CODEX_ENVIRONMENT, "").trim();
  const ask = SCOUT_ASK.exec(t);
  if (ask) {
    const task = t.lastIndexOf("\nTask:\n");
    const lead = /\nTreat this as a direct message[^\n]*\n/.exec(t);
    const gap = lead ? t.indexOf("\n\n", lead.index + lead[0].length - 1) : -1;
    t = task >= 0 ? t.slice(task + 7) : gap >= 0 ? t.slice(gap + 2) : ask[2]!;
  } else {
    const flat = SCOUT_ASK_FLAT.exec(t);
    if (flat) t = flat[1]!;
  }
  const line = clean(t);
  return !line || CODEX_ENVIRONMENT_BARE.test(line) ? null : line;
}

const HARNESS_USER_LINE =/^\s*(\[Request interrupted|This session is being continued from a previous conversation|Another Claude session sent a message:|<)/;

/**
 * The prompts the session's tail holds, and what was said after each: the
 * operator's own lines only (no subagent lines, compaction summaries, local
 * commands, relayed messages or injected context). Only as far back as the tail.
 */
export function turnsFromTail(events: readonly TailEvent[]): TapInTurnsRead {
  const rows: TapInTurnRead[] = [];
  let said: TapInSaid | null = null;
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    const raw = e.raw as { isSidechain?: unknown; isCompactSummary?: unknown; isMeta?: unknown } | null | undefined;
    if (raw?.isSidechain === true) continue;
    const text = clean(e.summary);
    if (!text) continue;
    if (e.kind === "user") {
      if (raw?.isCompactSummary === true || raw?.isMeta === true || HARNESS_USER_LINE.test(text)) continue;
      const prompt = operatorPrompt(e.summary);
      if (!prompt) continue;
      rows.push({ id: e.id, prompt, answer: null, at: e.ts });
    } else if (e.kind === "assistant") {
      said = { text, at: e.ts };
      if (rows.length) rows[rows.length - 1]!.answer = text;
    }
  }
  return { rows: rows.slice(-TAP_IN_SIZE.TURNS), total: rows.length, said };
}

/** The newer of two reads of what it said; a tie (or no time) keeps the first. */
export function newerSaid(first: TapInSaid | null, second: TapInSaid | null): TapInSaid | null {
  if (!first) return second;
  if (!second) return first;
  return (second.at ?? -Infinity) > (first.at ?? -Infinity) ? second : first;
}

/**
 * The reply line for a native session: open when it types into the live
 * process in place (the steer route, to a resolved session), or when the
 * session is on this host and nothing holds it, so a reply resumes it
 * (sessionResumable; the line says so). Otherwise there is no line, and
 * nothing says why.
 */
export function nativeReply(delivery: SessionDeliveryTarget | null, steer: SessionSteerAvailability | null): TapInReply {
  const lives = whereOf(steer);
  if (steer?.available && delivery && !delivery.blockedReason) return { open: true, placeholder: lives ? `Reply into ${lives}` : "Reply" };
  if (sessionResumable(delivery, steer)) return { open: true, resume: true, placeholder: "Reply to resume the session" };
  return { open: false, placeholder: "Reply" };
}

/** A waiting pane with an open reply line is answered from the line, so its note points there instead of at the pane. */
export function signalAskNote(ask: TapInAsk, reply: TapInReply, lives: string): string | null {
  return !ask.item && reply.open ? `Answer it below; it types into ${lives || "the pane"}.` : ask.note;
}

/**
 * Where an ask that raised no request is answered, best first: the window it
 * is asked in (the action takes you there; the card only shows the question),
 * then herdr's pane, then, for a background session no window shows, a
 * terminal opened on it. Only when none of those exists does the reply line
 * answer in place, and only when it can type into the session.
 */
export function routeSignalAsk(ask: TapInAsk, terminal: TapInTerminal | null, reply: TapInReply, lives: string, preserveWaitingNote = false): void {
  if (ask.item) return;
  const place = terminalPlace(terminal, lives);
  if (place) {
    ask.go = { label: place.label, title: place.title };
    ask.note = terminal?.via === "job"
      ? "A background session: no window shows it, and Scout can't type into it. Open it in a terminal to answer."
      : terminal?.via === "attach"
        ? "No terminal is attached to its tmux session. Open one to answer."
        : terminal?.via === "codex"
          ? "Answer it in the ChatGPT app."
          : `Answer it in ${lives || "its terminal"}.`;
  } else {
    ask.go = null;
    ask.note = !reply.open && preserveWaitingNote ? ask.note : reply.open ? `Answer it below; it types into ${lives || "the pane"}.`
      : `Answer it where it runs${lives ? ` (${lives})` : ""}. Scout has no way to reach it from here.`;
  }
  ask.focusable = Boolean(ask.go);
}

export function nativeView(input: TapInNativeInput): TapInNativeView {
  const { target, thread: t, lookup, touched, steer } = input;
  const observe = lookup?.kind === "observe" ? lookup.observe : null;
  const conversation = lookup?.session ?? null;
  const meta = observe?.data.metadata;
  const session = meta?.session;
  const lives = whereOf(steer);
  const word = input.remark ?? remarkOf(t);
  const working = word === "WORKING";
  const remote = Boolean(target.machineId && target.machineId !== input.localNodeId);

  const title = clean(input.transcript?.title) ?? clean(input.aiTitle) ?? rowName({ ...t, handle: "session" });
  const header: TapInHeader = {
    speaker: rowSpeaker(t),
    project: t.project ?? basename(session?.cwd),
    title,
    titleHint: target.sessionRef,
    harness: target.harness ?? session?.adapterType ?? null,
    // Another host leads the line; this one goes unsaid.
    where: [remote ? target.machineId : null, t.project ?? basename(session?.cwd), t.branch ?? session?.gitBranch].filter(Boolean).join(" · "),
    lives,
  };

  const ask = target.request ? askFromItem(target.request) : askFromSignal(input.transcript, lives, input.now, steer);
  const at = { sessionRef: target.sessionRef, machine: target.machineId ?? input.localNodeId };
  const terminal = terminalOf(steer, at);
  const pane = quickPaneOf(steer, at, input.localNodeId);

  // Turns: each prompt and what it last said, from the session's record, else
  // from its tail (an older server's record carries no operator prompts).
  const recorded = input.observeTurns ?? (observe?.data.events.length ? turnsFromObserve(observe.data) : null);
  const tailTurns = turnsFromTail(input.tail);
  const turnsRead = recorded?.rows.length ? recorded : tailTurns;
  // The newest thing it said (its record, then its tail, then the last answer), else the row's own line.
  const answered = [...turnsRead.rows].reverse().find((turn) => turn.answer);
  const rowLine = clean(t.now);
  // A session Scout started in a conversation: its thread, read once (replies go into the live process).
  // The thread speaks before the row's line: a notice that it couldn't reply says why, where the row only says it stopped.
  const fromThread = target.conversationId ? [...threadRows(input.messages ?? [])].reverse().find((m) => !m.you) ?? null : null;
  // The record is read once a visit; the tail stays live. The newer of the two
  // says it (the tail's is clipped, so a tie keeps the record's), never less than the row.
  const said = newerSaid(recorded?.said ?? null, tailTurns.said ?? null);
  const last = said ?? (answered ? { text: answered.answer!, at: answered.at } : null)
    ?? (fromThread ? { text: fromThread.body, at: fromThread.at } : null) ?? (rowLine ? { text: rowLine, at: t.at } : null);
  const recordedPrompt = turnsRead.rows.at(-1) ?? null;
  const tailPrompt = tailTurns.rows.at(-1) ?? null;
  const prompt = (tailPrompt && (!recordedPrompt || (tailPrompt.at ?? -Infinity) > (recordedPrompt.at ?? -Infinity)) ? tailPrompt : recordedPrompt)?.prompt ?? null;

  // The files it changed, newest first.
  const files = touched?.files ?? observe?.data.files ?? [];
  const changed = files.filter((f) => f.state !== "read").sort((a, b) => b.lastT - a.lastT);
  const touchedView = files.length
    ? {
        files: changed.slice(0, TAP_IN_SIZE.FILES).map((f) => ({ path: f.path, name: fileName(f.path) })),
        more: Math.max(0, changed.length - TAP_IN_SIZE.FILES),
      }
    : null;

  const delivery = observe ? sessionTargetFromObserve(observe, conversation, target.machineId ?? undefined, input.localNodeId) : null;
  // A session whose window can be raised is answered there: the line stays closed while it asks.
  const reply = ask && !ask.item && terminal && terminal.via !== "attach" ? { ...nativeReply(delivery, steer), open: false } : nativeReply(delivery, steer);
  if (ask) {
    if (ask.item) ask.note = signalAskNote(ask, reply, lives);
    else {
      routeSignalAsk(ask, terminal, reply, lives, true);
      backgroundAnswer(ask, terminal, input.transcript?.attention?.pending);
    }
  }
  const prUrl = input.prUrl ?? null;
  return {
    kind: "native",
    header,
    terminal,
    pane,
    pr: prUrl ? { url: prUrl, label: prLabel(prUrl) } : null,
    ask,
    live: working && !ask,
    tail: tailRows(input.tail, working && !ask),
    asked: prompt && !sameText(prompt, title) ? prompt : null,
    last,
    history: historyOf(
      turnsRead.rows.length ? turnLines(turnsRead.rows) : threadLines(target.conversationId ? threadRows(input.messages ?? []) : []),
      last,
    ),
    // Only what the header does not say: host, branch, harness, where it lives and its state are above.
    facts: factRows([
      ["Model", modelName(session?.model)],
      ["Folder", session?.cwd ? tilde(session.cwd) : null],
      ["Session", target.sessionRef],
    ]),
    touched: touchedView,
    reply,
    delivery,
    revealBy: { sessionId: touched?.sessionId ?? observe?.sessionId ?? target.sessionId, agentId: touched?.agentId ?? observe?.agentId ?? null, basePath: touched?.worktreePath ?? null },
  };
}

// ── the engage panel's history ───────────────────────────────────────────

/** One line of talk: yours or its, and when (null when the source has no wall time). */
export type TapInLine = { id: string; you: boolean; text: string; at: number | null };

/** Each prompt (yours) and what it said after it, oldest first. */
export function turnLines(turns: readonly TapInTurnRead[]): TapInLine[] {
  return turns.flatMap((turn): TapInLine[] => [
    { id: `${turn.id}:you`, you: true, text: turn.prompt, at: turn.at },
    ...(turn.answer ? [{ id: `${turn.id}:it`, you: false, text: turn.answer, at: null }] : []),
  ]);
}

/** A thread's rows as lines, oldest first. */
export function threadLines(rows: readonly TapInThreadRow[]): TapInLine[] {
  return rows.map((r) => ({ id: r.id, you: r.you, text: r.body, at: r.at }));
}

/**
 * The last few lines (TAP_IN_SIZE.HISTORY), ending on what it said last when
 * the lines do not already: its newest words replace an older answer of its
 * own at the end, or follow your last line. Never less than the row says.
 */
export function historyOf(lines: readonly TapInLine[], said: TapInSaid | null, max: number = TAP_IN_SIZE.HISTORY): TapInLine[] {
  const out = lines.filter((l) => l.text.trim());
  if (said?.text.trim() && !out.some((l) => !l.you && sameText(l.text, said.text))) {
    const end = out.at(-1);
    const line = { id: "said", you: false, text: said.text, at: said.at };
    // Said before your last line, it answered an earlier one: the lines already end where they should.
    const newer = !end || said.at === null || end.at === null || said.at >= end.at;
    if (newer && end && !end.you) out[out.length - 1] = { ...line, id: end.id };
    else if (newer) out.push(line);
  }
  return out.slice(-max);
}

/**
 * Facts with a value, trimmed; a label once, and a value once (the row's
 * Agent is its Owner). A value the panel already says above (shown: its
 * title) is not said again.
 */
export function factRows(rows: ReadonlyArray<readonly [string, string | null | undefined]>, shown: readonly string[] = []): Array<[string, string]> {
  const seen = new Set<string>();
  const said = new Set(shown.map((v) => v.trim().toLowerCase()));
  const out: Array<[string, string]> = [];
  for (const [k, v] of rows) {
    const value = v?.trim();
    if (!value || seen.has(k) || said.has(value.toLowerCase())) continue;
    seen.add(k);
    said.add(value.toLowerCase());
    out.push([k, value]);
  }
  return out;
}

// ── Scout work ───────────────────────────────────────────────────────────

export type TapInThreadRow = { id: string; who: string; you: boolean; body: string; at: number };

export type TapInWorkView = {
  kind: "work";
  header: TapInHeader;
  /** An output or a blocker; a question is the request block instead. */
  callout: CompanionCallout | null;
  /** The newest thing the work said, whole, when there is no callout to say it: its last report, else the owner in the thread, else the row's line. */
  last: TapInSaid | null;
  /** The last few lines of the thread, oldest first, ending on what it said last (historyOf). */
  history: TapInLine[];
  /** What is going on, as label and value: who has it, harness, project, branch, and the work's own facts. */
  facts: Array<[string, string]>;
  ask: TapInAsk | null;
  /** Its steps are live while the row reads WORKING and no ask holds it, as a native session's. */
  live: boolean;
  /** The steps of the session its flight traced (tailSessionOf). */
  tail: TapInTailRow[];
  asked: { task: string; from: string; to: string } | null;
  made: MadeLink[];
  /** Stop work: cancels the work's own ask (its primary invocation's flight) while it runs; `agent` is who it was asked of. */
  stop: { conversationId: string; flightId: string; agent: string } | null;
  /**
   * Hear when it is done (core Ready): the same running flight Stop names, and whether it is marked now.
   * Absent once it finished: the runtime refuses the mark then.
   */
  notify: { flightId: string; on: boolean } | null;
  reply: TapInReply;
  owner: string;
};

export type TapInWorkInput = {
  target: TapInWorkTarget;
  thread: CornerThread;
  detail: WorkDetail | null;
  messages: readonly Message[];
  tail: readonly TailEvent[];
  now: number;
  /** The row's remark as the board shows it: its steps are live only while it reads WORKING. */
  remark?: string;
};

/**
 * A thread's messages, oldest first, without status and system lines, except
 * a broker notice that an agent could not reply (it says why, and is often
 * the only thing the row tells you): that one reads as Scout's, in plain words.
 */
export function threadRows(messages: readonly Message[]): TapInThreadRow[] {
  const rows: TapInThreadRow[] = [];
  for (const m of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!m.body.trim()) continue;
    if (m.class === "status" || m.class === "system") {
      const notice = isNoisyConversationStatusMessage(m) ? null : conversationFailureNotice(m);
      if (notice) {
        const lead = `${conversationalTargetLabel(notice.target)} couldn’t reply.`;
        rows.push({ id: m.id, who: "Scout", you: false, body: notice.technicalDetail ? `${lead} ${notice.technicalDetail}` : `${lead} ${notice.explanation}`, at: m.createdAt });
      }
      continue;
    }
    const you = m.actorId === "operator" || m.class === "operator";
    rows.push({ id: m.id, who: you ? "you" : m.actorName ?? m.actorId, you, body: m.body.trim(), at: m.createdAt });
  }
  return rows;
}

/** A flight past its turn: Ready is decided for it already, so the mark is refused (core 409). */
const FLIGHT_FINISHED = new Set(["completed", "failed", "cancelled"]);

export function workView(input: TapInWorkInput): TapInWorkView {
  const { target, thread: t, detail, now } = input;
  const request = target.request;
  const inv = detail?.primaryInvocation ?? null;
  const owner = detail?.ownerName ?? request?.agentName ?? t.handle;
  const card = detail ? buildCompanionCard(detail, { now, live: true, tail: input.tail, tailMatched: input.tail.length > 0, project: t.project ?? null, harness: t.harness ?? null }) : null;
  // Ready waits on the operator, but nothing is being asked.
  const asking = (Boolean(request) && !(request && isReadyRequest(request))) || card?.state === "question";
  const header: TapInHeader = {
    speaker: rowSpeaker(t),
    project: t.project ?? null,
    title: detail?.title ?? (request ? request.title : t.task),
    titleHint: detail?.id ?? request?.id ?? null,
    harness: t.harness ?? card?.harness ?? null,
    where: [t.project, t.branch].filter(Boolean).join(" · "),
    lives: "",
  };
  const ask = request ? askFromItem(request) : null;
  const live = (input.remark ?? remarkOf(t)) === "WORKING" && !asking;
  // Only the work's own ask stops: its primary invocation's flight, while it runs. Never another flight in the channel.
  const flight = inv?.flightId ? detail?.activeFlights.find((f) => f.id === inv.flightId) ?? null : null;
  const stopConversation = flight?.conversationId ?? detail?.conversationId ?? null;
  const conversationId = t.conversationId ?? detail?.conversationId ?? request?.conversationId ?? null;
  // The ask itself is Asked: a thread that relays it is not what the work said.
  const askedText = clean(inv?.task);
  const thread = conversationId ? threadRows(input.messages).filter((m) => !askedText || clean(m.body) !== askedText) : null;
  // Its own report first: a conversation can carry more than one work, so the thread's newest line may be another's.
  const reported = card?.reported.at(-1) ?? null;
  const said = thread ? [...thread].reverse().find((m) => !m.you) ?? null : null;
  const rowLine = clean(t.now);
  const last = reported && detail ? { text: fullReport(detail, reported.text), at: reported.at }
    : said ? { text: said.body, at: said.at }
      : rowLine ? { text: rowLine, at: t.at } : null;
  return {
    kind: "work",
    header,
    // A question is the request block when there is one to show; without one, its callout says it.
    callout: detail && card?.callout && !(card.callout.tone === "question" && ask) ? { ...card.callout, text: fullReport(detail, card.callout.text) } : null,
    last,
    history: historyOf(threadLines(thread ?? []), last),
    facts: factRows([
      ["Owner", owner],
      ["Harness", header.harness],
      ["Project", t.project],
      ["Branch", t.branch],
      ["Work", detail?.id ?? t.workId],
      ...t.facts,
    ], [header.title]),
    ask,
    live,
    tail: tailRows(input.tail, live),
    asked: inv ? { task: tildeAll(inv.task), from: inv.requesterName ?? inv.requesterId ?? "you", to: inv.targetAgentName ?? inv.targetAgentId ?? owner } : null,
    made: detail ? madeLinks(detail) : [],
    stop: flight && stopConversation ? { conversationId: stopConversation, flightId: flight.id, agent: flight.agentName ?? inv?.targetAgentName ?? owner } : null,
    notify: flight && !FLIGHT_FINISHED.has(flight.state) ? { flightId: flight.id, on: flight.notify === true } : null,
    reply: conversationId ? { open: true, placeholder: `Reply to ${owner} in the thread` } : { open: false, placeholder: "Reply" },
    owner,
  };
}

// ── where it sits ────────────────────────────────────────────────────────

export type TapInRect = { left: number; top: number; right: number; bottom: number };
export type TapInBox = { left: number; top: number; width: number; height: number };
/** Which edge of the panel faces the board: it grows out of that edge and folds back into it. */
export type TapInEdge = "left" | "right" | "top" | "bottom";
/**
 * Beside the board the panel fits what it holds, never past the box. It hangs
 * from the box's top (`grow: "down"`) or stands on its bottom (`"up"`); at its
 * row (engagePlacement) it is never shorter than `min`, 0 there.
 */
export type TapInFit = { min: number; grow: "down" | "up" };
export type TapInPlacement = { mode: "beside" | "stack" | "notch"; from: TapInEdge; box: TapInBox; fit?: TapInFit };

/**
 * On a notch the panel is the notch grown: it hangs from the board's free edge
 * with no gap, centred on it, as wide as the board (never narrower than the
 * panel's own width), so the two draw as one shape. `edge` is the screen edge
 * the notch hangs from; the panel grows away from it, and fits what it holds.
 */
export function notchPlacement(board: TapInRect, view: { width: number; height: number }, edge: TapInEdge, extent: number = TAP_IN_SIZE.WIDTH): TapInPlacement {
  const { INSET } = TAP_IN_SIZE;
  const WIDTH = extent;
  const boardW = board.right - board.left;
  const boardH = board.bottom - board.top;
  const across = (start: number, length: number, extent: number, room: number) => {
    const size = Math.min(Math.max(length, extent), room - 2 * INSET);
    const at = Math.round(start + length / 2 - size / 2);
    return { at: Math.max(INSET, Math.min(at, room - INSET - size)), size };
  };
  if (edge === "top" || edge === "bottom") {
    const { at: left, size: width } = across(board.left, boardW, WIDTH, view.width);
    return edge === "top"
      ? { mode: "notch", from: "top", box: { left, top: board.bottom, width, height: Math.max(0, view.height - INSET - board.bottom) }, fit: { min: 0, grow: "down" } }
      : { mode: "notch", from: "bottom", box: { left, top: INSET, width, height: Math.max(0, board.top - INSET) }, fit: { min: 0, grow: "up" } };
  }
  // On a side edge it is as tall as the notch, which grows along the edge to hold it (ArrivalsBoard's notchTall).
  const { at: top, size: height } = across(board.top, boardH, 0, view.height);
  return edge === "left"
    ? { mode: "notch", from: "left", box: { left: board.right, top, width: Math.min(WIDTH, view.width - INSET - board.right), height }, fit: { min: height, grow: "down" } }
    : { mode: "notch", from: "right", box: { left: Math.max(INSET, board.left - WIDTH), top, width: Math.min(WIDTH, board.left - INSET), height }, fit: { min: height, grow: "down" } };
}

/**
 * Beside the board, toward the screen's centre, top-aligned: the box is the
 * most it can take (the board's height, min 420), and the panel fits within it
 * (TapInFit). With no room beside (stack mode, or a narrow view), it opens
 * above the board at the board's width (below, for a board at the top).
 */
export function tapInPlacement(board: TapInRect, view: { width: number; height: number }, opts: { stack?: boolean } = {}): TapInPlacement {
  const { WIDTH, MIN_H, GAP, INSET } = TAP_IN_SIZE;
  const boardW = board.right - board.left;
  const boardH = board.bottom - board.top;
  const toLeft = board.left + boardW / 2 > view.width / 2;
  const left = toLeft ? board.left - GAP - WIDTH : board.right + GAP;
  const fits = toLeft ? left >= INSET : left + WIDTH <= view.width - INSET;
  if (!opts.stack && fits) {
    const height = Math.min(Math.max(boardH, MIN_H), Math.max(0, view.height - 2 * INSET));
    // Top-aligned when it fits below the board's top; otherwise it shares the board's bottom edge.
    const aligned = board.top + height <= view.height - INSET ? board.top : board.bottom - height;
    const top = Math.max(INSET, Math.min(aligned, view.height - INSET - height));
    const fit: TapInFit = { min: Math.min(boardH, height), grow: aligned === board.top ? "down" : "up" };
    return { mode: "beside", from: toLeft ? "right" : "left", box: { left, top, width: WIDTH, height }, fit };
  }
  const above = board.top + boardH / 2 > view.height / 2;
  const room = Math.max(0, above ? board.top - GAP - INSET : view.height - INSET - board.bottom - GAP);
  const height = Math.min(MIN_H, room);
  return {
    mode: "stack",
    from: above ? "bottom" : "top",
    box: { left: board.left, top: above ? board.top - GAP - height : board.bottom + GAP, width: boardW, height },
  };
}

/** The tether's notch (pt): how far it reaches toward the board, half its height, and how far it keeps from the panel's corners. */
export const TAP_IN_NOTCH = { DEPTH: 7, HALF: 7, CLEAR: 12 };
/**
 * The tether: a notch on the panel's board-facing edge, pointing at the tapped
 * row, as a popover's arrow points at what it is about. Its box overlaps the
 * panel's 1 px edge so the notch and the panel draw as one shape. `point` is
 * the way it points; `near` the panel end it sits nearer (its fill follows the
 * panel's face there).
 */
export type TapInNotch = TapInBox & { point: "left" | "right"; near: "top" | "bottom" };

/** The notch at the tapped row's height. None in stack mode (the row's ring says which), or when the row's centre is off the panel's straight edge. */
export function tapInTether(row: TapInRect, placement: TapInPlacement): TapInNotch | null {
  if (placement.mode !== "beside" || (placement.from !== "left" && placement.from !== "right")) return null;
  const { DEPTH, HALF, CLEAR } = TAP_IN_NOTCH;
  const { box } = placement;
  const y = Math.round((row.top + row.bottom) / 2);
  if (y - HALF < box.top + CLEAR || y + HALF > box.top + box.height - CLEAR) return null;
  const point = placement.from === "left" ? "left" : "right";
  const left = point === "left" ? box.left - DEPTH : box.left + box.width - 1;
  return { left, top: y - HALF, width: DEPTH + 1, height: 2 * HALF, point, near: placement.fit?.grow === "up" ? "bottom" : "top" };
}

// ── keys ─────────────────────────────────────────────────────────────────

export type TapInKeyAction = "close" | "allow" | "primary" | "quick" | "prev" | "next" | "toggle" | "type";

/**
 * What a key does on the board while it can tap in: ↑/↓ move the selection
 * (the panel follows), Return opens or closes, ⌘O the primary place, ⌘↩
 * allows on an ask, Esc closes, and typing goes to the reply line.
 *
 * ⌘↩ never reaches the board from the reply line (it would allow a command
 * while you type a reply), never repeats (a held key allows once), and never
 * overrides a focused chip in the request block (`askControl`): with Deny
 * focused, ⌘↩ is that chip's Enter, not Allow.
 *
 * The engage panel opens with its reply line focused; while that line is
 * empty (`emptyReply`), ↑/↓ still walk the board.
 */
export function tapInKeyAction(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean }, at: { tag: string; open: boolean; askControl?: boolean; emptyReply?: boolean }): TapInKeyAction | null {
  const typing = at.tag === "INPUT" || at.tag === "TEXTAREA";
  const control = typing || ["BUTTON", "A", "SUMMARY", "SELECT", "PRE"].includes(at.tag);
  if (e.key === "Escape") return at.open || typing ? "close" : null;
  if (e.key === "Enter" && e.metaKey) return at.open && !typing && !at.askControl && !e.repeat ? "allow" : null;
  if (e.metaKey && e.key.toLowerCase() === "o") return at.open ? "primary" : null;
  if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "t") return at.open ? "quick" : null;
  if (typing && at.open && at.emptyReply && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === "ArrowDown") return "next";
    if (e.key === "ArrowUp") return "prev";
  }
  if (typing) return null;
  if (e.key === "ArrowDown") return "next";
  if (e.key === "ArrowUp") return "prev";
  if (e.key === "Enter" && !control) return "toggle";
  if (at.open && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !(control && e.key === " ")) return "type";
  return null;
}

/** The terminal app a focus brought forward, as the server verified it. */
export type FocusedApp = { pid: number; bundleId: string };

/** Read it from a focus reply; null when the reply names no app to point at. */
export function focusedApp(result: SessionFocusResult): FocusedApp | null {
  const terminal = result.target && "terminal" in result.target ? result.target.terminal : undefined;
  const pid = terminal?.appPid;
  const bundleId = terminal?.bundleId;
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 && bundleId ? { pid, bundleId } : null;
}
