/**
 * Activity — the Activity page's log: what happened, who did it, newest first.
 *
 * Shows:  Events · Actors · Threads and the sync line, then each record:
 *         when (relative and full), its group (Presence, Execution, Delivery,
 *         Coordination, System) and kind, what happened and the summary, who
 *         and where, and its Open links (thread, work, agent, session, Follow,
 *         Terminal). Harness verdicts stay out, as on the page. A picked
 *         record opens in Activity details beside it, or under its row when
 *         there is none, this panel is in full view, or (on /activity, where
 *         details follows the page) the pick is this panel's own. States: reading,
 *         unavailable (Try again), Refresh failed over the last snapshot,
 *         nothing yet, nothing in this scope. Head: the count, Refresh, and
 *         Open full off /activity. Right-click a record: copy and open.
 * Data:   GET /api/activity (the 60 newest records), one loop shared by the
 *         Activity page and every Activity and Activity details panel: warm
 *         from a read under 30s old, read again once per burst of broker data
 *         events, every 15s while the window is visible, and on Refresh
 *         (screens/activity/activity-feed.ts).
 * Scope:  Project (workspace root) and Kind (the log's groups). follow =
 *         "@route": on /activity the URL's ?event= is the selection, written
 *         with replace. Otherwise the pick is kept in settings (event, state)
 *         and never touches the URL.
 *         Either way the page's ?machineId= narrows the log.
 * Opens:  a record: its details. Its links: the thread, the work item, the
 *         agent, the session, Follow, a terminal. Open full: /activity with
 *         the pick open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ActivityItem } from "../../../lib/types.ts";
import { ActivityLog, activityFeedNote } from "../../activity/ActivityScreen.tsx";
import { useActivityFeed, useActivityRows } from "../../activity/use-activity-feed.ts";
import {
  ACTIVITY_CATEGORY_KEY,
  ACTIVITY_EVENT_KEY,
  ACTIVITY_PROJECT_KEY,
  activityCategoryOptions,
  activityPanelMode,
  activityProjectOptions,
  activityRoute,
  offersOpenFull,
  onActivityPage,
  panelSelection,
  pickOpens,
} from "./activity-view-model.ts";
import { activityPicks } from "./activity-picks.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import "./activity-panels.css";

function useProjectOptions() {
  // the same loop the panel reads: no second poll for the picker
  const { items } = useActivityFeed();
  return useMemo(() => activityProjectOptions(items ?? []), [items]);
}

const CATEGORY_OPTIONS = activityCategoryOptions();

const projectScope: ModuleScope = { key: ACTIVITY_PROJECT_KEY, allLabel: "All projects", useOptions: useProjectOptions };
const categoryScope: ModuleScope = { key: ACTIVITY_CATEGORY_KEY, allLabel: "Every kind", useOptions: () => CATEGORY_OPTIONS };

function Activity({ instanceId, route, navigate, config, setConfig }: ModuleProps) {
  const project = config[ACTIVITY_PROJECT_KEY] ?? "";
  const category = config[ACTIVITY_CATEGORY_KEY] ?? "";
  const feed = useActivityRows({ project, category });
  const mode = activityPanelMode(config, route);
  const onPage = onActivityPage(route);
  const selectedId = panelSelection(config, route) || null;
  const root = useRef<HTMLDivElement>(null);

  // an Activity details panel on the view shows picks; without one they open under the row
  const detailsOnView = useSyncExternalStore(activityPicks.subscribe, activityPicks.watched, activityPicks.watched);
  // the last pick was made with this panel lifted over the grid, where details can't be seen
  const [pickedInFull, setPickedInFull] = useState(false);
  const inline = pickOpens({ detailsOnView, full: pickedInFull, ownOnPage: onPage && mode === "own" }) === "inline";

  const setConfigRef = useRef(setConfig);
  setConfigRef.current = setConfig;

  const clear = useCallback(() => {
    activityPicks.withdraw(instanceId);
    setConfigRef.current({ [ACTIVITY_EVENT_KEY]: "" });
  }, [instanceId]);

  // An own pick, restored from settings once the log has it: it shows in
  // Activity details beside this panel. It stays there if it ages out of the
  // 60 newest; it goes when cleared, or when the panel follows the page.
  const saved = mode === "own" && selectedId ? feed.rows.find((item) => item.id === selectedId) ?? null : null;
  const savedRef = useRef<ActivityItem | null>(saved);
  savedRef.current = saved;
  useEffect(() => {
    if (mode !== "own" || !selectedId) {
      activityPicks.withdraw(instanceId);
      return;
    }
    if (savedRef.current) activityPicks.publish(instanceId, { item: savedRef.current, clear }, false);
  }, [mode, selectedId, saved?.id, instanceId, clear]);
  // removed, replaced, or the view closed: details stop showing this panel's pick
  useEffect(() => () => activityPicks.withdraw(instanceId), [instanceId]);

  // a selection that arrives from elsewhere (a link with ?event=, a reload) scrolls into view
  const pickedHere = useRef<string | null>(null);
  const found = Boolean(selectedId) && feed.rows.some((item) => item.id === selectedId);
  useEffect(() => {
    if (!found || !selectedId || pickedHere.current === selectedId) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-activity-id="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [found, selectedId]);

  const onPick = (item: ActivityItem) => {
    const full = root.current?.closest(".hud-grid-panel")?.classList.contains("is-full") ?? false;
    const deselect = selectedId === item.id;
    setPickedInFull(full);
    pickedHere.current = deselect ? null : item.id;
    if (mode === "route") {
      // the page's selection: replace, so picking never piles up history
      navigate(activityRoute(deselect ? null : item.id), { replace: true });
      return;
    }
    // an own pick stays this panel's: it never moves the page or the panels following it
    if (deselect) clear();
    else {
      activityPicks.publish(instanceId, { item, clear }, true);
      setConfigRef.current({ [ACTIVITY_EVENT_KEY]: item.id });
    }
  };

  const note = activityFeedNote(feed);
  const reading = feed.loading && feed.rows.length === 0;
  return (
    <div ref={root} className="vw-activity">
      <ModuleHead>
        {!reading && (
          <span className="hud-grid-count" title={note}>
            {feed.rows.length}
          </span>
        )}
        <button
          type="button"
          className="vw-chip"
          disabled={feed.loading || feed.refreshing}
          onClick={feed.refresh}
          title={note}
        >
          {feed.refreshing ? "Refreshing..." : "Refresh"}
        </button>
        {offersOpenFull(route) && (
          <button
            type="button"
            className="vw-chip"
            onClick={() => navigate(activityRoute(selectedId))}
            title="Open the Activity page"
          >
            Open full
          </button>
        )}
      </ModuleHead>
      <ActivityLog
        feed={feed}
        navigate={navigate}
        panel={{ selectedId, onPick, inline, filtered: Boolean(project || category) }}
      />
    </div>
  );
}

export const activityModule = defineModule({
  type: "activity",
  title: "Activity",
  blurb: "What happened, who did it, newest first",
  docs: {
    shows: "Events, Actors, Threads; then each record: when, group and kind, what happened, who and where, its Open links. A pick opens in Activity details, or under its row.",
    data: "/api/activity (60 newest), one loop shared by every Activity panel: on broker data events, every 15s while visible, and on Refresh.",
    opens: "A record's details; its thread, work item, agent, session, Follow or terminal. Open full: /activity with the pick open.",
  },
  size: { w: 6, h: 16 },
  minSize: { w: 4, h: 8 },
  scopes: [projectScope, categoryScope],
  state: [ACTIVITY_EVENT_KEY],
  Component: Activity,
});
