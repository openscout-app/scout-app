import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "scout-app.theme";

/** The saved preference. Storage can be absent or blocked; then the system decides. */
export function readThemePreference(): ThemePreference {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch { return "system"; }
}

function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, preference);
  } catch { /* the choice lasts for this page only */ }
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Follows the system scheme as it changes. */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(systemTheme);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return theme;
}

/** The app's theme: the operator's saved choice, else the system's. */
export function useThemePreference(): { theme: Theme; preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const system = useSystemTheme();
  const [preference, setState] = useState<ThemePreference>(readThemePreference);
  const setPreference = (next: ThemePreference) => { saveThemePreference(next); setState(next); };
  return { theme: preference === "system" ? system : preference, preference, setPreference };
}
