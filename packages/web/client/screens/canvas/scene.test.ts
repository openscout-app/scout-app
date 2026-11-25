import { describe, expect, test } from "bun:test";
import type { CanvasAgent, CanvasFile, CanvasItem, CanvasWork } from "../../../shared/canvas.ts";
import { AREA_COLS, CARD_H, CARD_W, canvasScene, EMBED_H, EMBED_MIN_W, EMBED_W, FILES_H, ROW_W, FRAME_HEAD, litness, overviewScene, squarify } from "./scene.ts";

const agent = (id: string, lastAt: number, state: CanvasAgent["state"] = "quiet"): CanvasAgent => ({
  id, agentId: null, name: id, harness: "claude", project: "p", worktree: id, state, lastAt, now: "", nowFile: null, ref: null, title: null, asked: null,
});
const items = (agentIx: number, n: number): CanvasItem[] => Array.from({ length: n }, (_, i) => ({
  key: `artifact:/${agentIx}/${i}.png`, path: `/${agentIx}/${i}.png`, name: `${i}.png`, kind: "image", agent: agentIx, at: 1000 - i, mt: 0, how: "read",
}));
const work = (agentIx: number, n: number): CanvasWork[] => Array.from({ length: n }, (_, i) => ({
  agent: agentIx, key: `p:src/${i}.ts`, rel: `src/${i}.ts`, edits: 1, reads: 0, add: 1, del: 0, work: n - i, last: 0,
}));

describe("canvasScene", () => {
  test("an area with no files shows two rows of cards; with files, one row and the strip under it", () => {
    const agents = [agent("a", 2), agent("b", 1)];
    const scene = canvasScene(agents, [...items(0, 12), ...items(1, 12)], work(1, 3), 0, new Set());
    const [a, b] = scene.areas;
    expect(a.agent).toBe(0);
    expect(a.shown).toHaveLength(AREA_COLS * 2);
    expect(a.files).toBeNull();
    expect([a.more, a.total]).toEqual([4, 12]);

    expect(b.shown).toHaveLength(AREA_COLS);
    expect(b.files?.tiles.map((t) => t.work.key)).toEqual(["p:src/0.ts", "p:src/1.ts", "p:src/2.ts"]);
    expect(b.files!.box.h).toBe(FILES_H);
    // the strip sits under the cards and closes the area
    const lastCard = scene.boxes.get(b.shown[AREA_COLS - 1].key)!;
    expect(b.files!.box.y).toBeGreaterThan(lastCard.y + lastCard.h);
    expect(b.files!.box.y + b.files!.box.h).toBe(b.box.y + b.box.h);
  });

  test("an embed leads its area, the area's width, and the cards follow under it", () => {
    const embed: CanvasItem = { key: "artifact:/0/d.arc.json", path: "/0/d.arc.json", name: "d.arc.json", kind: "embed", embed: { provider: "arc" }, agent: 0, at: 1, mt: 0, how: "wrote" };
    // the embed is older than the cards, and still comes first
    const scene = canvasScene([agent("a", 2)], [...items(0, 5), embed], [], 0, new Set());
    const [a] = scene.areas;
    expect(a.shown[0].key).toBe(embed.key);
    expect(a.shown).toHaveLength(6);
    const e = scene.boxes.get(embed.key)!;
    expect([e.w, e.h, e.x]).toEqual([EMBED_W, EMBED_H, a.box.x]);
    const first = scene.boxes.get(items(0, 1)[0].key)!;
    expect(first.y).toBeGreaterThan(e.y + e.h);
    expect(first.w).toBe(CARD_W);
    // the area closes under its last row of cards
    const last = scene.boxes.get(a.shown[5].key)!;
    expect(a.box.y + a.box.h).toBe(last.y + CARD_H);
    // an area with only an embed closes under it
    const alone = canvasScene([agent("a", 1)], [embed], [], 0, new Set());
    const b = alone.boxes.get(embed.key)!;
    expect(alone.areas[0].box.y + alone.areas[0].box.h).toBe(b.y + b.h);
    // the default embed spans both columns: the next area starts under it, in the left column
    const two = canvasScene([agent("a", 2), agent("b", 1)], [embed, ...items(1, 1)], [], 0, new Set());
    expect(two.areas[0].box.w).toBe(ROW_W);
    expect(two.areas[1].box.x).toBe(two.areas[0].box.x);
    expect(two.areas[1].box.y).toBeGreaterThan(two.areas[0].box.y + two.areas[0].box.h);
  });

  test("an embed takes the size the operator gave it, kept to what the canvas can lay out", () => {
    const embed: CanvasItem = { key: "artifact:/0/d.arc.json", path: "/0/d.arc.json", name: "d.arc.json", kind: "embed", embed: { provider: "arc" }, agent: 0, at: 1, mt: 0, how: "wrote" };
    const sized = canvasScene([agent("a", 2), agent("b", 1)], [embed, ...items(1, 1)], [], 0, new Set(), null, (k) => (k === embed.key ? { w: 700, h: 400 } : undefined));
    expect(sized.boxes.get(embed.key)).toMatchObject({ w: 700, h: 400 });
    // a column wide: the next area sits beside it, in the other column
    expect(sized.areas[1].box.y).toBe(sized.areas[0].box.y);
    expect(sized.areas[1].box.x).toBeGreaterThan(sized.areas[0].box.x);
    const huge = canvasScene([agent("a", 1)], [embed], [], 0, new Set(), null, () => ({ w: 99_999, h: 10 }));
    expect(huge.boxes.get(embed.key)!.w).toBe(ROW_W);
    expect(huge.boxes.get(embed.key)!.h).toBeGreaterThan(10);
    expect(canvasScene([agent("a", 1)], [embed], [], 0, new Set(), null, () => ({ w: 1, h: 400 })).boxes.get(embed.key)!.w).toBe(EMBED_MIN_W);
  });

  test("a strip is as wide as its files need, and keeps eight until opened out", () => {
    const one = canvasScene([agent("a", 1)], [], work(0, 1), 0, new Set()).areas[0];
    expect(one.files!.box.w).toBe(CARD_W);
    const many = canvasScene([agent("a", 1)], [], work(0, 12), 0, new Set()).areas[0];
    expect(many.files!.tiles).toHaveLength(8);
    expect([many.more, many.total]).toEqual([4, 12]);
    const open = canvasScene([agent("a", 1)], [], work(0, 12), 0, new Set([0])).areas[0];
    expect(open.files!.tiles).toHaveLength(12);
    expect(open.more).toBe(0);
    // tiles stay inside their strip
    for (const t of open.files!.tiles) {
      expect(t.r.x).toBeGreaterThanOrEqual(open.files!.box.x);
      expect(t.r.x + t.r.w).toBeLessThanOrEqual(open.files!.box.x + open.files!.box.w + 0.001);
    }
  });

  test("leaves out quiet agents with nothing to show, keeps those at work, newest first", () => {
    const agents = [agent("old", 1), agent("busy", 3, "working"), agent("shows", 2), null];
    const scene = canvasScene(agents, items(2, 1), [], 0, new Set());
    expect(scene.areas.map((a) => a.agent)).toEqual([1, 2]);
    expect(scene.areas[0].shown).toEqual([]);
  });

  test("with no board there is no Shared column, and the areas start in its place", () => {
    const withShared = canvasScene([agent("a", 1)], items(0, 1), [], 0, new Set());
    const without = canvasScene([agent("a", 1)], items(0, 1), [], null, new Set());
    expect(without.shared.h).toBe(0);
    expect(without.areas[0].box.x).toBeLessThan(withShared.areas[0].box.x);
    expect(without.bounds.w).toBeLessThan(withShared.bounds.w);
  });

  test("areas fill the shorter column first", () => {
    const agents = [agent("a", 3), agent("b", 2), agent("c", 1)];
    const scene = canvasScene(agents, [...items(0, 8), ...items(1, 1), ...items(2, 1)], [], 0, new Set());
    const [a, b, c] = scene.areas;
    expect(b.box.x).toBeGreaterThan(a.box.x);
    expect(c.box.x).toBe(b.box.x);
    expect(c.box.y).toBeGreaterThan(b.box.y);
  });
});

describe("overviewScene", () => {
  test("maps projects, worktrees and files into the view, beside the rail", () => {
    const files: CanvasFile[] = [
      { key: "p:a.ts", project: "p", worktree: "w1", rel: "a.ts", work: 10, last: 0 },
      { key: "p:b.ts", project: "p", worktree: "w2", rel: "b.ts", work: 5, last: 0 },
      { key: "q:c.ts", project: "q", worktree: "w3", rel: "c.ts", work: 5, last: 0 },
    ];
    const ov = overviewScene(files, 1200, 800);
    expect(ov.projects.map((p) => p.name).sort()).toEqual(["p", "q"]);
    expect(ov.trees).toHaveLength(3);
    expect(ov.tiles.size).toBe(3);
    for (const { r } of ov.tiles.values()) expect(r.x + r.w).toBeLessThanOrEqual(1200);
  });
});

test("squarify covers its box in proportion", () => {
  const out = squarify([{ v: 3, item: "a" }, { v: 1, item: "b" }], { x: 0, y: 0, w: 400, h: 100 });
  const area = (k: string) => { const r = out.find((o) => o.item === k)!.r; return r.w * r.h; };
  expect(area("a") + area("b")).toBeCloseTo(40_000);
  expect(area("a") / area("b")).toBeCloseTo(3);
});

test("litness fades over half an hour and is full while an agent is on the file", () => {
  expect(litness(0, 1000, true)).toBe(1);
  expect(litness(0, 1000, false)).toBe(0);
  expect(litness(1000, 1000, false)).toBe(1);
  expect(litness(1000, 1000 + 15 * 60_000, false)).toBeCloseTo(0.5);
  expect(litness(1000, 1000 + 40 * 60_000, false)).toBe(0);
});

describe("canvasScene, grouped", () => {
  const agents = [agent("a", 5, "working"), agent("b", 4, "working"), agent("c", 3, "working"), agent("d", 2)];
  test("each group heads its sessions, both columns start level under it, and the rest follow under their own head", () => {
    const scene = canvasScene(agents, [], [...work(0, 2), ...work(1, 2), ...work(2, 2)], null, new Set(), { frames: [{ title: "Same brief", agents: [1, 2] }], rest: [0, 3] });
    expect(scene.heads.map((h) => [h.title, h.sessions])).toEqual([["Same brief", 2], [null, 1]]);
    const [b, c, a] = scene.areas;
    expect([b.agent, c.agent, a.agent]).toEqual([1, 2, 0]);
    expect(b.box.y).toBe(scene.heads[0].box.y + FRAME_HEAD);
    expect(c.box.y).toBe(b.box.y);
    expect(c.box.x).toBeGreaterThan(b.box.x);
    expect(scene.heads[1].box.y).toBeGreaterThan(b.box.y + b.box.h);
    expect(a.box.y).toBe(scene.heads[1].box.y + FRAME_HEAD);
  });

  test("with no groups the canvas is laid out as it is ungrouped, with no heads", () => {
    const plain = canvasScene(agents, [], work(0, 2), null, new Set());
    const grouped = canvasScene(agents, [], work(0, 2), null, new Set(), { frames: [], rest: [0, 1, 2, 3] });
    expect(grouped.heads).toEqual([]);
    expect(grouped.areas.map((x) => x.box)).toEqual(plain.areas.map((x) => x.box));
  });
});
