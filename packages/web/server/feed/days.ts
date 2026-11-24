/**
 * Working days. A day turns over at 4am local time, so work finished at 01:10
 * belongs to the day before. Day keys are dates, not offsets from now, so a
 * post's bucket never moves as time passes.
 */

export const DAY_TURNOVER_HOURS = 4;
const TURNOVER_MS = DAY_TURNOVER_HOURS * 3_600_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "2026-11-16": the working day `ts` falls in. */
export function dayKey(ts: number): string {
  const d = new Date(ts - TURNOVER_MS);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The working day before `day`. */
export function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const prev = new Date(y, m - 1, d - 1, 12);
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
}

/** When `day` starts: 4am local. */
export function dayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, DAY_TURNOVER_HOURS).getTime();
}
