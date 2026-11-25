import { describe, expect, test } from "bun:test";
import type { RepoWatchSnapshot } from "../../scout/repo-watch/types.ts";
import {
  afterFailedDir,
  ancestorDirs,
  changedDirsFor,
  changedFilesByPath,
  codeDeepLinkFor,
  codeLinkKey,
  codeRouteFor,
  codeTargetKey,
  collectTreeRows,
  fileTitle,
  findWorktree,
  firstSnapshotRoot,
  focusFrom,
  linkFailureMessage,
  resolveCodeTarget,
  resolveProjectLink,
  snapshotRoots,
  targetFromRoute,
  type DirEntry,
  type TreeRow,
} from "./code-browser-model.ts";

const MAIN = "/example/workstation-user/dev/openscout";
const WT = "/example/workstation-user/dev/openscout-worktrees/comms";
const TALKIE = "/example/workstation-user/dev/talkie";

const worktree = (path: string, name: string, files: { path: string; status: string }[] = []) => ({
  id: `wt-${name}`,
  path,
  name,
  branch: { name: name === "openscout" ? "main" : `scout/${name}`, detached: false },
  status: { clean: files.length === 0, changedFiles: files.length, files },
  diff: { branchShortstat: null, unstagedShortstat: null, stagedShortstat: null },
});

const snapshot = {
  generatedAt: 1,
  projects: [
    {
      id: "p-openscout",
      name: "OpenScout",
      root: MAIN,
      worktrees: [
        worktree(MAIN, "openscout", [
          { path: "packages/web/client/app.css", status: "unstaged" },
          { path: "notes.md", status: "untracked" },
        ]),
        worktree(WT, "comms"),
      ],
    },
    { id: "p-talkie", name: "talkie", root: TALKIE, worktrees: [worktree(TALKIE, "talkie")] },
  ],
  totals: {},
  warnings: [],
} as unknown as RepoWatchSnapshot;

describe("what a target asks for", () => {
  test("a /code route keeps only the fields it set", () => {
    expect(targetFromRoute({ view: "code", project: "openscout", path: "AGENTS.md", line: 4 })).toEqual({
      project: "openscout",
      path: "AGENTS.md",
      line: 4,
    });
    expect(targetFromRoute({ view: "code" })).toEqual({});
  });

  test("lines: a range only when the end comes at or after the start", () => {
    expect(focusFrom(12, 20)).toEqual({ line: 12, endLine: 20 });
    expect(focusFrom(12, 3)).toEqual({ line: 12 });
    expect(focusFrom(0, 3)).toBeNull();
    expect(focusFrom(undefined, undefined)).toBeNull();
  });

  test("one key per target; a slug link keys on project and worktree only", () => {
    expect(codeTargetKey({ root: MAIN, file: `${MAIN}/a.ts` })).toBe(codeTargetKey({ file: `${MAIN}/a.ts`, root: MAIN }));
    expect(codeTargetKey({ root: MAIN })).not.toBe(codeTargetKey({ root: MAIN, line: 2 }));
    expect(codeTargetKey(null)).toBe("");
    expect(codeLinkKey({ project: "openscout", path: "a.ts" })).toBe(codeLinkKey({ project: "openscout", path: "b.ts" }));
    expect(codeLinkKey({ project: "openscout", wt: "comms" })).not.toBe(codeLinkKey({ project: "openscout" }));
    expect(codeLinkKey({ root: MAIN })).toBeNull();
  });
});

describe("where a target lands", () => {
  test("a slug resolves against the snapshot: primary checkout, or the named worktree", () => {
    expect(resolveProjectLink(snapshot, "openscout", null)).toEqual({ projectName: "OpenScout", root: MAIN });
    expect(resolveProjectLink(snapshot, "openscout", "comms")?.root).toBe(WT);
    expect(resolveProjectLink(snapshot, "nope", null)).toBeNull();
  });

  test("a slug with a path opens that file under the root", () => {
    const state = resolveCodeTarget({ project: "openscout", path: "AGENTS.md", line: 3 }, { snapshot });
    expect(state).toEqual({
      root: MAIN,
      file: `${MAIN}/AGENTS.md`,
      focus: { line: 3 },
      phase: "idle",
      message: null,
      project: "openscout",
      path: "AGENTS.md",
    });
  });

  test("the first answer for a link wins over the snapshot", () => {
    expect(resolveCodeTarget({ project: "openscout" }, { snapshot, linkRoot: "/elsewhere/openscout" }).root).toBe("/elsewhere/openscout");
  });

  test("a slug nobody knows yet is resolving, and names itself once it misses", () => {
    const waiting = resolveCodeTarget({ project: "ghost", path: "a.ts" }, { snapshot });
    expect(waiting.phase).toBe("resolving");
    expect(waiting.root).toBeNull();
    expect(waiting.path).toBe("a.ts");
    const missed = resolveCodeTarget({ project: "ghost" }, { snapshot, linkError: "404 not found" });
    expect(missed.phase).toBe("failed");
    expect(missed.message).toBe('Can\'t resolve project "ghost": 404 not found');
    expect(linkFailureMessage("ghost", "no project ghost")).toBe("no project ghost");
  });

  test("no root asked: the fallback root, with the file last open there", () => {
    const state = resolveCodeTarget(null, {
      snapshot,
      fallbackRoot: TALKIE,
      storedFile: (root) => (root === TALKIE ? `${TALKIE}/README.md` : null),
    });
    expect(state.root).toBe(TALKIE);
    expect(state.file).toBe(`${TALKIE}/README.md`);
    expect(state.phase).toBe("idle");
  });

  test("the target's own file always wins, even outside the root", () => {
    const state = resolveCodeTarget({ file: "/tmp/x.log" }, { snapshot, fallbackRoot: MAIN, storedFile: () => `${MAIN}/a.ts` });
    expect(state.root).toBe(MAIN);
    expect(state.file).toBe("/tmp/x.log");
  });

  test("a panel's own file holds while it sits under the root, else the stored one", () => {
    const stored = () => `${MAIN}/stored.ts`;
    expect(resolveCodeTarget({ root: MAIN }, { snapshot, ownFile: `${MAIN}/mine.ts`, storedFile: stored }).file).toBe(`${MAIN}/mine.ts`);
    expect(resolveCodeTarget({ root: MAIN }, { snapshot, ownFile: `${TALKIE}/mine.ts`, storedFile: stored }).file).toBe(`${MAIN}/stored.ts`);
    expect(resolveCodeTarget({ root: MAIN }, { snapshot }).file).toBeNull();
  });

  test("with nothing to land on, nothing is selected", () => {
    expect(resolveCodeTarget(null, { snapshot: null })).toEqual({
      root: null,
      file: null,
      focus: null,
      phase: "idle",
      message: null,
      project: null,
      path: null,
    });
  });

  test("the first repo and every known checkout", () => {
    expect(firstSnapshotRoot(snapshot)).toBe(MAIN);
    expect(firstSnapshotRoot(null)).toBeNull();
    expect(snapshotRoots(snapshot)).toEqual([MAIN, WT, TALKIE]);
  });
});

describe("the address of a selection", () => {
  test("slug form when the snapshot knows the root; a worktree past the first carries wt", () => {
    expect(codeRouteFor(snapshot, MAIN, `${MAIN}/AGENTS.md`)).toEqual({ view: "code", project: "openscout", path: "AGENTS.md" });
    expect(codeRouteFor(snapshot, WT, `${WT}/a/b.ts`, { focus: { line: 4, endLine: 9 } })).toEqual({
      view: "code",
      project: "openscout",
      path: "a/b.ts",
      wt: "comms",
      line: 4,
      endLine: 9,
    });
  });

  test("absolute form otherwise, and the conversation that handed the file in rides along", () => {
    expect(codeRouteFor(null, "/x", "/x/y.ts", { returnConversationId: "c1" })).toEqual({
      view: "code",
      root: "/x",
      file: "/x/y.ts",
      returnConversationId: "c1",
    });
    expect(codeRouteFor(snapshot, "/unknown", null)).toEqual({ view: "code", root: "/unknown" });
  });

  test("scout:// in project form for a known checkout, absolute otherwise", () => {
    const main = findWorktree(snapshot, MAIN);
    const comms = findWorktree(snapshot, WT);
    expect(codeDeepLinkFor(MAIN, `${MAIN}/AGENTS.md`, main, { line: 2 })).toContain("openscout");
    expect(codeDeepLinkFor(MAIN, `${MAIN}/AGENTS.md`, main, { line: 2 })).toContain("AGENTS.md");
    expect(codeDeepLinkFor(WT, null, comms, null)).toContain("comms");
    expect(codeDeepLinkFor("/x", "/x/y.ts", null, null)).toContain("/x/y.ts");
    expect(codeDeepLinkFor(null, null, null, null)).toBeNull();
  });
});

describe("the tree", () => {
  test("ancestors between a root and a file", () => {
    expect(ancestorDirs("/r", "/r/a/b/c.ts")).toEqual(["/r/a", "/r/a/b"]);
    expect(ancestorDirs("/r", "/elsewhere/c.ts")).toEqual([]);
  });

  test("a folder that will not load closes with what is under it; only the root failing is the tree's error", () => {
    const open = new Set(["/r/a", "/r/a/b", "/r/ab", "/r/c"]);
    expect(afterFailedDir("/r", "/r/a", open)).toEqual({ error: false, expanded: new Set(["/r/ab", "/r/c"]) });
    expect(afterFailedDir("/r", "/r", open)).toEqual({ error: true, expanded: open });
  });

  test("rows skip machine-owned folders and show a loading row for an unread folder", () => {
    const children = new Map<string, DirEntry[]>([
      ["/r", [
        { name: "node_modules", path: "/r/node_modules", kind: "directory" },
        { name: "src", path: "/r/src", kind: "directory" },
        { name: "lib", path: "/r/lib", kind: "directory" },
        { name: "a.ts", path: "/r/a.ts", kind: "file" },
      ]],
      ["/r/src", [{ name: "b.ts", path: "/r/src/b.ts", kind: "file" }]],
    ]);
    const rows: TreeRow[] = [];
    collectTreeRows("/r", 0, children, new Set(["/r/src", "/r/lib"]), rows);
    expect(rows.map((row) => `${row.depth}:${row.name}`)).toEqual(["0:src", "1:b.ts", "0:lib", "1:Loading…", "0:a.ts"]);
  });

  test("changed files by path, and every folder above them", () => {
    const changed = changedFilesByPath(MAIN, findWorktree(snapshot, MAIN));
    expect(changed.get(`${MAIN}/packages/web/client/app.css`)).toBe("unstaged");
    expect(changed.get(`${MAIN}/notes.md`)).toBe("untracked");
    expect([...changedDirsFor(MAIN, changed)].sort()).toEqual([
      MAIN,
      `${MAIN}/packages`,
      `${MAIN}/packages/web`,
      `${MAIN}/packages/web/client`,
    ]);
    expect(changedFilesByPath(TALKIE, null).size).toBe(0);
  });

  test("a file's title is relative inside its root", () => {
    expect(fileTitle(MAIN, `${MAIN}/a/b.ts`)).toBe("a/b.ts");
    expect(fileTitle(MAIN, "/tmp/x.log", "x.log (log)")).toBe("x.log (log)");
    expect(fileTitle(MAIN, "/tmp/x.log")).toBe("x.log");
    expect(fileTitle(MAIN, null)).toBeNull();
  });
});
