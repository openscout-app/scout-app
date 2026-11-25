import { describe, expect, test } from "bun:test";
import { readableLine } from "./front-page-model.ts";

describe("readableLine", () => {
  test("drops a routing tag the line opens with", () => {
    expect(readableLine("[ask:msg-request-c692a4fde2306fb0bd083e8d] Nothing is left to build on this branch."))
      .toBe("Nothing is left to build on this branch.");
  });
  test("drops the previous-task preface and the tag after it", () => {
    expect(readableLine("Previous task inv-request-ca9b3862352ccbc04748 (completed): [ask:msg-request-c692] Agent channel study: should agents emit points?"))
      .toBe("Agent channel study: should agents emit points?");
  });
  test("keeps ordinary words and links as written", () => {
    expect(readableLine("Opened #2154 to fix the build left by [#2145](https://example.com/2145)."))
      .toBe("Opened #2154 to fix the build left by [#2145](https://example.com/2145).");
  });
  test("a line of only plumbing reads as nothing", () => {
    expect(readableLine("[ask:msg-request-c692]")).toBeNull();
    expect(readableLine(null)).toBeNull();
  });
});
