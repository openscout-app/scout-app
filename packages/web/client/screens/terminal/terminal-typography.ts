import { SCOUT_FONT_MONO_FACES } from "../../lib/theme-vars.ts";

// The app's own mono stack, so a browser without SF Mono picks the same face
// for the terminal as for the rest of the app. Nerd Fonts follow only for the
// glyphs those faces lack, such as prompt symbols. An explicit
// terminalFontFamily is always placed ahead of this stack.
export const DEFAULT_TERMINAL_FONT_FAMILY = `${SCOUT_FONT_MONO_FACES}, 'JetBrainsMono Nerd Font', 'JetBrainsMonoNL Nerd Font', 'MesloLGS Nerd Font Mono', 'Hack Nerd Font Mono', monospace`;

// The default face is set light, like the rest of the app. Bold cells keep the
// renderer's own bold weight.
export const DEFAULT_TERMINAL_FONT_WEIGHT = 300;

// Light strokes thin out below 11px, so a light weight holds at regular there,
// as the app's micro mono and Scout's native text do.
export const LIGHT_MINIMUM_FONT_SIZE = 11;

function legibleWeight(weight: number | undefined, fontSize: number): number | undefined {
  return weight !== undefined && weight < 400 && fontSize < LIGHT_MINIMUM_FONT_SIZE ? 400 : weight;
}

export type TerminalTypography = {
  fontFamily: string;
  fontSize: number;
  /** Undefined keeps the renderer's normal weight. */
  fontWeight?: number;
};

// A requested weight is honored only as a whole hundred from 100 to 900.
function terminalFontWeight(value: string | null): number | undefined {
  if (value === null || !/^[1-9]00$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/**
 * Resolve the terminal face from `terminalFontFamily` / `terminalFontSize` /
 * `terminalFontWeight` query parameters. Without a family the default stack is
 * set light. A host that forwards its own default family says so with
 * `terminalFontWeight`; an explicit family without one renders at the
 * renderer's normal weight, as before.
 */
export function resolveTerminalTypography(search: string): TerminalTypography {
  const params = new URLSearchParams(search);
  const configuredFamily = params.get("terminalFontFamily")?.trim();
  const configuredSize = Number(params.get("terminalFontSize"));
  const configuredWeight = terminalFontWeight(params.get("terminalFontWeight"));
  const fontSize = Number.isFinite(configuredSize) && configuredSize >= 9 && configuredSize <= 32
    ? configuredSize
    : 13;
  if (configuredFamily) {
    const fontWeight = legibleWeight(configuredWeight, fontSize);
    return {
      fontFamily: `'${configuredFamily.replaceAll("'", "\\'")}', ${DEFAULT_TERMINAL_FONT_FAMILY}`,
      fontSize,
      ...(fontWeight !== undefined ? { fontWeight } : {}),
    };
  }
  return {
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize,
    fontWeight: legibleWeight(configuredWeight ?? DEFAULT_TERMINAL_FONT_WEIGHT, fontSize),
  };
}
