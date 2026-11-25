import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
const { Marks, Ident, identityMonogram } = await import("./Ident");
const marks = (project: string | null, harness: string | null, agent = "handel") => renderToStaticMarkup(React.createElement(Marks, { project, harness, agent }));

test("known project and harness keep their real marks", () => {
  const markup = marks("openscout", "codex");
  expect(markup).toContain('title="openscout"');
  expect(markup).toContain('title="Codex"');
  expect(markup).not.toContain('is-fallback');
});

test("unknown slots contain a monogram and a centered-dot neutral coin, never blank shapes", () => {
  const markup = marks(null, null, "peal-bach");
  expect(markup).toContain('class="arv-tile is-code is-fallback"');
  expect(markup).toMatch(/is-fallback"[^>]*>PB</);
  expect(markup).toContain('title="Project unknown · peal-bach monogram"');
  expect(markup).toContain('aria-label="peal-bach"');
  expect(markup).toContain('class="arv-coin is-fallback"');
  expect(markup).toContain('aria-label="Harness unknown"');
  expect(markup).toContain('<circle cx="4.5" cy="4.5" r="1.25"');
  expect(markup).not.toContain('is-none');
  expect(marks("openscout", "unknown")).toContain('class="arv-coin is-fallback"');
  expect(identityMonogram("peal-bach")).toBe("PB");
  expect(identityMonogram("openscout")).toBe("OS");
  expect(identityMonogram("OpenScout")).toBe("OS");
});

test("whitespace and absent agent names still produce two visible slots", () => {
  expect(marks(" ", " ", " ")).toContain('title="Project unknown · Agent monogram"');
  expect(marks(" ", " ", " ").match(/is-fallback/g)).toHaveLength(2);
});

test("desk row identities reuse both fallbacks and retain their size", () => {
  const markup = renderToStaticMarkup(React.createElement(Ident, { t: { handle: "rousseau", task: "Review", project: null, harness: null }, size: 18 }));
  expect(markup).toContain('class="arv-marks"');
  expect(markup.match(/is-fallback/g)).toHaveLength(2);
  expect(markup).toContain('width:18px;height:18px');
});

test("a known harness's coin wears its brand tint; a black-and-white brand keeps the ink", () => {
  const claude = marks("openscout", "claude");
  expect(claude).toContain('class="arv-coin is-tinted"');
  expect(claude).toContain("--arv-coin-tint:#d97757");
  const grok = marks("openscout", "grok");
  expect(grok).toContain('class="arv-coin"');
  expect(grok).not.toContain("--arv-coin-tint");
});
