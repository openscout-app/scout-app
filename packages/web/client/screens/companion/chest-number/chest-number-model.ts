import type { PoseName } from "../../../lib/crew-registry.ts";

/*
 * The number on a figure's chest: its number in the runtime's roster ("003", figure-labels.ts),
 * drawn on the figure itself so a figure on the desk says which agent it is.
 * Quiet, in the figure's own ink. Where the figure is too small for it to
 * read, the label under the figure carries the code alone.
 *
 * This file is the contract the art fills: which forms carry a number and
 * the smallest size each reads at. The numerals and their placement on each
 * form (a crew member's plain chest panel, the sprite's lit cells) are
 * chest-art.tsx; ChestNumber.tsx draws them on crew art and the sprite,
 * LedFigure in the LED tile's own canvas.
 */

/** The figure forms a chest number sits on: the LED tile, a crew member's art, the generated sprite. */
export type ChestForm = "led" | "crew" | "sprite";

export type ChestNumberProps = {
  /** The roster code, three digits ("003"). */
  code: string;
  form: ChestForm;
  /** The figure's size, as the desk draws it (16, 24, 32, 48 or 64; 24 by default). */
  size: number;
  /** The figure body's width at that size, in px (the body box is `width` × `size`). */
  width: number;
  /** A crew member: its slug, for its art and its chest anchor. */
  slug?: string;
  /** The crew pose drawn now. */
  pose?: PoseName | "rest";
};

/**
 * The smallest figure size, per form, at which the chest number reads
 * (chest-art.tsx). Below it, the label under the figure carries the code.
 * The LED band from 48; a crew member's chest panel and the sprite's
 * one-digit-per-cell from 64. A crew member with no plain panel draws none
 * at any size (chest-art.tsx).
 */
export const CHEST_MIN_SIZE: Readonly<Record<ChestForm, number>> = { led: 48, crew: 64, sprite: 64 };

/** Whether this figure carries its number on its chest. Crew art only in its rest pose: its other poses have no authored chest. */
export function chestNumberShows(form: ChestForm, size: number, pose: PoseName | "rest" = "rest"): boolean {
  if (size < CHEST_MIN_SIZE[form]) return false;
  return form !== "crew" || pose === "rest";
}

/** The generated sprite fills this share of the figure's size, standing at the bottom of the body. */
export const SPRITE_SHARE = 0.86;
