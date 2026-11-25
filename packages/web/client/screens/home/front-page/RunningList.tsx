/**
 * Home's Running list, on its own so a study can draw it with the app's
 * component rather than a copy of its markup.
 */
import { useState, type CSSProperties } from "react";

import { Mark as TintedMark } from "../../feed/sources.tsx";
import { WORK_MARK_PERIOD_MS, workMarkPhase } from "../../../components/work-mark/work-mark-model.ts";
import { RUN_TRACE_ROWS, runningFor, runningGroups, type HomeRunning } from "./front-page-running.ts";
import { useRunHover, type RunHover } from "./RunCard.tsx";
import { RouteLink, type Navigate } from "./route-link.tsx";

const RUNNING_STATE_LABEL = { waiting: "Waiting", working: "Working", idle: "Idle" } as const;

const PITCH = 3;
/** The "now" block: four by four, the same size as the work mark, two columns clear of the history. */
const NOW_COLS = 4;
const NOW_GAP = 2;

/** When an idle session was last active, in a word: "Just now", "18m ago". */
function lastActive(live: HomeRunning, nowMs: number): string {
  return nowMs - live.at < 60_000 ? "Just now" : `${runningFor(live.at, nowMs)} ago`;
}

/**
 * Where a working or waiting session stands and how busy it has been, as one
 * figure. The last half hour is a dot matrix: a column per two minutes,
 * oldest on the left, lit from the bottom by how much its tail said; only lit
 * dots are drawn. After a small gap, the "now" block is drawn in the state's
 * colour: green with a wave climbing through it while the session works (the
 * only thing that moves), the accent while it waits on you. An idle or recent
 * session says when it was last active instead (lastActive).
 */
function RunSignal({ live }: { live: HomeRunning }) {
  const [phase] = useState(() => workMarkPhase(typeof performance === "undefined" ? 0 : performance.now()));
  const { trace, state } = live;
  const nowCol = trace.length + NOW_GAP;
  const width = (nowCol + NOW_COLS) * PITCH - 1;
  const height = RUN_TRACE_ROWS * PITCH - 1;
  const style = { "--wm-phase": `${phase}ms`, "--wm-period": `${WORK_MARK_PERIOD_MS}ms` } as CSSProperties;
  return (
    <svg className="fp-runTrace" data-state={state} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={style} role="img" aria-label={`${RUNNING_STATE_LABEL[state]}; activity over the last 32 minutes`}>
      {trace.flatMap((level, col) => Array.from({ length: Math.min(level, RUN_TRACE_ROWS) }, (_, lit) => {
        const row = RUN_TRACE_ROWS - 1 - lit;
        return <rect key={`${col}-${row}`} x={col * PITCH} y={row * PITCH} width={2} height={2} />;
      }))}
      {Array.from({ length: NOW_COLS * RUN_TRACE_ROWS }, (_, i) => {
        const lit = i % RUN_TRACE_ROWS;
        const col = Math.floor(i / RUN_TRACE_ROWS);
        return <rect key={`now-${i}`} className="fp-runNow" x={(nowCol + col) * PITCH} y={(RUN_TRACE_ROWS - 1 - lit) * PITCH}
          width={2} height={2} style={{ "--fp-now-i": lit + col / 2 } as CSSProperties} />;
      })}
    </svg>
  );
}

/**
 * A session as one line: its harness, what it works on, and where it stands:
 * the activity figure while it works or waits, else when it was last active.
 * Hover or focus opens its card (RunCard.tsx): the state and since when, its
 * references, where it runs, and the way to it.
 */
function RunRow({ live, nowMs, navigate, hover, open }: { live: HomeRunning; nowMs: number; navigate: Navigate; hover: RunHover; open: boolean }) {
  const described = open ? `run-card-${live.id}` : undefined;
  const body = (
    <>
      <span className="fp-runMark"><TintedMark harness={live.agent.harness} size={12} title={live.agent.name} /></span>
      <span className="fp-runTitle">{live.title}</span>
      {live.state === "idle"
        ? <span className="fp-runState">{lastActive(live, nowMs)}</span>
        : <span className="fp-runSignal"><RunSignal live={live} /></span>}
    </>
  );
  return (
    <div className="fp-runItem" {...hover.bind(live.id)}>
      {live.open
        ? <RouteLink route={live.open} navigate={navigate} className="fp-run" data={{ "data-state": live.state, "aria-describedby": described }}>{body}</RouteLink>
        : <div className="fp-run" data-state={live.state} tabIndex={0} aria-describedby={described}>{body}</div>}
    </div>
  );
}

/** Sessions by project: each project's sessions under its name, what waits on you first. */
export function RunningList({ rows, nowMs, navigate }: { rows: readonly HomeRunning[]; nowMs: number; navigate: Navigate }) {
  const { groups, more } = runningGroups(rows);
  const hover = useRunHover();
  return (
    <div className="fp-runGroups">
      {groups.map((group) => (
        <section key={group.project} className="fp-runGroup" aria-label={group.project}>
          <div className="fp-runProject">{group.project}</div>
          {group.rows.map((live) => <RunRow key={live.id} live={live} nowMs={nowMs} navigate={navigate} hover={hover} open={hover.openId === live.id} />)}
        </section>
      ))}
      {more > 0 ? <RouteLink route={{ view: "sessions" }} navigate={navigate} className="fp-runMore">{more} more {more === 1 ? "session" : "sessions"}</RouteLink> : null}
      {hover.card(rows.find((row) => row.id === hover.openId), nowMs, navigate)}
    </div>
  );
}
