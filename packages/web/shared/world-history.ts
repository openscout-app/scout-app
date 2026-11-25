// The first Overview read and the two wider reads offered by its window controls.
export const OPENING_HISTORY_HOURS = 4;
export const LIVE_HISTORY_HOURS = 24;
export const REPLAY_HISTORY_HOURS = 7 * 24;

export function overviewHistoryHours(window: string, live: boolean): number {
  if (window === "all") return live ? LIVE_HISTORY_HOURS : REPLAY_HISTORY_HOURS;
  if (window === "24h") return LIVE_HISTORY_HOURS;
  return OPENING_HISTORY_HOURS;
}

export function overviewHistoryDays(hours: string | undefined): number | undefined {
  const n = Number(hours);
  if ([OPENING_HISTORY_HOURS, LIVE_HISTORY_HOURS, REPLAY_HISTORY_HOURS].includes(n)) return n / 24;
  return undefined;
}
