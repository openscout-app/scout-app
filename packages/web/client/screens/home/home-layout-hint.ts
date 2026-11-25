// Last-settled shape of Home, remembered across launches so a cold load can
// reserve the geometry it is about to fill instead of growing into it. The
// hint only sizes skeletons; real data always wins the moment it lands.

const STORAGE_KEY = "openscout.home.layoutHint.v1";

export type HomeLayoutHint = {
  /** Quota rows the cockpit showed (0 = no quotas card). */
  gauges: number;
  /** Whether the velocity card was on screen. */
  heartrate: boolean;
  /** Rows in What's moving (0 = the quiet empty line). */
  moving: number;
  /** Rows in the coordination stream, before its own scroll cap. */
  activity: number;
  /** The coordination window the auto ladder settled on, ms. */
  lookback?: number;
  /** The front page's Running and Providers bodies, px, as they last settled (0 = nothing there). */
  frontRunning?: number;
  frontProviders?: number;
};

// First launch ever: assume the common operator shape (both cockpit cards, a
// few moving rows, a full stream) — over-reserving and settling down reads
// calmer than a page that keeps pushing itself taller.
const DEFAULT_HINT: HomeLayoutHint = { gauges: 2, heartrate: true, moving: 3, activity: 12 };

/** No reserved body is taller than this; a long list settles into its own height. */
const FRONT_MAX_PX = 480;

const clampInt = (value: unknown, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.round(value)))
    : fallback;

export function readHomeLayoutHint(): HomeLayoutHint {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HINT;
    const parsed = JSON.parse(raw) as Partial<HomeLayoutHint>;
    return {
      gauges: clampInt(parsed.gauges, 2, DEFAULT_HINT.gauges),
      heartrate: typeof parsed.heartrate === "boolean" ? parsed.heartrate : DEFAULT_HINT.heartrate,
      moving: clampInt(parsed.moving, 8, DEFAULT_HINT.moving),
      activity: clampInt(parsed.activity, 30, DEFAULT_HINT.activity),
      lookback: typeof parsed.lookback === "number" && Number.isFinite(parsed.lookback) ? parsed.lookback : undefined,
      frontRunning: clampInt(parsed.frontRunning, FRONT_MAX_PX, 0),
      frontProviders: clampInt(parsed.frontProviders, FRONT_MAX_PX, 0),
    };
  } catch {
    return DEFAULT_HINT;
  }
}

/**
 * Merge what one part of Home settled on into the hint. Each Home panel on a
 * view writes its own fields; HomeContent writes them all at once. A field
 * given as undefined (lookback, while the window is still moving) is dropped.
 */
export function writeHomeLayoutHint(hint: Partial<HomeLayoutHint>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readHomeLayoutHint(), ...hint }));
  } catch {
    // Storage is a convenience; a missing hint only means default skeletons.
  }
}
