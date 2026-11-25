import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { foldAskEchoes } from "../../lib/activity-echoes.ts";
import { api, peekApiGet } from "../../lib/api.ts";
import { machineScopedAgentIds } from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { isBrokerDataEvent, useBrokerEvents } from "../../lib/sse.ts";
import type { ActivityItem } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import {
  ACTIVITY_PATH,
  ACTIVITY_WARM_MS,
  createActivityFeed,
  type ActivityFeed,
  type ActivityFeedState,
} from "./activity-feed.ts";
import { visibleActivity } from "./activity-model.ts";

/*
 * The React side of activity-feed.ts: one /api/activity loop for the page,
 * and for every Activity panel on a view, however many there are.
 */

let feed: ActivityFeed | null = null;
function activityFeed(): ActivityFeed {
  feed ??= createActivityFeed({
    // One ask is one row (activity-echoes.ts), not its work item, message and invocation.
    fetch: async () => foldAskEchoes(await api<ActivityItem[]>(ACTIVITY_PATH)),
    peek: () => {
      const cached = peekApiGet<ActivityItem[]>(ACTIVITY_PATH, ACTIVITY_WARM_MS);
      return cached ? foldAskEchoes(cached) : null;
    },
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return feed;
}

export type ActivityFeedHandle = ActivityFeedState & {
  /** Read again now (Refresh, Try again). */
  refresh: () => void;
};

/** The shared activity list: counted in while mounted, read again on broker data events. */
export function useActivityFeed(): ActivityFeedHandle {
  const store = activityFeed();
  // subscribed before it mounts, so the mount's own read is seen
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => store.mount(), [store]);
  useBrokerEvents((event) => {
    if (isBrokerDataEvent(event)) store.scheduleRefresh();
  });
  const refresh = useCallback(() => void store.load("manual"), [store]);
  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

export type ActivityRows = ActivityFeedHandle & {
  /** What the list shows: the page's machine, the panel's project and group, newest first. */
  rows: ActivityItem[];
};

/**
 * The shared list as one list shows it. The machine is the page's
 * (?machineId=), as the Activity page always kept it; project and group are a
 * panel's own.
 */
export function useActivityRows(filter: { project?: string; category?: string } = {}): ActivityRows {
  const { agents, route } = useScout();
  const handle = useActivityFeed();
  const machineId = routeMachineId(route);
  const agentIds = useMemo(() => machineScopedAgentIds(agents, machineId), [agents, machineId]);
  const { project = "", category = "" } = filter;
  const rows = useMemo(
    () => visibleActivity(handle.items ?? [], { agentIds, project, category }),
    [agentIds, category, handle.items, project],
  );
  return { ...handle, rows };
}
