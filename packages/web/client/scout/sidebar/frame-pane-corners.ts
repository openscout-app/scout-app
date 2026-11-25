/**
 * Pane corners inside the app frame's sheet (frame.css, FrameSheet).
 *
 * Panes are square. Where two panes meet, or a pane meets a seam, a curve
 * reads as a notch, so the Corners setting rounds only the outside: the
 * window and the sheet. The one pane corner that curves is a corner sitting
 * in one of the sheet's four corners. It follows the sheet's arc, concentric
 * with it, so the pane's edge keeps the same distance from the sheet's edge
 * all the way round. Square and Near-square sheets leave every pane square.
 *
 * Grid layouts, docked sides, folds and the view's bar all move panes, so
 * this measures. It reads the sheet's box and radius and each pane's box,
 * and writes the radius per corner as --pane-r-tl, -tr, -br and -bl
 * (hud-grid.css, views.css).
 */

export type PaneCorner = "tl" | "tr" | "br" | "bl";
export const PANE_CORNERS: readonly PaneCorner[] = ["tl", "tr", "br", "bl"];

type Box = { left: number; top: number; right: number; bottom: number };

/** A pane corner this close to the sheet's corner, on both axes, sits in it. */
export const PANE_CORNER_REACH = 12;

/**
 * The radius for each of a pane's corners: the sheet's radius less the
 * pane's inset at that corner, or 0 for a corner away from the sheet's.
 */
export function paneCornerRadii(sheet: Box, pane: Box, sheetRadius: number): Record<PaneCorner, number> {
  const inset = {
    left: pane.left - sheet.left,
    top: pane.top - sheet.top,
    right: sheet.right - pane.right,
    bottom: sheet.bottom - pane.bottom,
  };
  const at = (x: number, y: number) => {
    if (sheetRadius <= 0) return 0;
    if (x < -0.5 || y < -0.5 || x > PANE_CORNER_REACH || y > PANE_CORNER_REACH) return 0;
    const r = sheetRadius - Math.max(x, y, 0);
    return r > 0 ? Math.round(r * 2) / 2 : 0;
  };
  return {
    tl: at(inset.left, inset.top),
    tr: at(inset.right, inset.top),
    br: at(inset.right, inset.bottom),
    bl: at(inset.left, inset.bottom),
  };
}

const PANES = ".hud-grid-panel, .vw-side-strip";

/**
 * Keeps the pane corners under `center` in step with the sheet drawn by
 * `.scout-frame-edge`. Returns the teardown. Work is coalesced to one
 * measure per animation frame.
 */
export function watchFramePaneCorners(center: HTMLElement): () => void {
  let frame = 0;
  const tagged = new Set<HTMLElement>();
  const observed = new Set<Element>();
  const clear = (el: HTMLElement) => {
    for (const c of PANE_CORNERS) el.style.removeProperty(`--pane-r-${c}`);
  };
  const resize = new ResizeObserver(() => schedule());
  const observe = (el: Element) => {
    if (observed.has(el)) return;
    observed.add(el);
    resize.observe(el);
  };
  const measure = () => {
    frame = 0;
    const edge = document.querySelector<HTMLElement>(".scout-frame-edge");
    const panes = center.querySelectorAll<HTMLElement>(PANES);
    const current = new Set<Element>([center, ...panes]);
    if (edge) current.add(edge);
    for (const el of observed) {
      if (!current.has(el)) { resize.unobserve(el); observed.delete(el); }
    }
    for (const el of current) observe(el);
    const sheet = edge?.getBoundingClientRect();
    const radius = edge ? parseFloat(getComputedStyle(edge).borderTopLeftRadius) || 0 : 0;
    // Read every box before the first style write can invalidate layout.
    const measurements = Array.from(panes, el => ({
      el, radii: sheet && !el.classList.contains("is-lifted")
        ? paneCornerRadii(sheet, el.getBoundingClientRect(), radius) : null,
    }));
    for (const { el, radii } of measurements) {
      for (const corner of PANE_CORNERS) {
        const property = `--pane-r-${corner}`;
        const value = radii?.[corner] ? `${radii[corner]}px` : "";
        if (el.style.getPropertyValue(property) !== value) el.style.setProperty(property, value);
      }
      if (radii && Object.values(radii).some(Boolean)) tagged.add(el);
      else tagged.delete(el);
    }
    for (const el of tagged) {
      if (!current.has(el)) { clear(el); tagged.delete(el); }
    }
  };
  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure);
  }
  observe(center);
  // panes come and go with layouts and routes; the Corners setting and the
  // gap density change the sheet's radius and the insets without a resize
  const tree = new MutationObserver(records => {
    for (const record of records) {
      // Text and readout rows churn inside a pane. ResizeObserver handles
      // content that changes its size. Outside a pane, siblings can move it.
      if (record.target instanceof Element && !record.target.closest(PANES)) { schedule(); return; }
      for (const nodes of [record.addedNodes, record.removedNodes]) {
        for (const node of nodes) {
          if (node instanceof Element && (node.matches(PANES) || node.querySelector(PANES))) { schedule(); return; }
        }
      }
    }
  });
  tree.observe(center, { childList: true, subtree: true });
  const root = new MutationObserver(schedule);
  root.observe(document.documentElement, { attributes: true });
  center.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  schedule();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    resize.disconnect();
    tree.disconnect();
    root.disconnect();
    center.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
    for (const el of tagged) clear(el);
    tagged.clear();
  };
}
