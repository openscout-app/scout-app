import type { CSSProperties } from "react";
import { avatarInitials } from "../lib/avatar-initials.ts";
import { InitialsAvatar } from "./InitialsAvatar.tsx";
import { FACE_5x7 } from "./ProjectMark.tsx";
import "./initials-avatar.css";

/**
 * A person's mark: their first initial on the LED board.
 *
 * The same 5x7 face as the project boards (ProjectMark), drawn sharper: square
 * dots, ink with no hue, the unlit dots faint behind the letter, on a circle
 * because a person is a circle. A letter outside A-Z, a-z and 0-9 falls back to
 * the typeset Initials avatar.
 *
 * The board is tunable, and the LED initial playground artifact drives the
 * same props: `pixel` (dots across one letter pixel), `dot` (how much of its
 * cell a dot fills), `margin` (letter pixels of space around the 5x7 box),
 * `ghost` (unlit dot opacity) and `centre`.
 */

/**
 * Lowercase on a 9-row cell: ascenders on rows 0-1, x-height on rows 2-6, the
 * baseline under row 6, and the tails of g, j, p, q and y on rows 7-8. No
 * letter is raised to make room for its tail.
 */
export const FACE_LOWER: Record<string, string[]> = {
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111", "00000", "00000"],
  b: ["10000", "10000", "10110", "11001", "10001", "10001", "11110", "00000", "00000"],
  c: ["00000", "00000", "01110", "10000", "10000", "10001", "01110", "00000", "00000"],
  d: ["00001", "00001", "01101", "10011", "10001", "10001", "01111", "00000", "00000"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110", "00000", "00000"],
  f: ["00110", "01001", "01000", "11100", "01000", "01000", "01000", "00000", "00000"],
  g: ["00000", "00000", "01111", "10001", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "10110", "11001", "10001", "10001", "10001", "00000", "00000"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110", "00000", "00000"],
  j: ["00010", "00000", "00110", "00010", "00010", "00010", "00010", "10010", "01100"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010", "00000", "00000"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110", "00000", "00000"],
  m: ["00000", "00000", "11010", "10101", "10101", "10001", "10001", "00000", "00000"],
  n: ["00000", "00000", "10110", "11001", "10001", "10001", "10001", "00000", "00000"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110", "00000", "00000"],
  p: ["00000", "00000", "11110", "10001", "10001", "10001", "11110", "10000", "10000"],
  q: ["00000", "00000", "01111", "10001", "10001", "10001", "01111", "00001", "00001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000", "00000", "00000"],
  s: ["00000", "00000", "01110", "10000", "01110", "00001", "11110", "00000", "00000"],
  t: ["01000", "01000", "11100", "01000", "01000", "01001", "00110", "00000", "00000"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101", "00000", "00000"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100", "00000", "00000"],
  w: ["00000", "00000", "10001", "10001", "10101", "10101", "01010", "00000", "00000"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001", "00000", "00000"],
  y: ["00000", "00000", "10001", "10001", "10001", "10011", "01101", "00001", "01110"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111", "00000", "00000"],
};

/** The glyph's rows: capitals and digits fill rows 0-6, lowercase uses all 9. */
export function ledGlyph(letter: string): string[] | null {
  return FACE_5x7[letter] ?? FACE_LOWER[letter] ?? null;
}

/** First and last lit rows. */
function inkRows(rows: string[]): [number, number] {
  let top = -1;
  let bottom = -1;
  rows.forEach((row, y) => {
    if (!row.includes("1")) return;
    if (top < 0) top = y;
    bottom = y;
  });
  return top < 0 ? [0, 6] : [top, bottom];
}

export type LedBoard = {
  /** Dots across and down one letter pixel. More dots, smaller dots. */
  pixel?: number;
  /** Share of its cell a dot fills, 0-1. */
  dot?: number;
  /** Letter pixels of space around the 5x7 box. */
  margin?: number;
  /** Opacity of the unlit dots, 0-1; 0 draws none. */
  ghost?: number;
  /** "ink" centres the lit dots; "line" centres the cap box, so tails hang below. */
  centre?: "ink" | "line";
};

export function LedInitial({
  label,
  size,
  className,
  style,
  title,
  pixel = 1,
  dot = 0.78,
  margin = 2,
  ghost = 0.12,
  centre = "ink",
}: {
  label: string | null | undefined;
  size: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
} & LedBoard) {
  const letter = avatarInitials(label).charAt(0);
  const glyph = ledGlyph(letter);
  if (!glyph) {
    return <InitialsAvatar label={label} shape="circle" size={size} className={className} style={style} title={title} />;
  }
  const k = Math.max(1, Math.round(pixel));
  const cells = 7 + 2 * Math.max(0, Math.round(margin)); // letter pixels across the board
  const n = cells * k; // dots across
  const pitch = size / (n + 0.5);
  const side = pitch * dot;
  const offset = (size - n * pitch) / 2;
  const middle = size / 2;
  const reach = size / 2 - pitch * 0.35;
  const [top, bottom] = centre === "ink" ? inkRows(glyph) : [0, 6];
  const x0 = ((cells - 5) / 2) * k;
  const y0 = Math.round((n - (bottom - top + 1) * k) / 2) - top * k;
  const dots = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cx = offset + (x + 0.5) * pitch;
      const cy = offset + (y + 0.5) * pitch;
      if (Math.hypot(cx - middle, cy - middle) > reach) continue; // only the dots inside the circle
      const on = x >= x0 && y >= y0 && glyph[Math.floor((y - y0) / k)]?.[Math.floor((x - x0) / k)] === "1";
      if (!on && ghost <= 0) continue;
      dots.push(
        <rect
          key={`${x},${y}`}
          x={cx - side / 2}
          y={cy - side / 2}
          width={side}
          height={side}
          opacity={on ? undefined : ghost}
        />,
      );
    }
  }
  return (
    <span
      className={`scout-led-initial${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, ...style }}
      title={title ?? label ?? undefined}
      role="img"
      aria-label={title ?? label ?? letter}
    >
      <svg className="scout-led-board" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {dots}
      </svg>
    </span>
  );
}
