import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

/*
 * Moving the board: press its chrome above the rows, and drag. Rows and the space
 * among them keep their selection gestures. A press that never travels past the slop is
 * still a click. While it moves, the board's box follows the pointer directly
 * (no render per frame); on release `onDrop` gets the box where it landed and
 * re-anchors it (anchorBoard). Past the page's edge the pointer is over another
 * display: `onCross` asks the host to carry the panel there mid-move, and the
 * board goes on under the pointer on the new page.
 */

/** Past this many points with the button held, a press on the board moves it. */
const MOVE_SLOP = 4;
/** After the host keeps the panel where it is, ask again no sooner than this, not on every frame. */
const CROSS_RETRY_MS = 250;
/** What a press on these does stays theirs: a row pulls out, a field takes text. */
const NOT_A_GRIP = "button, a, [role=\"button\"], input, textarea, select, [contenteditable=\"true\"]";

/**
 * Reported while the board moves, the size of the display. The host holds the pointer from the press on the
 * board until the button is up, so it no longer needs this; it keeps the id for hover only and never lets a
 * region this size hold the desktop outside a press (`ScoutCompanionHitTest.boardMoveRegion`). Hosts from
 * before that rule still read it to hold the drag past the display's edge.
 */
export const BOARD_MOVE_HIT_ID = "board-move";

/** In edge mode the page is one display; a pointer outside it is over another one. */
export function isOffView(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

export function boardMoveHandler({ boxRef, moving, enabled, grip = "[data-board-grip]", pressThrough, onFrame, onDrop, onCross }: {
  /** The positioned box that moves: the board, Scoutbot beside it, and the stack room. */
  boxRef: RefObject<HTMLElement | null>;
  /** True while a move is under way; the board's region report reads it. */
  moving: { current: boolean };
  enabled: boolean;
  /** What a press moves the board from: its chrome above the rows. */
  grip?: string;
  /**
   * Controls inside the grip that still move the board once a press on them
   * travels past the slop (the notch's strip is all buttons); a press that
   * stays put is still their click.
   */
  pressThrough?: string;
  /** Each moved frame: report the new regions, move what is tethered to the board. */
  onFrame: () => void;
  /** `offView`: let go with the pointer outside this page, so over another display. */
  onDrop: (rect: DOMRect, offView: boolean) => void;
  /**
   * The pointer left this page mid-move: the host carries the panel to the
   * display under it and answers where the box now is on the new page (still
   * under the pointer); null when the panel stayed.
   */
  onCross?: (rect: DOMRect) => Promise<{ left: number; top: number } | null>;
}): (e: ReactPointerEvent) => void {
  return (e: ReactPointerEvent) => {
    const box = boxRef.current;
    const target = e.target as Element | null;
    if (!enabled || !box || e.button !== 0 || !target?.closest?.(grip)) return;
    if (target.closest(NOT_A_GRIP) && !(pressThrough && target.closest(pressThrough))) return;
    const start = box.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    // Where the pointer holds the box. It holds there across a display change, whose page has its own origin.
    const grab = { x: from.x - start.left, y: from.y - start.top };
    let frame = 0;
    let crossing: Promise<boolean> | null = null;
    let refusedAt = -Infinity;
    const place = (left: number, top: number) => {
      const s = box.style;
      s.left = `${Math.round(left)}px`;
      s.top = `${Math.round(top)}px`;
      s.right = "auto";
      s.bottom = "auto";
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(onFrame);
    };
    const cross = (ask: NonNullable<typeof onCross>) => {
      crossing = ask(box.getBoundingClientRect()).then(
        (at) => {
          crossing = null;
          if (at) place(at.left, at.top);
          else refusedAt = performance.now();
          return at !== null;
        },
        () => {
          crossing = null;
          refusedAt = performance.now();
          return false;
        },
      );
    };
    const move = (ev: PointerEvent) => {
      if (!moving.current) {
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < MOVE_SLOP) return;
        moving.current = true;
        document.documentElement.classList.add("is-moving-board");
        // The notch centres itself with a translate; moving, the box stands where it shows.
        box.style.translate = "none";
      }
      ev.preventDefault();
      place(ev.clientX - grab.x, ev.clientY - grab.y);
      if (onCross && !crossing && performance.now() - refusedAt >= CROSS_RETRY_MS
        && isOffView(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight)) cross(onCross);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cancelAnimationFrame(frame);
      if (!moving.current) return;
      document.documentElement.classList.remove("is-moving-board");
      // The release ends a move, not a press: the button under it is not clicked.
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const offView = ev.type === "pointerup" && isOffView(ev.clientX, ev.clientY, window.innerWidth, window.innerHeight);
      // The move is over at the release, before the drop runs: the next region
      // report drops the display-sized hold even if the drop throws, or waits
      // on a display carry the host has not answered yet.
      moving.current = false;
      requestAnimationFrame(onFrame);
      const drop = (carried: boolean) => {
        try {
          // A carry that landed put the board under the pointer on the new page: that is in view.
          onDrop(box.getBoundingClientRect(), offView && !carried);
        } finally {
          requestAnimationFrame(onFrame);
        }
      };
      // Let go while the host is still carrying the panel: drop once it has answered.
      if (crossing) void crossing.then(drop);
      else drop(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
}
