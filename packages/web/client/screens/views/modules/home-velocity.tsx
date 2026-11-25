/**
 * Fleet velocity — the fleet's events over the trailing week, as one curve.
 *
 * Shows:  the window's broker events with the local tail's laid over them,
 *         smoothed into one curve filling the panel, with day marks; the
 *         count says how many events in which window, beside the bucket size.
 *         Under 3 events there is nothing to draw, and the panel says so.
 * Data:   the Home feed (screens/home/use-home-feed.ts): /api/heartrate with
 *         every fleet read (on open, on fleet and roster events, 15s / 30s
 *         net), and /api/tail/recent every 30s while Scout is in front.
 * Scope:  none.
 * Opens:  nothing.
 */
import { useMemo, useState } from "react";
import { useVelocityPart } from "../../home/HomeHero.tsx";
import { combineHeartrateWithTailEvents, HEARTRATE_COMBINED_EVENT_THRESHOLD, heartrateTotal } from "../../home/home-derive.ts";
import { readHomeLayoutHint } from "../../home/home-layout-hint.ts";
import { useLayoutHintWrite } from "../../home/home-panels.tsx";
import { useHomeFeed } from "../../home/use-home-feed.ts";
import { defineModule } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "./home-shared.tsx";

function HomeVelocityPanel() {
  const feed = useHomeFeed();
  const [layoutHint] = useState(readHomeLayoutHint);
  const heartrate = useMemo(
    () => combineHeartrateWithTailEvents(feed.heartrate, feed.tailEvents, feed.nowMs),
    [feed.heartrate, feed.tailEvents, feed.nowMs],
  );
  const part = useVelocityPart({
    heartrate,
    heartrateWindow: feed.heartrateWindow,
    heartrateBucketLabel: feed.heartrateBucketLabel,
    heartrateVisibleEventThreshold: HEARTRATE_COMBINED_EVENT_THRESHOLD,
    heartratePending: feed.loading || !feed.tailSettled,
    layoutHint,
  });
  useLayoutHintWrite(!feed.loading && feed.gaugesSettled && feed.tailSettled, {
    heartrate: heartrateTotal(heartrate) >= HEARTRATE_COMBINED_EVENT_THRESHOLD,
  });
  return (
    <div className="vw-home vw-home--velocity">
      <ModuleHead>
        {part.count !== undefined && <span className="hud-grid-count">{part.count}</span>}
        {part.right}
      </ModuleHead>
      {part.shown ? (
        part.body
      ) : (
        <Quiet>
          {feed.loading || !feed.tailSettled
            ? "Reading activity…"
            : `Under ${HEARTRATE_COMBINED_EVENT_THRESHOLD} events in the ${feed.heartrateWindow}: nothing to draw yet.`}
        </Quiet>
      )}
    </div>
  );
}

export const homeVelocityModule = defineModule({
  type: "home-velocity",
  title: "Fleet velocity",
  blurb: "The fleet's events over the trailing week, as one curve",
  docs: {
    shows: "Broker and local tail events over the window as one smoothed curve with day marks, the event count and bucket size; under 3 events, a quiet line.",
    data: "The Home feed: /api/heartrate with every fleet read, /api/tail/recent every 30s while Scout is in front.",
  },
  size: { w: 4, h: 6 },
  minSize: { w: 4, h: 4 },
  Component: HomeVelocityPanel,
});
