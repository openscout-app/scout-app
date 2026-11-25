import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIPPED_VIEWS } from "../../screens/views/views-model.ts";
import { CASE_COLS, caseByKey, DISPATCH_DEFAULT, DISPATCH_MINS, HUD_GRID_CASES, moved, overlaps, PROJECTS_MINS, runCase } from "./hud-grid-cases.ts";
import { reconcile } from "./hud-grid-layout.ts";

const run = (key: string) => runCase(caseByKey(key));

/** Every frame drops as its preview. */
function dropsAsShown(r: ReturnType<typeof runCase>) {
  for (const s of r.steps) for (const f of s.frames) expect({ frame: [f.dx, f.dy], same: f.matches }).toEqual({ frame: [f.dx, f.dy], same: true });
}

/** A swap case, as a plain drag (`alt` false) or with ⌥ held: only the two panels moved, the last frame swapped them, and every frame drops as its preview. */
function swapOnly(key: string, a: string, b: string, alt: boolean) {
  const r = runCase(caseByKey(key), CASE_COLS, alt);
  expect(r.miss).toBeNull();
  expect(moved(r.case.base, r.end).sort()).toEqual([a, b].sort());
  const last = r.steps[r.steps.length - 1]!.frames;
  expect(last[last.length - 1]!.swap).toBe(b);
  dropsAsShown(r);
}

/** A swap case as a plain drag, for an undeclared pair: no frame trades, and every frame drops as its preview. */
function noTradeWithoutOption(key: string) {
  const r = runCase(caseByKey(key), CASE_COLS, false);
  for (const s of r.steps) for (const f of s.frames) expect({ frame: [f.dx, f.dy], swap: f.swap }).toEqual({ frame: [f.dx, f.dy], swap: null });
  dropsAsShown(r);
}

describe("gesture cases: every frame", () => {
  test("no frame overlaps panels or leaves the grid", () => {
    for (const c of HUD_GRID_CASES) {
      for (const s of runCase(c).steps) {
        for (const f of s.frames) {
          for (const l of [f.preview, f.drop]) {
            expect(overlaps(l)).toBe(false);
            expect(l.every((i) => i.x >= 0 && i.x + i.w <= CASE_COLS && i.y >= 0)).toBe(true);
          }
        }
      }
    }
  });

  test("what a drop saves is what draws next: reconcile leaves it as it is", () => {
    for (const c of HUD_GRID_CASES) {
      for (const s of runCase(c).steps) {
        for (const f of s.frames) {
          const ids = f.drop.map((i) => i.id);
          expect(reconcile(f.drop, c.base, ids, CASE_COLS)).toEqual(f.drop);
        }
      }
    }
  });

  test("a drop equals its last preview", () => {
    for (const c of HUD_GRID_CASES) {
      for (const s of runCase(c).steps) {
        for (const f of s.frames) expect({ case: c.key, id: s.id, frame: [f.dx, f.dy], drop: f.drop }).toEqual({ case: c.key, id: s.id, frame: [f.dx, f.dy], drop: f.preview });
      }
    }
  });
});

describe("gesture cases: resizing keeps panes whole", () => {
  test("widening Sessions moves the edge for its whole pane; Session and PRs give up the same columns", () => {
    expect(run("wider").miss).toBeNull();
  });

  test("making Sessions shorter gives its rows to Worktrees; neither pane's bottom moves", () => {
    expect(run("shorter").miss).toBeNull();
  });

  test("a seam inside a pane trades rows between its two panels; the other pane stays", () => {
    expect(run("pane-trade").miss).toBeNull();
  });

  test("the shared edge stops at the neighbouring pane's minimum", () => {
    expect(run("pane-min").miss).toBeNull();
  });

  test("a pane nobody declared is read off the default layout", () => {
    expect(run("pane-inferred").miss).toBeNull();
  });

  test("the last panel in a pane changes the pane's height and nothing else", () => {
    expect(run("pane-last").miss).toBeNull();
  });

  test("a resize drops where its preview showed", () => {
    for (const c of HUD_GRID_CASES) {
      if (c.steps.some((s) => s.mode === "move")) continue;
      for (const s of runCase(c).steps) for (const f of s.frames) expect({ case: c.key, ok: f.matches }).toEqual({ case: c.key, ok: true });
    }
  });
});

describe("gesture cases: the fixtures come from the pages", () => {
  // The Projects and Dispatch gesture fixtures preserve the layouts their drag
  // cases exercise; Dispatch itself is platform-only and omitted from scout-app.

  test("the minimums are the modules' own", () => {
    const minOf = (file: string) => {
      const m = readFileSync(join(import.meta.dir, "../../screens/views/modules", file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
      if (!m) throw new Error(`no minSize in ${file}`);
      return { w: Number(m[1]), h: Number(m[2]) };
    };
    expect(PROJECTS_MINS).toEqual({
      Project: minOf("project.tsx"),
      Sessions: minOf("project-sessions.tsx"),
      Session: minOf("session.tsx"),
      Worktrees: minOf("worktrees.tsx"),
      PRs: minOf("prs.tsx"),
    });
    expect(DISPATCH_MINS["In flight"]).toEqual(minOf("asks.tsx"));
  });
});

describe("gesture cases: moving", () => {
  test("dragging Sessions up its column puts it above PRs; Session and Worktrees stay (a declared pair: no ⌥ needed)", () => {
    swapOnly("swap-column", "Sessions", "PRs", false);
    swapOnly("swap-column", "Sessions", "PRs", true);
  });

  test("a downward drag sticks on drop: the Sessions and Session row goes below Worktrees and PRs", () => {
    expect(run("row-down").miss).toBeNull();
  });

  test("a downward drag sticks on drop: Project moves below the row it passes, which stays together", () => {
    expect(run("header-down").miss).toBeNull();
  });

  test("a downward drag sticks on drop: PRs dragged to the bottom ends up last", () => {
    expect(run("to-bottom").miss).toBeNull();
  });

  test("with ⌥ held, dragging Sessions sideways in its row trades it with Session; the rows below don't move", () => {
    expect(run("swap-row").miss).toBeNull();
    swapOnly("swap-row", "Sessions", "Session", true);
  });

  test("without ⌥, dragging Sessions onto Session trades nothing: placement as on main, and the drop is the preview", () => {
    noTradeWithoutOption("swap-row");
  });

  test("dragging Sessions onto a full-width PRs trades their cells; Session stays put (a declared pair: no ⌥ needed)", () => {
    swapOnly("swap-past-wide", "Sessions", "PRs", false);
    swapOnly("swap-past-wide", "Sessions", "PRs", true);
  });

  test("dropping Sessions onto PRs trades their cells and moves nothing else (a declared pair: no ⌥ needed)", () => {
    swapOnly("swap-widths", "Sessions", "PRs", false);
    swapOnly("swap-widths", "Sessions", "PRs", true);
  });

  test("with ⌥ held, dragging Worktrees onto Sessions in their pane trades their order; the pane keeps its shape", () => {
    expect(run("swap-in-pane").miss).toBeNull();
    swapOnly("swap-in-pane", "Worktrees", "Sessions", true);
  });

  test("without ⌥, dragging Worktrees onto Sessions trades nothing, and the drop is the preview", () => {
    noTradeWithoutOption("swap-in-pane");
  });

});

describe("gesture cases: ⇧ moves a pane as one", () => {
  /** A ⇧ case: it meets its goal, only `members` (both columns) moved, the last frame traded sides with `partner`, and every frame drops as its preview. */
  function paneTrades(key: string, members: readonly string[], partner: string) {
    const r = run(key);
    expect(r.miss).toBeNull();
    expect(moved(r.case.base, r.end).sort()).toEqual([...members].sort());
    const last = r.steps[r.steps.length - 1]!.frames;
    expect(last[last.length - 1]!.pane).toBe(partner);
    dropsAsShown(r);
  }

  // column-over was a todo: moving the column one panel at a time reversed it, dropped Session to row 38 and emptied the left side
  test("with ⇧, dragging Sessions moves its pane past Session in one piece: the column keeps its order, nothing else moves", () => {
    paneTrades("column-over", ["Sessions", "Worktrees", "Session"], "Session");
  });

  test("without ⇧, the same drag moves Sessions alone and the column comes apart, as before", () => {
    const r = runCase(caseByKey("column-over"), CASE_COLS, false, false);
    expect(r.miss).not.toBeNull();
    dropsAsShown(r);
  });

  test("on Projects, ⇧ dragging Sessions onto the other pane trades the panes: 5 | 7 becomes 7 | 5, Project stays", () => {
    paneTrades("pane-sides", ["Sessions", "Worktrees", "Session", "PRs"], "Session");
  });

  test("panes of different heights trade sides and keep their heights", () => {
    paneTrades("pane-heights", ["Sessions", "Worktrees", "Session", "PRs"], "Session");
  });

  test("a pane dragged into empty columns is placed as one, and the drop is the preview", () => {
    const r = run("pane-empty");
    expect(r.miss).toBeNull();
    expect(moved(r.case.base, r.end).sort()).toEqual(["Sessions", "Worktrees"]);
    expect(r.steps[0]!.frames.every((f) => f.pane === null)).toBe(true);
    dropsAsShown(r);
  });

  test("letting go of ⇧ mid-drag goes back to moving the panel alone, exactly as a plain drag there", () => {
    const r = run("pane-release");
    expect(r.miss).toBeNull();
    const [, traded, released] = r.steps[0]!.frames;
    expect(traded!.pane).toBe("Session");
    expect(released!.pane).toBeUndefined();
    dropsAsShown(r);
  });

  test("⇧ on a panel in no pane is a plain drag: every frame is the plain drag's", () => {
    const shifted = run("shift-no-pane");
    const plain = runCase(caseByKey("shift-no-pane"), CASE_COLS, false, false);
    expect(shifted.miss).toBeNull();
    expect(shifted.steps[0]!.frames.map((f) => f.drop)).toEqual(plain.steps[0]!.frames.map((f) => f.drop));
    expect(shifted.steps[0]!.frames.every((f) => f.pane === undefined)).toBe(true);
  });
});
