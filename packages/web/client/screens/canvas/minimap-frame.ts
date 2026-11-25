/*
 * Canvas minimap: the whole scene shrunk into a box no larger than MAP_MAX on a side, shaped like the scene, and the
 * camera's view on it. Pure, so it can be tested without a page.
 */
import type { Box } from "./scene.ts";

export type Cam = { x: number; y: number; k: number };
export type Size = { w: number; h: number };

export const MAP_MAX = 196;
const MAP_MIN = 56;
const PAD = 6;

export type MapFrame = {
  w: number;
  h: number;
  scale: number;
  toMap: (b: Box) => Box;
  toWorld: (x: number, y: number) => { x: number; y: number };
};

/**
 * A map shaped like the scene: a tall canvas gets a tall, narrow map, never wider or taller than MAP_MAX. Given a
 * box (`into`), the map is that box and the scene sits centred in it (Home's glance of the canvas, glance.ts).
 */
export function minimapFrame(bounds: Box, into?: Size): MapFrame {
  const bw = Math.max(1, bounds.w), bh = Math.max(1, bounds.h);
  const fit = (MAP_MAX - PAD * 2) / Math.max(bw, bh);
  const w = into ? Math.max(PAD * 2 + 1, Math.round(into.w)) : Math.max(MAP_MIN, Math.round(bw * fit + PAD * 2));
  const h = into ? Math.max(PAD * 2 + 1, Math.round(into.h)) : Math.max(MAP_MIN, Math.round(bh * fit + PAD * 2));
  const scale = Math.min((w - PAD * 2) / bw, (h - PAD * 2) / bh);
  const ox = (w - bw * scale) / 2 - bounds.x * scale;
  const oy = (h - bh * scale) / 2 - bounds.y * scale;
  return {
    w, h, scale,
    toMap: (b) => ({ x: b.x * scale + ox, y: b.y * scale + oy, w: b.w * scale, h: b.h * scale }),
    toWorld: (x, y) => ({ x: (x - ox) / scale, y: (y - oy) / scale }),
  };
}

/** The part of the world the camera shows, in world units. */
export function seenBox(cam: Cam, view: Size): Box {
  return { x: -cam.x / cam.k, y: -cam.y / cam.k, w: view.w / cam.k, h: view.h / cam.k };
}

/** The camera at the same zoom with a world point in the middle of the view. */
export function camCenteredOn(cam: Cam, view: Size, p: { x: number; y: number }): Cam {
  return { k: cam.k, x: view.w / 2 - p.x * cam.k, y: view.h / 2 - p.y * cam.k };
}
