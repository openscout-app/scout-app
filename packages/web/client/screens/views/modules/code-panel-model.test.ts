import { describe, expect, test } from "bun:test";
import type { Route } from "../../../lib/types.ts";
import {
  filePlan,
  fileOptionLabel,
  moreChanges,
  ownFile,
  pageCodeTarget,
  pinnedRoot,
  pinPatch,
  rootPlan,
  splitChangedPath,
  unpinPatch,
} from "./code-panel-model.ts";
import { createCodePicks, RECENT_PICKS_LIMIT } from "./code-pick.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

const MAIN = "/example/workstation-user/dev/openscout";
const WT = "/example/workstation-user/dev/openscout-worktrees/comms";
const roots = [MAIN, WT];
const code = (over: Partial<Extract<Route, { view: "code" }>> = {}): Route => ({ view: "code", ...over });

describe("what a page names to read", () => {
  test("a project, a repo, a diff's checkout; the Code route itself", () => {
    expect(pageCodeTarget({ view: "agents-v2", projectSlug: "pomo" })).toEqual({ project: "pomo" });
    expect(pageCodeTarget({ view: "agents-v2", projectSlug: "pomo", machineId: "peer" })).toEqual({ project: "pomo" });
    expect(pageCodeTarget({ view: "repos", root: MAIN })).toEqual({ root: MAIN });
    expect(pageCodeTarget({ view: "repo-diff", path: WT })).toEqual({ root: WT });
    expect(pageCodeTarget(code({ project: "openscout", path: "a.ts" }))).toEqual({ project: "openscout", path: "a.ts" });
  });

  test("pages that name no checkout", () => {
    expect(pageCodeTarget({ view: "agents-v2" })).toBeNull();
    expect(pageCodeTarget({ view: "repos" })).toBeNull();
    expect(pageCodeTarget({ view: "search" })).toBeNull();
  });
});

describe("where Files and Changes take their root", () => {
  test("on Code, following the page: the URL, with the page's greeting", () => {
    expect(rootPlan({ root: FOLLOW_PAGE }, code({ root: MAIN, file: `${MAIN}/a.ts` }))).toEqual({
      source: "route",
      target: { root: MAIN, file: `${MAIN}/a.ts` },
      fallback: true,
    });
    expect(rootPlan({ root: FOLLOW_PAGE }, code())).toEqual({ source: "route", target: {}, fallback: true });
  });

  test("following another page that names a checkout", () => {
    expect(rootPlan({ root: FOLLOW_PAGE }, { view: "agents-v2", projectSlug: "pomo" })).toEqual({
      source: "page",
      target: { project: "pomo" },
      fallback: false,
    });
  });

  test("following a page that names none: the last repo read", () => {
    expect(rootPlan({ root: FOLLOW_PAGE }, { view: "search" })).toEqual({ source: "last", target: null, fallback: true });
    expect(rootPlan({}, code({ root: MAIN }))).toEqual({ source: "last", target: null, fallback: true });
  });

  test("a pinned root holds on every page, Code included", () => {
    expect(rootPlan({ root: WT }, code({ root: MAIN }))).toEqual({ source: "pinned", target: { root: WT }, fallback: false });
    expect(rootPlan({ root: WT }, { view: "agents-v2", projectSlug: "pomo" }).source).toBe("pinned");
  });

  test("the file a Files panel opened is live state; the follow marker is not a file", () => {
    expect(ownFile({ file: `${MAIN}/a.ts` })).toBe(`${MAIN}/a.ts`);
    expect(ownFile({ file: FOLLOW_PAGE })).toBeNull();
    expect(ownFile({})).toBeNull();
  });
});

describe("where File takes its file", () => {
  test("on Code, following the page: the URL with its lines", () => {
    expect(filePlan({ file: FOLLOW_PAGE }, code({ project: "openscout", path: "a.ts", line: 3, endLine: 5 }))).toEqual({
      source: "route",
      target: { project: "openscout", path: "a.ts", line: 3, endLine: 5 },
    });
  });

  test("anywhere else, following or unset: the pick beside it", () => {
    expect(filePlan({ file: FOLLOW_PAGE }, { view: "agents-v2", projectSlug: "pomo" })).toEqual({ source: "picks" });
    expect(filePlan({}, code({ root: MAIN }))).toEqual({ source: "picks" });
  });

  test("a pinned file reads against its root, the deepest checkout holding it, or its folder", () => {
    expect(filePlan({ file: `${WT}/a/b.ts`, line: "7", endLine: "9" }, code(), roots)).toEqual({
      source: "pinned",
      target: { root: WT, file: `${WT}/a/b.ts`, line: 7, endLine: 9 },
    });
    expect(pinnedRoot(`${MAIN}/x.ts`, MAIN, roots)).toBe(MAIN);
    expect(pinnedRoot(`${WT}/x.ts`, MAIN, roots)).toBe(WT);
    expect(pinnedRoot("/tmp/logs/x.log", undefined, roots)).toBe("/tmp/logs");
    expect(filePlan({ file: "/tmp/x.log", line: "nope" }, code(), roots)).toEqual({
      source: "pinned",
      target: { root: "/tmp", file: "/tmp/x.log" },
    });
  });

  test("pin keeps file, root and lines; unpin follows again and clears them", () => {
    expect(pinPatch(MAIN, `${MAIN}/a.ts`, { line: 4, endLine: 8 })).toEqual({ file: `${MAIN}/a.ts`, root: MAIN, line: "4", endLine: "8" });
    expect(pinPatch(null, "/tmp/x.log", null)).toEqual({ file: "/tmp/x.log", root: "", line: "", endLine: "" });
    expect(unpinPatch()).toEqual({ file: FOLLOW_PAGE, root: "", line: "", endLine: "" });
  });
});

describe("Changes rows", () => {
  test("the folder and the name; the count Repo Watch did not list", () => {
    expect(splitChangedPath("packages/web/app.css")).toEqual({ dir: "packages/web/", name: "app.css" });
    expect(splitChangedPath("README.md")).toEqual({ dir: "", name: "README.md" });
    expect(moreChanges(30, 20)).toBe(10);
    expect(moreChanges(3, 3)).toBe(0);
  });

  test("a file's label names its checkout's folder", () => {
    expect(fileOptionLabel(`${WT}/a/b.ts`, roots)).toBe("comms/a/b.ts");
    expect(fileOptionLabel("/tmp/x.log", roots)).toBe("x.log");
  });
});

describe("the picks a File panel reads", () => {
  test("the latest change wins; the same selection again keeps its place", () => {
    const picks = createCodePicks();
    let heard = 0;
    picks.subscribe(() => heard++);
    picks.publish("files", { root: MAIN, file: `${MAIN}/a.ts` });
    picks.publish("changes", { root: MAIN, file: `${MAIN}/b.ts` }, true);
    expect(picks.latest()?.file).toBe(`${MAIN}/b.ts`);
    // a re-render publishing what Files already has does not take File back
    picks.publish("files", { root: MAIN, file: `${MAIN}/a.ts` });
    expect(picks.latest()?.from).toBe("changes");
    expect(heard).toBe(2);
    // clicking it again does
    picks.publish("files", { root: MAIN, file: `${MAIN}/a.ts` }, true);
    expect(picks.latest()?.from).toBe("files");
    // a new selection does too
    picks.publish("changes", { root: MAIN, file: `${MAIN}/b.ts`, focus: { line: 3 } });
    expect(picks.latest()).toMatchObject({ from: "changes", focus: { line: 3 } });
  });

  test("a panel that goes takes its pick with it", () => {
    const picks = createCodePicks();
    picks.publish("files", { root: MAIN, file: `${MAIN}/a.ts` });
    picks.publish("changes", { root: MAIN, file: `${MAIN}/b.ts` });
    picks.withdraw("changes");
    expect(picks.latest()?.from).toBe("files");
    picks.withdraw("files");
    expect(picks.latest()).toBeNull();
    expect(picks.get("files")).toBeNull();
  });

  test("recent files, newest first, capped; one array until it changes", () => {
    const picks = createCodePicks();
    for (let index = 0; index < RECENT_PICKS_LIMIT + 2; index += 1) picks.publish("files", { root: MAIN, file: `${MAIN}/${index}.ts` });
    const recent = picks.recent();
    expect(recent).toHaveLength(RECENT_PICKS_LIMIT);
    expect(recent[0]).toBe(`${MAIN}/${RECENT_PICKS_LIMIT + 1}.ts`);
    picks.publish("files", { root: MAIN, file: recent[0]! }, true);
    expect(picks.recent()).toBe(recent);
    picks.publish("files", { root: MAIN, file: recent[3]! }, true);
    expect(picks.recent()[0]).toBe(recent[3]);
  });
});
