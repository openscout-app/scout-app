import type { Route } from "../../../lib/types.ts";

/*
 * The World panels, pure: where the HUD's two side columns draw, how its frame
 * reads with one or both of them out, which keys the HUD leaves to the grid,
 * and how a source or dataset pick lands (the page's URL on Ops › World, the
 * panel's settings anywhere else). world-dock.ts does the DOM; this decides.
 */

export type WorldSide = "left" | "right";
export const WORLD_SIDES: readonly WorldSide[] = ["left", "right"];

/** "out": in its own panel beside the World. "in": back in the HUD's frame, where the page draws it. */
export type ColumnPlace = "out" | "in";
export type WorldPlacement = Readonly<Record<WorldSide, ColumnPlace>>;

/**
 * A column draws in its own panel while one is on the view, unless the World
 * panel is in full view: then the HUD draws whole, as the page always did.
 * With no panel for a side, that column stays in the frame, so removing a
 * column panel never loses what it showed.
 */
export function placeColumns(o: { full: boolean; columns: Readonly<Record<WorldSide, boolean>> }): WorldPlacement {
  const place = (side: WorldSide): ColumnPlace => (o.columns[side] && !o.full ? "out" : "in");
  return { left: place("left"), right: place("right") };
}

export type FrameLook = {
  /** both columns out: the engine's single-column frame (`.frame.slotted`) */
  slotted: boolean;
  /** only the left column out: the frame keeps the right one where it was */
  outLeft: boolean;
  /** only the right column out */
  outRight: boolean;
  /**
   * The HUD's own breakpoints (container `wweek`) apply while a column is in
   * the frame. With both out they would lay out columns that are not there.
   */
  container: boolean;
};

export function frameLook(p: WorldPlacement): FrameLook {
  const left = p.left === "out";
  const right = p.right === "out";
  return { slotted: left && right, outLeft: left && !right, outRight: right && !left, container: !(left && right) };
}

/** The World modules: keys typed with focus in any of them are the HUD's. */
export const WORLD_MODULE_TYPES = ["world-stage", "world-readouts", "world-details"] as const;
const WORLD_MODULES = new Set<string>(WORLD_MODULE_TYPES);
export const isWorldModule = (type: string | null | undefined): boolean => !!type && WORLD_MODULES.has(type);

/** The module type a grid panel draws, from its class (`vw-panel vw-panel--<type>`, CompositionHost). */
export function panelModuleType(className: string): string | null {
  return className.match(/(?:^|\s)vw-panel--([\w-]+)/)?.[1] ?? null;
}

/** What the HUD's window key handler needs to know about one key press. */
export type KeyFacts = {
  key: string;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
  /** drawn on Ops › World, where the HUD keeps its page-wide keys */
  ownRoute: boolean;
  /** the module type of the grid panel holding focus; null when focus is in no panel */
  focusModule: string | null;
  /** focus is inside the HUD's own markup (the stage, or a column in its panel) */
  inWorld: boolean;
  /** focus is inside the composition (its bar, a panel's head or body) */
  inView: boolean;
  /** focus is on a control: a button, link, select or anything with a button-like role */
  onControl: boolean;
  onSeparator?: boolean;
  /** the key landed on a grid panel itself (its frame has focus), not on something inside it */
  onPanelFrame: boolean;
};

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** The keys a focused grid panel answers itself (HudGrid): esc, f, e, ⇧ or ⌥ with an arrow, and Tab to move on. */
export function isGridPanelKey(f: Pick<KeyFacts, "key" | "shift" | "alt" | "meta" | "ctrl">): boolean {
  if (f.key === "Escape" || f.key === "Tab") return true;
  const plain = !f.meta && !f.ctrl && !f.alt && !f.shift;
  if (plain && (f.key === "f" || f.key === "e")) return true;
  return (f.shift || f.alt) && ARROWS.has(f.key);
}

/**
 * True when the HUD leaves a key alone (engine.ts › keyGate). On Ops › World
 * the HUD keeps its page-wide keys, except where focus is somewhere else on the
 * view: another panel, a panel's own frame (its esc, f, e and arrows), or a
 * control in the view's chrome (Enter and Space press it, Tab moves on). Off
 * its own route it reads keys only with focus inside a World panel.
 */
export function worldYieldsKey(f: KeyFacts): boolean {
  // Dock resize handles own their keyboard interactions, even outside a module panel.
  if (f.onSeparator) return true;
  if (f.focusModule && !isWorldModule(f.focusModule)) return true;
  if (f.onPanelFrame && isGridPanelKey(f)) return true;
  if (f.inView && !f.inWorld && f.onControl && (f.key === "Enter" || f.key === " " || f.key === "Tab")) return true;
  if (!f.ownRoute && !isWorldModule(f.focusModule)) return true;
  return false;
}

export type WorldSource = "week" | "live" | "otlp";
const SOURCES = new Set<string>(["week", "live", "otlp"]);

export const isWorldRoute = (route: Route): boolean => route.view === "ops" && route.mode === "week";

/** On Ops › World the page's ?source= (absent: the week); elsewhere the panel's own. */
export function worldSource(route: Route, config: Readonly<Record<string, string>>): WorldSource {
  if (route.view === "ops" && route.mode === "week") return route.source ?? "week";
  const own = config.source;
  return own && SOURCES.has(own) ? (own as WorldSource) : "week";
}

/** The team dataset: ?data=team on Ops › World, the panel's own `data` setting elsewhere. */
export function worldTeam(route: Route, config: Readonly<Record<string, string>>): boolean {
  if (route.view === "ops" && route.mode === "week") return route.dataset === "team";
  return config.data === "team";
}

/** A pick on the World panel: on its own route a move of the page, elsewhere a change to its settings. */
export type WorldPick =
  | { kind: "page"; route: Route; replace: boolean }
  | { kind: "config"; patch: Record<string, string> };

/** WEEK · LIVE · OTLP: in place on the page (replace, as the screen did), in the settings elsewhere. */
export function sourcePick(route: Route, next: WorldSource): WorldPick {
  if (route.view === "ops" && route.mode === "week") {
    return { kind: "page", route: { ...route, source: next === "week" ? undefined : next }, replace: true };
  }
  return { kind: "config", patch: { source: next === "week" ? "" : next } };
}

/** DATA · WEEK | TEAM: a new page on Ops › World (the screen reloaded with ?data= flipped), the settings elsewhere. */
export function teamPick(route: Route, team: boolean): WorldPick {
  if (route.view === "ops" && route.mode === "week") {
    return { kind: "page", route: { ...route, dataset: team ? "team" : undefined }, replace: false };
  }
  return { kind: "config", patch: { data: team ? "team" : "" } };
}

/** What a column panel says while its column is not in it. Null: the column is there. */
export function columnNote(o: { stage: boolean; ready: boolean; place: ColumnPlace; side: WorldSide }): string | null {
  const name = o.side === "left" ? "readouts" : "details";
  if (!o.stage) return `The World's ${name} draw here beside a World panel. Add World to this view.`;
  if (o.place === "in") return `The World panel is in full view, with its ${name} in it.`;
  if (!o.ready) return "Waiting for the World panel.";
  return null;
}
