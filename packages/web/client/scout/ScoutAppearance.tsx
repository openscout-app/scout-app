import { useEffect, useMemo, type ReactNode } from "react";
import { useOptionalTheme } from "hudsonkit/theme";
import { scoutThemeAugmentVars } from "../lib/theme-vars.ts";
import {
  applyScoutThemeToDocument,
  hasScoutHostPalette,
  resolveScoutNativeThemeVars,
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
  type ScoutAppearanceDetails,
  type ScoutTheme,
} from "../lib/theme.ts";

export function ScoutAppearance({
  children,
  initialTheme = resolveScoutStartupTheme(),
  appearanceDetails = resolveScoutStartupAppearanceDetails(),
}: {
  children: ReactNode;
  initialTheme?: ScoutTheme;
  appearanceDetails?: ScoutAppearanceDetails;
}) {
  const hudsonTheme = useOptionalTheme();
  const nativeThemeVars = useMemo(() => resolveScoutNativeThemeVars(), []);
  const resolvedTheme = hudsonTheme?.resolvedTheme ?? initialTheme;
  const activeTemplate = hudsonTheme?.template ?? resolveScoutStartupTemplate();
  const themeVars = useMemo(
    () => ({
      ...scoutThemeAugmentVars(resolvedTheme),
      ...(nativeThemeVars ?? {}),
    }),
    [nativeThemeVars, resolvedTheme],
  );

  useEffect(() => {
    applyScoutThemeToDocument(resolvedTheme, activeTemplate, appearanceDetails);
  }, [activeTemplate, appearanceDetails, resolvedTheme]);

  return (
    <div
      data-scout-theme-mode={resolvedTheme}
      data-scout-palette={appearanceDetails.palette}
      data-scout-contrast={appearanceDetails.contrast}
      data-scout-accent={appearanceDetails.accent}
      data-scout-shell={appearanceDetails.shell}
      data-scout-avatar-style={appearanceDetails.avatarStyle}
      data-scout-look={appearanceDetails.look}
      data-hudson-theme={resolvedTheme}
      data-hudson-template={activeTemplate}
      data-scout-host-palette={hasScoutHostPalette(nativeThemeVars) ? "" : undefined}
      style={{ ...themeVars }}
    >
      <div data-scout-theme={resolvedTheme} style={{ display: "contents" }}>
        {children}
      </div>
    </div>
  );
}
