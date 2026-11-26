import { describe, expect, test } from "bun:test";
import { arrivalsBetween, distinctAgents, steadyDay, type DayRow } from "./steady-stream.ts";

const view = (rows: readonly DayRow[]) => rows.map((r) => `${r.id}${r.note ? ":note" : ""}${r.arrived ? ":new" : ""}`);
const none = () => false;

describe("steadyDay", () => {
  test("the first paint shows the picks as they are, nothing arrived", () => {
    const { rows, folded } = steadyDay(undefined, ["a", "b"], ["c"], { first: true, mine: none });
    expect(view(rows)).toEqual(["a", "b"]);
    expect(folded).toEqual(["c"]);
  });

  test("a day that shows up later arrives", () => {
    expect(view(steadyDay(undefined, ["a"], [], { first: false, mine: none }).rows)).toEqual(["a:new"]);
  });

  test("a new post arrives at the top; the rest keep the order they were shown in", () => {
    const { rows } = steadyDay(["a", "b", "c"], ["c", "n", "a", "b"], [], { first: false, mine: none });
    expect(view(rows)).toEqual(["n:new", "a", "b", "c"]);
  });

  test("a shown post the re-rank folded stays in its place, out of the fold", () => {
    const { rows, folded } = steadyDay(["a", "b"], ["a", "x"], ["b", "y"], { first: false, mine: none });
    expect(view(rows)).toEqual(["x:new", "a", "b"]);
    expect(folded).toEqual(["y"]);
  });

  test("a shown post that left leaves a note in its place", () => {
    expect(view(steadyDay(["a", "b", "c"], ["a", "c"], [], { first: false, mine: none }).rows)).toEqual(["a", "b:note", "c"]);
  });

  test("a post the operator removed goes", () => {
    const { rows } = steadyDay(["a", "b"], ["a"], [], { first: false, mine: (id) => id === "b" });
    expect(view(rows)).toEqual(["a"]);
  });

  test("a note stays across refreshes, and turns back into the post if it returns", () => {
    const once = steadyDay(["a", "b"], ["a"], [], { first: false, mine: none }).rows.map((r) => r.id);
    expect(view(steadyDay(once, ["a"], [], { first: false, mine: none }).rows)).toEqual(["a", "b:note"]);
    expect(view(steadyDay(once, ["a", "b"], [], { first: false, mine: none }).rows)).toEqual(["a", "b"]);
  });

  test("the same input gives the same rows", () => {
    const prev = ["a", "b"];
    const one = steadyDay(prev, ["n", "a"], ["b"], { first: false, mine: none });
    expect(steadyDay(prev, ["n", "a"], ["b"], { first: false, mine: none })).toEqual(one);
  });
});

describe("arrivals", () => {
  const post = (id: string, at: number, agent = id) => ({ id, at, agent: { name: agent } });
  const map = (...posts: ReturnType<typeof post>[]) => new Map(posts.map((p) => [p.id, p]));

  test("posts the shown stream lacks, newest first", () => {
    const shown = map(post("a", 1));
    const next = map(post("a", 1), post("b", 2), post("c", 3));
    expect(arrivalsBetween(shown, next).map((p) => p.id)).toEqual(["c", "b"]);
  });

  test("one face per agent, at most three", () => {
    const posts = [post("1", 5, "x"), post("2", 4, "x"), post("3", 3, "y"), post("4", 2, "z"), post("5", 1, "w")];
    expect(distinctAgents(posts).map((p) => p.id)).toEqual(["1", "3", "4"]);
  });
});
