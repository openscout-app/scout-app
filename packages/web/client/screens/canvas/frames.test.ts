import { describe, expect, test } from "bun:test";
import { framesByWork } from "./frames.ts";

const at = (project: string, worktree: string, lastAt: number) => ({ project, worktree, lastAt });

describe("framesByWork", () => {
  test("sessions in one checkout share a frame, newest work first; main is left over", () => {
    const { frames, rest } = framesByWork([
      at("demo-app", "canvas-arc", 10),
      at("demo-app", "main", 50),
      at("demo-app", "canvas-time", 40),
      at("demo-app", "canvas-arc", 30),
      null,
    ]);
    expect(frames).toEqual([
      { title: "canvas-time", agents: [2] },
      { title: "canvas-arc", agents: [3, 0] },
    ]);
    expect(rest).toEqual([1]);
  });

  test("one session on a branch still names its work", () => {
    expect(framesByWork([at("demo-app", "roster", 1)]).frames).toEqual([{ title: "roster", agents: [0] }]);
  });

  test("the same worktree name in two projects is two pieces of work, titled with the project", () => {
    const { frames } = framesByWork([at("scout", "fix", 2), at("demo-app", "fix", 1)]);
    expect(frames).toEqual([
      { title: "scout · fix", agents: [0] },
      { title: "demo-app · fix", agents: [1] },
    ]);
  });

  test("nothing showing is no frames", () => {
    expect(framesByWork([null, null])).toEqual({ frames: [], rest: [] });
  });
});
