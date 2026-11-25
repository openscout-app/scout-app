/**
 * Runtime summary — how many agents run here, and how hard: Ops › Runtime's summary strip as a panel.
 *
 * Shows:  active of total (with a sparkline of the last 24 changes), working
 *         (tool calls, with its sparkline), idle, the four busiest harnesses
 *         with their counts, and requests in the last minute.
 * Data:   Runtime's shared feed (atop-feed.ts): the broker tail stream
 *         (pushed), opened on a recent replay (/api/tail/recent, 500 lines),
 *         and /api/tail/discover every 5s, reading only while the window is
 *         active. One feed for every Runtime panel on the view.
 * Scope:  none; it counts every agent process on this machine.
 * Opens:  nothing; the Runtime table holds the rows.
 */
import { SummaryStrip } from "../../ops/AtopView.tsx";
import { useAtopFeed } from "../../ops/atop-feed.ts";
import { defineModule } from "./contract.ts";
import "./runtime-panels.css";

function RuntimeSummary() {
  const feed = useAtopFeed();
  return (
    <div className="vw-runtime-summary">
      <SummaryStrip summary={feed.summary} runHistory={feed.runHistory} toolHistory={feed.toolHistory} />
    </div>
  );
}

export const runtimeSummaryModule = defineModule({
  type: "runtime-summary",
  title: "Runtime summary",
  blurb: "Agent processes active, working and idle, by harness, with requests per minute",
  docs: {
    shows: "Active of total and working (each with a sparkline), idle, the busiest harnesses, requests in the last minute.",
    data: "Runtime's shared feed: the broker tail stream, a recent replay, /api/tail/discover every 5s.",
    opens: "Nothing.",
  },
  size: { w: 12, h: 5 },
  minSize: { w: 4, h: 4 },
  Component: RuntimeSummary,
});
