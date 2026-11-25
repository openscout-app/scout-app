import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridLayout, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import { defaultsFor, SHIPPED_VIEWS, type ViewComposition } from "../views-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { TERMINAL_SCOPE_KEY } from "./terminal-page-model.ts";

/*
 * The Terminal view, on every terminal deep link: the index on the left with
 * the terminal's details under it (the old rail and inspector), the terminal
 * itself beside them from the top. Minimums are read from the module files as
 * text, as terminal-workspace.test.ts does.
 *
 * PROPOSED is the composition this view adds to views-model.ts SHIPPED_VIEWS.
 * Until it ships the layout is checked on it; once it ships, the shipped one
 * is held to it and checked instead.
 */

const PROPOSED: ViewComposition = {
  id: "terminal",
  label: "Terminal",
  intent: "One terminal, open: observe it or take it over, with the index and its details beside it",
  // drawn on every terminal deep link (composed-routes.ts); bare /terminal stays Terminals
  quickTerminal: false,
  // @route: the session and its details follow the page's terminal and mode.
  // Stacked (narrow window) panels follow this order: the terminal leads.
  instances: [
    { id: "terminal-session", type: "terminal-session", config: { terminal: "@route" } },
    { id: "terminal-index", type: "terminal-index" },
    { id: "terminal-details", type: "terminal-details", config: { terminal: "@route" } },
  ],
  layout: [
    { id: "terminal-index", x: 0, y: 0, w: 3, h: 14 },
    { id: "terminal-details", x: 0, y: 14, w: 3, h: 10 },
    { id: "terminal-session", x: 3, y: 0, w: 9, h: 24 },
  ],
};

const shipped = SHIPPED_VIEWS.find((v) => v.id === "terminal");
const view = shipped ?? PROPOSED;

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const ids = view.instances.map((i) => i.id);
const mins: GridMins = {
  "terminal-index": minOf("terminal-index.tsx"),
  "terminal-details": minOf("terminal-details.tsx"),
  "terminal-session": minOf("terminal-session.tsx"),
};
const defaults = defaultsFor(view, view.instances, () => ({ w: 6, h: 8 }));
const cell = (l: GridLayout, id: string) => l.find((i) => i.id === id)!;

describe("the Terminal view", () => {
  test.skipIf(!shipped)("ships as proposed here", () => {
    expect(shipped).toEqual(PROPOSED);
  });

  test("its terminal and details follow the page; the index reads the page as the rail did", () => {
    const config = (id: string) => view.instances.find((i) => i.id === id)?.config;
    expect(config("terminal-session")).toEqual({ [TERMINAL_SCOPE_KEY]: FOLLOW_PAGE });
    expect(config("terminal-details")).toEqual({ [TERMINAL_SCOPE_KEY]: FOLLOW_PAGE });
    expect(config("terminal-index")).toBeUndefined();
  });

  test("it has no route of its own: /terminal stays the Terminals view's", () => {
    expect(view.host).toBeUndefined();
    expect(SHIPPED_VIEWS.find((v) => v.id === "terminals")?.host).toEqual({ view: "terminal" });
    expect(view.quickTerminal).toBe(false);
  });

  test("the left column and the terminal share an 8-column row", () => {
    expect(Math.max(mins["terminal-index"].w, mins["terminal-details"].w) + mins["terminal-session"].w).toBeLessThanOrEqual(8);
  });

  // below 720px panels stack in instance order: the terminal first
  test("stacked, the terminal comes first", () => {
    expect(gridColumnsFor(719)).toBeNull();
    expect(view.instances[0]?.type).toBe("terminal-session");
  });

  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the terminal sits beside the index and its details, from the top`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, ids, cols, mins);
      const index = cell(l, "terminal-index");
      const details = cell(l, "terminal-details");
      const session = cell(l, "terminal-session");
      expect(index).toMatchObject({ x: 0, y: 0 });
      expect(details).toMatchObject({ x: 0, y: index.y + index.h });
      expect(session.y).toBe(0);
      expect(session.x).toBe(Math.max(index.x + index.w, details.x + details.w));
      expect(session.x + session.w).toBe(cols);
      expect(session.h).toBe(index.h + details.h);
      expect(session.w).toBeGreaterThan(index.w);
      for (const id of ids) {
        expect(cell(l, id).w).toBeGreaterThanOrEqual(mins[id]!.w);
        expect(cell(l, id).h).toBeGreaterThanOrEqual(mins[id]!.h);
      }
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
    });
  }
});
