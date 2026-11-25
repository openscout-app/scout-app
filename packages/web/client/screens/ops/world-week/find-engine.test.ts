import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Exercise the engine's actual selection projections with normalized records, without a WebGL renderer.
const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
const selectionCode = engine.slice(engine.indexOf("const workTarget ="), engine.indexOf("const sliceStart ="));
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(selectionCode);
function setup() {
  const lane = { idx: 2, key: "/repo", name: "web" }, agent = { id: "planck", lane },
    ask = { ts: 1, tg: agent, work: { s: 0 } }, other = { ts: 2, tg: agent, work: { s: 0 } },
    session = { i: 0, lane }, event = { i: 8, sess: 0, lane };
  const notices: unknown[] = [], paints: string[] = [];
  const env = {
    sessions: [session], trouble: { stuck: [ask], failed: [] }, T: 100,
    askBySess: new Map([[0, [ask, other]]]), askOfEvent: () => ask,
    laneFor: (a: typeof agent) => a.lane, lanes: [lane], troubleLane: () => lane,
    rosterCache: [{ a: agent }], stallCache: [ask], rosterSel: -1, stallSel: -1, laneSel: -1,
    uniforms: { uPick: { value: -1 }, uSel: { value: -1 } }, opts: { onSelect: (t: unknown) => notices.push(t) },
    paintStalls: () => paints.push("stalls"), paintRunning: () => paints.push("running"),
    paintRoster: () => paints.push("roster"), paintLanes: () => paints.push("lanes"),
  };
  const api = new Function(...Object.keys(env), `let selection = null; ${js}; return { select, selectionWork, selectionAgent, selectionLane, selectionSession, cursors: () => [rosterSel, stallSel, laneSel], picked: () => uniforms.uPick.value };`)(...Object.values(env));
  return { ...api, lane, agent, ask, session, event, notices, paints };
}

test("queue, session thread and event picks project to the same stuck ask, roster agent and lane", () => {
  const s = setup();
  for (const target of [{ type: "ask", a: s.ask }, { type: "session", s: s.session }, { type: "event", e: s.event }]) {
    s.select(target);
    expect(s.selectionWork()).toBe(s.ask);
    expect(s.selectionAgent()).toBe(s.agent);
    expect(s.selectionLane()).toBe(s.lane);
    expect(s.cursors()).toEqual([0, 0, 2]);
  }
  expect(s.picked()).toBe(8);
  expect(s.paints).toContain("running");
});

test("public select notifies only identity changes and clears every object projection together", () => {
  const s = setup(), target = { type: "ask", a: s.ask };
  s.select(target); s.select({ ...target });
  expect(s.notices).toEqual([target]);
  s.select({ type: "lane", lane: s.lane });
  expect(s.selectionWork()).toBeNull(); expect(s.selectionAgent()).toBeNull();
  expect(s.selectionLane()).toBe(s.lane);
  s.select(null);
  expect(s.selectionWork()).toBeNull(); expect(s.selectionLane()).toBeNull(); expect(s.picked()).toBe(-1);
  expect(s.notices).toHaveLength(3);
});

test("Find snapshots and restores camera, playhead and selection; Enter keeps its result set for N", () => {
  const open = engine.slice(engine.indexOf("function openFind("), engine.indexOf("function previewFind("));
  const cancel = engine.slice(engine.indexOf("function cancelFind("), engine.indexOf("function stepFind("));
  const commit = engine.slice(engine.indexOf("function commitFind("), engine.indexOf("function cancelFind("));
  expect(open).toContain("selection, flight, ride, focus");
  expect(open).toContain("setPlaying(false, false)");
  expect(open).toContain("setSlicing(false, false)");
  expect(cancel).toContain("setSlicing(before.slicing, false)");
  expect(cancel).toContain("select(before.selection)");
  expect(cancel).toContain("Object.assign(camGoal, before.goal)");
  expect(cancel).toContain("Object.assign(cam, before.cam)");
  expect(commit).toContain("lastFind = findRows.slice()");
  expect(commit).toContain("activateTarget(row.target)");
});
