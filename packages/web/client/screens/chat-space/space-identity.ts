/**
 * A space's look: one hue and one glyph, derived from its slug.
 *
 * Spaces on the same host need to read as different places at a glance, in
 * the Mac app's sidebar and in the room itself, without anyone choosing a
 * colour. The slug is the space's stable address, so the look is a pure
 * function of it: the same space wears the same mark on every device and in
 * every client, and nothing is stored.
 *
 * The Mac app computes the same thing in Swift (`ScoutChatSpaceIdentity` in
 * apps/macos/Sources/Scout/ScoutChatSpaces.swift). Both sides pin the same
 * vectors in their tests; change the tables in one place and the other's tests
 * fail until it matches.
 *
 * Hash: 32-bit FNV-1a over the slug's UTF-8 bytes. Hue: hash mod 10. Glyph:
 * (hash >>> 8) mod 8.
 */

export type SpaceGlyph = "dot" | "ring" | "square" | "diamond" | "triangle" | "hexagon" | "plus" | "bars";

export const SPACE_GLYPHS: readonly SpaceGlyph[] = [
  "dot", "ring", "square", "diamond", "triangle", "hexagon", "plus", "bars",
];

/**
 * Ten hues, each as one ink for light and one for dark. Light inks are
 * oklch(0.56 0.13 h) and dark inks oklch(0.76 0.11 h), clipped to sRGB, so
 * every hue sits at the same weight and none shouts over the others.
 */
export const SPACE_HUES: readonly { name: string; light: string; dark: string }[] = [
  { name: "sky", light: "#007eb5", dark: "#64bced" },
  { name: "teal", light: "#008b85", dark: "#49c7c0" },
  { name: "green", light: "#2d8949", dark: "#7cc58c" },
  { name: "olive", light: "#737c00", dark: "#afb965" },
  { name: "amber", light: "#a06700", dark: "#daa75d" },
  { name: "orange", light: "#af5a21", dark: "#e99c70" },
  { name: "red", light: "#b4514c", dark: "#ef958e" },
  { name: "rose", light: "#ad5078", dark: "#e893b5" },
  { name: "violet", light: "#8160b5", dark: "#bca1ed" },
  { name: "indigo", light: "#576ec0", dark: "#96aef7" },
];

export type SpaceIdentity = {
  hue: (typeof SPACE_HUES)[number];
  hueIndex: number;
  glyph: SpaceGlyph;
};

export function spaceHash(slug: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(slug)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function spaceIdentity(slug: string): SpaceIdentity {
  const hash = spaceHash(slug);
  const hueIndex = hash % SPACE_HUES.length;
  return {
    hue: SPACE_HUES[hueIndex]!,
    hueIndex,
    glyph: SPACE_GLYPHS[(hash >>> 8) % SPACE_GLYPHS.length]!,
  };
}
