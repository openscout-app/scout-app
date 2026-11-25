import { useLayoutEffect, useState } from "react";

/**
 * Home's width, at which it takes a third column (front-page.css, "three
 * panes"): two equal side columns at their 280px floor (--fp-side), two 24px
 * gaps and two 24px gutters, which leaves the Feed 544px, about 560px at a
 * 1280px window. Measured on Home's own pane, so the app's side nav is
 * already counted: a 1280px window, half of a 2560px display, is about
 * 1210px here.
 */
export const HOME_WIDE_MIN = 1200;

export function isHomeWide(paneWidth: number): boolean {
  return paneWidth >= HOME_WIDE_MIN;
}

/**
 * Whether Home is wide enough for three columns. The ref goes on the panes;
 * the width read is Home's scroll pane (.s-front) round them. Measured before
 * paint, so a wide window never draws two columns first.
 *
 * A hook rather than a container query: Running moves between panes, and a
 * component mounts in one place or the other, never both.
 */
export function useHomeWide(): [(el: HTMLElement | null) => void, boolean] {
  const [setEl, width] = useWidth((el) => el.closest<HTMLElement>(".s-front") ?? el);
  return [setEl, isHomeWide(width)];
}

/**
 * An element's width (clientWidth), kept current; 0 until it mounts.
 */
export function useWidth(pick: (el: HTMLElement) => HTMLElement = (el) => el): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const target = el ? pick(el) : null;
    if (!target) return;
    const measure = () => setWidth(target.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    return () => ro.disconnect();
    // `pick` is a fixed choice per caller; the element is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);
  return [setEl, width];
}
