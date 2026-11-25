import type { ComponentType } from "react";
import type { Route } from "../../../lib/types.ts";
import type { ViewModuleSize } from "../views-model.ts";

/**
 * The module contract. A module is one self-contained panel body: it reads its
 * own data, draws the same on any view, and knows nothing about where it sits.
 * The view decides placement and size; the module decides content.
 *
 * Every module lives in its own file in this folder, opens with a doc block in
 * the shape below, and registers once in registry.ts. See README.md.
 *
 *   /**
 *    * <Title> — <one line on what it shows>.
 *    *
 *    * Shows:  what the operator sees, and in what order.
 *    * Data:   the hook or endpoint it reads, and how often.
 *    * Scope:  the settings an instance can carry (or "none").
 *    * Opens:  where a click goes (or "nothing").
 *    *\/
 */

export type ModuleConfig = Readonly<Record<string, string>>;

export type ModuleProps = {
  /** This instance's id in the view: stable across reloads, unique per panel. */
  instanceId: string;
  /**
   * The route the view is drawn on. Read it, never write it: a module that
   * follows the host's selection (a session, a project) reads it from here,
   * and goes elsewhere only through `navigate`, on a click.
   */
  route: Route;
  /** `replace` rewrites the current entry: typing and toggles on the module's own route. */
  navigate: (route: Route, options?: { replace?: boolean }) => void;
  /** This instance's settings. Empty means the module's defaults. */
  config: ModuleConfig;
  /** Merge settings into this instance. An empty string clears a key. */
  setConfig: (patch: Record<string, string>) => void;
};

export type ModuleScopeOption = { value: string; label: string };

/**
 * One setting the panel header offers as a picker, e.g. Agents › Project.
 * `useOptions` is a hook: it runs inside the picker, so it can read live data.
 * The empty value always means "all" and is added by the picker.
 */
export type ModuleScope = {
  key: string;
  /** Shown in the picker when nothing is chosen: "All projects". */
  allLabel: string;
  useOptions: () => readonly ModuleScopeOption[];
  /**
   * Offered as a choice when set: "This page's project". Its value is
   * FOLLOW_PAGE ("@route"), and the module reads the page's own value from
   * `route` (follow-page.ts › scopeValue).
   */
  followsPage?: string;
};

/**
 * One on/off setting of a panel, offered in the view's Layout menu (beside
 * Edit modules and Lock), e.g. the Fleet cockpit's Subscription gauges. Kept
 * in the instance's config as "on" or "off"; absent means `default`, so a
 * panel at its default is no change from the shipped view, and Reset brings
 * the default back.
 */
export type ModuleOption = {
  key: string;
  /** The menu item: "Subscription gauges". */
  label: string;
  /** The item's hover line. */
  title?: string;
  default: boolean;
};

/** Whether an option is on for this instance. */
export function moduleOptionOn(option: ModuleOption, config: ModuleConfig): boolean {
  const value = config[option.key];
  return value === "on" ? true : value === "off" ? false : option.default;
}

/** The config patch that turns an option on or off: back at the default, the key clears. */
export function moduleOptionPatch(option: ModuleOption, on: boolean): Record<string, string> {
  return { [option.key]: on === option.default ? "" : on ? "on" : "off" };
}

export type ModuleDocs = {
  /** What the operator sees. */
  shows: string;
  /** The hook or endpoint, and how often it reads. */
  data: string;
  /** Where a click goes. */
  opens?: string;
};

export type ViewModuleDef = {
  /** Stable id stored in saved views. Never rename one that has shipped. */
  type: string;
  title: string;
  /** One line for the module library. */
  blurb: string;
  docs: ModuleDocs;
  /** Default size on a 12-column grid, in columns × 24px rows. */
  size: ViewModuleSize;
  /** Smallest size it still draws correctly at. Resize, fit and reflow never go below it. */
  minSize: ViewModuleSize;
  scopes?: readonly ModuleScope[];
  /** On/off settings the view's Layout menu offers for each instance (ModuleOption). */
  options?: readonly ModuleOption[];
  /**
   * Config keys that are the instance's live state, not a choice: a terminal's
   * session id. Saved with the view so a reload reattaches, but never counted
   * as a change from the shipped view.
   */
  state?: readonly string[];
  /**
   * How many fit on one view, for a module that sits on something there is
   * one of (the terminal workspace deck). Absent = any number.
   */
  maxPerView?: number;
  /**
   * Height follows content (HudGridPanel › fit): the panel draws no taller
   * than what it holds, its cell is the most it grows to. For lists and
   * forms; a chart or terminal that fills its panel leaves it off.
   */
  fit?: boolean;
  /**
   * When the grid fills the window, this panel takes its column's spare
   * height (HudGridPanel › grow). Only for content that uses the room: a list
   * that shows more rows given more height. A panel without `fit` grows anyway.
   */
  grow?: boolean;
  Component: ComponentType<ModuleProps>;
};

/** Identity helper so each module file type-checks against the contract. */
export function defineModule(def: ViewModuleDef): ViewModuleDef {
  return def;
}
