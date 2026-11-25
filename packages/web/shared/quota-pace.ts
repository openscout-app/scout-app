/*
 * Quota pace. A provider's window is paid capacity: using most of it by the
 * time it resets is good use, not a problem. What deserves a warning is
 * fill running ahead of the time that has passed, because at that rate the
 * window runs out before it resets. The Feed's quota warnings and the
 * providers' bars both judge fill by this rule.
 */

const WINDOW_UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** A window's length: the provider's own, else read from its label ("5h", "7d", "30d"); null when neither says. */
export function windowLength(label: string, windowMs?: number | null): number | null {
  if (windowMs != null && Number.isFinite(windowMs) && windowMs > 0) return windowMs;
  const m = /^(\d+)\s*([mhd])$/i.exec(label.trim());
  return m ? Number(m[1]) * WINDOW_UNIT_MS[m[2]!.toLowerCase()]! : null;
}

/** The share of the window that has passed at `atMs`, 0 to 1. */
export function elapsedShare(atMs: number, resetAt: number, windowMs: number): number {
  return Math.min(1, Math.max(0, 1 - (resetAt - atMs) / windowMs));
}

/**
 * True when `fill` at `atMs` is ahead of an even pace through the window: more
 * used than time passed. Unknown window length counts as ahead, so a window
 * that cannot be judged still warns.
 */
export function aheadOfPace(fill: number, atMs: number, resetAt: number, windowMs: number | null): boolean {
  if (windowMs == null) return true;
  return fill > elapsedShare(atMs, resetAt, windowMs);
}

/**
 * When the window runs out at the pace it has kept since it opened, read from
 * its newest reading; null when that is at or after the reset (or cannot be told).
 */
export function runsOutAt(fill: number, atMs: number, resetAt: number, windowMs: number | null): number | null {
  if (windowMs == null || fill <= 0) return null;
  const start = resetAt - windowMs;
  if (atMs <= start) return null;
  const at = start + (atMs - start) / fill;
  return at < resetAt ? at : null;
}
