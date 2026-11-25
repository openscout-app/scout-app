import { describe, expect, test } from "bun:test";
import { freshnessLabel } from "./page-refresh.ts";

describe("how fresh the page is", () => {
  const now = 1_800_000_000_000;
  test("nothing before the first read; then just now, minutes, hours, days", () => {
    expect(freshnessLabel(null, now)).toBeNull();
    expect(freshnessLabel(now - 10_000, now)).toBe("Updated just now");
    expect(freshnessLabel(now - 120_000, now)).toBe("Updated 2m ago");
    expect(freshnessLabel(now - 3 * 3_600_000, now)).toBe("Updated 3h ago");
    expect(freshnessLabel(now - 50 * 3_600_000, now)).toBe("Updated 2d ago");
  });
});
