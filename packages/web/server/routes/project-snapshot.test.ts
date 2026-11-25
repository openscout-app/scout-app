import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import { mountProjectSnapshotRoutes, projectSnapshotRoot, readProjectSnapshot, type ProjectSnapshotDeps } from "./project-snapshot.ts";

const NOW = Date.parse("2026-11-13T18:00:00Z");
const HOUR = 60 * 60 * 1000;

/** gh and git answers by their first arguments; an answer that is an Error fails that call. */
function deps(answers: Record<string, string | Error>, calls: string[] = []): ProjectSnapshotDeps {
  return {
    exec: async (command, args) => {
      const key = `${command} ${args.slice(0, command === "gh" ? 4 : 1).join(" ")}`;
      calls.push(key);
      const answer = answers[key];
      if (answer instanceof Error) throw answer;
      if (answer === undefined) throw new Error(`unexpected ${key}`);
      return { stdout: answer };
    },
    diskOf: async () => ({ availableBytes: 10 * 1024 ** 3, totalBytes: 200 * 1024 ** 3 }),
    host: () => "build-host",
    now: () => NOW,
  };
}

const PRS = JSON.stringify([
  { number: 7, title: "Older ready", url: "u7", isDraft: false, createdAt: "2026-11-12T10:00:00Z", additions: 5, deletions: 1, mergeable: "MERGEABLE", headRefName: "a", reviewDecision: "" },
  { number: 9, title: "Newest draft", url: "u9", isDraft: true, createdAt: "2026-11-13T10:00:00Z", additions: 2, deletions: 0, mergeable: "CONFLICTING", headRefName: "b", reviewDecision: "REVIEW_REQUIRED" },
  { title: "no number" },
]);
const MERGES = JSON.stringify([
  { number: 3, title: "Inside the window", url: "u3", mergedAt: new Date(NOW - 2 * HOUR).toISOString(), additions: 40, deletions: 4 },
  { number: 2, title: "Too old", url: "u2", mergedAt: new Date(NOW - 30 * HOUR).toISOString(), additions: 1, deletions: 1 },
]);

const HEALTHY = {
  "git symbolic-ref": "origin/main\n",
  "git log": "abc1234\0Ship it\x002026-11-13T17:00:00Z\n",
  "git rev-parse": "main\n",
  "git rev-list": "2\t3\n",
  "git status": " M a.ts\n M b.ts\n",
  "gh pr list --state open": PRS,
  "gh pr list --state merged": MERGES,
};

describe("readProjectSnapshot", () => {
  test("reads main, the checkout, pull requests, merges in the window, and disk", async () => {
    const snapshot = await readProjectSnapshot("/repo", deps(HEALTHY));
    expect(snapshot.host).toBe("build-host");
    expect(snapshot.main).toEqual({ ref: "origin/main", sha: "abc1234", subject: "Ship it", at: Date.parse("2026-11-13T17:00:00Z") });
    expect(snapshot.checkout).toEqual({ branch: "main", ahead: 3, behind: 2, uncommitted: 2 });
    expect(snapshot.pullRequests?.map((pr) => [pr.number, pr.isDraft, pr.reviewDecision])).toEqual([
      [9, true, "REVIEW_REQUIRED"],
      [7, false, null],
    ]);
    expect(snapshot.merged?.map((m) => m.number)).toEqual([3]);
    expect(snapshot.disk).toEqual({ availableBytes: 10 * 1024 ** 3, totalBytes: 200 * 1024 ** 3 });
    expect(snapshot.warnings).toEqual([]);
  });

  test("a failed part is null with a warning, never zero", async () => {
    const snapshot = await readProjectSnapshot("/repo", deps({ ...HEALTHY, "gh pr list --state open": new Error("gh: not logged in\nmore") }));
    expect(snapshot.pullRequests).toBeNull();
    expect(snapshot.merged?.length).toBe(1);
    expect(snapshot.warnings).toEqual(["open pull requests unavailable: gh: not logged in"]);
  });

  test("without origin/HEAD it reads origin/main; without a main it reads no checkout", async () => {
    const fallback = await readProjectSnapshot("/repo", deps({ ...HEALTHY, "git symbolic-ref": new Error("unset") }));
    expect(fallback.main?.ref).toBe("origin/main");
    const none = await readProjectSnapshot("/repo", deps({ ...HEALTHY, "git symbolic-ref": "", "git log": new Error("bad ref") }));
    expect(none.main).toBeNull();
    expect(none.checkout).toBeNull();
    expect(none.warnings).toEqual(["main unavailable: bad ref"]);
  });
});

describe("GET /api/project-snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "project-snapshot-"));
  writeFileSync(join(dir, "file.txt"), "x");

  test("takes only an existing folder", () => {
    expect(projectSnapshotRoot(undefined)).toBeNull();
    expect(projectSnapshotRoot("relative/path")).toBeNull();
    expect(projectSnapshotRoot(join(dir, "file.txt"))).toBeNull();
    expect(projectSnapshotRoot(join(dir, "missing"))).toBeNull();
    expect(projectSnapshotRoot(`${dir}/`)).toBe(dir);
  });

  test("answers 400 for a bad path and reuses one read per folder", async () => {
    const calls: string[] = [];
    const app = new Hono();
    mountProjectSnapshotRoutes(app, deps(HEALTHY, calls));
    expect((await app.request("/api/project-snapshot?path=nowhere")).status).toBe(400);
    const first = await app.request(`/api/project-snapshot?path=${encodeURIComponent(dir)}`);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { root: string }).root).toBe(dir);
    const before = calls.length;
    await app.request(`/api/project-snapshot?path=${encodeURIComponent(dir)}`);
    expect(calls.length).toBe(before);
  });
});
