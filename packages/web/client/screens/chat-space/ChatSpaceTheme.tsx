/**
 * Theme host for the standalone chat surfaces.
 *
 * `/chat` and `/invite/<token>` deliberately do not mount the operator shell
 * or `ScoutProvider` — a teammate's member cookie cannot make the operator
 * API calls that provider fires, and an invitation page must render before any
 * of them. But the surface must still be the same Scout: the `[data-scout-theme]`
 * alias layer in `app.css` maps `--bg` and friends onto the `--hud-*` tokens,
 * and this element carries that attribute. That is all this component is.
 *
 * Nothing here hard-codes a color, and nothing here pins one either. The
 * palette (`--hud-bg`, `--hud-ink`, `--hud-border` …) is resolved by HudsonKit,
 * appearance.css and the active look from the appearance attributes, the same
 * two nested scopes `ScoutProvider` renders, for the same reasons:
 *
 * - The outer element carries the raw palette input and the appearance
 *   attributes, so HudsonKit resolves `--hud-*` there. It cannot be `<html>`:
 *   HudsonKit's bundle ends with a dark `:root` default that ties the template
 *   rule on specificity and wins on source order, so light mode would stay dark.
 * - The inner element carries `data-scout-theme`, the alias layer. On one
 *   element HudsonKit's raw triplets would outrank the aliases.
 *
 * The outer element inlines only what the Provider inlines —
 * `scoutThemeAugmentVars`, the map minus the Hudson-managed keys — because an
 * inline palette value would beat the chosen palette and the Sharp look's
 * planes, and chat would drift from the rest of the app.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { scoutThemeAugmentVars } from "../../lib/theme-vars.ts";
import {
  applyScoutThemeToDocument,
  hasScoutHostPalette,
  resolveScoutNativeThemeVars,
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
  resolveScoutStartupThemePreference,
  resolveScoutThemePreference,
  writeScoutThemePreference,
  scoutAppearanceStorageKey,
  type ScoutTheme,
  type ScoutThemePreference,
} from "../../lib/theme.ts";

import "./chat-space.css";
// After chat-space.css on purpose: the Slack place's rules win its ties.
import "./slack-place.css";

export interface ScoutStandaloneAppearance {
  /** What is on screen right now. */
  theme: ScoutTheme;
  /** What the viewer asked for, which may be "system". */
  preference: ScoutThemePreference;
  setPreference: (next: ScoutThemePreference) => void;
}

export function useScoutStandaloneAppearance(): ScoutStandaloneAppearance {
  const [preference, setStatedPreference] = useState<ScoutThemePreference>(
    () => resolveScoutStartupThemePreference(),
  );
  const [theme, setTheme] = useState<ScoutTheme>(() => resolveScoutStartupTheme());

  useEffect(() => {
    applyScoutThemeToDocument(
      theme,
      resolveScoutStartupTemplate(),
      resolveScoutStartupAppearanceDetails(),
    );
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setTheme(resolveScoutThemePreference(preference));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  // Another tab of the same surface changed the stored theme: follow it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== scoutAppearanceStorageKey()) return;
      const stated = resolveScoutStartupThemePreference();
      setStatedPreference(stated);
      setTheme(resolveScoutThemePreference(stated));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: ScoutThemePreference) => {
    writeScoutThemePreference(next);
    setStatedPreference(next);
    setTheme(resolveScoutThemePreference(next));
  }, []);

  return { theme, preference, setPreference };
}

export function useScoutStandaloneTheme(): ScoutTheme {
  return useScoutStandaloneAppearance().theme;
}

/**
 * Fired on `window` after a surface writes new appearance details, so a
 * mounted theme host re-reads them without a reload. Local Scout never fires
 * it; the Hosted Chat appearance controls do.
 */
export const SCOUT_APPEARANCE_CHANGE_EVENT = "openscout:appearance-change";

function useLiveAppearanceDetails() {
  const [details, setDetails] = useState(() => resolveScoutStartupAppearanceDetails());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setDetails(resolveScoutStartupAppearanceDetails());
    const onStorage = (event: StorageEvent) => {
      if (event.key === scoutAppearanceStorageKey()) onChange();
    };
    window.addEventListener(SCOUT_APPEARANCE_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SCOUT_APPEARANCE_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return details;
}

export function ChatSpaceTheme({
  theme,
  className,
  compactView,
  railed,
  source,
  style: extraStyle,
  children,
}: {
  theme: ScoutTheme;
  className: string;
  source?: "scout" | "slack";
  /** Drives the compact single-pane stack in CSS; ignored above 900px. */
  compactView?: "list" | "channel" | "panel";
  /**
   * Collapsed sidebar. It is stamped here rather than on the body because the
   * topbar is the sidebar's header band and has to measure itself against the
   * same `--sidebar-w` the grid below uses.
   */
  railed?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // A native host (WKWebView) passes its resolved palette on the query string;
  // it layers over the web defaults exactly as it does for the embed surfaces.
  const nativeVars = useMemo(() => resolveScoutNativeThemeVars(), []);
  const template = useMemo(() => resolveScoutStartupTemplate(), []);
  const details = useLiveAppearanceDetails();
  const paletteStyle = useMemo(
    () => ({
      ...scoutThemeAugmentVars(theme),
      ...(nativeVars ?? {}),
      display: "contents",
    }) as CSSProperties,
    [theme, nativeVars],
  );
  return (
    <div
      data-scout-theme-mode={theme}
      data-scout-palette={details.palette}
      data-scout-contrast={details.contrast}
      data-scout-accent={details.accent}
      data-scout-shell={details.shell}
      data-scout-avatar-style={details.avatarStyle}
      data-scout-look={details.look}
      data-hudson-theme={theme}
      data-hudson-template={template}
      data-scout-host-palette={hasScoutHostPalette(nativeVars) ? "" : undefined}
      style={paletteStyle}
    >
      <div
        className={className}
        data-scout-theme={theme}
        data-chat-source={source}
        {...(compactView ? { "data-compact-view": compactView } : {})}
        {...(railed ? { "data-rail": "true" } : {})}
        style={extraStyle}
      >
        {children}
      </div>
    </div>
  );
}
