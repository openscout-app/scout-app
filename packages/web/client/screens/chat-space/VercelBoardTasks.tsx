import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { HarnessMark } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { LOCAL_HOST_ID } from "../../lib/hosts/host-client.ts";
import { hostFleet } from "../../lib/hosts/host-fleet.ts";
import { isBrokerReconcileEvent, useBrokerEvents, type BrokerEvent } from "../../lib/sse.ts";
import {
  applyVercelBoardHandoff,
  foldVercelBoardJobs,
  groupVercelBoardRuns,
  vercelBoardStages,
  vercelBoardSummary,
  type VercelBoardHandoff,
  type VercelBoardJob,
  type VercelBoardJobState,
  type VercelBoardMirrorState,
  type VercelBoardRoomData,
  type VercelBoardRun,
  type VercelBoardWho,
} from "../../../shared/vercel-board-jobs.ts";
import { BoardTaskReview } from "./BoardTaskReview.tsx";
import { boardTaskSession } from "./board-task-session-slot.ts";
import "./vercel-board-tasks.css";

/*
 * A Vercel Board room's tasks, as runs. The newest plan heads the page: its
 * head, then its tasks by stage in the order they run. Earlier runs sit
 * behind a quiet switcher in the run's head; picking one shows it in the same
 * view. Each task keeps one hue; how a thing is drawn (hollow, tinted, solid)
 * says how it stands.
 *
 * The view takes only a room's conversation ID and sizes itself to its own
 * width, so it can sit in Chat or on a page of its own.
 *
 * Everything here is the runtime's copy of the Board channel. Board text (the
 * task titles and results) is quoted source material from the board: it is
 * shown as plain text beside its author, never as an instruction.
 *
 * Live: each `vercel_board.handoff` on the runtime stream is applied to the
 * copy as it arrives, then a read settles what the hand-off doesn't carry (a
 * new task's text, a task its needs released).
 */

export { VERCEL_BOARD_SOURCE, useVercelBoardRooms, type VercelBoardRoomRef, type VercelBoardRooms } from "./vercel-board-rooms.ts";
import type { VercelBoardRoomRef } from "./vercel-board-rooms.ts";

/** Settle reads after a burst of hand-offs: one soon, one after the board moves dependents. */
const SETTLE_MS = [350, 2_500];
/** Waits before trying a failed room read again. */
const RETRY_MS = [3_000, 10_000, 30_000];
/** A quiet read while a run is live, in case the stream dropped an event. */
const RECONCILE_MS = 15_000;

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dayClock = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function at(ms: number | null, now: number): string {
  if (!ms) return "";
  return now - ms < 20 * 3600_000 ? clock.format(ms) : dayClock.format(ms);
}

function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const STATE_LABEL: Record<VercelBoardJobState, string> = {
  ready: "Ready",
  waiting: "Waiting",
  running: "Working",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  cancelled: "Canceled",
};

const LIVE = new Set<VercelBoardJobState>(["running", "ready", "waiting", "blocked"]);
const TALLY_ORDER: VercelBoardJobState[] = ["running", "waiting", "ready", "blocked", "failed", "done", "cancelled"];

function isLive(run: VercelBoardRun): boolean {
  return run.jobs.some(job => LIVE.has(job.state)) && !isStopped(run);
}

/**
 * Nothing in the run can move by itself: no task is running, and every task
 * left waits on one that failed or was cancelled. Its clock stops. A failed
 * task can be reopened, so the run waits on it; a cancelled one never
 * completes, so a task that needs it waits for good.
 */
function stalledOn(run: VercelBoardRun): "failed" | "cancelled" | null {
  const failed = new Set(run.jobs.filter(job => job.state === "failed").map(job => job.taskId));
  const cancelled = new Set(run.jobs.filter(job => job.state === "cancelled").map(job => job.taskId));
  const left = run.jobs.filter(job => LIVE.has(job.state));
  const stuck = (job: VercelBoardJob) => job.state === "waiting" && job.needs.some(need => failed.has(need) || cancelled.has(need));
  if (!left.length || !left.every(stuck)) return null;
  return left.some(job => job.needs.some(need => failed.has(need))) ? "failed" : "cancelled";
}

function isStopped(run: VercelBoardRun): boolean {
  return stalledOn(run) !== null;
}

/* ── task hues: one per task, in plan order, the same in every part ──────── */

/** The palette's size (`--vbt-hue-0` … `--vbt-hue-7`). It leaves out red and amber, which mean failed and blocked. */
const HUES = 8;

type HueOf = (taskId: string) => CSSProperties;

function huesFor(jobs: VercelBoardJob[]): HueOf {
  const index = new Map(jobs.map((job, order) => [job.taskId, order % HUES]));
  return taskId => ({ "--hue": `var(--vbt-hue-${index.get(taskId) ?? 0})` } as CSSProperties);
}

/** Every task's hue, each run counted from its first task, so a task keeps its colour in both views. */
export function vercelBoardHues(runs: VercelBoardRun[]): HueOf {
  const index = new Map(runs.flatMap(run => run.jobs.map((job, order) => [job.taskId, order % HUES] as const)));
  return taskId => ({ "--hue": `var(--vbt-hue-${index.get(taskId) ?? 0})` } as CSSProperties);
}

/* ── who ─────────────────────────────────────────────────────────────────── */

function agentIdOf(who: VercelBoardWho): string | null {
  return who.key.startsWith("agent:") ? who.key.slice("agent:".length) : null;
}

export function Who({ who, harnesses, unknown }: { who: VercelBoardWho | null; harnesses?: Record<string, string>; unknown?: boolean }) {
  if (!who) return unknown
    ? <span className="vbt-none" title="Board did not record who claimed this task">Not recorded</span>
    : <span className="vbt-none">—</span>;
  const agentId = agentIdOf(who);
  const harness = agentId ? harnesses?.[agentId] : undefined;
  return (
    <span className="vbt-who" data-kind={who.kind} title={who.detail}>
      {harness ? <HarnessMark harness={harness} size={12} title={null} className="vbt-who-mark" /> : <i aria-hidden />}
      <span>{who.label}</span>
    </span>
  );
}

/* ── the run's head: its name, when it ran, how its tasks stand ──────────── */

function Tally({ jobs }: { jobs: VercelBoardJob[] }) {
  const counts: Partial<Record<VercelBoardJobState, number>> = {};
  for (const job of jobs) counts[job.state] = (counts[job.state] ?? 0) + 1;
  return (
    <span className="vbt-tally">
      {TALLY_ORDER.filter(state => counts[state]).map(state => (
        <span key={state} className="vbt-count" data-st={state}><i aria-hidden />{STATE_LABEL[state]} <b>{counts[state]}</b></span>
      ))}
    </span>
  );
}

/** Nobody on record did any task in the run: a run copied after it ran says so once, in its head. */
function nobodyRecorded(run: VercelBoardRun): boolean {
  return !run.jobs.some(job => job.to);
}

function RunHead({ run, stages, now, error, switcher }: { run: VercelBoardRun; stages: number; now: number; error: string | null; switcher: ReactNode }) {
  const live = isLive(run);
  const stalled = stalledOn(run);
  const stopped = stalled !== null;
  const elapsed = run.startedAt ? (live ? now - run.startedAt : run.finishedAt ? run.finishedAt - run.startedAt : null) : null;
  const tasks = `${run.jobs.length} ${run.jobs.length === 1 ? "task" : "tasks"}`;
  return (
    <header className="vbt-run-head">
      <div className="vbt-run-line">
        <h2 className="vbt-run-title">{run.label}</h2>
        <Tally jobs={run.jobs} />
      </div>
      <p className="vbt-run-meta">
        {run.startedAt ? <span>{live || stopped ? "Started" : "Ran"} {at(run.startedAt, now)}</span> : null}
        {stalled ? <span className="vbt-run-clock" data-st="failed">{stalled === "failed" ? "Waiting on a failed task" : "Stopped at a cancelled task"}</span>
          : elapsed !== null ? <span className="vbt-run-clock" data-live={live || undefined}>{live ? "Running" : "Took"} {span(elapsed)}</span> : null}
        <span>{stages > 1 ? `${tasks} in ${stages} stages` : tasks}</span>
        {run.backfilled ? (
          <span title="Scout copied this run from the board after it ran. Board kept each task's state and result.">
            {nobodyRecorded(run) ? "Who did each task wasn't recorded" : "Read from the board after it ran"}
          </span>
        ) : null}
        {error ? <span className="vbt-stale">{error}</span> : null}
        {switcher}
      </p>
    </header>
  );
}

/* ── the run's tasks, by stage, in the order they run ────────────────────── */

/** A stage's name, from the run's own needs: several first tasks fan out; a task that needs several fans them in. */
function stageName(stage: VercelBoardJob[], index: number): { name: string; note: string } {
  const count = `${stage.length} ${stage.length === 1 ? "task" : "tasks"}`;
  if (index === 0) return stage.length > 1 ? { name: "Fan-out", note: `${count} at once` } : { name: "First", note: count };
  const joins = Math.max(...stage.map(job => job.needs.length));
  return joins > 1 ? { name: "Fan-in", note: `${count}, after ${joins}` } : { name: "Then", note: count };
}

function tookOf(job: VercelBoardJob, now: number): ReactNode {
  if (job.state === "running" && job.dispatchedAt) return <span className="vbt-live">{span(now - job.dispatchedAt)}</span>;
  return job.finishedAt && job.dispatchedAt ? span(job.finishedAt - job.dispatchedAt) : null;
}

const DETAIL_ID = "vbt-detail";

/**
 * The run as one list: a group per stage, its tasks in plan order, a rail in
 * the gutter carrying the run from one stage into the next. A row is the task,
 * who did it, how it stands and its result in one line; selecting it opens the
 * task once, in the pane beside the list.
 */
function StageList({ run, stages, now, harnesses, landed, selected, onSelect }: {
  run: VercelBoardRun;
  stages: VercelBoardJob[][];
  now: number;
  harnesses: Record<string, string>;
  landed: Map<string, string>;
  selected: string | null;
  onSelect: (taskId: string | null) => void;
}) {
  const hueOf = useMemo(() => huesFor(run.jobs), [run]);
  const who = !nobodyRecorded(run);
  const took = run.jobs.some(job => tookOf(job, now) !== null);
  const cols = { "--vbt-cols": ["20px", "minmax(0, 1fr)", ...(who ? ["140px"] : []), "80px", ...(took ? ["64px"] : []), "minmax(0, 2.4fr)"].join(" ") } as CSSProperties;
  const grouped = stages.length > 1;
  return (
    <div className="vbt-list" style={cols} aria-label={`Tasks in ${run.label}`}>
      <div className="vbt-head" aria-hidden>
        <span />
        <span>Task</span>
        {who ? <span>Agent</span> : null}
        <span>State</span>
        {took ? <span>Took</span> : null}
        <span>Result</span>
      </div>
      {stages.map((stage, index) => {
        const { name, note } = stageName(stage, index);
        return (
          <section key={index} className="vbt-group" aria-label={grouped ? `Stage ${index + 1}, ${name}` : undefined}>
            {grouped ? (
              <h3 className="vbt-group-head">
                <span className="vbt-rail" data-node aria-hidden />
                <span className="vbt-group-name">{name}</span>
                <span className="vbt-group-note">{note}</span>
              </h3>
            ) : null}
            {stage.map(job => {
              const isSelected = selected === job.taskId;
              return (
                <button
                  key={job.taskId}
                  type="button"
                  className="vbt-row"
                  data-st={job.state}
                  data-selected={isSelected || undefined}
                  data-landed={landed.get(job.taskId)}
                  style={hueOf(job.taskId)}
                  aria-expanded={isSelected}
                  aria-controls={isSelected ? DETAIL_ID : undefined}
                  onClick={() => onSelect(isSelected ? null : job.taskId)}
                >
                  <span className="vbt-rail" aria-hidden />
                  <span className="vbt-task" title={job.title}><i className="vbt-swatch" data-st={job.state} aria-hidden /><span>{job.step}</span></span>
                  {who ? <span className="vbt-cell"><Who who={job.to} harnesses={harnesses} unknown={job.state !== "ready" && job.state !== "waiting" && job.state !== "cancelled"} /></span> : null}
                  <span className="vbt-state" data-st={job.state}><i aria-hidden />{STATE_LABEL[job.state]}</span>
                  {took ? <span className="vbt-t">{tookOf(job, now)}</span> : null}
                  <span className="vbt-result" data-st={job.state}>{vercelBoardSummary(job.resultText, job.title) ?? ""}</span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/* ── one task, opened once ───────────────────────────────────────────────── */

/** Board text rendered as Markdown. It is quoted source material: no HTML, no images, and only web links go anywhere. */
const BOARD_MARKDOWN: Components = {
  a: ({ href, children }) => href && /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    : <span className="vbt-md-link">{children}</span>,
  img: ({ alt }) => alt ? <span className="vbt-md-link">{alt}</span> : null,
};

function BoardMarkdown({ text }: { text: string }) {
  return <div className="vbt-md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={BOARD_MARKDOWN} skipHtml>{text}</ReactMarkdown></div>;
}

function CopyTaskId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button type="button" className="vbt-copy" title={id} onClick={() => { void navigator.clipboard?.writeText(id).then(() => setCopied(true), () => {}); }}>
      {copied ? "Copied" : "Copy task ID"}
    </button>
  );
}

function CloseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  );
}

/** The task's text past its title: the brief its worker read. */
function briefOf(job: VercelBoardJob): string {
  const text = job.text.trim();
  const first = text.split("\n")[0]!.trim();
  return first === job.title.trim() || job.title.startsWith(first.replace(/…$/, "")) ? text.slice(first.length).trim() : text;
}

function Detail({ job, run, now, harnesses, hue, review, onClose }: {
  job: VercelBoardJob;
  run: VercelBoardRun;
  now: number;
  harnesses: Record<string, string>;
  hue: CSSProperties;
  review?: ReactNode;
  onClose: () => void;
}) {
  const result = job.resultText?.trim() || null;
  const after = job.needs.map(id => run.jobs.find(other => other.taskId === id)?.step).filter((step): step is string => Boolean(step));
  const brief = briefOf(job);
  const took = job.finishedAt && job.dispatchedAt ? span(job.finishedAt - job.dispatchedAt) : null;
  const nobodyYet = job.state === "ready" || job.state === "waiting" || job.state === "cancelled";
  const doer = job.to ? agentIdOf(job.to) : null;
  // local Scout provides the session panel; hosted Chat has no runtime to read it from
  const TaskSession = boardTaskSession();
  return (
    <aside id={DETAIL_ID} className="vbt-detail" aria-label={`Task ${job.step}`} style={hue}>
      <header className="vbt-detail-head">
        <i className="vbt-swatch" data-st={job.state} aria-hidden />
        <h3 className="vbt-detail-step">{job.step}</h3>
        <span className="vbt-state" data-st={job.state}><i aria-hidden />{STATE_LABEL[job.state]}</span>
        <button type="button" className="vbt-close" aria-label="Close the task" onClick={onClose}><CloseGlyph /></button>
      </header>
      {job.title !== job.step ? <p className="vbt-detail-title">{job.title}</p> : null}
      <dl className="vbt-facts">
        <dt>Planned by</dt>
        <dd><Who who={job.from} />{job.createdAt ? <span className="vbt-t">{at(job.createdAt, now)}</span> : null}</dd>
        <dt>Done by</dt>
        <dd>
          {job.to ? <Who who={job.to} harnesses={harnesses} /> : <span className="vbt-none">{nobodyYet ? "Nobody yet" : "Not recorded"}</span>}
          {job.dispatchedAt ? <span className="vbt-t">claimed {at(job.dispatchedAt, now)}</span> : null}
        </dd>
        {job.finishedAt ? (
          <>
            <dt>Finished</dt>
            <dd><span className="vbt-t">{at(job.finishedAt, now)}</span>{took ? <span className="vbt-t">took {took}</span> : null}</dd>
          </>
        ) : null}
        {after.length ? (
          <>
            <dt>After</dt>
            <dd className="vbt-after">{after.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      {job.flightId && TaskSession ? (
        <Suspense fallback={null}>
          <TaskSession flightId={job.flightId} harness={doer ? harnesses[doer] : null} />
        </Suspense>
      ) : null}
      {result ? (
        <section className="vbt-detail-result" data-st={job.state}>
          <h4>{job.state === "failed" ? "Reason" : "Result"}</h4>
          <BoardMarkdown text={result} />
        </section>
      ) : <p className="vbt-detail-empty">{nobodyYet ? "No result yet." : "Board has no result for this task."}</p>}
      {brief ? (
        <details className="vbt-brief">
          <summary>Task text</summary>
          <p>{brief}</p>
        </details>
      ) : null}
      {review}
      <footer className="vbt-detail-foot"><CopyTaskId id={job.taskId} /></footer>
    </aside>
  );
}

/* ── the room's runs: a quiet switcher in the run's head ─────────────────── */

/** Matches `.vbt-runs-menu { min-width }` in vercel-board-tasks.css. */
const RUNS_MENU_WIDTH = 320;

function Chevron() {
  return (
    <svg className="vbt-runs-chevron" width="8" height="8" viewBox="0 0 8 8" aria-hidden>
      <path d="M1.5 3l2.5 2.5L6.5 3" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The room's runs, newest first, behind one small control. The latest run is
 * the default view; an earlier one is a look back, with a way straight back.
 */
function RunSwitcher({ runs, shown, now, onPick }: { runs: VercelBoardRun[]; shown: string; now: number; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  // The menu opens leftward from the control's end when it would cross the
  // right edge of the task list. The list scrolls, so it clips what it holds,
  // and its edge moves in when a task's panel opens beside it.
  const [alignEnd, setAlignEnd] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) toggleButton.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    // Focus lands on the run being shown, as in a native select.
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onPointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(true); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (runs.length < 2) return null;
  const latest = runs[0]!;
  const past = shown !== latest.key;
  const toggle = () => {
    if (!open) {
      const box = root.current?.getBoundingClientRect();
      const edge = (root.current?.closest(".vbt-main") ?? root.current?.closest(".vbt"))?.getBoundingClientRect();
      setAlignEnd(Boolean(box && edge && box.left + RUNS_MENU_WIDTH > edge.right));
    }
    setOpen(!open);
  };
  const pick = (key: string) => { onPick(key); close(true); };
  const onMenuKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Tab") { close(false); return; }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length
      : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    items[next]!.focus();
  };
  return (
    <span className="vbt-runs" ref={root}>
      <button ref={toggleButton} type="button" className="vbt-runs-toggle" aria-haspopup="menu" aria-expanded={open} data-past={past || undefined} onClick={toggle}>
        {past ? "Earlier run" : <>Earlier <b>{runs.length - 1}</b></>}
        <Chevron />
      </button>
      {past ? <button type="button" className="vbt-runs-back" onClick={() => pick(latest.key)}>Back to latest</button> : null}
      {open ? (
        <span ref={menu} className="vbt-runs-menu" role="menu" aria-label="Runs in this room" data-align={alignEnd ? "end" : undefined} onKeyDown={onMenuKey}>
          {runs.map(run => (
            <button
              key={run.key}
              type="button"
              role="menuitemradio"
              aria-checked={run.key === shown}
              tabIndex={-1}
              className="vbt-runs-item"
              onClick={() => pick(run.key)}
            >
              <span className="vbt-runs-name">{run.label}</span>
              <span className="vbt-runs-when">{run === latest ? "Latest" : at(run.startedAt, now)}</span>
              <Tally jobs={run.jobs} />
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/* ── the room ────────────────────────────────────────────────────────────── */

function handoffOf(event: BrokerEvent): VercelBoardHandoff | null {
  if ((event.kind as string) !== "vercel_board.handoff") return null;
  const payload = (event as { payload?: { handoff?: VercelBoardHandoff } }).payload;
  return payload?.handoff && typeof payload.handoff.taskId === "string" ? payload.handoff : null;
}

/** A Board room as both views read it: the runtime's copy, the clock, and the tasks whose state just changed. */
export interface VercelBoardRoomState {
  data: VercelBoardRoomData | null;
  error: string | null;
  /** This runtime does not hold the board connection: the room shows nothing new and says nothing. */
  unheld: boolean;
  now: number;
  landed: Map<string, string>;
  /** Reads the room again now, as after a post. Absent on a room drawn from fixed data. */
  reload?: () => Promise<void>;
}

/** Reads one board room where the server reads the board itself (hosted chat), with how long to wait before the next read. */
export type VercelBoardRoomReader = (conversationId: string) => Promise<VercelBoardRoomData & { refreshMs?: number }>;

/** How long a server-read room waits between reads when the server does not say. */
const READER_REFRESH_MS = 20_000;

/**
 * Reads one Board room and keeps it live. Conversation and Tasks are two
 * views of this one read, so switching tabs never reads again. Pass null for
 * a room that is not a Board channel: nothing is read.
 *
 * With a `reader`, the room comes from the server that reads the board
 * itself rather than from the local runtime's copy. No runtime events reach
 * such a room, so it reads again on the server's clock while the page shows.
 */
export function useVercelBoardRoom(conversationId: string | null, reader?: VercelBoardRoomReader): VercelBoardRoomState {
  const [data, setData] = useState<VercelBoardRoomData | null>(null);
  // Whether the last read failed. The words are chosen at render, so a failed
  // refresh over a room on screen reads as stale, not as the room failing.
  const [failed, setFailed] = useState<"unanswered" | "not_custodian" | false>(false);
  const [failures, setFailures] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [landed, setLanded] = useState<Map<string, string>>(() => new Map());

  // The states last seen, to light a task whose state changes; reset with the room.
  const states = useRef<Map<string, VercelBoardJobState> | null>(null);
  // Reads can overlap (a burst of hand-offs, the reconcile); only the newest one lands.
  const latestRead = useRef(0);
  const load = useCallback(async () => {
    if (!conversationId) return;
    const read = ++latestRead.current;
    try {
      const next = reader
        ? await reader(conversationId)
        : await api<VercelBoardRoomData>(`/api/vercel-board/room?conversationId=${encodeURIComponent(conversationId)}`);
      if (read !== latestRead.current) return;
      setData(next);
      setFailed(false);
      setFailures(0);
    } catch (cause) {
      if (read !== latestRead.current) return;
      setFailed(!reader && (cause as { status?: number }).status === 409 ? "not_custodian" : "unanswered");
      setFailures(count => count + 1);
    }
  }, [conversationId, reader]);

  const settleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const settleSoon = useCallback(() => {
    for (const timer of settleTimers.current) clearTimeout(timer);
    settleTimers.current = SETTLE_MS.map(delay => setTimeout(() => { void load(); }, delay));
  }, [load]);
  useEffect(() => () => { for (const timer of settleTimers.current) clearTimeout(timer); }, []);

  useEffect(() => {
    setData(null);
    setFailed(false);
    setFailures(0);
    states.current = null;
    void load();
  }, [load]);

  // A failed read tries again on its own, backing off, so the room does not
  // wait for the next runtime event to recover.
  useEffect(() => {
    // Custody moves only by a runtime action; its reconcile event reads again.
    if (failed !== "unanswered") return;
    const timer = setTimeout(() => { void load(); }, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
    return () => clearTimeout(timer);
  }, [failed, failures, load]);

  // Custody is the runtime's business, not the reader's: a room this runtime
  // cannot read keeps its last read, or stays empty, without a notice.
  const unheld = failed === "not_custodian";
  const from = reader ? "the board" : "the runtime";
  const error = failed !== "unanswered" ? null
    : data
      ? `Couldn't refresh from ${from}. Showing the last read.`
      : `${reader ? "The board" : "The runtime"} didn't answer. Trying again…`;

  // A server-read room has no runtime events: it reads again on the
  // server's clock, only while the page is in view.
  const refreshMs = reader ? ((data as { refreshMs?: number } | null)?.refreshMs ?? READER_REFRESH_MS) : 0;
  useEffect(() => {
    if (!reader || !conversationId || refreshMs <= 0) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, refreshMs);
    return () => clearInterval(timer);
  }, [conversationId, load, reader, refreshMs]);

  useBrokerEvents((event) => {
    if (!conversationId) return;
    const handoff = handoffOf(event);
    if (handoff) {
      setData(current => current ? applyVercelBoardHandoff(current, handoff) : current);
      settleSoon();
    } else if (isBrokerReconcileEvent(event)) {
      void load();
    }
  });

  const jobs = useMemo(() => data ? foldVercelBoardJobs(data) : [], [data]);
  const live = useMemo(() => jobs.some(job => LIVE.has(job.state)), [jobs]);

  // A task whose state changed lights in its new state's colour, once.
  useEffect(() => {
    const previous = states.current;
    if (!jobs.length) return;
    states.current = new Map(jobs.map(job => [job.taskId, job.state]));
    if (!previous) return;
    // only a task already on screen tints; a new one slides in instead
    const changed = new Map<string, string>();
    for (const job of jobs) {
      const before = previous.get(job.taskId);
      if (before !== undefined && before !== job.state) changed.set(job.taskId, `${job.state}:${Date.now()}`);
    }
    if (changed.size) setLanded(changed);
  }, [jobs]);

  // Clocks tick once a second, only while a task is live.
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);

  useEffect(() => {
    if (!live) return;
    const reconcile = setInterval(() => { if (document.visibilityState === "visible") void load(); }, RECONCILE_MS);
    return () => clearInterval(reconcile);
  }, [live, load]);

  return { data, error, unheld, now, landed, reload: load };
}

/** A Board room's Tasks view: the run switcher, the tasks by stage, and the selected task. */
export function VercelBoardTasks({ room, reviewEnabled = false }: { room: VercelBoardRoomState; reviewEnabled?: boolean }) {
  const { data, error, now, landed } = room;
  const jobs = useMemo(() => data ? foldVercelBoardJobs(data) : [], [data]);
  const runs = useMemo(() => groupVercelBoardRuns(jobs), [jobs]);
  const [runKey, setRunKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const main = useRef<HTMLDivElement | null>(null);
  const run = runs.find(candidate => candidate.key === runKey) ?? runs[0] ?? null;
  const stages = useMemo(() => run ? vercelBoardStages(run) : [], [run]);
  const job = selected ? run?.jobs.find(candidate => candidate.taskId === selected) ?? null : null;
  const hueOf = useMemo(() => huesFor(run?.jobs ?? []), [run]);

  useEffect(() => {
    if (!job) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job]);

  const pickRun = useCallback((key: string) => {
    setRunKey(key === runs[0]?.key ? null : key);
    setSelected(null);
    main.current?.scrollTo({ top: 0 });
  }, [runs]);

  if (!data) {
    if (room.unheld) return <div className="vbt" />;
    return (
      <div className="vbt" data-loading>
        <p className="vbt-notice" data-tone={error ? "error" : undefined}>{error ?? "Loading tasks…"}</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="vbt">
        <p className="vbt-notice">No tasks in {data.channel} yet.</p>
      </div>
    );
  }

  const hostId = reviewEnabled && hostFleet.focused().id === LOCAL_HOST_ID ? LOCAL_HOST_ID : null;
  const task = hostId && job ? data.messages.find(message => message.id === job.taskId && !message.deleted) : null;
  const review = task && job && hostId ? (
    <BoardTaskReview key={JSON.stringify([hostId, data.connectionId, data.channel, job.taskId])}
      hostId={hostId} connectionId={data.connectionId} channel={data.channel} itemId={job.taskId}
      snapshot={JSON.stringify([task.version, job.chain.at(-1)?.id])}
      roomStale={Boolean(error || room.unheld)} reloadRoom={room.reload} />
  ) : null;

  return (
    <div className="vbt">
      <div className="vbt-split" data-detail={job ? "" : undefined}>
        <div className="vbt-main" ref={main}>
          <RunHead
            run={run}
            stages={stages.length}
            now={now}
            error={error}
            switcher={<RunSwitcher runs={runs} shown={run.key} now={now} onPick={pickRun} />}
          />
          <StageList run={run} stages={stages} now={now} harnesses={data.harnesses} landed={landed} selected={job?.taskId ?? null} onSelect={setSelected} />
        </div>
        {job ? <Detail job={job} run={run} now={now} harnesses={data.harnesses} hue={hueOf(job.taskId)} review={review} onClose={() => setSelected(null)} /> : null}
      </div>
    </div>
  );
}

/* ── room details ────────────────────────────────────────────────────────── */


const MIRROR_LABEL: Record<VercelBoardMirrorState, string> = {
  not_mirrored: "Not copied",
  backfilling: "Copying",
  mirrored: "Copied",
  re_reading: "Re-reading",
};

/** Where a Board room comes from, for its room details. */
export function VercelBoardRoomSource({ room }: { room: VercelBoardRoomRef }) {
  return (
    <>
      <span className="label-sm">Vercel Board</span>
      <dl className="vbt-source-list">
        <dt>Board</dt><dd>{room.board?.name ?? "—"}</dd>
        <dt>Team</dt><dd>{room.board?.team ?? "—"}</dd>
        <dt>Channel</dt><dd>{room.channel}</dd>
        <dt>Copy</dt><dd data-state={room.mirror}>{MIRROR_LABEL[room.mirror] ?? room.mirror}</dd>
        <dt>Connection</dt><dd title={room.board?.url}>{room.connectionId}{room.connectionState ? ` · ${room.connectionState}` : ""}</dd>
      </dl>
    </>
  );
}
