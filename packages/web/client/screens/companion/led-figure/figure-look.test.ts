import { expect, test } from "bun:test";

import { parseFigureLook } from "./figure-look-model.ts";

test("LED initials is the default look; junk reads as the default", () => {
  expect(parseFigureLook(null)).toBe("led-initials");
  expect(parseFigureLook("sparkles")).toBe("led-initials");
  expect(parseFigureLook("character")).toBe("character");
});
