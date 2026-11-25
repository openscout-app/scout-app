import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
const between = (a: string, b: string) => engine.slice(engine.indexOf(a), engine.indexOf(b, engine.indexOf(a)));
const compile = (code: string, env: Record<string, unknown>, result: string) => new Function(...Object.keys(env), `${code}; return ${result};`)(...Object.values(env));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

test("Find bounds DOM to 50 results, keeps global row indices, and reuses DOM within a page", () => {
  let writes = 0, html = "";
  const elements: { dataset: { pi: string }; classList: { toggle: () => void }; setAttribute: () => void }[] = [];
  const pal = {
    get innerHTML() { return html; },
    set innerHTML(value: string) { html = value; writes++; elements.splice(0, elements.length, ...[...html.matchAll(/data-pi="(\d+)"/g)].map(m => ({ dataset: { pi: m[1]! }, classList: { toggle() {} }, setAttribute() {} }))); },
    hidden: true, querySelector: () => ({ scrollIntoView() {} }), querySelectorAll: () => elements,
  };
  const rows = Array.from({ length: 10000 }, (_, i) => ({ kind: "ASK", name: "work " + i, target: { type: "ask", a: {} } }));
  const api = compile(`let findRows = [], palSel = 0, findRenderedRows = null, findPageStart = -1; ${between("function paintFind(", "function commitFind(")}`, {
    pal, clamp, esc: String, $: () => ({ value: "work", setAttribute() {} }), findResults: () => rows, findIndex: [], previewFind() {},
  }, "{ paintFind, move: i => { palSel = i; paintFind(); }, count: () => findRows.length }");
  api.paintFind(true);
  expect(api.count()).toBe(10000); expect(elements).toHaveLength(50);
  expect(html).toContain("FIND · 10000"); expect(html).toContain('data-pi="49"');
  api.move(49); expect(writes).toBe(1);
  api.move(50); expect(writes).toBe(2); expect(elements).toHaveLength(50);
  expect(html).toContain('data-pi="50"'); expect(html).toContain('data-pi="99"');
  api.move(9999); expect(elements).toHaveLength(50); expect(html).toContain('data-pi="9999"');
  expect(html).toContain('data-find-page="-1"');
});

test("slow paints refresh agent, lane and delivery inspectors after the current trouble scan", () => {
  const stack = [{ type: "agent" }], calls: unknown[] = [];
  let scanned = false;
  const code = between("const LIVE_VIEWS =", "/* ================= time control");
  const env: Record<string, unknown> = { PERF: null, focusAgent: null, insp: { hidden: false }, inspStack: stack,
    renderInspector: (preserve: boolean) => { expect(scanned).toBe(true); calls.push(preserve); },
    pt: (_key: string, fn: () => void) => fn(), scanTrouble: () => { scanned = true; } };
  for (const [, name] of code.matchAll(/pt\("[^"]+", (\w+)\)/g)) if (!(name! in env)) env[name!] = () => {};
  const paint = compile(code, env, "paintSlow");
  for (const type of ["agent", "lane", "delivery"]) { stack[0] = { type }; scanned = false; paint(); }
  expect(calls).toEqual([true, true, true]);
});

test("a live inspector refresh keeps the selected ask identity and the reader's scroll position", () => {
  const a = { task: "first", ts: 1 }, selected = { task: "selected", ts: 2 }, latest = { task: "new arrival", ts: 3 }, agent = {};
  const body = { innerHTML: "", scrollTop: 123, querySelector: () => ({ scrollIntoView() { body.scrollTop = 999; } }), querySelectorAll: () => [] };
  const helper = engine.includes("function inspectorSelectionIndex(") ? between("function inspectorSelectionIndex(", "function renderInspector(") : "";
  const code = `let inspItems = [{type: 'ask', a: selected}], inspSel = 0; const row = (item, label) => { inspItems.push(item); return label; }; ${helper} ${between("function renderInspector(", '$("inspBody").addEventListener("click"')}`;
  const refresh = compile(code, { selected, clamp, inspStack: [{ type: "agent", agent }], T: 10, esc: String, spoken: () => "agent", kv: () => "",
    hostLabel: () => "host", actorHost: () => "host", stateAt: () => "flight", syncPreview() {},
    rosterAll: [{ a: agent, list: [a, selected, latest] }], $: (id: string) => id === "inspBody" ? body : { textContent: "" },
  }, "{ renderInspector, selected: () => inspItems[inspSel] }");
  refresh.renderInspector(true);
  expect(body.innerHTML).toContain("new arrival");
  expect(refresh.selected().a).toBe(selected);
  expect(body.scrollTop).toBe(123);
});

test("lane refreshes include new sessions and completed deliveries no longer say STUCK", () => {
  const helper = engine.includes("function inspectorSelectionIndex(") ? between("function inspectorSelectionIndex(", "function renderInspector(") : "";
  const lane = { name: "web", key: "/web" }, sessions = [{ lane, t0: 1, h: "codex", sid: "first" }];
  const d = { ts: 1, st: "o", done: null as number | null, task: "review" };
  const stack: { type: string; lane?: object; d?: object }[] = [{ type: "lane", lane }];
  const body = { innerHTML: "", scrollTop: 55, querySelector: () => null, querySelectorAll: () => [] };
  const render = compile(`let inspItems = [], inspSel = 0; const row = (item, label) => { inspItems.push(item); return label; }; ${helper} ${between("function renderInspector(", '$("inspBody").addEventListener("click"')}`, {
    inspStack: stack, sessions, T: 100, clamp, esc: String, kv: (k: string, v: string) => `${k}: ${v}`, laneHosts: () => "host", hhmm: () => "",
    trouble: { stuck: [d] }, troubleWho: () => "agent", dur: () => "42M", syncPreview() {},
    isUndeliverable: () => false, dayTag: () => "", openRows: () => "", idRows: () => "", dlvLocal: () => true,
    isFailed: (item: typeof d) => item.st === "f" && item.done !== null && item.done <= 100,
    $: (id: string) => id === "inspBody" ? body : { textContent: "" },
  }, "renderInspector");
  render(true); expect(body.innerHTML).not.toContain("new session");
  sessions.push({ lane, t0: 2, h: "claude", sid: "new session" });
  render(true); expect(body.innerHTML).toContain("new session"); expect(body.scrollTop).toBe(55);
  stack[0] = { type: "delivery", d };
  render(true); expect(body.innerHTML).toContain("STUCK 42M");
  d.done = 90; d.st = "c";
  render(true); expect(body.innerHTML).toContain("STATE: DONE"); expect(body.innerHTML).not.toContain("STUCK");
});

test("an undeliverable message shows its ids, opens its session, conversation and flight, and offers Dismiss while open", () => {
  const helpers = between("// a selection's ids, copyable", "function diffFiles(") + between("function inspectorSelectionIndex(", "function renderInspector(");
  const d = { ts: 1, st: "o", done: null as number | null, task: "reconcile notice", toName: "session-a", ended: 50,
    ids: { delivery: "dlv-1", target: "session-a", message: "msg-1", flight: "flt-1", conversation: "conv-1" } };
  const body = { innerHTML: "", scrollTop: 0, querySelector: () => null, querySelectorAll: () => [] };
  const out = compile(`let inspItems = [], inspSel = 0; const row = (item, label) => { inspItems.push(item); return "[" + label + "]"; }; ${helpers} ${between("function renderInspector(", '$("inspBody").addEventListener("click"')}`, {
    inspStack: [{ type: "delivery", d }], T: 100, clamp, esc: String, kv: (k: string, v: string) => `${k}: ${v}`, hhmm: () => "", dayTag: () => "",
    trouble: { stuck: [] }, troubleWho: () => "system", dur: () => "", syncPreview() {}, TEAM_HOSTS: [], SELF_HOST: null, actorHost: () => null,
    isFailed: () => false, isUndeliverable: (o: typeof d, t: number) => o.done == null && o.ended != null && o.ended <= t,
    $: (id: string) => id === "inspBody" ? body : { textContent: "" },
  }, "{ renderInspector, items: () => inspItems }");
  out.renderInspector();
  expect(body.innerHTML).toContain("STATE: UNDELIVERABLE");
  const items = out.items() as { type: string; path?: string; text?: string }[];
  expect(items.filter(i => i.type === "nav").map(i => i.path)).toEqual(["/sessions/session-a", "/c/conv-1", "/flights/flt-1/observe"]);
  expect(items.filter(i => i.type === "copy").map(i => i.text)).toEqual(["dlv-1", "session-a", "msg-1", "flt-1", "conv-1"]);
  expect(items.some(i => i.type === "dismiss")).toBe(true);
  d.done = 90; d.st = "c";
  out.renderInspector();
  expect((out.items() as { type: string }[]).some(i => i.type === "dismiss")).toBe(false);
});
