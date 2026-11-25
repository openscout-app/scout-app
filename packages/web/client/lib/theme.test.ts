import { describe, expect, test } from "bun:test";
import {
  SCOUT_THEME_STORAGE_KEY,
  hasScoutHostPalette,
  migrateLegacyAgentCharacters,
  normalizeScoutAppearanceDetails,
  normalizeScoutFrameSidebarBackdrop,
  normalizeScoutPageBackdrop,
  readStoredFrameBackdrops,
  scoutBackdropCorners,
  normalizeScoutAvatarSize,
  normalizeScoutThemeFinish,
  normalizeScoutThemeLook,
  readStoredAppearance,
  normalizeScoutThemeVoice,
  normalizeScoutThemeAccent,
  normalizeScoutThemeContrast,
  normalizeScoutThemePalette,
  normalizeScoutThemePreference,
  normalizeScoutShellStyle,
  normalizeScoutThemeTemplate,
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
  resolveScoutThemePreference,
  resolveAgentCharacterAssignment,
  setScoutAppearanceStorageKey,
  writeScoutAppearanceDetails,
  writeScoutThemePreference,
} from "./theme.ts";

describe("Scout theme contract", () => {
  test("marks a host palette only when every value the look's ladder reads arrived", () => {
    const host = {
      "--hud-bg": "#121214",
      "--hud-surface": "#242428",
      "--hud-ink": "#FFFFFFF7",
      "--hud-muted": "#FFFFFFB0",
      "--hud-dim": "#FFFFFF7D",
    };
    expect(hasScoutHostPalette(host)).toBe(true);
    expect(hasScoutHostPalette({ ...host, "--hud-accent": "#6D7AE8" })).toBe(true);
    const { "--hud-surface": _surface, ...withoutSurface } = host;
    expect(hasScoutHostPalette(withoutSurface)).toBe(false);
    expect(hasScoutHostPalette({ ...host, "--hud-dim": "" })).toBe(false);
    expect(hasScoutHostPalette(null)).toBe(false);
    expect(hasScoutHostPalette(undefined)).toBe(false);
  });

  test("accepts only supported theme preferences", () => {
    expect(normalizeScoutThemePreference("system")).toBe("system");
    expect(normalizeScoutThemePreference("light")).toBe("light");
    expect(normalizeScoutThemePreference("dark")).toBe("dark");
    expect(normalizeScoutThemePreference("sepia")).toBeNull();
    expect(normalizeScoutThemePreference(null)).toBeNull();
  });

  test("accepts the supported palette, contrast, and accent axes", () => {
    expect(normalizeScoutShellStyle("scout")).toBe("scout");
    expect(normalizeScoutShellStyle("slack")).toBe("slack");
    expect(normalizeScoutShellStyle("teams")).toBeNull();
    expect(normalizeScoutThemePalette("scout")).toBe("scout");
    expect(normalizeScoutThemePalette("polar")).toBe("polar");
    expect(normalizeScoutThemePalette("catppuccin")).toBeNull();
    expect(normalizeScoutThemeContrast("strong")).toBe("strong");
    expect(normalizeScoutThemeContrast("maximum")).toBeNull();
    expect(normalizeScoutThemeAccent("theme")).toBe("theme");
    expect(normalizeScoutThemeAccent("cyan")).toBe("cyan");
    expect(normalizeScoutThemeAccent("rainbow")).toBeNull();
    expect(normalizeScoutAvatarSize("compact")).toBe("compact");
    expect(normalizeScoutAvatarSize("large")).toBe("large");
    expect(normalizeScoutAvatarSize("huge")).toBeNull();
  });

  test("normalizes the two frame spacing layers", () => {
    expect(normalizeScoutAppearanceDetails({ panels: "joined", edges: "flush" })).toMatchObject({ panels: "joined", edges: "flush" });
    expect(normalizeScoutAppearanceDetails({ panels: "tight", edges: "none" })).toMatchObject({ panels: "joined", edges: "flush" });
    expect(normalizeScoutAppearanceDetails({})).toMatchObject({ panels: "joined", edges: "flush" });
  });

  test("normalizes voice and finish", () => {
    expect(normalizeScoutThemeVoice("mono")).toBe("mono");
    expect(normalizeScoutThemeVoice("serif")).toBeNull();
    expect(normalizeScoutThemeFinish("ticks")).toBe("ticks");
    expect(normalizeScoutThemeFinish("glow")).toBeNull();
    expect(normalizeScoutAppearanceDetails({ voice: "mono", finish: "ticks" })).toMatchObject({ voice: "mono", finish: "ticks" });
  });

  test("the look is Sharp or Classic, and Sharp is the default", () => {
    expect(normalizeScoutThemeLook("classic")).toBe("classic");
    expect(normalizeScoutThemeLook("glass")).toBeNull();
    expect(normalizeScoutAppearanceDetails({}).look).toBe("sharp");
  });

  test("a save from before the flush frame default drops the old frame defaults and keeps a marked choice", () => {
    const store = new Map<string, string>();
    const previousWindow = globalThis.window;
    globalThis.window = {
      localStorage: { getItem: (key: string) => store.get(key) ?? null },
      location: new URL("http://127.0.0.1:43120/"),
    } as unknown as Window & typeof globalThis;
    try {
      // Every load used to save the whole appearance, old defaults included.
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ look: "sharp", finish: "ticks", panels: "spaced", edges: "inset" }));
      expect(readStoredAppearance()).toMatchObject({ finish: undefined, panels: undefined, edges: undefined });
      expect(resolveScoutStartupAppearanceDetails()).toMatchObject({ finish: "flat", panels: "joined", edges: "flush" });
      // A save carrying the marker was made under the new default, so it is a choice.
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ look: "sharp", finish: "ticks", panels: "spaced", edges: "inset", frameDefault: 1 }));
      expect(readStoredAppearance()).toMatchObject({ finish: "ticks", panels: "spaced", edges: "inset" });
      // A value that was never the default is a choice with or without the marker.
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ look: "sharp", panels: "joined", edges: "flush" }));
      expect(readStoredAppearance()).toMatchObject({ panels: "joined", edges: "flush" });
    } finally {
      globalThis.window = previousWindow;
    }
  });

  test("a save from before the look axis keeps its look: the HUD preset reads as Sharp, any other mix as Classic", () => {
    const store = new Map<string, string>();
    const previousWindow = globalThis.window;
    globalThis.window = {
      localStorage: { getItem: (key: string) => store.get(key) ?? null },
      location: new URL("http://127.0.0.1:43120/"),
    } as unknown as Window & typeof globalThis;
    try {
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ palette: "graphite", finish: "flat" }));
      expect(readStoredAppearance().look).toBe("classic");
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ palette: "week", finish: "ticks" }));
      expect(readStoredAppearance().look).toBe("sharp");
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ finish: "ticks", look: "classic" }));
      expect(readStoredAppearance().look).toBe("classic");
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ theme: "dark" }));
      expect(readStoredAppearance().look).toBeUndefined();
      // saved before the finish setting existed: Classic, with the defaults it was saved under
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({
        theme: "dark", template: "hudson", palette: "graphite", accent: "amber", avatarStyle: "crew",
      }));
      expect(resolveScoutStartupAppearanceDetails()).toMatchObject({
        look: "classic", finish: "flat", contrast: "balanced", palette: "graphite", accent: "amber",
      });
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ accent: "amber" }));
      expect(readStoredAppearance()).toMatchObject({ look: "classic", template: "hudson", finish: "flat" });
    } finally {
      globalThis.window = previousWindow;
    }
  });

  test("an emerald saved by the old default gives way to amber; a marked emerald was picked and stays", () => {
    const store = new Map<string, string>();
    const previousWindow = globalThis.window;
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
      },
      location: new URL("http://127.0.0.1:43120/"),
    } as unknown as Window & typeof globalThis;
    try {
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ accent: "emerald", look: "sharp" }));
      expect(resolveScoutStartupAppearanceDetails().accent).toBe("amber");
      store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ accent: "cyan", look: "sharp" }));
      expect(resolveScoutStartupAppearanceDetails().accent).toBe("cyan");
      store.clear();
      writeScoutAppearanceDetails(normalizeScoutAppearanceDetails({ accent: "emerald" }));
      expect(resolveScoutStartupAppearanceDetails().accent).toBe("emerald");
    } finally {
      globalThis.window = previousWindow;
    }
  });

  test("normalizes partial or stale appearance details to safe defaults", () => {
    expect(normalizeScoutAppearanceDetails({
      shell: "slack",
      palette: "graphite",
      contrast: "strong",
      accent: "violet",
      avatarStyle: "crew",
      avatarSize: "large",
      operatorCharacter: "brik",
      agentCharacters: { "codex-here": "vex", Sprout: "sprout", ghost: "not-a-cast-member" },
    })).toEqual({
      shell: "slack",
      palette: "graphite",
      contrast: "strong",
      accent: "violet",
      avatarStyle: "crew",
      avatarSize: "large",
      voice: "mixed",
      finish: "flat",
      panels: "joined",
      edges: "flush",
      look: "sharp",
      frameBackdrop: "plain",
      frameSidebarBackdrop: "same",
      pageBackdrop: "solid",
      backdropColors: "#4f7fb0 #8a5fa0 #3d8a80 #b98545",
      operatorCharacter: "brik",
      agentCharacters: {
        byId: {},
        legacyByName: { "codex-here": "vex", sprout: "sprout" },
      },
    });
    expect(normalizeScoutAppearanceDetails({
      shell: "removed-shell",
      palette: "removed-theme",
      contrast: "balanced",
      agentCharacters: { stray: 42 },
    })).toEqual({
      shell: "scout",
      palette: "week",
      contrast: "balanced",
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
      backdropColors: "#4f7fb0 #8a5fa0 #3d8a80 #b98545",
      operatorCharacter: "milo",
      agentCharacters: { byId: {}, legacyByName: {} },
    });
  });

  test("migrates a legacy name only when it identifies one durable agent", () => {
    const legacy = normalizeScoutAppearanceDetails({
      agentCharacters: { Newton: "vex", Ada: "sprout" },
    }).agentCharacters;
    const agents = [
      { id: "agent-newton", name: "Newton" },
      { id: "agent-ada-1", name: "Ada" },
      { id: "agent-ada-2", name: "Ada" },
    ];

    expect(migrateLegacyAgentCharacters(legacy, agents)).toEqual({
      byId: { "agent-newton": "vex" },
      legacyByName: { ada: "sprout" },
    });
  });

  test("keeps character identity stable across duplicate names and renames", () => {
    const assignments = {
      byId: { "agent-one": "vex", "agent-two": "sprout" },
      legacyByName: { newton: "brik" },
    };
    const duplicateNames = [
      { id: "agent-one", name: "Newton" },
      { id: "agent-two", name: "Newton" },
    ];

    expect(resolveAgentCharacterAssignment(
      assignments,
      { id: "agent-one", name: "Newton" },
      duplicateNames,
    )).toBe("vex");
    expect(resolveAgentCharacterAssignment(
      assignments,
      { id: "agent-two", name: "Newton" },
      duplicateNames,
    )).toBe("sprout");
    expect(resolveAgentCharacterAssignment(
      assignments,
      { id: "agent-one", name: "Renamed Newton" },
      [{ id: "agent-one", name: "Renamed Newton" }],
    )).toBe("vex");
    expect(resolveAgentCharacterAssignment(
      { byId: {}, legacyByName: { newton: "brik" } },
      { name: "Newton" },
      duplicateNames,
    )).toBeUndefined();
  });

  test("accepts only Scout-supported Hudson templates", () => {
    expect(normalizeScoutThemeTemplate("hudson")).toBe("hudson");
    expect(normalizeScoutThemeTemplate("editorial")).toBe("editorial");
    expect(normalizeScoutThemeTemplate("drafting")).toBe("drafting");
    expect(normalizeScoutThemeTemplate("custom")).toBeNull();
  });

  test("resolves system preference without consulting browser globals", () => {
    expect(resolveScoutThemePreference("system", true)).toBe("dark");
    expect(resolveScoutThemePreference("system", false)).toBe("light");
    expect(resolveScoutThemePreference("light", true)).toBe("light");
    expect(resolveScoutThemePreference("dark", false)).toBe("dark");
  });

  test("persists agent character unassignment instead of resurrecting deleted keys", () => {
    const store = new Map<string, string>();
    const previousWindow = globalThis.window;
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
      location: new URL("http://127.0.0.1:43120/"),
    };

    // Test-only stub of a well-known DOM global; the shape is fully specified here.
    const windowStub = fakeWindow as unknown as Window & typeof globalThis;
    globalThis.window = windowStub;

    try {
      // hasAppearanceUrlOverride() reads location.search; an empty URL means no override.
      const base = normalizeScoutAppearanceDetails({ shell: "scout" });
      writeScoutAppearanceDetails({
        ...base,
        agentCharacters: {
          byId: { "agent-codex": "vex", "agent-sprout": "sprout" },
          legacyByName: {},
        },
      });
      expect(JSON.parse(store.get(SCOUT_THEME_STORAGE_KEY)!).agentCharacters).toEqual({
        byId: { "agent-codex": "vex", "agent-sprout": "sprout" },
        legacyByName: {},
      });

      // Unassign agent-codex: the next write omits the durable id entirely.
      writeScoutAppearanceDetails({
        ...base,
        agentCharacters: {
          byId: { "agent-sprout": "sprout" },
          legacyByName: {},
        },
      });
      expect(JSON.parse(store.get(SCOUT_THEME_STORAGE_KEY)!).agentCharacters).toEqual({
        byId: { "agent-sprout": "sprout" },
        legacyByName: {},
      });
    } finally {
      globalThis.window = previousWindow;
    }
  });

});

describe("backdrop corners", () => {
  test("fills two or three colours out to four corners, the Mac app's way", () => {
    expect(scoutBackdropCorners("#000000 #ffffff")).toEqual(["#000000", "#595959", "#a6a6a6", "#ffffff"]);
    expect(scoutBackdropCorners("#ff0000 #00ff00 #0000ff")).toEqual(["#ff0000", "#00ff00", "#0000ff", "#008080"]);
    expect(scoutBackdropCorners("#111111 #222222 #333333 #444444")).toEqual(["#111111", "#222222", "#333333", "#444444"]);
    expect(scoutBackdropCorners("not colours")).toEqual(["#4f7fb0", "#8a5fa0", "#3d8a80", "#b98545"]);
  });

  test("keeps the sidebar on the frame's backdrop unless told otherwise", () => {
    expect(normalizeScoutFrameSidebarBackdrop("same")).toBe("same");
    expect(normalizeScoutFrameSidebarBackdrop("aurora")).toBe("aurora");
    expect(normalizeScoutFrameSidebarBackdrop("neon")).toBeNull();
    expect(normalizeScoutAppearanceDetails({}).frameSidebarBackdrop).toBe("same");
  });

  test("keeps the page solid unless told otherwise", () => {
    expect(normalizeScoutAppearanceDetails({}).pageBackdrop).toBe("solid");
    expect(normalizeScoutPageBackdrop("aurora")).toBe("aurora");
    expect(normalizeScoutPageBackdrop("custom")).toBe("custom");
    // Plain belongs to the frame; on the page it would only be Solid again.
    expect(normalizeScoutPageBackdrop("plain")).toBeNull();
    expect(normalizeScoutPageBackdrop("same")).toBeNull();
  });
});

describe("frame backdrop storage migration", () => {
  test("reads the keys saved before the Frame › Page vocabulary", () => {
    expect(readStoredFrameBackdrops({ backdrop: "dusk", sidebarBackdrop: "aurora" })).toEqual({
      frameBackdrop: "dusk",
      frameSidebarBackdrop: "aurora",
    });
    expect(readStoredFrameBackdrops({ sidebarBackdrop: "same" })).toEqual({
      frameBackdrop: undefined,
      frameSidebarBackdrop: "same",
    });
  });

  test("prefers the current keys, and skips values it does not know", () => {
    expect(readStoredFrameBackdrops({
      frameBackdrop: "smooth",
      backdrop: "dusk",
      frameSidebarBackdrop: "neon",
      sidebarBackdrop: "custom",
    })).toEqual({ frameBackdrop: "smooth", frameSidebarBackdrop: "custom" });
    expect(readStoredFrameBackdrops({ backdrop: 3 })).toEqual({ frameBackdrop: undefined, frameSidebarBackdrop: undefined });
  });

  test("a saved choice survives the upgrade and the next write moves it to the new keys", () => {
    const store = new Map<string, string>();
    const previousWindow = globalThis.window;
    store.set(SCOUT_THEME_STORAGE_KEY, JSON.stringify({ palette: "graphite", backdrop: "aurora", sidebarBackdrop: "dusk" }));
    globalThis.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
      location: new URL("http://127.0.0.1:43120/"),
      matchMedia: () => ({ matches: true }),
    } as unknown as Window & typeof globalThis;

    try {
      const upgraded = resolveScoutStartupAppearanceDetails();
      expect(upgraded).toMatchObject({ frameBackdrop: "aurora", frameSidebarBackdrop: "dusk", pageBackdrop: "solid" });

      writeScoutAppearanceDetails({ ...upgraded, pageBackdrop: "smooth" });
      const saved = JSON.parse(store.get(SCOUT_THEME_STORAGE_KEY)!);
      expect(saved).toMatchObject({
        palette: "graphite",
        frameBackdrop: "aurora",
        frameSidebarBackdrop: "dusk",
        pageBackdrop: "smooth",
      });
      expect(saved).not.toHaveProperty("backdrop");
      expect(saved).not.toHaveProperty("sidebarBackdrop");
      expect(resolveScoutStartupAppearanceDetails()).toMatchObject({
        frameBackdrop: "aurora", frameSidebarBackdrop: "dusk", pageBackdrop: "smooth",
      });
    } finally {
      globalThis.window = previousWindow;
    }
  });
});
