import { describe, expect, test } from "bun:test";

import { createTmuxWindowPins } from "./tmux-window-pin.ts";

function fakeTmux(local: string | null = null) {
  const calls: string[][] = [];
  let windowSize = local;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "display-message") return "@7\n";
    if (args[0] === "show-options") return windowSize ? `${windowSize}\n` : "";
    if (args[0] === "set-option" && args[1] === "-wu") windowSize = null;
    else if (args[0] === "set-option") windowSize = args[5] ?? null;
    return "";
  };
  return { run, calls, size: () => windowSize };
}

describe("pinning a tmux window's size", () => {
  test("the first client pins the window and the last one puts its own setting back", async () => {
    const tmux = fakeTmux();
    const pins = createTmuxWindowPins(tmux.run);
    await pins.pin("relay-hopper");
    expect(tmux.size()).toBe("manual");
    await pins.pin("relay-hopper");
    await pins.release("relay-hopper");
    expect(tmux.size()).toBe("manual");
    expect(pins.holders("relay-hopper")).toBe(1);
    await pins.release("relay-hopper");
    expect(tmux.size()).toBeNull();
    expect(tmux.calls.at(-1)).toEqual(["set-option", "-wu", "-t", "@7", "window-size"]);
  });

  test("a window that had its own setting gets that setting back", async () => {
    const tmux = fakeTmux("smallest");
    const pins = createTmuxWindowPins(tmux.run);
    await pins.pin("relay-hopper");
    await pins.release("relay-hopper");
    expect(tmux.size()).toBe("smallest");
  });

  test("the pin follows the window it found, even if the session's current window changes", async () => {
    const tmux = fakeTmux();
    const pins = createTmuxWindowPins(tmux.run);
    await pins.pin("relay-hopper");
    await pins.release("relay-hopper");
    expect(tmux.calls.filter((call) => call[0] === "set-option").every((call) => call.includes("@7"))).toBe(true);
  });

  test("a release and a quick re-pin do not read Scout's own pin as the window's setting", async () => {
    const tmux = fakeTmux();
    const pins = createTmuxWindowPins(tmux.run);
    await pins.pin("relay-hopper");
    // Jump out and straight back in, without waiting.
    const out = pins.release("relay-hopper");
    const back = pins.pin("relay-hopper");
    await Promise.all([out, back]);
    await pins.release("relay-hopper");
    expect(tmux.size()).toBeNull();
  });

  test("releasing a window nobody pinned does nothing", async () => {
    const tmux = fakeTmux();
    const pins = createTmuxWindowPins(tmux.run);
    await pins.release("relay-hopper");
    expect(tmux.calls).toEqual([]);
  });
});
