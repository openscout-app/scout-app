/**
 * The desktop companion's own runtime.
 *
 * The Mac app's companion panel loads `/companion.html`, not the app shell:
 * React, the companion screen, its host bridge and the broker stream — no
 * router, no `ScoutProvider`, no app stylesheet. `/embed/companion` stays as
 * the browser preview inside the full app.
 */

import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { companionEngaged, companionHostAvailable } from "../lib/companion-host.ts";
import { scoutThemeAugmentVars } from "../lib/theme-vars.ts";
import {
  SCOUT_THEME_STORAGE_KEY,
  applyScoutThemeToDocument,
  resolveScoutNativeThemeVars,
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
} from "../lib/theme.ts";
import { CompanionScreen } from "../screens/companion/CompanionScreen.tsx";
import { ArrivalsBoard } from "../screens/companion/arrivals/ArrivalsBoard.tsx";
import { hasAnyFigureDraft } from "../screens/companion/arrivals/FigureTalk.tsx";
import { quickTerminal } from "../screens/companion/arrivals/quick-terminal.ts";
import { SystemCorner } from "../screens/companion/system-corner/SystemCorner.tsx";
import { watchCompanionBuild } from "./companion-build.ts";
import "./runtime.css";

const theme = resolveScoutStartupTheme();
const startupTemplate = resolveScoutStartupTemplate();
const appearance = resolveScoutStartupAppearanceDetails();
applyScoutThemeToDocument(theme, startupTemplate, appearance);

/**
 * The look template (Settings › Look), followed live: the panel stays loaded
 * for the app's whole run, and the board's corners come from the template.
 */
function useLiveTemplate(): string {
  const [template, setTemplate] = useState(startupTemplate);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SCOUT_THEME_STORAGE_KEY) return;
      const next = resolveScoutStartupTemplate();
      applyScoutThemeToDocument(theme, next, appearance);
      setTemplate(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return template;
}

/**
 * Which corner surface to run. The default is the arrivals board (Studio
 * /studies/companion-looks-ii, picked 2026-10-14). The others stay one
 * switch away: `classic` is CompanionScreen (figures, LED looks), `system`
 * is round V (Studio /studies/companion-system). Chosen by `?corner=…` or
 * localStorage `scout:companion:corner`.
 */
type CornerVariant = "arrivals" | "system" | "classic";
function cornerVariant(params: URLSearchParams): CornerVariant {
  const known = (v: string | null): CornerVariant | null => (v === "system" || v === "arrivals" || v === "classic" ? v : null);
  const fromUrl = known(params.get("corner"));
  if (fromUrl) return fromUrl;
  try {
    return known(window.localStorage.getItem("scout:companion:corner")) ?? "arrivals";
  } catch {
    return "arrivals";
  }
}

/** `?name=1` or `?name=0` forces a flag for this page; otherwise the page's own settings say. */
function urlFlag(params: URLSearchParams, name: string): boolean | undefined {
  const value = params.get(name);
  return value === "1" ? true : value === "0" ? false : undefined;
}

/** The two theme scopes ScoutProvider draws, and nothing else it does. */
function CompanionRuntime() {
  const params = new URLSearchParams(window.location.search);
  const variant = cornerVariant(params);
  const template = useLiveTemplate();
  const style = useMemo(
    () => ({ ...scoutThemeAugmentVars(theme), ...(resolveScoutNativeThemeVars() ?? {}) }),
    [],
  );
  return (
    <div
      data-scout-theme-mode={theme}
      data-scout-palette={appearance.palette}
      data-scout-contrast={appearance.contrast}
      data-scout-accent={appearance.accent}
      data-scout-shell={appearance.shell}
      data-scout-avatar-style={appearance.avatarStyle}
      data-hudson-theme={theme}
      data-hudson-template={template}
      style={style}
    >
      <div data-scout-theme={theme} style={{ display: "contents" }}>
        {/* The same root classes the embed host stamps; companion.css keys off both. */}
        <div className="s-discovered-embed s-companion-embed" data-scout-surface="companion">
          {variant === "system" ? (
            <SystemCorner />
          ) : variant === "arrivals" ? (
            <ArrivalsBoard demo={params.get("demo") === "1"} blink={urlFlag(params, "blink")} />
          ) : (
            <CompanionScreen
              embedded
              navigate={() => {}}
              workIds={params.get("workIds")?.trim() || undefined}
              mode={params.get("mode")?.trim() || undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// In the host's panel, follow web refreshes: the panel outlives the build it loaded.
if (companionHostAvailable() && window.location.pathname === "/companion.html") {
  // A quick terminal open is busy too: a reload would drop you out of the pane mid-answer.
  watchCompanionBuild({ isBusy: () => companionEngaged() || hasAnyFigureDraft() || quickTerminal() !== null });
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <CompanionRuntime />
  </StrictMode>,
);
