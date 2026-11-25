import { expect, test } from "bun:test";
import { listTooltipTop } from "./list-tooltip.ts";

test("a deeply scrolled row positions its tooltip from visible rectangles, not its original list offset", () => {
  expect(listTooltipTop({ top: 140, bottom: 156 }, { top: 100, height: 300 }, 40)).toBe(58);
});
test("a row near the panel foot puts the tooltip above it, clamped to the panel", () => {
  expect(listTooltipTop({ top: 370, bottom: 386 }, { top: 100, height: 300 }, 40)).toBe(228);
  expect(listTooltipTop({ top: 100, bottom: 116 }, { top: 100, height: 30 }, 40)).toBe(4);
});
