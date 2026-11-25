/**
 * Review: the window's data, built live on this host. See shared/review-window.ts for the shape.
 *
 * Three read-only sources:
 * - the World payload (world-week.ts): the tool calls, sessions and asks of the last days;
 * - git, for every project those calls touched: commits in the window and their diffs, so a file's only past
 *   versions are its commits;
 * - the files as they are now: path, saved time, gone or not. The text head or the image is read on demand
 *   (`file()`), through the same approved-root and deny-list policy as the World previews (world-files.ts).
 *
 * Projects and worktrees come from git itself (`rev-parse` on each session folder and touched folder), not from
 * folder names. A worktree that is gone from disk is named from its sibling main checkout when it follows the
 * "<repo>-<branch>" convention, else it stays unplaced. A commit is tied to a session only when the record shows
 * it: the call that ran `git commit` just before it landed, else the session that edited its files most in the
 * hour before. Git runs read-only, with optional locks off.
 */
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { WorldWeekPayload } from "./world-week.ts";
import { agentScratchRoot, createWorldFilePolicy, isDeniedPath, type WorldFilePolicy } from "./world-files.ts";
import {
  isReviewDoc, isReviewGenerated, isReviewImage, kindOfPath,
  REVIEW_DAYS_DEFAULT, REVIEW_DAYS_MAX, REVIEW_HEAD_LINES, REVIEW_TEXT_LINES,
  type ReviewAsk, type ReviewChange, type ReviewCommit, type ReviewCurrent, type ReviewData, type ReviewFileHead, type ReviewFileText, type ReviewSession,
} from "../shared/review-window.ts";

/* ---------- git, read-only ---------- */
export type Git = (dir: string, args: string[], opts?: { maxBuffer?: number; timeout?: number }) => Promise<string | null>;

/** A failure, a timeout or an oversized answer is null, never a throw. */
export const execGit: Git = (dir, args, opts = {}) => new Promise((resolve) => {
  try {
    execFile("git", ["-C", dir, ...args], {
      timeout: opts.timeout ?? 5000,
      killSignal: "SIGKILL",
      maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    }, (error, stdout) => resolve(error ? null : String(stdout)));
  } catch { resolve(null); }
});

export function reviewDays(value: string | number | undefined | null): number {
  const n = Number(value ?? REVIEW_DAYS_DEFAULT);
  return Number.isFinite(n) && n > 0 ? Math.min(REVIEW_DAYS_MAX, Math.max(1, Math.floor(n))) : REVIEW_DAYS_DEFAULT;
}

/* ---------- where a path lives ---------- */
export type Place = { project: string; wt: string; top: string; main: string; gone?: boolean };

/** A worktree's short name: "main" for the main checkout, "<branch>" for a "<repo>-<branch>" sibling. */
export function worktreeName(top: string, main: string): string {
  if (top === main) return "main";
  const b = basename(top), m = basename(main);
  if (b.startsWith(m + "-") && b.length > m.length + 1) return b.slice(m.length + 1);
  // a harness worktree keeps the repo's own folder name under a per-task folder
  if (b === m) return basename(dirname(top)).slice(0, 8);
  return b;
}

const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** Resolves folders to projects and worktrees. All caches belong to one build; concurrent requests cannot reset its places. */
export class Places {
  private byDir = new Map<string, Promise<{ top: string; main: string } | null>>();
  private names = new Map<string, string>();
  /** top → place, for this build */
  known = new Map<string, Place>();
  constructor(private git: Git) {}

  reset() { this.known = new Map(); if (this.byDir.size > 4000) this.byDir.clear(); }

  /** The project name of a main checkout; a second main with the same folder name gets its parent folder too. */
  name(main: string): string {
    let n = this.names.get(main);
    if (n) return n;
    n = basename(main);
    const taken = new Set(this.names.values());
    if (taken.has(n)) n = `${n} (${basename(dirname(main))})`;
    this.names.set(main, n);
    return n;
  }

  private add(top: string, main: string, gone = false): Place {
    let p = this.known.get(top);
    if (!p) { p = { project: this.name(main), wt: worktreeName(top, main), top, main, ...(gone ? { gone } : {}) }; this.known.set(top, p); }
    return p;
  }

  /** git's answer for a folder that exists */
  async dir(dir: string): Promise<Place | null> {
    let hit = this.byDir.get(dir);
    if (!hit) {
      hit = this.git(dir, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { timeout: 2000 }).then((out) => {
        const [top, common] = (out || "").trim().split("\n");
        if (!top || !common || !isAbsolute(top)) return null;
        const main = basename(common) === ".git" ? dirname(common) : common.replace(/\.git$/, "");
        return { top, main };
      });
      this.byDir.set(dir, hit);
    }
    const r = await hit;
    return r ? this.add(r.top, r.main) : null;
  }

  /** A worktree that is gone: named from a known main checkout beside it ("<repo>-<branch>") or a harness worktree folder. */
  gone(dir: string): Place | null {
    // the longest name wins: "demo-app-x" is a demo-app worktree, not a scout one
    const mains = [...new Set([...this.known.values()].map((p) => p.main))].sort((x, y) => basename(y).length - basename(x).length);
    for (let a = dir; a && a !== dirname(a); a = dirname(a)) {
      const parent = dirname(a), b = basename(a);
      for (const m of mains) {
        if (dirname(m) === parent && b.startsWith(basename(m) + "-") && b.length > basename(m).length + 1) return this.add(a, m, true);
        if (b === basename(m) && /\/\.[\w-]+\/worktrees\/[^/]+$/.test(parent)) return this.add(a, m, true);
      }
    }
    return null;
  }

  /** The known worktree that holds a path: the longest top that contains it. */
  at(p: string | null | undefined): Place | null {
    if (!p) return null;
    let best: Place | null = null;
    for (const pl of this.known.values()) if (under(p, pl.top) && (!best || pl.top.length > best.top.length)) best = pl;
    return best;
  }
}

/* ---------- the shape of a diff ---------- */
const SIG = /^[+-]\s*(export\s|public\s|open\s|func\s|struct\s|class\s|protocol\s|enum\s|interface\s|type\s|def\s|async function\s|function\s|static func\s)/;

/** How much a diff asks to be read, from its shape alone: the kind of file, its size, declarations, comments only. */
export function shapeOf(path: string, patch: string, add: number, del: number, isNew: boolean, isGone: boolean) {
  const lines = patch.split("\n"), hunks = lines.filter((l) => l.startsWith("@@")).length;
  let sig = 0, comment = 0, body = 0;
  for (const l of lines) {
    if (!/^[+-]/.test(l) || /^(\+\+\+|---)/.test(l)) continue;
    const t = l.slice(1).trim(); if (!t) continue;
    if (SIG.test(l)) sig++;
    if (/^(\/\/|#|\*|\/\*|<!--)/.test(t)) comment++; else body++;
  }
  const kind = kindOfPath(path);
  const base = ({ code: 1, test: 0.55, style: 0.6, doc: 0.6, config: 0.45, image: 0.35, generated: 0.03 } as Record<string, number>)[kind] ?? 1;
  const size = Math.min(1, Math.log1p(add + del) / Math.log1p(400));
  let s = base * (0.35 + 0.65 * size);
  if (sig) s += 0.18 * Math.min(1, sig / 3) * base;
  if (hunks >= 4) s += 0.06;
  if (isNew && kind !== "generated") s += 0.08;
  if (body === 0 && comment > 0) s *= 0.5;
  if (del > 3 * add && del > 20) s += 0.04;
  const why: string[] = [];
  if (kind === "generated") why.push("generated");
  if (isNew) why.push("new file");
  if (isGone) why.push("removed");
  if (sig) why.push(`${sig} declaration${sig > 1 ? "s" : ""} changed`);
  if (hunks) why.push(`${hunks} hunk${hunks > 1 ? "s" : ""}`);
  if (body === 0 && comment > 0) why.push("comments only");
  return { kind, hunks, shape: +Math.min(1, s).toFixed(3), shapeWhy: why.join(" · ") };
}

export type LogRow = { sha: string; at: number; author: string; email: string; ref: string; subj: string };
export const LOG_FORMAT = "%x1e%H%x1f%at%x1f%cn%x1f%ae%x1f%S%x1f%s";
export function parseLog(out: string): LogRow[] {
  const rows: LogRow[] = [], seen = new Set<string>();
  for (const rec of out.split("\x1e").slice(1)) {
    const [sha, at, author, email, ref, ...rest] = rec.replace(/\n+$/, "").split("\x1f");
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);
    rows.push({ sha, at: Number(at), author: author || "", email: (email || "").toLowerCase(), ref: ref || "", subj: rest.join("\x1f") });
  }
  return rows;
}
/**
 * A source ref → a branch name: refs/heads/x, refs/remotes/<remote>/x → x. `git log --source` prints the short
 * name it matched (x, origin/x), so a leading origin/ or upstream/ goes too: it is the remote, not the branch.
 */
export const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "").replace(/^(?:origin|upstream)\//, "").replace(/^HEAD$/, "");

export type ShowFile = { path: string; oldPath?: string; isNew: boolean; isGone: boolean; add: number; del: number; body: string };
export function parseShow(out: string): ShowFile[] {
  const files: ShowFile[] = [];
  for (const part of out.split(/^(?=diff --git )/m)) {
    const hd = part.match(/^diff --git a\/(.+?) b\/(.+)$/m); if (!hd) continue;
    const at0 = part.search(/^@@/m), body = at0 >= 0 ? part.slice(at0) : "";
    let add = 0, del = 0;
    for (const l of body.split("\n")) { if (l.startsWith("+")) add++; else if (l.startsWith("-")) del++; }
    files.push({ path: hd[2], ...(hd[1] !== hd[2] ? { oldPath: hd[1] } : {}), isNew: /^new file mode/m.test(part), isGone: /^deleted file mode/m.test(part), add, del, body });
  }
  return files;
}
/** `git show --numstat` when the patch itself is too big to keep */
export function parseNumstat(out: string): ShowFile[] {
  const files: ShowFile[] = [];
  for (const l of out.split("\n")) {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/); if (!m) continue;
    const path = m[3].includes(" => ") ? m[3].replace(/\{[^}]*? => ([^}]*)\}/, "$1").replace(/^.* => /, "") : m[3];
    files.push({ path, isNew: false, isGone: false, add: m[1] === "-" ? 0 : +m[1], del: m[2] === "-" ? 0 : +m[2], body: "" });
  }
  return files;
}
export function parseWorktrees(out: string): { top: string; branch: string }[] {
  const rows: { top: string; branch: string }[] = [];
  let cur: { top: string; branch: string } | null = null;
  for (const l of out.split("\n")) {
    if (l.startsWith("worktree ")) { cur = { top: l.slice(9), branch: "" }; rows.push(cur); }
    else if (l.startsWith("branch ") && cur) cur.branch = branchOf(l.slice(7));
  }
  return rows;
}

/* ---------- the service ---------- */
const PATCH_CAP = 60;
/** files kept per commit, the ones whose shape asks most to be read */
const COMMIT_FILES_CAP = 200;
const GIT_SHOW_CAP = 1024 * 1024;
export const BUILD_COMMITS_CAP = 100;
const CURRENT_CAP = 4000;
const DIR_CAP = 300;
export const BUILD_ROOTS_CAP = 100;
export const BUILD_GIT_CALLS_CAP = 800;
const TTL = 45_000;
const KINDS = ["e", "r", "c", "s", "b", "w", "a", "o"];
const STICK = 600;

type Built = { data: ReviewData; json: string; allow: Map<string, string>; policy: WorldFilePolicy; at: number };
export type ReviewWindowOptions = {
  week: { get(days: number): Promise<WorldWeekPayload> };
  git?: Git;
  home?: string;
};

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await f(items[i++]); }));
}

export function createReviewWindowService(options: ReviewWindowOptions) {
  const git = options.git ?? execGit, home = options.home ?? homedir();

  const shows = new Map<string, ShowFile[]>();
  const cache = new Map<number, { at: number; p: Promise<Built> }>();
  let latest: Built | null = null;

  const tilde = (p: string) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);
  const abs = (p: string) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);

  async function show(main: string, sha: string, runGit: Git): Promise<ShowFile[]> {
    const k = main + "\0" + sha;
    const hit = shows.get(k);
    if (hit) return hit;
    const out = await runGit(main, ["show", "--format=", "-U2", "--no-color", "--no-ext-diff", "--find-renames", sha], { maxBuffer: GIT_SHOW_CAP, timeout: 8000 });
    let files: ShowFile[];
    if (out != null) files = parseShow(out);
    else {
      const num = await runGit(main, ["show", "--format=", "--numstat", "--find-renames", sha], { timeout: 8000 });
      if (num == null) return []; // failures and budget refusals are retryable, never immutable results
      files = parseNumstat(num);
    }
    if (shows.size >= 200) shows.clear();
    shows.set(k, files);
    return files;
  }

  async function build(days: number): Promise<Built> {
    const P = await options.week.get(days);
    const deadline = Date.now() + 30_000;
    let gitCalls = 0;
    const runGit: Git = (dir, args, opts) => {
      const left = deadline - Date.now();
      if (left <= 0 || gitCalls >= BUILD_GIT_CALLS_CAP) return Promise.resolve(null);
      gitCalls++;
      return git(dir, args, { ...opts, timeout: Math.max(1, Math.min(left, opts?.timeout ?? 5000)) });
    };
    const places = new Places(runGit);
    const S = P.strs, F0 = P.from / 1000, END = Math.round((P.now - P.from) / 1000);
    const rel = (secs: number) => Math.round(secs - F0);

    /* folders → projects and worktrees */
    const roots = [...new Set(P.events.map((e) => S[e[1]]))].filter(Boolean).slice(0, BUILD_ROOTS_CAP);
    const rootPlace = new Map<string, Place | null>();
    const existing = async (p: string) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
    await pool(roots, 8, async (r) => {
      if (Date.now() >= deadline) return;
      const a = abs(r);
      rootPlace.set(r, (await existing(a)) ? await places.dir(a) : null);
    });
    const dirs = new Set<string>();
    // each call's file: its own, else the path a read or an edit names; a command's first path is a weaker hint
    const firstPath = (t: string) => { const m = t.match(/(?:^|[\s'"=(])(~\/[^\s'";&|)]+|\/[^\s'";&|)]+)/); return m ? abs(m[1]) : null; };
    const pathOf = P.events.map((e) => {
      const t = S[e[5]] || "";
      return e[6] >= 0 ? abs(S[e[6]]) : (e[2] === "e" || e[2] === "r") && /^(~|\/)/.test(t) ? abs(t.split(" ")[0]) : null;
    });
    const hintOf = P.events.map((e, i) => (pathOf[i] ? null : firstPath(S[e[5]] || "")));
    for (let i = 0; i < P.events.length; i++) { const p = pathOf[i] || hintOf[i]; if (p) dirs.add(dirname(p)); }
    // a folder inside a worktree already known costs no git call; the rest are capped
    const goneDirs: string[] = [];
    let asked = 0;
    await pool([...dirs].sort(), 8, async (d) => {
      if (Date.now() >= deadline || places.at(d)) return;
      if (!(await existing(d))) { goneDirs.push(d); return; }
      if (asked++ < DIR_CAP) await places.dir(d);
    });
    // folders that are gone, once every main checkout git could name is known
    for (const r of roots) if (!rootPlace.get(r)) rootPlace.set(r, places.gone(abs(r)));
    for (const d of goneDirs) if (!places.at(d)) places.gone(d);

    /* compact rows over one string table */
    const strs: string[] = [], si = new Map<string, number>();
    const st = (x: string) => { x = x || ""; let i = si.get(x); if (i == null) { si.set(x, (i = strs.length)); strs.push(x); } return i; };
    const wts: ReviewData["wts"] = [], wi = new Map<string, number>();
    const wt = (pl: Place | null) => {
      if (!pl) return -1;
      let i = wi.get(pl.top);
      if (i == null) { wi.set(pl.top, (i = wts.length)); wts.push([pl.project, pl.wt, tilde(pl.top), pl.gone ? 1 : 0, ""]); }
      return i;
    };
    const keyOf = (p: string, pl: Place | null) => (pl && under(p, pl.top) && p !== pl.top ? `${pl.project}:${relative(pl.top, p)}` : tilde(p));
    const files: [number, number, number][] = [], fi = new Map<string, number>(), fileAbs: string[] = [];
    const fileOf = (p: string, pl: Place | null) => {
      let i = fi.get(p);
      if (i == null) { fi.set(p, (i = files.length)); files.push([st(tilde(p)), wt(pl), st(keyOf(p, pl))]); fileAbs.push(p); }
      return i;
    };

    // calls: [secs, session, kind, tool, worktree, file, target, added, removed]
    const calls: number[][] = [], last = new Map<number, [number, number]>();
    for (let ci = 0; ci < P.events.length; ci++) {
      const e = P.events[ci], [at, root, k, s, tool, tgt] = e, add = e[7] || 0, del = e[8] || 0;
      const target = S[tgt] || "";
      const path = pathOf[ci], pl = places.at(path) || places.at(hintOf[ci]) || rootPlace.get(S[root]) || null;
      let w = wt(pl);
      if (w >= 0) last.set(s, [w, at]);
      else { const l = last.get(s); if (l && at - l[1] <= STICK) w = l[0]; }
      calls.push([at, s, Math.max(0, KINDS.indexOf(k)), st(S[tool]), w, path ? fileOf(path, places.at(path)) : -1, st(target.slice(0, 140)), add, del]);
    }

    /* sessions, actors, asks */
    const sessionAgent = new Map<number, number>(), askOf = new Map<number, number>();
    for (const [ai, w] of Object.entries(P.work)) {
      askOf.set(+ai, w.s);
      const a = P.asks[+ai];
      if (a && P.actors[a[4]]?.kind !== "person" && !sessionAgent.has(w.s)) sessionAgent.set(w.s, a[4]);
    }
    const sessions: ReviewSession[] = P.sessions.map(([sid, h, , turns], i) => ({
      sid: sid.slice(0, 8), ...(P.sessionIds?.[i] ? { id: P.sessionIds[i] } : {}), h, agent: sessionAgent.get(i) ?? -1,
      turns: turns.map(([t, x]) => [t, st(S[x])] as [number, number]),
      colds: P.colds.filter((c) => c[1] === i).map((c) => [c[0], c[2]] as [number, number]),
      errs: (P.errs || []).filter((e) => e[1] === i).map((e) => [e[0], st(S[e[2]]), st(S[e[3]]), st(S[e[4]])] as [number, number, number, number]),
    }));
    const actors = P.actors.map((a) => [a.name, a.kind, a.project || "", a.harness || "", a.id || ""] as [string, string, string, string, string]);
    const asks: ReviewAsk[] = P.asks.map((a, i) => [
      Math.round((a[0] - P.from) / 1000), a[1] ? Math.round((a[1] - P.from) / 1000) : -1, a[2], a[3], a[4],
      st(a[5]), st(a[6] || ""), a[7] || "b", askOf.get(i) ?? -1,
    ]);

    /* commits: the only versions a file has */
    const mains = new Map<string, Place>();
    for (const pl of places.known.values()) if (!mains.has(pl.main)) mains.set(pl.main, places.known.get(pl.main) ?? { project: pl.project, wt: "main", top: pl.main, main: pl.main });
    const commits: (ReviewCommit & { dup?: string })[] = [], changes: ReviewChange[] = [], ids = new Set<string>();
    // each worktree's branch, as git lists it: the join a pull request's head makes (review-github.ts)
    const topBranch = new Map<string, string>();
    const commitSession = (project: string, t: number) => {
      for (let i = calls.length - 1; i >= 0; i--) {
        const c = calls[i]; if (c[0] > t + 5) continue; if (c[0] < t - 150) break;
        if (!/git\b[^|;&]*\bcommit\b/.test(strs[c[6]] || "")) continue;
        const w = wts[c[4]]; if (w && w[0] !== project) continue;
        return { s: c[1], w: c[4], how: "commit" };
      }
      return null;
    };
    let remaining = BUILD_COMMITS_CAP;
    for (const [main, mpl] of mains) {
      if (remaining <= 0 || Date.now() >= deadline) break;
      if (!(await existing(main))) continue;
      const project = mpl.project;
      const listed = parseWorktrees((await runGit(main, ["worktree", "list", "--porcelain"], { timeout: 3000 })) || "");
      const byBranch = new Map<string, string>();
      for (const x of listed) if (x.branch) { byBranch.set(x.branch, x.top); topBranch.set(x.top, x.branch); }
      const log = await runGit(main, ["log", "--max-count=1000", "--branches", "--remotes", "--no-merges", "--source", `--since=@${Math.floor(F0)}`, `--until=@${Math.ceil(F0 + END)}`, `--format=${LOG_FORMAT}`], { timeout: 8000 });
      const logged = parseLog(log || "");
      // whose commits count as this host's: the repo's own user.email (and the global one it falls back to)
      const emails = new Set([await runGit(main, ["config", "user.email"], { timeout: 2000 })].map((x) => (x || "").trim().toLowerCase()).filter(Boolean));
      // Review is restricted to the operator's configured author identity, regardless of session activity.
      const rows = logged.filter((r) => emails.has(r.email)).slice(0, remaining);
      remaining -= rows.length;
      const shown = new Map<string, ShowFile[]>();
      await pool(rows, 6, async (r) => { if (Date.now() < deadline) shown.set(r.sha, await show(main, r.sha, runGit)); });
      for (const r of rows) {
        let id = r.sha.slice(0, 12);
        if (ids.has(id)) id += "@" + project;
        ids.add(id);
        const t = rel(r.at), branch = branchOf(r.ref);
        const merged = r.author === "GitHub" ? (r.subj.match(/\(#(\d+)\)$/) || [])[1] || "" : "";
        const mine: ReviewChange[] = (shown.get(r.sha) || []).map((f) => {
          const body = (isDeniedPath(join(main, f.path), home) || (f.oldPath && isDeniedPath(join(main, f.oldPath), home))) ? "" : f.body;
          const sh = shapeOf(f.path, body, f.add, f.del, f.isNew, f.isGone), bl = body ? body.split("\n") : [];
          return {
            id: id + ":" + f.path, c: id, key: project + ":" + f.path, path: f.path, add: f.add, del: f.del, isNew: f.isNew, isGone: f.isGone, ...sh,
            patch: sh.kind === "generated" ? "" : bl.slice(0, PATCH_CAP).join("\n"), cut: bl.length > PATCH_CAP ? bl.length - PATCH_CAP : 0,
          };
        });
        if (mine.length > COMMIT_FILES_CAP) mine.sort((a, b) => b.shape - a.shape).splice(COMMIT_FILES_CAP);
        let who = commitSession(project, t);
        if (!who) {
          // no commit call in the record: the session that edited these files most in the hour before
          const want = new Set(mine.map((f) => f.key)), tally = new Map<string, number>();
          for (let i = calls.length - 1; i >= 0; i--) {
            const c = calls[i]; if (c[0] > t + 5) continue; if (c[0] < t - 3600) break;
            if (KINDS[c[2]] !== "e" || c[5] < 0) continue;
            if (!want.has(strs[files[c[5]][2]])) continue;
            const k = c[1] + "|" + c[4]; tally.set(k, (tally.get(k) || 0) + 1);
          }
          const top = [...tally].sort((a, b) => b[1] - a[1])[0];
          if (top) { const [s, w] = top[0].split("|").map(Number); who = { s, w, how: "edits" }; }
        }
        let w = who && who.w >= 0 ? who.w : -1;
        if (w < 0) {
          const onBranch = branch && byBranch.get(branch);
          w = wt(onBranch ? (places.known.get(onBranch) ?? (await places.dir(onBranch)) ?? mpl) : mpl);
        }
        commits.push({ id, repo: project, t, subj: r.subj, branch, merged, s: who ? who.s : -1, w, how: who ? who.how : "" });
        changes.push(...mine);
      }
    }
    // a GitHub squash repeats the branch commit it came from: keep the branch commit, note the merge
    for (const c of commits.filter((x) => x.merged)) {
      const twin = commits.find((o) => o !== c && o.repo === c.repo && !o.merged && c.subj.replace(/\s*\(#\d+\)$/, "") === o.subj);
      if (twin) { twin.mergedAs = c.merged; c.dup = twin.id; }
    }
    const dups = new Set(commits.filter((c) => c.dup).map((c) => c.id));
    const keptCommits: ReviewCommit[] = commits.filter((c) => !dups.has(c.id)).sort((a, b) => a.t - b.t).map(({ dup: _dup, ...c }) => c);
    const keptChanges = changes.filter((x) => !dups.has(x.c));

    /* Current copies stay worktree-scoped; the aggregate view uses the newest touch. */
    const scoped = (key: string, w: number) => JSON.stringify([key, w]);
    const want = new Map<string, { candidates: string[]; edited: boolean; committed: boolean; w: number[] }>();
    for (let i = calls.length - 1; i >= 0; i--) {
      const c = calls[i]; if (c[5] < 0) continue;
      const key = strs[files[c[5]][2]], p = fileAbs[c[5]];
      const scopeKey = scoped(key, files[c[5]][1]);
      let x = want.get(scopeKey);
      if (!x) { if (want.size >= CURRENT_CAP) continue; want.set(scopeKey, (x = { candidates: [], edited: false, committed: false, w: [] })); }
      if (!x.candidates.includes(p)) { x.candidates.push(p); x.w.push(files[c[5]][1]); }
      if (KINDS[c[2]] === "e") x.edited = true;
    }
    const projectMain = new Map<string, string>();
    for (const pl of mains.values()) projectMain.set(pl.project, pl.main);
    const commitById = new Map(keptCommits.map((c) => [c.id, c]));
    for (let i = keptChanges.length - 1; i >= 0; i--) {
      const ch = keptChanges[i], cm = commitById.get(ch.c); if (!cm) continue;
      const scopeKey = scoped(ch.key, cm.w);
      let x = want.get(scopeKey);
      if (!x) { if (want.size >= CURRENT_CAP) continue; want.set(scopeKey, (x = { candidates: [], edited: false, committed: true, w: [] })); }
      x.committed = true;
      const top = cm.w >= 0 ? abs(wts[cm.w][2]) : null, main = projectMain.get(cm.repo);
      for (const [root, w] of [[top || main || null, cm.w]] as [string | null, number][]) {
        if (!root) continue;
        const p = join(root, ch.path);
        if (!x.candidates.includes(p)) { x.candidates.push(p); x.w.push(w); }
      }
    }
    // previews follow the World's rule: a worktree or session folder under home, never home itself, off the deny list
    const policy = await createWorldFilePolicy(home, [...[...places.known.values()].map((p) => p.top), ...roots.map(abs)]);
    // a background job's screenshots sit in its scratch folder; those folders open for images and nothing else
    const scratch = await createWorldFilePolicy(home, [...want.values()].flatMap((x) => x.candidates.filter(isReviewImage).map((p) => agentScratchRoot(p, home) ?? "")));
    const check = async (p: unknown) => (await policy.check(p)) ?? (typeof p === "string" && isReviewImage(p) ? await scratch.check(p) : null);
    const current: Record<string, ReviewCurrent> = {}, currentByWorktree: Record<string, ReviewCurrent> = {}, allow = new Map<string, string>();
    await pool([...want], 16, async ([key, x]) => {
      for (let k = 0; k < x.candidates.length; k++) {
        const p = x.candidates[k];
        let info;
        try { info = await stat(p); } catch { continue; }
        if (!info.isFile()) continue;
        const open = !!(await check(p));
        currentByWorktree[key] = { path: tilde(p), mt: rel(info.mtimeMs / 1000), w: x.w[k], ...(isReviewImage(p) ? { image: true } : {}), ...(open ? {} : { closed: true }) };
        if (open) allow.set(tilde(p), p);
        return;
      }
      if (x.edited || x.committed) currentByWorktree[key] = { path: tilde(x.candidates[0] || ""), mt: -1, w: x.w[0] ?? -1, gone: true };
    });

    for (const scopedKey of want.keys()) {
      const cur = currentByWorktree[scopedKey];
      if (!cur) continue;
      const [key] = JSON.parse(scopedKey);
      if (!current[key]) current[key] = cur;
    }
    for (const w of wts) if (w[2]) w[4] = topBranch.get(abs(w[2])) ?? "";

    const projects: Record<string, string> = {};
    for (const pl of mains.values()) projects[pl.project] = tilde(pl.main);
    const data: ReviewData = {
      from: P.from, now: P.now, host: (P.hosts.find((h) => h.self) || { name: "" }).name, days,
      kinds: KINDS, strs, wts, projects, files, calls, sessions, actors, asks,
      commits: keptCommits, changes: keptChanges, current, currentByWorktree,
    };
    return { data, json: JSON.stringify(data), allow, policy: { roots: [...policy.roots, ...scratch.roots], check }, at: Date.now() };
  }

  let queue: Promise<unknown> = Promise.resolve();
  const pending = new Map<number, Promise<Built>>();
  function get(days: number): Promise<Built> {
    const running = pending.get(days);
    if (running) return running;
    const hit = cache.get(days);
    if (hit && Date.now() - hit.at < TTL) return hit.p;
    const p = queue.then(() => build(days)).then((b) => { latest = b; cache.set(days, { at: Date.now(), p }); return b; });
    queue = p.catch(() => {});
    pending.set(days, p);
    p.finally(() => pending.delete(days)).catch(() => {});
    cache.set(days, { at: Date.now(), p });
    p.catch(() => { if (cache.get(days)?.p === p) cache.delete(days); });
    return p;
  }

  return {
    /** the window's data as JSON, cached for 45 seconds per day count */
    json: async (days: number) => (await get(days)).json,
    data: async (days: number) => (await get(days)).data,
    /**
     * One file the last build listed, as it is now: its head as JSON, its source for the code pane, or an image's
     * real path to stream. Null for a path the build did not list, one outside the approved roots, or one on the deny
     * list (world-files.ts).
     */
    async file(p: string, as: "head" | "raw" | "text"): Promise<{ kind: "head"; body: ReviewFileHead } | { kind: "text"; body: ReviewFileText } | { kind: "raw"; real: string } | null> {
      const b = latest; if (!b) return null;
      const a = b.allow.get(p); if (!a) return null;
      const real = await b.policy.check(a); if (!real) return null;
      if (as === "raw") return isReviewImage(real) ? { kind: "raw", real } : null;
      if (isReviewImage(real) || isReviewGenerated(real)) return null;
      const info = await stat(real);
      if (info.size > 2e6) return null;
      let txt = await readFile(real, "utf8");
      // the code pane reads the source as written: no stripping, only a cap on what is sent
      if (as === "text") {
        const ls = txt.split("\n"), keep = ls.slice(0, REVIEW_TEXT_LINES);
        return { kind: "text", body: { path: p, text: keep.join("\n"), lines: ls.length, cut: ls.length - keep.length, mt: info.mtimeMs } };
      }
      if (/\.html?$/i.test(real)) {
        const title = (txt.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
        txt = (title ? title + "\n\n" : "") + txt.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
      }
      if (/\.mdx?$/i.test(real)) txt = txt.replace(/^---\n[\s\S]*?\n---\n/, "");
      const ls = txt.split("\n");
      return { kind: "head", body: { path: p, head: ls.slice(0, REVIEW_HEAD_LINES).join("\n").slice(0, 2400), lines: ls.length, mt: info.mtimeMs } };
    },
  };
}
export type ReviewWindowService = ReturnType<typeof createReviewWindowService>;
export { isReviewDoc };
