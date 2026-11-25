import { describe, expect, test } from "bun:test";
import { fieldIntensity } from "./dot-field.ts";

describe("the dot field's intensity", () => {
  test("nothing done is zero; it rises on a log scale and tops out at one", () => {
    expect(fieldIntensity([0, 0, 0, 0])).toBe(0);
    const light = fieldIntensity([0, 0, 0, 2]);
    const busy = fieldIntensity([0, 4, 6, 6]);
    expect(light).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(light);
    expect(fieldIntensity([30, 30, 30])).toBe(1);
  });

  test("only the last passes count", () => {
    expect(fieldIntensity([40, 40, 40, 0, 0, 0])).toBe(0);
  });
});
