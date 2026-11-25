import { CURATED_HUES, makeRng } from "../lib/agent-identity.ts";

/**
 * ProjectMark: the "made" rung of the project icon ladder
 * (design/studio/views/project-harness-marks.tsx, Board). Two letters spelled
 * from the project name on an airport-style dot board, in the project's own
 * hue. Projects own the hue; a harness never does.
 *
 * Found and set icons (repo icon, operator choice) arrive with discovery; until
 * then every project wears its board.
 */

/** The project's hue: own RNG stream, so a project and an agent with the same
 *  name never share a draw. */
export function projectHue(name: string): number {
  const rng = makeRng(`project:${name}`);
  return CURATED_HUES[Math.floor(rng.next() * CURATED_HUES.length)]!;
}

/** 5×7: the face from the v3 feed identity study, used from 24px up. */
export const FACE_5x7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

/** 3×5: the small-board face, used below 24px so both letters still fit. */
const FACE_3x5: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"], D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"], J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["110", "101", "101", "101", "101"],
  O: ["010", "101", "101", "101", "010"], P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "110", "011"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"], V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "110"],
};

/** The dash between a call sign's code and number when it sits on one line. */
const DASH_3x5 = ["000", "000", "111", "000", "000"];

/**
 * A session's call sign on the small board (call-signs.ts): stacked, the
 * project's three letters over the session's number, for a row two lines tall;
 * on one line, OPN-042, where a row is one line and wide. Same face, hue and
 * tile as ProjectMark, `pitch` px from dot to dot.
 */
export function CallSignMark({
  sign,
  name,
  stacked = true,
  pitch = 2,
  className,
}: {
  sign: string;
  /** The project, for the hue. */
  name: string;
  stacked?: boolean;
  pitch?: number;
  className?: string;
}) {
  const [code = "", num = ""] = sign.split("-");
  const lines = stacked ? [code, num] : [`${code}-${num}`];
  const cols = Math.max(...lines.map((l) => l.length * 4 - 1));
  const rows = lines.length * 6 - 1;
  const h = projectHue(name);
  const lit = new Set<string>();
  lines.forEach((line, li) => [...line].forEach((ch, gi) => {
    const glyph = ch === "-" ? DASH_3x5 : FACE_3x5[ch] ?? FACE_3x5["0"]!;
    glyph.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === "1") lit.add(`${gi * 4 + x},${li * 6 + y}`);
    }));
  }));
  // half a pitch of tile around the dots, a gap row between the lines left dark
  const width = (cols + 1) * pitch;
  const height = (rows + 1) * pitch;
  const r = pitch * 0.44;
  const dots = [];
  for (let y = 0; y < rows; y++) {
    if (y % 6 === 5) continue;
    for (let x = 0; x < cols; x++) {
      dots.push(
        <circle
          key={`${x},${y}`}
          cx={(x + 1) * pitch}
          cy={(y + 1) * pitch}
          r={r}
          fill={lit.has(`${x},${y}`) ? `oklch(0.84 0.13 ${h})` : `oklch(0.84 0.13 ${h} / 0.09)`}
        />,
      );
    }
  }
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ borderRadius: pitch * 1.5, background: `oklch(0.2 0.02 ${h})`, flex: "none" }}
      role="img"
      aria-label={sign}
    >
      {dots}
    </svg>
  );
}

/** Candidate letter pairs for a name, most natural first: word initials
 *  (fabric-ops → FO), then the first letter with each later consonant, then
 *  with each later vowel. Every candidate is spelled from the name. */
export function boardCandidates(name: string): string[] {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const flat = words.join("");
  const first = flat[0] ?? "?";
  const out: string[] = [];
  if (words.length > 1 && /^[A-Z0-9]/.test(words[1]!)) out.push(first + words[1]![0]);
  const rest = [...flat.slice(1)];
  for (const c of rest) if (!/[AEIOU]/.test(c)) out.push(first + c);
  for (const c of rest) if (/[AEIOU]/.test(c)) out.push(first + c);
  if (!out.length) out.push(first + first);
  return [...new Set(out)];
}

/** Assign pairs across the operator's projects in the order they were added:
 *  each takes its first candidate nobody holds yet. Adding a project never
 *  changes an older project's letters. */
export function ProjectMark({
  name,
  size = 26,
  letters,
  className,
}: {
  name: string;
  size?: number;
  /** Pair to spell; defaults to the most natural candidate for the name. */
  letters?: string;
  className?: string;
}) {
  const pair = letters ?? boardCandidates(name)[0]!;
  const h = projectHue(name);
  const small = size < 24;
  const face = small ? FACE_3x5 : FACE_5x7;
  const faces = [...pair].map((ch) => face[ch] ?? face["0"]!);
  const gw = small ? 3 : 5;
  const gh = small ? 5 : 7;
  const grid = small ? 9 : 13;
  const ox = Math.floor((grid - (gw * 2 + 1)) / 2);
  const oy = Math.floor((grid - gh) / 2);
  const pad = size * 0.1;
  const pitch = (size - pad * 2) / grid;
  const r = pitch * (small ? 0.44 : 0.42);
  const lit = new Set<string>();
  faces.forEach((rows, gi) => rows.forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === "1") lit.add(`${ox + gi * (gw + 1) + x},${oy + y}`);
  })));
  const dots = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const on = lit.has(`${x},${y}`);
      dots.push(
        <circle
          key={`${x},${y}`}
          cx={pad + (x + 0.5) * pitch}
          cy={pad + (y + 0.5) * pitch}
          r={r}
          fill={on ? `oklch(0.84 0.13 ${h})` : `oklch(0.84 0.13 ${h} / 0.09)`}
        />,
      );
    }
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ borderRadius: size * 0.24, background: `oklch(0.2 0.02 ${h})`, flex: "none" }}
      role="img"
      aria-label={name}
    >
      {dots}
    </svg>
  );
}
