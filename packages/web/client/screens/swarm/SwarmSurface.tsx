import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { HarnessMark } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import type { CanvasOrientation } from "../../lib/swarm-canvas.ts";
import {
  askDeeds,
  codeLinks,
  deedSentence,
  linkedIssues,
  replySentence,
  swarmPulls,
  type AskDeed,
  type CodeLink,
  type SwarmPull,
} from "../../lib/swarm-code.ts";
import { lanesAxis } from "../../lib/swarm-axis.ts";
import { dropsToDraw } from "../../lib/swarm-drops.ts";
import { CORE_SPLIT } from "../../lib/swarm-goal.ts";
import { findInitiatives, initiativeMembers, initiativeSentence, type Initiative } from "../../lib/swarm-initiatives.ts";
import { placePointAsks, sentInWindow } from "../../lib/swarm-point.ts";
import { pullStateQuery, type SwarmPullState } from "../../lib/swarm-pull-state.ts";
import { askStops } from "../../lib/swarm-stop.ts";
import {
  asMeta,
  asString,
  buildSwarms,
  mergeRuns,
  packAsks,
  replyBody,
  spanWords,
  SWARM_WINDOWS,
  type Swarm,
  type SwarmAgent,
  type SwarmAsk,
  type SwarmEvent,
  type SwarmMember,
  type SwarmWindowId,
} from "../../lib/swarm-model.ts";
import type { AgentRun } from "../../lib/types.ts";
import { AskCode } from "./AskCode.tsx";
import { AskMarkup } from "./AskMarkup.tsx";
import { InitiativePicker } from "./InitiativePicker.tsx";
import { LanePanel } from "./LanePanel.tsx";
import { RepoPanel } from "./RepoPanel.tsx";
import { SwarmCanvas } from "./SwarmCanvas.tsx";
import { askSentence, askTone, clock, dayLabel, letters, runtimePhrase, shortStamp, stampWithDay } from "./swarm-ui.ts";
import { useSwarmHearing } from "./useSwarmHearing.ts";
import { useSwarmPullStates } from "./useSwarmPullStates.ts";
import "./swarm.css";

/*
 * /swarm: the agents working together, from the runtime's run records. The
 * asks add up to initiatives (swarm-initiatives.ts): a goal and its lanes, the
 * sessions in a worktree or another project, a session of its own. The picker
 * lists them, roots first, and the board shows the one picked two ways:
 *   - the canvas (SwarmCanvas.tsx): who asked, the lanes they asked, and the
 *     repositories their code went to, horizontal or vertical;
 *   - the lanes: one row per lane, each ask a block from the moment it was
 *     sent to its reply, now at the right edge. Base: the swim-lanes study
 *     (design/studio/views/agent-swimlanes), Paper palette, words on everything.
 * Amber marks only a declared request: a reply the runtime holds for review.
 */

const POLL_MS = 5_000;
// The runtime's cap. A goal's day of asks fits; 200 runs did not reach back far enough.
const HISTORY_LIMIT = 500;
// The picker reaches back a week.
const KEEP_MS = 8 * 86_400_000;
const POINT_H = 52;
const BLOCK_H = 26;
const SLOT_GAP = 4;
const ROW_PAD = 16;
const MIN_BLOCK_W = 6;
const VIEW_KEY = "scout.swarm.view";
const ORIENTATION_KEY = "scout.swarm.orientation";
const INITIATIVE_KEY = "scout.swarm.initiative";
const WINDOW_KEY = "scout.swarm.window";
const GOALS = [CORE_SPLIT];

type View = "canvas" | "lanes";
/** The lanes' windows, and "all": from the initiative's first ask. */
type LanesWindowId = SwarmWindowId | "all";

const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "canvas", label: "Canvas" },
  { id: "lanes", label: "Lanes" },
];
const DIRECTIONS: ReadonlyArray<{ id: CanvasOrientation; label: string }> = [
  { id: "horizontal", label: "Horizontal" },
  { id: "vertical", label: "Vertical" },
];
const LANES_WINDOWS: ReadonlyArray<{ id: LanesWindowId; label: string }> = [...SWARM_WINDOWS, { id: "all", label: "All" }];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private windows and blocked storage fall back to the default.
    return null;
  }
}

function readChoice<T extends string>(key: string, options: readonly T[], fallback: T): T {
  const stored = readStored(key);
  return options.find((option) => option === stored) ?? fallback;
}

function writeChoice(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Remembering a choice is a convenience; the page works without it.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs from the runtime: history once, then the open ones every few seconds. */
function useSwarmRuns() {
  const [runs, setRuns] = useState<Map<string, AgentRun>>(() => new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let openIds: string | null = null;
    const merge = (incoming: AgentRun[]) => {
      if (cancelled) return;
      setRuns((held) => mergeRuns(held, incoming, Date.now() - KEEP_MS));
      setReadAt(Date.now());
      setStatus("ready");
      setError(null);
    };
    const readRecent = async (limit: number) => merge(await api<AgentRun[]>(`/api/runs?active=false&limit=${limit}`));
    const readOpen = async () => {
      const open = await api<AgentRun[]>("/api/runs");
      merge(open);
      // Something started or finished: read the recent closed runs for their replies.
      const ids = open.map((run) => run.id).sort().join(",");
      if (openIds !== null && ids !== openIds) await readRecent(30);
      openIds = ids;
    };
    const fail = (reason: unknown) => {
      if (cancelled) return;
      setError(errorText(reason));
      setStatus((current) => (current === "loading" ? "error" : current));
    };

    readRecent(HISTORY_LIMIT).then(readOpen).catch(fail);
    let tick = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      tick += 1;
      // Every minute a sweep of recent runs catches asks that opened and closed between polls.
      (tick % 12 === 0 ? readRecent(30) : readOpen()).catch(fail);
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attempt]);

  return { runs, status, error, readAt, retry: () => { setStatus("loading"); setAttempt((n) => n + 1); } };
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type Focus = { kind: "ask"; id: string } | { kind: "lane"; id: string } | null;

/** A reply that opened or reviewed pull requests says so, rather than quoting its first line. */
function storyLine(event: SwarmEvent, deeds: ReadonlyMap<string, AskDeed>): string {
  return replySentence(event, event.kind === "replied" ? deeds.get(event.askId) : undefined);
}

/** A link from the end of the earlier block to the start of the later one; asks that overlap in time drop straight between them. */
function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x2 - x1 >= 16) {
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  }
  const x = x2 + 8;
  const down = y2 > y1;
  return `M${x},${y1 + (down ? BLOCK_H / 2 : -BLOCK_H / 2)} L${x},${y2 + (down ? -BLOCK_H / 2 : BLOCK_H / 2)}`;
}

export function SwarmSurface() {
  const { runs, status, error, readAt, retry } = useSwarmRuns();
  const now = useNow(5_000);
  const [view, setView] = useState<View>(() => readChoice(VIEW_KEY, VIEWS.map((option) => option.id), "canvas"));
  const [orientation, setOrientation] = useState<CanvasOrientation>(() => readChoice(ORIENTATION_KEY, DIRECTIONS.map((option) => option.id), "horizontal"));
  const [windowId, setWindowId] = useState<LanesWindowId>(() => readChoice(WINDOW_KEY, LANES_WINDOWS.map((option) => option.id), "3h"));
  const silenceOf = useSwarmHearing(runs) ?? undefined;
  const initiatives = useMemo(() => findInitiatives(runs.values(), { now, goals: GOALS, silenceOf }), [runs, now, silenceOf]);
  const [initiativeId, setInitiativeId] = useState<string | null>(() => readStored(INITIATIVE_KEY));
  const initiative = initiatives.find((candidate) => candidate.id === initiativeId) ?? initiatives[0] ?? null;
  const [askId, setAskId] = useState<string | null>(null);
  const [laneId, setLaneId] = useState<string | null>(null);
  const [repoName, setRepoName] = useState<string | null>(null);

  // The lanes: the asks of one point in the initiative, over the window.
  const windowMs = windowId === "all"
    ? Math.max(60_000, now - (initiative?.start ?? now) + 60_000)
    : SWARM_WINDOWS.find((option) => option.id === windowId)!.ms;
  const swarms = useMemo(
    () => (initiative && view === "lanes" ? buildSwarms(initiative.runs, { now, windowMs, ...initiative.scope, silenceOf }) : []),
    [initiative, view, now, windowMs, silenceOf],
  );
  const [swarmKey, setSwarmKey] = useState<string | null>(null);
  const swarm = swarms.find((s) => s.key === swarmKey) ?? swarms[0] ?? null;
  // A number any run links as an issue is no pull request, even where the window holds only an ask that names it.
  const issues = useMemo(() => linkedIssues([...runs.values()].flatMap((run) => [asString(asMeta(run.input)?.task), replyBody(run)])), [runs]);
  const pulls = useMemo(() => (swarm ? swarmPulls(swarm, issues) : []), [swarm, issues]);
  const deeds = useMemo(() => askDeeds(swarm?.asks ?? [], pulls), [swarm, pulls]);
  const links = useMemo(() => codeLinks(pulls), [pulls]);

  // The canvas: every ask in the initiative.
  const canvasAsks = useMemo(() => initiative?.swarms.flatMap((s) => s.asks) ?? [], [initiative]);
  const canvasPulls = useMemo(() => swarmPulls({ asks: canvasAsks }, issues), [canvasAsks, issues]);
  const canvasDeeds = useMemo(() => askDeeds(canvasAsks, canvasPulls), [canvasAsks, canvasPulls]);
  const canvasEvents = useMemo(() => initiative?.swarms.flatMap((s) => s.events).sort((a, b) => b.at - a.at) ?? [], [initiative]);
  const members = useMemo(() => (initiative ? initiativeMembers(initiative.swarms, now) : []), [initiative, now]);
  const agents = useMemo(() => new Map<string, SwarmAgent>(initiative?.swarms.flatMap((s) => [...s.agents]) ?? []), [initiative]);
  const lane = view === "canvas" ? members.find((member) => member.id === laneId) ?? null : null;
  const repo = view === "canvas" && repoName !== null && canvasPulls.some((pull) => pull.pr.repo === repoName) ? repoName : null;
  // What became of the pull requests on the page: merged, closed, open or a draft.
  const stateQuery = useMemo(() => pullStateQuery(view === "lanes" ? pulls : canvasPulls), [view, pulls, canvasPulls]);
  const pullStates = useSwarmPullStates(stateQuery);

  // The ask read in full: on the lanes, one of the point's; on the canvas, any of the initiative's.
  const askSwarm = view === "lanes"
    ? (swarm?.asks.some((ask) => ask.id === askId) ? swarm : null)
    : initiative?.swarms.find((s) => s.asks.some((ask) => ask.id === askId)) ?? null;
  const selected = askSwarm?.asks.find((ask) => ask.id === askId) ?? null;

  useEffect(() => {
    const previous = document.title;
    document.title = "Scout Swarm";
    return () => { document.title = previous; };
  }, []);

  // Escape closes the ask, then the lane or the repository. With a lane open on the canvas, the arrow keys step through the lanes.
  useEffect(() => {
    if (!selected && !lane && !repo) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return;
      if (event.key === "Escape") {
        if (selected) setAskId(null);
        else if (lane) setLaneId(null);
        else setRepoName(null);
        return;
      }
      if (selected || !lane) return;
      const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
      const next = step ? members[members.findIndex((member) => member.id === lane.id) + step] : undefined;
      if (!next) return;
      event.preventDefault();
      setLaneId(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, lane, repo, members]);

  const pickInitiative = (id: string) => {
    setInitiativeId(id);
    writeChoice(INITIATIVE_KEY, id);
    setSwarmKey(null);
    setAskId(null);
    setLaneId(null);
    setRepoName(null);
  };

  const pickView = (next: View) => {
    setView(next);
    writeChoice(VIEW_KEY, next);
    setLaneId(null);
    setRepoName(null);
  };

  const pickOrientation = (next: CanvasOrientation) => {
    setOrientation(next);
    writeChoice(ORIENTATION_KEY, next);
  };

  const pickWindow = (id: LanesWindowId) => {
    setWindowId(id);
    writeChoice(WINDOW_KEY, id);
  };

  const selectLane = (memberId: string | null) => {
    setLaneId(memberId);
    setRepoName(null);
    setAskId(null);
  };

  const selectRepo = (name: string | null) => {
    setRepoName(name);
    setLaneId(null);
    setAskId(null);
  };

  // GitHub's states are known for some of the canvas's pull requests, so its dashed code edges mean something.
  const canvasStates = view === "canvas" && canvasPulls.some((pull) => pullStates.has(pull.pr.key));
  const lede = [
    initiative?.summary ?? "The agents working together, from the runtime's asks.",
    !initiative ? null
      : view === "canvas" ? `Who asked, the lanes they asked, and the repositories their code went to. Pick a lane to read its asks, or a repository to read its pull requests.${canvasStates ? " A dashed line to a repository is code that has not merged yet." : ""}`
      : swarm ? `${swarm.point.name} runs point through ${swarm.point.via}. ${initiative.kind === "goal" ? "Each lane holds every session that has worked in it" : "Each lane is a session it asked"}, and each block is one ask, from the moment it was sent to the reply.`
      : null,
  ].filter(Boolean).join(" ");

  let board: ReactNode;
  if (!initiative) {
    board = <Empty status={status} error={error} retry={retry} message="No asks in the last week." />;
  } else if (view === "canvas") {
    board = (
      <>
        <Story events={canvasEvents} working={initiative} now={now} readAt={readAt} error={error} deeds={canvasDeeds} onPick={setAskId} />
        <SwarmCanvas initiative={initiative} now={now} orientation={orientation} pulls={canvasPulls} deeds={canvasDeeds} states={pullStates}
          selectedId={lane ? `lane:${lane.id}` : repo ? `repo:${repo}` : null} onSelectLane={selectLane} onSelectRepo={selectRepo} />
      </>
    );
  } else if (swarm) {
    board = (
      <>
        <Story events={swarm.events} working={initiativeSentence(swarm.members, swarm.lastActivityAt, now)} now={now} readAt={readAt} error={error} deeds={deeds} onPick={setAskId} />
        <Lanes swarm={swarm} now={now} fit={windowId === "all"} deeds={deeds} links={links} selectedId={selected?.id ?? null} onSelect={setAskId} />
      </>
    );
  } else {
    board = (
      <Empty status={status} error={error} retry={retry} message={`No asks in the last ${windowId}.`}
        action={windowId === "all" ? null : { label: "Show from the first ask", run: () => pickWindow("all") }} />
    );
  }

  return (
    <main className="swarm" data-view={view} data-panel={selected || lane || repo ? "open" : undefined}>
      <div className={`swarm-page${initiatives.length > 0 ? "" : " is-bare"}`}>
        {initiatives.length > 0 ? (
          <InitiativePicker initiatives={initiatives} selectedId={initiative?.id ?? null} now={now} onPick={pickInitiative} />
        ) : null}
        <div className="swarm-main">
          <header className="swarm-top">
            <div className="swarm-top__text">
              <h1 className="swarm-h1">{initiative?.title ?? "Swarm"}</h1>
              <p className="swarm-lede">{lede}</p>
            </div>
            {initiative ? (
              <div className="swarm-controls">
                <Seg label="View" options={VIEWS} value={view} onPick={pickView} />
                {view === "canvas" ? (
                  <Seg label="Direction" options={DIRECTIONS} value={orientation} onPick={pickOrientation} />
                ) : (
                  <>
                    {swarms.length > 1 ? (
                      <div className="swarm-seg" role="group" aria-label="Point session">
                        {swarms.map((s) => (
                          <button key={s.key} type="button" className={s.key === swarm?.key ? "is-on" : ""} aria-pressed={s.key === swarm?.key}
                            onClick={() => { setSwarmKey(s.key); setAskId(null); }} title={s.point.sessionId ?? s.point.requesterId}>
                            {s.point.via}, since {clock(s.start)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <Seg label="Time window" options={LANES_WINDOWS} value={windowId} onPick={pickWindow} />
                  </>
                )}
              </div>
            ) : null}
          </header>

          <section className="swarm-board">{board}</section>
        </div>
      </div>

      {selected && askSwarm ? (
        <AskPanel swarm={askSwarm} ask={selected} now={now} pulls={view === "lanes" ? pulls : canvasPulls} states={pullStates} onClose={() => setAskId(null)} />
      ) : lane ? (
        <LanePanel member={lane} agents={agents} deeds={canvasDeeds} now={now} onSelectAsk={setAskId} onClose={() => setLaneId(null)} />
      ) : repo ? (
        <RepoPanel repo={repo} pulls={canvasPulls} lanes={members} states={pullStates} now={now} onSelectAsk={setAskId} onClose={() => setRepoName(null)} />
      ) : null}
    </main>
  );
}

function Seg<T extends string>({ label, options, value, onPick }: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onPick: (id: T) => void;
}) {
  return (
    <div className="swarm-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" className={option.id === value ? "is-on" : ""} aria-pressed={option.id === value} onClick={() => onPick(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ status, error, retry, message, action = null }: {
  status: "loading" | "ready" | "error";
  error: string | null;
  retry: () => void;
  message: string;
  action?: { label: string; run: () => void } | null;
}) {
  if (status === "loading") return <p className="swarm-empty">Reading the runtime's asks…</p>;
  if (status === "error") {
    return (
      <div className="swarm-empty">
        <p>Scout could not read the runtime's asks{error ? `: ${error}` : "."}</p>
        <button type="button" className="swarm-button" onClick={retry}>Try again</button>
      </div>
    );
  }
  return (
    <div className="swarm-empty">
      <p>{message}</p>
      {action ? <button type="button" className="swarm-button" onClick={action.run}>{action.label}</button> : null}
    </div>
  );
}

function Story({ events, working, now, readAt, error, deeds, onPick }: {
  events: readonly SwarmEvent[];
  working: Pick<Initiative, "sentence" | "tone">;
  now: number;
  readAt: number | null;
  error: string | null;
  deeds: ReadonlyMap<string, AskDeed>;
  onPick: (askId: string) => void;
}) {
  const [latest, previous] = events;
  const fresh = error
    ? "The last read failed; showing what Scout read before."
    : readAt ? `Read ${spanWords(now - readAt) === "under a minute" ? "moments" : spanWords(now - readAt)} ago` : "";
  return (
    <div className="swarm-story">
      <div className="swarm-story__clock">
        <b>{clock(now)}</b>
        <span>{fresh}</span>
      </div>
      <div className="swarm-story__text">
        {latest ? (
          <button key={`${latest.askId}:${latest.kind}`} type="button" className={`swarm-story__now is-${latest.kind}`} onClick={() => onPick(latest.askId)}>
            <span>{shortStamp(latest.at, now)}</span>{storyLine(latest, deeds)}
          </button>
        ) : null}
        {previous ? (
          <button type="button" className="swarm-story__prev" onClick={() => onPick(previous.askId)}>
            <span>{shortStamp(previous.at, now)}</span>{storyLine(previous, deeds)}
          </button>
        ) : null}
      </div>
      <p className={`swarm-story__working is-${working.tone}`}>{working.sentence}</p>
    </div>
  );
}

type LaneLayout = { member: SwarmMember; top: number; height: number; slots: Map<string, number> };

function Lanes({ swarm, now, fit, deeds, links, selectedId, onSelect }: {
  swarm: Swarm;
  now: number;
  /** The window is All: the axis spans the swarm's own work, see swarm-axis.ts. */
  fit: boolean;
  deeds: ReadonlyMap<string, AskDeed>;
  links: ReadonlyMap<string, readonly CodeLink[]>;
  selectedId: string | null;
  onSelect: (askId: string | null) => void;
}) {
  const [trackRef, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<Focus>(null);
  const W = Math.max(1, width);
  const axis = useMemo(() => lanesAxis(swarm, { now, fit, maxTicks: Math.max(3, Math.floor(W / 110)) }), [swarm, now, fit, W]);
  const { start, end } = axis;
  const px = (at: number) => Math.min(W, Math.max(0, ((at - start) / (end - start)) * W));
  const msPerPx = (end - start) / W;

  const lanes = useMemo(() => {
    let top = POINT_H;
    const out: LaneLayout[] = [];
    for (const member of swarm.members) {
      const { slots, count } = packAsks(member.asks, now, msPerPx * (MIN_BLOCK_W + 4));
      const height = ROW_PAD * 2 + count * BLOCK_H + (count - 1) * SLOT_GAP;
      out.push({ member, top, height, slots });
      top += height;
    }
    return out;
  }, [swarm, now, msPerPx]);
  const laneOf = useMemo(() => new Map(lanes.map((lane) => [lane.member.id, lane])), [lanes]);
  const rowsH = POINT_H + lanes.reduce((sum, lane) => sum + lane.height, 0);
  // The right edge says "now", or when the swarm went quiet; a tick label too close to it would collide.
  const edge = axis.live ? "now" : `Quiet after ${stampWithDay(axis.lastActivityAt, now)}`;
  const ticks = axis.ticks.filter((tick) => px(tick.at) < W - (axis.live ? 48 : edge.length * 6.4 + 28));

  const blockTop = (lane: LaneLayout, askId: string) => lane.top + ROW_PAD + (lane.slots.get(askId) ?? 0) * (BLOCK_H + SLOT_GAP);
  const focusAsk = focus?.kind === "ask" ? focus.id : selectedId;
  const focusLane = focus?.kind === "lane" ? focus.id : null;
  const asksById = useMemo(() => new Map(swarm.asks.map((ask) => [ask.id, ask])), [swarm]);
  // The asks that moved the same code as the focused one: who opened it, who worked on it, who reviewed it.
  const linked = (focusAsk ? links.get(focusAsk) ?? [] : []).flatMap((link) => {
    const ask = asksById.get(link.askId);
    return ask && laneOf.has(ask.memberId) ? [{ link, ask }] : [];
  });
  const linkedIds = new Set(linked.map(({ ask }) => ask.id));
  const related = (ask: SwarmAsk) => ask.id === focusAsk || linkedIds.has(ask.id) || (focusLane !== null && (ask.memberId === focusLane || ask.fromMemberId === focusLane));
  const anyFocus = focusAsk !== null || focusLane !== null;
  const shown = swarm.asks.find((ask) => ask.id === focusAsk) ?? null;
  const center = (ask: SwarmAsk) => blockTop(laneOf.get(ask.memberId)!, ask.id) + BLOCK_H / 2;
  // A crowded board keeps only the lines that say more than the blocks do; see swarm-drops.ts.
  // An ask sent before the window has no send on the axis to draw a line from; see swarm-point.ts.
  const drawn = dropsToDraw(swarm.asks.filter((ask) => laneOf.has(ask.memberId) && sentInWindow(ask, start)).map((ask) => ({
    id: ask.id,
    x: px(ask.askedAt),
    open: ask.open,
    fromLane: ask.fromMemberId !== null && laneOf.has(ask.fromMemberId),
    related: related(ask),
  })), W);

  // The point row quotes each ask sent in the window where there is room, and marks it where there is not.
  const pointAsks = placePointAsks(swarm.asks.filter((ask) => ask.fromMemberId === null || !laneOf.has(ask.fromMemberId)), { start, x: px, width: W })
    .map((place) => ({ ...place, ask: asksById.get(place.id)! }));

  return (
    <div className="swarm-lanes">
      <div className="swarm-axis">
        <div className="swarm-axis__label">{focusLane ? <span className="swarm-axis__hint">Showing asks for {laneOf.get(focusLane)?.member.name}</span> : null}</div>
        <div className="swarm-axis__track">
          {ticks.map((tick) => <span key={tick.at} className={`swarm-tick${tick.day ? " is-day" : ""}`} style={{ left: px(tick.at) }}>{tick.day ? dayLabel(tick.at) : clock(tick.at)}</span>)}
          <span className={`swarm-tick ${axis.live ? "is-now" : "is-end"}`}>{edge}</span>
        </div>
      </div>

      <div className="swarm-rows" style={{ height: rowsH }}>
        <div className="swarm-overlay" ref={trackRef}>
          {ticks.map((tick) => <i key={tick.at} className="swarm-gridline" style={{ left: px(tick.at) }} />)}
          {axis.live ? <i className="swarm-nowline" /> : null}
          <svg className="swarm-svg" width={W} height={rowsH} aria-hidden="true">
            <defs>
              <marker id="swarm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M0,0.5 L8,4 L0,7.5 z" fill="currentColor" />
              </marker>
            </defs>
            {swarm.asks.map((ask) => {
              const lane = laneOf.get(ask.memberId);
              if (!lane || !drawn.has(ask.id)) return null;
              const x = px(ask.askedAt);
              const y2 = blockTop(lane, ask.id);
              const fromLane = ask.fromMemberId ? laneOf.get(ask.fromMemberId) : undefined;
              const y1 = fromLane ? fromLane.top + fromLane.height / 2 : POINT_H - 8;
              const on = related(ask);
              const d = fromLane ? `M${x},${y1} C${x},${(y1 + y2) / 2} ${x + 12},${(y1 + y2) / 2} ${x + 12},${y2}` : `M${x},${y1} L${x},${y2}`;
              return <path key={ask.id} className={`swarm-drop${on ? " is-on" : anyFocus ? " is-dim" : ""}${ask.open ? " is-open" : ""}`} d={d} markerEnd={on ? "url(#swarm-arrow)" : undefined} />;
            })}
            {shown && shown.endedAt !== null && laneOf.has(shown.memberId) ? (() => {
              const lane = laneOf.get(shown.memberId)!;
              const x = px(shown.endedAt!);
              const fromLane = shown.fromMemberId ? laneOf.get(shown.fromMemberId) : undefined;
              const y2 = fromLane ? fromLane.top + fromLane.height / 2 : POINT_H - 8;
              return <path className="swarm-back" d={`M${x},${blockTop(lane, shown.id)} L${x},${y2}`} markerEnd="url(#swarm-arrow)" />;
            })() : null}
            {shown && laneOf.has(shown.memberId) ? linked.map(({ link, ask }) => {
              // Code moves forward in time: the link runs from the earlier ask to the later one.
              const [early, late] = ask.askedAt < shown.askedAt ? [ask, shown] : [shown, ask];
              const x1 = Math.min(W, Math.max(px(early.askedAt) + MIN_BLOCK_W, px(early.endedAt ?? now)));
              return <path key={link.askId} className={`swarm-link is-${link.role}`} d={linkPath(x1, center(early), px(late.askedAt), center(late))} markerEnd="url(#swarm-arrow)" />;
            }) : null}
          </svg>
        </div>

        <div className="swarm-row swarm-row--point" style={{ height: POINT_H }}>
          <div className="swarm-label is-static">
            <span className="swarm-tile is-point"><b>{letters(swarm.point.name)}</b></span>
            <span className="swarm-label__text">
              <span className="swarm-name">{swarm.point.name}</span>
              <span className="swarm-say">Asks through {swarm.point.via}</span>
            </span>
          </div>
          <div className="swarm-track">
            {pointAsks.map(({ ask, x, label, quote }) => quote ? (
              <button key={ask.id} type="button" className={`swarm-quote${quote === "before" ? " is-before" : ""}${related(ask) ? " is-on" : anyFocus ? " is-dim" : ""}`} style={{ left: x }}
                title={`${clock(ask.askedAt)}: ${ask.title}`}
                onMouseEnter={() => setFocus({ kind: "ask", id: ask.id })} onMouseLeave={() => setFocus(null)} onClick={() => onSelect(ask.id)}>
                {label}
              </button>
            ) : (
              <button key={ask.id} type="button" className={`swarm-mark${related(ask) ? " is-on" : anyFocus ? " is-dim" : ""}`} style={{ left: x }} aria-label={ask.title} title={`${clock(ask.askedAt)}: ${ask.title}`}
                onMouseEnter={() => setFocus({ kind: "ask", id: ask.id })} onMouseLeave={() => setFocus(null)} onClick={() => onSelect(ask.id)} />
            ))}
          </div>
        </div>

        {lanes.map((lane) => (
          <Lane key={lane.member.id} lane={lane} px={px} W={W} now={now} deeds={deeds}
            dim={anyFocus && focusLane !== lane.member.id && !(shown && (shown.memberId === lane.member.id || shown.fromMemberId === lane.member.id))
              && !linked.some(({ ask }) => ask.memberId === lane.member.id)}
            selectedId={selectedId}
            onFocusLane={(on) => setFocus(on ? { kind: "lane", id: lane.member.id } : null)}
            onFocusAsk={(id) => setFocus(id ? { kind: "ask", id } : null)}
            onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function Lane({ lane, px, W, now, deeds, dim, selectedId, onFocusLane, onFocusAsk, onSelect }: {
  lane: LaneLayout;
  px: (at: number) => number;
  W: number;
  now: number;
  deeds: ReadonlyMap<string, AskDeed>;
  dim: boolean;
  selectedId: string | null;
  onFocusLane: (on: boolean) => void;
  onFocusAsk: (id: string | null) => void;
  onSelect: (askId: string | null) => void;
}) {
  const { member } = lane;
  const runtime = runtimePhrase(member);
  // Where each block ends, per row, so a caption knows how much room it has.
  const placed = member.asks.map((ask) => {
    const start = px(ask.askedAt);
    const right = Math.min(W, Math.max(start + MIN_BLOCK_W, px(ask.endedAt ?? now)));
    const left = Math.max(0, Math.min(start, right - MIN_BLOCK_W));
    return { ask, left, width: right - left, slot: lane.slots.get(ask.id) ?? 0 };
  });
  // A lane whose last reply opened or reviewed pull requests says that, as the story does.
  const last = member.asks.at(-1);
  const lastDeed = member.status === "done" && last ? deeds.get(last.id) : undefined;
  const say = lastDeed ? deedSentence(lastDeed, { ago: `${spanWords(now - member.since)} ago` }) : member.sentence;
  return (
    <div className={`swarm-row is-${member.status}${dim ? " is-dim" : ""}`} style={{ height: lane.height }}
      onMouseEnter={() => onFocusLane(true)} onMouseLeave={() => onFocusLane(false)}>
      <button type="button" className="swarm-label" onClick={() => onSelect(last?.id ?? null)}
        title={[member.about ? `${member.name}: ${member.about}` : member.place ? `${member.name} in ${member.place}` : member.name, say, runtime].filter(Boolean).join("\n")}>
        <span className="swarm-tile">
          <b>{member.mark ?? letters(member.name)}</b>
          {member.harness ? <span className="swarm-coin"><HarnessMark harness={member.harness} size={9} title={null} /></span> : null}
        </span>
        <span className="swarm-label__text">
          <span className="swarm-name">
            {member.name}
            {member.about ? <em className="is-about">{member.about}</em> : member.place ? <em>{member.place}</em> : null}
          </span>
          <span className={`swarm-say is-${member.status}`}>{say}</span>
        </span>
      </button>
      <div className="swarm-track">
        {placed.map(({ ask, left, width, slot }) => {
          const next = placed.find((other) => other.slot === slot && other.left > left);
          const room = (next ? next.left : W) - (left + width) - 8;
          // The pull requests this ask opened or reviewed lead its words, so the code stays readable when the title is cut.
          const deed = deeds.get(ask.id);
          const code = deed?.refs.map((pr) => pr.key).join(" ") ?? "";
          // A review says its verdict where the title would only repeat the pull request.
          const words = (deed && deed.refs.length > 0 ? deed.verdict : null) ?? ask.title;
          const did = deed ? deedSentence(deed) : "";
          // A block too narrow to hold its code whole says it beside the block instead.
          const inside = width >= Math.max(64, code.length * 6.2 + 22);
          const caption = !inside && room >= 72;
          const word = ask.state === "failed" ? "failed" : ask.state === "cancelled" ? "cancelled" : ask.state === "queued" ? "queued"
            : ask.silence ? (ask.silence.finished ? "finished" : "silent") : askStops(ask) ? "stopped" : null;
          return (
            <span key={ask.id}>
              <button type="button"
                className={`swarm-ask is-${askTone(ask)}${ask.id === selectedId ? " is-selected" : ""}`}
                style={{ left, width, top: ROW_PAD + slot * (BLOCK_H + SLOT_GAP) }}
                aria-label={`${ask.title}. ${askSentence(ask, now)}.${did ? ` ${did}.` : ""}`}
                title={`${ask.title}\n${askSentence(ask, now)}${did ? `\n${did}` : ""}`}
                onMouseEnter={() => onFocusAsk(ask.id)} onMouseLeave={() => onFocusAsk(null)}
                onClick={(event) => { event.stopPropagation(); onSelect(ask.id); }}>
                {inside && code ? <span className="swarm-ask__pr">{code}</span> : null}
                {inside ? <span className="swarm-ask__title">{words}</span> : null}
                {inside && word ? <span className="swarm-ask__word">{word}</span> : null}
              </button>
              {caption ? (
                <span className="swarm-caption" style={{ left: left + width + 6, top: ROW_PAD + slot * (BLOCK_H + SLOT_GAP), maxWidth: room }}>
                  {word ? <em>{word}</em> : null}{code ? <em className="is-pr">{code}</em> : null}{words}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function AskPanel({ swarm, ask, now, pulls, states, onClose }: {
  swarm: Swarm;
  ask: SwarmAsk;
  now: number;
  pulls: readonly SwarmPull[];
  states: ReadonlyMap<string, SwarmPullState>;
  onClose: () => void;
}) {
  const member = swarm.members.find((m) => m.id === ask.memberId);
  const agent = swarm.agents.get(ask.agentId);
  const name = agent?.name ?? ask.agentId;
  const from = ask.from !== null ? swarm.agents.get(ask.from)?.name ?? ask.from
    : swarm.members.find((m) => m.id === ask.fromMemberId)?.name ?? swarm.point.name;
  const where = member?.about
    ? [member.name, agent?.place ? `in ${agent.place}` : null].filter(Boolean).join(", ")
    : agent?.place ? `Works in ${agent.place}` : "Agent";
  const runtime = agent ? runtimePhrase(agent) : null;
  const started = ask.startedAt !== null && ask.startedAt - ask.askedAt > 30_000 ? `, started ${clock(ask.startedAt)}` : "";
  const endWord = ask.state === "failed" ? "failed" : ask.state === "cancelled" ? "cancelled" : askStops(ask) ? "stopped" : "replied";
  const ended = ask.endedAt !== null ? `, ${endWord} ${clock(ask.endedAt)}` : "";
  return (
    <aside className="swarm-panel" aria-label={`Ask to ${name}`}>
      <header className="swarm-panel__head">
        <span className="swarm-tile">
          <b>{letters(name)}</b>
          {agent?.harness ? <span className="swarm-coin"><HarnessMark harness={agent.harness} size={9} title={null} /></span> : null}
        </span>
        <div className="swarm-panel__who">
          <b>{name}</b>
          <span>{where}</span>
        </div>
        <button type="button" className="swarm-panel__close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <h2 className="swarm-panel__title">{ask.title}</h2>
      <p className={`swarm-panel__state is-${askTone(ask)}`}>{askSentence(ask, now)}</p>
      <p className="swarm-panel__meta">{from} asked at {clock(ask.askedAt)}{started}{ended}.</p>
      {runtime ? <p className="swarm-panel__meta">{runtime}.</p> : null}
      <AskCode swarm={swarm} ask={ask} pulls={pulls} states={states} now={now} />
      <section className="swarm-panel__section">
        <h3>Asked</h3>
        {ask.task ? <div className="swarm-panel__text"><AskMarkup text={ask.task} /></div> : <p className="swarm-panel__quiet">The ask has no text.</p>}
      </section>
      <section className="swarm-panel__section">
        <h3>Reply</h3>
        {ask.reply ? <div className="swarm-panel__text"><AskMarkup text={ask.reply} /></div> : <p className="swarm-panel__quiet">{ask.open ? "No reply yet." : ask.state === "failed" ? "No reply." : "The reply carried no text."}</p>}
      </section>
      <nav className="swarm-panel__links">
        {ask.conversationId ? <a href={`/c/${encodeURIComponent(ask.conversationId)}`}>Open the chat</a> : null}
        {ask.workId ? <a href={`/work/${encodeURIComponent(ask.workId)}`}>Open the work</a> : null}
        <a href={`/agents/${encodeURIComponent(ask.agentId)}?tab=observe`}>Watch the session</a>
      </nav>
    </aside>
  );
}
