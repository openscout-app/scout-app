import { afterEach, expect, mock, test } from "bun:test";
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
import type { CornerThread } from "../system-corner/system-corner-model.ts";
const { FigureMenu, FigureTalk, figureDraft, hasFigureDraft, seedFigureDraft } = await import("./FigureTalk.tsx");
const { addFigureFiles, clearFigureFiles } = await import("./engage-model.ts");

const row = (over: Partial<CornerThread> = {}): CornerThread => ({
  id: "session:local:claude:s1", workId: null, conversationId: null, task: "Port the session rail", handle: "claude", now: "Editing the rail.",
  state: "working", at: 1_700_000_000_000, request: null, facts: [], harness: "claude", project: "openscout", branch: "main", pinId: "session:s1",
  ...over,
});
const menu = (t: CornerThread, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(FigureMenu, {
  t, demo: true, name: "claude", width: 216, at: { x: 10, y: 10 }, hitId: "figure-menu", elRef: { current: null },
  onClose: () => {}, onTalk: () => {}, onDetails: () => {}, onHome: () => {}, ...extra,
}));
// Copy the house rules: no invented words in the interface.
const NOT_SAID = /Needs you|pilot|coming soon|broker/i;

afterEach(() => {
  seedFigureDraft("session:local:claude:s1", "");
  clearFigureFiles("session:local:claude:s1");
});

test("the engage panel is a reply line that takes the keys, with nothing else in its way", () => {
  const markup = renderToStaticMarkup(React.createElement(FigureTalk, { t: row(), demo: true }));
  expect(markup).toContain("arv-talk");
  expect(markup).toContain("tap-reply");
  expect(markup).toContain("<textarea");
  // Send is always there, held until there is something to send.
  expect(markup).toMatch(/class="tap-reply__send"[^>]*disabled=""/);
  expect(markup).not.toContain("tap-reply is-ready");
  // The mic is always offered; it shows its own state when voice is unavailable.
  expect(markup).toContain("tap-reply__mic");
  // No settings here, and no ways in: those are the Details.
  expect(markup).not.toContain("arv-plate__set");
  expect(markup).not.toContain("Interrupt");
  expect(markup).not.toContain("Stop work");
  expect(markup).not.toMatch(NOT_SAID);
});

test("its foot links to the Details, with the key for them, only when there are Details to open", () => {
  expect(renderToStaticMarkup(React.createElement(FigureTalk, { t: row(), demo: true }))).not.toContain("Details");
  const markup = renderToStaticMarkup(React.createElement(FigureTalk, { t: row(), demo: true, onDetails: () => {} }));
  expect(markup).toContain("arv-talk__details");
  expect(markup).toContain("Details <kbd>⌘I</kbd>");
});

test("files dropped on the figure wait as chips in its reply line, and hold the card open", () => {
  const id = "session:local:claude:s1";
  addFigureFiles(id, [{ id: "b1", mediaType: "image/png", fileName: "Screenshot 10.12.png", url: "/api/blobs/b1", localPath: null }]);
  expect(hasFigureDraft(id)).toBe(true);
  const markup = renderToStaticMarkup(React.createElement(FigureTalk, { t: row(), demo: true }));
  expect(markup).toContain("tap-reply has-files");
  expect(markup).toContain("<span>Screenshot 10.12.png</span>");
  expect(markup).toContain('aria-label="Remove Screenshot 10.12.png"');
  expect(markup).toContain('placeholder="Add a line, or just send"');
});

test("a draft outlives the card, and a key typed on the figure goes on with it", () => {
  const id = "session:local:claude:s1";
  expect(hasFigureDraft(id)).toBe(false);
  seedFigureDraft(id, "h");
  seedFigureDraft(id, "i");
  expect(figureDraft(id)).toBe("hi");
  expect(hasFigureDraft(id)).toBe(true);
  expect(renderToStaticMarkup(React.createElement(FigureTalk, { t: row(), demo: true }))).toMatch(/<form class="tap-reply is-ready">.*<textarea[^>]*>hi<\/textarea>/);
});

test("the menu offers Reply, the ways in it has, Details and the way back, and no ref for a demo row", () => {
  const markup = menu(row());
  expect(markup).toContain('data-hit="figure-menu"');
  expect(markup).toContain('role="menu"');
  for (const said of [">Reply<", ">Open session<", ">Details<kbd class=\"cw-menu__key\">⌘I</kbd>", ">Back to the board<"]) expect(markup).toContain(said);
  expect(markup).not.toContain("Settings");
  expect(markup).not.toContain("Copy session ref");
  // Interrupt is only offered with the roster's agents and a live turn the runtime can stop.
  expect(markup).not.toContain("Interrupt");
  expect(markup).not.toMatch(NOT_SAID);
});

test("an asking demo row's menu holds its answers, the approve in the accent", () => {
  const markup = menu(row({ state: "asking", now: "may I push scout/arrivals?" }), { onDemoAnswer: () => {} });
  expect(markup).toContain('class="cw-menu__item is-go"');
  expect(markup).toContain(">Allow once<");
  expect(markup).toContain(">Deny<");
});

test("a long line hovers with its start, a short one whole", async () => {
  const { hoverText } = await import("./FigureTalk.tsx");
  expect(hoverText("Fix the build")).toBe("Fix the build");
  const long = hoverText("word ".repeat(200));
  expect(long.length).toBeLessThanOrEqual(280);
  expect(long.endsWith("…")).toBe(true);
});
