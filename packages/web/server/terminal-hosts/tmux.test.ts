import { describe, expect, test } from "bun:test";

import { tmuxTitleMetadata } from "./tmux.ts";

describe("tmuxTitleMetadata", () => {
  test("carries the pane title a harness set and a window name someone chose", () => {
    expect(tmuxTitleMetadata({
      currentCommand: "2.1.319",
      windowName: "review",
      paneTitle: "✳ Terminals view spacing",
    })).toEqual({ windowName: "review", paneTitle: "✳ Terminals view spacing" });
  });

  test("a window named by automatic-rename says nothing new", () => {
    expect(tmuxTitleMetadata({ currentCommand: "2.1.319", windowName: "2.1.319", paneTitle: null })).toEqual({});
    expect(tmuxTitleMetadata({ currentCommand: "zsh", windowName: "zsh[dead]" })).toEqual({});
    expect(tmuxTitleMetadata({ currentCommand: "less", windowName: "[tmux]" })).toEqual({});
  });

  test("an older core reports neither field", () => {
    expect(tmuxTitleMetadata({ name: "logs", currentCommand: "tail" })).toEqual({});
    expect(tmuxTitleMetadata({ windowName: "  ", paneTitle: "" })).toEqual({});
  });
});
