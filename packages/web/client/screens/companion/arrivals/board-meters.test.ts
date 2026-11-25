import { expect, test } from "bun:test";
import { parseBoardMeters } from "./BoardSettings";

test("Meters reads its three values, and an old on/off value or none as the default, when high", () => {
  expect(parseBoardMeters("always")).toBe("always");
  expect(parseBoardMeters("off")).toBe("off");
  expect(parseBoardMeters("high")).toBe("high");
  expect(parseBoardMeters("1")).toBe("high");
  expect(parseBoardMeters("0")).toBe("high");
  expect(parseBoardMeters(null)).toBe("high");
});
