import { describe, expect, test } from "bun:test";

import { SPACE_GLYPHS, SPACE_HUES, spaceHash, spaceIdentity } from "./space-identity.ts";

// The same vectors are pinned in apps/macos/Tests/ScoutTests/ScoutChatSpacesTests.swift.
// A change here that is not made there fails one side or the other.
const VECTORS = [
  { slug: "home", hash: 3536372366, hue: "red", glyph: "square" },
  { slug: "default", hash: 2470140894, hue: "amber", glyph: "diamond" },
  { slug: "design-review", hash: 74062798, hue: "violet", glyph: "diamond" },
  { slug: "ops", hash: 3089275291, hue: "teal", glyph: "ring" },
  { slug: "acme-team", hash: 195827663, hue: "olive", glyph: "bars" },
  { slug: "world-view", hash: 671449875, hue: "orange", glyph: "diamond" },
] as const;

describe("space identity", () => {
  test("matches the vectors the Mac app pins", () => {
    for (const vector of VECTORS) {
      expect(spaceHash(vector.slug)).toBe(vector.hash);
      const identity = spaceIdentity(vector.slug);
      expect(identity.hue.name).toBe(vector.hue);
      expect(identity.glyph).toBe(vector.glyph);
    }
  });

  test("is stable and spreads across the tables", () => {
    expect(spaceIdentity("design-review")).toEqual(spaceIdentity("design-review"));
    const hues = new Set<string>();
    const glyphs = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const identity = spaceIdentity(`space-${index}`);
      hues.add(identity.hue.name);
      glyphs.add(identity.glyph);
    }
    expect(hues.size).toBe(SPACE_HUES.length);
    expect(glyphs.size).toBe(SPACE_GLYPHS.length);
  });

  test("every hue has a light and a dark ink", () => {
    for (const hue of SPACE_HUES) {
      expect(hue.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(hue.dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(hue.light).not.toBe(hue.dark);
    }
  });
});
