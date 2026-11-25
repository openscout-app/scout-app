import { ChestArt } from "./chest-art.tsx";
import type { ChestNumberProps } from "./chest-number-model.ts";
import "./chest-number.css";

/**
 * A figure's roster code on its chest (chest-number-model.ts), on crew art
 * and the sprite: the 3×5 numerals of chest-art.tsx, in the figure's own
 * ink, at its chest. Nothing where the figure is too small for it to read:
 * the label under the figure carries the code. The LED tile draws its code
 * in its own canvas (LedFigure).
 */
export function ChestNumber(props: ChestNumberProps) {
  if (!props.code || props.form === "led") return null;
  return <ChestArt {...props} />;
}
