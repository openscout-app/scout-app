import { describe, expect, test } from "bun:test";
import { parseTailUsageSessionIds, TAIL_USAGE_SESSION_LIMIT } from "./tail-usage-query.ts";

describe("parseTailUsageSessionIds", () => {
  test("repeated and comma-separated ids, trimmed and deduped, in order", () => {
    expect(parseTailUsageSessionIds(["s-1", " s-2 ,s-1", "", "s-3,"])).toEqual(["s-1", "s-2", "s-3"]);
  });

  test("at most the runtime's limit; overlong ids are dropped", () => {
    const many = Array.from({ length: TAIL_USAGE_SESSION_LIMIT + 10 }, (_, i) => `s-${i}`);
    expect(parseTailUsageSessionIds([many.join(",")]).length).toBe(TAIL_USAGE_SESSION_LIMIT);
    expect(parseTailUsageSessionIds(["x".repeat(257), "ok"])).toEqual(["ok"]);
  });
});
