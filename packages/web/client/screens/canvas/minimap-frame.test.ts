import { describe, expect, test } from "bun:test";

import { camCenteredOn, MAP_MAX, minimapFrame, seenBox } from "./minimap-frame.ts";

describe("minimapFrame", () => {
  test("a tall scene gets a tall, narrow map that stays inside MAP_MAX", () => {
    const m = minimapFrame({ x: 0, y: 0, w: 2000, h: 8000 });
    expect(m.h).toBe(MAP_MAX);
    expect(m.w).toBeLessThan(m.h);
    const all = m.toMap({ x: 0, y: 0, w: 2000, h: 8000 });
    expect(all.x).toBeGreaterThanOrEqual(0);
    expect(all.y).toBeGreaterThanOrEqual(0);
    expect(all.x + all.w).toBeLessThanOrEqual(m.w + 1e-9);
    expect(all.y + all.h).toBeLessThanOrEqual(m.h + 1e-9);
  });

  test("a wide scene gets a wide map", () => {
    const m = minimapFrame({ x: 0, y: 0, w: 4000, h: 1000 });
    expect(m.w).toBe(MAP_MAX);
    expect(m.h).toBeLessThan(m.w);
  });

  test("given a box, the map is that box with the scene centred and whole in it", () => {
    const map = minimapFrame({ x: 0, y: 0, w: 2000, h: 400 }, { w: 700, h: 220 });
    expect([map.w, map.h]).toEqual([700, 220]);
    const r = map.toMap({ x: 0, y: 0, w: 2000, h: 400 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(700);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(220);
    expect(Math.abs(r.x + r.w / 2 - 350)).toBeLessThan(1);
  });

  test("map and world points round-trip", () => {
    const m = minimapFrame({ x: 0, y: 0, w: 2088, h: 5400 });
    const r = m.toMap({ x: 1200, y: 3100, w: 0, h: 0 });
    const back = m.toWorld(r.x, r.y);
    expect(back.x).toBeCloseTo(1200, 6);
    expect(back.y).toBeCloseTo(3100, 6);
  });
});

describe("the camera on the map", () => {
  const view = { w: 1200, h: 800 };

  test("the seen box is the view in world units", () => {
    expect(seenBox({ x: -100, y: -50, k: 0.5 }, view)).toEqual({ x: 200, y: 100, w: 2400, h: 1600 });
  });

  test("centring on a point puts it in the middle of the view, at the same zoom", () => {
    const cam = camCenteredOn({ x: 0, y: 0, k: 0.5 }, view, { x: 1000, y: 2000 });
    expect(cam.k).toBe(0.5);
    const seen = seenBox(cam, view);
    expect(seen.x + seen.w / 2).toBeCloseTo(1000, 6);
    expect(seen.y + seen.h / 2).toBeCloseTo(2000, 6);
  });
});
