/**
 * Fleet cockpit — Home's head band as a panel: how fresh, how much of each subscription is used, and the way in.
 *
 * Shows:  in the panel head, beside the title, each subscription's gauge
 *         (name, a thin bar, percent of its long window used, time to reset;
 *         Subscription gauges in the Layout menu turns them off), and on the
 *         right New chat, the sync line (Loading Scout…, Refreshing…, Last
 *         updated 2m, or offline / sync issue since when, with a warning mark
 *         while a read is failing) and Refresh. A head too narrow for the
 *         gauges drops their countdowns, then moves them to a row under it.
 *         Where the host has no title row (the Mac app), the view's Layout
 *         button joins the head (ViewLayoutSlot). Under the head, the
 *         operator's shortcuts: named links into Scout, with Add and Edit;
 *         with none yet, only Add shortcut, in the head, and no row. A
 *         failed first read says so with Try again on a row above them (in
 *         place of the gauges' row); a load still out after 8s shows its
 *         trace above both.
 * Data:   the Home feed (screens/home/use-home-feed.ts), one for every Home
 *         panel on the view: GET /api/fleet (with the coordination window),
 *         /api/heartrate and the roster together, warm from a read under 30s
 *         old, then again on fleet and roster events, with a net every 15s
 *         while the event stream is down and 30s while it is up, while the
 *         page shows; the gauges are the feed's /api/service-budgets read
 *         (every 60s), the one Subscriptions & quotas draws, so no second
 *         poller. Refresh reads the fleet again and every provider's quotas
 *         (/api/service-budgets?refresh=1). Shortcuts: this browser's storage
 *         (screens/home/cockpit-shortcuts.ts), live across tabs.
 * Scope:  gauges: "on" or "off" (Layout › Subscription gauges; absent = on).
 * Opens:  a gauge: Providers. A shortcut: its page. New chat: the Mac app's
 *         composer inside the app, else the web one (⌘N either way).
 */
import { useState } from "react";
import { ConnectionTraceLog } from "../../../components/ConnectionState.tsx";
import { cockpitGauges } from "../../home/cockpit-gauges.ts";
import { CockpitGauges, gaugesKey, useHeadGaugePlacement } from "../../home/CockpitGauges.tsx";
import { useCockpitShortcuts } from "../../home/cockpit-shortcuts.ts";
import { CockpitShortcuts } from "../../home/CockpitShortcuts.tsx";
import { HomeCockpitControls } from "../../home/HomeHero.tsx";
import { readHomeLayoutHint } from "../../home/home-layout-hint.ts";
import { homeLoadNotice } from "../../home/home-loading.ts";
import { useHomeCockpit, useStalledLoad } from "../../home/home-panels.tsx";
import { useHomeFeed } from "../../home/use-home-feed.ts";
import { ViewLayoutSlot } from "../ViewHeaderMount.tsx";
import { defineModule, moduleOptionOn, type ModuleOption, type ModuleProps } from "./contract.ts";
import "./home-shared.tsx";
import { ModuleHead } from "./ModuleHead.tsx";

/** The head gauges, on unless the operator turns them off (Layout › Subscription gauges). */
const GAUGES_OPTION: ModuleOption = {
  key: "gauges",
  label: "Subscription gauges",
  title: "Each subscription's usage in the Fleet cockpit's head",
  default: true,
};

function HomeCockpitPanel({ route, navigate, config }: ModuleProps) {
  const feed = useHomeFeed();
  const cockpit = useHomeCockpit(feed, navigate);
  const stalled = useStalledLoad(feed.loading || !feed.gaugesSettled || !feed.tailSettled);
  const failed = !feed.fleet && !feed.loading ? feed.error : null;

  const gaugesOn = moduleOptionOn(GAUGES_OPTION, config);
  const [pendingCount] = useState(() => readHomeLayoutHint().gauges);
  const readings = cockpitGauges(feed.gauges, new Date(feed.nowMs));
  const gaugesPending = !feed.gaugesSettled;
  const placement = useHeadGaugePlacement(gaugesOn ? gaugesKey(readings, gaugesPending) : null);
  const gaugesInRow = gaugesOn && placement.tier === "hidden";
  const openProviders = () => navigate({ view: "harnesses" });
  const hasShortcuts = useCockpitShortcuts().length > 0;
  const gauges = (place: "head" | "row") => (
    <CockpitGauges
      ref={place === "head" ? placement.ref : undefined}
      tier={place === "head" ? placement.tier : undefined}
      readings={readings}
      pending={gaugesPending}
      pendingCount={pendingCount}
      onOpen={openProviders}
      place={place}
    />
  );

  return (
    <div className="vw-home vw-home--cockpit">
      <ModuleHead beside={gaugesOn ? gauges("head") : undefined}>
        {!hasShortcuts && <CockpitShortcuts route={route} navigate={navigate} place="head" />}
        <HomeCockpitControls
          syncLabel={cockpit.syncLabel}
          error={feed.error}
          loading={feed.loading}
          refreshing={feed.refreshing}
          onRefresh={cockpit.refresh}
          onNewChat={cockpit.startNewChat}
        />
        <ViewLayoutSlot />
      </ModuleHead>
      {stalled && <ConnectionTraceLog trace={feed.trace} label="Loading Scout" />}
      {/* Two short rows fit under the head, so a failed first read takes the
          gauges' row: it says why there is nothing to read, and the
          Subscriptions & quotas panel still has every reading. */}
      {(failed || gaugesInRow || hasShortcuts) && (
      <div className={`vw-cockpit-rows${(failed || gaugesInRow) && hasShortcuts ? " is-split" : ""}`}>
        {failed ? (
          <div className="vw-cockpit-row">
            <span className="hd-meta hd-meta--err" role="alert" title={failed}>
              {homeLoadNotice(failed).title}
              {" · "}
              <button type="button" className="s-link-btn" onClick={cockpit.retry}>
                Try again
              </button>
            </span>
          </div>
        ) : (
          gaugesInRow && <div className="vw-cockpit-row vw-cockpit-row--gauges">{gauges("row")}</div>
        )}
        {hasShortcuts && <CockpitShortcuts route={route} navigate={navigate} />}
      </div>
      )}
    </div>
  );
}

export const homeCockpitModule = defineModule({
  type: "home-cockpit",
  title: "Fleet cockpit",
  blurb: "Subscription gauges, the sync line, New chat, Refresh and your shortcuts",
  docs: {
    shows: "The head: each subscription's gauge beside the title (percent used and time to reset; off in Layout › Subscription gauges), then New chat, the sync line and Refresh. Under it, your shortcuts with Add and Edit, a failed first read with Try again above them, and the load trace after an 8s stall.",
    data: "The Home feed: /api/fleet, /api/heartrate and the roster on open and on fleet and roster events (15s net while the stream is down, 30s while up), and its /api/service-budgets read every 60s for the gauges; Refresh also re-reads every provider's quotas. Shortcuts: this browser's storage.",
    opens: "A gauge: Providers. A shortcut: its page. New chat: the Mac app's composer inside the app, else the web one.",
  },
  size: { w: 12, h: 3 },
  // New chat, the sync line and Refresh in the head, one row of shortcuts
  // under it once there are any (fit shrinks the panel to the head without)
  minSize: { w: 4, h: 3 },
  options: [GAUGES_OPTION],
  maxPerView: 1,
  // as tall as the head and its rows, up to its cell
  fit: true,
  Component: HomeCockpitPanel,
});
