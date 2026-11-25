import { describe, expect, test } from "bun:test";

import { inlineMarks, safeHref } from "./swarm-markup.ts";

describe("inlineMarks", () => {
  test("reads a lane's head line: a link, a code span and a bold lead", () => {
    expect(inlineMarks("Draft [#133](https://github.com/arach/scout/pull/133), head `0fe8eb9e`, stacked on stage 4.")).toEqual([
      { kind: "text", text: "Draft " },
      { kind: "link", text: "#133", href: "https://github.com/arach/scout/pull/133" },
      { kind: "text", text: ", head " },
      { kind: "code", text: "0fe8eb9e" },
      { kind: "text", text: ", stacked on stage 4." },
    ]);
    expect(inlineMarks("**Pure partition:** all 15 expanded commands match.")).toEqual([
      { kind: "strong", text: "Pure partition:" },
      { kind: "text", text: " all 15 expanded commands match." },
    ]);
  });

  test("keeps the marks inside a bold lead for the next pass", () => {
    expect(inlineMarks("**Clear at `eb5a68f5`;** merge on green.")).toEqual([
      { kind: "strong", text: "Clear at `eb5a68f5`;" },
      { kind: "text", text: " merge on green." },
    ]);
  });

  test("a bare URL links without the sentence's last stop", () => {
    expect(inlineMarks("Run: https://github.com/arach/scout/actions/runs/40097775363.")).toEqual([
      { kind: "text", text: "Run: " },
      { kind: "link", text: "https://github.com/arach/scout/actions/runs/40097775363", href: "https://github.com/arach/scout/actions/runs/40097775363" },
      { kind: "text", text: "." },
    ]);
  });

  test("a glob stays words: emphasis needs a word boundary on each side", () => {
    const glob = "Run client/lib/swarm-*.test.ts and client/screens/swarm/*.test.tsx on both Buns.";
    expect(inlineMarks(glob)).toEqual([{ kind: "text", text: glob }]);
    expect(inlineMarks("packages/**/src and 2 * 3 * 4")).toEqual([{ kind: "text", text: "packages/**/src and 2 * 3 * 4" }]);
    expect(inlineMarks("a *real* word")).toEqual([
      { kind: "text", text: "a " },
      { kind: "em", text: "real" },
      { kind: "text", text: " word" },
    ]);
  });

  test("a link to anything but the web or mail stays words", () => {
    const marks = inlineMarks("[open](javascript:alert(1)) and [file](/private/tmp/x.md)");
    expect(marks.some((mark) => mark.kind === "link")).toBe(false);
    expect(marks.map((mark) => mark.text).join("")).toBe("[open](javascript:alert(1)) and [file](/private/tmp/x.md)");
    expect(safeHref("mailto:a@b.c")).toBe(true);
    expect(safeHref("javascript:alert(1)")).toBe(false);
  });

  test("text with no marks is one text mark, and empty text is none", () => {
    expect(inlineMarks("Brief: /private/tmp/claude-501/scratchpad/lane-t-brief.md")).toEqual([
      { kind: "text", text: "Brief: /private/tmp/claude-501/scratchpad/lane-t-brief.md" },
    ]);
    expect(inlineMarks("")).toEqual([]);
  });
});
