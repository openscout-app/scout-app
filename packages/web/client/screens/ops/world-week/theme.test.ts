import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_STYLE, MODE_THEME, STYLE_IDS, THEMES, THEME_IDS, nextStyle, resolveAccent, resolveStyle, resolveThemeId, storeStylePick, storeThemePick } from "./theme.ts";

// a minimal localStorage, fresh per test
let store: Map<string, string>;
const g = globalThis as { localStorage?: unknown };
let had: unknown;

beforeEach(() => {
  store = new Map();
  had = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
});

afterEach(() => {
  g.localStorage = had;
});

describe("world theme per app mode", () => {
  test("a light app opens on Paper, a dark one on Scout", () => {
    expect(resolveThemeId("light")).toBe("paper");
    expect(resolveThemeId("dark")).toBe("scout");
    expect(THEMES[MODE_THEME.light].light).toBe(true);
    expect(THEMES[MODE_THEME.dark].light).toBe(false);
  });

  test("a pick is kept for the mode it was made in", () => {
    storeThemePick("linen", "light");
    expect(resolveThemeId("light")).toBe("linen");
    expect(resolveThemeId("dark")).toBe("scout");
    storeThemePick("ember", "dark");
    expect(resolveThemeId("dark")).toBe("ember");
    expect(resolveThemeId("light")).toBe("linen");
  });

  test("the old single pick counts only where its ground fits the mode", () => {
    store.set("world-modale.theme", "scout");
    expect(resolveThemeId("light")).toBe("paper");
    expect(resolveThemeId("dark")).toBe("scout");
    store.set("world-modale.theme", "paper");
    expect(resolveThemeId("light")).toBe("paper");
    expect(resolveThemeId("dark")).toBe("scout");
    store.set("world-modale.theme", "linen");
    expect(resolveThemeId("light")).toBe("linen");
  });

  test("an unknown stored pick falls back to the mode's treatment", () => {
    store.set("world-modale.theme.light", "nope");
    expect(resolveThemeId("light")).toBe("paper");
  });

  test("every palette wears the same thin chrome: the shape is the theme, not the palette", () => {
    for (const id of THEME_IDS) expect(THEMES[id].skin).toBe("scout");
  });

  test("the palette carries its accent: an accent stored before the split no longer counts", () => {
    store.set("world-modale.accent", "cobalt");
    expect(resolveAccent("scout")).toEqual({ id: "emerald", explicit: false });
    expect(resolveAccent("paper")).toEqual({ id: "amber", explicit: false });
  });
});

describe("world theme (the shape)", () => {
  test("the World opens on Panels, the app's own boxes", () => {
    expect(DEFAULT_STYLE).toBe("panels");
    expect(resolveStyle()).toBe("panels");
  });

  test("a pick is kept, one for both modes", () => {
    storeStylePick("hairline");
    expect(resolveStyle()).toBe("hairline");
    expect(resolveThemeId("dark")).toBe("scout");
  });

  test("an unknown stored pick falls back to Panels", () => {
    store.set("world-modale.style", "boxes");
    expect(resolveStyle()).toBe("panels");
  });

  test("the ; key cycles every theme and comes back", () => {
    let id: string = DEFAULT_STYLE;
    const seen = new Set<string>();
    for (let i = 0; i < STYLE_IDS.length; i++) { seen.add(id); id = nextStyle(id); }
    expect(id).toBe(DEFAULT_STYLE);
    expect(seen.size).toBe(STYLE_IDS.length);
  });
});

test("ordinary palette picks never create a URL override that pins the next mode", () => {
  const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
  const apply = engine.slice(engine.indexOf("function applyTheme("), engine.indexOf("function applyStyle("));
  expect(apply).toContain("if (fromUser) storeThemePick(theme.id)");
  expect(apply).not.toContain("history.replaceState");
  expect(apply).not.toContain('searchParams.set("palette"');
  storeThemePick("linen", "light");
  expect(resolveThemeId("dark")).toBe("scout");
  storeThemePick("ember", "dark");
  expect(resolveThemeId("light")).toBe("linen");
  expect(resolveThemeId("dark")).toBe("ember");
});
