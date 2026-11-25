import { expect, test } from "bun:test";

import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { DEMO_DESK, demoDesk } from "./desk-demo.ts";

const row = (id: string): CornerThread => ({
  id, workId: null, conversationId: null, task: "t", handle: id, now: "n", state: "working", at: 0, request: null, facts: [],
});

test("the demo desk pins the agents it stands up, where it puts them, and only those that are on the board", () => {
  const { threads, figures } = demoDesk([row("demo-ada"), row("demo-other")], { width: 1000, height: 800 });
  expect(threads.find((t) => t.id === "demo-ada")!.pinId).toBe("demo-ada");
  expect(threads.find((t) => t.id === "demo-other")!.pinId).toBeUndefined();
  expect(figures.map((f) => f.workId)).toEqual(["demo-ada"]);
  const at = DEMO_DESK.find((d) => d.id === "demo-ada")!;
  expect(figures[0]!.anchor).toMatchObject({ x: Math.round(at.x * 1000), y: Math.round(at.y * 800), down: null, covered: false });
});
