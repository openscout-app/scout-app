import { describe, expect, test } from "bun:test";
import { panelFacts, panelToLift, TERMINAL_PANEL_TYPES, terminalPanelToLift, type PanelFacts } from "./terminal-full-view.ts";

/*
 * ⌘⇧B on a composed view lifts the terminal's panel to full view, or back.
 * The choice runs on plain facts; the DOM reading runs on a stand-in for the
 * few element calls it makes.
 */

const panel = (facts: Partial<PanelFacts> = {}): PanelFacts => ({ full: false, focused: false, live: false, terminal: false, ...facts });

describe("which panel ⌘⇧B lifts", () => {
  test("the terminal being typed into", () => {
    const index = panel();
    const one = panel({ terminal: true, live: true });
    const typing = panel({ terminal: true, live: true, focused: true });
    expect(panelToLift([index, one, typing])).toBe(2);
  });

  test("a terminal panel in full view goes back, wherever focus is", () => {
    expect(panelToLift([panel({ terminal: true, live: true, focused: true }), panel({ terminal: true, live: true, full: true })])).toBe(1);
  });

  test("with focus elsewhere: the first live terminal, then the first terminal module still picking", () => {
    expect(panelToLift([panel({ focused: true }), panel({ terminal: true }), panel({ terminal: true, live: true })])).toBe(2);
    expect(panelToLift([panel({ focused: true }), panel({ terminal: true }), panel({ terminal: true })])).toBe(1);
  });

  test("a panel focused but drawing no terminal is not the terminal", () => {
    expect(panelToLift([panel({ focused: true }), panel({ terminal: true, live: true })])).toBe(1);
  });

  test("any panel drawing a live terminal counts, whatever its module", () => {
    expect(panelToLift([panel(), panel({ live: true, focused: true })])).toBe(1);
  });

  test("a non-terminal panel in full view gives way to the terminal", () => {
    expect(panelToLift([panel({ full: true }), panel({ terminal: true, live: true })])).toBe(1);
  });

  test("no terminal on the view: nothing, and the shell leaves the key alone", () => {
    expect(panelToLift([panel(), panel({ focused: true }), panel({ full: true })])).toBe(-1);
    expect(panelToLift([])).toBe(-1);
  });
});

/** Just the element calls panelFacts makes. */
class FakePanel {
  constructor(
    readonly dataset: { panel: string },
    private readonly classes: string[],
    private readonly kids: { xterm?: boolean; holds?: unknown } = {},
  ) {}
  classList = { contains: (c: string) => this.classes.includes(c) };
  querySelector(sel: string) {
    return sel === ".xterm" && this.kids.xterm ? {} : null;
  }
  contains(node: unknown) {
    return node === this || (this.kids.holds !== undefined && node === this.kids.holds);
  }
}

describe("reading the grid", () => {
  const focusTarget = {};
  const index = new FakePanel({ panel: "terminal-index" }, ["hud-grid-panel", "vw-panel", "vw-panel--terminal-index"]);
  const session = new FakePanel({ panel: "terminal-session" }, ["hud-grid-panel", "vw-panel", "vw-panel--terminal-session"], { xterm: true, holds: focusTarget });
  const details = new FakePanel({ panel: "terminal-details" }, ["hud-grid-panel", "vw-panel", "vw-panel--terminal-details", "is-full"]);
  const root = { querySelectorAll: (sel: string) => (sel === ".hud-grid-panel[data-panel]" ? [index, session, details] : []) };

  test("a panel's facts come from the classes the grid and the view draw", () => {
    expect(panelFacts(session as unknown as Element, focusTarget as Element)).toEqual({ full: false, focused: true, live: true, terminal: true });
    expect(panelFacts(details as unknown as Element, null)).toEqual({ full: true, focused: false, live: false, terminal: false });
    expect(TERMINAL_PANEL_TYPES).toContain("terminal-session");
    expect(TERMINAL_PANEL_TYPES).toContain("terminal-workspace");
  });

  test("on the Terminal view it is the session panel, even with Details in full view", () => {
    expect(terminalPanelToLift(root as unknown as ParentNode, null)).toBe(session as unknown as HTMLElement);
  });

  test("a page with no grid lifts nothing", () => {
    expect(terminalPanelToLift({ querySelectorAll: () => [] } as unknown as ParentNode, null)).toBeNull();
  });
});
