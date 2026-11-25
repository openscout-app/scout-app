import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api, peekApiGet } from "../../lib/api.ts";
import { AGENT_ROSTER_EVENT_KINDS, FLEET_EVENT_KINDS, matchesKinds } from "../../lib/broker-event-kinds.ts";
import { createBrokerRefreshController, type BrokerRefreshPolicy } from "../../lib/broker-refresh-controller.ts";
import { loadFleet } from "../../lib/fleet-store.ts";
import { isBrokerEventStreamLive, useBrokerEvents, type BrokerEvent } from "../../lib/sse.ts";
import { isScoutSurfaceActive, isScoutSurfaceVisible, onScoutSurfaceActivated } from "../../lib/surface-activity.ts";
import type { TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { ServiceGauge } from "./HomeHero.tsx";
import type { HeartrateReading } from "./home-derive.ts";
import { createHomeFeed, HOME_WARM_MS, type HomeFeed, type HomeFeedState } from "./home-feed.ts";
import { loadHomeSource } from "./home-loading.ts";
import { readHomeLayoutHint } from "./home-layout-hint.ts";

/*
 * The React side of home-feed.ts: one set of Home reads for HomeContent and
 * every Home panel on a view, however many there are.
 */

// Fleet + roster + heartrate. Heartrate has no event of its own, so the live
// net stays at 30s rather than relaxing further.
export const HOME_FLEET_REFRESH_POLICY: BrokerRefreshPolicy = {
  matches: matchesKinds(FLEET_EVENT_KINDS, AGENT_ROSTER_EVENT_KINDS),
  fallbackPollMs: 15_000,
  livePollMs: 30_000,
  // The cockpit is a watch surface: left open on a second screen it must not
  // freeze ("Last updated 1h") just because focus is in another app.
  activeWhen: "visible",
};

let feed: HomeFeed | null = null;
export function homeFeed(): HomeFeed {
  feed ??= createHomeFeed({
    fetchFleet: (query) => loadFleet(query),
    fetchHeartrate: () => api<HeartrateReading>("/api/heartrate"),
    // The server owns provider freshness and request coalescing, so Home can
    // read cheaply without holding an hour-old snapshot.
    fetchGauges: async (force) =>
      (await api<{ gauges?: ServiceGauge[] }>(`/api/service-budgets${force ? "?refresh=1" : ""}`, { cache: "no-store" })).gauges ?? [],
    fetchTailRecent: async (query) => (await api<{ events?: TailEvent[] }>(`/api/tail/recent?${query}`)).events ?? [],
    fetchTailDiscovery: () => api<TailDiscoverySnapshot>("/api/tail/discover"),
    peek: (path) => peekApiGet(path, HOME_WARM_MS),
    retry: (label, read, trace, options) => loadHomeSource(label, read, trace, options),
    rememberedLookback: () => readHomeLayoutHint().lookback,
    now: () => Date.now(),
    visible: () => isScoutSurfaceVisible(),
    active: () => isScoutSurfaceActive(),
    setInterval: (run, ms) => globalThis.setInterval(run, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    watchBroker: (refresh) => {
      const controller = createBrokerRefreshController({
        refresh,
        policy: () => HOME_FLEET_REFRESH_POLICY,
        isActive: () => isScoutSurfaceVisible(),
        isLive: isBrokerEventStreamLive,
        scheduler: {
          now: () => Date.now(),
          setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
          clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      });
      // tick at the tighter of the two rates; the controller decides whether a read is due
      const tick = globalThis.setInterval(
        () => controller.onTick(),
        Math.min(HOME_FLEET_REFRESH_POLICY.fallbackPollMs, HOME_FLEET_REFRESH_POLICY.livePollMs),
      );
      const stopActivation = onScoutSurfaceActivated(() => controller.onActivated());
      return {
        onEvent: (event) => controller.onEvent(event as BrokerEvent),
        stop: () => {
          globalThis.clearInterval(tick);
          stopActivation();
          controller.dispose();
        },
      };
    },
    onActivated: (run) => onScoutSurfaceActivated(run),
    onFocus: (run) => {
      const whenVisible = () => {
        if (document.visibilityState === "visible") run();
      };
      window.addEventListener("focus", whenVisible);
      document.addEventListener("visibilitychange", whenVisible);
      return () => {
        window.removeEventListener("focus", whenVisible);
        document.removeEventListener("visibilitychange", whenVisible);
      };
    },
  });
  return feed;
}

export type HomeFeedHandle = HomeFeedState & {
  store: HomeFeed;
};

/** Home's reads: counted in while mounted, the roster reloaded beside the fleet, broker events forwarded. */
export function useHomeFeed(): HomeFeedHandle {
  const store = homeFeed();
  // subscribed before it mounts, so the mount's own reads are seen
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { reload, apiConnection } = useScout();
  // bound before the first read, so the roster loads beside the fleet as it always did
  useEffect(() => store.bindRoster(reload), [store, reload]);
  useEffect(() => store.mount(), [store]);
  useEffect(() => {
    store.trace(`Scout connection: ${apiConnection.status}`);
  }, [store, apiConnection.status]);
  // every reader forwards; the net's debounce makes a burst one read
  useBrokerEvents((event) => store.onBrokerEvent(event));
  return useMemo(() => ({ ...state, store }), [state, store]);
}
