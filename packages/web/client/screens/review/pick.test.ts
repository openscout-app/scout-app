import { describe, expect, test } from "bun:test";
import { numbered, openTab, type Tab } from "./pane.tsx";
import { isMenuClick, modsOf, NONE, pickClick, PLAIN, type Picks } from "./pick.ts";

const ADD = { add: true, range: false }, RANGE = { add: false, range: true }, BOTH = { add: true, range: true };
const ORDER = ["b:1", "b:2", "b:3", "b:4", "b:5"];
const one = (k: string): Picks => pickClick(NONE, k, PLAIN);

describe("Review picking", () => {
  test("Cmd on the Mac and Ctrl elsewhere add; Ctrl-click on the Mac is the right-click", () => {
    expect(modsOf({ metaKey: true, ctrlKey: false, shiftKey: false }, true)).toEqual({ add: true, range: false });
    expect(modsOf({ metaKey: false, ctrlKey: true, shiftKey: false }, true)).toEqual({ add: false, range: false });
    expect(modsOf({ metaKey: false, ctrlKey: true, shiftKey: true }, false)).toEqual({ add: true, range: true });
    expect(isMenuClick({ ctrlKey: true, button: 0 }, true)).toBe(true);
    expect(isMenuClick({ ctrlKey: true, button: 0 }, false)).toBe(false);
    expect(isMenuClick({ ctrlKey: false, button: 2 }, false)).toBe(true);
  });

  test("a click picks one; Cmd-click adds and drops", () => {
    expect(one("b:2")).toEqual({ keys: ["b:2"], at: "b:2", anchor: "b:2" });
    const two = pickClick(one("b:2"), "w:7", ADD);
    expect(two).toEqual({ keys: ["b:2", "w:7"], at: "w:7", anchor: "w:7" });
    expect(pickClick(two, "w:7", ADD)).toEqual({ keys: ["b:2"], at: "b:2", anchor: "b:2" });
    expect(pickClick(two, "b:4", PLAIN)).toEqual({ keys: ["b:4"], at: "b:4", anchor: "b:4" });
  });

  test("Shift-click runs from the anchor in a list, and runs again from the same anchor", () => {
    const run = pickClick(one("b:2"), "b:4", RANGE, ORDER);
    expect(run).toEqual({ keys: ["b:2", "b:3", "b:4"], at: "b:4", anchor: "b:2" });
    // up past the anchor: the new run replaces the old one
    expect(pickClick(run, "b:1", RANGE, ORDER).keys).toEqual(["b:1", "b:2"]);
    // Cmd-Shift keeps what was picked
    const kept = pickClick(pickClick(one("b:1"), "b:5", ADD), "b:3", BOTH, ORDER);
    expect(kept.keys).toEqual(["b:1", "b:5", "b:3", "b:4"]);
  });

  test("Shift-click with no list to run along (the Atlas) adds", () => {
    expect(pickClick(one("a:x"), "w:2", RANGE).keys).toEqual(["a:x", "w:2"]);
    expect(pickClick(one("a:x"), "b:3", RANGE, ORDER).keys).toEqual(["a:x", "b:3"]); // the anchor is not in this list
  });
});

describe("Review code pane", () => {
  const art = (key: string, pin: boolean, v: string | null = null): Tab => ({ type: "art", key, v, pin });
  test("a preview tab gives way to the next preview; a kept tab stays", () => {
    let r = openTab([], art("a", false));
    expect(r).toEqual({ tabs: [art("a", false)], at: 0 });
    r = openTab(r.tabs, art("b", false));
    expect(r).toEqual({ tabs: [art("b", false)], at: 0 });
    r = openTab(r.tabs, art("b", true));
    expect(r).toEqual({ tabs: [art("b", true)], at: 0 });
    r = openTab(r.tabs, { type: "commit", id: "c1", pin: false });
    r = openTab(r.tabs, art("d", false));
    expect(r.tabs.map((t) => (t.type === "art" ? t.key : t.id))).toEqual(["b", "d"]);
    expect(r.at).toBe(1);
  });
  test("opening a file that has a tab goes to it, keeps it kept, and shows the version asked for", () => {
    const r = openTab([art("a", true), art("b", false)], art("a", false, "x1"));
    expect(r).toEqual({ tabs: [art("a", true, "x1"), art("b", false)], at: 0 });
  });
  test("a diff counts old and new lines from its hunk header", () => {
    const rows = numbered({ head: "@@ -10,3 +10,4 @@ function f()", lines: [" a", "-b", "+B", "+C", " d", "\\ No newline at end of file"] });
    expect(rows.map((r) => [r.k, r.o, r.n])).toEqual([[" ", 10, 10], ["-", 11, null], ["+", null, 11], ["+", null, 12], [" ", 12, 13], ["x", null, null]]);
  });
});
