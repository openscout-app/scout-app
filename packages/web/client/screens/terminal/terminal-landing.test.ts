import { describe, expect, test } from "bun:test";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { surfaceKey, terminalListItems } from "../../lib/terminal-sessions.ts";
import { isRunningTerminalItem, landingTerminalItem } from "./terminal-landing.ts";

function session(
  id: string,
  backend: string,
  sessionName: string,
  options: { state?: "live" | "detached" | "exited"; activityAt?: number } = {},
): TerminalSessionRecord {
  return {
    id,
    harness: backend,
    sourceSessionId: sessionName,
    cwd: "",
    resumeCommand: `${backend} attach ${sessionName}`,
    surfaces: [{
      backend,
      sessionName,
      paneId: null,
      attachCommand: [backend, "attach", sessionName],
      observeCommand: null,
      relay: { backend, sessionName },
      state: options.state ?? "live",
    }],
    createdAt: 1,
    updatedAt: options.activityAt ?? 1,
    metadata: options.activityAt !== undefined ? { activityAt: options.activityAt } : {},
  };
}

describe("where bare /terminal lands", () => {
  const items = terminalListItems([
    session("old", "tmux", "session-old", { activityAt: 100 }),
    session("new", "tmux", "session-new", { activityAt: 300 }),
    session("gone", "tmux", "session-gone", { state: "exited", activityAt: 900 }),
    session("herdr", "herdr", "scout", { state: "detached", activityAt: 800 }),
  ]);
  const keyOf = (id: string) => surfaceKey(items.find((item) => item.session.id === id)!.surface);

  test("a stopped herdr session and an exited one are not running", () => {
    expect(items.filter(isRunningTerminalItem).map((item) => item.session.id)).toEqual(["old", "new"]);
  });

  test("the terminal you last opened, while it still runs", () => {
    expect(landingTerminalItem(items, keyOf("old"))?.session.id).toBe("old");
  });

  test("else the most recently active running one, never a stopped one", () => {
    expect(landingTerminalItem(items, null)?.session.id).toBe("new");
    expect(landingTerminalItem(items, keyOf("gone"))?.session.id).toBe("new");
  });

  test("a terminal where work is moving now leads, as in the list", () => {
    expect(landingTerminalItem(items, null, (item) => item.session.id === "old")?.session.id).toBe("old");
    expect(landingTerminalItem(items, keyOf("new"), (item) => item.session.id === "old")?.session.id).toBe("new");
  });

  test("nothing running lands nowhere, so the workspace stays", () => {
    expect(landingTerminalItem(items.filter((item) => !isRunningTerminalItem(item)), null)).toBeNull();
  });
});
