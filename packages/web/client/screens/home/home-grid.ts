import type { HudGridArrangement } from "../../components/hud-grid/HudGrid.tsx";
import type { GridLayout } from "../../components/hud-grid/hud-grid-layout.ts";

/**
 * Home on the HUD grid, authored at 12 columns (32px row pitch). Panels that
 * have nothing to show yet (quotas, velocity, message) drop out and the rest
 * pack up; they return to their cell when they come back.
 */
export const HOME_GRID_DEFAULT: GridLayout = [
  { id: "quotas", x: 0, y: 0, w: 8, h: 6 },
  { id: "velocity", x: 8, y: 0, w: 4, h: 6 },
  { id: "moving", x: 0, y: 6, w: 8, h: 10 },
  // Tail runs to the bottom of coordination so both columns end on one line.
  { id: "tail", x: 8, y: 6, w: 4, h: 20 },
  { id: "coord", x: 0, y: 16, w: 8, h: 10 },
  { id: "message", x: 8, y: 26, w: 4, h: 6 },
];

export const HOME_GRID_ARRANGEMENTS: readonly HudGridArrangement[] = [
  { id: "desk", label: "Desk", layout: HOME_GRID_DEFAULT },
  {
    id: "focus",
    label: "Focus",
    layout: [
      { id: "moving", x: 0, y: 0, w: 12, h: 12 },
      { id: "coord", x: 0, y: 12, w: 7, h: 10 },
      { id: "tail", x: 7, y: 12, w: 5, h: 10 },
      { id: "quotas", x: 0, y: 22, w: 8, h: 6 },
      { id: "velocity", x: 8, y: 22, w: 4, h: 6 },
      { id: "message", x: 0, y: 28, w: 12, h: 6 },
    ],
  },
  {
    id: "watch",
    label: "Watch",
    layout: [
      { id: "velocity", x: 0, y: 0, w: 4, h: 6 },
      { id: "quotas", x: 4, y: 0, w: 8, h: 6 },
      { id: "tail", x: 0, y: 6, w: 6, h: 20 },
      { id: "moving", x: 6, y: 6, w: 6, h: 10 },
      { id: "coord", x: 6, y: 16, w: 6, h: 10 },
      { id: "message", x: 0, y: 26, w: 6, h: 6 },
    ],
  },
];
