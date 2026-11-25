import { describe, expect, test } from "bun:test";
import { withSeen } from "./back-to-you-seen.ts";

describe("turns opened from Home", () => {
  test("a key moves to the newest end and the oldest fall off past the limit", () => {
    expect(withSeen(["a", "b"], "a")).toEqual(["b", "a"]);
    expect(withSeen(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });
});
