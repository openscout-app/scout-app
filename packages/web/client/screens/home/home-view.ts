import type { GridLayout } from "../../components/hud-grid/hud-grid-layout.ts";
import type { Route } from "../../lib/types.ts";
import type { ModuleConfig } from "../views/modules/contract.ts";
import { FOLLOW_PAGE, scopeValue } from "../views/modules/follow-page.ts";
import type { ViewModuleInstance } from "../views/views-model.ts";

/*
 * Home's old grid as a composition (views-model.ts › SHIPPED_VIEWS "home",
 * drawn on Ops › Cockpit since / became the front page): the Home grid's panels as modules, the cockpit band as a panel of
 * its own, and the rail (recent agents and coordination) as Recent. Home's
 * inspector (right.tsx) never showed on the web (inspector-visibility.ts
 * gives inbox none), so nothing stands in for it; Agents is one Add away.
 * Pure, so the layout and the move from the old grid test on their own
 * (home-view.test.ts).
 */

/** Home's Machine scope key: the page's ?machineId= when a panel follows the page. */
export const HOME_MACHINE_KEY = "machine";

/**
 * In stacked (narrow window) order: the cockpit, quotas and velocity, what's
 * moving, coordination, the tail, the composer, then the rail's Recent.
 */
export const HOME_VIEW_INSTANCES: ViewModuleInstance[] = [
  { id: "home-cockpit", type: "home-cockpit" },
  { id: "home-quotas", type: "home-quotas" },
  { id: "home-velocity", type: "home-velocity" },
  { id: "home-moving", type: "home-moving", config: { [HOME_MACHINE_KEY]: FOLLOW_PAGE } },
  { id: "home-coord", type: "home-coord", config: { [HOME_MACHINE_KEY]: FOLLOW_PAGE } },
  // the tail's own filter, every session, in Home's compact rows
  { id: "home-tail", type: "tail", config: { density: "compact" } },
  { id: "home-message", type: "home-message", config: { [HOME_MACHINE_KEY]: FOLLOW_PAGE } },
  { id: "home-recent", type: "home-recent" },
];

/**
 * The Home grid (home-grid.ts › HOME_GRID_DEFAULT) three rows down, under the
 * cockpit that used to sit above it as a band. Recent, the old rail, under
 * coordination; the composer beside it, under the tail, both ending on one line.
 */
export const HOME_VIEW_LAYOUT: GridLayout = [
  { id: "home-cockpit", x: 0, y: 0, w: 12, h: 3 },
  { id: "home-quotas", x: 0, y: 3, w: 8, h: 6 },
  { id: "home-velocity", x: 8, y: 3, w: 4, h: 6 },
  { id: "home-moving", x: 0, y: 9, w: 8, h: 10 },
  // the tail runs to the bottom of coordination so both columns end on one line
  { id: "home-tail", x: 8, y: 9, w: 4, h: 20 },
  { id: "home-coord", x: 0, y: 19, w: 8, h: 10 },
  { id: "home-recent", x: 0, y: 29, w: 8, h: 8 },
  { id: "home-message", x: 8, y: 29, w: 4, h: 8 },
];

/** Home's arrangements (home-grid.ts › HOME_GRID_ARRANGEMENTS), each with the cockpit on top and Recent placed. */
export const HOME_VIEW_ARRANGEMENTS: readonly { id: string; label: string; layout: GridLayout }[] = [
  { id: "desk", label: "Desk", layout: HOME_VIEW_LAYOUT },
  {
    id: "focus",
    label: "Focus",
    layout: [
      { id: "home-cockpit", x: 0, y: 0, w: 12, h: 3 },
      { id: "home-moving", x: 0, y: 3, w: 12, h: 12 },
      { id: "home-coord", x: 0, y: 15, w: 7, h: 10 },
      { id: "home-tail", x: 7, y: 15, w: 5, h: 10 },
      { id: "home-quotas", x: 0, y: 25, w: 8, h: 6 },
      { id: "home-velocity", x: 8, y: 25, w: 4, h: 6 },
      { id: "home-message", x: 0, y: 31, w: 12, h: 6 },
      { id: "home-recent", x: 0, y: 37, w: 12, h: 8 },
    ],
  },
  {
    id: "watch",
    label: "Watch",
    layout: [
      { id: "home-cockpit", x: 0, y: 0, w: 12, h: 3 },
      { id: "home-velocity", x: 0, y: 3, w: 4, h: 6 },
      { id: "home-quotas", x: 4, y: 3, w: 8, h: 6 },
      { id: "home-tail", x: 0, y: 9, w: 6, h: 20 },
      { id: "home-moving", x: 6, y: 9, w: 6, h: 10 },
      { id: "home-coord", x: 6, y: 19, w: 6, h: 10 },
      { id: "home-message", x: 0, y: 29, w: 6, h: 8 },
      { id: "home-recent", x: 6, y: 29, w: 6, h: 8 },
    ],
  },
];

/**
 * Where the Home grid saved the operator's arrangement (HudGrid surface
 * "home": openscout.grid.v1.home.12 and .8, with .restore), and which panel
 * became which instance. The composition takes that arrangement over the first
 * time it draws (modules/adopt-grid.ts). Basic web still draws the old grid
 * and keeps its save.
 */
export const HOME_GRID_ADOPTS = {
  surface: "home",
  ids: {
    quotas: "home-quotas",
    velocity: "home-velocity",
    moving: "home-moving",
    tail: "home-tail",
    coord: "home-coord",
    message: "home-message",
  },
} as const;

/** The machine a Home panel narrows to: the page's when it follows the page, else its own pick. null = every machine. */
export function homePanelMachine(route: Route, config: ModuleConfig): string | null {
  const page = "machineId" in route && typeof route.machineId === "string" ? route.machineId : undefined;
  return scopeValue(config[HOME_MACHINE_KEY], page).trim() || null;
}
