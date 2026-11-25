import { describe, expect, test } from "bun:test";

import { countObserveTrace, observeToolIsResult, observeToolLabel } from "./observe-trace-counts.ts";

describe("countObserveTrace", () => {
  test("reads Claude's capitalized tool names", () => {
    const counts = countObserveTrace([
      { kind: "tool", tool: "Read" },
      { kind: "tool", tool: "read_file" },
      { kind: "tool", tool: "Edit" },
      { kind: "tool", tool: "Write" },
      { kind: "tool", tool: "apply_patch" },
      { kind: "tool", tool: "Bash" },
    ]);
    expect(counts.tools).toBe(6);
    expect(counts.reads).toBe(2);
    expect(counts.edits).toBe(3);
  });

  test("an output row is not a call", () => {
    const counts = countObserveTrace([
      { kind: "tool", tool: "Bash" },
      { kind: "tool", tool: "res" },
      { kind: "tool", tool: "Read" },
      { kind: "tool", tool: "res" },
    ]);
    expect(counts.tools).toBe(2);
    expect(counts.results).toBe(2);
  });

  test("a call with a diff counts as an edit", () => {
    const counts = countObserveTrace([
      { kind: "tool", tool: "MultiEdit", diff: { add: 2, del: 1 } },
      { kind: "tool", tool: "Bash" },
    ]);
    expect(counts.edits).toBe(1);
  });

  test("counts thinking, including the bare marker the tail writes", () => {
    const counts = countObserveTrace([
      { kind: "think", text: "plan" },
      { kind: "message", text: "[thinking]" },
      { kind: "message", text: "[thinking] Inspect the registry first." },
      { kind: "message", text: "Done, the registry is clean." },
    ]);
    expect(counts.thinks).toBe(3);
  });

  test("counts requests", () => {
    expect(countObserveTrace([{ kind: "ask" }, { kind: "ask" }, { kind: "message" }]).requests).toBe(2);
  });
});

describe("observeToolLabel", () => {
  test("names an output row as output", () => {
    expect(observeToolIsResult("res")).toBe(true);
    expect(observeToolIsResult(" RES ")).toBe(true);
    expect(observeToolLabel("res")).toBe("output");
    expect(observeToolLabel("Bash")).toBe("Bash");
  });
});
