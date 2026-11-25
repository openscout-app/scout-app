import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { HarnessMark, harnessLabel, harnessTint } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import type { AgentObservePayload, Flight, ObserveEvent } from "../../lib/types.ts";
import { normalizeTimestampMs } from "../../lib/time.ts";
import { LaneTraceModeToggle } from "../sessions/SessionObserve.tsx";
import { sessionWorkLabel } from "../sessions/session-turns.ts";
import { readTurnBeats, type TurnBeatsView } from "./turn-beats.ts";
import { TurnBeatList, TurnDoneLine, TurnNow } from "./TurnBeats.tsx";
import { TurnChangedFiles, TurnEndLine, TurnRunList } from "./TurnRuns.tsx";
import {
  turnStepsToObserveEvents,
  turnTraceEvents,
  type TurnLaunchPhase,
  type TurnStep,
} from "./turn-steps.ts";
import "./session-turn-work.css";

export function SessionHeader({ project, title, agentName, harness, conversationId }: {
  project: string | null; title: string; agentName: string; harness?: string | null; conversationId: string;
}) {
  return <header className="s-session-header s-session-header--band">
    {project && <><span className="s-session-project">{project}</span><span className="s-session-sep" aria-hidden="true">/</span></>}
    <strong title={title}>{title.replace(/\/Users\/[^/]+/g, "~").split("\n")[0]}</strong>
    <span className="s-session-agent">{harness && <HarnessMark harness={harness} size={14} />}{agentName}</span>
    <details className="s-session-menu"><summary aria-label="Session options">⋯</summary><div>Chat id <code>{conversationId}</code></div></details>
  </header>;
}

/** What the head band says about the turn: one state, never a stack of them. */
export type SessionHeadState =
  | { kind: "working"; startedAt: number | null }
  | { kind: "request"; approval: boolean }
  | { kind: "finished"; at: number | null };

/** A clock time, as the head band and the operator's bubble show it. */
export function sessionClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The embedded session's head: who and where, said once. The host's title
 * bar keeps the agent's name and the composer carries no runtime line, so
 * model, effort, host and path live here only.
 */
export function SessionHeadBand({
  title,
  harness,
  model,
  effort,
  hostName,
  workspaceRoot,
  state,
  conversationId,
  onOpenSession,
}: {
  title: string;
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
  hostName?: string | null;
  workspaceRoot?: string | null;
  state: SessionHeadState | null;
  conversationId: string;
  onOpenSession?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const working = state?.kind === "working";
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [working]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const path = workspaceRoot?.trim() || null;
  const shortPath = path?.replace(/^\/Users\/[^/]+/, "~") ?? null;
  const host = hostName?.trim().replace(/\.local$/i, "") || null;
  const facts = [model?.trim(), effort?.trim(), host].filter((fact): fact is string => Boolean(fact));
  const tint = harnessTint(harness);
  const cleanTitle = title.replace(/\/Users\/[^/]+/g, "~").split("\n")[0] ?? title;

  return <header className="s-session-head">
    {harness && <span
      className="s-session-head-coin"
      style={tint ? { color: tint } : undefined}
      title={harnessLabel(harness)}
    ><HarnessMark harness={harness} size={11} /></span>}
    <div className="s-session-head-text">
      <div className="s-session-head-title" title={cleanTitle}>{cleanTitle}</div>
      {(facts.length > 0 || shortPath) && <div className="s-session-head-meta">
        {facts.map((fact) => <span key={fact}>{fact}</span>)}
        {path && shortPath && <button
          type="button"
          className="s-session-head-path"
          title={`Copy ${path}`}
          onClick={() => void copyTextToClipboard(path).then((ok) => setCopied(ok))}
        >{copied ? "Copied" : shortPath}</button>}
      </div>}
    </div>
    {state && <div className="s-session-head-state" data-state={state.kind} aria-live="polite">
      {state.kind === "working" && <>
        <span className="s-session-head-lamp" aria-hidden="true" />
        Working
        {state.startedAt != null && <span className="s-session-head-clock">{formatTurnDuration((now - state.startedAt) / 1000)}</span>}
      </>}
      {state.kind === "request" && <>
        <span className="s-session-head-wait" aria-hidden="true" />
        {state.approval ? "Your approval" : "Your answer"}
      </>}
      {state.kind === "finished" && (state.at != null ? `Finished ${sessionClockTime(state.at)}` : "Finished")}
    </div>}
    {onOpenSession && <button type="button" className="s-session-head-button" onClick={onOpenSession}>Open session</button>}
    <details className="s-session-menu s-session-head-menu">
      <summary aria-label="Session options">⋯</summary>
      <div>Chat id <code>{conversationId}</code></div>
    </details>
  </header>;
}

// Concise or Details is one per-browser setting for every thread. Concise is
// the default: it keeps a long turn to about a screen. Every turn on the page
// follows the one setting, so a toggle in one turn moves them all.
const TRACE_CONCISE_KEY = "scout.thread.trace-concise";
const conciseListeners = new Set<() => void>();
let conciseOverride: boolean | null = null;

function readTraceConcise(): boolean {
  if (conciseOverride !== null) return conciseOverride;
  try { return localStorage.getItem(TRACE_CONCISE_KEY) !== "0"; } catch { return true; }
}

function subscribeTraceConcise(listener: () => void): () => void {
  conciseListeners.add(listener);
  return () => { conciseListeners.delete(listener); };
}

export function useTraceConcise(): [boolean, (concise: boolean) => void] {
  const concise = useSyncExternalStore(subscribeTraceConcise, readTraceConcise, () => true);
  const set = (next: boolean) => {
    conciseOverride = next;
    try { localStorage.setItem(TRACE_CONCISE_KEY, next ? "1" : "0"); } catch { /* per-browser convenience only */ }
    for (const listener of conciseListeners) listener();
  };
  return [concise, set];
}

/** Concise or Details for every turn in a thread, drawn once in the thread's header. */
export function TraceModeSwitch() {
  const [concise, setConcise] = useTraceConcise();
  return <LaneTraceModeToggle collapseTechnicalEvents={concise} onChange={setConcise} />;
}

export function formatTurnDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3_600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3_600)}h ${Math.floor((total % 3_600) / 60)}m`;
}

export type TurnWorkState = "working" | "worked" | "stopped";

export const TURN_STATE_LEAD: Record<TurnWorkState, string> = {
  working: "Working for",
  worked: "Worked for",
  stopped: "Stopped after",
};

/** A flight the runtime closed as failed or cancelled ended without its answer. */
export function turnWorkState(running: boolean, flight: Pick<Flight, "state"> | null | undefined): TurnWorkState {
  if (running) return "working";
  return flight?.state === "failed" || flight?.state === "cancelled" ? "stopped" : "worked";
}

/** The running turn's line: how long, how many calls, and any failure no rerun has passed. */
export function SessionTurnBar({ lead, view }: { lead: string; view: TurnBeatsView | null }) {
  const calls = view?.calls ?? 0;
  const open = view?.unrecovered ?? 0;
  return <span className="s-turn-bar-line" data-state="working">
    <span className="s-turn-bar-status">{lead}</span>
    {calls > 0 && <span>{calls} {calls === 1 ? "call" : "calls"}</span>}
    {open > 0 && <span className="s-turn-bar-failures">{open} failed</span>}
  </span>;
}

/** A stable disclosure stays in place as observed work becomes a finished turn. */
export function SessionTurnActivity({ working, lead, events, modeToggle = true, startOpen = false }: {
  working: boolean; lead: string; events: ObserveEvent[]; modeToggle?: boolean;
  /** Initially reveal a settled newest turn with no answer; later updates preserve the reader's choice. */
  startOpen?: boolean;
}) {
  const [concise, setConcise] = useTraceConcise();
  const [expanded, setExpanded] = useState(startOpen);
  const [now, setNow] = useState(Date.now());
  const [waiting, setWaiting] = useState(false);
  const view = useMemo(() => readTurnBeats(events, { running: working }), [events, working]);
  const hasWork = view.steps.length + view.beats.length > 0;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => {
    setWaiting(false);
    if (!working || hasWork) return;
    const timer = setTimeout(() => setWaiting(true), 200);
    return () => clearTimeout(timer);
  }, [working, hasWork]);
  return <section className={`s-turn-work s-turn-activity${working ? " s-turn-work--live" : ""}`} data-state={working ? "working" : "worked"} aria-label="Agent work for this turn">
    <div className="s-turn-activity-header">
      <button type="button" className="s-turn-activity-toggle" aria-expanded={expanded} title={expanded ? "Collapse work details" : "Expand work details"} onClick={() => setExpanded((value) => !value)}>
        {working ? <><span className="s-turn-bar-dot" data-narrated={view.live ? "" : undefined} aria-hidden="true" /><SessionTurnBar lead={lead} view={view} /></>
          : <TurnDoneLine lead={lead} state="worked" view={view} />}
        {working && <ChevronRight size={12} className="s-turn-activity-chevron" data-open={expanded ? "" : undefined} aria-hidden="true" />}
      </button>
      {modeToggle && (working || expanded) && <LaneTraceModeToggle collapseTechnicalEvents={concise} onChange={setConcise} />}
    </div>
    {(working || expanded) && <div className={working ? "s-turn-work-beats" : "s-turn-work-body"}>
      {hasWork ? working && concise && !expanded ? <TurnNow view={view} nowMs={now} /> : <TurnBeatList view={view} running={working} expanded={expanded || !concise} nowMs={working ? now : undefined} />
        : waiting && <p className="s-turn-work-empty">Waiting for activity…</p>}
    </div>}
  </section>;
}

/**
 * A running turn: the bar sticks to the top of the thread while the beats
 * grow under it. Concise keeps the newest line, any failure still open and
 * the call it is on; Details keeps every beat, past ones folded.
 */
export function SessionTurnLive({ lead, events, nowMs, emptyLabel, note, onOpenSession, modeToggle = true }: {
  lead: string;
  events: ObserveEvent[];
  /** Accepted for callers that pass the turn's bounds; rows read time from their own events. */
  startedAtMs?: number | null;
  sessionStartMs?: number;
  nowMs?: number;
  /** What to say before the first step lands. */
  emptyLabel?: string;
  /** A line about where the trace comes from, under the bar. */
  note?: ReactNode;
  onOpenSession?: () => void;
  /** Draw Concise and Details on the bar; a thread with one switch for every turn passes false. */
  modeToggle?: boolean;
}) {
  const [concise, setConcise] = useTraceConcise();
  // Live clocks keep moving on their own when the caller does not pass one.
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (typeof nowMs === "number") return;
    const timer = window.setInterval(() => setTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nowMs]);
  const view = useMemo(() => (events.length > 0 ? readTurnBeats(events, { running: true }) : null), [events]);
  const now = nowMs ?? tick;
  const hasWork = Boolean(view && view.steps.length + view.beats.length > 0);
  return <section className="s-turn-work s-turn-work--live" aria-label="Agent work for this turn">
    <div className="s-turn-bar" aria-live="polite">
      <span className="s-turn-bar-dot" aria-hidden="true" />
      <SessionTurnBar lead={lead} view={view} />
      <span className="s-turn-bar-actions">
        {modeToggle && <LaneTraceModeToggle collapseTechnicalEvents={concise} onChange={setConcise} />}
        {onOpenSession && <button type="button" className="s-turn-bar-open" onClick={onOpenSession}>Open session</button>}
      </span>
    </div>
    {note && <p className="s-turn-work-note">{note}</p>}
    {view && hasWork
      ? <div className="s-turn-work-beats">{concise ? <TurnNow view={view} nowMs={now} /> : <TurnBeatList view={view} running nowMs={now} />}</div>
      : <p className="s-turn-work-empty">{emptyLabel ?? "Waiting for the first step."}</p>}
  </section>;
}

/**
 * A finished turn folded to one line above its answer: how long it took, how
 * many calls, what changed and any failure. Opening the line shows the beats,
 * each folded to its calls; Details opens every beat.
 */
export function SessionTurnFold({ state, lead, events, view: given, loading = false, onOpen, modeToggle = true, runs = false }: {
  state: TurnWorkState;
  lead: string;
  events: ObserveEvent[];
  /** The same events already read, when the caller needs them too. */
  view?: TurnBeatsView | null;
  startedAtMs?: number | null;
  sessionStartMs?: number;
  loading?: boolean;
  /** Called when the line opens, to load a trace this page did not see live. */
  onOpen?: () => void;
  /** Draw Concise and Details in the opened turn; a thread with one switch for every turn passes false. */
  modeToggle?: boolean;
  /** Open to the turn read as runs (the agent's lines, each run of calls folded) rather than as beats. */
  runs?: boolean;
}) {
  const [concise, setConcise] = useTraceConcise();
  const [open, setOpen] = useState(false);
  const read = useMemo(() => (given === undefined && events.length > 0 ? readTurnBeats(events, { running: false }) : null), [events, given]);
  const view = given ?? read;
  const lastCall = state === "stopped" ? [...events].reverse().find((event) => event.kind === "tool" && event.tool !== "res") ?? null : null;
  const hasWork = Boolean(view && view.steps.length + view.beats.length > 0);
  return <details className="s-turn-work" data-state={state} onToggle={(event) => {
    const isOpen = event.currentTarget.open;
    setOpen(isOpen);
    if (isOpen) onOpen?.();
  }}>
    <summary><TurnDoneLine lead={lead} state={state} view={view} lastCall={lastCall ? sessionWorkLabel(lastCall) : null} /></summary>
    {open && <div className="s-turn-work-body">
      {hasWork && modeToggle && !runs && <div className="s-turn-work-tools"><LaneTraceModeToggle collapseTechnicalEvents={concise} onChange={setConcise} /></div>}
      {view && hasWork
        ? runs ? <TurnRunList view={view} /> : <TurnBeatList view={view} expanded={!concise} />
        : <p className="s-turn-work-empty">{loading ? "Loading this turn's work." : "No recorded steps for this turn."}</p>}
    </div>}
  </details>;
}

/**
 * One agent turn in a session thread. The live observe poll feeds a running
 * turn, with the tail steps as the fallback when observe is out of reach. A
 * finished turn loads its own bounded trace the first time it opens, or at
 * once when it is the newest turn, so what it made can sit under its answer.
 */
export function SessionTurnWork({
  flight,
  steps = [],
  observe = null,
  running = false,
  startedAt,
  endedAt,
  agentId,
  sessionId,
  launchPhase = null,
  eager = false,
  compact = false,
  harness = null,
  workspaceRoot = null,
  children,
}: {
  /** Start folded to the one "Worked for" line, as older turns do; opening it shows the runs. */
  compact?: boolean;
  /** The session's harness, for its mark on the line that ends the turn. */
  harness?: string | null;
  /** Where the session works, so changed files read relative to it. */
  workspaceRoot?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  flight?: Flight | null;
  /** Tail steps: the live rail, or what this page saw while the turn ran. */
  steps?: TurnStep[];
  /** The live observe poll for the working agent, when there is one. */
  observe?: AgentObservePayload | null;
  running?: boolean;
  startedAt?: number | null;
  endedAt?: number | null;
  launchPhase?: TurnLaunchPhase | null;
  /** Load the finished turn's trace without waiting for its line to open. */
  eager?: boolean;
  /** Accepted for callers that pass it; the page header carries Open session. */
  onOpenSession?: () => void;
  /** The turn's answer. What the turn made renders under it. */
  children?: ReactNode;
}) {
  const [now, setNow] = useState(Date.now());
  const [loaded, setLoaded] = useState<ObserveEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const start = normalizeTimestampMs(startedAt ?? flight?.startedAt);
  const end = normalizeTimestampMs(endedAt ?? flight?.completedAt);
  const liveEvents = useMemo(
    () => (running && observe ? turnTraceEvents(observe.data.events, { startedAt: start, finished: false }) : []),
    [observe, running, start],
  );
  const stepEvents = useMemo(() => turnStepsToObserveEvents(steps, start), [steps, start]);
  // Nothing spins in a finished turn: a call that never returned stays marked as the last call.
  const settled = useMemo(() => {
    const source = loaded && loaded.length > 0 ? loaded : stepEvents;
    return source.map((event) => (event.live ? { ...event, live: false } : event));
  }, [loaded, stepEvents]);
  const view = useMemo(() => (!running && settled.length > 0 ? readTurnBeats(settled, { running: false }) : null), [running, settled]);

  const canLoadWork = Boolean(agentId) && start != null && end != null;
  const elapsedMs = start != null && end != null ? end - start : null;
  const loadWork = async () => {
    if (loaded || loading || !agentId || start == null || end == null) return;
    setLoading(true);
    try {
      const observed = await api<AgentObservePayload>(`/api/agents/${encodeURIComponent(agentId)}/observe${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
      setLoaded(turnTraceEvents(observed.data.events, { startedAt: start, endedAt: end, finished: true }));
    } catch {
      // An unavailable trace is not permission to borrow another turn's.
      setLoaded([]);
    } finally {
      setLoading(false);
    }
  };
  const preload = eager && !running && canLoadWork && (elapsedMs == null || elapsedMs >= 1000);
  useEffect(() => {
    if (preload) void loadWork();
    // The turn's bounds decide the load; loadWork reads them itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preload, agentId, sessionId, start, end]);

  if (!running && start == null) return <>{children}</>;
  const state = turnWorkState(running, flight);
  const duration = formatTurnDuration(((running ? now : end ?? now) - (start ?? now)) / 1000);
  const lead = `${TURN_STATE_LEAD[state]} ${duration}`;

  if (running) {
    return <>
      <SessionTurnRunning
        events={liveEvents.length > 0 ? liveEvents : stepEvents}
        nowMs={now}
        emptyLabel={launchPhase ? `${launchPhase.label}: ${launchPhase.detail}` : undefined}
      />
      {children}
    </>;
  }

  // A finished turn with no steps seen and none to load, or one over in under
  // a second, has no work to fold: "Worked for 0s / No recorded steps" says nothing.
  if (stepEvents.length === 0 && (!canLoadWork || (elapsedMs != null && elapsedMs < 1000))) return <>{children}</>;

  const hasWork = Boolean(view && view.steps.length + view.beats.length > 0);
  // The newest turn reads by runs: the agent's lines in the open, each run of
  // calls one quiet line. An older turn, or one whose work has not loaded,
  // keeps the compact reading: one "Worked for" line that opens to the runs.
  if (!compact && view && hasWork) {
    const lastCall = state === "stopped" ? [...settled].reverse().find((event) => event.kind === "tool" && event.tool !== "res") ?? null : null;
    return <>
      <TurnRunList view={view} />
      {children}
      <TurnChangedFiles view={view} workspaceRoot={workspaceRoot} />
      <TurnEndLine lead={lead} harness={harness} lastCall={lastCall ? sessionWorkLabel(lastCall) : null} />
    </>;
  }

  return <>
    <SessionTurnFold
      state={state}
      lead={lead}
      events={settled}
      view={view}
      startedAtMs={start}
      loading={loading}
      onOpen={() => void loadWork()}
      modeToggle={false}
      runs
    />
    {children}
    {view && <TurnChangedFiles view={view} workspaceRoot={workspaceRoot} />}
  </>;
}

/**
 * A running turn, read by runs: the agent's lines as they land, each run of
 * calls one line, the one still running marked with the accent and its clock.
 */
export function SessionTurnRunning({ events, nowMs, emptyLabel, expanded = false }: {
  events: ObserveEvent[];
  nowMs?: number;
  emptyLabel?: string;
  expanded?: boolean;
}) {
  const view = useMemo(() => (events.length > 0 ? readTurnBeats(events, { running: true }) : null), [events]);
  const hasWork = Boolean(view && view.steps.length + view.beats.length > 0);
  return <section className="s-runs-turn" aria-label="Agent work for this turn" aria-live="polite">
    {view && hasWork
      ? <TurnRunList view={view} expanded={expanded} nowMs={nowMs} />
      : <p className="s-runs-waiting"><span className="s-runs-dot" aria-hidden="true" />{emptyLabel ?? "Waiting for the first step."}</p>}
  </section>;
}
