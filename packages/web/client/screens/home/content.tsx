import "./fleet-home.css";
import "./activity-stream.css";

import { useMemo, useState } from "react";
import { ConnectionState, ConnectionTraceLog } from "../../components/ConnectionState.tsx";
import { HudGrid, type HudGridPanel } from "../../components/hud-grid/HudGrid.tsx";
import { routeMachineId } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { TailView } from "../shared/TailView.tsx";
import HomeHero, { useHomeTelemetryPanels } from "./HomeHero.tsx";
import { combineHeartrateWithTailEvents, HEARTRATE_COMBINED_EVENT_THRESHOLD, heartrateTotal } from "./home-derive.ts";
import { HOME_GRID_ARRANGEMENTS, HOME_GRID_DEFAULT } from "./home-grid.ts";
import { readHomeLayoutHint } from "./home-layout-hint.ts";
import { homeLoadNotice } from "./home-loading.ts";
import {
  LocalTailPanel,
  OpenTailButton,
  QuietStartPanel,
  SectionRule,
  useHomeCockpit,
  useHomeCoordination,
  useHomeMoving,
  useHomeScope,
  useLayoutHintWrite,
  useStalledLoad,
} from "./home-panels.tsx";
import { useHomeFeed } from "./use-home-feed.ts";

export { SectionRule } from "./home-panels.tsx";

/**
 * Home as one screen: the Mac app's /embed/home (the grid, on its own saved
 * arrangement) and basic web (stacked). The web app's / is the Home
 * composition (screens/views/modules/home-*.tsx); both draw the same parts
 * (home-panels.tsx) from one Home feed (use-home-feed.ts).
 */
export function HomeContent({
  navigate,
  basic = false,
  lead,
  children,
}: {
  navigate: (r: Route) => void;
  /** Basic web: no hero, coordination stream or quiet-start panels. */
  basic?: boolean;
  /** Basic web: a next-step strip above What's moving. */
  lead?: React.ReactNode;
  /** Extra Home sections, laid out after What's moving. */
  children?: React.ReactNode;
}) {
  const { route } = useScout();
  const feed = useHomeFeed();
  const { fleet, error, loading, refreshing, nowMs } = feed;
  const { agents, scopedFleet } = useHomeScope(fleet, routeMachineId(route));
  const [layoutHint] = useState(readHomeLayoutHint);
  const cockpit = useHomeCockpit(feed, navigate, basic);
  const moving = useHomeMoving({ feed, agents, scopedFleet, operatorName: cockpit.operatorName, navigate, layoutHint, basic });
  const coord = useHomeCoordination({ feed, scopedFleet, navigate, layoutHint });
  const combinedHeartrate = useMemo(
    () => combineHeartrateWithTailEvents(feed.heartrate, feed.tailEvents, nowMs),
    [feed.heartrate, feed.tailEvents, nowMs],
  );

  const heroProps = {
    now: new Date(nowMs),
    operatorName: cockpit.operatorName,
    syncLabel: cockpit.syncLabel,
    error,
    loading,
    refreshing,
    onRefresh: cockpit.refresh,
    onNewChat: cockpit.startNewChat,
    navigate,
    heartrate: combinedHeartrate,
    heartrateWindow: feed.heartrateWindow,
    heartrateBucketLabel: feed.heartrateBucketLabel,
    heartrateVisibleEventThreshold: HEARTRATE_COMBINED_EVENT_THRESHOLD,
    serviceGauges: feed.gauges,
    gaugesPending: !feed.gaugesSettled,
    heartratePending: loading || !feed.tailSettled,
    layoutHint,
  };
  // The full app lays Home out on the HUD grid; basic keeps the stacked page.
  const useGrid = !basic;
  const telemetryPanels = useHomeTelemetryPanels(heroProps);
  // Home has no host composer, so the Message panel draws inside an embed
  // too (QuietStartPanel opts its composer in).
  const showMessagePanel = coord.quiet;

  useLayoutHintWrite(!loading && feed.gaugesSettled && feed.tailSettled, {
    gauges: Math.min(feed.gauges.filter((gauge) => gauge.kind === "quota").length, 2),
    heartrate: heartrateTotal(combinedHeartrate) >= HEARTRATE_COMBINED_EVENT_THRESHOLD,
    moving: moving.rows,
    activity: coord.rows,
    lookback: coord.settledLookback ?? undefined,
  });

  // The load trace is for a slow or stuck load. A normal load lands well
  // inside its delay, and a footer that appears and leaves in a second is motion.
  const traceVisible = useStalledLoad(loading || !feed.gaugesSettled || !feed.tailSettled);

  if (!fleet && error && !loading) {
    return <div className="s-home-load-state"><ConnectionState notice={homeLoadNotice(error)} trace={feed.trace} onRetry={cockpit.retry} /></div>;
  }

  const gridPanels: HudGridPanel[] = useGrid
    ? [
        ...telemetryPanels,
        // Counts sit in the head's count chip, the same slot on every panel.
        { id: "moving", title: "What's moving", count: moving.count, right: moving.right, children: moving.body, className: "s-grid-moving" },
        ...(coord.shown
          ? [{ id: "coord", title: "Scout coordination", count: coord.count, right: coord.right, children: coord.body, className: "s-grid-coord" }]
          : []),
        {
          id: "tail",
          title: "Local tail",
          className: "s-grid-tail",
          right: <OpenTailButton navigate={navigate} />,
          children: <TailView navigate={navigate} chrome="embedded" density="compact" />,
        },
        ...(showMessagePanel
          ? [{ id: "message", title: "Message", className: "s-grid-message", children: <QuietStartPanel agents={agents} navigate={navigate} /> }]
          : []),
      ]
    : [];

  return (
    <div className="s-home-surface">
    <div className="s-fleet-home" aria-busy={loading || undefined} data-layout={useGrid ? "grid" : "stack"}>
      <div className="s-fleet-home-inner">
        {/* ── Home header ─────────────────────────────────────────── */}
        <HomeHero {...heroProps} bandOnly={useGrid} />
        {/* Held through retries: hiding it per refresh flashed the band and
            shifted the page on every poll. A successful load clears error. */}
        {basic && error && (
          <div className="sys-banner sys-banner-warning" role="alert">
            <strong>Refresh failed.</strong>
            <span>{error}</span>
            <button type="button" className="s-link-btn" onClick={cockpit.retry}>Retry</button>
          </div>
        )}
        {basic && lead}

        {useGrid ? (
          <div className="s-fleet-grid">
            <HudGrid surface="home" panels={gridPanels} defaults={HOME_GRID_DEFAULT} arrangements={HOME_GRID_ARRANGEMENTS} />
          </div>
        ) : (
          <>
            {/* ── What's moving ──────────────────────────────────────── */}
            {/* Always mounted: a quiet line when nothing moves, so the sections
                below never jump when work starts or stops. */}
            <div className="s-fleet-section">
              <SectionRule label={moving.label} right={moving.right} />
              {moving.body}
            </div>

            {/* ── Scout coordination stream ─────────────────────────── */}
            {coord.shown && (
              <div className="s-fleet-section">
                <SectionRule label={coord.label} right={coord.right} />
                {coord.body}
              </div>
            )}

            {/* Local tail is always on Home; the quiet-start composer joins it
                only when coordination is empty. */}
            <div className="s-fleet-section s-fleet-section--quiet-start">
              <div className="s-quiet-start">
                {showMessagePanel && <QuietStartPanel agents={agents} navigate={navigate} />}
                <LocalTailPanel navigate={navigate} />
              </div>
            </div>
          </>
        )}

        {children}
      </div>
    </div>
    {traceVisible && (
      <ConnectionTraceLog trace={feed.trace} label="Loading Scout" />
    )}
    </div>
  );
}

/** @deprecated Use HomeContent */
export { HomeContent as HomeScreen };
