/**
 * Where the What's moving inspector layer sits (home-moving-signal.tsx).
 *
 * The layer is pinned to the panel's right edge, over the end of the rows
 * where the context gauges sit, so the selected row's name and action stay
 * readable beside it. Its top starts level with the selected row. When the
 * content would run past the bottom of the window, the layer slides up just
 * far enough to fit, so a low row never gets a cramped layer. Only a window
 * shorter than the content makes the body scroll.
 */

export interface LayerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface InspectorLayerPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  host: Element;
}

export const INSPECTOR_LAYER_WIDTH = 380;
/** Clearance from the window edges. */
const EDGE = 16;
/** Inset from the panel's right edge, so the layer reads as part of it. */
const INSET = 8;
/** The smallest layer worth drawing; under this the body scrolls. */
const MIN_HEIGHT = 160;

/**
 * `contentHeight` is the layer's natural height, measured after it renders.
 * Pass 0 before the first measurement: the layer then starts on the row and
 * is placed again once its height is known.
 */
export function inspectorLayerPlacement(
  row: LayerRect,
  stage: LayerRect,
  viewportWidth: number,
  viewportHeight: number,
  host: Element,
  contentHeight = 0,
): InspectorLayerPlacement | null {
  // A row scrolled out of the window takes its layer with it.
  if (row.bottom <= 0 || row.top >= viewportHeight) return null;

  const width = Math.min(INSPECTOR_LAYER_WIDTH, Math.max(0, viewportWidth - EDGE * 2));
  const left = Math.max(EDGE, Math.min(stage.right - width - INSET, viewportWidth - width - EDGE));

  const room = Math.max(MIN_HEIGHT, viewportHeight - EDGE * 2);
  const height = Math.min(Math.max(0, contentHeight), room);
  const top = Math.max(EDGE, Math.min(row.top, viewportHeight - EDGE - height));

  return { top, left, width, maxHeight: Math.max(MIN_HEIGHT, viewportHeight - EDGE - top), host };
}

export function samePlacement(a: InspectorLayerPlacement, b: InspectorLayerPlacement | null): boolean {
  return b !== null
    && a.top === b.top
    && a.left === b.left
    && a.width === b.width
    && a.maxHeight === b.maxHeight
    && a.host === b.host;
}
