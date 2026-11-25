import { describe, expect, test } from "bun:test";
import type { CanvasAgent, CanvasWork } from "../../../shared/canvas.ts";
import { ASK_QUESTIONS, askAgent, askRequest } from "./ask.ts";

const agent: CanvasAgent = {
  id: "14bb1f8a", agentId: null, name: "", harness: "claude", project: "demo-app", worktree: "territory-studies", state: "working",
  lastAt: 0, now: "", nowFile: null, ref: null, title: null, asked: "Build two studies.",
};
const work = (agentIx: number, rel: string, w: number): CanvasWork => ({ agent: agentIx, key: `p:${rel}`, rel, edits: 1, reads: 0, add: w, del: 1, work: w, last: 0 });

describe("askAgent", () => {
  test("carries what it was asked and said, and its own files, busiest first", () => {
    const a = askAgent(agent, "territory-studies", "Now the shared map.", [work(0, "small.ts", 2), work(1, "other.ts", 99), work(0, "big.ts", 40)], 0);
    expect(a).toEqual({ name: "territory-studies", harness: "claude", state: "working", asked: "Build two studies.", said: "Now the shared map.", files: ["big.ts (+40 -1)", "small.ts (+2 -1)"] });
  });
  test("leaves out what is not known", () => {
    const a = askAgent({ ...agent, asked: null }, "x", undefined, [], 0);
    expect("asked" in a || "said" in a).toBe(false);
  });
});

describe("askRequest", () => {
  test("is the question, the artifact and the agent", () => {
    const artifact = { what: "changed file", path: "a.ts", content: "+x", contentKind: "diff" as const };
    expect(askRequest("  What   changed? ", artifact, null)).toEqual({ question: "What changed?", artifact });
  });
});

test("every kind offers questions, each a question", () => {
  for (const list of Object.values(ASK_QUESTIONS)) {
    expect(list.length).toBeGreaterThan(2);
    for (const q of list) expect(q.endsWith("?")).toBe(true);
  }
});
