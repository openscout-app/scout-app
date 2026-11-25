import type { Route } from "../../../lib/types.ts";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import type { MissionLog } from "../../ops/mission-wall.ts";
import type { MissionDockState } from "./mission-dock.ts";

/**
 * The Mission panels' page rules: which routes are the wall's own, and how the
 * wall's cursor lives in the URL there (`/ops/control?sessionId=…`).
 */

/** Ops › Control: /ops/control, and bare /ops, which opens on it. */
export function isMissionRoute(route: Route): boolean {
  return route.view === "ops" && (route.mode ?? "mission") === "mission";
}

/** The session the page's URL puts the wall's cursor on, if any. */
export function routeCursor(route: Route): string | null {
  if (route.view !== "ops" || !isMissionRoute(route)) return null;
  return route.sessionId?.trim() || null;
}

/** Ops › Control with the cursor on one session, or on none. */
export function cursorRoute(sessionId: string | null): Route {
  const id = sessionId?.trim();
  return id ? { view: "ops", mode: "mission", sessionId: id } : { view: "ops", mode: "mission" };
}

/**
 * Whether the router keeps the cursor in the URL; pass it `routePath`. Until
 * it writes `sessionId` on /ops/control (today it drops it and canonicalizes
 * it away), the wall holds its cursor itself, as it always has: writing the
 * cursor to a URL that strips it would lose every move.
 */
export function urlHoldsCursor(path: (route: Route) => string): boolean {
  return path(cursorRoute("probe")).includes("sessionId=probe");
}

export type MissionContextState =
  /** No Mission wall on this view: nothing produces a cursor to read. */
  | { kind: "no-wall" }
  /** A wall, with its cursor on nothing yet. */
  | { kind: "no-cursor" }
  /** The cursor names a session the wall has no log for (a deep link before it writes). */
  | { kind: "off-wall"; sessionId: string }
  | { kind: "ready"; log: MissionLog; lane: AgentLane };

/** What the Session context panel draws from the dock. */
export function missionContextState(dock: MissionDockState): MissionContextState {
  if (dock.walls === 0) return { kind: "no-wall" };
  const context = dock.context;
  if (!context?.cursorId) return { kind: "no-cursor" };
  if (!context.log || !context.lane) return { kind: "off-wall", sessionId: context.cursorId };
  return { kind: "ready", log: context.log, lane: context.lane };
}
