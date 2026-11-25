/**
 * The board's open and fold, as two moves each (board-motion.ts). Opening:
 * the folded card widens along its edge to the board's width, then the board
 * rises away from its corner, overshooting a touch and settling. Folding: the
 * board drops back to its strip, then narrows into the card.
 *
 * Drawn with the Web Animations API on the board itself, so each move gets its
 * own curve on the one clock and nothing is left behind when it ends: the open
 * board carries no clip and no transform between gestures.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";
import { DROP_MS, EASE_GATHER, EASE_IN, EASE_OUT, FOLD_MS, RISE_MS, RISE_POP, RISE_POP_AT, UNFOLD_MS, WIDEN_MS, prefersReducedMotion } from "./board-motion.ts";

export type BoardSize = { w: number; h: number };
/** Where the board hangs: top or bottom, left or right. */
export type BoardCorner = { top: boolean; left: boolean };
export type BoardMove = { keyframes: Keyframe[]; timing: KeyframeAnimationOptions };

/** Room past the board's edges for its shadow (0 14px 30px), so a clip never cuts it. */
const SHADOW_SIDE = 32;
const SHADOW_BELOW = 48;
/** The board's corner (--arv-r-out) when it can't be read: Rounded. */
const RADIUS = 10;

/**
 * The clip that shows `shown` of a board `full` big, from its corner. The
 * anchored sides sit outside the board; a moving side that has reached the
 * board's edge sits on it until the last stop, where it opens to the shadow.
 */
export function boardClip(full: BoardSize, shown: BoardSize | "all", corner: BoardCorner, radius = RADIUS): string {
  const all = shown === "all";
  const v = all ? -(corner.top ? SHADOW_BELOW : SHADOW_SIDE) : Math.max(0, Math.round(full.h - shown.h));
  const h = all ? -SHADOW_SIDE : Math.max(0, Math.round(full.w - shown.w));
  const top = corner.top ? -SHADOW_SIDE : v;
  const bottom = corner.top ? v : -SHADOW_BELOW;
  const left = corner.left ? -SHADOW_SIDE : h;
  const right = corner.left ? h : -SHADOW_SIDE;
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

/** Opening: widen along the edge, then rise; the rise lands with a small pop on the far edge. */
export function unfoldMoves(full: BoardSize, card: BoardSize, corner: BoardCorner, radius = RADIUS): BoardMove[] {
  const strip = { w: full.w, h: card.h };
  const origin = corner.top ? "50% 0%" : "50% 100%";
  return [
    {
      keyframes: [
        { offset: 0, clipPath: boardClip(full, card, corner, radius), easing: EASE_GATHER },
        { offset: WIDEN_MS / UNFOLD_MS, clipPath: boardClip(full, strip, corner, radius), easing: EASE_OUT },
        { offset: 1, clipPath: boardClip(full, "all", corner, radius) },
      ],
      timing: { duration: UNFOLD_MS },
    },
    {
      keyframes: [
        { offset: 0, transform: "scaleY(1)", transformOrigin: origin, easing: EASE_OUT },
        { offset: RISE_POP_AT, transform: `scaleY(${1 + RISE_POP})`, transformOrigin: origin, easing: EASE_OUT },
        { offset: 1, transform: "scaleY(1)", transformOrigin: origin },
      ],
      timing: { duration: RISE_MS, delay: WIDEN_MS },
    },
  ];
}

/** Folding: drop to the strip, then narrow into the card; it holds there until the board folds. */
export function foldMoves(full: BoardSize, card: BoardSize, corner: BoardCorner, radius = RADIUS): BoardMove[] {
  const strip = { w: full.w, h: card.h };
  return [
    {
      keyframes: [
        { offset: 0, clipPath: boardClip(full, "all", corner, radius), easing: EASE_IN },
        { offset: DROP_MS / FOLD_MS, clipPath: boardClip(full, strip, corner, radius), easing: EASE_OUT },
        { offset: 1, clipPath: boardClip(full, card, corner, radius) },
      ],
      timing: { duration: FOLD_MS, fill: "forwards" },
    },
  ];
}

/**
 * Runs the open when the board opens (or is caught mid-fold), and the fold
 * while it closes. `card` is the folded card the board grew from; a new one
 * means a new open. Everything is cancelled before paint once the board has
 * folded, so the folded card is never left clipped.
 */
export function useBoardUnfold(ref: RefObject<HTMLElement | null>, s: { open: boolean; closing: boolean; card: BoardSize | null } & BoardCorner): void {
  const running = useRef<Animation[]>([]);
  const corner = useRef<BoardCorner>({ top: s.top, left: s.left });
  corner.current = { top: s.top, left: s.left };
  useLayoutEffect(() => {
    for (const a of running.current) a.cancel();
    running.current = [];
    const el = ref.current;
    if (!s.open || !s.card || !el || typeof el.animate !== "function" || prefersReducedMotion()) return;
    const full = { w: el.offsetWidth, h: el.offsetHeight };
    // The clip rounds as the board does: its look and the app's corner setting.
    const drawn = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
    const radius = Number.isFinite(drawn) ? drawn : RADIUS;
    const moves = s.closing ? foldMoves(full, s.card, corner.current, radius) : unfoldMoves(full, s.card, corner.current, radius);
    running.current = moves.map((m) => el.animate(m.keyframes, m.timing));
  }, [ref, s.open, s.closing, s.card]);
  useLayoutEffect(() => () => {
    for (const a of running.current) a.cancel();
  }, []);
}
