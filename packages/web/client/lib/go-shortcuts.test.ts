import { describe, expect, test } from "bun:test";
import { GO_SHORTCUTS, goShortcutForKey } from "./go-shortcuts.ts";

describe("go shortcuts", () => {
  test("maps mnemonic keys to top-level routes", () => {
    expect(goShortcutForKey("h")?.route).toEqual({ view: "inbox" });
    expect(goShortcutForKey("i")?.route).toEqual({ view: "requests" });
    expect(goShortcutForKey("c")?.route).toEqual({ view: "rooms" });
    expect(goShortcutForKey("p")?.route).toEqual({ view: "agents-v2", indexView: "projects" });
    expect(goShortcutForKey("t")?.route).toEqual({ view: "terminal" });
    expect(goShortcutForKey("r")?.route).toEqual({ view: "repos" });
    expect(goShortcutForKey("f")?.route).toEqual({ view: "search" });
    expect(goShortcutForKey("l")?.route).toEqual({ view: "ops", mode: "tail" });
    expect(goShortcutForKey("w")).toBeNull();
    expect(goShortcutForKey("o")?.route).toEqual({ view: "ops", mode: "mission" });
    expect(goShortcutForKey("d")).toBeNull();
  });

  test("normalizes key casing and rejects unknown keys", () => {
    expect(goShortcutForKey("H")?.route).toEqual({ view: "inbox" });
    expect(goShortcutForKey("x")).toBeNull();
  });

  test("keeps shortcut keys unique", () => {
    const keys = GO_SHORTCUTS.map((shortcut) => shortcut.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
