import type { FleetState, TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";
import { agentLaneTailRecentLimit, type AgentLaneHorizonKey } from "../ops/agent-lanes-model.ts";
import type { ServiceGauge } from "./HomeHero.tsx";
import {
  fleetQueryFor,
  lookbackOptionFor,
  rememberedLookback,
  settledError,
  tailRecentQuery,
  type HeartrateBucket,
  type HeartrateReading,
} from "./home-derive.ts";
import { HOME_MOVING_HORIZON } from "./home-moving.ts";

/**
 * Home's reads, once, for everything that draws Home: HomeContent (basic web
 * and the Mac app's /embed/home) and every Home panel on a view (cockpit,
 * quotas, velocity, what's moving, coordination, message). Pure — fetch, the
 * cache peek, clocks, timers and the broker net come in — so the cadence and
 * race rules test without a DOM (home-feed.test.ts); the React side is
 * use-home-feed.ts.
 *
 *   - Counted: the first reader starts it and the last one stops it. A start
 *     paints at once from reads under 30s old (the same paths the reads use),
 *     then reads the fleet (with the coordination window), velocity and the
 *     roster together, quotas, and the local tail.
 *   - The fleet is read again on fleet and roster broker events (debounced
 *     by the net), with the net's timer under them: 15s while the event
 *     stream is down, 30s while it is up, while the page is visible.
 *     Quotas every 60s while visible, and on focus; the local tail every
 *     30s while Scout is in front; both again when Scout comes to the front.
 *     The clock ticks every second while visible.
 *   - The coordination window and the moving window are this visit's: a pick
 *     pins one, the auto window widens while nothing shows, and the last
 *     reader leaving forgets both. A changed window reads again at once.
 *   - A newer fleet or tail read supersedes an older one; a superseded answer
 *     is dropped. A failed fleet read keeps the last good fleet and says why;
 *     a failed velocity, quota or tail read keeps what was there.
 */

export type HomeTrace = { at: number; message: string };
export type HomeLoadMode = "initial" | "background" | "manual";

export type HomeFeedState = {
  /** null: nothing read yet. Unscoped; readers narrow it to the page's machine. */
  fleet: FleetState | null;
  /** The coordination window the fleet in hand was read with. */
  fleetLookbackMs: number | null;
  heartrate: HeartrateBucket[];
  heartrateWindow: string;
  heartrateBucketLabel: string;
  tailEvents: TailEvent[];
  tailDiscovery: TailDiscoverySnapshot | null;
  gauges: ServiceGauge[];
  /** The first quota read has answered (or failed). */
  gaugesSettled: boolean;
  /** The first local tail read has answered (or failed). */
  tailSettled: boolean;
  /** No fleet yet and one is on its way. */
  loading: boolean;
  /** A fleet read behind the one on screen. */
  refreshing: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  /** What the reads did, for a stalled or failed load (the newest 24). */
  trace: HomeTrace[];
  lookbackPick: number | null;
  lookbackAuto: number;
  movingPick: AgentLaneHorizonKey | null;
  movingAuto: AgentLaneHorizonKey;
  /** The clock every age on Home is measured against. */
  nowMs: number;
};

export type HomeBrokerNet = {
  /** A broker event: a matching one schedules a debounced read. */
  onEvent: (event: unknown) => void;
  stop: () => void;
};

type RetryOptions = { retries?: number; active?: () => boolean };

export type HomeFeedDeps = {
  fetchFleet: (query: string) => Promise<FleetState>;
  fetchHeartrate: () => Promise<HeartrateReading>;
  /** `force` asks the server to read every provider again (`?refresh=1`). */
  fetchGauges: (force: boolean) => Promise<ServiceGauge[]>;
  fetchTailRecent: (query: string) => Promise<TailEvent[]>;
  fetchTailDiscovery: () => Promise<TailDiscoverySnapshot>;
  /** A cached GET of this path under 30s old, for a warm start. */
  peek: <T>(path: string) => T | null;
  /** Bounded retry for a startup read, tracing each attempt (lib/api-retry.ts). */
  retry: <T>(label: string, read: () => Promise<T>, trace: (message: string) => void, options?: RetryOptions) => Promise<T>;
  /** The coordination window the last settled visit ended on. */
  rememberedLookback: () => number | undefined;
  now: () => number;
  /** The page is showing (it may be unfocused): the watch cadence. */
  visible: () => boolean;
  /** Scout is in front and focused. */
  active: () => boolean;
  setInterval: (run: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** Start the broker net over the fleet read. */
  watchBroker: (refresh: () => void) => HomeBrokerNet;
  /** Scout came to the front. Returns the stop. */
  onActivated: (run: () => void) => () => void;
  /** The window took focus or the page became visible. Returns the stop. */
  onFocus: (run: () => void) => () => void;
};

export type HomeFeed = {
  /** Stable until it changes, so React can read it as a snapshot. */
  get: () => HomeFeedState;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release (calling it twice releases once). */
  mount: () => () => void;
  /** Read the fleet, velocity and roster. */
  load: (mode?: HomeLoadMode) => Promise<void>;
  /** Refresh: the fleet again, and quotas with every provider read again. */
  refresh: () => void;
  /** The roster reload the fleet read runs beside (the app's agents). */
  bindRoster: (reload: () => Promise<unknown>) => void;
  onBrokerEvent: (event: unknown) => void;
  trace: (message: string) => void;
  setLookbackPick: (ms: number | null) => void;
  setLookbackAuto: (ms: number) => void;
  setMovingPick: (key: AgentLaneHorizonKey | null) => void;
  setMovingAuto: (key: AgentLaneHorizonKey) => void;
  readers: () => number;
};

export const HOME_WARM_MS = 30_000;
export const HOME_GAUGES_EVERY_MS = 60_000;
export const HOME_TAIL_EVERY_MS = 30_000;
export const HOME_CLOCK_EVERY_MS = 1_000;
/** Two activations this close are one (focus and visibility arrive together). */
export const HOME_ACTIVATION_GAP_MS = 1_000;
const TRACE_KEEP = 24;

export const lookbackOf = (s: Pick<HomeFeedState, "lookbackPick" | "lookbackAuto">): number => s.lookbackPick ?? s.lookbackAuto;
export const movingKeyOf = (s: Pick<HomeFeedState, "movingPick" | "movingAuto">): AgentLaneHorizonKey => s.movingPick ?? s.movingAuto;

export function homeFleetPath(lookbackMs: number): string {
  return `/api/fleet?${fleetQueryFor(lookbackOptionFor(lookbackMs))}`;
}

export function homeTailRecentPath(movingKey: AgentLaneHorizonKey): string {
  return `/api/tail/recent?${tailRecentQuery(agentLaneTailRecentLimit(movingKey))}`;
}

export function createHomeFeed(deps: HomeFeedDeps): HomeFeed {
  /** A fresh visit: warm from recent reads of the same paths, else nothing yet. */
  const fresh = (): HomeFeedState => {
    const lookbackAuto = rememberedLookback(deps.rememberedLookback());
    const movingAuto: AgentLaneHorizonKey = HOME_MOVING_HORIZON;
    const fleet = deps.peek<FleetState>(homeFleetPath(lookbackAuto));
    const heartrate = deps.peek<HeartrateReading>("/api/heartrate");
    const gauges = deps.peek<{ gauges?: ServiceGauge[] }>("/api/service-budgets");
    const tail = deps.peek<{ events?: TailEvent[] }>(homeTailRecentPath(movingAuto));
    const discovery = deps.peek<TailDiscoverySnapshot>("/api/tail/discover");
    return {
      fleet,
      fleetLookbackMs: fleet ? lookbackAuto : null,
      heartrate: heartrate?.buckets ?? [],
      heartrateWindow: heartrate?.windowLabel ?? "trailing 7d",
      heartrateBucketLabel: heartrate ? heartrate.bucketLabel ?? "" : "3h buckets",
      tailEvents: tail?.events ?? [],
      tailDiscovery: discovery,
      gauges: gauges?.gauges ?? [],
      gaugesSettled: gauges !== null,
      tailSettled: tail !== null,
      loading: fleet === null,
      refreshing: false,
      error: null,
      lastLoadedAt: null,
      trace: [],
      lookbackPick: null,
      lookbackAuto,
      movingPick: null,
      movingAuto,
      nowMs: deps.now(),
    };
  };

  let state: HomeFeedState | null = null;
  /** What a reader sees before it mounts: computed once per idle spell, so it holds still. */
  let idle: HomeFeedState | null = null;
  const listeners = new Set<() => void>();
  let count = 0;
  /** Counts mount sessions, so nothing from an earlier visit lands in a later one. */
  let session = 0;
  let fleetRequest = 0;
  /** The fleet read on its way, and whether a broker event asked for another behind it. */
  let inflight: Promise<void> | null = null;
  let again = false;
  let tailRequest = 0;
  let roster: (() => Promise<unknown>) | null = null;
  let net: HomeBrokerNet | null = null;
  let stops: Array<() => void> = [];
  let lastActivatedAt = Number.NEGATIVE_INFINITY;

  const current = (): HomeFeedState => (count > 0 && state ? state : (idle ??= fresh()));

  const set = (patch: Partial<HomeFeedState>) => {
    state = { ...current(), ...patch };
    for (const listener of [...listeners]) listener();
  };

  const trace = (message: string) => {
    const now = current();
    if (now.trace.at(-1)?.message === message) return;
    set({ trace: [...now.trace.slice(-(TRACE_KEEP - 1)), { at: deps.now(), message }] });
  };

  /**
   * A broker event while a read is on its way joins it, and one more read follows it: superseding the read would throw
   * away the answer the page is about to draw (the first read on a cold visit included) and make it wait a full round.
   * A manual read or a window change still supersedes, since the read on its way is the wrong one.
   */
  function load(mode: HomeLoadMode = "initial"): Promise<void> {
    if (mode === "background" && inflight) {
      again = true;
      return inflight;
    }
    const read = readFleet(mode);
    const settle = read.finally(() => {
      if (inflight !== settle) return;
      inflight = null;
      if (again && count > 0) {
        again = false;
        void load("background");
      }
    });
    again = false;
    inflight = settle;
    return settle;
  }

  async function readFleet(mode: HomeLoadMode): Promise<void> {
    const id = ++fleetRequest;
    const hasSnapshot = current().fleet !== null;
    if (!hasSnapshot) set({ loading: true, error: null });
    else set({ refreshing: true });

    const lookbackMs = lookbackOf(current());
    const query = fleetQueryFor(lookbackOptionFor(lookbackMs));
    const [fleetResult, heartrateResult] = await Promise.allSettled([
      deps.retry("Home activity", () => deps.fetchFleet(query), trace, {
        retries: hasSnapshot && mode === "background" ? 0 : 2,
        active: () => id === fleetRequest,
      }),
      deps.retry("Activity chart", () => deps.fetchHeartrate(), trace),
      roster ? roster() : Promise.resolve(),
    ]);
    if (id !== fleetRequest) return;

    const patch: Partial<HomeFeedState> = {
      // optional chart and roster reads never turn a good fleet read into an outage
      error: settledError(fleetResult),
      loading: false,
      refreshing: false,
    };
    if (fleetResult.status === "fulfilled") {
      patch.fleet = fleetResult.value;
      patch.fleetLookbackMs = lookbackOptionFor(lookbackMs).value;
      patch.lastLoadedAt = deps.now();
    }
    if (heartrateResult.status === "fulfilled" && heartrateResult.value) {
      patch.heartrate = heartrateResult.value.buckets;
      patch.heartrateWindow = heartrateResult.value.windowLabel;
      patch.heartrateBucketLabel = heartrateResult.value.bucketLabel ?? "";
    }
    set(patch);
  }

  /** Quotas are best effort: a failure keeps what was there. A quiet read leaves no trace lines. */
  async function loadGauges(options: { force?: boolean; quiet?: boolean } = {}): Promise<void> {
    const visit = session;
    const live = () => count > 0 && visit === session;
    if (!options.quiet) trace("Service budgets: requesting");
    try {
      const gauges = await deps.fetchGauges(options.force ?? false);
      if (!live()) return;
      set({ gauges, gaugesSettled: true });
      if (!options.quiet) trace("Service budgets: received");
    } catch {
      if (!live()) return;
      if (!options.quiet) {
        trace("Service budgets: unavailable; continuing without quotas");
        set({ gaugesSettled: true });
      }
    }
  }

  async function loadTail(): Promise<void> {
    const id = ++tailRequest;
    const isCurrent = () => count > 0 && id === tailRequest;
    trace("Local activity: requesting");
    const query = tailRecentQuery(agentLaneTailRecentLimit(movingKeyOf(current())));
    try {
      const [events, discovery] = await Promise.all([
        deps.fetchTailRecent(query),
        deps.fetchTailDiscovery().catch(() => null),
      ]);
      if (!isCurrent()) return;
      set(discovery ? { tailEvents: events, tailDiscovery: discovery, tailSettled: true } : { tailEvents: events, tailSettled: true });
      trace("Local activity: received");
    } catch {
      if (!isCurrent()) return;
      // the Local tail panel owns the visible error and empty state
      trace("Local activity: unavailable; Home activity can still load");
      set({ tailSettled: true });
    }
  }

  function start() {
    void load("initial");
    void loadGauges();
    void loadTail();
    const gaugesTimer = deps.setInterval(() => {
      if (deps.visible()) void loadGauges();
    }, HOME_GAUGES_EVERY_MS);
    const tailTimer = deps.setInterval(() => {
      if (deps.active()) void loadTail();
    }, HOME_TAIL_EVERY_MS);
    const clock = deps.setInterval(() => {
      if (deps.visible()) set({ nowMs: deps.now() });
    }, HOME_CLOCK_EVERY_MS);
    net = deps.watchBroker(() => void load("background"));
    stops = [
      () => deps.clearInterval(gaugesTimer),
      () => deps.clearInterval(tailTimer),
      () => deps.clearInterval(clock),
      deps.onActivated(() => {
        const now = deps.now();
        if (now - lastActivatedAt < HOME_ACTIVATION_GAP_MS) return;
        lastActivatedAt = now;
        // the fleet itself comes back through the broker net
        void loadGauges({ quiet: true });
        void loadTail();
      }),
      deps.onFocus(() => {
        if (deps.active()) void loadGauges();
      }),
    ];
  }

  function stop() {
    for (const s of stops) s();
    stops = [];
    net?.stop();
    net = null;
    session += 1;
    // nobody is left to draw an answer still on its way
    fleetRequest += 1;
    inflight = null;
    again = false;
    tailRequest += 1;
    lastActivatedAt = Number.NEGATIVE_INFINITY;
    state = null;
    idle = null;
  }

  function mount(): () => void {
    count += 1;
    if (count === 1) {
      state = idle ?? fresh();
      idle = null;
      start();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      count -= 1;
      if (count === 0) stop();
    };
  }

  /** A window change on a live feed reads again at once. */
  function pickLookback(patch: Partial<HomeFeedState>) {
    const before = lookbackOf(current());
    set(patch);
    if (count > 0 && lookbackOf(current()) !== before) void load("initial");
  }

  function pickMoving(patch: Partial<HomeFeedState>) {
    const before = movingKeyOf(current());
    set(patch);
    if (count > 0 && movingKeyOf(current()) !== before) void loadTail();
  }

  return {
    get: current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount,
    load,
    refresh: () => {
      void load("manual");
      void loadGauges({ force: true, quiet: true });
    },
    bindRoster: (reload) => {
      roster = reload;
    },
    onBrokerEvent: (event) => net?.onEvent(event),
    trace,
    setLookbackPick: (ms) => pickLookback({ lookbackPick: ms }),
    setLookbackAuto: (ms) => pickLookback({ lookbackAuto: ms }),
    setMovingPick: (key) => pickMoving({ movingPick: key }),
    setMovingAuto: (key) => pickMoving({ movingAuto: key }),
    readers: () => count,
  };
}
