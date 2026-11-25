import { describe, expect, test } from "bun:test";

import { isWorkTerminalOpen, setWorkTerminalOpen } from "./work-terminal-state.ts";

describe("work terminal state", () => {
  test("each work item opens and closes its own terminal", () => {
    setWorkTerminalOpen("work-a", true);
    expect(isWorkTerminalOpen("work-a")).toBe(true);
    expect(isWorkTerminalOpen("work-b")).toBe(false);
    setWorkTerminalOpen("work-a", false);
    expect(isWorkTerminalOpen("work-a")).toBe(false);
  });
});
