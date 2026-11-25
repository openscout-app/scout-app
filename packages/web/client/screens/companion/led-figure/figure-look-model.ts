/**
 * How companion figures look. The default is an LED tile with the agent's
 * initials; the operator can switch to the name (streaming through the tile
 * when it does not fit) or back to the crew character. Operator chrome, so it
 * lives in this page's storage, never in the broker.
 */
export type FigureLook = "led-initials" | "led-name" | "character";

export const FIGURE_LOOKS: readonly FigureLook[] = ["led-initials", "led-name", "character"];
export const DEFAULT_FIGURE_LOOK: FigureLook = "led-initials";
export const FIGURE_LOOK_LABEL: Record<FigureLook, string> = {
  "led-initials": "Show as LED initials",
  "led-name": "Show as LED name",
  character: "Show as character",
};

export function parseFigureLook(value: unknown): FigureLook {
  return FIGURE_LOOKS.includes(value as FigureLook) ? value as FigureLook : DEFAULT_FIGURE_LOOK;
}

/** An LED figure's dot spacing at a figure size. */
export function ledPitch(size: number): number {
  return Math.max(1.25, size / 12);
}
