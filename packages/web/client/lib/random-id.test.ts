import { afterEach, describe, expect, test } from "bun:test";
import { randomUuid } from "./random-id.ts";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "crypto", original);
});

describe("randomUuid", () => {
  test("uses crypto.randomUUID when the page is a secure context", () => {
    expect(randomUuid()).toMatch(V4);
  });

  test("still returns a v4 UUID where randomUUID is missing, as on http://scout.local", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues } });
    const a = randomUuid();
    const b = randomUuid();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).not.toBe(b);
  });
});
