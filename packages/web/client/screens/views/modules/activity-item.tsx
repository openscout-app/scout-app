/**
 * Activity details — the record picked in Activity, in full.
 *
 * Shows:  when it happened (relative and full), its group and kind, what
 *         happened and the summary, who and where; then every id it carries
 *         (Event, Recorded, Actor, Agent, Workspace, Thread, Work, Session,
 *         Flight, Invocation, Record id) and Open for each page it links to,
 *         with Terminal. Head: Clear, and Open full off /activity. With
 *         nothing picked: how to pick one. A pick no longer in recent
 *         activity says so. Right-click: copy and open, as on the log.
 * Data:   the pick: on /activity the URL's ?event=, anywhere else the latest
 *         pick of an Activity panel on the same view (activity-picks.ts). The
 *         record from the shared /api/activity loop the Activity panels read
 *         (no read of its own). While it is on the view, Activity panels open
 *         picks here instead of under the row.
 * Scope:  none; one per view. It follows the Activity page, or the Activity
 *         panel beside it.
 * Opens:  Open: the record's thread, work item, agent, session, Follow, or a
 *         terminal. Open full: /activity with the record open.
 */
import { useEffect, useSyncExternalStore } from "react";
import { fullTimestamp, timeAgo } from "../../../lib/time.ts";
import type { ActivityItem } from "../../../lib/types.ts";
import { ActivityDetails, ActivityHeadline, useActivityMenu } from "../../activity/ActivityEntry.tsx";
import { ACTIVITY_CATEGORY_META, activityCategory } from "../../activity/activity-model.ts";
import { useActivityFeed } from "../../activity/use-activity-feed.ts";
import { activityPicks } from "./activity-picks.ts";
import { activityRoute, detailsSource, offersOpenFull, pageActivityEventId } from "./activity-view-model.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "../../system-surfaces-redesign.css";
import "./activity-panels.css";

function ActivityRecord({ item, route, navigate }: { item: ActivityItem } & Pick<ModuleProps, "route" | "navigate">) {
  const onMenu = useActivityMenu(navigate, route);
  const tone = ACTIVITY_CATEGORY_META[activityCategory(item.kind)].tone;
  return (
    <article className="vw-activity-record" data-activity-id={item.id} onContextMenu={(e) => onMenu(e, item)}>
      <header className="vw-activity-record-head">
        <div className="sys-audit-stamp">
          <span className="sys-audit-time">{timeAgo(item.ts)}</span>
          <span className="sys-audit-date">{fullTimestamp(item.ts)}</span>
        </div>
        <div className={`sys-audit-marker sys-audit-marker-${tone}`}>
          <span />
        </div>
        <div className="sys-audit-body">
          <ActivityHeadline item={item} />
        </div>
      </header>
      <ActivityDetails item={item} navigate={navigate} returnTo={route} terminal />
    </article>
  );
}

function ActivityItemPanel({ route, navigate }: ModuleProps) {
  // while this panel is here, Activity panels send their picks to it
  useEffect(() => activityPicks.watch(), []);
  const pick = useSyncExternalStore(activityPicks.subscribe, activityPicks.latest, activityPicks.latest);
  const feed = useActivityFeed();
  const fromPage = detailsSource(route) === "route";
  const id = fromPage ? pageActivityEventId(route) : pick?.item.id ?? "";
  // the freshest copy from the shared loop; a pick that aged out keeps the copy it was picked with
  const item = id
    ? feed.items?.find((candidate) => candidate.id === id) ?? (!fromPage && pick?.item.id === id ? pick.item : null)
    : null;

  const clear = () => {
    if (fromPage) navigate(activityRoute(null), { replace: true });
    else pick?.clear();
  };

  return (
    <div className="vw-activity-item">
      <ModuleHead>
        {id && (
          <button type="button" className="vw-chip" onClick={clear} title="Close this record">
            Clear
          </button>
        )}
        {offersOpenFull(route) && item && (
          <button type="button" className="vw-chip" onClick={() => navigate(activityRoute(item.id))} title="Open this record on the Activity page">
            Open full
          </button>
        )}
      </ModuleHead>
      {!id ? (
        <Quiet>Pick an event in Activity and its details open here.</Quiet>
      ) : item ? (
        <ActivityRecord item={item} route={route} navigate={navigate} />
      ) : !feed.items ? (
        <Quiet>{feed.error ? `Couldn't read activity: ${feed.error}` : "Reading activity..."}</Quiet>
      ) : (
        <Quiet>That event isn't in recent activity.</Quiet>
      )}
    </div>
  );
}

export const activityItemModule = defineModule({
  type: "activity-item",
  title: "Activity details",
  blurb: "The Activity record you picked, in full",
  docs: {
    shows: "The picked record: when, group and kind, what happened, who and where, every id it carries, and Open for each page it links to.",
    data: "The Activity page's ?event=, or an Activity panel's pick on this view; the record from the shared /api/activity loop.",
    opens: "The record's thread, work item, agent, session, Follow or terminal. Open full: /activity with it open.",
  },
  size: { w: 4, h: 14 },
  minSize: { w: 3, h: 6 },
  maxPerView: 1,
  Component: ActivityItemPanel,
});
