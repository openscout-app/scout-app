import { describe, expect, test } from "bun:test";

import type { Route } from "../../lib/types.ts";
import {
  addShortcut,
  COCKPIT_SHORTCUT_NAME_MAX,
  COCKPIT_SHORTCUTS_MAX,
  moveShortcut,
  parseShortcutLink,
  readShortcuts,
  removeShortcut,
  renameShortcut,
  shortcutCommands,
  shortcutRoute,
  suggestShortcutName,
  type CockpitShortcut,
} from "./cockpit-shortcuts.ts";

const ORIGIN = "http://127.0.0.1:43120";

function parsed(input: string) {
  const result = parseShortcutLink(input, ORIGIN);
  if ("error" in result) throw new Error(`expected a link, got: ${result.error}`);
  return result;
}

function parseError(input: string): string {
  const result = parseShortcutLink(input, ORIGIN);
  if (!("error" in result)) throw new Error(`expected an error, got: ${result.href}`);
  return result.error;
}

const list: CockpitShortcut[] = [
  { id: "a", name: "Sessions", href: "/sessions" },
  { id: "b", name: "openscout on mini", href: "/projects/openscout?machineId=dev-host" },
  { id: "c", name: "Tail “error”", href: "/ops/tail?q=error" },
];

describe("shortcut links", () => {
  test("a path, with or without its slash, is the page's canonical link", () => {
    expect(parsed("/sessions/abc").href).toBe("/sessions/abc");
    expect(parsed("sessions/abc").href).toBe("/sessions/abc");
    expect(parsed("/sessions/").href).toBe("/sessions");
  });

  test("a URL of the app keeps the route, its filters and the machine scope", () => {
    expect(parsed(`${ORIGIN}/ops/tail?q=error`).href).toBe("/ops/tail?q=error");
    expect(parsed("127.0.0.1:43120/projects/openscout?machineId=dev-host").href).toBe(
      "/projects/openscout?machineId=dev-host",
    );
    expect(parsed("/search?q=retry").href).toBe("/search?q=retry");
  });

  test("Home's own paths are Home; an unknown path is not a page", () => {
    expect(parsed("/").href).toBe("/");
    expect(parsed("/fleet").href).toBe("/");
    expect(parseError("/nope/x")).toBe("Scout has no page at /nope/x.");
  });

  test("an empty field and links that are not Scout pages say why", () => {
    expect(parseError("  ")).toBe("Paste a link to a page in Scout, or a path such as /sessions.");
    expect(parseError("javascript:alert(1)")).toBe("That is not a link to a page in Scout.");
    expect(parseError("mailto:someone@example.com")).toBe("That is not a link to a page in Scout.");
  });

  test("a saved link opens the route it was parsed from", () => {
    const { href, route } = parsed("/projects/openscout?machineId=dev-host");
    expect(shortcutRoute(href)).toEqual(route);
  });
});

describe("suggested names", () => {
  test("a name says what the page is, and the machine it is scoped to", () => {
    expect(suggestShortcutName(parsed("/sessions/abc").route)).toBe("Session abc");
    expect(suggestShortcutName(parsed("/sessions").route)).toBe("Sessions");
    expect(suggestShortcutName(parsed("/ops/tail?q=error").route)).toBe("Tail “error”");
    expect(suggestShortcutName(parsed("/agents/codex.main").route)).toBe("Agent codex.main");
    expect(suggestShortcutName(parsed("/search?q=retry").route)).toBe("Search “retry”");
    expect(suggestShortcutName(parsed("/projects/openscout?machineId=dev-host").route)).toBe(
      "Project openscout · dev-host",
    );
  });
});

describe("the list", () => {
  test("adds at the end, never twice, and not past the cap", () => {
    const added = addShortcut(list, { name: "Settings", href: "/settings" }, "d");
    expect(added.result).toBe("added");
    expect(added.list.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);

    const again = addShortcut(list, { name: "Other name", href: "/sessions" }, "e");
    expect(again.result).toBe("exists");
    expect(again.list).toEqual(list);

    const full = Array.from({ length: COCKPIT_SHORTCUTS_MAX }, (_, i) => ({ id: `s${i}`, name: `S${i}`, href: `/sessions/s${i}` }));
    expect(addShortcut(full, { name: "One more", href: "/settings" }, "x").result).toBe("full");
  });

  test("an empty name on add takes the page's name", () => {
    const { list: next } = addShortcut([], { name: "  ", href: "/ops/tail?q=error" }, "d");
    expect(next[0]?.name).toBe("Tail “error”");
  });

  test("renames, keeping the old name when the new one is empty, and clamps long names", () => {
    expect(renameShortcut(list, "b", "  mini  project ")[1]?.name).toBe("mini project");
    expect(renameShortcut(list, "b", "   ")[1]?.name).toBe("openscout on mini");
    const long = renameShortcut(list, "a", "x".repeat(80))[0]?.name ?? "";
    expect(long.length).toBe(COCKPIT_SHORTCUT_NAME_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  test("moves one place at a time and holds at the ends", () => {
    expect(moveShortcut(list, "b", -1).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(moveShortcut(list, "b", 1).map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(moveShortcut(list, "a", -1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(moveShortcut(list, "c", 1).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  test("removes by id", () => {
    expect(removeShortcut(list, "b").map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("the saved list", () => {
  test("reads what was written", () => {
    expect(readShortcuts(JSON.stringify(list))).toEqual(list);
  });

  test("drops malformed, outside and repeated entries rather than throwing", () => {
    expect(readShortcuts(null)).toEqual([]);
    expect(readShortcuts("{not json")).toEqual([]);
    expect(readShortcuts(JSON.stringify({ id: "a" }))).toEqual([]);
    const raw = JSON.stringify([
      list[0],
      { id: "x", name: "Outside", href: "https://example.com/" },
      { id: "y", name: 4, href: "/settings" },
      { id: "z", name: "Same link", href: "/sessions" },
      null,
      list[2],
    ]);
    expect(readShortcuts(raw)).toEqual([list[0]!, list[2]!]);
  });
});

describe("command palette", () => {
  function store() {
    const calls: string[] = [];
    return {
      calls,
      add: (entry: { name: string; href: string }) => {
        calls.push(`add ${entry.name} ${entry.href}`);
        return "added" as const;
      },
      remove: (id: string) => {
        calls.push(`remove ${id}`);
      },
    };
  }

  test("offers to add the page on screen, then opens each shortcut", () => {
    const s = store();
    const opened: Route[] = [];
    const commands = shortcutCommands(parsed("/agents/codex.main").route, list, (r) => opened.push(r), s);
    expect(commands.map((c) => c.label)).toEqual([
      "Add this page to shortcuts",
      "Open shortcut: Sessions",
      "Open shortcut: openscout on mini",
      "Open shortcut: Tail “error”",
    ]);
    commands[0]!.action();
    expect(s.calls).toEqual(["add Agent codex.main /agents/codex.main"]);
    commands[3]!.action();
    expect(opened).toEqual([shortcutRoute("/ops/tail?q=error")]);
  });

  test("a page that is already a shortcut offers to remove it", () => {
    const s = store();
    const commands = shortcutCommands(parsed("/ops/tail?q=error").route, list, () => {}, s);
    expect(commands[0]?.label).toBe("Remove this page from shortcuts");
    commands[0]!.action();
    expect(s.calls).toEqual(["remove c"]);
  });

  test("Home is never offered: the cockpit is on it", () => {
    const commands = shortcutCommands(parsed("/").route, [], () => {}, store());
    expect(commands).toEqual([]);
  });
});
