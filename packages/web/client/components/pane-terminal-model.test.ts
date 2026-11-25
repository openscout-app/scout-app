import { describe, expect, test } from "bun:test";

import { isJumpOutKey, paneLine, paneRelayOptions, paneRelayUrl, PANE_RELEASE_MS } from "./pane-terminal-model.ts";

const pane = { backend: "tmux" as const, sessionName: "relay-agent-1-claude" };

describe("a prompt's pane", () => {
  test("watching is a read-only client on the plain relay socket", () => {
    expect(paneRelayUrl("ws://host/ws/terminal", "watch")).toBe("ws://host/ws/terminal");
    expect(paneRelayOptions(pane, "watch")).toEqual({
      backend: "tmux",
      tmuxSession: "relay-agent-1-claude",
      agent: "shell",
      controlMode: "observe",
      orphanTTL: PANE_RELEASE_MS,
    });
  });

  test("jumping in is a writer that asks the relay to follow the pane's size", () => {
    expect(paneRelayUrl("ws://host/ws/terminal", "joined")).toBe("ws://host/ws/terminal?sizing=follow");
    expect(paneRelayUrl("ws://host/ws/terminal?agentId=a", "joined")).toBe("ws://host/ws/terminal?agentId=a&sizing=follow");
    expect(paneRelayOptions(pane, "joined").controlMode).toBe("takeover");
  });

  test("the relay lets go of the client soon after the companion does", () => {
    expect(PANE_RELEASE_MS).toBeLessThanOrEqual(1_000);
    expect(paneRelayOptions(pane, "joined").orphanTTL).toBe(PANE_RELEASE_MS);
  });

  test("the line says whose pane it is and whether keys reach it", () => {
    expect(paneLine("watch", "hopper")).toBe("Watching hopper's pane");
    expect(paneLine("joined", "hopper")).toBe("Your keys go to hopper's pane");
    expect(paneLine("watch", null)).toBe("Watching the pane");
  });

  test("only ⌘. jumps out, so Esc and every other key still reach the prompt", () => {
    const key = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) =>
      ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
    expect(isJumpOutKey(key(".", { metaKey: true }))).toBe(true);
    expect(isJumpOutKey(key("Escape"))).toBe(false);
    expect(isJumpOutKey(key("."))).toBe(false);
    expect(isJumpOutKey(key(".", { ctrlKey: true }))).toBe(false);
    expect(isJumpOutKey(key(".", { metaKey: true, shiftKey: true }))).toBe(false);
  });
});
