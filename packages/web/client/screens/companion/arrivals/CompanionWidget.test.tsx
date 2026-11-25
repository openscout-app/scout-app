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
import type { Quota, WidgetSize } from "./CompanionWidget";
const { CompanionWidget } = await import("./CompanionWidget");
const { CallSignMark } = await import("../../../components/ProjectMark.tsx");

const quotas: Quota[] = [
  { id: "claude5h", label: "Claude", window: "5h", used: 80, reset: "in 2h" },
  { id: "claude7d", label: "Claude", window: "7d", used: 81, reset: "in 4d" },
  { id: "codex7d", label: "Codex", window: "7d", used: 12, reset: "in 5d" },
];
const widget = (size: WidgetSize, readings = quotas) => renderToStaticMarkup(React.createElement(CompanionWidget, {
  size, quotas: readings, asking: 0, readAt: "12:30",
  onSize: () => {}, onRow: () => {}, children: React.createElement("ol", { className: "arv-rows" }),
}));

test("M and L put weekly percentages inside the ring with a reset countdown beside it", () => {
  const readings = quotas.map((q) => q.id === "claude7d" ? { ...q, reset: "Sat 14:00", resetCountdown: "2d 4h" } : q);
  for (const size of ["m", "l"] as const) {
    const markup = widget(size, readings);
    expect(markup.match(/class="cw-gauge"/g)).toHaveLength(2);
    expect(markup).not.toContain("Claude 5h");
    expect(markup).toContain("Claude 7d · 81% used · resets Sat 14:00");
    expect(markup).toContain('class="cw-gauge__ring is-high" style="--cw-quota-used:81%"');
    expect(markup).toMatch(/class="cw-gauge__ring is-high"[^>]*><span class="cw-gauge__value">81%<\/span><\/span>/);
    expect(markup).not.toContain('class="cw-gauge__window"');
    expect(markup).toContain('class="cw-gauge__reset">2d 4h');
    expect(markup.indexOf('class="cw-gauges"')).toBeLessThan(markup.indexOf(size === "m" ? 'class="cw-rows"' : 'class="arv-rows"'));
  }
  expect(widget("s")).not.toContain("cw-gauges");
});

test("the compact strip takes three providers and prefers the weekly reading", () => {
  const markup = widget("l", [
    ...quotas.map((q) => q.id === "claude5h" ? { ...q, used: 98 } : q),
    { id: "kimi7d", label: "Kimi", window: "7d", used: 75, reset: "in 2d" },
    { id: "grok5h", label: "Grok", window: "5h", used: 10, reset: "in 1h" },
  ]);
  expect(markup.match(/class="cw-gauge"/g)).toHaveLength(3);
  expect(markup).toContain('class="cw-gauge__value">81%');
  expect(markup).not.toContain('class="cw-gauge__value">98%');
  expect(markup).not.toContain("Grok 5h");
});

test("an unavailable provider shows a dash and keeps its unknown window's tooltip", () => {
  const markup = widget("l", [{ ...quotas[1]!, used: 0, unavailable: true }]);
  expect(markup).toContain('class="cw-gauge__value">—</span>');
  expect(markup).toContain('aria-label="Claude 7d · Awaiting read"');
  expect(markup).toContain('class="cw-gauge__ring" style="--cw-quota-used:0%"');
  expect(markup).not.toContain("cw-gauge__reset");
});

test("a stale reading names its age in the tooltip and dims its percentage", () => {
  const stale = quotas.map((q) => q.label === "Codex" ? { ...q, used: 91, readAt: Date.parse("2026-11-02T05:25:00Z"), age: "15h" } : q);
  for (const size of ["m", "l"] as const) {
    const markup = widget(size, stale);
    expect(markup).toContain('class="cw-gauge is-stale"');
    expect(markup).toContain("read 15h ago");
  }
});

const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id, workId: null, conversationId: null, task: `Task ${id}`, handle: "codex", now: `now ${id}`,
  state: "working", at: 0, request: null, facts: [], harness: "codex", project: "openscout",
  pinId: `session:s-${id}`, ...extra,
});
const live = (id: string, remark: "WORKING" | "ASKING" | "DONE" | "READY", extra: Record<string, unknown> = {}) =>
  ({ id, remark, now: `now ${id}`, thread: thread(id, extra) });

test("M lists every live session with its harness, title and last step, and a last line counts the ones below", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 1, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("a", "WORKING"), live("b", "ASKING"), live("c", "DONE"), live("d", "WORKING")],
    activity: new Map([["s-a", [2, 3, 1]]]),
    steps: new Map([["s-a", { text: "bun test widget", at: 1, kind: "tool" }], ["s-b", { text: "earlier step", at: 1, kind: "tool" }]]),
  }));
  expect(markup.match(/class="cw-row cw-in/g)).toHaveLength(4);
  expect(markup.match(/class="cw-sign/g)).toHaveLength(4);
  expect(markup).toContain(">Task a<");
  expect(markup).toContain('class="cw-row__step">bun test widget<');
  expect(markup).toContain('class="cw-row__step is-ask">now b<');
  expect(markup).toContain('class="cw-row__t">done<');
  expect(markup).toContain(">Task d<");
  expect(markup).toMatch(/<button type="button" class="cw-more cw-in"[^>]*>\+1 more<\/button>/);
});

test("a Ready row says ready in its own style and leads with the agent's summary, not the dots", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("r", "READY")],
    activity: new Map([["s-r", [2, 3, 1]]]),
    steps: new Map([["s-r", { text: "bun test widget", at: 1, kind: "tool" }]]),
  }));
  expect(markup).toMatch(/class="cw-row cw-in is-ready/);
  expect(markup).toContain('class="cw-row__t">ready<');
  expect(markup).toContain('>now r<');
  expect(markup).not.toContain("bun test widget");
  expect(markup).not.toContain("cw-row__dots");
});

test("size controls only move to adjacent board sizes", () => {
  const small = widget("s");
  expect(small).toMatch(/class="cw-ico cw-grow"[^>]*aria-label="Make it medium"/);
  expect(small).not.toContain("cw-shrink");

  const medium = widget("m");
  expect(medium).toMatch(/class="cw-ico cw-grow"[^>]*aria-label="Make it large"/);
  expect(medium).toMatch(/class="cw-ico cw-shrink"[^>]*aria-label="Make it small"/);

  const large = widget("l");
  expect(large).toMatch(/class="cw-ico cw-shrink"[^>]*aria-label="Make it medium"/);
  expect(large).not.toContain("cw-grow");
  expect(large).not.toContain('aria-label="Make it small"');
});

const actions = (waiting: number, on = false) => ({
  newOn: false, onNew: () => {}, settingsOn: false, onSettings: () => {},
  bot: { on, waiting, onToggle: () => {} },
});

test("with Scoutbot on, the mark is Scoutbot and there is no New button (New is Scoutbot's); an empty S is three controls: Settings, Scout's face, grow", () => {
  for (const size of ["s", "m"] as const) {
    const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
      size, quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
      onMark: () => {}, actions: actions(2, true),
    }));
    expect(markup).not.toContain(">Scoutbot<");
    expect(markup).not.toContain("cw-bar");
    const at = (needle: string) => markup.indexOf(needle);
    if (size === "m") {
      expect(markup).toMatch(/class="cw-mark has-waiting" aria-pressed="true" aria-label="Scoutbot, 2 waiting"/);
    } else {
      // The face is Scoutbot's own drawing, and its asking dot stands in for the mark's.
      expect(markup).toMatch(/class="cw-mark cw-face has-waiting" aria-pressed="true" aria-label="Scoutbot, 2 waiting"[^>]*><svg class="sbt-bot is-ask"/);
      expect(markup).not.toContain("cw-ico__dot");
      expect(at('aria-label="Settings"')).toBeLessThan(at("cw-face"));
      expect(at("cw-face")).toBeLessThan(at("cw-grow"));
      expect(markup.match(/<button/g)?.length).toBe(3);
    }
    expect(markup).not.toContain("Read 12:30");
    expect(markup).not.toContain('aria-label="New conversation"');
    expect(at('aria-label="Settings"')).toBeLessThan(at("cw-grow"));
  }
});

test("with Scoutbot off, the mark opens what to do now", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    onMark: () => {}, actions: { ...actions(0), bot: null },
  }));
  expect(markup).toMatch(/class="cw-mark" aria-expanded="false" aria-label="Scout" title="What to do now\."/);
});

test("M marks the row whose details are open, and keys it for the panel's tether", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("a", "WORKING"), live("b", "WORKING")], tappedId: "b",
  }));
  expect(markup).toContain('data-k="line:a"');
  expect(markup.match(/is-tapped/g)).toHaveLength(1);
  expect(markup).toMatch(/data-k="line:b"[^>]*aria-expanded="true"[^>]*is-tapped/);
});

test("M puts the size control and gauges above its sessions", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("a", "WORKING")],
  }));
  const at = (needle: string) => markup.indexOf(needle);
  expect(at('class="cw-top"')).toBeGreaterThan(-1);
  expect(at('class="cw-top"')).toBeLessThan(at('class="cw-rows'));
  expect(at('class="cw-acts"')).toBeLessThan(at('class="cw-rows'));
  expect(at('class="cw-gauges"')).toBeLessThan(at('class="cw-rows'));
  expect(markup).not.toContain("cw-more");
});

test("M says nothing is running when no session is live", () => {
  expect(widget("m")).toContain("Nothing running.");
});

test("M times each row from its latest step, and an ask from when it began", () => {
  const now = Date.now();
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 1, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("a", "WORKING"), live("b", "ASKING", { since: now - 4 * 60_000 })],
    steps: new Map([["s-a", { text: "bun test", at: now - 12_000, kind: "tool" }], ["s-b", { text: "earlier", at: now - 1_000, kind: "tool" }]]),
  }));
  expect(markup).toMatch(/class="cw-row__ago"[^>]*>12s</);
  expect(markup).toMatch(/class="cw-row__ago"[^>]*>4m</);
});

test("S is the mark alone with nothing running, and a chip per live session otherwise", () => {
  expect(widget("s")).not.toContain("cw-chip");
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "s", quotas, asking: 1, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: ["a", "b", "c", "d", "e", "f", "g"].map((id) => live(id, id === "b" ? "ASKING" : "WORKING")), tappedId: "c",
  }));
  expect(markup.match(/class="cw-chip cw-in is-/g)).toHaveLength(5);
  expect(markup).toContain('class="cw-chip cw-in is-asking"');
  expect(markup).toMatch(/data-k="line:c"[^>]*is-tapped/);
  expect(markup).toContain(">+2<");
  expect(markup).not.toContain("cw-ring");
});

test("S has a way up whether or not its chips overflow", () => {
  const small = (ids: string[]) => renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "s", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    onMark: () => {}, live: ids.map((id) => live(id, "WORKING")),
  }));
  for (const ids of [[], ["a", "b"], ["a", "b", "c", "d", "e", "f", "g"]]) {
    expect(small(ids)).toMatch(/class="cw-ico cw-grow"[^>]*aria-label="Make it medium"/);
  }
  expect(small(["a", "b"])).not.toContain("is-more");
  expect(small(["a", "b", "c", "d", "e", "f", "g"])).toContain(">+2<");
});

test("an S chip with no known harness carries its speaker's monogram, not a bare dot", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "s", quotas, asking: 1, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("a", "ASKING", { harness: null, handle: "vera" }), live("b", "ASKING", { harness: null, handle: "hudson" })],
  }));
  expect(markup.match(/class="cw-chip__init"/g)).toHaveLength(2);
  const chips = markup.match(/<button[^>]*class="cw-chip[\s\S]*?<\/button>/g) ?? [];
  expect(chips).toHaveLength(2);
  for (const chip of chips) expect(chip).not.toContain("<circle");
  expect(markup).toMatch(/cw-chip__init[^>]*>VR</);
});

test("an M row wears the session's call sign in place of its project tile, an S chip leads with it; both wear the namer's name; the hover summary, not a tooltip, says the rest", () => {
  const named = { ...live("a", "WORKING"), sign: "OPN-042", name: "World view playback split" };
  const m = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [named, live("b", "WORKING")],
  }));
  // The sign in plain type down the row's two lines; a row with no sign keeps its project's code alone.
  expect(m).toMatch(/class="cw-sign" role="img" aria-label="OPN-042" title="OPN-042, [^"]+"><b aria-hidden="true">OPN<\/b><b aria-hidden="true">042<\/b>/);
  expect(m).toMatch(/class="cw-sign" role="img" aria-label="OS" title="OS, openscout"><b aria-hidden="true">OS<\/b><\/span>/);
  expect(m).not.toContain("arv-tile");
  expect(m).toContain('<span class="cw-row__name">World view playback split</span>');
  expect(m).not.toMatch(/title="Task a"/);
  expect(m).toContain('<span class="cw-row__name">Task b</span>');
  const s = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "s", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [named],
  }));
  expect(s).toContain('aria-label="OPN-042 World view playback split, working"');
  expect(s).not.toContain('title="OPN-042 World view playback split"');
});

test("a call sign spells three letters over three digits on the small board, or one line with its dash", () => {
  const stacked = renderToStaticMarkup(React.createElement(CallSignMark, { sign: "OPN-042", name: "openscout" }));
  // 11 dots across, two 5-dot lines with no dots in the row between them
  expect(stacked.match(/<circle/g)).toHaveLength(11 * 10);
  expect(stacked).toContain('width="24" height="24"');
  expect(stacked).toContain('aria-label="OPN-042"');
  const line = renderToStaticMarkup(React.createElement(CallSignMark, { sign: "OPN-042", name: "openscout", stacked: false, pitch: 2 }));
  expect(line.match(/<circle/g)).toHaveLength(27 * 5);
  expect(line).toContain('width="56" height="12"');
});

test("S chips and M rows rest the board's hover summary: a region of their own each, no tooltip", () => {
  const peek = { shown: null, enter: () => {}, leave: () => {}, press: () => {} };
  for (const size of ["s", "m"] as const) {
    const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
      size, quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
      live: [live("a", "WORKING"), live("b", "WORKING")], peek, onRowMenu: () => {},
    }));
    expect(markup).toContain('data-hit="hover:a"');
    expect(markup).toContain('data-hit="hover:b"');
    expect(markup).not.toContain('title="Task b"');
  }
});

test("an M row shows no markup from a session's words, and a long call sign stays whole in its tile", () => {
  const m = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [
      { ...live("a", "WORKING", { task: "<notification>Kimi task</notification>" }) },
      { ...live("b", "WORKING"), sign: "PHOENIX-007" },
    ],
    steps: new Map([["s-a", { text: "Background task finished", at: 1, kind: "assistant" }]]),
  }));
  expect(m).toContain('<span class="cw-row__name">Kimi task</span>');
  expect(m).not.toMatch(/&lt;\/?notification/);
  expect(m).toContain('aria-label="PHOENIX-007"');
  expect(m).toContain('<b aria-hidden="true">PHOENIX</b><b aria-hidden="true">007</b>');
});

test("meters settings still show all eligible providers, only high windows, or no gauges", () => {
  const render = (size: WidgetSize, meters: "always" | "high" | "off", readings = quotas) => renderToStaticMarkup(React.createElement(CompanionWidget, {
    size, quotas: readings, asking: 0, readAt: "12:30", meters,
    onSize: () => {}, onRow: () => {}, children: React.createElement("ol", { className: "arv-rows" }),
  }));
  for (const size of ["m", "l"] as const) {
    expect(render(size, "always").match(/class="cw-gauge"/g)).toHaveLength(2);
    expect(render(size, "high").match(/class="cw-gauge"/g)).toHaveLength(1);
    expect(render(size, "high", quotas.map((q) => ({ ...q, used: 40 })))).not.toContain("cw-gauges");
    expect(render(size, "off")).not.toContain("cw-gauges");
    const shortLimit = quotas.map((q) => ({ ...q, used: q.id === "claude5h" ? 90 : 40 }));
    expect(render(size, "high", shortLimit)).not.toContain("cw-gauges");
  }
});

test("M and L share one strip between usage and ordering, with the active order pressed", () => {
  const ordered = { ...actions(0), order: { value: "project" as const, onChange: () => {} } };
  for (const size of ["m", "l"] as const) {
    const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
      size, quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
      live: [live("a", "WORKING")], actions: ordered,
    }));
    expect(markup).toContain('class="cw-order" role="group" aria-label="Order"');
    expect(markup).toMatch(/aria-pressed="true" title="Group by project" aria-label="Order: Project"/);
    expect(markup).toMatch(/aria-pressed="false" title="Latest first" aria-label="Order: Time"/);
    expect(markup).toMatch(/aria-pressed="false"[^>]*aria-label="Order: State"/);
    expect(markup).toMatch(/<div class="cw-tools" data-board-grip=""><div class="cw-gauges".*<span class="cw-order"/s);
    expect(markup.indexOf('class="cw-tools"')).toBeGreaterThan(markup.indexOf('class="cw-top"'));
  }
  const s = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "s", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    actions: ordered,
  }));
  expect(s).not.toContain("cw-order");
});

test("M grouped by project puts a heading over each group's first row", () => {
  const markup = renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    live: [live("a", "WORKING", { project: "apps" }), live("b", "WORKING", { project: "apps" }), live("c", "DONE", { project: "scout" })],
    groups: new Map([["a", "apps"], ["c", "scout"]]),
  }));
  expect(markup.match(/class="cw-group cw-in"/g)).toHaveLength(2);
  expect(markup.match(/class="cw-row cw-in/g)).toHaveLength(3);
  expect(markup.indexOf(">apps</li>")).toBeLessThan(markup.indexOf(">Task a<"));
  expect(markup.indexOf(">scout</li>")).toBeGreaterThan(markup.indexOf(">Task b<"));
  expect(markup.indexOf(">scout</li>")).toBeLessThan(markup.indexOf(">Task c<"));
});

test("M and L put Hide beside New when the host can hide the companion, and leave it out otherwise", () => {
  const render = (onHide?: () => void) => renderToStaticMarkup(React.createElement(CompanionWidget, {
    size: "m", quotas, asking: 0, readAt: "12:30", onSize: () => {}, onRow: () => {}, children: null,
    actions: { ...actions(0), onHide },
  }));
  const hosted = render(() => {});
  expect(hosted).toContain('aria-label="Hide companion"');
  expect(hosted.indexOf('aria-label="New conversation"')).toBeLessThan(hosted.indexOf('aria-label="Hide companion"'));
  expect(hosted.indexOf('aria-label="Hide companion"')).toBeLessThan(hosted.indexOf("cw-mark"));
  expect(render()).not.toContain("Hide companion");
});

const board = (size: WidgetSize, rows: unknown[], extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(CompanionWidget, {
  size, quotas: [], asking: 0, live: rows, onSize: () => {}, onRow: () => {}, children: React.createElement("ol", { className: "arv-rows" }), ...extra,
}));
const bot = { on: false, waiting: 1, onToggle: () => {} };

test("M is quiet when nothing works or asks, and an idle row keeps a dot field", () => {
  const idle = { ...live("a", "DONE"), remark: "IDLE" };
  const quiet = board("m", [idle, live("b", "DONE")]);
  expect(quiet).toContain("cw-widget is-m is-quiet");
  expect(quiet).toContain('class="cw-row__dots"');
  expect(board("m", [idle, live("c", "WORKING")])).not.toContain("is-quiet");
  expect(board("m", [live("d", "ASKING")])).not.toContain("is-quiet");
});

test("Scoutbot stands on M's top edge only when perched and on, in its own pointer region", () => {
  const perched = board("m", [live("a", "WORKING")], { perch: { hit: "popover" }, actions: { bot } });
  expect(perched).toContain('class="cw-perch has-waiting" data-hit="popover"');
  expect(perched).toContain("has-perch");
  expect(perched.indexOf("cw-perch")).toBeLessThan(perched.indexOf("cw-widget"));
  expect(board("m", [], { perch: {}, actions: { bot: null } })).not.toContain("cw-perch");
  expect(board("l", [], { perch: {}, actions: { bot } })).not.toContain("cw-perch");
  expect(board("m", [], { actions: { bot } })).not.toContain("cw-perch");
  // Out on the desk: the edge is empty and the bar still rests closed.
  const out = board("m", [], { perch: { out: true }, actions: { bot } });
  expect(out).not.toContain('class="cw-perch');
  expect(out).toContain("has-perch");
});
