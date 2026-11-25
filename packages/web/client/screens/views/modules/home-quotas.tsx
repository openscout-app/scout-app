/**
 * Subscriptions & quotas — Home's quota table: the busiest subscriptions and when each window resets.
 *
 * Shows:  the two busiest subscriptions (Show all lists every one, Busiest 2
 *         goes back), each with its short window, when that resets, its long
 *         window and the countdown to its reset; the count says how many of
 *         the total are on screen. While the first read is out it holds the
 *         rows Home last showed. A narrow panel keeps the service, the long
 *         window and its countdown.
 * Data:   the Home feed (screens/home/use-home-feed.ts): /api/service-budgets
 *         warm from a read under 30s old, then every 60s while the page
 *         shows, on focus, and when Scout comes to the front; the cockpit's
 *         Refresh re-reads every provider (?refresh=1).
 * Scope:  none.
 * Opens:  a subscription: Providers (/providers).
 */
import { useState } from "react";
import { useQuotasPart } from "../../home/HomeHero.tsx";
import { readHomeLayoutHint } from "../../home/home-layout-hint.ts";
import { useLayoutHintWrite } from "../../home/home-panels.tsx";
import { useHomeFeed } from "../../home/use-home-feed.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "./home-shared.tsx";

function HomeQuotasPanel({ navigate }: ModuleProps) {
  const feed = useHomeFeed();
  const [layoutHint] = useState(readHomeLayoutHint);
  const part = useQuotasPart({
    now: new Date(feed.nowMs),
    navigate,
    serviceGauges: feed.gauges,
    gaugesPending: !feed.gaugesSettled,
    layoutHint,
  });
  useLayoutHintWrite(!feed.loading && feed.gaugesSettled && feed.tailSettled, {
    gauges: Math.min(feed.gauges.filter((gauge) => gauge.kind === "quota").length, 2),
  });
  return (
    <div className="vw-home vw-home--quotas">
      <ModuleHead>
        {part.count !== undefined && <span className="hud-grid-count">{part.count}</span>}
        {part.right}
      </ModuleHead>
      {part.shown ? part.body : <Quiet>{feed.gaugesSettled ? "No subscriptions reported." : "Reading subscriptions…"}</Quiet>}
    </div>
  );
}

export const homeQuotasModule = defineModule({
  type: "home-quotas",
  title: "Subscriptions & quotas",
  blurb: "The busiest subscriptions, each window and when it resets",
  docs: {
    shows: "The two busiest subscriptions (or all): short window, its reset, long window and its countdown, with how many of the total are shown.",
    data: "The Home feed: /api/service-budgets every 60s while the page shows, on focus and when Scout comes to the front; the cockpit's Refresh re-reads every provider.",
    opens: "A subscription: Providers.",
  },
  size: { w: 8, h: 6 },
  // three columns (service, long window, countdown) and a row of each
  minSize: { w: 4, h: 4 },
  // as tall as what it holds, up to its cell
  fit: true,
  Component: HomeQuotasPanel,
});
