import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";
import { DROP_MS, FOLD_MS, RISE_MS, UNFOLD_MS, WIDEN_MS } from "./board-motion.ts";

// @ts-expect-error -- the relative .js path keeps bun's runtime resolution to the real react
// module; a bare "react" specifier would be hijacked by tsconfig `paths` to the .d.ts (the module
// imports `useLayoutEffect`). The cast restores the types the path import otherwise loses.
const React = (await import("../../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);

const { boardClip, foldMoves, unfoldMoves } = await import("./board-unfold.ts");

const FULL = { w: 440, h: 400 };
const CARD = { w: 320, h: 36 };
const BR = { top: false, left: false };

describe("board clip", () => {
  test("the card shows from the corner; the anchored sides sit outside the board for its shadow", () => {
    expect(boardClip(FULL, CARD, BR)).toBe("inset(364px -32px -48px 120px round 10px)");
    expect(boardClip(FULL, CARD, { top: false, left: true })).toBe("inset(364px 120px -48px -32px round 10px)");
    expect(boardClip(FULL, CARD, { top: true, left: false })).toBe("inset(-32px -32px 364px 120px round 10px)");
    expect(boardClip(FULL, CARD, { top: true, left: true })).toBe("inset(-32px 120px 364px -32px round 10px)");
  });

  test("the strip is the board's full width at the card's height; the moving side sits on the board's edge", () => {
    expect(boardClip(FULL, { w: FULL.w, h: CARD.h }, BR)).toBe("inset(364px -32px -48px 0px round 10px)");
  });

  test("all of it opens every side to the shadow", () => {
    expect(boardClip(FULL, "all", BR)).toBe("inset(-32px -32px -48px -32px round 10px)");
    expect(boardClip(FULL, "all", { top: true, left: true })).toBe("inset(-32px -32px -48px -32px round 10px)");
  });

  test("a card bigger than the board never clips past it", () => {
    expect(boardClip(CARD, FULL, BR)).toBe("inset(0px -32px -48px 0px round 10px)");
  });
});

describe("open and fold", () => {
  test("open: widen to the strip, then rise to all of it, on the one clock", () => {
    const [clip, pop] = unfoldMoves(FULL, CARD, BR);
    expect(clip.timing.duration).toBe(UNFOLD_MS);
    expect(clip.keyframes.map((k) => k.offset)).toEqual([0, WIDEN_MS / UNFOLD_MS, 1]);
    expect(clip.keyframes.map((k) => k.clipPath)).toEqual([
      boardClip(FULL, CARD, BR),
      boardClip(FULL, { w: FULL.w, h: CARD.h }, BR),
      boardClip(FULL, "all", BR),
    ]);
    // The pop rides the rise and ends where it started: nothing is left on the board.
    expect(pop.timing).toEqual({ duration: RISE_MS, delay: WIDEN_MS });
    expect(pop.keyframes[0].transform).toBe("scaleY(1)");
    expect(pop.keyframes.at(-1)?.transform).toBe("scaleY(1)");
    expect(pop.keyframes.some((k) => k.transform !== "scaleY(1)")).toBe(true);
    expect(pop.keyframes[0].transformOrigin).toBe("50% 100%");
    expect(unfoldMoves(FULL, CARD, { top: true, left: false })[1].keyframes[0].transformOrigin).toBe("50% 0%");
  });

  test("fold: drop to the strip, then narrow into the card, and hold there until the board folds", () => {
    const [clip] = foldMoves(FULL, CARD, BR);
    expect(clip.timing).toEqual({ duration: FOLD_MS, fill: "forwards" });
    expect(clip.keyframes.map((k) => k.offset)).toEqual([0, DROP_MS / FOLD_MS, 1]);
    expect(clip.keyframes.map((k) => k.clipPath)).toEqual([
      boardClip(FULL, "all", BR),
      boardClip(FULL, { w: FULL.w, h: CARD.h }, BR),
      boardClip(FULL, CARD, BR),
    ]);
  });

  test("the clip rounds as the board is drawn: square and drafting corners carry through every frame", () => {
    expect(boardClip(FULL, CARD, BR, 0)).toBe("inset(364px -32px -48px 120px round 0px)");
    expect(boardClip(FULL, "all", BR, 8)).toBe("inset(-32px -32px -48px -32px round 8px)");
    for (const move of [unfoldMoves(FULL, CARD, BR, 0)[0], foldMoves(FULL, CARD, BR, 0)[0]]) {
      expect(move.keyframes.every((k) => String(k.clipPath).endsWith("round 0px)"))).toBe(true);
    }
  });
});
