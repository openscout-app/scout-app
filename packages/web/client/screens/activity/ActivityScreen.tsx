import { useEffect, useState } from "react";
import { ComputerUseActivity } from "./ComputerUse.tsx";
import { routeMachineId } from "../../lib/router.ts";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Page, Pane, Section } from "../../components/Pane.tsx";
import type { ActivityItem, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { ActivityEntry, useActivityMenu } from "./ActivityEntry.tsx";
import { activitySyncNote } from "./activity-model.ts";
import { useActivityRows, type ActivityRows } from "./use-activity-feed.ts";
import "../system-surfaces-redesign.css";

/**
 * How a view panel (the Activity module) drives the log. Selection is the
 * panel's to hold (the URL on /activity, its settings elsewhere): the log
 * marks it, and opens its details under the row only when `inline` (no
 * details panel beside it to show them).
 */
export type ActivityPanelControl = {
  selectedId: string | null;
  /** A row was clicked, or Enter/Space on it: the panel toggles its pick. */
  onPick: (item: ActivityItem) => void;
  inline: boolean;
  /** The panel narrows the log (a project or a group), for the empty state's words. */
  filtered: boolean;
};

/** The log's sync line: reading, updated when, or the snapshot kept through a failed refresh. */
export function activityFeedNote(feed: Pick<ActivityRows, "loading" | "error" | "rows" | "loadedAt">): string {
  return activitySyncNote({ loading: feed.loading, error: feed.error, shown: feed.rows.length > 0, loadedAt: feed.loadedAt });
}

/**
 * The log itself: its states (reading, unavailable with Try again,
 * a refresh that failed behind what shows, nothing yet) and the records,
 * newest first. The page puts it in a Pane (components/Pane.tsx); a panel puts its head in the
 * panel's and holds the selection.
 */
export function ActivityLog({
  feed,
  navigate,
  panel,
}: {
  feed: ActivityRows;
  navigate: (r: Route) => void;
  panel?: ActivityPanelControl;
}) {
  const { route } = useScout();
  const { rows, loading, error, refresh } = feed;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const onMenu = useActivityMenu(navigate, route);

  // the page's own open record closes when it leaves the list
  useEffect(() => {
    if (!panel && expandedId && !rows.some((item) => item.id === expandedId)) setExpandedId(null);
  }, [expandedId, panel, rows]);

  const showInitialError = !loading && rows.length === 0 && Boolean(error);
  const showEmpty = !loading && rows.length === 0 && !error;

  return (
    <>
      {route.view === "activity" && !routeMachineId(route) && !panel?.filtered && <ComputerUseActivity />}
      <Section
        label={panel || rows.length > 0 ? "Newest first" : undefined}
        right={panel ? activityFeedNote(feed) : undefined}
      >
        {error && rows.length > 0 && (
          <div className="sys-banner sys-banner-warning">
            <strong>Refresh failed.</strong>
            <span>{error}</span>
          </div>
        )}
        {rows.length > 0 && (
          <div className="sys-audit-list">
            {rows.map((item) => {
              if (panel) {
                const selected = panel.selectedId === item.id;
                return (
                  <ActivityEntry
                    key={item.id}
                    item={item}
                    expanded={panel.inline && selected}
                    selected={selected}
                    onToggle={() => panel.onPick(item)}
                    onMenu={onMenu}
                    navigate={navigate}
                    returnTo={route}
                  />
                );
              }
              const expanded = expandedId === item.id;
              return (
                <ActivityEntry
                  key={item.id}
                  item={item}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : item.id)}
                  onMenu={onMenu}
                  navigate={navigate}
                  returnTo={route}
                />
              );
            })}
          </div>
        )}
      </Section>

      {loading && rows.length === 0 && (
        <EmptyState title="Loading activity" />
      )}

      {showInitialError && (
        <EmptyState
          className="sys-state-card-error"
          title="Activity is unavailable"
          body={error}
          action={
            <button type="button" className="s-btn" onClick={refresh}>
              Try again
            </button>
          }
        />
      )}

      {showEmpty && (
        panel?.filtered
          ? <EmptyState title="Nothing in this scope" body="No recent events match this panel's project and kind." />
          : <EmptyState title="No activity yet" body="Events appear here after agents register, send messages, or advance work." />
      )}
    </>
  );
}

/**
 * The Activity page: broker events, task execution and collaboration
 * handoffs, newest first, on the page's machine (?machineId=). Read from the
 * shared activity loop (use-activity-feed.ts): on open, once per burst of
 * broker data events, every 15s while visible, and on Refresh. The Activity
 * view (views-model.ts) draws the same log in panels; this page stands for
 * /activity wherever the route is not composed.
 */
export function ActivityScreen({ navigate }: { navigate: (r: Route) => void }) {
  const feed = useActivityRows();
  const { loading, refreshing, refresh } = feed;
  return (
    <Page>
      <Pane
        title="Activity"
        count={feed.rows.length > 0 ? feed.rows.length : undefined}
        tools={
          <>
            <span className="scout-pane-note">{activityFeedNote(feed)}</span>
            <button type="button" className="scout-pane-tool" disabled={loading || refreshing} onClick={refresh}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </>
        }
      >
        <ActivityLog feed={feed} navigate={navigate} />
      </Pane>
    </Page>
  );
}
