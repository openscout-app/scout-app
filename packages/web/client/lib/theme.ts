import { readScoutBootstrapTheme } from "./runtime-config.ts";
import { matchCastSlug } from "./crew-registry.ts";
export type ScoutTheme = "dark" | "light";
export type ScoutThemePreference = "dark" | "light" | "system";
export type ScoutThemeTemplate = "hudson" | "editorial" | "drafting";
export type ScoutThemePalette = "scout" | "graphite" | "carbon" | "week" | "polar" | "solar" | "paper";
export type ScoutThemeContrast = "soft" | "balanced" | "strong";
export type ScoutThemeAccent = "theme" | "lime" | "cyan" | "violet" | "amber" | "emerald" | "blue";
export type ScoutShellStyle = "scout" | "slack";
/** Crew art, the generated sprite, the pixel chip, or Initials: the project's letters on a neutral tile (components/InitialsAvatar.tsx). */
export type ScoutAvatarStyle = "crew" | "sprite" | "chip" | "initials";
/**
 * How big avatars are drawn wherever the placement owns the box.
 *
 * A named tier rather than a pixel value: an avatar is not one box but a
 * ladder of them (rail pip, list row, inspector tile, graph node), and the
 * operator is expressing a density preference, not a measurement.
 */
export type ScoutAvatarSize = "compact" | "regular" | "large";
/**
 * Mixed: sans prose, mono labels, semibold titles. Mono: everything in mono at
 * 300, the quiet HUD variant. Sans: everything in sans with labels in their
 * written case, mono kept for code, terminals and diffs.
 */
export type ScoutThemeVoice = "mixed" | "mono" | "sans";
/** Flat panels, or HUD corner ticks with a faint scanline veil. */
export type ScoutThemeFinish = "flat" | "ticks";
/** Panels apart by the frame gap, or joined edge to edge on one shared hairline. */
export type ScoutThemePanels = "spaced" | "joined";
/**
 * The room between the panels and the page sheet's edge: Inset keeps Density's
 * unit, Flush runs the panels to the edge. The sheet keeps its corners.
 */
export type ScoutThemeEdges = "inset" | "flush";
/**
 * The look: Sharp (opaque stepped planes, square, thin type; styles/looks/sharp.css),
 * Classic (the palette's own surfaces and the template's corners), or Friendly
 * (regular-weight sans, sentence-case labels, roomier rows and soft elevation;
 * styles/looks/friendly.css).
 */
export type ScoutThemeLook = "sharp" | "classic" | "friendly";

/**
 * The backdrop set. Surfaces follow Frame › Page › Pane › Section: the Frame
 * is the chrome (sidebar, top row, status bar), the Page is the content area
 * behind the panes. A frame backdrop shows through the frame's pale tint
 * (frameBackdrop); a page backdrop shows faintly behind the panes
 * (pageBackdrop). Smooth is a soft cool wash; Custom ("Your own") is a soft
 * mesh between the operator's four corner colours (backdropColors). Panes
 * stay solid either way.
 */
export type ScoutBackdrop = "smooth" | "dusk" | "aurora" | "plain" | "custom";

/** The sidebar's part of the frame: "same" wears the frame backdrop, anything else its own. */
export type ScoutFrameSidebarBackdrop = "same" | ScoutBackdrop;

/**
 * What the page shows behind its panes. Solid (the default) is the theme's
 * ground, the look before page backdrops existed; the others draw a backdrop
 * from the set under a heavy veil of that ground, so panes and text on the
 * page keep their contrast. Plain is left out: on the page it is Solid.
 */
export type ScoutPageBackdrop = "solid" | Exclude<ScoutBackdrop, "plain">;

export type ScoutAgentCharacterIdentity = {
  id: string;
  name: string;
};

/**
 * Character choices are durable identity data. New choices are keyed by the
 * broker-owned agent id; the legacy name map is retained only long enough to
 * migrate a choice when exactly one known agent owns that display name.
 */
export type ScoutAgentCharacterAssignments = {
  byId: Record<string, string>;
  legacyByName: Record<string, string>;
};

export interface ScoutAppearanceDetails {
  shell: ScoutShellStyle;
  palette: ScoutThemePalette;
  contrast: ScoutThemeContrast;
  accent: ScoutThemeAccent;
  avatarStyle: ScoutAvatarStyle;
  avatarSize: ScoutAvatarSize;
  voice: ScoutThemeVoice;
  finish: ScoutThemeFinish;
  panels: ScoutThemePanels;
  edges: ScoutThemeEdges;
  look: ScoutThemeLook;
  /** The frame's backdrop: sidebar, top row and status bar. Stored before as `backdrop`. */
  frameBackdrop: ScoutBackdrop;
  /** The sidebar's part of the frame. Stored before as `sidebarBackdrop`. */
  frameSidebarBackdrop: ScoutFrameSidebarBackdrop;
  /** The page's backdrop, behind the panes. */
  pageBackdrop: ScoutPageBackdrop;
  /**
   * Your own's corners as "#rrggbb …": top left, top right, bottom left,
   * bottom right. Two or three colours (older saves) fill the rest by blending.
   */
  backdropColors: string;
  operatorCharacter: string;
  /** Per-agent cast assignments, keyed by durable agent identity. */
  agentCharacters: ScoutAgentCharacterAssignments;
}

export const SCOUT_THEME_STORAGE_KEY = "openscout.theme";
let appearanceStorageKey = SCOUT_THEME_STORAGE_KEY;

/**
 * Scout's default is the Sharp look: square (drafting), week, amber, soft, with
 * a flush frame: panels joined on one hairline, no inset from the sheet's edge,
 * and a flat finish. Ticks, spaced panels and the inset stay one setting away.
 */
export const SCOUT_DEFAULT_THEME_TEMPLATE: ScoutThemeTemplate = "drafting";
/** Slate, plum, sea and brass; the Mac app's ScoutBackdropColors.standard. */
export const SCOUT_DEFAULT_BACKDROP_COLORS = "#4f7fb0 #8a5fa0 #3d8a80 #b98545";

export const SCOUT_DEFAULT_APPEARANCE_DETAILS: ScoutAppearanceDetails = {
  shell: "scout",
  palette: "week",
  contrast: "soft",
  accent: "amber",
  avatarStyle: "chip",
  avatarSize: "regular",
  voice: "mixed",
  finish: "flat",
  panels: "joined",
  edges: "flush",
  look: "sharp",
  frameBackdrop: "plain",
  frameSidebarBackdrop: "same",
  pageBackdrop: "solid",
  backdropColors: SCOUT_DEFAULT_BACKDROP_COLORS,
  operatorCharacter: "milo",
  agentCharacters: { byId: {}, legacyByName: {} },
};
let appearanceTemplate: ScoutThemeTemplate = SCOUT_DEFAULT_THEME_TEMPLATE;
let appearanceDetails: ScoutAppearanceDetails = SCOUT_DEFAULT_APPEARANCE_DETAILS;
let appearanceUrlOverrides = true;
let appearancePinned: ReadonlyArray<keyof ScoutAppearanceDetails> = [];
let appearanceTemplatePinned = false;

export interface ScoutAppearanceScope {
  template?: ScoutThemeTemplate;
  details?: ScoutAppearanceDetails;
  /**
   * False ignores `?theme=`, `?accent=`, `?themeVars=` and the other appearance
   * query parameters, so a link cannot restyle the surface or block its saves.
   * Default true: local Scout and the native embeds rely on them.
   */
  urlOverrides?: boolean;
  /** Axes the surface offers no control for: always the default, whatever is stored. */
  pinned?: ReadonlyArray<keyof ScoutAppearanceDetails>;
  /** Keep the template at its default, whatever is stored. */
  pinTemplate?: boolean;
}

/** Select independent appearance storage and defaults before an entry point reads its theme. */
export function setScoutAppearanceStorageKey(
  storageKey = SCOUT_THEME_STORAGE_KEY,
  defaults: ScoutAppearanceScope = {},
): void {
  appearanceStorageKey = storageKey;
  appearanceTemplate = defaults.template ?? SCOUT_DEFAULT_THEME_TEMPLATE;
  appearanceDetails = defaults.details ?? SCOUT_DEFAULT_APPEARANCE_DETAILS;
  appearanceUrlOverrides = defaults.urlOverrides ?? true;
  appearancePinned = defaults.pinned ?? [];
  appearanceTemplatePinned = defaults.pinTemplate ?? false;
}

/** The storage key the current entry point keeps its appearance under. */
export function scoutAppearanceStorageKey(): string {
  return appearanceStorageKey;
}

/** The query string, or an empty one when this surface ignores appearance overrides. */
function appearanceQuery(): URLSearchParams {
  return new URLSearchParams(appearanceUrlOverrides ? window.location.search : "");
}

// The defaults before the Sharp look became Scout's default (10-15). A save
// from before the look axis that isn't the HUD preset fills its gaps from these.
const LEGACY_CLASSIC_DEFAULTS = {
  template: "hudson",
  palette: "graphite",
  contrast: "balanced",
  accent: "amber",
  avatarStyle: "crew",
  finish: "flat",
} as const satisfies Partial<ScoutAppearanceDetails> & { template: ScoutThemeTemplate };
// Every load saved the whole appearance, so an install from the emerald-default
// era (10-15 to 11-02) holds "emerald" whether or not anyone picked it. Saves
// now carry this marker; an unmarked emerald is the old default and falls
// through to the current one.
const ACCENT_DEFAULT_REVISION = 2;
const LEGACY_DEFAULT_ACCENT = "emerald";
// The same trap for the frame: until 11-14 the default was ticks, spaced panels
// and an inset edge, and every load saved them. A save without this marker that
// holds one of those values holds the old default, so it falls through to the
// flush frame. A save carrying the marker is a choice and is kept.
const FRAME_DEFAULT_REVISION = 1;
const LEGACY_DEFAULT_FRAME = { finish: "ticks", panels: "spaced", edges: "inset" } as const;
const LEGACY_APPEARANCE_KEYS = [
  "template", "palette", "contrast", "accent", "shell", "avatarStyle", "avatarSize", "voice", "finish",
] as const;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeAgentCharacterMap(
  value: Record<string, unknown> | null | undefined,
  normalizeKey: (key: string) => string,
): Record<string, string> {
  if (!value) return {};
  const out: Record<string, string> = {};
  for (const [key, slug] of Object.entries(value)) {
    const cleanKey = normalizeKey(key);
    const castSlug = typeof slug === "string" ? matchCastSlug(slug) : undefined;
    if (cleanKey && castSlug) out[cleanKey] = castSlug;
  }
  return out;
}

/**
 * Sanitizes both the current id-keyed shape and the original flat name-keyed
 * shape. Invalid cast slugs disappear rather than producing broken artwork.
 */
export function normalizeAgentCharacters(
  value: Record<string, unknown> | null | undefined,
): ScoutAgentCharacterAssignments {
  if (!value) return { byId: {}, legacyByName: {} };

  const nestedById = isUnknownRecord(value.byId) ? value.byId : null;
  const nestedLegacy = isUnknownRecord(value.legacyByName) ? value.legacyByName : null;
  if (nestedById || nestedLegacy) {
    return {
      byId: normalizeAgentCharacterMap(nestedById, (id) => id.trim()),
      legacyByName: normalizeAgentCharacterMap(
        nestedLegacy,
        (name) => name.trim().toLowerCase(),
      ),
    };
  }

  // v1 stored one flat map keyed by lowercased display name.
  return {
    byId: {},
    legacyByName: normalizeAgentCharacterMap(value, (name) => name.trim().toLowerCase()),
  };
}

function normalizedAgentName(name: string): string {
  return name.trim().toLowerCase();
}

export function migrateLegacyAgentCharacters(
  assignments: ScoutAgentCharacterAssignments,
  agents: readonly ScoutAgentCharacterIdentity[],
): ScoutAgentCharacterAssignments {
  const agentsByName = new Map<string, ScoutAgentCharacterIdentity[]>();
  for (const agent of agents) {
    const name = normalizedAgentName(agent.name);
    const id = agent.id.trim();
    if (!name || !id) continue;
    const matches = agentsByName.get(name) ?? [];
    matches.push({ id, name: agent.name });
    agentsByName.set(name, matches);
  }

  let changed = false;
  const byId = { ...assignments.byId };
  const legacyByName = { ...assignments.legacyByName };
  for (const [name, slug] of Object.entries(assignments.legacyByName)) {
    const matches = agentsByName.get(normalizedAgentName(name)) ?? [];
    if (matches.length !== 1) continue;
    const agentId = matches[0]?.id;
    if (!agentId) continue;
    if (!byId[agentId]) byId[agentId] = slug;
    delete legacyByName[name];
    changed = true;
  }

  return changed ? { byId, legacyByName } : assignments;
}

export function resolveAgentCharacterAssignment(
  assignments: ScoutAgentCharacterAssignments | null | undefined,
  identity: { id?: string | null; name: string },
  agents: readonly ScoutAgentCharacterIdentity[],
): string | undefined {
  if (!assignments) return undefined;
  const id = identity.id?.trim();
  if (id && assignments.byId[id]) return assignments.byId[id];

  const name = normalizedAgentName(identity.name);
  if (!name) return undefined;
  const matches = agents.filter((agent) => normalizedAgentName(agent.name) === name);
  if (matches.length !== 1) return undefined;
  const matchedId = matches[0]?.id.trim();
  if (id && matchedId !== id) return undefined;
  return (matchedId ? assignments.byId[matchedId] : undefined)
    ?? assignments.legacyByName[name];
}

export function normalizeScoutThemePreference(
  value: string | null | undefined,
): ScoutThemePreference | null {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }

  return null;
}

export function normalizeScoutThemeTemplate(
  value: string | null | undefined,
): ScoutThemeTemplate | null {
  if (value === "hudson" || value === "editorial" || value === "drafting") {
    return value;
  }

  return null;
}

export function normalizeScoutThemePalette(
  value: string | null | undefined,
): ScoutThemePalette | null {
  if (
    value === "scout" || value === "graphite" || value === "carbon" || value === "week"
    || value === "polar" || value === "solar" || value === "paper"
  ) {
    return value;
  }

  return null;
}

export function normalizeScoutThemeContrast(
  value: string | null | undefined,
): ScoutThemeContrast | null {
  if (value === "soft" || value === "balanced" || value === "strong") {
    return value;
  }

  return null;
}

export function normalizeScoutThemeAccent(
  value: string | null | undefined,
): ScoutThemeAccent | null {
  if (
    value === "theme" || value === "lime" || value === "cyan" || value === "violet"
    || value === "amber" || value === "emerald" || value === "blue"
  ) {
    return value;
  }

  return null;
}

export function normalizeScoutShellStyle(
  value: string | null | undefined,
): ScoutShellStyle | null {
  if (value === "scout" || value === "slack") {
    return value;
  }

  return null;
}

export function normalizeScoutAvatarStyle(
  value: string | null | undefined,
): ScoutAvatarStyle | null {
  if (value === "crew" || value === "sprite" || value === "chip" || value === "initials") {
    return value;
  }
  return null;
}

export function normalizeScoutAvatarSize(
  value: string | null | undefined,
): ScoutAvatarSize | null {
  if (value === "compact" || value === "regular" || value === "large") {
    return value;
  }
  return null;
}

export function normalizeScoutThemeVoice(value: string | null | undefined): ScoutThemeVoice | null {
  return value === "mixed" || value === "mono" || value === "sans" ? value : null;
}

export function normalizeScoutThemeFinish(value: string | null | undefined): ScoutThemeFinish | null {
  return value === "flat" || value === "ticks" ? value : null;
}

export function normalizeScoutThemePanels(value: string | null | undefined): ScoutThemePanels | null {
  return value === "spaced" || value === "joined" ? value : null;
}

export function normalizeScoutThemeEdges(value: string | null | undefined): ScoutThemeEdges | null {
  return value === "inset" || value === "flush" ? value : null;
}

export function normalizeScoutThemeLook(value: string | null | undefined): ScoutThemeLook | null {
  return value === "sharp" || value === "classic" || value === "friendly" ? value : null;
}

export function normalizeScoutBackdrop(value: string | null | undefined): ScoutBackdrop | null {
  return value === "smooth" || value === "dusk" || value === "aurora" || value === "plain" || value === "custom"
    ? value
    : null;
}

export function normalizeScoutFrameSidebarBackdrop(value: string | null | undefined): ScoutFrameSidebarBackdrop | null {
  return value === "same" ? "same" : normalizeScoutBackdrop(value);
}

export function normalizeScoutPageBackdrop(value: string | null | undefined): ScoutPageBackdrop | null {
  return value === "solid" || value === "smooth" || value === "dusk" || value === "aurora" || value === "custom"
    ? value
    : null;
}

/**
 * The stored frame backdrops under their current keys. Builds before the
 * Frame › Page vocabulary saved them as `backdrop` and `sidebarBackdrop`; those
 * are read when the new keys are absent, so nobody's saved choice is lost, and
 * the next write drops them (writeScoutAppearanceDetails).
 */
export function readStoredFrameBackdrops(parsed: {
  frameBackdrop?: unknown;
  frameSidebarBackdrop?: unknown;
  backdrop?: unknown;
  sidebarBackdrop?: unknown;
}): { frameBackdrop?: ScoutBackdrop; frameSidebarBackdrop?: ScoutFrameSidebarBackdrop } {
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    frameBackdrop: normalizeScoutBackdrop(text(parsed.frameBackdrop))
      ?? normalizeScoutBackdrop(text(parsed.backdrop))
      ?? undefined,
    frameSidebarBackdrop: normalizeScoutFrameSidebarBackdrop(text(parsed.frameSidebarBackdrop))
      ?? normalizeScoutFrameSidebarBackdrop(text(parsed.sidebarBackdrop))
      ?? undefined,
  };
}

/** Keys earlier builds stored that a write now replaces. */
const LEGACY_BACKDROP_STORAGE_KEYS = ["backdrop", "sidebarBackdrop"] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Two to four "#rrggbb" colours separated by spaces, or null. */
export function normalizeScoutBackdropColors(value: string | null | undefined): string | null {
  const parts = value?.trim().split(/\s+/) ?? [];
  return parts.length >= 2 && parts.length <= 4 && parts.every((part) => HEX_COLOR.test(part))
    ? parts.map((part) => part.toLowerCase()).join(" ")
    : null;
}

function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Your own's four corners: top left, top right, bottom left, bottom right.
 * The Mac app expands two and three colours the same way (ScoutBackdropColors).
 */
export function scoutBackdropCorners(value: string): [string, string, string, string] {
  const parts = (normalizeScoutBackdropColors(value) ?? SCOUT_DEFAULT_BACKDROP_COLORS).split(" ");
  if (parts.length === 2) {
    const [a, d] = parts as [string, string];
    return [a, mixHex(a, d, 0.35), mixHex(a, d, 0.65), d];
  }
  if (parts.length === 3) {
    const [a, b, c] = parts as [string, string, string];
    return [a, b, c, mixHex(b, c, 0.5)];
  }
  return parts as [string, string, string, string];
}

export function normalizeScoutAppearanceDetails(
  value: Partial<Record<keyof ScoutAppearanceDetails, string | Record<string, unknown>>> | null | undefined,
): ScoutAppearanceDetails {
  return {
    shell: normalizeScoutShellStyle(value?.shell as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.shell,
    palette: normalizeScoutThemePalette(value?.palette as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.palette,
    contrast: normalizeScoutThemeContrast(value?.contrast as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.contrast,
    accent: normalizeScoutThemeAccent(value?.accent as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.accent,
    avatarStyle: normalizeScoutAvatarStyle(value?.avatarStyle as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.avatarStyle,
    avatarSize: normalizeScoutAvatarSize(value?.avatarSize as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.avatarSize,
    voice: normalizeScoutThemeVoice(value?.voice as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.voice,
    finish: normalizeScoutThemeFinish(value?.finish as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.finish,
    panels: normalizeScoutThemePanels(value?.panels as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.panels,
    edges: normalizeScoutThemeEdges(value?.edges as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.edges,
    look: normalizeScoutThemeLook(value?.look as string | null | undefined) ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.look,
    frameBackdrop: normalizeScoutBackdrop(value?.frameBackdrop as string | null | undefined)
      ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.frameBackdrop,
    frameSidebarBackdrop: normalizeScoutFrameSidebarBackdrop(value?.frameSidebarBackdrop as string | null | undefined)
      ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.frameSidebarBackdrop,
    pageBackdrop: normalizeScoutPageBackdrop(value?.pageBackdrop as string | null | undefined)
      ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.pageBackdrop,
    backdropColors: normalizeScoutBackdropColors(value?.backdropColors as string | null | undefined)
      ?? SCOUT_DEFAULT_APPEARANCE_DETAILS.backdropColors,
    operatorCharacter: (value?.operatorCharacter as string | null | undefined)?.trim() || SCOUT_DEFAULT_APPEARANCE_DETAILS.operatorCharacter,
    agentCharacters: normalizeAgentCharacters(value?.agentCharacters as Record<string, unknown> | null | undefined),
  };
}

export function readStoredAppearance(): {
  theme?: ScoutThemePreference;
  template?: ScoutThemeTemplate;
  palette?: ScoutThemePalette;
  contrast?: ScoutThemeContrast;
  accent?: ScoutThemeAccent;
  shell?: ScoutShellStyle;
  avatarStyle?: ScoutAvatarStyle;
  avatarSize?: ScoutAvatarSize;
  voice?: ScoutThemeVoice;
  finish?: ScoutThemeFinish;
  panels?: ScoutThemePanels;
  edges?: ScoutThemeEdges;
  look?: ScoutThemeLook;
  frameBackdrop?: ScoutBackdrop;
  frameSidebarBackdrop?: ScoutFrameSidebarBackdrop;
  pageBackdrop?: ScoutPageBackdrop;
  backdropColors?: string;
  operatorCharacter?: string;
  agentCharacters?: ScoutAgentCharacterAssignments;
} {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(appearanceStorageKey) || "{}") as {
      theme?: string;
      template?: string;
      palette?: string;
      contrast?: string;
      accent?: string;
      accentDefault?: number;
      shell?: string;
      avatarStyle?: string;
      avatarSize?: string;
      voice?: string;
      finish?: string;
      panels?: string;
      edges?: string;
      look?: string;
      frameBackdrop?: string;
      frameSidebarBackdrop?: string;
      pageBackdrop?: string;
      /** Before the Frame › Page vocabulary: the frame backdrop. */
      backdrop?: string;
      /** Before the Frame › Page vocabulary: the frame's sidebar backdrop. */
      sidebarBackdrop?: string;
      backdropColors?: string;
      operatorCharacter?: string;
      agentCharacters?: Record<string, unknown>;
      frameDefault?: number;
    };
    // Saved before the look axis: the HUD preset (ticks) reads as Sharp; any
    // other saved mix stays Classic and keeps the defaults it was saved under.
    const legacy = !parsed.look && LEGACY_APPEARANCE_KEYS.some((key) => parsed[key] !== undefined);
    const legacyClassic = legacy && parsed.finish !== "ticks";
    const was = legacyClassic ? LEGACY_CLASSIC_DEFAULTS : undefined;
    const savedAccent = parsed.accentDefault !== ACCENT_DEFAULT_REVISION
      && parsed.accent === LEGACY_DEFAULT_ACCENT
      ? undefined
      : parsed.accent;
    const oldFrame = parsed.frameDefault !== FRAME_DEFAULT_REVISION;
    const savedFrame = (key: keyof typeof LEGACY_DEFAULT_FRAME): string | undefined =>
      oldFrame && parsed[key] === LEGACY_DEFAULT_FRAME[key] ? undefined : parsed[key];
    return {
      theme: normalizeScoutThemePreference(parsed.theme) ?? undefined,
      template: normalizeScoutThemeTemplate(parsed.template) ?? was?.template,
      palette: normalizeScoutThemePalette(parsed.palette) ?? was?.palette,
      contrast: normalizeScoutThemeContrast(parsed.contrast) ?? was?.contrast,
      accent: normalizeScoutThemeAccent(savedAccent) ?? was?.accent,
      shell: normalizeScoutShellStyle(parsed.shell) ?? undefined,
      avatarStyle: normalizeScoutAvatarStyle(parsed.avatarStyle) ?? was?.avatarStyle,
      avatarSize: normalizeScoutAvatarSize(parsed.avatarSize) ?? undefined,
      voice: normalizeScoutThemeVoice(parsed.voice) ?? undefined,
      finish: normalizeScoutThemeFinish(savedFrame("finish")) ?? was?.finish,
      panels: normalizeScoutThemePanels(savedFrame("panels")) ?? undefined,
      edges: normalizeScoutThemeEdges(savedFrame("edges")) ?? undefined,
      look: normalizeScoutThemeLook(parsed.look)
        ?? (legacy ? (legacyClassic ? "classic" : "sharp") : undefined),
      ...readStoredFrameBackdrops(parsed),
      pageBackdrop: normalizeScoutPageBackdrop(parsed.pageBackdrop) ?? undefined,
      backdropColors: normalizeScoutBackdropColors(parsed.backdropColors) ?? undefined,
      operatorCharacter: parsed.operatorCharacter?.trim() || undefined,
      agentCharacters: (() => {
        const normalized = normalizeAgentCharacters(parsed.agentCharacters);
        return Object.keys(normalized.byId).length > 0
          || Object.keys(normalized.legacyByName).length > 0
          ? normalized
          : undefined;
      })(),
    };
  } catch {
    return {};
  }
}


export function resolveScoutThemePreference(
  preference: ScoutThemePreference,
  prefersDark = typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true,
): ScoutTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function resolveScoutStartupTheme(): ScoutTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const queryTheme = normalizeScoutThemePreference(
    appearanceQuery().get("theme"),
  );
  if (queryTheme) {
    return resolveScoutThemePreference(queryTheme);
  }

  const storedTheme = readStoredAppearance().theme;
  if (storedTheme) {
    return resolveScoutThemePreference(storedTheme);
  }

  const bootstrapTheme = normalizeScoutThemePreference(readScoutBootstrapTheme());
  if (bootstrapTheme) {
    return resolveScoutThemePreference(bootstrapTheme);
  }

  // No stated preference anywhere: follow the OS rather than forcing dark.
  // localStorage is per-origin and the bootstrap theme rides on /api/bootstrap.js,
  // so a first visit over an mDNS host (scout.local) has neither — and used to
  // land dark next to a light-mode desktop.
  return resolveScoutThemePreference("system");
}

export function resolveScoutStartupTemplate(): ScoutThemeTemplate {
  if (typeof window === "undefined") return appearanceTemplate;
  const queryTemplate = normalizeScoutThemeTemplate(
    appearanceQuery().get("template"),
  );
  if (appearanceTemplatePinned) return appearanceTemplate;
  return queryTemplate
    ?? readStoredAppearance().template
    ?? appearanceTemplate;
}

export function resolveScoutStartupAppearanceDetails(): ScoutAppearanceDetails {
  if (typeof window === "undefined") return appearanceDetails;
  const query = appearanceQuery();
  const stored = readStoredAppearance();
  const resolved = normalizeScoutAppearanceDetails({
    shell: normalizeScoutShellStyle(query.get("shell")) ?? stored.shell ?? appearanceDetails.shell,
    palette: normalizeScoutThemePalette(query.get("palette")) ?? stored.palette ?? appearanceDetails.palette,
    contrast: normalizeScoutThemeContrast(query.get("contrast")) ?? stored.contrast ?? appearanceDetails.contrast,
    accent: normalizeScoutThemeAccent(query.get("accent")) ?? stored.accent ?? appearanceDetails.accent,
    avatarStyle: normalizeScoutAvatarStyle(query.get("avatarStyle")) ?? stored.avatarStyle ?? appearanceDetails.avatarStyle,
    avatarSize: normalizeScoutAvatarSize(query.get("avatarSize")) ?? stored.avatarSize ?? appearanceDetails.avatarSize,
    voice: normalizeScoutThemeVoice(query.get("voice")) ?? stored.voice ?? appearanceDetails.voice,
    finish: normalizeScoutThemeFinish(query.get("finish")) ?? stored.finish ?? appearanceDetails.finish,
    panels: normalizeScoutThemePanels(query.get("panels")) ?? stored.panels ?? appearanceDetails.panels,
    edges: normalizeScoutThemeEdges(query.get("edges")) ?? stored.edges ?? appearanceDetails.edges,
    look: normalizeScoutThemeLook(query.get("look")) ?? stored.look ?? appearanceDetails.look,
    frameBackdrop: stored.frameBackdrop ?? appearanceDetails.frameBackdrop,
    frameSidebarBackdrop: stored.frameSidebarBackdrop ?? appearanceDetails.frameSidebarBackdrop,
    pageBackdrop: stored.pageBackdrop ?? appearanceDetails.pageBackdrop,
    backdropColors: stored.backdropColors ?? appearanceDetails.backdropColors,
    operatorCharacter: query.get("operatorCharacter")?.trim() || stored.operatorCharacter || appearanceDetails.operatorCharacter,
    agentCharacters: stored.agentCharacters ?? appearanceDetails.agentCharacters,
  });
  if (!appearancePinned.length) return resolved;
  const pinned: Record<string, unknown> = { ...resolved };
  for (const key of appearancePinned) pinned[key] = appearanceDetails[key];
  return pinned as unknown as ScoutAppearanceDetails;
}

function hasAppearanceUrlOverride(): boolean {
  if (typeof window === "undefined") return false;
  const query = appearanceQuery();
  return Boolean(
    normalizeScoutThemePalette(query.get("palette"))
    || normalizeScoutThemeContrast(query.get("contrast"))
    || normalizeScoutThemeAccent(query.get("accent"))
    || normalizeScoutShellStyle(query.get("shell"))
    || normalizeScoutThemeLook(query.get("look"))
    || normalizeScoutThemePanels(query.get("panels"))
    || normalizeScoutThemeEdges(query.get("edges")),
  );
}

export function writeScoutAppearanceDetails(details: ScoutAppearanceDetails): void {
  if (typeof window === "undefined" || hasAppearanceUrlOverride()) return;
  try {
    const raw = window.localStorage.getItem(appearanceStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const existing: Record<string, unknown> = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
    // The frame backdrops are written under their new keys; the old ones go.
    for (const key of LEGACY_BACKDROP_STORAGE_KEYS) delete existing[key];
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify({
      ...existing,
      ...details,
      accentDefault: ACCENT_DEFAULT_REVISION,
      frameDefault: FRAME_DEFAULT_REVISION,
    }));
  } catch {
    // Appearance remains active in memory when device storage is unavailable.
  }
}

/**
 * Record the viewer's stated light/dark preference.
 *
 * The stored appearance is one blob shared with `writeScoutAppearanceDetails`,
 * so this merges into it rather than replacing it. A `?theme=` in the URL
 * outranks storage in `resolveScoutStartupTheme`, and writing underneath one
 * would put the viewer's choice somewhere they cannot see it take effect.
 */
export function writeScoutThemePreference(preference: ScoutThemePreference): void {
  if (typeof window === "undefined") return;
  if (normalizeScoutThemePreference(appearanceQuery().get("theme"))) return;
  try {
    const raw = window.localStorage.getItem(appearanceStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const existing = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify({
      ...existing,
      theme: preference,
    }));
  } catch {
    // The choice stays active in memory when device storage is unavailable.
  }
}

/** The preference as stated, before the OS gets a say. */
export function resolveScoutStartupThemePreference(): ScoutThemePreference {
  if (typeof window === "undefined") return "system";
  const queryTheme = normalizeScoutThemePreference(
    appearanceQuery().get("theme"),
  );
  if (queryTheme) return queryTheme;
  return readStoredAppearance().theme ?? "system";
}

export function applyScoutThemeToDocument(
  theme: ScoutTheme,
  template: string = resolveScoutStartupTemplate(),
  details: ScoutAppearanceDetails = resolveScoutStartupAppearanceDetails(),
): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.scoutTheme = theme;
  document.documentElement.dataset.scoutThemeMode = theme;
  document.documentElement.dataset.scoutPalette = details.palette;
  document.documentElement.dataset.scoutContrast = details.contrast;
  document.documentElement.dataset.scoutAccent = details.accent;
  document.documentElement.dataset.scoutShell = details.shell;
  document.documentElement.dataset.scoutAvatarStyle = details.avatarStyle;
  document.documentElement.dataset.scoutAvatarSize = details.avatarSize;
  document.documentElement.dataset.scoutVoice = details.voice;
  // Ticks are square marks: on Rounded corners they fight the curve, so the
  // page draws Flat there and the stored choice comes back with square corners.
  document.documentElement.dataset.scoutFinish = template === "hudson" ? "flat" : details.finish;
  document.documentElement.dataset.scoutPanels = details.panels;
  document.documentElement.dataset.scoutEdges = details.edges;
  document.documentElement.dataset.scoutLook = details.look;
  document.documentElement.dataset.scoutFrameBackdrop = details.frameBackdrop;
  document.documentElement.dataset.scoutFrameSidebarBackdrop = details.frameSidebarBackdrop;
  document.documentElement.dataset.scoutPageBackdrop = details.pageBackdrop;
  scoutBackdropCorners(details.backdropColors).forEach((color, index) => {
    document.documentElement.style.setProperty(`--scout-backdrop-c${index + 1}`, color);
  });
  document.documentElement.dataset.hudsonTheme = theme;
  document.documentElement.dataset.hudsonTemplate = template;
  document.documentElement.style.colorScheme = theme;
}

/**
 * Native theme bridge. The macOS app hosts the embed routes in a `WKWebView`
 * and passes its *resolved* palette via `?themeVars=<base64url(JSON)>` so the
 * embed renders with the app's actual surfaces / accent / status colors
 * instead of the generic web light/dark. The map is keyed by `--hud-*` CSS
 * variable names; the Provider layers it over `LIGHT_THEME_VARS` /
 * `DARK_THEME_VARS`. Returns null when absent or malformed (web-standalone).
 */
export function resolveScoutNativeThemeVars(): Record<`--${string}`, string> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = appearanceQuery().get("themeVars");
  if (!raw) {
    return null;
  }

  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.startsWith("--") && typeof value === "string") {
        vars[key] = value;
      }
    }
    return Object.keys(vars).length > 0
      ? (vars as Record<`--${string}`, string>)
      : null;
  } catch {
    return null;
  }
}

/** The host values the Sharp look rebuilds its planes and tones on. */
const SCOUT_HOST_PALETTE_KEYS = ["--hud-bg", "--hud-surface", "--hud-ink", "--hud-muted", "--hud-dim"] as const;

/**
 * Whether a native host's palette can carry the look's ladder: true when every
 * value the ladder reads arrived. The element holding the host vars then takes
 * `data-scout-host-palette`, and styles/looks/sharp.css takes its ground,
 * planes and tones from the host's colours instead of its own. Without one of
 * them the look's `--hud-*` and the ladder would point at each other, so a
 * partial map keeps the look's own planes.
 */
export function hasScoutHostPalette(vars: Record<string, string> | null | undefined): boolean {
  return !!vars && SCOUT_HOST_PALETTE_KEYS.every((key) => Boolean(vars[key]));
}
