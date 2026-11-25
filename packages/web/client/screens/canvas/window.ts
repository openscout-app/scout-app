/*
 * How far back the canvas reads, and in what order. It opens on the last 4 hours. A window reads in steps, each
 * wider than the last and newest first, so the last hour is on the canvas while the rest of the window reads.
 * The server keeps the hours between a window's start and its end (server/canvas.ts).
 *
 * A window is `hours` long and ends at `end`: null is the live window, which ends at now; a number is a past moment
 * in epoch ms (the route's `?end=`). Stepping moves `end` by one window length. Anything that picks a moment, such
 * as a timeline later, sets the same `end` through moveEnd.
 */
import { canvasEarliestEnd, canvasEnd } from "../../../shared/canvas.ts";

export const WINDOWS: readonly [number, string][] = [[4, "Last 4 hours"], [24, "Last 24 hours"], [48, "Last 2 days"], [168, "Last 7 days"]];
/** the same windows by length, as the picker names them when the window ends in the past */
export const LENGTHS: readonly [number, string][] = [[4, "4 hours"], [24, "24 hours"], [48, "2 days"], [168, "7 days"]];
const STEPS = [1, 4, 24, 48, 168];
const HOUR = 3_600_000;

export const windowPhrase = (hours: number) =>
  hours === 1 ? "the last hour" : hours <= 24 ? `the last ${hours} hours` : `the last ${Math.round(hours / 24)} days`;

/** The windows to read, in order, to show `hours` when `shown` hours of the same window are on the canvas (0: none). */
export function readSteps(hours: number, shown: number): number[] {
  if (shown >= hours) return [hours];
  return [...STEPS.filter((h) => h > shown && h < hours), hours];
}

/** A window's end set to `to` (null: now), clamped as the server clamps it: not after now, not before the reach. */
export const moveEnd = (to: number | null, hours: number, now: number): number | null => canvasEnd(to, hours, now);

/** One window length earlier (-1) or later (1). Later than now is the live window again. */
export function stepEnd(end: number | null, hours: number, dir: -1 | 1, now: number): number | null {
  return moveEnd((end ?? now) + dir * hours * HOUR, hours, now);
}

/** Whether a step earlier would move the window: false once it starts at the edge of what can be read. */
export const canStepEarlier = (end: number | null, hours: number, now: number) => (end ?? now) > canvasEarliestEnd(hours, now);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** calendar days from `t`'s day to `now`'s, in local time; DST makes a day 23 or 25 hours, hence the rounding */
const daysBack = (t: number, now: number) => Math.round((dayStart(now) - dayStart(t)) / (24 * HOUR));

function dayWord(t: number, now: number): string {
  const back = daysBack(t, now), d = new Date(t);
  if (back === 0) return "Today";
  if (back === 1) return "Yesterday";
  if (back > 1 && back < 7) return DAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]} ${d.getDate()},`; // a date sets off its time: "Nov 3, 2–6 pm"
}

function clock(t: number): { time: string; half: "am" | "pm" } {
  const d = new Date(t), h = d.getHours(), m = d.getMinutes();
  return { time: `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}`, half: h < 12 ? "am" : "pm" };
}

/**
 * A window in words from its real times, in local time: "Yesterday 2–6 pm", "Tue 10 am – 2 pm",
 * "Yesterday 10 pm – today 2 am". A window that ends at midnight ends on its own day: "Yesterday 8 pm – 12 am".
 */
export function windowSpan(start: number, end: number, now: number): string {
  const a = clock(start), b = clock(end);
  const endsAtMidnight = end === dayStart(end) && dayStart(start) === dayStart(end - 1);
  if (dayStart(start) === dayStart(end) || endsAtMidnight) {
    const day = dayWord(start, now);
    return a.half === b.half && !endsAtMidnight ? `${day} ${a.time}–${b.time} ${b.half}` : `${day} ${a.time} ${a.half} – ${b.time} ${b.half}`;
  }
  const second = dayWord(end, now);
  return `${dayWord(start, now)} ${a.time} ${a.half} – ${/^(Today|Yesterday)$/.test(second) ? second.toLowerCase() : second} ${b.time} ${b.half}`;
}

/**
 * The window a canvas shows, as a sentence names it: "the last 4 hours" live, else "this window", since the bar
 * states a past window's span beside it ("Not in this window").
 */
export const windowWords = (w: { live: boolean; hours: number }) => (w.live ? windowPhrase(w.hours) : "this window");
