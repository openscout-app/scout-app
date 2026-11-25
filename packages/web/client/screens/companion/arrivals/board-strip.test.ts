import { describe, expect, test } from "bun:test";
import type { TailEvent } from "../../../lib/types.ts";
import { arrivalOrder, barHeights, latestStepBySession, parseBoardFolded, passActivity, plottedSession, stripPage, stripWorthy } from "./board-strip.ts";

const PASS = 30_000;
const at = (sessionId: string, ts: number, kind: TailEvent["kind"] = "tool") =>
  ({ id: `${sessionId}:${ts}`, ts, source: "claude", sessionId, pid: 1, parentPid: null, project: "p", cwd: "/p", harness: "unattributed", kind, summary: "" }) as unknown as TailEvent;

describe("the folded strip", () => {
  test("Folded reads its setting and defaults to five slots", () => {
    expect(parseBoardFolded("row")).toBe("row");
    expect(parseBoardFolded("8")).toBe("8");
    expect(parseBoardFolded(null)).toBe("5");
    expect(parseBoardFolded("12")).toBe("5");
  });

  test("activity counts tool calls and the agent's words per pass, oldest first, inside the window only", () => {
    const passAt = 10 * PASS;
    const events = [
      at("a", passAt - 1),
      at("a", passAt - 2, "assistant"),
      at("a", passAt - PASS - 1),
      at("a", passAt - 1, "user"),
      at("a", passAt - 9 * PASS),
      at("a", passAt),
      at("b", passAt - 8 * PASS),
    ];
    const m = passActivity(events, passAt, 8, PASS);
    expect(m.get("a")).toEqual([0, 0, 0, 0, 0, 0, 1, 2]);
    expect(m.get("b")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("a harness session's pin names what its cell plots; Scout work has none", () => {
    expect(plottedSession("session:abc")).toBe("abc");
    expect(plottedSession("session:scout-session", "session:claude:native-session")).toBe("native-session");
    expect(plottedSession("work-1")).toBeNull();
    expect(plottedSession(null)).toBeNull();
  });

  test("arrival order holds still: places kept, newcomers last, the gone leave", () => {
    expect(arrivalOrder([], ["b", "a"])).toEqual(["b", "a"]);
    expect(arrivalOrder(["b", "a"], ["a", "c", "b"])).toEqual(["b", "a", "c"]);
    expect(arrivalOrder(["b", "a", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });

  test("past its slots the strip turns a page each pass and comes round", () => {
    const order = ["a", "b", "c", "d", "e", "f", "g"];
    expect(stripPage(order, 8, 0, PASS)).toEqual({ shown: order, page: 0, pages: 1 });
    expect(stripPage(order, 3, 0, PASS)).toEqual({ shown: ["a", "b", "c"], page: 0, pages: 3 });
    expect(stripPage(order, 3, PASS, PASS)).toEqual({ shown: ["d", "e", "f"], page: 1, pages: 3 });
    expect(stripPage(order, 3, 2 * PASS, PASS)).toEqual({ shown: ["g"], page: 2, pages: 3 });
    expect(stripPage(order, 3, 3 * PASS, PASS).page).toBe(0);
  });

  test("bars scale to the busiest pass on the strip; an idle pass draws nothing", () => {
    expect(barHeights([0, 1, 5, 10], 10, 13)).toEqual([0, 2, 7, 13]);
    expect(barHeights([3, 0], 0, 13)).toEqual([0, 0]);
  });

  test("the strip holds only agents with something going on", () => {
    expect(stripWorthy("WORKING", false)).toBe(true);
    expect(stripWorthy("QUIET", true)).toBe(true);
    expect(stripWorthy("DONE", false)).toBe(false);
    expect(stripWorthy("QUIET", false)).toBe(false);
    expect(stripWorthy("ENDED", false)).toBe(false);
    expect(stripWorthy("IDLE", false)).toBe(true);
  });

  test("stream lines read each session's newest step: a tool call or its words, never the operator's", () => {
    const step = (sessionId: string, ts: number, kind: TailEvent["kind"], summary: string) => ({ ...at(sessionId, ts, kind), summary }) as TailEvent;
    const m = latestStepBySession([
      step("a", 1, "tool", "Read  board-strip.ts"),
      step("a", 3, "assistant", "Ported the stream lines."),
      step("a", 4, "user", "looks good"),
      step("b", 2, "tool", "bun test"),
      step("b", 5, "tool", "   "),
    ]);
    expect(m.get("a")).toEqual({ text: "Ported the stream lines.", at: 3, kind: "assistant" });
    expect(m.get("b")).toEqual({ text: "bun test", at: 2, kind: "tool" });
  });

  test("a step wrapped in a harness's markup reads as its words, and one that is only markup is no step", () => {
    const step = (sessionId: string, ts: number, kind: TailEvent["kind"], summary: string) => ({ ...at(sessionId, ts, kind), summary }) as TailEvent;
    const m = latestStepBySession([
      step("a", 1, "assistant", '<notification type="task">Background task finished</notification>'),
      step("b", 1, "tool", "bun test"),
      step("b", 2, "assistant", "<notification></notification>"),
    ]);
    expect(m.get("a")).toEqual({ text: "Background task finished", at: 1, kind: "assistant" });
    expect(m.get("b")).toEqual({ text: "bun test", at: 1, kind: "tool" });
  });

  test("what an agent said reads without its Markdown, even cut mid-phrase; a tool call keeps its text", () => {
    const step = (sessionId: string, ts: number, kind: TailEvent["kind"], summary: string) => ({ ...at(sessionId, ts, kind), summary }) as TailEvent;
    const m = latestStepBySession([
      step("a", 1, "assistant", "## Archived-thread sidebar options\n\n- **1. Co"),
      step("b", 1, "tool", "Grep **/*.ts"),
    ]);
    expect(m.get("a")?.text).toBe("Archived-thread sidebar options 1. Co");
    expect(m.get("b")?.text).toBe("Grep **/*.ts");
  });
});
