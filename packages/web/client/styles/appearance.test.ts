import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyScoutThemeToDocument,
  SCOUT_DEFAULT_APPEARANCE_DETAILS,
} from "../lib/theme.ts";

const appearance = readFileSync(new URL("./appearance.css", import.meta.url), "utf8");
const sharp = readFileSync(new URL("./looks/sharp.css", import.meta.url), "utf8");
const friendly = readFileSync(new URL("./looks/friendly.css", import.meta.url), "utf8");

function declarations(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing selector: ${selector}`);
  return css.slice(start + selector.length + 2, css.indexOf("}", start));
}

function token(block: string, name: string): string | undefined {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
}

describe("Scout text contrast", () => {
  test.each([
    ["week", "0.470 0.0158 241.2"],
    ["graphite", "0.475 0.0138 285.9"],
    ["scout", "0.470 0.014 80"],
    ["carbon", "0.475 0.0127 256.7"],
    ["solar", "0.47 0.026 215"],
    ["polar", "0.4523 0.0352 264.1"],
    ["paper", "0.475 0.0085 85"],
  ])("%s light muted ink keeps its palette chroma and hue", (palette, value) => {
    const block = declarations(appearance, `[data-scout-theme-mode="light"][data-scout-palette="${palette}"]`);
    expect(token(block, "--muted-foreground")).toBe(value);
  });

  test("Solar light ink stays distinct from muted text", () => {
    const block = declarations(appearance, '[data-scout-theme-mode="light"][data-scout-palette="solar"]');
    expect(token(block, "--foreground")).toBe("0.42 0.0283 219.1");
    for (const name of ["--card-foreground", "--popover-foreground", "--primary"]) {
      expect(token(block, name)).toBe("0.42 0.032 219");
    }
    expect(token(block, "--secondary-foreground")).toBe("0.45 0.03 219");
  });

  test.each([["light", "0.86"], ["dark", "0.92"]])("%s dim ink has its own alpha floor", (mode, alpha) => {
    // The semantic status block shares this selector; inspect all matching rules.
    const blocks = appearance.split(`[data-scout-theme-mode="${mode}"][data-scout-palette] {`).slice(1);
    expect(blocks.some((block) => token(block.split("}")[0]!, "--hud-dim") === `oklch(var(--muted-foreground) / ${alpha})`)).toBe(true);
  });

  test.each([
    ["", "#c3c3ca", "#a5a5ad", "#8c8c94"],
    ['="carbon"', "#bbc0c6", "#9da2a8", "#8a8e94"],
    ['="week"', "#b6bdc3", "#99a1a7", "#868d93"],
  ])("Sharp dark tiers %s keep faint ink separate", (palette, muted, dim, faint) => {
    const block = declarations(sharp, `[data-scout-look="sharp"][data-hudson-theme="dark"][data-scout-palette${palette}]`);
    expect(token(block, "--tone-muted")).toBe(muted);
    expect(token(block, "--tone-dim")).toBe(dim);
    expect(token(block, "--tone-faint")).toBe(faint);
  });

  test("Sharp light labels and metadata use regular weight on both scopes", () => {
    const selector = ':root[data-scout-look="sharp"][data-scout-theme-mode="light"],\n[data-scout-look="sharp"][data-hudson-theme="light"]';
    const block = declarations(sharp, selector);
    expect(token(block, "--w-label")).toBe("400");
    expect(token(block, "--w-meta")).toBe("400");
    const base = declarations(sharp, ':root[data-scout-look="sharp"],\n[data-scout-look="sharp"][data-hudson-theme]');
    expect(token(base, "--w-label")).toBe("300");
    expect(token(base, "--w-meta")).toBe("300");
    expect(sharp).toContain("@media (max-resolution: 1.5dppx)");
  });

  test("Friendly sets regular type and leaves corners and colour to the other axes", () => {
    const base = declarations(friendly, ':root[data-scout-look="friendly"],\n[data-scout-look="friendly"][data-hudson-theme]');
    expect(token(base, "--font-weight-body")).toBe("400");
    expect(token(base, "--w-label")).toBe("500");
    expect(token(base, "--fs-label")).toBe("11px");
    expect(token(base, "--text-3xs")).toBe("10px");
    expect(friendly).not.toMatch(/--radius[a-z-]*:/);
    expect(friendly).not.toMatch(/--(background|foreground|accent|hud-accent):/);
  });

  test("Blue accent and Paper's native signal agree in each mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const accent = declarations(appearance, `[data-scout-theme-mode="${mode}"][data-scout-accent="blue"]`);
      const paper = declarations(appearance, `[data-scout-theme-mode="${mode}"][data-scout-palette="paper"]`);
      expect(token(paper, "--accent")).toBe(token(accent, "--accent"));
    }
  });

  test("the Sans voice keeps code in the real mono face", () => {
    expect(appearance).toContain('--scout-face-mono: ui-monospace');
    const restore = appearance.slice(appearance.indexOf(':root[data-scout-voice="sans"] [data-scout-theme] :is(code, pre'));
    expect(token(restore.split("}")[0]!, "--font-mono")).toBe("var(--scout-face-mono)");
  });

  test("the document root carries the resolved mode for Sharp's light selector", () => {
    const previous = globalThis.document;
    const properties: Record<string, string> = {};
    const root = {
      dataset: {},
      style: { setProperty: (name: string, value: string) => { properties[name] = value; } },
    };
    globalThis.document = { documentElement: root } as unknown as Document;
    try {
      for (const mode of ["light", "dark"] as const) {
        applyScoutThemeToDocument(mode, "drafting", SCOUT_DEFAULT_APPEARANCE_DETAILS);
        expect(root.dataset).toMatchObject({
          scoutThemeMode: mode,
          hudsonTheme: mode,
          scoutLook: "sharp",
          scoutFrameBackdrop: "plain",
          scoutPageBackdrop: "solid",
        });
        expect(properties).toEqual({
          "--scout-backdrop-c1": "#4f7fb0",
          "--scout-backdrop-c2": "#8a5fa0",
          "--scout-backdrop-c3": "#3d8a80",
          "--scout-backdrop-c4": "#b98545",
        });
      }
    } finally {
      globalThis.document = previous;
    }
  });
});
