import { describe, expect, test } from "bun:test";

import {
  canShowQuickTerminal,
  closeQuickTerminal,
  mountQuickTerminalHost,
  quickTerminal,
  popupPlace,
  POPUP,
  showQuickTerminal,
  subscribeQuickTerminal,
  type QuickTerminalOpen,
} from "./quick-terminal.ts";

const open = (key: string): QuickTerminalOpen => ({
  key, kind: "Session", pane: { backend: "tmux", sessionName: `s-${key}` }, who: "hopper", title: "Run bun test", at: 1,
});

describe("the quick terminal", () => {
  test("a pop-up Scout started a process for releases it once, however it goes", () => {
    const released: string[] = [];
    const owned = (key: string): QuickTerminalOpen => ({ ...open(key), release: () => { released.push(key); } });
    const unmount = mountQuickTerminalHost();
    // Replaced by another.
    showQuickTerminal(owned("a"));
    showQuickTerminal(owned("b"));
    expect(released).toEqual(["a"]);
    // A close naming another pop-up leaves it be.
    closeQuickTerminal("a");
    expect(released).toEqual(["a"]);
    // Closed.
    closeQuickTerminal("b");
    expect(released).toEqual(["a", "b"]);
    closeQuickTerminal();
    expect(released).toEqual(["a", "b"]);
    // Its host goes.
    showQuickTerminal(owned("c"));
    unmount();
    expect(released).toEqual(["a", "b", "c"]);
    expect(quickTerminal()).toBeNull();
  });

  test("shows only where a host draws it, one at a time, and closes by its own key", () => {
    expect(canShowQuickTerminal()).toBe(false);
    let heard = 0;
    const off = subscribeQuickTerminal(() => { heard += 1; });
    const unmount = mountQuickTerminalHost();
    expect(canShowQuickTerminal()).toBe(true);
    // The host's arrival is heard: the ways in can offer it now.
    expect(heard).toBe(1);
    showQuickTerminal(open("a"));
    showQuickTerminal(open("b"));
    expect(quickTerminal()?.key).toBe("b");
    closeQuickTerminal("a");
    expect(quickTerminal()?.key).toBe("b");
    closeQuickTerminal("b");
    expect(quickTerminal()).toBeNull();
    expect(heard).toBe(4);
    unmount();
    expect(canShowQuickTerminal()).toBe(false);
    expect(heard).toBe(5);
    off();
  });

  test("the last host going takes an open pop-up with it", () => {
    const one = mountQuickTerminalHost();
    const two = mountQuickTerminalHost();
    showQuickTerminal(open("a"));
    one();
    expect(quickTerminal()?.key).toBe("a");
    two();
    expect(quickTerminal()).toBeNull();
  });
});

describe("where the pop-up stands", () => {
  const view = { width: 1920, height: 1080 };

  test("beside the board, on the side with more room, its foot level with the board's", () => {
    const board = { left: 1500, top: 600, right: 1900, bottom: 1060 };
    expect(popupPlace(board, view)).toEqual({ left: 1500 - POPUP.GAP - POPUP.WIDTH, top: 1060 - POPUP.HEIGHT, width: POPUP.WIDTH, height: POPUP.HEIGHT });
    const left = { left: 20, top: 600, right: 420, bottom: 1060 };
    expect(popupPlace(left, view).left).toBe(420 + POPUP.GAP);
  });

  test("kept on the screen, and over the board's middle when neither side has room", () => {
    const tall = { left: 1500, top: 10, right: 1900, bottom: 200 };
    expect(popupPlace(tall, view).top).toBe(POPUP.INSET);
    const narrow = { width: 900, height: 700 };
    const wide = { left: 100, top: 100, right: 800, bottom: 600 };
    const place = popupPlace(wide, narrow);
    expect(place.width).toBe(POPUP.WIDTH);
    expect(place.left).toBe(Math.round((900 - POPUP.WIDTH) / 2));
  });

  test("with nothing to keep clear of, in the middle; never wider than the screen", () => {
    expect(popupPlace(null, { width: 600, height: 400 })).toEqual({ left: POPUP.INSET, top: POPUP.INSET, width: 600 - POPUP.INSET * 2, height: 400 - POPUP.INSET * 2 });
  });
});
