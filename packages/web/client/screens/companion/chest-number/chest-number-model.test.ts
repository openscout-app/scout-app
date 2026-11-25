import { describe, expect, test } from "bun:test";

import { chestNumberShows } from "./chest-number-model.ts";

describe("the chest number", () => {
  test("the LED tile from 48, crew art and the sprite from 64; smaller, the label under the figure carries the code", () => {
    expect(chestNumberShows("led", 24)).toBe(false);
    expect(chestNumberShows("led", 48)).toBe(true);
    expect(chestNumberShows("sprite", 48)).toBe(false);
    expect(chestNumberShows("sprite", 64)).toBe(true);
    expect(chestNumberShows("crew", 48)).toBe(false);
    expect(chestNumberShows("crew", 64)).toBe(true);
  });

  test("crew art only in its rest pose", () => {
    expect(chestNumberShows("crew", 64, "wave")).toBe(false);
    expect(chestNumberShows("crew", 64, "hang-from-top")).toBe(false);
  });
});
