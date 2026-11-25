import { CREW_ART } from "../../../lib/crew-registry.ts";
import { CHEST_MIN_SIZE, SPRITE_SHARE, type ChestForm, type ChestNumberProps } from "./chest-number-model.ts";

/** Single-cell strokes, open counters, no weight/glow or backing plaque. */
export const CHEST_DIGIT_ROWS = [
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "010", "010", "010"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
] as const;

export const CHEST_ART_ROWS = 5;
export const CHEST_ART_COLUMNS = 11;
/** The smallest size each form draws at: the model's cutoffs (CHEST_MIN_SIZE), checked by eye at 2x. */
export const CHEST_ART_MIN_SIZE: Readonly<Record<ChestForm, number>> = CHEST_MIN_SIZE;

/** Master-pixel rectangles [left, top, width, height], measured on rest art.
 * Null means NO sufficiently large, plain panel at desk sizes, not fallback
 * placement. Suits with a zipper/strap/box cannot accept an eleven-pixel mark
 * on either half without crossing equipment. Never use mean bust lightness
 * to infer the ink on a local suit panel. Lulu's panel is just under five
 * pixels tall at 64 (its art is 475 wide), so at desk sizes it draws none too.
 */
export const CREW_CHEST_PANELS: Readonly<Record<string, { box: readonly [number, number, number, number]; ink: string } | null>> = {
  milo: null, brik: null, sprout: null, wrench: null, vex: null,
  pip: null, tuck: null, fenn: null, nori: null,
  lulu: { box: [168, 394, 140, 40], ink: "#302e2b" },
};

/** Exactly three digits; never silently truncate or substitute a different identity. */
export function ledChestColumns(code: string): number[] {
  if (!/^[0-9]{3}$/.test(code)) return [];
  return [...code].flatMap((digit, i) => {
    const rows = CHEST_DIGIT_ROWS[Number(digit)]!;
    const columns = [0, 1, 2].map(x => rows.reduce((bits, row, y) => bits | (row[x] === "1" ? 1 << y : 0), 0));
    return i < 2 ? [...columns, 0] : columns;
  });
}
export const LED_CHEST_ROWS = CHEST_ART_ROWS;

/** LED canvas integration (both initials and name):
 * Keep the existing upper sign at its own pitch, with its usual 7 rows and
 * one-dot padding. Append this band's height to that canvas, NOT another tile.
 * Center the eleven columns horizontally. Bit 0 is the top dot. Draw circles
 * at (x + (col+.5)*pitch, y + (row+.5)*pitch), radius .32*pitch.
 * Use onInk below, the existing off ink, shadowBlur=0, alpha=1, no animation.
 * The band's blank first row separates it from the scrolling name. Never
 * scroll the code, flash it, or inherit the needs-state accent.
 * At size 24: original canvas 28x18, added band 7px, total 28x25.
 * To stay INSIDE the 30x24 body, use upperPitch=1.5 (upper height 13.5),
 * preserve the original 28px canvas width, then append 7px: total 20.5px.
 * upperColumns=floor(28/1.5)-2=16; the name can scroll in that wider window.
 */
export function ledChestLayout(size: number, canvasWidth: number) {
  const pitch = Math.max(1, size / 24);
  const upperPitch = Math.max(1.25, size / 16);
  const upperHeight = 9 * upperPitch;
  return {
    pitch,
    rows: LED_CHEST_ROWS,
    radius: 0.32 * pitch,
    x: (canvasWidth - CHEST_ART_COLUMNS * pitch) / 2,
    y: upperHeight + pitch,
    upperPitch,
    upperColumns: Math.max(7, Math.floor(canvasWidth / upperPitch) - 2),
    height: upperHeight + (LED_CHEST_ROWS + 2) * pitch,
    onInk: "#b8b5ad",
  };
}

/** Keep three plain lit body cells on row 4, below either possible eye row.
 * Each digit goes INSIDE ONE cell, not across the gaps between cells.
 * CompanionEdge already expands this exported rule into bodyCells.
 */
export const SPRITE_CHEST_CELLS = { row: 4, firstColumn: 2, lastColumn: 4 } as const;

/** Pixel boxes in BODY coordinates. At 64 the 55px sprite has 7.86px
 * cells: a 3x5 glyph fits inside the .07 gap and .20 rounded corner.
 * Centers snap to half CSS pixels for a sharp 2x display; never round each
 * stroke separately (which would distort the digit).
 */
export function spriteChestDigitBoxes(size: number, width: number) {
  if (size < CHEST_ART_MIN_SIZE.sprite || !Number.isFinite(size) || !Number.isFinite(width)) return [];
  const box = Math.round(size * SPRITE_SHARE);
  const pitch = box / 7;
  const snap = (n: number) => Math.round(n * 2) / 2;
  return [2, 3, 4].map(column => ({
    x: snap((width - box) / 2 + (column + 0.5) * pitch - 1.5),
    y: snap(size - box + 4.5 * pitch - 2.5),
    width: 3, height: 5,
  }));
}

/** No generic crew chest fallback, no bounding-box stamp on sprite gaps. */
export function ChestArt(props: ChestNumberProps) {
  const { code, form, size, width, pose = "rest" } = props;
  if (form === "led" || size < CHEST_ART_MIN_SIZE[form] || !Number.isFinite(size) || !Number.isFinite(width) || width <= 0 || !ledChestColumns(code).length) return null;
  let ink = "#171a20";
  let boxes: { x: number; y: number; width: number; height: number }[];
  if (form === "sprite") {
    boxes = spriteChestDigitBoxes(size, width);
  } else {
    if (pose !== "rest") return null;
    const slug = props.slug?.toLowerCase() ?? "";
    const panel = CREW_CHEST_PANELS[slug];
    const art = CREW_ART[slug];
    if (!panel || !art) return null;
    const k = Math.min(width / art.w, size / art.h);
    const [px, py, pw, ph] = panel.box;
    if (pw * k < 11 || ph * k < 5) return null;
    const left = Math.round(((width - art.w * k) / 2 + (px + pw / 2) * k - 5.5) * 2) / 2;
    const top = Math.round(((size - art.h * k) / 2 + (py + ph / 2) * k - 2.5) * 2) / 2;
    boxes = [0, 1, 2].map(i => ({ x: left + i * 4, y: top, width: 3, height: 5 }));
    ink = panel.ink;
  }
  return (
    <svg className="chest-no" aria-hidden="true" width={width} height={size}
      viewBox={`0 0 ${width} ${size}`} shapeRendering="crispEdges"
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "hidden", filter: "none" }}>
      {boxes.map((box, i) => <g key={i} transform={`translate(${box.x} ${box.y})`}>
        {CHEST_DIGIT_ROWS[Number(code[i])]!.flatMap((row, y) => [...row].map((bit, x) =>
          bit === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={ink} /> : null))}
      </g>)}
    </svg>
  );
}
