import { describe, expect, test } from "bun:test";

import type { Remark } from "./arrivals-model.ts";
import { groupHeads, NO_PROJECT, orderRows, parseBoardOrder } from "./board-order.ts";

const row = (id: string, remark: Remark, at: number, project: string | null = null) => ({ id, remark, thread: { project, at, since: undefined } });

describe("board order", () => {
  const rows = [
    row("w1", "WORKING", 100, "scout"),
    row("d1", "DONE", 300, "apps"),
    row("a1", "ASKING", 200, "scout"),
    row("w2", "WORKING", 400, null),
    row("e1", "ENDED", 50, "apps"),
  ];

  test("an unknown or missing choice reads as state", () => {
    expect(parseBoardOrder(null)).toBe("state");
    expect(parseBoardOrder("nonsense")).toBe("state");
    expect(parseBoardOrder("project")).toBe("project");
    expect(parseBoardOrder("time")).toBe("time");
  });

  test("state: asks, then what came back, what ended, then what is still out; ties keep their order", () => {
    expect(orderRows(rows, "state").map((r) => r.id)).toEqual(["a1", "d1", "e1", "w1", "w2"]);
  });

  test("time: the latest state change first", () => {
    expect(orderRows(rows, "time").map((r) => r.id)).toEqual(["w2", "d1", "a1", "w1", "e1"]);
  });

  test("time reads when the state began, not the last change", () => {
    const began = [{ ...row("x", "WORKING", 900), thread: { project: null, at: 900, since: 10 } }, row("y", "WORKING", 500)];
    expect(orderRows(began, "time").map((r) => r.id)).toEqual(["y", "x"]);
  });

  test("project: groups by name, no project last, each by state then time", () => {
    const shown = orderRows(rows, "project");
    expect(shown.map((r) => r.id)).toEqual(["d1", "e1", "a1", "w1", "w2"]);
    expect([...groupHeads(shown, "project")]).toEqual([["d1", "apps"], ["a1", "scout"], ["w2", NO_PROJECT]]);
  });

  test("only the project order has headings", () => {
    expect(groupHeads(orderRows(rows, "state"), "state").size).toBe(0);
    expect(groupHeads(orderRows(rows, "time"), "time").size).toBe(0);
  });

  test("project names compare without case, and a blank project is no project", () => {
    const mixed = [row("b", "DONE", 1, "Beta"), row("a", "DONE", 1, "alpha"), row("n", "DONE", 1, "  ")];
    const shown = orderRows(mixed, "project");
    expect(shown.map((r) => r.id)).toEqual(["a", "b", "n"]);
    expect(groupHeads(shown, "project").get("n")).toBe(NO_PROJECT);
  });
});
