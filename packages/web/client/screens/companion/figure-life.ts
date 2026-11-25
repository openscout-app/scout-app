/*
 * A figure's own idle life: a quick blink now and then, and a glance toward
 * the pointer. Both are small on purpose: no glow, no bounce, a few pixels at
 * most, and nothing at all under Reduce Motion, for a figure set to Still,
 * or while the page is hidden.
 *
 * Nothing here renders through React. The hook writes one class (the blink)
 * and two custom properties (the glance) on the figure's element, and CSS
 * draws them (edge.css, "idle life"):
 *
 *  - The blink: `is-blinking` for BLINK.SHUT ms, on an irregular clock
 *    (BLINK.GAP plus up to BLINK.SPREAD). Crew art with an eye sheet shows
 *    its shut-eye patch; the LED tile drops a lid over its lights; a sprite
 *    squeezes its eyes. Art with no eye sheet does not blink.
 *  - The glance: `--gaze-x` / `--gaze-y`, each -1..1, toward the pointer
 *    while it is within GAZE.RADIUS of the figure, easing back to 0 when it
 *    goes further, leaves, or rests for GAZE.IDLE ms. CSS turns them into a
 *    lean of a pixel or two (art) or a shift of the lights (LED).
 *
 * The pointer is the page's own (crew-gaze.ts: one shared listener, one
 * callback per animation frame). In edge mode the host reports only which
 * hit region the pointer is over, not where it is, so a figure glances only
 * while the page itself hears the pointer: the browser preview, and the
 * desktop panel once it is key (a talk card or menu is open).
 */

import { useEffect, useRef, type RefObject } from "react";

import { subscribePointer, type PointerSample } from "../../lib/crew-gaze.ts";

export const BLINK = {
  /** The shortest gap between blinks. */
  GAP: 2600,
  /** Up to this much more, at random, so blinks never fall into a rhythm. */
  SPREAD: 4200,
  /** How long the eyes stay shut; with the lid's ease up after it, a blink reads at 130 to 180 ms. */
  SHUT: 130,
  /** Now and then a second blink right after the first, as people do. */
  DOUBLE: 0.18,
  DOUBLE_GAP: 160,
};

export const GAZE = {
  /** Beyond this many pixels from the figure's centre, it looks at its own work. */
  RADIUS: 280,
  /** Within this many pixels the glance grows from nothing, so a pointer on the figure does not make it squint. */
  NEAR: 70,
  /** Pointer silence after which the glance settles back to rest. */
  IDLE: 1800,
};

/** How long a measured rect is trusted. */
const RECT_TTL = 250;

/** The next gap between blinks: GAP plus a random share of SPREAD. */
export function nextBlinkIn(random: () => number = Math.random): number {
  return Math.round(BLINK.GAP + random() * BLINK.SPREAD);
}

/**
 * The glance toward a pointer `dx, dy` pixels from the figure's centre, as
 * -1..1 per axis: toward it, growing over the first NEAR pixels, and nothing
 * once it is past RADIUS.
 */
export function gazeToward(dx: number, dy: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > GAZE.RADIUS) return { x: 0, y: 0 };
  const reach = Math.min(1, d / GAZE.NEAR);
  const round = (v: number) => Math.round(v * 100) / 100 || 0;
  return { x: round((dx / d) * reach), y: round((dy / d) * reach) };
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Gives the element at `ref` its idle life while `on`: a blink when `blink`,
 * a glance when `gaze`. Off, hidden or under Reduce Motion it holds no timer
 * and no listener.
 */
export function useFigureLife(ref: RefObject<HTMLElement | null>, { on, blink = true, gaze = true }: { on: boolean; blink?: boolean; gaze?: boolean }): void {
  const running = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof window === "undefined" || reducedMotion()) return;
    let timers: number[] = [];
    let unsubscribe: (() => void) | null = null;
    let rect: DOMRect | null = null;
    let measuredAt = 0;
    let idle = 0;

    const clear = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      window.clearTimeout(idle);
      el.classList.remove("is-blinking");
    };
    const rest = () => {
      el.style.setProperty("--gaze-x", "0");
      el.style.setProperty("--gaze-y", "0");
    };
    const shut = (then?: () => void) => {
      el.classList.add("is-blinking");
      timers.push(window.setTimeout(() => {
        el.classList.remove("is-blinking");
        then?.();
      }, BLINK.SHUT));
    };
    const schedule = () => {
      timers.push(window.setTimeout(() => {
        timers = [];
        if (Math.random() < BLINK.DOUBLE) shut(() => timers.push(window.setTimeout(() => shut(schedule), BLINK.DOUBLE_GAP)));
        else shut(schedule);
      }, nextBlinkIn()));
    };
    const look = (p: PointerSample) => {
      window.clearTimeout(idle);
      if (p.gone) return rest();
      if (!rect || p.at - measuredAt > RECT_TTL) {
        rect = el.getBoundingClientRect();
        measuredAt = p.at;
      }
      if (rect.width === 0) return rest();
      const g = gazeToward(p.x - (rect.left + rect.width / 2), p.y - (rect.top + rect.height / 2));
      el.style.setProperty("--gaze-x", String(g.x));
      el.style.setProperty("--gaze-y", String(g.y));
      idle = window.setTimeout(rest, GAZE.IDLE);
    };

    const start = () => {
      if (running.current) return;
      running.current = true;
      if (blink) schedule();
      if (gaze) unsubscribe = subscribePointer(look);
    };
    const stop = () => {
      running.current = false;
      clear();
      unsubscribe?.();
      unsubscribe = null;
      rect = null;
      rest();
    };
    const onVisibility = () => (pageVisible() ? start() : stop());

    el.classList.add("has-life");
    if (pageVisible()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      el.classList.remove("has-life");
    };
  }, [ref, on, blink, gaze]);
}
