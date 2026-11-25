/**
 * An LED dot-matrix sign: text set in a 5×7 dot font, read as columns of
 * lit dots. Pure, so the layout is testable without a canvas.
 *
 * A column is a 7-bit number, bit 0 at the top row.
 */

export const LED_ROWS = 7;

/* 5×7 glyphs, one string of 7 rows per character ("#" lit). Lowercase reads as
 * uppercase; anything unknown becomes a blank. */
const GLYPHS: Record<string, string> = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
  N: "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
  "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
  "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  "5": "#####|#....|####.|....#|....#|#...#|.###.",
  "6": "..##.|.#...|#....|####.|#...#|#...#|.###.",
  "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
  "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
  ".": ".|.|.|.|.|.|#",
  ",": "..|..|..|..|..|.#|#.",
  ":": ".|.|#|.|#|.|.",
  ";": "..|..|.#|..|.#|.#|#.",
  "!": "#|#|#|#|#|.|#",
  "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
  "'": "#|#|.|.|.|.|.",
  "\"": "#.#|#.#|...|...|...|...|...",
  "-": "....|....|....|####|....|....|....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  "=": "....|....|####|....|####|....|....",
  "/": "....#|...#.|...#.|..#..|.#...|.#...|#....",
  "\\": "#....|.#...|.#...|..#..|...#.|...#.|....#",
  "_": ".....|.....|.....|.....|.....|.....|#####",
  "(": ".#|#.|#.|#.|#.|#.|.#",
  ")": "#.|.#|.#|.#|.#|.#|#.",
  "[": "##|#.|#.|#.|#.|#.|##",
  "]": "##|.#|.#|.#|.#|.#|##",
  "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.",
  "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
  "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
  "%": "##..#|##..#|...#.|..#..|.#...|#..##|#..##",
  "*": ".....|#.#.#|.###.|#####|.###.|#.#.#|.....",
  ">": "#...|.#..|..#.|...#|..#.|.#..|#...",
  "<": "...#|..#.|.#..|#...|.#..|..#.|...#",
  "·": ".|.|.|#|.|.|.",
  "→": ".....|..#..|...#.|#####|...#.|..#..|.....",
  "…": ".....|.....|.....|.....|.....|.....|#.#.#",
};

const SPACE_COLUMNS = 3;
const cache = new Map<string, number[]>();

function glyphColumns(ch: string): number[] {
  const hit = cache.get(ch);
  if (hit) return hit;
  const source = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()];
  if (!source) return [];
  const rows = source.split("|");
  const width = rows[0]!.length;
  const cols: number[] = [];
  for (let x = 0; x < width; x++) {
    let bits = 0;
    for (let y = 0; y < LED_ROWS; y++) if (rows[y]?.[x] === "#") bits |= 1 << y;
    cols.push(bits);
  }
  // Proportional: a glyph is only as wide as its lit dots.
  while (cols.length > 1 && cols[0] === 0) cols.shift();
  while (cols.length > 1 && cols[cols.length - 1] === 0) cols.pop();
  cache.set(ch, cols);
  return cols;
}

/** Text as dot columns, proportional: one dark column between letters, three for a space. */
export function ledColumns(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")) {
    if (/\s/.test(ch)) { for (let i = 0; i < SPACE_COLUMNS; i++) out.push(0); continue; }
    const cols = glyphColumns(ch);
    if (!cols.length) continue;
    if (out.length && out[out.length - 1] !== 0) out.push(0); // after a space, the gap is already there
    out.push(...cols);
  }
  while (out.length && out[out.length - 1] === 0) out.pop();
  return out;
}

/**
 * Initials for a name: the first letter of each word, or of each part of a
 * handle ("openscout-chopin-3" reads as its middle word, "C3"). Up to three.
 */
export function ledInitials(name: string, max = 2): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  // A Scout handle carries the project first ("openscout-chopin-3"): the agent is the rest.
  const parts = words.length >= 3 && /^\d+$/.test(words[words.length - 1]!) ? words.slice(1) : words;
  if (parts.length === 1) return parts[0]!.slice(0, max).toUpperCase();
  return parts.slice(0, max).map((w) => (/^\d+$/.test(w) ? w : w[0]!)).join("").slice(0, max + 1).toUpperCase();
}

/** The name a sign shows in name mode: the handle without its project prefix. */
export function ledName(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length >= 3 && /^\d+$/.test(words[words.length - 1]!)) return words.slice(1, -1).join(" ").toUpperCase();
  return name.trim().toUpperCase();
}

/**
 * The columns visible at a scroll offset in a window `width` wide. A sign
 * that fits is centered and holds still; one that does not runs as a loop
 * with `gap` dark columns between passes.
 */
export function ledWindow(cols: readonly number[], width: number, offset: number, gap = 8): number[] {
  if (cols.length <= width) {
    const pad = Math.floor((width - cols.length) / 2);
    return Array.from({ length: width }, (_, i) => cols[i - pad] ?? 0);
  }
  const loop = cols.length + gap;
  const start = ((Math.floor(offset) % loop) + loop) % loop;
  return Array.from({ length: width }, (_, i) => cols[(start + i) % loop] ?? 0);
}

export function ledScrolls(cols: readonly number[], width: number): boolean {
  return cols.length > width;
}
