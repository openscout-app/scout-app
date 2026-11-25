import { statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { isAbsolute, join } from "node:path";

import type { Hono } from "hono";
import { execSystemFile } from "@openscout/runtime/system-probes";

import {
  MERGED_WINDOW_MS,
  type ProjectSnapshot,
  type ProjectSnapshotMerge,
  type ProjectSnapshotPullRequest,
} from "../../shared/project-snapshot.ts";

type Exec = (command: string, args: string[], options: { cwd: string; timeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number }) => Promise<{ stdout: string }>;

export type ProjectSnapshotDeps = {
  exec: Exec;
  diskOf: (path: string) => Promise<{ availableBytes: number; totalBytes: number }>;
  host: () => string;
  now: () => number;
};

const DEFAULT_DEPS: ProjectSnapshotDeps = {
  exec: (command, args, options) => execSystemFile(command, args, options),
  diskOf: async (path) => {
    const fs = await statfs(path);
    return { availableBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize };
  },
  host: () => hostname().replace(/\.local$/i, ""),
  now: () => Date.now(),
};

/** One read per project at a time, reused for CACHE_MS: the page polls, gh is slow. */
const CACHE_MS = 30_000;
const CACHE_MAX = 16;

const run = (deps: ProjectSnapshotDeps, cwd: string, command: string, args: string[], timeoutMs = 4_000) =>
  deps.exec(command, args, { cwd, timeoutMs, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 64 * 1024 }).then((r) => r.stdout);

const time = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** A project root the request may read: an existing directory, "~/…" or absolute. */
export function projectSnapshotRoot(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const path = value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(path)) return null;
  try {
    return statSync(path).isDirectory() ? path.replace(/\/+$/, "") || "/" : null;
  } catch {
    return null;
  }
}

async function readMain(deps: ProjectSnapshotDeps, root: string) {
  // origin's default branch, as of the last fetch; origin/main when origin/HEAD is unset
  const head = await run(deps, root, "git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
  const ref = head.trim() || "origin/main";
  const line = await run(deps, root, "git", ["log", "-1", "--format=%h%x00%s%x00%cI", ref]);
  const [sha, subject, at] = line.trim().split("\0");
  if (!sha) return null;
  return { ref, sha, subject: subject ?? "", at: time(at) };
}

async function readCheckout(deps: ProjectSnapshotDeps, root: string, mainRef: string) {
  const [branch, counts, status] = await Promise.all([
    run(deps, root, "git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    run(deps, root, "git", ["rev-list", "--left-right", "--count", `${mainRef}...HEAD`]),
    run(deps, root, "git", ["status", "--porcelain", "--untracked-files=no"]),
  ]);
  const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
  const name = branch.trim();
  return {
    branch: name && name !== "HEAD" ? name : null,
    ahead: ahead || 0,
    behind: behind || 0,
    uncommitted: status.split("\n").filter((l) => l.trim()).length,
  };
}

function parsePullRequests(stdout: string): ProjectSnapshotPullRequest[] {
  const raw = JSON.parse(stdout) as Record<string, unknown>[];
  return raw
    .filter((pr) => typeof pr.number === "number" && typeof pr.title === "string")
    .map((pr) => ({
      number: pr.number as number,
      title: pr.title as string,
      url: typeof pr.url === "string" ? pr.url : "",
      isDraft: Boolean(pr.isDraft),
      createdAt: time(pr.createdAt),
      additions: count(pr.additions),
      deletions: count(pr.deletions),
      mergeable: typeof pr.mergeable === "string" ? pr.mergeable : "UNKNOWN",
      headRefName: typeof pr.headRefName === "string" ? pr.headRefName : "",
      reviewDecision: typeof pr.reviewDecision === "string" && pr.reviewDecision ? pr.reviewDecision : null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function parseMerges(stdout: string, since: number): ProjectSnapshotMerge[] {
  const raw = JSON.parse(stdout) as Record<string, unknown>[];
  return raw
    .filter((pr) => typeof pr.number === "number" && typeof pr.title === "string")
    .map((pr) => ({
      number: pr.number as number,
      title: pr.title as string,
      url: typeof pr.url === "string" ? pr.url : "",
      mergedAt: time(pr.mergedAt),
      additions: count(pr.additions),
      deletions: count(pr.deletions),
    }))
    .filter((pr) => pr.mergedAt >= since)
    .sort((a, b) => b.mergedAt - a.mergedAt);
}

export async function readProjectSnapshot(root: string, deps: ProjectSnapshotDeps = DEFAULT_DEPS): Promise<ProjectSnapshot> {
  const now = deps.now();
  const since = now - MERGED_WINDOW_MS;
  const warnings: string[] = [];
  const note = (what: string) => (error: unknown): null => {
    warnings.push(`${what} unavailable${error instanceof Error && error.message ? `: ${error.message.split("\n")[0]}` : ""}`);
    return null;
  };

  const mainPromise = readMain(deps, root).catch(note("main"));
  const [main, checkout, pullRequests, merged, disk] = await Promise.all([
    mainPromise,
    mainPromise.then((m) => (m ? readCheckout(deps, root, m.ref) : null)).catch(note("checkout")),
    run(deps, root, "gh", [
      "pr", "list", "--state", "open", "--limit", "50",
      "--json", "number,title,url,isDraft,createdAt,additions,deletions,mergeable,headRefName,reviewDecision",
    ], 10_000).then(parsePullRequests).catch(note("open pull requests")),
    run(deps, root, "gh", [
      "pr", "list", "--state", "merged", "--limit", "60",
      "--search", `merged:>=${new Date(since).toISOString().slice(0, 10)}`,
      "--json", "number,title,url,mergedAt,additions,deletions",
    ], 10_000).then((out) => parseMerges(out, since)).catch(note("merged pull requests")),
    deps.diskOf(root).catch(note("disk")),
  ]);

  return { generatedAt: now, root, host: deps.host(), main, checkout, pullRequests, merged, disk, warnings };
}

export function mountProjectSnapshotRoutes(app: Hono, deps: ProjectSnapshotDeps = DEFAULT_DEPS): void {
  const cache = new Map<string, { at: number; read: Promise<ProjectSnapshot> }>();

  app.get("/api/project-snapshot", async (c) => {
    const root = projectSnapshotRoot(c.req.query("path"));
    if (!root) return c.json({ error: "path must be an existing project folder" }, 400);
    const now = deps.now();
    let entry = cache.get(root);
    if (!entry || now - entry.at > CACHE_MS) {
      entry = { at: now, read: readProjectSnapshot(root, deps) };
      cache.set(root, entry);
      // bounded: the oldest reads go first
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
      entry.read.catch(() => cache.delete(root));
    }
    try {
      return c.json(await entry.read);
    } catch (error) {
      return c.json({ error: `project snapshot failed: ${error instanceof Error ? error.message : String(error)}` }, 502);
    }
  });
}
