import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { MessageComposer, MessageComposerToolSelect, RuntimePicker } from "../../components/MessageComposer/index.ts";
import { api } from "../../lib/api.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { filterAgentsByMachineScope, filterFleetByMachineScope, machineScopedAgentIds } from "../../lib/machine-scope.ts";
import { useObservePolling } from "../../lib/observe.ts";
import { routeForFleetAsk } from "../../lib/operator-attention.ts";
import { usePersistentString } from "../../lib/persistent-state.ts";
import { readRecentProjectRoots, rememberProjectRoot } from "../../lib/project-recency.ts";
import {
  createRuntimeCatalogLoader,
  RUNTIME_CAPABILITY_SEED,
  runtimeCatalogFromCapabilities,
  runtimeCatalogNotice,
  runtimeModelCatalogStatus,
  type RuntimeCapabilityCatalog,
} from "../../lib/runtime-capabilities.ts";
import { effortsFor, type RuntimeValue } from "../../lib/runtime-catalog.ts";
import { compareTimestampsDesc, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";
import type { Agent, FleetActivity, FleetAsk, FleetState, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { AgentLane, AgentLaneHorizonKey } from "../ops/agent-lanes-model.ts";
import { TailView } from "../shared/TailView.tsx";
import {
  activityVerb,
  computeActivityShape,
  COORD_ROW_LIMIT,
  DEFAULT_LOOKBACK_MS,
  fleetActivityRoute,
  formatAge,
  scrubActivityIds,
  formatDuration,
  formatLookback,
  generatedNameSource,
  latestAskByAgent,
  liveActivityFrom,
  LOOKBACK_WINDOWS,
  lookbackOptionFor,
  movingAsksFrom,
  movingCountLabel,
  nextLookbackOption,
  observedMovingActorsFrom,
  operatorNameFrom,
  settledLookbackFor,
  syncLabelFor,
  type LookbackOption,
} from "./home-derive.ts";
import { lookbackOf, movingKeyOf } from "./home-feed.ts";
import type { HomeLayoutHint } from "./home-layout-hint.ts";
import { writeHomeLayoutHint } from "./home-layout-hint.ts";
import {
  buildHomeNativeMovingLanes,
  compareHomeMovingItems,
  dedupeWorkingAgentsByObservedSession,
  HOME_MOVING_CARD_LIMIT,
  HOME_MOVING_DEFAULT_SORT,
  HOME_MOVING_WINDOW_OPTIONS,
  homeMovingRecencyMs,
  homeMovingWindowOption,
  isFreshHomeMovingTimestamp,
  isHomeAgentMoving,
  isHomeObserveCandidate,
  laneObservedSessionKey,
  normalizeHomeMovingSort,
  normalizeHomeMovingWindowKey,
  observedSessionKey,
  plainTextExcerpt,
  type HomeMovingSortMode,
} from "./home-moving.ts";
import { HomeMovingSignalList } from "./home-moving-signal.tsx";
import {
  buildHomeMessageProjects,
  defaultHomeMessageProject,
  homeMessageAgentRoot,
  homeMessageProjectDetail,
  homeMessageProjectRecipient,
  readHomeMessageLastRecipient,
  rememberHomeMessageRecipient,
  type HomeMessageRecency,
} from "./home-message-recipient.ts";
import type { HomeFeedHandle } from "./use-home-feed.ts";

/*
 * Home's panels, as parts: What's moving, Scout coordination, the cockpit's
 * controls and the Message composer. HomeContent lays them out (the grid in
 * the Mac app's /embed/home, stacked on basic web); the Home modules on a view
 * (screens/views/modules/home-*.tsx) draw one each. Both read one Home feed
 * (use-home-feed.ts), so the rules and the reads are the same wherever a
 * panel sits.
 */

/** One Home panel: its head (count, controls) and its body. */
export type HomePanelParts = {
  /** The first answer for what it shows is still out: the body holds skeleton rows. */
  pending: boolean;
  /** The head's count chip. */
  count?: string;
  /** The stacked layout's section label, count included. */
  label: string;
  right: ReactNode;
  body: ReactNode;
};

// The skeletons already say Home is loading; the trace is for a real stall.
// Quota gauges routinely take a few seconds, and a shorter delay flashed a
// gray band across the bottom of the page on ordinary loads.
export const HOME_TRACE_DELAY_MS = 8_000;
// The auto ladder for What's moving skips 5m: it is a pick, never a default.
const MOVING_WINDOW_LADDER: AgentLaneHorizonKey[] = ["30m", "4h", "24h"];
export const MOVING_SORT_STORAGE_KEY = "openscout.home.movingSort.v1";

type Navigate = (route: Route) => void;

/** The agents and fleet narrowed to one machine ("" or null: every machine). */
export function useHomeScope(fleet: FleetState | null, machineId: string | null) {
  const { agents: allAgents } = useScout();
  const scopedAgentIds = useMemo(() => machineScopedAgentIds(allAgents, machineId), [allAgents, machineId]);
  const agents = useMemo(() => filterAgentsByMachineScope(allAgents, machineId), [allAgents, machineId]);
  const scopedFleet = useMemo(() => filterFleetByMachineScope(fleet, scopedAgentIds), [fleet, scopedAgentIds]);
  return { agents, scopedFleet };
}

/** True once a load has been out this long: a stall, worth showing the trace for. */
export function useStalledLoad(loading: boolean, delayMs = HOME_TRACE_DELAY_MS): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!loading) {
      setStalled(false);
      return;
    }
    const timer = window.setTimeout(() => setStalled(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [loading, delayMs]);
  return stalled;
}

/** Writes what a part settled on into the layout hint, once it has settled and whenever that changes. */
export function useLayoutHintWrite(settled: boolean, hint: Partial<HomeLayoutHint>): void {
  const latest = useRef(hint);
  latest.current = hint;
  // an undefined field is a change too (lookback while the window moves): it clears the field
  const key = JSON.stringify(hint, (_key, value: unknown) => (value === undefined ? null : value));
  useEffect(() => {
    if (settled) writeHomeLayoutHint(latest.current);
  }, [settled, key]);
}

/* ── The cockpit ─────────────────────────────────────────────────────── */

export type HomeCockpit = {
  operatorName: string;
  syncLabel: string;
  refresh: () => void;
  retry: () => void;
  startNewChat: () => void;
};

export function useHomeCockpit(feed: HomeFeedHandle, navigate: Navigate, basic = false): HomeCockpit {
  const { onboarding, openContextCapture } = useScout();
  const { store } = feed;
  // Inside the Mac app the native composer owns new chats (⌘N); in a browser
  // the web one opens.
  const startNewChat = useCallback(() => {
    const native = (window as unknown as {
      webkit?: { messageHandlers?: { scoutNativeUI?: { postMessage: (message: unknown) => void } } };
    }).webkit?.messageHandlers?.scoutNativeUI;
    if (native) {
      try {
        native.postMessage({ kind: "ui-action", action: { type: "new-chat" } });
        return;
      } catch {
        // Fall through to the web composer.
      }
    }
    // Basic mounts no context-capture overlay; a new chat starts in DMs.
    if (basic) {
      navigate({ view: "messages" });
      return;
    }
    openContextCapture();
  }, [basic, navigate, openContextCapture]);
  const retry = useCallback(() => void store.load("manual"), [store]);
  return {
    operatorName: operatorNameFrom(onboarding),
    syncLabel: syncLabelFor(feed, feed.nowMs),
    refresh: store.refresh,
    retry,
    startNewChat,
  };
}

/* ── What's moving ───────────────────────────────────────────────────── */

type HomeMovingCardItem =
  | { bucket: "working"; id: string; agent: Agent; lastActivityAt: number }
  | { bucket: "native"; id: string; lane: AgentLane; lastActivityAt: number }
  | { bucket: "observed"; id: string; actor: FleetActivity; lastActivityAt: number };

export type HomeMovingParts = HomePanelParts & {
  /** Rows on screen, for the layout hint. */
  rows: number;
};

/**
 * What's moving: working agents, native sessions and observed actors in the
 * moving window, then asks still out with no working agent. The auto window
 * widens 30m → 4h → 24h while nothing shows; a pick pins it for the visit.
 */
export function useHomeMoving(input: {
  feed: HomeFeedHandle;
  agents: Agent[];
  scopedFleet: FleetState | null;
  operatorName: string;
  navigate: Navigate;
  layoutHint: HomeLayoutHint;
  basic?: boolean;
}): HomeMovingParts {
  const { feed, agents, scopedFleet, operatorName, navigate, layoutHint, basic = false } = input;
  const { store, nowMs, tailEvents, tailDiscovery, loading, tailSettled, movingPick } = feed;
  const movingWindowKey = movingKeyOf(feed);
  const movingWindow = homeMovingWindowOption(movingWindowKey);
  const [movingSortRaw, setMovingSortRaw] = usePersistentString(MOVING_SORT_STORAGE_KEY, HOME_MOVING_DEFAULT_SORT);
  const movingSort = normalizeHomeMovingSort(movingSortRaw);

  const movingAsks = useMemo(() => movingAsksFrom(scopedFleet), [scopedFleet]);
  const freshMovingAsks = useMemo(
    () => movingAsks.filter((ask) => isFreshHomeMovingTimestamp(ask.updatedAt, nowMs, movingWindow.windowMs)),
    [movingAsks, movingWindow.windowMs, nowMs],
  );
  const movingAskByAgent = useMemo(() => latestAskByAgent(freshMovingAsks), [freshMovingAsks]);
  const observeCandidates = useMemo(
    () =>
      agents.filter((agent) =>
        isHomeObserveCandidate(agent, nowMs, movingAskByAgent.has(agent.id), tailEvents, movingWindow.windowMs, movingWindowKey),
      ),
    [agents, movingAskByAgent, movingWindow.windowMs, movingWindowKey, nowMs, tailEvents],
  );
  const observeCache = useObservePolling(observeCandidates);
  const workingAgents = useMemo(() => {
    const recency = (agent: Agent) =>
      homeMovingRecencyMs(agent, { observeEntry: observeCache[agent.id], tailEvents, nowMs, movingAsk: movingAskByAgent.get(agent.id) });
    const moving = agents
      .filter((agent) =>
        isHomeAgentMoving({
          agent,
          observeEntry: observeCache[agent.id],
          tailEvents,
          nowMs,
          movingAsk: movingAskByAgent.get(agent.id),
          windowMs: movingWindow.windowMs,
        }),
      )
      .sort((left, right) => recency(right) - recency(left));
    return dedupeWorkingAgentsByObservedSession(moving, observeCache);
  }, [agents, movingAskByAgent, movingWindow.windowMs, observeCache, tailEvents, nowMs]);
  const workingAgentIds = useMemo(() => new Set(workingAgents.map((agent) => agent.id)), [workingAgents]);
  const workingSessionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const agent of workingAgents) {
      const key = observedSessionKey(observeCache[agent.id]);
      if (key) keys.add(key);
    }
    return keys;
  }, [observeCache, workingAgents]);
  const nativeMovingLanes = useMemo<AgentLane[]>(() => {
    const lanes = buildHomeNativeMovingLanes({
      agents,
      tailEvents,
      transcripts: tailDiscovery?.transcripts ?? [],
      processes: tailDiscovery?.processes ?? [],
      observeCache,
      nowMs,
      horizon: movingWindowKey,
    });
    return lanes
      .filter((lane) => {
        if (workingAgentIds.has(lane.agent.id)) return false;
        const laneKey = laneObservedSessionKey(lane);
        return !(laneKey && workingSessionKeys.has(laneKey));
      })
      .sort((left, right) => right.lastActiveAt - left.lastActiveAt);
  }, [agents, movingWindowKey, observeCache, nowMs, tailDiscovery, tailEvents, workingAgentIds, workingSessionKeys]);
  const movingAsksWithoutWorkingAgent = useMemo(
    () =>
      freshMovingAsks
        .filter((ask) => !workingAgentIds.has(ask.agentId))
        .sort((left, right) => compareTimestampsDesc(left.updatedAt, right.updatedAt)),
    [workingAgentIds, freshMovingAsks],
  );
  // Native and unmanaged actors seen in the firehose; managed agents draw as working rows.
  const observedMovingActors = useMemo(
    () =>
      observedMovingActorsFrom({
        activity: scopedFleet?.activity,
        agents,
        operatorName,
        cutoffMs: nowMs - movingWindow.windowMs,
      }),
    [scopedFleet?.activity, movingWindow.windowMs, nowMs, agents, operatorName],
  );

  const movingCards = useMemo<HomeMovingCardItem[]>(() => {
    const cards: HomeMovingCardItem[] = [
      ...workingAgents.map((agent) => ({
        bucket: "working" as const,
        id: agent.id,
        agent,
        lastActivityAt: homeMovingRecencyMs(agent, {
          observeEntry: observeCache[agent.id],
          tailEvents,
          nowMs,
          movingAsk: movingAskByAgent.get(agent.id),
        }),
      })),
      ...nativeMovingLanes.map((lane) => ({ bucket: "native" as const, id: lane.id, lane, lastActivityAt: lane.lastActiveAt })),
      ...observedMovingActors.map((actor) => ({
        bucket: "observed" as const,
        id: actor.id,
        actor,
        lastActivityAt: normalizeTimestampMs(actor.ts) ?? 0,
      })),
    ];
    return cards.sort((left, right) => compareHomeMovingItems(left, right, movingSort));
  }, [movingAskByAgent, movingSort, nativeMovingLanes, nowMs, observeCache, observedMovingActors, tailEvents, workingAgents]);
  const visibleMovingCards = movingCards.slice(0, HOME_MOVING_CARD_LIMIT);
  const movingCardCount = visibleMovingCards.length;
  const totalMovingCount = movingCards.length + movingAsksWithoutWorkingAgent.length;

  // Rows join fleet, tail and discovery; until the first fleet and tail
  // answers land, an empty list means "not known yet".
  const nextMovingWindow = MOVING_WINDOW_LADDER[MOVING_WINDOW_LADDER.indexOf(movingWindowKey) + 1];
  const movingWidening = movingPick === null && totalMovingCount === 0 && nextMovingWindow !== undefined;
  useEffect(() => {
    if (!movingWidening || loading || !tailSettled || !nextMovingWindow) return;
    store.setMovingAuto(nextMovingWindow);
  }, [movingWidening, loading, tailSettled, nextMovingWindow, store]);
  // While the window is still widening the section holds its skeleton
  // instead of flashing "nothing in the last 30m".
  const pending = (loading || !tailSettled || movingWidening) && totalMovingCount === 0;
  const count = movingCountLabel(movingCardCount, totalMovingCount);
  // a first read that failed outright: say so here rather than "nothing moving"
  const failed = !feed.fleet && Boolean(feed.error) && !loading;

  const right = (
    <div className="s-moving-controls">
      <MovingControls
        sort={movingSort}
        onSortChange={setMovingSortRaw}
        windowKey={movingWindow.key}
        onWindowChange={(key) => store.setMovingPick(normalizeHomeMovingWindowKey(key))}
      />
      {/* basic web has no Tail beside it; on the grid the Tail panel is right there, and Network is in the rail */}
      {basic && (
        <button type="button" className="s-link-btn" onClick={() => navigate({ view: "ops", mode: "tail" })}>
          View Tail
        </button>
      )}
    </div>
  );
  const body = failed ? (
    <div className="s-fleet-live-empty s-fleet-live-empty--error" role="status">
      <span className="s-fleet-live-empty-title">Couldn’t read what’s moving</span>
      <span className="s-fleet-live-empty-detail" title={feed.error ?? undefined}>{feed.error}</span>
    </div>
  ) : pending ? (
    <MovingSkeleton rows={layoutHint.moving} />
  ) : totalMovingCount === 0 ? (
    <div className="s-fleet-live-empty home-arrive" role="status">
      <span>Nothing moving in the last {movingWindow.key}.</span>
    </div>
  ) : (
    <div className="home-arrive">
      {movingCardCount > 0 && (
        <HomeMovingSignalList
          cards={visibleMovingCards}
          sort={movingSort}
          nowMs={nowMs}
          movingAskByAgent={movingAskByAgent}
          observeCache={observeCache}
          navigate={navigate}
        />
      )}
      {movingAsksWithoutWorkingAgent.length > 0 && (
        <div className="s-moving-ask-list">
          {movingAsksWithoutWorkingAgent.map((ask) => (
            <MovingAskRow key={ask.invocationId} ask={ask} navigate={navigate} />
          ))}
        </div>
      )}
    </div>
  );
  return {
    pending,
    count: pending ? undefined : count,
    label: pending ? "What's moving" : `What's moving · ${count}`,
    right,
    body,
    rows: movingCardCount + movingAsksWithoutWorkingAgent.length,
  };
}

/* ── Scout coordination ──────────────────────────────────────────────── */

export type HomeCoordinationParts = HomePanelParts & {
  /** Whether the stacked layout draws the section (a settled, empty 24h hides it). */
  shown: boolean;
  /** Nothing in the window, it has stopped widening: the quiet start (Message) is offered. */
  quiet: boolean;
  /** Rows drawn, for the layout hint. */
  rows: number;
  /** The window the next visit should open on, once settled. */
  settledLookback: number | null;
};

/**
 * Scout coordination: the window's messages and dispatches, newest first, then
 * its shape once (count or cap, longest gap). The auto window widens 30m → 6h →
 * 24h while it is empty; a pick pins it for the visit.
 */
export function useHomeCoordination(input: {
  feed: HomeFeedHandle;
  scopedFleet: FleetState | null;
  navigate: Navigate;
  layoutHint: HomeLayoutHint;
}): HomeCoordinationParts {
  const { feed, scopedFleet, navigate, layoutHint } = input;
  const { store, nowMs, loading, refreshing, error, fleetLookbackMs, lookbackPick, lookbackAuto } = feed;
  const lookbackMs = lookbackOf(feed);
  const lookbackOption = lookbackOptionFor(lookbackMs);
  const next = nextLookbackOption(lookbackMs);
  const liveActivity = useMemo(() => liveActivityFrom(scopedFleet?.activity, nowMs - lookbackMs), [scopedFleet?.activity, nowMs, lookbackMs]);
  const activityShape = useMemo(() => computeActivityShape(liveActivity, lookbackMs, nowMs), [liveActivity, lookbackMs, nowMs]);
  const capReached = liveActivity.length >= lookbackOption.activityLimit;
  const answered = fleetLookbackMs === lookbackMs;
  const widening = lookbackPick === null && !error && liveActivity.length === 0 && next !== null;
  useEffect(() => {
    if (!widening || loading || !answered || !next) return;
    store.setLookbackAuto(next.value);
  }, [widening, loading, answered, next, store]);
  // Also pending while the answer for the window on screen is still out: the
  // last widening step has no next step, and would otherwise flash the empty
  // line (and lift the tail) before its rows land.
  const pending = (loading || widening || !answered) && liveActivity.length === 0;
  const settledEmpty = !loading && !error && liveActivity.length === 0 && answered;
  const hideEmpty = settledEmpty && lookbackMs >= DEFAULT_LOOKBACK_MS;
  const quiet = settledEmpty && (lookbackPick !== null || lookbackMs >= DEFAULT_LOOKBACK_MS);
  const count = `${liveActivity.length}${capReached ? "+" : ""}`;
  const widen = (option: LookbackOption) => store.setLookbackPick(option.value);

  const right = <LookbackPicker value={lookbackMs} onChange={store.setLookbackPick} refreshing={refreshing && !loading} />;
  const body = (
    <>
      {pending ? (
        <ActivityStreamSkeleton rows={layoutHint.activity} />
      ) : liveActivity.length === 0 ? (
        <LiveActivityEmpty lookbackMs={lookbackMs} nextOption={next} onWiden={widen} error={error} onRetry={() => void store.load("manual")} />
      ) : (
        <div className="s-mc-stream s-fleet-live-stream home-arrive">
          {liveActivity.slice(0, COORD_ROW_LIMIT).map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              nowMs={nowMs}
              onOpen={() => {
                const route = fleetActivityRoute(item);
                if (route) navigate(route);
              }}
            />
          ))}
          {/* The window's shape, said once under its last row: how many, the
              longest quiet stretch, and the next window one click away when
              there is one. The newest row's own time says how recent. */}
          <div className="s-fleet-live-end">
            <span>
              {capReached
                ? `showing ${Math.min(liveActivity.length, COORD_ROW_LIMIT)} of ${lookbackOption.activityLimit}+ (capped)`
                : liveActivity.length > COORD_ROW_LIMIT
                  ? `showing ${COORD_ROW_LIMIT} of ${liveActivity.length}`
                  : `${liveActivity.length === 1 ? "1 event" : `${liveActivity.length} events`} in the last ${formatLookback(lookbackMs)}`}
              {activityShape && ` · longest gap ${formatDuration(activityShape.longestGapMs)}`}
            </span>
            {next && !capReached && liveActivity.length <= COORD_ROW_LIMIT && (
              <button type="button" className="s-link-btn" onClick={() => widen(next)}>
                widen to {next.label}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
  return {
    pending,
    count: pending ? undefined : count,
    label: pending ? "Scout coordination" : `Scout coordination · ${count}`,
    right,
    body,
    shown: loading || liveActivity.length > 0 || Boolean(error) || !hideEmpty,
    quiet,
    rows: Math.min(liveActivity.length, COORD_ROW_LIMIT),
    settledLookback: settledLookbackFor({ pick: lookbackPick, widening, answered, liveActivity, nowMs, auto: lookbackAuto }),
  };
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

/** Home's sections use the shared rule (components/SectionRule.tsx). */
export { SectionRule } from "../../components/SectionRule.tsx";

function MovingControls({
  sort,
  onSortChange,
  windowKey,
  onWindowChange,
}: {
  sort: HomeMovingSortMode;
  onSortChange: (next: string) => void;
  windowKey: string;
  onWindowChange: (next: string) => void;
}) {
  return (
    <div className="s-moving-controlset" aria-label="Moving cards controls">
      <div className="s-mc-window s-moving-window" role="group" aria-label="Moving sort">
        <span className="s-mc-window-label">Sort</span>
        <div className="s-mc-window-tabs">
          {([
            ["recent", "Recent"],
            ["grouped", "Grouped"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`s-mc-window-tab${sort === key ? " is-active" : ""}`}
              aria-pressed={sort === key}
              onClick={() => onSortChange(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="s-mc-window s-moving-window" role="group" aria-label="Moving activity window">
        <span className="s-mc-window-label">Window</span>
        <div className="s-mc-window-tabs">
          {HOME_MOVING_WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`s-mc-window-tab${windowKey === opt.key ? " is-active" : ""}`}
              aria-pressed={windowKey === opt.key}
              onClick={() => onWindowChange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MovingAskRow({ ask, navigate }: { ask: FleetAsk; navigate: Navigate }) {
  const route = routeForFleetAsk(ask);
  return (
    <button type="button" className="s-moving-ask-row" onClick={() => navigate(route)}>
      <span className="s-moving-ask-time">{timeAgo(ask.updatedAt)}</span>
      <span aria-hidden="true" />
      <span className="s-moving-ask-agent">{ask.agentName ?? ask.agentId}</span>
      <span className="s-moving-ask-title">{ask.summary ?? ask.task}</span>
      <span className="s-moving-ask-state">{ask.statusLabel}</span>
    </button>
  );
}

function LookbackPicker({
  value,
  onChange,
  refreshing,
}: {
  value: number;
  onChange: (next: number) => void;
  refreshing?: boolean;
}) {
  return (
    <div className="s-mc-window" role="group" aria-label="Lookback window">
      <span className="s-mc-window-label">
        Lookback
        {refreshing && <span className="s-mc-window-refreshing" aria-label="refreshing" />}
      </span>
      <div className="s-mc-window-tabs">
        {LOOKBACK_WINDOWS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`s-mc-window-tab${opt.value === value ? " is-active" : ""}`}
            aria-pressed={opt.value === value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Skeleton rows wear the real row classes and hold an invisible line of text,
   so each placeholder is exactly as tall as the row that replaces it. */
function MovingSkeleton({ rows }: { rows: number }) {
  if (rows === 0) {
    return (
      <div className="s-fleet-live-empty" aria-hidden="true">
        <span className="home-skel" style={{ width: 180 }} />
        {" "}
      </div>
    );
  }
  return (
    <div className="s-moving-signal-stage s-moving-signal-skeleton" aria-hidden="true">
      <div className="s-moving-signal-list">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="s-moving-signal-item">
            <div className="s-moving-signal-row s-moving-signal-row--skeleton">
              <span className="s-moving-signal-age"><span className="home-skel" style={{ width: 28 }} />{" "}</span>
              <span className="home-skel home-skel--dot" />
              <span className="s-moving-signal-where"><span className="s-moving-signal-project"><span className="home-skel" style={{ width: 84 }} />{" "}</span></span>
              <span className="s-moving-signal-action" style={{ width: `${40 + ((i * 17) % 30)}%` }}><span className="home-skel" style={{ width: "70%" }} />{" "}</span>
              <span><span className="home-skel" style={{ width: 32 }} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityStreamSkeleton({ rows }: { rows: number }) {
  return (
    <div className="s-mc-stream s-fleet-live-stream s-fleet-live-stream--skeleton" aria-hidden="true">
      {Array.from({ length: Math.max(rows, 3) }, (_, i) => (
        <div key={i} className="s-mc-stream-row">
          <span className="s-mc-stream-time"><span className="home-skel" style={{ width: 20 }} />{" "}</span>
          <span className="s-mc-stream-mark" />
          <span className="s-mc-stream-actor"><span className="home-skel" style={{ width: 96 }} /></span>
          <span className="s-mc-stream-text"><span className="home-skel" style={{ width: `${52 + ((i * 23) % 40)}%` }} /></span>
          <span className="s-mc-stream-verb"><span className="home-skel" style={{ width: 72 }} /></span>
        </div>
      ))}
    </div>
  );
}

function LiveActivityEmpty({
  lookbackMs,
  nextOption,
  onWiden,
  error,
  onRetry,
}: {
  lookbackMs: number;
  nextOption: LookbackOption | null;
  onWiden: (opt: LookbackOption) => void;
  error: string | null;
  onRetry: () => void;
}) {
  // Empty and error both collapse to one quiet line: "nothing happened"
  // should cost a line, not a box. Freshness already lives in the cockpit's
  // "Last updated" readout, so it is not repeated here.
  if (error) {
    return (
      <div className="s-fleet-live-empty s-fleet-live-empty--error" role="status">
        <span className="s-fleet-live-empty-title">Couldn’t load activity</span>
        <span className="s-fleet-live-empty-detail" title={error}>{error}</span>
        <button type="button" className="s-link-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="s-fleet-live-empty" role="status">
      <span className="s-fleet-live-empty-title">No Scout messages or dispatches in the last {formatLookback(lookbackMs)}</span>
      {nextOption && (
        <button type="button" className="s-link-btn" onClick={() => onWiden(nextOption)}>
          Widen to {nextOption.label}
        </button>
      )}
    </div>
  );
}

function ActivityRow({
  item,
  nowMs,
  onOpen,
}: {
  item: FleetActivity;
  nowMs: number;
  onOpen: () => void;
}) {
  // Every row says who: a folded sender left the time standing alone.
  const generatedId = generatedNameSource(item.actorName, [item.actorId, item.agentId]);
  const actor = generatedId ?? item.actorName ?? "—";
  const verb = activityVerb(item.kind);
  const text = plainTextExcerpt(scrubActivityIds(item.title ?? item.summary ?? ""), 110);
  return (
    <button type="button" className="s-mc-stream-row" onClick={onOpen}>
      <span className="s-mc-stream-time">{formatAge(item.ts, nowMs)}</span>
      <span className="s-mc-stream-mark" aria-hidden="true" />
      <span className={`s-mc-stream-actor${generatedId ? " s-mc-stream-actor--id" : ""}`}>{actor}</span>
      <span className="s-mc-stream-text">{text}</span>
      <span className="s-mc-stream-verb">{verb}</span>
    </button>
  );
}

/* ── Message ─────────────────────────────────────────────────────────── */

type QuietSendResult = {
  conversationId?: string;
  flight?: { targetAgentId?: string | null };
};

/** A message to one agent, in its chat: To, the text, runtime, Send. Send opens the chat. */
export function QuietStartPanel({ agents, navigate, head = true }: { agents: Agent[]; navigate: Navigate; head?: boolean }) {
  // Read once per mount and updated in place on a pick or a send, so the list
  // and the default agree without re-reading storage on every render.
  const [recency, setRecency] = useState<HomeMessageRecency>(() => ({
    lastAgentId: readHomeMessageLastRecipient(),
    recentRoots: readRecentProjectRoots(),
  }));
  // One row per project; a message goes to the project's agent (home-message-recipient.ts).
  const projects = useMemo(() => buildHomeMessageProjects(agents, recency), [agents, recency]);
  // Preselected only from the operator's own history; otherwise it reads "Choose a project".
  const [projectKey, setProjectKey] = useState(() => defaultHomeMessageProject(projects, recency)?.key ?? "");
  const selectedProject = projects.find((project) => project.key === projectKey) ?? null;
  const selectedAgent = homeMessageProjectRecipient(selectedProject);
  // A pick records the project; a send also records the agent it reached.
  // A default the panel chose is never recorded.
  const rememberProject = (agent: Agent | null, sent: boolean) => {
    if (sent && agent) rememberHomeMessageRecipient(agent.id);
    const root = agent ? homeMessageAgentRoot(agent) : null;
    setRecency((current) => ({
      lastAgentId: sent && agent ? agent.id : current.lastAgentId,
      recentRoots: root ? rememberProjectRoot(root) : readRecentProjectRoots(),
    }));
  };
  const pickProject = (nextKey: string) => {
    setProjectKey(nextKey);
    const project = projects.find((candidate) => candidate.key === nextKey);
    if (project) rememberProject(homeMessageProjectRecipient(project), false);
  };
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilityCatalog | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelRefreshError, setModelRefreshError] = useState<string | null>(null);
  const runtimeCatalogLoaderRef = useRef(createRuntimeCatalogLoader<RuntimeCapabilityCatalog>());
  const [prompt, setPrompt] = useState("");
  const [harness, setHarness] = useState(selectedAgent?.harness?.trim() ?? "");
  const [model, setModel] = useState(selectedAgent?.model?.trim() ?? "");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const effectiveCapabilities = runtimeCapabilities ?? RUNTIME_CAPABILITY_SEED;

  useEffect(() => {
    if (projects.some((project) => project.key === projectKey)) return;
    setProjectKey(defaultHomeMessageProject(projects, recency)?.key ?? "");
  }, [projectKey, projects, recency]);

  useEffect(() => {
    setHarness(selectedAgent?.harness?.trim() ?? "");
    setModel(selectedAgent?.model?.trim() ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent?.id]);

  const refreshRuntimeModels = async () => {
    const query = new URLSearchParams({ scope: "global+project", force: "true" });
    const projectRoot = selectedAgent?.projectRoot?.trim() || selectedAgent?.cwd?.trim();
    if (projectRoot) query.set("projectRoot", projectRoot);
    setRefreshingModels(true);
    setModelRefreshError(null);
    await runtimeCatalogLoaderRef.current.load(() => api<RuntimeCapabilityCatalog>(`/api/runner/options?${query}`), {
      publish: setRuntimeCapabilities,
      failed: () => setModelRefreshError("Model refresh is unavailable. Your draft and saved choices are kept."),
      finished: () => setRefreshingModels(false),
    });
  };

  useEffect(() => {
    const projectRoot = selectedAgent?.projectRoot?.trim() || selectedAgent?.cwd?.trim();
    const query = new URLSearchParams({ scope: "global+project" });
    if (projectRoot) query.set("projectRoot", projectRoot);
    const loader = runtimeCatalogLoaderRef.current;
    setRefreshingModels(false);
    setModelRefreshError(null);
    void loader.load(() => api<RuntimeCapabilityCatalog>(`/api/runner/options?${query}`), {
      publish: (options) => {
        if (options.schemaVersion === "openscout.runtime-capabilities.v1") setRuntimeCapabilities(options);
      },
    });
    return () => {
      loader.invalidate();
    };
  }, [selectedAgent?.cwd, selectedAgent?.projectRoot]);

  const effectiveHarness = harness || selectedAgent?.harness?.trim() || "";
  // The picker runs on a nested catalog. The selected agent's observed runtime
  // may predate the capability snapshot, so an unlisted harness is appended —
  // the offline fallback the old flat option lists provided.
  const runtimeCatalog = useMemo(() => {
    const catalog = runtimeCatalogFromCapabilities(effectiveCapabilities);
    if (effectiveHarness && !catalog.harnesses.some((entry) => entry.value === effectiveHarness)) {
      return {
        ...catalog,
        harnesses: [
          ...catalog.harnesses,
          { value: effectiveHarness, label: effectiveHarness, models: [{ value: "", label: "Default", note: "harness setting" }] },
        ],
      };
    }
    return catalog;
  }, [effectiveCapabilities, effectiveHarness]);

  // Outside user interaction (capabilities arriving, agent switching) the
  // picker never sees a change event, so the effort clamp lives here.
  useEffect(() => {
    const efforts = effortsFor(runtimeCatalog, effectiveHarness, model);
    if (!efforts || efforts.some((candidate) => candidate.value === reasoningEffort)) return;
    setReasoningEffort(efforts.find((candidate) => candidate.value === "medium")?.value ?? efforts[0]?.value ?? "");
  }, [runtimeCatalog, effectiveHarness, model, reasoningEffort]);

  const submitMessage = async () => {
    const trimmed = prompt.trim();
    if (!selectedAgent || !trimmed || submitting) return;
    setSubmitting(true);
    setSendError(null);
    rememberProject(selectedAgent, true);
    try {
      const conversationId = await ensureAgentChat(selectedAgent);
      const result = await api<QuietSendResult>("/api/send", {
        method: "POST",
        body: JSON.stringify({
          body: trimmed,
          chatId: conversationId,
          execution: {
            harness: harness || undefined,
            model: model || undefined,
            reasoningEffort: reasoningEffort || undefined,
          },
        }),
      });
      // This screen stays alive while navigation moves into the conversation.
      // Clear only after Scout accepted the send, so returning here starts a
      // genuinely new message while a failed request remains available to retry.
      setPrompt("");
      navigate({ view: "conversation", conversationId: result.conversationId ?? conversationId });
    } catch (submitError) {
      setSendError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="s-quiet-panel s-quiet-panel--ask">
      {head && (
        <div className="s-quiet-panel-head">
          <span className="s-eyebrow">Message</span>
        </div>
      )}
      <div className="s-quiet-compose">
        {/* Home has no host composer, so it draws its own inside an embed too
            (the Mac app's /embed/home). Only the thread defers to the host. */}
        <MessageComposer
          renderWhenEmbedded
          density="panel"
          value={prompt}
          onChange={setPrompt}
          onSend={() => void submitMessage()}
          placeholder="Type a message…"
          disabled={submitting || projects.length === 0}
          sending={submitting}
          canSend={!submitting && Boolean(selectedAgent) && prompt.trim().length > 0}
          leadingTools={(
            /* Target rides in the toolbar like every other composer control
               (main-composer grammar) — not as a bar above the input. */
            <div className="s-quiet-target-chip">
              <span className="s-quiet-label">Project</span>
              <MessageComposerToolSelect
                label="Send to project"
                value={projectKey}
                onChange={pickProject}
                disabled={projects.length === 0 || submitting}
                options={projects.length === 0
                  ? [{ value: "", label: "No projects with an agent" }]
                  : [
                      ...(selectedProject ? [] : [{ value: "", label: "Choose a project" }]),
                      ...projects.map((project) => ({
                        value: project.key,
                        label: project.label,
                        detail: homeMessageProjectDetail(project, projects),
                      })),
                    ]}
              />
            </div>
          )}
          tools={(
            /* Right cluster: runtime · mic · Send. One chip replaces the
               harness and model selects — the harness reads as its mark. */
            <RuntimePicker
              catalog={runtimeCatalog}
              onRefreshModels={() => { void refreshRuntimeModels(); }}
              refreshingModels={refreshingModels}
              catalogStatus={runtimeModelCatalogStatus(runtimeCapabilities)}
              catalogWarning={runtimeCatalogNotice(runtimeCapabilities, modelRefreshError)}
              value={{ harness: effectiveHarness, model, effort: reasoningEffort }}
              onChange={(nextValue: RuntimeValue) => {
                // "" keeps its meaning: run on the agent's own runtime.
                setHarness(nextValue.harness === (selectedAgent?.harness?.trim() ?? "") ? "" : nextValue.harness);
                setModel(nextValue.model);
                setReasoningEffort(nextValue.effort);
              }}
              disabled={submitting || !selectedAgent}
            />
          )}
        />
      </div>
      {sendError && <div className="s-quiet-error">{sendError}</div>}
    </div>
  );
}

/** Local tail on basic Home. Always mounted — independent of coordination state. */
export function LocalTailPanel({ navigate }: { navigate: Navigate }) {
  return (
    <div className="s-quiet-panel s-quiet-panel--tail">
      <div className="s-quiet-panel-head">
        <span className="s-eyebrow">Local tail</span>
        <OpenTailButton navigate={navigate} />
      </div>
      <div className="s-quiet-tail-frame">
        <TailView navigate={navigate} chrome="embedded" density="compact" />
      </div>
    </div>
  );
}

export function OpenTailButton({ navigate }: { navigate: Navigate }) {
  return (
    <button type="button" className="s-icon-btn" title="Open tail" onClick={() => navigate({ view: "ops", mode: "tail" })}>
      <ExternalLink size={14} aria-hidden="true" />
      <span>Open tail</span>
    </button>
  );
}
