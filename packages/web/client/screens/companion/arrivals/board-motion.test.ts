import { describe, expect, test } from "bun:test";

import {
  ENTER_MS, FLAP_TICK_MS, FOLD_GRACE_MS, FOLD_MS, FRAME_MS, HOVER_INTENT_MS, NEWS_CELL_MS, NEWS_FIRST_MS, PASS_MS, PASS_ROW_MS, PULSE_MS,
  QUIET_AFTER_MS, RIFFLE_CELL_MS, RIFFLE_FIRST_MS, ROW_STEP_MS, ROW_STEPS_MAX, UNFOLD_MS, WIDEN_MS, RISE_MS, DROP_MS, NARROW_MS, newsSettle, openDelay, nextPassIn, passFloor, pulseDelay, riffleSettle, riffleSpan, waveDelay,
} from "./board-motion.ts";
import { STATUS_CELLS } from "./arrivals-model.ts";

describe("board motion", () => {
  test("every time is a whole number of frames", () => {
    for (const ms of [HOVER_INTENT_MS, FOLD_GRACE_MS, WIDEN_MS, RISE_MS, UNFOLD_MS, DROP_MS, NARROW_MS, FOLD_MS, ENTER_MS, ROW_STEP_MS, FLAP_TICK_MS, RIFFLE_FIRST_MS, RIFFLE_CELL_MS, NEWS_FIRST_MS, NEWS_CELL_MS, PULSE_MS, PASS_MS, PASS_ROW_MS, QUIET_AFTER_MS]) {
      expect(ms % FRAME_MS).toBe(0);
    }
    for (let row = 0; row < 12; row++) {
      for (let cell = 0; cell < STATUS_CELLS; cell++) {
        expect(riffleSettle(waveDelay(row, 12, true), cell) % FRAME_MS).toBe(0);
        expect(newsSettle(cell) % FRAME_MS).toBe(0);
      }
    }
  });

  test("the wave starts at the corner the board hangs from", () => {
    expect(waveDelay(4, 5, true)).toBe(0);
    expect(waveDelay(3, 5, true)).toBe(ROW_STEP_MS);
    expect(waveDelay(0, 5, false)).toBe(0);
    expect(waveDelay(1, 5, false)).toBe(ROW_STEP_MS);
  });

  test("far rows come in together, so a long board opens as fast as a short one", () => {
    expect(waveDelay(0, 40, true)).toBe(ROW_STEPS_MAX * ROW_STEP_MS);
    expect(waveDelay(39, 40, false)).toBe(ROW_STEPS_MAX * ROW_STEP_MS);
  });

  test("a row's flaps land after it starts coming in, left to right, a frame apart", () => {
    const start = waveDelay(2, 6, true);
    expect(riffleSettle(start, 0)).toBeGreaterThan(start);
    expect(riffleSettle(start, 1) - riffleSettle(start, 0)).toBe(FRAME_MS);
  });

  test("the open is two moves, widen then rise, over in about a third of a second; the last flap lands inside half a second", () => {
    expect(UNFOLD_MS).toBe(WIDEN_MS + RISE_MS);
    expect(RISE_MS).toBeGreaterThan(WIDEN_MS);
    expect(UNFOLD_MS).toBeLessThanOrEqual(320);
    expect(riffleSpan(STATUS_CELLS)).toBeLessThanOrEqual(480);
  });

  test("the fold is the open backwards and quicker: drop, then narrow", () => {
    expect(FOLD_MS).toBe(DROP_MS + NARROW_MS);
    expect(FOLD_MS).toBeLessThan(UNFOLD_MS);
  });

  test("opening: the corner item comes in with the widen, the rest as the board rises to them", () => {
    expect(openDelay(4, 5, true)).toBe(0);
    expect(openDelay(3, 5, true)).toBe(WIDEN_MS);
    expect(openDelay(2, 5, true)).toBe(WIDEN_MS + ROW_STEP_MS);
    expect(openDelay(0, 5, false)).toBe(0);
    expect(openDelay(1, 5, false)).toBe(WIDEN_MS);
    expect(openDelay(0, 40, true)).toBe(WIDEN_MS + (ROW_STEPS_MAX - 1) * ROW_STEP_MS);
    for (let i = 0; i < 12; i++) expect(openDelay(i, 12, true) % FRAME_MS).toBe(0);
  });

  test("news turns slower than the open riffle, so a change is seen", () => {
    expect(newsSettle(STATUS_CELLS - 1)).toBeGreaterThan(riffleSettle(0, STATUS_CELLS - 1));
  });

  test("blinks started at any time share one phase", () => {
    for (const now of [0, 17, 1279, 1280, 5000.5, 123456]) {
      const phase = (((now + pulseDelay(now)) % PULSE_MS) + PULSE_MS) % PULSE_MS;
      expect(phase).toBeCloseTo(0, 6);
      expect(pulseDelay(now)).toBeLessThanOrEqual(0);
    }
  });

  test("the pass is 30 s on the wall clock, so every board rewrites on :00 and :30", () => {
    expect(PASS_MS).toBe(30_000);
    expect(PASS_ROW_MS).toBe(3 * FRAME_MS);
    expect(QUIET_AFTER_MS).toBe(5 * 60_000);
    const at = new Date(2026, 9, 15, 11, 30, 17, 250).getTime();
    expect(new Date(passFloor(at)).getSeconds()).toBe(0);
    expect(new Date(passFloor(at + 13_000)).getSeconds()).toBe(30);
    expect(nextPassIn(at)).toBe(12_750);
    expect(nextPassIn(passFloor(at))).toBe(PASS_MS);
  });
});
