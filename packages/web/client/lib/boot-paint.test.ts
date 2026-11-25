import { describe, expect, test } from "bun:test";
import { paints } from "./boot-paint.ts";

describe("which computed colours paint", () => {
  test("opaque colours paint", () => {
    expect(paints("rgb(243, 242, 238)")).toBe(true);
    expect(paints("oklch(0.97 0.004 80)")).toBe(true);
    expect(paints("rgba(9, 9, 10, 0.9)")).toBe(true);
    expect(paints("color(srgb 0.1 0.1 0.1 / 50%)")).toBe(true);
  });

  test("transparent ones do not", () => {
    expect(paints("rgba(0, 0, 0, 0)")).toBe(false);
    expect(paints("transparent")).toBe(false);
    expect(paints("oklch(0.5 0 0 / 0)")).toBe(false);
    expect(paints("")).toBe(false);
  });
});
