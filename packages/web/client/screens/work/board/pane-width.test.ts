import { afterEach, expect, test } from "bun:test";
import { clampWidth, paneMax, readWidth, writeWidth } from "./pane-width.ts";
const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});
test("width respects minimum, board ceiling and default", () => {
  expect(clampWidth(10, 1000)).toBe(360);
  expect(clampWidth(900, 1000)).toBe(700);
  expect(clampWidth(NaN, 1000)).toBe(400);
  expect(clampWidth(400, 400)).toBe(280);
  expect(paneMax(1000)).toBe(700);
});
test("viewer width round trips and invalid values use current default", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } } });
  expect(readWidth(450)).toBe(450);
  writeWidth(560);
  expect(readWidth()).toBe(560);
  writeWidth(NaN);
  expect(readWidth(480)).toBe(480);
});
test("denied storage access is harmless on reads and writes", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw Error("Denied"); } } });
  expect(readWidth(420)).toBe(420);
  expect(() => writeWidth(500)).not.toThrow();
});
