import { describe, expect, test } from "bun:test";
import type { CanvasAgent, CanvasItem, CanvasWork } from "../../../shared/canvas.ts";
import { canvasScene } from "./scene.ts";
import { onlyThis, rosterOf, showAll, shownBy, toggled, visibleAgents } from "./visibility.ts";

const RANK = { asks: 0, working: 1, quiet: 2 } as const;
const agent = (id: string, lastAt: number, state: CanvasAgent["state"] = "quiet", project = "p"): CanvasAgent => ({
  id, agentId: null, name: id, harness: "claude", project, worktree: id, state, lastAt, now: "", nowFile: null, ref: null, title: null, asked: null,
});
const item = (agentIx: number, i = 0): CanvasItem => ({
  key: `artifact:/${agentIx}/${i}.png`, path: `/${agentIx}/${i}.png`, name: `${i}.png`, kind: "image", agent: agentIx, at: 1000 - i, mt: 0, how: "read",
});
const file = (agentIx: number): CanvasWork => ({ agent: agentIx, key: `p:src/${agentIx}.ts`, rel: `src/${agentIx}.ts`, edits: 1, reads: 0, add: 1, del: 0, work: 1, last: 0 });

describe("visibleAgents", () => {
  const agents = [agent("a", 3), agent("b", 2, "working"), agent("c", 1, "quiet", "q")];
  test("leaves out other projects and hidden agents, keeping indexes", () => {
    const v = visibleAgents(agents, { project: "p", hidden: new Set(["b"]) });
    expect(v.map((a) => a?.id ?? null)).toEqual(["a", null, null]);
  });
  test("every project, nothing hidden: everyone", () => {
    expect(visibleAgents(agents, { project: null, hidden: new Set() }).every(Boolean)).toBe(true);
  });
  test("a hidden agent has no area, so the scene's bounds shrink to what is shown", () => {
    const items = [item(0), item(1)];
    const all = canvasScene(visibleAgents(agents, { project: null, hidden: new Set() }), items, [], null, new Set());
    const some = canvasScene(visibleAgents(agents, { project: null, hidden: new Set(["a"]) }), items.filter((it) => it.agent !== 0), [], null, new Set());
    expect(all.areas.map((a) => a.agent)).toEqual([0, 1]);
    expect(some.areas.map((a) => a.agent)).toEqual([1]);
    // two areas fill both columns; with one hidden, the second column goes, and Fit has less to take in
    expect(some.bounds.w).toBeLessThan(all.bounds.w);
  });
});

describe("rosterOf", () => {
  test("lists agents with work or at work, asking first, then newest; quiet ones with nothing are left out", () => {
    const agents = [agent("quiet-idle", 9), agent("made", 5), agent("worked", 7), agent("asks", 1, "asks"), agent("other", 8, "working", "q")];
    expect(rosterOf(agents, [item(1)], [file(2)], "p", RANK)).toEqual([3, 2, 1]);
    expect(rosterOf(agents, [item(1)], [file(2)], null, RANK)).toEqual([3, 4, 2, 1]);
  });

  test("a step to another window lists that window's agents, and an agent hidden in one stays hidden in the next", () => {
    const hidden = new Set(["b"]);
    // now: a and b at work; a past window, where every agent is quiet: c and b with something to show, idle with nothing
    const now = [agent("a", 9, "working"), agent("b", 8, "working")];
    const past = [agent("c", 3), agent("b", 2), agent("idle", 1)];
    expect(rosterOf(now, [], [], "p", RANK)).toEqual([0, 1]);
    expect(rosterOf(past, [item(1)], [file(0)], "p", RANK)).toEqual([0, 1]);
    // the hidden set is by id, so b stays hidden at its new index
    expect(visibleAgents(now, { project: "p", hidden }).map((a) => a?.id ?? null)).toEqual(["a", null]);
    expect(visibleAgents(past, { project: "p", hidden }).map((a) => a?.id ?? null)).toEqual(["c", null, "idle"]);
  });
});

describe("hide and show", () => {
  test("toggled flips one agent", () => {
    expect([...toggled(new Set(["a"]), "a")]).toEqual([]);
    expect([...toggled(new Set(), "a")]).toEqual(["a"]);
  });
  test("only this hides the rest of the list and shows this one, leaving agents outside the list alone", () => {
    expect([...onlyThis(new Set(["b", "elsewhere"]), ["a", "b", "c"], "b")].sort()).toEqual(["a", "c", "elsewhere"]);
  });
  test("show all clears the list's agents only", () => {
    expect([...showAll(new Set(["a", "elsewhere"]), ["a", "b"])]).toEqual(["elsewhere"]);
  });
});

describe("embeds follow the same filter", () => {
  const agents = [agent("drives", 3), agent("other", 2)];
  const embed: CanvasItem = {
    key: "artifact:/0/d.arc.json", path: "/0/d.arc.json", name: "d.arc.json", kind: "embed", embed: { provider: "arc" }, agent: 0, at: 1, mt: 0, how: "wrote",
  };
  const items = [embed, item(1)];
  const sceneOf = (hidden: Set<string>) => {
    const here = visibleAgents(agents, { project: null, hidden });
    return canvasScene(here, shownBy(items, here), [], null, new Set());
  };
  test("hiding the agent that drives an embed takes the embed off the canvas; showing it brings it back", () => {
    expect(sceneOf(new Set()).boxes.has(embed.key)).toBe(true);
    const hid = sceneOf(new Set(["drives"]));
    expect(hid.boxes.has(embed.key)).toBe(false);
    expect(hid.areas.map((a) => a.agent)).toEqual([1]);
    expect(sceneOf(new Set()).boxes.get(embed.key)).toEqual(sceneOf(new Set(["other"])).boxes.get(embed.key));
  });
  test("an agent whose only work is an embed is still in the roster, so it can be shown again", () => {
    expect(rosterOf(agents, [embed], [], "p", RANK)).toEqual([0]);
  });
});
