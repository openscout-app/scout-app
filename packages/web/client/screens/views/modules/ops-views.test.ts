import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridLayout, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import type { Route } from "../../../lib/types.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, SHIPPED_VIEWS, type ViewComposition } from "../views-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * Ops › In flight (mode advisor), Runtime and Agents on every grid they can draw on: the
 * page's main panel leads on the left, its rails stack beside it from the
 * top. Minimums are read from the module files as text, as registry.test.ts
 * does, so a change to any module's minSize is held to this.
 *
 * Skipped until the compositions ship (views-model.ts SHIPPED_VIEWS gains
 * "ops-advisor", "ops-runtime" and "ops-agents"; composed-routes.ts claims
 * modes advisor, atop and agents).
 */

const FILES: Record<string, string> = {
  "worktrees-in-flight": "in-flight.tsx",
  "stale": "stale.tsx",
  "plan": "plan-document.tsx",
  "runtime-summary": "runtime-summary.tsx",
  "harness-families": "harness-families.tsx",
  "runtime-table": "runtime-table.tsx",
  "agents-directory": "agents-directory.tsx",
  "agents-roster": "agents-roster.tsx",
  // the Ops inspector and the Ops rail's Requests · Active, as Ops › Control ships them
  "ops-summary": "ops-summary.tsx",
  "ops-queue": "ops-queue.tsx",
};

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const shipped = (id: string) => SHIPPED_VIEWS.find((v) => v.id === id);
// a skipped describe still runs its body: an empty stand-in keeps it from throwing
const blank = (id: string): ViewComposition => ({ id, label: "", intent: "", instances: [], layout: [] });
const advisor = shipped("ops-advisor");
const runtime = shipped("ops-runtime");
const agents = shipped("ops-agents");

/** Every width: mins hold, nothing overlaps, the lead sits top-left, the side column runs to the right edge. */
function holdsOnEveryGrid(v: ViewComposition, leadType: string, sideTypes: readonly string[]) {
  const ids = v.instances.map((i) => i.id);
  const mins: GridMins = Object.fromEntries(v.instances.map((i) => [i.id, minOf(FILES[i.type]!)]));
  const defaults = defaultsFor(v, v.instances, () => ({ w: 6, h: 8 }));
  const lead = v.instances.find((i) => i.type === leadType)!;
  const side = new Set(v.instances.filter((i) => sideTypes.includes(i.type)).map((i) => i.id));
  const cell = (l: GridLayout, id: string) => l.find((i) => i.id === id)!;

  // 760 and 1099 are the 8-column grid's ends; 1100 and up is 12
  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px every panel keeps its minimum and its column`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, ids, cols, mins);
      expect(l.map((i) => i.id).sort()).toEqual([...ids].sort());
      for (const item of l) {
        expect(item.w, item.id).toBeGreaterThanOrEqual(mins[item.id]!.w);
        expect(item.h, item.id).toBeGreaterThanOrEqual(mins[item.id]!.h);
      }
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
      const main = cell(l, lead.id);
      expect(main.x).toBe(0);
      for (const item of l.filter((i) => side.has(i.id))) {
        expect(item.x, item.id).toBe(main.w);
        expect(item.x + item.w, item.id).toBe(cols);
      }
      for (const item of l.filter((i) => !side.has(i.id) && i.w < cols)) expect(item.w, item.id).toBe(main.w);
    });
  }
}

const ops = (mode: string, extra: Partial<Extract<Route, { view: "ops" }>> = {}) => ({ view: "ops", mode, ...extra }) as Route;

describe.skipIf(!advisor)("the Worktrees view", () => {
  const v = advisor ?? blank("ops-advisor");

  test("is In flight and Stale, and the plan an agent lane opens", () => {
    expect(v.label).toBe("Worktrees");
    expect(v.host).toEqual({ view: "ops", mode: "advisor" });
    expect(v.quickTerminal).toBe(false);
    expect(v.instances.map((i) => i.type)).toEqual(["worktrees-in-flight", "stale", "plan"]);
    // ?plan= is the page's selection
    expect(v.instances.find((i) => i.type === "plan")?.config).toEqual({ plan: FOLLOW_PAGE });
  });

  test("Budgets and Subsystems are not on it any more", () => {
    expect(v.instances.some((i) => i.type === "host-reading" || i.type === "host-readouts")).toBe(false);
  });

  test("draws on /ops/advisor with or without ?plan=", () => {
    expect(composedViewFor(ops("advisor"))).toBe("ops-advisor");
    expect(composedViewFor(ops("advisor", { planDocumentId: "plan-1" }))).toBe("ops-advisor");
  });

  test("In flight is the wider panel, Stale beside it at the top", () => {
    const ids = v.instances.map((i) => i.id);
    const mins: GridMins = Object.fromEntries(v.instances.map((i) => [i.id, minOf(FILES[i.type]!)]));
    const defaults = defaultsFor(v, v.instances, () => ({ w: 6, h: 8 }));
    const l = reconcile(null, defaults, ids, gridColumnsFor(1600)!, mins);
    const inFlight = l.find((i) => i.id === "advisor-in-flight")!;
    const stale = l.find((i) => i.id === "advisor-stale")!;
    expect(inFlight).toMatchObject({ x: 0, y: 0 });
    expect(stale).toMatchObject({ x: inFlight.w, y: 0 });
    expect(inFlight.w).toBeGreaterThan(stale.w);
  });

  describe("on every grid", () => holdsOnEveryGrid(v, "worktrees-in-flight", ["stale", "plan"]));
});

describe.skipIf(!runtime)("the Runtime view", () => {
  const v = runtime ?? blank("ops-runtime");

  test("is the summary, harness families and the table, beside the Ops inspector and Requests · Active", () => {
    expect(v.host).toEqual({ view: "ops", mode: "atop" });
    expect(v.quickTerminal).toBe(false);
    expect(v.instances.map((i) => i.type)).toEqual(["runtime-summary", "harness-families", "runtime-table", "ops-summary", "ops-queue"]);
  });

  test("draws on /ops/atop", () => {
    expect(composedViewFor(ops("atop"))).toBe("ops-runtime");
  });

  describe("on every grid", () => holdsOnEveryGrid(v, "runtime-table", ["ops-summary", "ops-queue"]));
});

describe.skipIf(!agents)("the Agents view", () => {
  const v = agents ?? blank("ops-agents");

  test("is the directory, beside the Ops inspector and the roster", () => {
    expect(v.host).toEqual({ view: "ops", mode: "agents" });
    expect(v.quickTerminal).toBe(false);
    expect(v.instances.map((i) => i.type)).toEqual(["agents-directory", "ops-summary", "agents-roster"]);
  });

  test("draws on /ops/agents", () => {
    expect(composedViewFor(ops("agents"))).toBe("ops-agents");
  });

  describe("on every grid", () => holdsOnEveryGrid(v, "agents-directory", ["ops-summary", "agents-roster"]));
});

describe("the Ops routes these three never take", () => {
  const mine = new Set(["ops-advisor", "ops-runtime", "ops-agents"]);
  for (const mode of ["mission", "tail", "issues", "lanes", "world", "week"]) {
    test(`/ops/${mode}`, () => {
      expect(mine.has(composedViewFor(ops(mode)) ?? "")).toBe(false);
    });
  }
  test("bare /ops (Mission Control)", () => {
    expect(mine.has(composedViewFor({ view: "ops" } as Route) ?? "")).toBe(false);
  });
});
