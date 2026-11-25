/** A row becomes a desk figure only when released beyond the board's rim. */
export const ROW_PULL_SLOP = 6;
export const ROW_PULL_RIM = 12;
type Point = { x: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number };
export type RowPullCue = Point & { ready: boolean };

/** Cue sits at the nearest edge, clear of the corners; the same rim gates release. */
export function rowPullCue(point: Point, box: Box): RowPullCue {
  const edges = [
    { distance: point.x - box.left, x: box.left, y: point.y },
    { distance: box.right - point.x, x: box.right, y: point.y },
    { distance: point.y - box.top, x: point.x, y: box.top },
    { distance: box.bottom - point.y, x: point.x, y: box.bottom },
  ];
  const edge = edges.reduce((a, b) => a.distance < b.distance ? a : b);
  return {
    x: Math.max(box.left + 12, Math.min(box.right - 12, edge.x)),
    y: Math.max(box.top + 12, Math.min(box.bottom - 12, edge.y)),
    ready: edge.distance <= -ROW_PULL_RIM,
  };
}

/** Window listeners keep the pull alive among rows and beyond the board. */
export function startRowPull({ from, pointerId, box, preview, drop, moved }: {
  from: Point;
  pointerId: number;
  box: () => Box | null;
  preview: (cue: RowPullCue | null) => void;
  drop: () => void;
  moved: () => void;
}): () => void {
  let pulling = false;
  let active = true;
  const clear = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", cancel);
    document.documentElement.classList.remove("is-pulling-row", "is-row-pull-ready");
    preview(null);
  };
  const cueAt = (e: PointerEvent) => {
    const bounds = box();
    return bounds ? rowPullCue({ x: e.clientX, y: e.clientY }, bounds) : null;
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (!(e.buttons & 1)) { clear(); return; }
    if (!pulling && Math.hypot(e.clientX - from.x, e.clientY - from.y) < ROW_PULL_SLOP) return;
    pulling = true;
    moved();
    e.preventDefault();
    const cue = cueAt(e);
    document.documentElement.classList.add("is-pulling-row");
    document.documentElement.classList.toggle("is-row-pull-ready", cue?.ready ?? false);
    preview(cue);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const ready = pulling && e.type === "pointerup" && cueAt(e)?.ready;
    clear();
    if (ready) drop();
  };
  const cancel = () => clear();
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", cancel);
  return clear;
}
