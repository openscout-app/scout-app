import { describe, expect, test } from "bun:test";
import type { TailEvent } from "../../lib/types.ts";
import { areaAt, blockName, fileOf, glance, GLANCE_AREAS, GLANCE_BLOCKS, GLANCE_SHIP_MS, ships, type GlanceAgent } from "./glance.ts";

const NOW = 1_800_000_000_000;

function call(id: string, sessionId: string, summary: string, ts: number, kind: TailEvent["kind"] = "tool"): TailEvent {
  return { id, ts, source: "claude", sessionId, pid: 1, parentPid: null, project: "p", cwd: "/p", harness: "unattributed" as TailEvent["harness"], kind, summary };
}
const agent = (id: string, sessionId: string | null = id): GlanceAgent => ({ id, sessionId, name: id, harness: "claude", project: "demo-app", asks: false });

describe("what a call names", () => {
  test("file tools name their file", () => {
    expect(fileOf({ kind: "tool", summary: "Edit broker/service.ts" })).toBe("broker/service.ts");
    expect(fileOf({ kind: "tool", summary: "Read views/scout-tail.tsx" })).toBe("views/scout-tail.tsx");
  });

  test("a command names the file in it", () => {
    expect(fileOf({ kind: "tool", summary: "sed -n '1,80p' client/app.tsx" })).toBe("client/app.tsx");
  });

  test("no file, a URL, a version or a reply: nothing", () => {
    expect(fileOf({ kind: "tool", summary: "git status" })).toBeNull();
    expect(fileOf({ kind: "tool", summary: "curl https://openscout.app/index.html" })).toBeNull();
    expect(fileOf({ kind: "tool", summary: "bump 0.2.72" })).toBeNull();
    expect(fileOf({ kind: "assistant", summary: "Edit broker/service.ts" })).toBeNull();
  });

  test("showing, pushing, opening a PR or capturing ships", () => {
    expect(ships({ kind: "tool", summary: "scout show shot.png" })).toBe(true);
    expect(ships({ kind: "tool", summary: "git push -u origin home/wide" })).toBe(true);
    expect(ships({ kind: "tool", summary: "gh pr create --fill" })).toBe(true);
    expect(ships({ kind: "tool", summary: "git status" })).toBe(false);
  });
});

describe("what a block is called", () => {
  test("is its file's name, without the folders", () => {
    expect(blockName("tools/chart_weekday.py")).toBe("chart_weekday.py");
    expect(blockName("client/app.tsx")).toBe("app.tsx");
    expect(blockName("README.md")).toBe("README.md");
    expect(blockName("docs/")).toBe("docs");
  });
});

describe("the glance", () => {
  test("an area per agent, a block per file, the cursor on the newest file's block", () => {
    const g = glance([agent("a")], [
      call("1", "a", "Read client/one.ts", NOW - 50_000),
      call("2", "a", "Edit client/two.ts", NOW - 40_000),
      call("3", "a", "Read client/one.ts", NOW - 30_000),
    ], NOW);
    const [area] = g.areas;
    expect(area!.blocks.map((b) => b.key)).toEqual(["client/one.ts", "client/two.ts"]);
    const one = area!.blocks[0]!.box;
    expect(area!.cursor.x).toBeGreaterThan(one.x);
    expect(area!.cursor.x).toBeLessThan(one.x + one.w);
  });

  test("an area keeps its newest few calls, newest first, and the file its cursor is on, for the hover card", () => {
    const calls = Array.from({ length: 6 }, (_, i) => call(`c${i}`, "a", `Edit f/file${i}.ts`, NOW - 60_000 + i * 1_000));
    const [area] = glance([agent("a")], [...calls, call("x", "a", "  ", NOW - 1)], NOW).areas;
    expect(area!.recent.map((c) => c.summary)).toEqual(["Edit f/file5.ts", "Edit f/file4.ts", "Edit f/file3.ts", "Edit f/file2.ts"]);
    expect(area!.file).toBe("f/file5.ts");
    expect(glance([agent("b")], [], NOW).areas[0]!.recent).toEqual([]);
  });

  test("blocks keep their place when the cursor moves", () => {
    const first = glance([agent("a")], [call("1", "a", "Read x/one.ts", NOW - 50_000), call("2", "a", "Edit x/two.ts", NOW - 40_000)], NOW);
    const later = glance([agent("a")], [call("1", "a", "Read x/one.ts", NOW - 50_000), call("2", "a", "Edit x/two.ts", NOW - 40_000), call("3", "a", "Read x/one.ts", NOW - 1_000)], NOW);
    expect(later.areas[0]!.blocks.map((b) => b.box)).toEqual(first.areas[0]!.blocks.map((b) => b.box));
    expect(later.areas[0]!.cursor).not.toEqual(first.areas[0]!.cursor);
  });

  test("a few blocks per area and a few areas", () => {
    const calls = Array.from({ length: 12 }, (_, i) => call(`c${i}`, "a", `Edit f/file${i}.ts`, NOW - 60_000 + i));
    expect(glance([agent("a")], calls, NOW).areas[0]!.blocks).toHaveLength(GLANCE_BLOCKS);
    const many = Array.from({ length: 9 }, (_, i) => agent(`s${i}`));
    expect(glance(many, [], NOW).areas).toHaveLength(GLANCE_AREAS);
  });

  test("an agent with no calls sits at its area's head; other sessions' calls are not its own", () => {
    const g = glance([agent("a"), agent("b", null)], [call("1", "z", "Edit x/one.ts", NOW)], NOW);
    expect(g.areas.every((a) => a.blocks.length === 0)).toBe(true);
  });

  test("a recent ship pulses where its agent's cursor is; an old one does not", () => {
    const g = glance([agent("a")], [
      call("1", "a", "Edit x/one.ts", NOW - 20_000),
      call("2", "a", "scout show shot.png", NOW - 10_000),
      call("3", "a", "git push", NOW - GLANCE_SHIP_MS - 1),
    ], NOW);
    expect(g.ships.map((s) => s.id)).toEqual(["2"]);
    expect({ x: g.ships[0]!.x, y: g.ships[0]!.y }).toEqual(g.areas[0]!.cursor);
  });

  test("areas fill a wide box: six agents sit in more than one row, all inside the bounds", () => {
    const g = glance(Array.from({ length: 6 }, (_, i) => agent(`s${i}`)), [], NOW);
    const rows = new Set(g.areas.map((a) => a.box.y));
    expect(rows.size).toBeGreaterThan(1);
    for (const a of g.areas) {
      expect(a.box.x + a.box.w).toBeLessThanOrEqual(g.bounds.w);
      expect(a.box.y + a.box.h).toBeLessThanOrEqual(g.bounds.h);
    }
  });

  test("a point finds its area", () => {
    const g = glance([agent("a"), agent("b")], [], NOW);
    const b = g.areas[1]!.box;
    expect(areaAt(g, { x: b.x + 5, y: b.y + 5 })?.id).toBe("b");
    expect(areaAt(g, { x: -10, y: -10 })).toBeNull();
  });
});
