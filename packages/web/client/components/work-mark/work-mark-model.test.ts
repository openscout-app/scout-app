import { describe, expect, test } from "bun:test";
import { WORK_MARK_PERIOD_MS, WORK_MARK_RING, workMarkDots, workMarkPhase, type WorkMarkState } from "./work-mark-model.ts";

const lit = (state: WorkMarkState) => workMarkDots(state).filter((d) => d.lit).map((d) => `${d.x},${d.y}`).sort().join(" ");

describe("work mark", () => {
  test("is a 4×4 matrix in every state", () => {
    for (const state of ["working", "waiting", "idle"] as const) expect(workMarkDots(state)).toHaveLength(16);
  });

  test("each state reads differently while still", () => {
    expect(lit("waiting")).not.toBe(lit("idle"));
    expect(lit("waiting")).toBe("1,0 1,1 1,3 2,0 2,1 2,3");
    expect(lit("idle")).toBe("1,1 1,2 2,1 2,2");
  });

  test("only working moves: the whole ring, in order", () => {
    const ring = workMarkDots("working").filter((d) => d.ring !== null);
    expect(ring).toHaveLength(12);
    for (const dot of ring) expect(WORK_MARK_RING[dot.ring!]).toEqual([dot.x, dot.y]);
    expect(workMarkDots("waiting").some((d) => d.ring !== null)).toBe(false);
    expect(workMarkDots("idle").some((d) => d.ring !== null)).toBe(false);
  });

  test("reduced motion holds the running dot and its tail", () => {
    const held = workMarkDots("working").filter((d) => d.held !== null).map((d) => [d.ring, d.held]);
    expect(held.sort((a, b) => (b[1] as number) - (a[1] as number))).toEqual([[0, 1], [11, 0.6], [10, 0.35]]);
  });

  test("the phase puts marks in step with the document clock", () => {
    expect(workMarkPhase(0)).toBe(-0);
    expect(workMarkPhase(WORK_MARK_PERIOD_MS * 3 + 400)).toBe(-400);
    expect(workMarkPhase(250)).toBe(-250);
  });
});
