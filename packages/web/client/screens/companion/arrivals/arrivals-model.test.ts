import { describe, expect, test } from "bun:test";

import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { DEMO_LOOP_MS, demoThreads } from "./arrivals-demo.ts";
import { agentChoices, anchorBoard, boardInsetStyle, boardName, boardSection, floatingBoardStyle, floatingCorner, floatShareOf, nextFlips, parseBoardCorner, parseBoardInset, plateBox, plateFit, plateShown, rowName, rowNow, rowSpeaker, rowWhere, sectionCount, sinceClock, sinceDay, splitSections, STATUS_WORD } from "./arrivals-model.ts";

function row(id: string, state: CornerThread["state"]): CornerThread {
  return { id, workId: id, conversationId: null, task: id, handle: "openscout-chopin-3", now: "", state, at: 0, request: null, facts: [] };
}

describe("arrivals board", () => {
  test("names drop the project and fit the cells", () => {
    expect(boardName("openscout-chopin-3")).toBe("CHOPIN");
    expect(boardName("a-very-long-agent-handle")).toHaveLength(10);
  });

  test("since is a 24-hour clock", () => {
    expect(sinceClock(new Date(2026, 9, 14, 9, 5).getTime())).toBe("09:05");
    expect(sinceClock(0)).toBe("--:--");
  });

  test("an earlier day says its weekday; today says nothing there", () => {
    const now = new Date(2026, 9, 16, 0, 5).getTime();
    expect(sinceDay(new Date(2026, 9, 16, 0, 1).getTime(), now)).toBeNull();
    expect(sinceDay(new Date(2026, 9, 15, 23, 59).getTime(), now)).toBe("THU");
    expect(sinceDay(new Date(2026, 9, 11, 12, 0).getTime(), now)).toBe("SUN");
    expect(sinceDay(0, now)).toBeNull();
    expect(sinceDay(Number.NaN, now)).toBeNull();
  });

  test("who speaks: the agent, else the harness for a session with no agent", () => {
    expect(rowSpeaker({ handle: "openscout-chopin-3", harness: "claude" })).toBe("chopin");
    expect(rowSpeaker({ handle: "session", harness: "codex" })).toBe("codex");
    expect(rowSpeaker({ handle: "claude", harness: "claude" })).toBe("claude");
    expect(rowSpeaker({ handle: "session", harness: null })).toBe("session");
  });

  test("the first snapshot is settled", () => {
    const flips = nextFlips(null, [row("a", "working")], 1000);
    expect(flips.get("a")!.changedAt).toBe(-Infinity);
  });

  test("a changed status and a new arrival flip; an unchanged row holds", () => {
    const first = nextFlips(null, [row("a", "working"), row("b", "working")], 1000);
    const second = nextFlips(first, [row("a", "asking"), row("b", "working"), row("c", "working")], 2000);
    expect(second.get("a")).toEqual({ status: STATUS_WORD.asking, changedAt: 2000 });
    expect(second.get("b")!.changedAt).toBe(-Infinity);
    expect(second.get("c")!.changedAt).toBe(2000);
  });
});


describe("arrivals demo script", () => {
  test("rows arrive and change on schedule", () => {
    expect(demoThreads(0, new Set(), 0).map((t) => t.id)).not.toContain("demo-descartes");
    const asking = demoThreads(12_000, new Set(), 0).find((t) => t.id === "demo-descartes")!;
    expect(asking.state).toBe("asking");
    expect(demoThreads(DEMO_LOOP_MS + 12_000, new Set(), 0).find((t) => t.id === "demo-descartes")!.state).toBe("asking");
  });

  test("an answered ask moves on to working", () => {
    const row = demoThreads(12_000, new Set(["demo-descartes"]), 0).find((t) => t.id === "demo-descartes")!;
    expect(row.state).toBe("working");
    expect(row.now).toBe("running bun test packages/web");
  });
});


describe("agent choices", () => {
  test("crew first, then most recent, one per id, labels without the project", () => {
    const choices = agentChoices(
      [
        { id: "1", name: "openscout-hume-1", updatedAt: 10 },
        { id: "2", name: "openscout-ada-2", updatedAt: 50 },
        { id: "3", name: "openscout-seneca-3", updatedAt: 5 },
        { id: "2", name: "openscout-ada-2", updatedAt: 50 },
      ],
      ["openscout-seneca-3"],
    );
    expect(choices.map((c) => c.label)).toEqual(["seneca", "ada", "hume"]);
  });
});

describe("agent choice labels", () => {
  test("a readable selector beats a session id name; bare session ids are left out", () => {
    const choices = agentChoices([
      { id: "1", name: "session-mv7czimj-kgu1fq", updatedAt: 99 },
      { id: "2", name: "session-abc123-def", selector: "@openscout-kant-4", updatedAt: 1 },
    ]);
    expect(choices.map((c) => c.label)).toEqual(["kant"]);
  });
});

describe("board sections", () => {
  const row = (state: CornerThread["state"]) => ({ state });
  test("working is out; asking, waiting and ended came back", () => {
    expect(boardSection("working")).toBe("departures");
    expect(boardSection("asking")).toBe("arrivals");
    expect(boardSection("waiting")).toBe("arrivals");
    expect(boardSection("ended")).toBe("arrivals");
  });
  test("split keeps the order inside each section", () => {
    const rows = [{ id: "a", state: "working" as const }, { id: "b", state: "asking" as const }, { id: "c", state: "working" as const }];
    const s = splitSections(rows);
    expect(s.departures.map((r) => r.id)).toEqual(["a", "c"]);
    expect(s.arrivals.map((r) => r.id)).toEqual(["b"]);
  });
  test("folded count leaves out a zero side", () => {
    expect(sectionCount([row("working"), row("working"), row("asking")])).toBe("1 in · 2 out");
    expect(sectionCount([row("ended")])).toBe("1 in");
    expect(sectionCount([])).toBe("");
  });
});

describe("attached plates", () => {
  test("an ask shows with the overlay off; the rest wait for it", () => {
    expect(plateShown("asking", false, false)).toBe(true);
    expect(plateShown("working", false, false)).toBe(false);
    expect(plateShown("working", true, false)).toBe(true);
    expect(plateShown("ended", false, true)).toBe(true);
  });
  test("a plate stands on a window top and hangs under a hang", () => {
    expect(plateBox({ x: 100, y: 50, down: "bottom" }, 40, 20)).toEqual({ left: 80, top: 30 });
    expect(plateBox({ x: 100, y: 50, down: null }, 40, 20)).toEqual({ left: 80, top: 30 });
    expect(plateBox({ x: 100, y: 50, down: "top" }, 40, 20)).toEqual({ left: 80, top: 50 });
    expect(plateBox({ x: 100, y: 50, down: "right" }, 40, 20)).toEqual({ left: 60, top: 40 });
  });
  test("a strip sized to its text keeps the same side of its anchor as a box of known width", () => {
    expect(plateFit({ x: 100, y: 50, down: null }, 20)).toEqual({ left: 100, top: 30, shift: "-50% 0" });
    expect(plateFit({ x: 100, y: 50, down: "top" }, 20)).toEqual({ left: 100, top: 50, shift: "-50% 0" });
    expect(plateFit({ x: 100, y: 50, down: "left" }, 20)).toEqual({ left: 100, top: 40, shift: "0 0" });
    expect(plateFit({ x: 100, y: 50, down: "right" }, 20)).toEqual({ left: 100, top: 40, shift: "-100% 0" });
  });
  test("only the four corners parse", () => {
    expect(parseBoardCorner("top-left")).toBe("top-left");
    expect(parseBoardCorner("middle")).toBeNull();
  });
});

describe("row names", () => {
  const session = { handle: "claude", harness: "claude", project: "openscout", branch: "main" };

  test("an agent goes by its name, uncut, without its project", () => {
    expect(rowName({ handle: "openscout-chopin-3", harness: "claude", task: "Fix the board", project: "openscout" })).toBe("chopin");
    expect(rowName({ handle: "hudson-longname", harness: "codex", task: "x", project: null })).toBe("hudson-longname");
  });

  test("a session with no agent is named by its work, not its harness", () => {
    expect(rowName({ ...session, task: "Board density pass" })).toBe("Board density pass");
    expect(rowName({ handle: "session", harness: null, task: "Port the HUD", project: null })).toBe("Port the HUD");
  });

  test("a placeholder title falls back to the project", () => {
    expect(rowName({ ...session, task: "Claude fda13913" })).toBe("openscout");
    expect(rowName({ ...session, task: "Claude subagent 0a1b2c3d" })).toBe("openscout");
    expect(rowName({ ...session, project: null, task: "Claude fda13913" })).toBe("claude");
  });

  test("a real title that only looks like one stays", () => {
    expect(rowName({ ...session, task: "Add facade" })).toBe("Add facade");
    expect(rowName({ ...session, task: "Claude deadbeef ok" })).toBe("Claude deadbeef ok");
  });

  test("where does not repeat the name", () => {
    expect(rowWhere({ ...session, task: "Board density pass" })).toBe("openscout · main");
    expect(rowWhere({ ...session, task: "Claude fda13913" })).toBe("main · fda13913");
    expect(rowWhere({ ...session, branch: null, task: "Claude fda13913" })).toBe("fda13913");
    expect(rowWhere({ handle: "chopin", harness: "claude", project: null, branch: null, task: "Fix the board" })).toBe("Fix the board");
    expect(rowWhere({ handle: "session", harness: null, project: null, branch: null, task: "Port the HUD" })).toBe("");
  });

  test("the latest line drops a bare placeholder", () => {
    expect(rowNow({ now: "Claude fda13913", harness: "claude" })).toBe("");
    expect(rowNow({ now: "Running tests", harness: "claude" })).toBe("Running tests");
    expect(rowNow({ now: "Claude fda13913", harness: null })).toBe("Claude fda13913");
  });
});

describe("the floating board", () => {
  test("stands on the bottom edge, centred on its share of the width", () => {
    expect(floatingBoardStyle(0.5, 340, 1920)).toEqual({ top: "auto", right: "auto", bottom: "12px", left: "790px" });
    expect(floatingBoardStyle(0.25, 340, 1600)).toEqual({ top: "auto", right: "auto", bottom: "12px", left: "230px" });
  });

  test("keeps the corner's inset from either side", () => {
    expect(floatingBoardStyle(0, 340, 1920).left).toBe("12px");
    expect(floatingBoardStyle(1, 340, 1920).left).toBe("1568px");
    // A board wider than the room left keeps to the left inset.
    expect(floatingBoardStyle(0.5, 2000, 1920).left).toBe("12px");
  });

  test("a drop reads back as the share under the board's middle", () => {
    expect(floatShareOf({ left: 790, width: 340 }, 1920)).toBe(0.5);
    expect(floatShareOf({ left: -400, width: 340 }, 1920)).toBe(0);
    expect(floatShareOf({ left: 1900, width: 340 }, 1920)).toBe(1);
    expect(floatShareOf({ left: 100, width: 340 }, 0)).toBe(0.5);
  });

  test("grows from the bottom corner on its nearer side", () => {
    expect(floatingCorner(0.2)).toBe("bottom-left");
    expect(floatingCorner(0.5)).toBe("bottom-right");
  });
});

describe("moving the board", () => {
  const view = { width: 1600, height: 1000 };

  test("hangs from the corner nearest its middle, at its distance from that corner's edges", () => {
    expect(anchorBoard({ left: 100, top: 80, width: 300, height: 200 }, view)).toEqual({ corner: "top-left", inset: { x: 100, y: 80 } });
    expect(anchorBoard({ left: 1100, top: 700, width: 300, height: 200 }, view)).toEqual({ corner: "bottom-right", inset: { x: 200, y: 100 } });
    expect(anchorBoard({ left: 1200, top: 40, width: 300, height: 200 }, view)).toEqual({ corner: "top-right", inset: { x: 100, y: 40 } });
  });

  test("never leaves the display", () => {
    expect(anchorBoard({ left: -50, top: 950, width: 300, height: 200 }, view)).toEqual({ corner: "bottom-left", inset: { x: 0, y: 0 } });
    expect(anchorBoard({ left: 1500, top: -30, width: 300, height: 200 }, view)).toEqual({ corner: "top-right", inset: { x: 0, y: 0 } });
  });

  test("the inset becomes the corner's two offsets, the corner's own 12px without one", () => {
    expect(boardInsetStyle("bottom-right", null)).toEqual({ top: "auto", right: "12px", bottom: "12px", left: "auto" });
    expect(boardInsetStyle("top-left", { x: 40, y: 300 })).toEqual({ top: "300px", right: "auto", bottom: "auto", left: "40px" });
  });

  test("a stored inset reads back, and anything else is no inset", () => {
    expect(parseBoardInset('{"x":40.4,"y":12}')).toEqual({ x: 40, y: 12 });
    expect(parseBoardInset({ x: -5, y: 3 })).toEqual({ x: 0, y: 3 });
    expect(parseBoardInset("nope")).toBeNull();
    expect(parseBoardInset({ x: "1", y: 2 })).toBeNull();
    expect(parseBoardInset(null)).toBeNull();
  });
});
