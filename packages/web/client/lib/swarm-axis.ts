/*
 * The lanes view's time axis. A fixed window ends at now. "All" draws a swarm
 * from its first ask to its last activity: to now while an ask is open or the
 * swarm went quiet only lately, else to just past its last activity, so a swarm
 * that went quiet hours ago fills the board instead of packing against its
 * left edge. The first tick of each new day reads as that day.
 */

import { axisTicks, type Swarm, type SwarmAsk } from "./swarm-model.ts";

/** A quiet tail longer than this share of the span ends the axis at the last activity. */
const QUIET_SHARE = 0.25;

export type AxisTick = {
  at: number;
  /** The first tick of a day after the axis starts: label it with the day, not the clock. */
  day: boolean;
};

export type LanesAxis = {
  start: number;
  end: number;
  /** The axis ends at now. When false, it ends just past `lastActivityAt`, and nothing happened after that. */
  live: boolean;
  lastActivityAt: number;
  ticks: AxisTick[];
};

export function lanesAxis(
  swarm: Pick<Swarm, "start" | "lastActivityAt"> & { asks: ReadonlyArray<Pick<SwarmAsk, "open">> },
  { now, fit, maxTicks = 8 }: { now: number; fit: boolean; maxTicks?: number },
): LanesAxis {
  const start = swarm.start;
  const last = Math.max(start, Math.min(now, swarm.lastActivityAt));
  const live = !fit || swarm.asks.some((ask) => ask.open) || now - last <= QUIET_SHARE * (now - start);
  const end = live ? Math.max(now, start + 60_000) : last + Math.max(60_000, (last - start) * 0.03);
  const times = axisTicks(start, end, maxTicks);
  const dayOf = (at: number) => new Date(at).toDateString();
  const ticks = times.map((at, index) => ({ at, day: dayOf(at) !== dayOf(index === 0 ? start : times[index - 1]!) }));
  return { start, end, live, lastActivityAt: last, ticks };
}
