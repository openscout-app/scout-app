import { describe, expect, test } from "bun:test";

import { FOLLOW_PAGE } from "./follow-page.ts";
import {
  closeDiffRoute,
  diffFollowsRoute,
  diffRoute,
  isReposRoute,
  listRepoTarget,
  panelRepoTarget,
  selectRoute,
} from "./repos-panel.ts";

describe("the Repos routes", () => {
  test("/repos and /repo-diff are the view's own", () => {
    expect(isReposRoute({ view: "repos" })).toBe(true);
    expect(isReposRoute({ view: "repo-diff", path: "/a" })).toBe(true);
    expect(isReposRoute({ view: "agents-v2", indexView: "projects" })).toBe(false);
  });
});

describe("selectRoute", () => {
  test("on /repos: the URL's root, replaced, keeping ?machineId=", () => {
    expect(selectRoute({ view: "repos", root: "/old", machineId: "m1" }, "/new")).toEqual({
      to: { view: "repos", root: "/new", machineId: "m1" },
      replace: true,
    });
    expect(selectRoute({ view: "repos" }, "/new")).toEqual({ to: { view: "repos", root: "/new" }, replace: true });
  });

  test("from /repo-diff: back to /repos with that checkout, a new entry", () => {
    expect(selectRoute({ view: "repo-diff", path: "/a" }, "/b")).toEqual({ to: { view: "repos", root: "/b" }, replace: false });
  });

  test("elsewhere: nowhere (the list keeps it in config)", () => {
    expect(selectRoute({ view: "agents-v2", indexView: "projects" }, "/b")).toBeNull();
    expect(selectRoute({ view: "views", viewId: "watch" }, "/b")).toBeNull();
  });
});

describe("panelRepoTarget", () => {
  test("following the page on /repos and /repo-diff reads the URL", () => {
    expect(panelRepoTarget({ view: "repos", root: "/a" }, FOLLOW_PAGE)).toEqual({ root: "/a", mode: "page", leads: true, writes: true });
    expect(panelRepoTarget({ view: "repo-diff", path: "/a" }, FOLLOW_PAGE)).toEqual({ root: "/a", mode: "exact", leads: true, writes: true });
  });

  test("following the page elsewhere: the list's pick", () => {
    expect(panelRepoTarget({ view: "agents-v2", indexView: "projects" }, FOLLOW_PAGE)).toEqual({ root: null, mode: "page", leads: false, writes: true });
  });

  test("a pinned path is read exactly and never written back, on any route", () => {
    expect(panelRepoTarget({ view: "repos", root: "/a" }, " /pinned ")).toEqual({ root: "/pinned", mode: "exact", leads: false, writes: false });
  });

  test("unset: the busiest checkout", () => {
    expect(panelRepoTarget({ view: "agents-v2", indexView: "projects" }, "")).toEqual({ root: null, mode: "exact", leads: false, writes: false });
    expect(panelRepoTarget({ view: "agents-v2", indexView: "projects" }, undefined)).toEqual({ root: null, mode: "exact", leads: false, writes: false });
  });
});

describe("listRepoTarget", () => {
  test("on the Repos routes the URL wins over the list's own setting", () => {
    expect(listRepoTarget({ view: "repos", root: "/url" }, "/config")).toEqual({ root: "/url", mode: "page", leads: true, writes: true });
    expect(listRepoTarget({ view: "repo-diff", path: "/url" }, "/config")).toEqual({ root: "/url", mode: "exact", leads: true, writes: true });
  });

  test("elsewhere its own setting, and it leads the page's pick", () => {
    expect(listRepoTarget({ view: "agents-v2", indexView: "projects" }, "/config")).toEqual({ root: "/config", mode: "page", leads: true, writes: true });
    expect(listRepoTarget({ view: "agents-v2", indexView: "projects" }, undefined)).toEqual({ root: null, mode: "page", leads: true, writes: true });
  });
});

describe("the diff", () => {
  test("opens on /repo-diff and closes to /repos with that checkout", () => {
    expect(diffRoute("/a")).toEqual({ view: "repo-diff", path: "/a" });
    expect(closeDiffRoute("/a")).toEqual({ view: "repos", root: "/a" });
  });

  test("follows the URL only on /repo-diff with the page followed", () => {
    expect(diffFollowsRoute({ view: "repo-diff", path: "/a" }, FOLLOW_PAGE)).toBe(true);
    expect(diffFollowsRoute({ view: "repo-diff", path: "/a" }, "/a")).toBe(false);
    expect(diffFollowsRoute({ view: "repos", root: "/a" }, FOLLOW_PAGE)).toBe(false);
  });
});
