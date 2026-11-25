import { ArrowDown } from "lucide-react";
import { formatSessionRouteRef, parseSessionRouteRef } from "../../../shared/session-route-ref.ts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { BASIC_WEB } from "../../basic/profile.ts";
import { SessionPromptNavigation } from "./SessionPromptNavigation.tsx";
import { SessionExperiments, useSessionExperiments } from "./SessionExperiments.tsx";
import { quoteInDraft } from "./session-interactions.ts";
import { buildLaneAskDisplay } from "../../lib/lane-ask-display.ts";
import { SESSION_STEER_MAX_LENGTH } from "../../../shared/api/session-steer.ts";
import { sessionDraftStore } from "./session-drafts.ts";
import { HarnessMark, harnessTint } from "../../components/HarnessMark.tsx";
import { Button } from "../../components/ui/button.tsx";
import { SessionSteerComposer, SessionSteeredList, sessionReadOnly, unobservedSteers, type PendingSessionSteer } from "./SessionSteer.tsx";
import type { SessionSteerAvailability, SessionSteerAuditEntry } from "../../../shared/api/session-steer.ts";
import { isAgentInFlight, isAgentInTurn } from "../../lib/agent-state.ts";
import { useTranscriptFollow } from "./use-transcript-follow.ts";
import { api } from "../../lib/api.ts";
import { conversationSessionId } from "../../lib/conversation-kind.ts";
import { useScout } from "../../scout/Provider.tsx";
import { useTurnSteps } from "../chat/use-turn-steps.ts";
import { useRequestActions } from "../requests/use-request-actions.ts";
import type { ObserveEvent, ObserveFile, OperatorAttentionItem, Route } from "../../lib/types.ts";
import { SessionObserveContextRail } from "./SessionObserve.tsx";
import { sessionDetailsHost } from "./session-details-host.ts";
import { useSessionRefLookup } from "./SessionRefScreen.tsx";
import { attentionForSession, boardRowFallbackRef, boardRowQueued, boardRowTask, sessionPageTitle, sessionOrigin, type SessionBoardRow } from "./session-board-model.ts";
import { observedSessionTurns, observedSessionWorking, observedFileEdits, quietSince } from "./session-turns.ts";
import { SessionComputerActivity } from "../activity/ComputerUse.tsx";
import { ObservedThread } from "./ObservedThread.tsx";
import { SessionNameHeading } from "./SessionNameHeading.tsx";
import { refreshSessionBoard } from "./use-session-board.ts";
import { SessionTurnLive, TraceModeSwitch, sessionClockTime } from "../chat/SessionView.tsx";
import { turnStepsToObserveEvents } from "../chat/turn-steps.ts";
import { replyToEndedSession, sendSessionDraft, sessionDeliveryAvailability, sessionInterruptAgent, sessionResumable, sessionTargetFromObserve, sessionSteerPath, sessionSteerPoll, type SessionDeliveryTarget } from "./session-delivery.ts";
import { dataTransferMayContainFiles, readTransferredFiles } from "../../lib/media-blobs.ts";
import { replyText, uploadReplyFiles, type ReplyFile } from "../../lib/reply-files.ts";
import type { SessionDensity, SessionSelection } from "./slot-deck.ts";

function InlineSessionRequest({ item, navigate }: { item: OperatorAttentionItem; navigate: (r: Route) => void }) {
  const { busy, error, sent, answer, act } = useRequestActions(item, (action) => navigate(action.route!));
  const [draft, setDraft] = useState("");
  return <section className="s-session-request" aria-label={item.approval ? "Session approval" : "Session question"} aria-busy={busy}>
    <strong>{item.title}</strong>
    {item.summary && item.summary !== item.title && <p>{item.summary}</p>}
    {item.detail && <pre>{item.detail}</pre>}
    <div className="s-session-actions">
      {item.approval && item.actions.filter((a) => a.kind === "approve" || a.kind === "deny").map((action) =>
        <Button key={action.kind} size="sm" variant="outline" disabled={busy} onClick={() => void act(action)}>{action.kind === "approve" ? "Yes, proceed" : "No"}</Button>)}
      {sent ? <span role="status">Answered: {sent}</span> : item.answer?.options.map((option) =>
        <Button key={option} size="sm" variant="outline" disabled={busy} onClick={() => void answer(option)}>{option}</Button>)}
      {!item.approval && !item.answer && item.actions.filter((a) => a.kind === "open" && a.route).map((action, i) =>
        <Button key={i} size="sm" variant="outline" onClick={() => void act(action)}>{action.label}</Button>)}
    </div>
    {!item.approval && !item.answer && item.kind === "question" && <p>Answer in the live harness. This question has no browser answer endpoint.</p>}
    {item.answer && !sent && <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void answer(draft.trim()); }}>
      <label>Answer<input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} /></label>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !draft.trim()}>Send answer</Button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

type Touched = { files: ObserveFile[]; worktreePath: string | null; counts: { changedFiles: number; readFiles: number } };
function SessionChanges({ sessionRef, refreshKey, events, navigate, remote = false }: { sessionRef: string; refreshKey: number; events: ObserveEvent[]; navigate: (r: Route) => void; remote?: boolean }) {
  const edits = observedFileEdits(events);
  const [result, setResult] = useState<Touched | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (remote) return;
    let cancelled = false;
    void api<Touched>(`/api/session-ref/${encodeURIComponent(sessionRef)}/touched`)
      .then((value) => { if (!cancelled) { setResult(value); setError(null); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [sessionRef, refreshKey, retry, remote]);
  // A remote open reads the summary only. Touched files stay on that host.
  if (remote) return null;
  // Nothing changed reads as nothing: no box while the files load, and none for an empty list.
  if (!error && (!result || result.counts.changedFiles === 0)) return null;
  return <section className="s-session-changes" aria-label="Session changes">
    <header><strong>{result ? `${result.counts.changedFiles} ${result.counts.changedFiles === 1 ? "file" : "files"} changed` : "Changes"}</strong></header>
    {error || !result ? <p role="status">Touched files unavailable: {error} <Button size="xs" variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry</Button></p>
      : <><ul>{result.files.filter((file) => file.state !== "read").map((file) => { const count = edits.get(file.path); return <li key={file.path}><code>{file.path}</code>{count ? <span title="Observed tool edits in this window, not a net worktree diff"><b className="s-session-add">+{count.add}</b> <b className="s-session-del">−{count.del}</b></span> : <span>{file.state}</span>}</li>; })}</ul>
        {!BASIC_WEB && result.worktreePath && result.counts.changedFiles > 0 && <Button size="sm" variant="outline" onClick={() => navigate({ view: "repo-diff", path: result.worktreePath!, sessionId: sessionRef, include: "changed" })}>Review changes</Button>}
        {BASIC_WEB && result.counts.changedFiles > 0 && <p>Full diff review is available in the full web client.</p>}
      </>}
  </section>;
}

export function SessionSlot({ selection, density = "desk", inspector = false, details = false, row, requests, navigate, localNodeId }: {
  selection: SessionSelection;
  density?: SessionDensity;
  localNodeId?: string | null;
  inspector?: boolean;
  /** This slot's details go to a Session details panel docked beside it, when one is there (session-details-host.ts). */
  details?: boolean;
  row?: SessionBoardRow;
  requests: readonly OperatorAttentionItem[];
  navigate: (r: Route) => void;
}) {
  const { agents, operatorName } = useScout();
  const detailsHost = useSyncExternalStore(sessionDetailsHost.subscribe, sessionDetailsHost.host, () => null);
  const toSide = details && detailsHost != null;
  useEffect(() => (toSide ? sessionDetailsHost.occupy() : undefined), [toSide]);
  const [inspectorWidth, setInspectorWidth] = useInspectorWidth();
  const [auditRevision, setAuditRevision] = useState(0);
  const remoteHost = selection.hostLabel?.trim() || undefined;
  // a row another host lists is read on that host
  const remoteMachine = !remoteHost && selection.machineId && localNodeId && selection.machineId !== localNodeId ? selection.machineId : undefined;
  const first = useSessionRefLookup(selection.sessionRef, remoteHost, remoteMachine);
  const conversation = first.lookup?.session ?? row?.conversation ?? null;
  const backing = first.lookup?.kind === "conversation" ? formatSessionRouteRef(conversation?.harness, conversation?.harnessSessionId || conversationSessionId(conversation)) : null;
  const second = useSessionRefLookup(backing && backing !== selection.sessionRef ? backing : "", remoteHost, remoteMachine);
  const direct = first.lookup?.kind === "observe" ? first.lookup : second.lookup?.kind === "observe" ? second.lookup : null;
  // Every listed row opens: when its refs find nothing, the transcript it was listed from does.
  const directSettled = !first.loading && !(backing && backing !== selection.sessionRef && second.loading);
  const fallbackRef = !direct && directSettled ? boardRowFallbackRef(row, [selection.sessionRef, backing]) ?? "" : "";
  const third = useSessionRefLookup(fallbackRef, remoteHost, remoteMachine);
  const resolved = direct ?? (third.lookup?.kind === "observe" ? third.lookup : null);
  const observe = resolved?.observe;
  const data = observe?.data;
  const meta = data?.metadata?.session;
  const agent = agents.find((a) => a.id === (observe?.agentId ?? conversation?.agentId));
  const observed = sessionTargetFromObserve(observe, conversation, selection.machineId, localNodeId, agent);
  const target = remoteHost || remoteMachine
    ? { ...observed, local: false, interruptLocal: false, blockedReason: "This session stays on that machine. This slot is read-only." }
    : observed;
  const sessionId = target.sessionId || parseSessionRouteRef(backing || row?.sessionId || selection.sessionRef)?.refId || selection.sessionRef;
  const agentId = target.agentId;
  const queued = Boolean(agent && agent.harnessSessionId === sessionId && isAgentInFlight(agent.state, agent)) || Boolean(row && boardRowQueued(row));
  const working = observedSessionWorking({ agentTurn: agent && agent.harnessSessionId === sessionId ? isAgentInTurn(agent.state, agent) : null,
    data, source: observe?.source, rowWorking: row ? row.working && !queued : undefined });
  const experiments = useSessionExperiments();
  const [focusDraft, setFocusDraft] = useState(0);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  useEffect(() => { setQuoteError(null); }, [selection.sessionRef, experiments.quote]);
  const follow = useTranscriptFollow(`${selection.machineId ?? "local"}:${selection.sessionRef}`);
  const origin = sessionOrigin({ conversation, requester: observe?.kind === "agent" ? observe.initiatingAsk : null,
    parentSessionId: row?.lane?.facts?.parentSessionId, agents, operatorName });
  const turnSteps = useTurnSteps({ sessionIds: remoteHost || !sessionId ? [] : [sessionId], active: Boolean(working && !remoteHost), perSession: true });
  const tailEvents = useMemo(() => turnStepsToObserveEvents(turnSteps, null), [turnSteps]);
  // Silence describes output freshness; it does not finish a turn or change input behavior.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [working]);
  const quiet = useMemo(() => quietSince([...(data?.events ?? []), ...tailEvents], working, now), [data, tailEvents, working, now]);
  const running = working;
  const turns = useMemo(() => data ? observedSessionTurns(data, running) : [], [data, running]);
  const quote = (text: string) => {
    const store = sessionDraftStore(operatorName ?? "operator", target.machineId ?? undefined, target.sessionRef ?? target.sessionId);
    const next = quoteInDraft(store.read(), text);
    if (next.length > SESSION_STEER_MAX_LENGTH) { setQuoteError("The selected text and draft exceed the message limit. Select a shorter passage."); return; }
    setQuoteError(null); store.write(next); setFocusDraft((n) => n + 1);
  };
  const sessionStartMs = meta?.sessionStart;
  const attention = attentionForSession(requests, [sessionId, observe?.sessionId ?? "", conversation?.sessionId ?? "", selection.sessionRef], conversation?.id, selection.machineId, localNodeId);
  const loading = !directSettled || Boolean(fallbackRef && third.loading);
  const error = resolved ? null : fallbackRef ? third.error : first.error ?? (backing ? second.error : null);
  const state = attention.length ? "waiting" : working ? "working" : queued ? "queued" : loading ? "loading" : error ? "unavailable" : "idle";
  const harness = meta?.adapterType || row?.harness || conversation?.harness;
  const project = meta?.cwd || row?.project || conversation?.workspaceRoot;
  const branch = meta?.gitBranch || row?.branch || conversation?.currentBranch;
  const model = meta?.model || row?.model || conversation?.model;
  const task = (row ? boardRowTask(row) : conversation?.title || "").trim();
  const heading = sessionPageTitle(task, harness, Boolean(row?.named));
  const folder = project?.split("/").filter(Boolean).at(-1) ?? null;
  const title = heading || folder || sessionId.split(":").pop()?.slice(0, 8) || sessionId.slice(0, 8);
  const place = [folder && folder !== title ? folder : null, branch, model].filter(Boolean).join(" · ");
  // the session's details: the ledger rail, with what was sent into it; before the session reads, just what was sent
  const historyKey = `${target.machineId}:${target.sessionRef}`;
  // A session that can't be read has no figures; the details side says so once instead of standing empty.
  const rail = data
    ? <SessionObserveContextRail data={data} sessionId={sessionId} agentId={agentId ?? undefined} surface="context" observeSource={observe?.source} observeFidelity={observe?.fidelity}
        sent={<SessionSteerHistory key={historyKey} target={target} revision={auditRevision} quiet />} />
    : error
      ? <p className="s-session-empty" role="status">No details while this session can't be read.</p>
      : <SessionSteerHistory key={historyKey} target={target} revision={auditRevision} />;
  // A file dragged onto the session goes to its composer, not the page-wide new-task capture:
  // stopping the drag here keeps it from the window listener (ContextCaptureHost).
  const dropTo: SlotDrop = useRef(null);
  const overDepth = useRef(0);
  const [fileOver, setFileOver] = useState(false);
  const claims = (event: ReactDragEvent) => Boolean(dropTo.current) && dataTransferMayContainFiles(event.dataTransfer);
  return <div className={`s-session-slot s-session-slot--${density}${fileOver ? " is-file-over" : ""}`}
    onDragEnter={(event) => { if (!claims(event)) return; event.preventDefault(); event.stopPropagation(); overDepth.current += 1; setFileOver(true); }}
    onDragOver={(event) => { if (!claims(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; }}
    onDragLeave={(event) => { if (!overDepth.current) return; event.stopPropagation(); overDepth.current -= 1; if (!overDepth.current) setFileOver(false); }}
    onDrop={(event) => {
      if (!claims(event)) return;
      event.preventDefault(); event.stopPropagation(); overDepth.current = 0; setFileOver(false);
      const dropped = readTransferredFiles(event.dataTransfer);
      if (dropped.length) dropTo.current?.(dropped);
    }}>
    <div className="s-session-thread">
      <header className="s-session-header">
        <HarnessMark harness={harness ?? "unknown"} size={18} style={{ color: harnessTint(harness) ?? undefined }} />
        <div title={[project, branch, model, origin.label, sessionId].filter(Boolean).join(" · ")}>
          <SessionNameHeading title={title} named={Boolean(row?.named)} selector={sessionId} harness={harness} identity={historyKey} editable={!remoteHost && !remoteMachine} onRenamed={() => void refreshSessionBoard()} />
          {place && <p>{place}</p>}</div>
        <span role="status" data-state={state} title={quiet != null ? `No new output since ${sessionClockTime(quiet)}. The session is still active.` : undefined}>
          {quiet != null && state === "working" ? "Working · quiet" : state[0]!.toUpperCase() + state.slice(1)}</span>
        {experiments.navigation && <SessionPromptNavigation portRef={follow.scrollRef} contentRef={follow.contentRef} revision={data?.events.length ?? 0} pause={follow.pause} />}
        {data && <TraceModeSwitch />}
        <SessionExperiments />
      </header>
      <SessionComputerActivity key={selection.sessionRef} data={data?.computerUse} />
      <div className="s-session-feed">
        <div className="s-session-transcript s-observe--conversation" ref={follow.scrollRef} onScroll={follow.onScroll}>
          <div ref={follow.contentRef}>
            {loading && !data && <p role="status">Resolving this session…</p>}
            {error && <p className="s-session-unavailable" role="status">This session can't be read right now ({error}). <Button size="xs" variant="outline" onClick={() => void (fallbackRef ? third.refresh() : backing ? second.refresh() : first.refresh())}>Retry session</Button></p>}
            {!loading && !data && !error && <p>No observed transcript is attached to this reference.</p>}
            {data && <ObservedThread data={data} working={running} timestamped={observe?.fidelity === "timestamped"} sessionStartMs={sessionStartMs} modeToggle={false} onQuote={experiments.quote && !target.blockedReason ? quote : undefined} visuals={experiments.visuals} />}
            {running && tailEvents.length > 0 && !turns.some((turn) => turn.working) && <SessionTurnLive lead="Working" events={tailEvents} modeToggle={false} />}
            {attention.map((item) => <InlineSessionRequest key={`${item.id}:${item.approval?.version ?? item.updatedAt}`} item={item} navigate={navigate} />)}
            {data && !toSide && <SessionChanges sessionRef={observe?.refId ?? selection.sessionRef} refreshKey={observe?.updatedAt ?? 0} events={data.events} navigate={navigate} remote={Boolean(remoteHost)} />}
          </div>
        </div>
        {!follow.following && <Button className="s-session-jump" size="sm" variant="outline" onClick={follow.jump}><ArrowDown size={13} aria-hidden />Jump to latest</Button>}
      </div>
      {quoteError && <p className="s-session-quote-error" role="status">{quoteError}</p>}
      <SessionSlotComposer key={`${target.machineId}:${target.sessionRef}`} target={target} working={working} loaded={Boolean(resolved)}
        prompts={turns.flatMap((turn) => turn.prompt)} recall={experiments.recall} focusDraft={focusDraft} onAttempt={() => setAuditRevision((n) => n + 1)} dropTo={dropTo} />
    </div>
    {toSide ? createPortal(rail, detailsHost!) : inspector && <>
      <InspectorResizeHandle width={inspectorWidth} onWidth={setInspectorWidth} />
      <aside className="s-session-inspector" style={{ width: inspectorWidth, flexBasis: inspectorWidth }}>{rail}</aside>
    </>}
  </div>;
}

// The inspector's width is one per-browser preference shared by every slot.
const INSPECTOR_WIDTH_KEY = "scout.sessions.inspector-width";
const INSPECTOR_DEFAULT = 260, INSPECTOR_MIN = 220, INSPECTOR_MAX = 560;
const clampInspector = (w: number) => Math.round(Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, w)));

function useInspectorWidth(): [number, (w: number, persist?: boolean) => void] {
  const [width, setWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY)); return saved ? clampInspector(saved) : INSPECTOR_DEFAULT; }
    catch { return INSPECTOR_DEFAULT; }
  });
  const set = (w: number, persist = true) => {
    const next = clampInspector(w);
    setWidth(next);
    if (persist) try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(next)); } catch { /* per-browser convenience only */ }
  };
  return [width, set];
}

function InspectorResizeHandle({ width, onWidth }: { width: number; onWidth: (w: number, persist?: boolean) => void }) {
  const [dragging, setDragging] = useState(false);
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget, x0 = event.clientX, w0 = width;
    let last = w0;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    // the handle sits on the inspector's left edge: dragging left widens it
    const move = (e: PointerEvent) => { last = w0 + (x0 - e.clientX); onWidth(last, false); };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
      onWidth(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  return <div className="s-session-inspector-edge"><div className={`s-session-inspector-resize${dragging ? " is-dragging" : ""}`} role="separator" aria-orientation="vertical"
    aria-label="Resize the inspector" aria-valuenow={width} aria-valuemin={INSPECTOR_MIN} aria-valuemax={INSPECTOR_MAX} tabIndex={0}
    title="Drag to resize · double-click to reset"
    onPointerDown={start}
    onDoubleClick={() => onWidth(INSPECTOR_DEFAULT)}
    onKeyDown={(e) => {
      const step = e.shiftKey ? 40 : 10;
      if (e.key === "ArrowLeft") { e.preventDefault(); onWidth(width + step); }
      else if (e.key === "ArrowRight") { e.preventDefault(); onWidth(width - step); }
      else if (e.key === "Home") { e.preventDefault(); onWidth(INSPECTOR_DEFAULT); }
    }} /></div>;
}

function SessionSteerHistory({ target, revision, quiet = false }: { target: SessionDeliveryTarget; revision: number; quiet?: boolean }) {
  const [entries, setEntries] = useState<SessionSteerAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = sessionSteerPath(target).replace("/steer?", "/steer/audit?");
  // No log to ask for until the session's ref resolves: an empty ref only earns a 404.
  // A session that stays on another host is not steered from here.
  const resolved = Boolean(target.sessionRef) && !target.blockedReason;
  useEffect(() => {
    if (!resolved) return;
    const poll = sessionSteerPoll(() => api<{ entries: SessionSteerAuditEntry[] }>(path),
      (value) => { setEntries(value.entries); setError(null); }, () => setError("The delivery log is unavailable."));
    void poll.refresh(); const timer = setInterval(() => void poll.refresh(), 10_000);
    return () => { poll.stop(); clearInterval(timer); };
  }, [path, revision, resolved]);
  // Unresolved, nothing is asked for, so there is nothing to wait on: no endless "Loading…".
  if (target.blockedReason || !resolved) return null;
  return <SessionSteeredList entries={entries} error={error} quiet={quiet} />;
}

/** Where a file dropped anywhere on the slot goes: the composer, while it takes input. */
type SlotDrop = MutableRefObject<((files: File[]) => void) | null>;

const FILES_HERE_ONLY = "Files reach only a session on this host.";

function SessionSlotComposer({ target, working, loaded, prompts, onAttempt, dropTo, recall, focusDraft }: {
  target: SessionDeliveryTarget; working: boolean; loaded: boolean; prompts: ObserveEvent[]; onAttempt: () => void; dropTo: SlotDrop; recall: boolean; focusDraft: number;
}) {
  const { agents, operatorName } = useScout();
  const store = sessionDraftStore(operatorName ?? "operator", target.machineId ?? undefined, target.sessionRef ?? target.sessionId);
  const draft = useSyncExternalStore(store.subscribe, store.read, () => "");
  const [pendingAction, setPendingAction] = useState<"send" | "stop" | null>(null);
  const busy = pendingAction !== null;
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSessionSteer[]>([]);
  const [live, setLive] = useState<SessionSteerAvailability | null>(null);
  const [revision, setRevision] = useState(0);
  const path = sessionSteerPath(target);
  useEffect(() => {
    if (!loaded || target.blockedReason) return;
    const poll = sessionSteerPoll(() => api<SessionSteerAvailability>(path), setLive,
      () => setLive({ available: false, code: "unavailable", reason: "Live delivery is unavailable. Checking again shortly…", target: null }));
    void poll.refresh(); const timer = setInterval(() => void poll.refresh(), 10_000);
    return () => { poll.stop(); clearInterval(timer); };
  }, [path, loaded, target.blockedReason, revision]);
  const [files, setFiles] = useState<ReplyFile[]>([]);
  const [attaching, setAttaching] = useState(0);
  const [fileNote, setFileNote] = useState<string | null>(null);
  // Nothing holds the session and it is on this host: the line stays, and a reply resumes it.
  const resumable = loaded && sessionResumable(target, live);
  const availability = resumable ? { available: true, reason: "" } : sessionDeliveryAvailability(target, live);
  const canSend = loaded && availability.available;
  const closed = sessionReadOnly(target.blockedReason, live, resumable);
  const interruptAgent = working ? sessionInterruptAgent(target, agents.find((a) => a.id === target.agentId)) : null;
  const attach = async (incoming: File[]) => {
    if (!target.local) { setFileNote(FILES_HERE_ONLY); return; }
    setFileNote(null); setAttaching((n) => n + 1);
    try {
      const uploaded = await uploadReplyFiles(incoming);
      setFiles((held) => [...held, ...uploaded.filter((file) => !held.some((h) => h.id === file.id))]);
    } catch (cause) { setFileNote(cause instanceof Error ? cause.message : String(cause)); }
    finally { setAttaching((n) => n - 1); }
  };
  // A drop on the slot is this composer's while it takes input; otherwise the page-wide capture has it.
  useEffect(() => {
    const take = loaded && !closed ? (dropped: File[]) => void attach(dropped) : null;
    dropTo.current = take;
    return () => { if (dropTo.current === take) dropTo.current = null; };
  });
  const submit = async () => {
    if (inFlight.current || !canSend || attaching || (!draft.trim() && !files.length)) return;
    const reply = replyText(draft, files);
    if (!reply.ok) { setError(reply.reason); return; }
    const sentDraft = draft, sentFiles = files;
    const settle = () => { store.clearIfUnchanged(sentDraft); setFiles((held) => held.filter((file) => !sentFiles.includes(file))); };
    inFlight.current = true; setPendingAction("send"); setError(null); setStatus(null);
    try {
      if (resumable) {
        const clientMessageId = crypto.randomUUID();
        const sent = await replyToEndedSession(target, reply.text, clientMessageId);
        if (!sent.ok) throw new Error(sent.reason);
        settle();
        // Typed in where it was open reads back verbatim; a resumed session's transcript says it.
        if (sent.inPlace) setPending((items) => [...unobservedSteers(items, prompts), { id: clientMessageId, text: reply.text, duringTurn: false, observedIds: prompts.map((p) => p.id) }]);
        setStatus(sent.inPlace ? null : "Reply sent to resume the session.");
      } else {
        const receipt = await sendSessionDraft(target, reply.text);
        if (!receipt.ok) throw new Error(receipt.audit.reason);
        settle();
        setPending((items) => [...unobservedSteers(items, prompts), { id: receipt.audit.id, text: reply.text, duringTurn: working, observedIds: prompts.map((p) => p.id) }]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLive(null); }
    finally { inFlight.current = false; setPendingAction(null); setRevision((v) => v + 1); onAttempt(); }
  };
  const interrupt = async () => {
    if (!interruptAgent || inFlight.current) return;
    inFlight.current = true; setPendingAction("stop"); setError(null); setStatus(null);
    try {
      await api(`/api/agents/${encodeURIComponent(interruptAgent.id)}/interrupt`, { method: "POST", body: JSON.stringify({ expectedSessionId: target.sessionId }) });
      setStatus("Interrupt requested for the live session.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setPendingAction(null); }
  };
  return <SessionSteerComposer focusDraft={focusDraft} recallHistory={recall ? prompts.map((event) => buildLaneAskDisplay(event).operatorWords).filter((text): text is string => !!text) : undefined} draft={draft} onChange={store.write} submit={() => void submit()}
    interrupt={interruptAgent ? () => void interrupt() : null} working={working} busy={busy} sending={pendingAction === "send"} available={canSend}
    reason={availability.reason} readOnly={target.blockedReason ? closed : (!loaded || draft.trim() || files.length ? null : closed)} pending={unobservedSteers(pending, prompts)} error={error} status={status}
    placeholder={resumable ? "Reply to resume the session" : undefined}
    files={{ files, attaching, note: fileNote, remove: (id) => setFiles((held) => held.filter((file) => file.id !== id)), paste: (pasted) => void attach(pasted) }} />;
}
