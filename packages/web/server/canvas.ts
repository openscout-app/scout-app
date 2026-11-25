/**
 * Canvas: what each agent made or looked at in a project, read off the Review window (review-window.ts).
 *
 * An agent's area is one harness session. Its items are the screenshots, films and documents the session touched:
 * an image or film it read, wrote, captured with a browser or a screen tool, or named in a command; a document it
 * wrote. Those are inferred from the session's own calls. What an agent showed on purpose (`scout show`) is read from
 * the runtime and merged in as it is served (canvas-shows.ts), first in its area.
 *
 * Files are served from this module's own allow list. A file must pass the World's preview policy (world-files.ts),
 * or be temporary media: an image or film whose real path sits in this user's temp folders or a Claude job's tmp
 * folder, owned by this user, off the deny list. Documents are only ever served as their first lines.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, sep } from "node:path";
import {
  artifactKey, embedFor, isArcPath, isShowPath, SHOW_PATH, CANVAS_DIFF_LINES, CANVAS_REACH_DAYS, canvasEnd, CANVAS_FILES_PER_AGENT, cleanPrompt, CANVAS_HEAD_LINES, CANVAS_ITEMS_PER_AGENT, CANVAS_PATCH_LINES, CANVAS_TEXT_LINES, CANVAS_WORKING_MS, canvasKindOf,
  strongerHow, type CanvasAgent, type CanvasData, type CanvasFile, type CanvasFileDiff, type CanvasFileHead, type CanvasFileText, type CanvasHow, type CanvasItem, type CanvasProject, type CanvasWork,
} from "../shared/canvas.ts";
import type { ReviewData } from "../shared/review-window.ts";
import { execGit, type Git } from "./review-window.ts";
import { formatSessionRouteRef } from "../shared/session-route-ref.ts";
import { createWorldFilePolicy, isDeniedPath, type WorldFilePolicy } from "./world-files.ts";
import { mergeShows, SHOW_ID, type RuntimeShow, type ShowSource, type ShowsByRoot } from "./canvas-shows.ts";

export type CanvasSource = { data(days: number): Promise<ReviewData> };
export type CanvasOptions = {
  review: CanvasSource; home?: string; tempRoots?: string[]; uid?: number; clock?: () => number;
  /** a session's own title by its route ref (routes/world.ts reads the observe summary); none in tests */
  titleOf?: (ref: string) => Promise<string | null>;
  /** read-only git, for a worked file's diff */
  git?: Git;
  /** the runtime's show store: what agents chose to show (canvas-shows.ts); none in tests that leave it out */
  shows?: ShowSource;
};
/** a project's shows are listed again after this */
const SHOWS_MS = 4000;
/** an open diagram's shown item is listed again after this */
const ARC_SHOWS_MS = 1000;

/** An Arc diagram's source, read for the canvas to draw; no text when it is the version the page already has. */
export type CanvasArcSource = { version: string; path: string; mt: number; text?: string };
/** a session's title is read again after this */
const TITLE_MS = 5 * 60_000;

/** Paths that are build output or tool state, never something an agent made to look at. */
const NOISE = /(^|\/)(node_modules|\.next|\.build|dist|DerivedData|\.fab|\.git|Pods|\.turbo|coverage)(\/|$)/;
/** A command that makes the image or film it names. */
const CAPTURE = /\b(screencapture|ffmpeg|wincap|xcrun simctl io|capture:web|hyperframes render|record)\b/;
const MEDIA_IN_TEXT = /(?:^|[\s'"=(])((?:~\/|\/|\.{0,2}\/)?[\w@~.+/-]*\.(?:png|jpe?g|gif|webp|mp4|m4v|mov|webm|html?))(?=$|[\s'":;),])/gi;
const CD = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*&&/;
const FILES_CAP = 1500;
const ITEMS_CAP = 600;
const DOC_BYTES_CAP = 2e6;
/** a document's head and a source file's text read no further than this */
const HEAD_BYTES = 64 * 1024;
const TEXT_BYTES = 256 * 1024;
/** a build that has not finished by now is given up, so a hung read never holds the page */
const BUILD_TIMEOUT_MS = 120_000;
/** a result this young is served as is */
const FRESH_MS = 20_000;
/** a result this young is served while the next one builds */
const STALE_MS = 10 * 60_000;
/** a past window's calls are all in: it is read again only for files that have since gone or changed */
const PAST_FRESH_MS = 10 * 60_000;
const PAST_STALE_MS = 60 * 60_000;
/** past windows kept, newest built first; each step back is one */
const PAST_KEPT = 8;

/** a worked file's commits by its session, by "<key>\0<first commit>": what a diff of a gone copy may read */
type CommitSpan = { dir: string; rel: string; since: string; upto: string };
/** `roots`: each project's main checkout, by its real path, as the runtime's shows name it */
type Built = { data: CanvasData; allow: Map<string, string>; commits: Map<string, CommitSpan>; roots: Map<string, string>; at: number };

/** Lines that open a file and say little about the change: imports, includes, blank lines. */
const PREAMBLE = /^[+ -]\s*(import\b|from\s|export\s+(\*|\{[^}]*\})\s+from\b|#include\b|#import\b|use\s|using\s|package\s|const\s+\w+\s*=\s*require\(|\}\s*from\s|$)/;

/**
 * A unified patch's first hunk, from the line before its first change to its last change in `max` lines. A hunk
 * that opens with imports starts after them.
 */
export function patchExcerpt(patch: string, max = CANVAS_PATCH_LINES): string {
  return patchExcerptAt(patch, max).text;
}

/** The excerpt, and the line in the file after the change where its first change sits (null when it has none). */
export function patchExcerptAt(patch: string, max = CANVAS_PATCH_LINES): { text: string; line: number | null } {
  const out: string[] = [], at: number[] = [];
  let inHunk = false, opening = true, inImport = false, n = 1;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      if (inHunk && out.length) break;
      inHunk = true; n = Math.max(1, Number(/\+(\d+)/.exec(line)?.[1] ?? 1));
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    const here = n;
    if (!line.startsWith("-")) n++; // a removed line has no place in the new file; the next line takes its place
    if (opening) {
      if (inImport) { if (/^[+ -]\s*\}/.test(line)) inImport = false; continue; }
      if (/^[+ -]\s*(import\b[^;]*\{[^}]*|export\s+(type\s+)?\{[^}]*)$/.test(line)) { inImport = true; continue; }
      if (PREAMBLE.test(line)) continue;
    }
    opening = false;
    out.push(line.length > 160 ? line.slice(0, 160) : line); at.push(here);
    if (out.length >= max) break;
  }
  while (out.length && !/^[+-]/.test(out[out.length - 1])) out.pop();
  const first = out.findIndex((l) => /^[+-]/.test(l));
  return first < 0 ? { text: "", line: null } : { text: out.slice(Math.max(0, first - 1)).join("\n"), line: at[first] };
}

/** Lines before a file's own words: a shebang, directives, imports, includes, tool pragmas, blank lines. */
const LEAD = /^\s*(#!|["']use [\w ]+["'];?\s*$|import\b|export\s+(type\s+)?(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|package\s|#include\b|#import\b|@file:|\/\/\s*(swift-tools|@ts-|eslint|prettier|biome)|\/\*\s*(eslint|prettier|biome)|#\s*-\*-|$)/;
const LICENSE = /copyright|licen[cs]e|SPDX|all rights reserved/i;
const DOCSTRING = /^\s*[rbuRBU]?("{3}|'{3})/;

/** A comment's body lines when one opens at line `at`: a block or doc comment, a run of line comments, a docstring. */
function commentAt(lines: string[], at: number): string[] | null {
  const l = lines[at] ?? "";
  if (/^\s*\/\*/.test(l)) {
    const body: string[] = [];
    for (let k = at; k < lines.length; k++) {
      const end = lines[k].indexOf("*/", k === at ? lines[k].indexOf("/*") + 2 : 0);
      body.push((end >= 0 ? lines[k].slice(0, end) : lines[k]).replace(/^\s*\/\*+!?/, "").replace(/^\s*\*(?!\/)/, ""));
      if (end >= 0) return body;
    }
    return null;
  }
  const line = l.match(/^\s*(\/\/\/?|#(?![!#]|include|import)|--)/);
  if (line) {
    const lead = line[1], body: string[] = [];
    for (let k = at; k < lines.length && lines[k].trimStart().startsWith(lead); k++) body.push(lines[k].trimStart().slice(lead.length).replace(/^[/!]/, ""));
    return body;
  }
  const doc = l.match(DOCSTRING);
  if (doc) {
    const q = doc[1], first = l.slice(l.indexOf(q) + 3);
    if (first.includes(q)) return [first.slice(0, first.indexOf(q))];
    const body = [first];
    for (let k = at + 1; k < lines.length; k++) {
      const e = lines[k].indexOf(q);
      if (e >= 0) { body.push(lines[k].slice(0, e)); return body; }
      body.push(lines[k]);
    }
    return null;
  }
  if (/^\s*<!--/.test(l)) {
    const body: string[] = [];
    for (let k = at; k < lines.length; k++) {
      const e = lines[k].indexOf("-->");
      body.push((e >= 0 ? lines[k].slice(0, e) : lines[k]).replace(/^\s*<!--/, ""));
      if (e >= 0) return body;
    }
    return null;
  }
  return null;
}

/**
 * What a source file says it is: the first paragraph of its opening comment (a block or doc comment, a run of line
 * comments, or a Python docstring), past imports and licence text, in at most `max` characters. When the file opens
 * with code instead, the first doc comment that starts a line soon after. Empty when it says nothing.
 */
export function aboutOf(src: string, max = 240): string {
  const lines = src.slice(0, 16_384).split("\n");
  let i = 0, inImport = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (inImport) { if (/\bfrom\b|;\s*$|^\s*[)}]/.test(l)) inImport = false; continue; }
    if (/^\s*(import|from)\b/.test(l) && !/\bfrom\s+["'][^"']+["']|;\s*$|^\s*import\s+[\w.*, ]+$|^\s*import\s+["']|^\s*from\s+\S+\s+import\s+[^(]+$/.test(l)) { inImport = true; continue; }
    if (!LEAD.test(l)) break;
  }
  let body = commentAt(lines, i);
  for (let k = i + 1; !body && k < Math.min(lines.length, i + 80); k++) if (/^\/\*\*/.test(lines[k])) body = commentAt(lines, k);
  if (!body) return "";
  const paragraphs: string[] = [];
  let cur: string[] = [];
  for (const raw of body) {
    const t = raw.trim();
    if (/^@\w/.test(t)) break;
    if (!t) { if (cur.length) paragraphs.push(cur.join(" ")); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) paragraphs.push(cur.join(" "));
  const text = paragraphs.find((p) => !LICENSE.test(p) && /[a-z]{3}/i.test(p)) ?? "";
  const clean = text.replace(/\{@link\s+([^}]+)\}/g, "$1").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1), stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(": "));
  if (stop > max / 2) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

/** An HTML file's words: tags, and script and style bodies, dropped in one pass over the text. */
export function htmlText(src: string): string {
  const low = src.toLowerCase();
  let out = "", i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt) + " ";
    const close = low.startsWith("<script", lt) ? "</script" : low.startsWith("<style", lt) ? "</style" : "";
    let from = lt;
    if (close) { const c = low.indexOf(close, lt); if (c < 0) break; from = c; }
    const gt = src.indexOf(">", from);
    if (gt < 0) break;
    i = gt + 1;
  }
  return out;
}

const readStart = (file: string, bytes: number) => Bun.file(file).slice(0, bytes).text();

/** A document's first lines as the canvas lists them: an HTML page as its title and words, Markdown past its front matter. */
function headOf(path: string, start: string, html: boolean, mt: number): CanvasFileHead {
  let txt = start;
  if (html) {
    const title = (txt.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    txt = (title ? title + "\n\n" : "") + htmlText(txt).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  } else txt = txt.replace(/^---\n[\s\S]*?\n---\n/, "");
  const ls = txt.split("\n");
  return { path, head: ls.slice(0, CANVAS_HEAD_LINES).join("\n").slice(0, 2400), lines: ls.length, mt };
}

async function pool<T>(list: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (next < list.length) await fn(list[next++]); }));
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function diffOf(path: string, from: CanvasFileDiff["from"], body: string): CanvasFileDiff {
  const ls = body.replace(/\n$/, "").split("\n"), keep = body ? ls.slice(0, CANVAS_DIFF_LINES) : [];
  return { path, from, diff: keep.join("\n"), cut: body ? ls.length - keep.length : 0 };
}

export function createCanvasService(options: CanvasOptions) {
  const home = options.home ?? homedir();
  const clock = options.clock ?? Date.now;
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1);
  const tilde = (p: string) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);
  const abs = (p: string) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);
  const under = (child: string, root: string) => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
  let tempRoots: Promise<string[]> | null = null;
  const temps = () => (tempRoots ??= Promise.all([...new Set(options.tempRoots ?? ["/private/tmp", "/tmp", tmpdir()])].map((r) => realpath(r).catch(() => null)))
    .then((rs) => [...new Set(rs.filter((r): r is string => !!r && r !== "/"))]));
  const git = options.git ?? execGit;
  const titles = new Map<string, { title: string | null; at: number }>();
  /** a session's own title, read at most every TITLE_MS; a failed read is null */
  async function titleOf(ref: string | null): Promise<string | null> {
    if (!ref || !options.titleOf) return null;
    const hit = titles.get(ref);
    if (hit && clock() - hit.at < TITLE_MS) return hit.title;
    const title = (await options.titleOf(ref).catch(() => null))?.replace(/\s+/g, " ").trim() || null;
    titles.set(ref, { title, at: clock() });
    return title;
  }
  const jobsTmp = (r: string, homeReal: string) => {
    const rel = r.startsWith(homeReal + "/") ? r.slice(homeReal.length + 1) : "";
    return /^\.claude\/jobs\/[^/]+\/tmp\//.test(rel);
  };

  /** The real file to serve for a temporary image or film, or null. */
  async function tempMedia(p: string): Promise<string | null> {
    const kind = canvasKindOf(p);
    if (kind !== "image" && kind !== "video") return null;
    if (!isAbsolute(p) || normalize(p) !== p || p.includes("\0") || isDeniedPath(p, home)) return null;
    const r = await realpath(p).catch(() => null);
    if (!r || canvasKindOf(r) !== kind) return null;
    const homeReal = await realpath(home).catch(() => home);
    if (isDeniedPath(r, homeReal)) return null;
    if (!(await temps()).some((root) => under(r, root)) && !jobsTmp(r, homeReal)) return null;
    try {
      const st = await stat(r);
      return st.isFile() && (uid < 0 || st.uid === uid) ? r : null;
    } catch { return null; }
  }

  /* The Review window reads whole days back from now; a window of hours keeps the calls between its start and its
     end, so the newest hours build from the same read as the day around them and come back first. A past window
     (`end` set) reads the days back to its start, and its agents are all quiet: presence is live only at now. */
  async function build(hours: number, end: number | null): Promise<Built> {
    const start = (end ?? clock()) - hours * 3_600_000;
    const R = await options.review.data(Math.min(CANVAS_REACH_DAYS, Math.max(1, Math.ceil((clock() - start) / 86_400_000))));
    const S = R.strs, K = R.kinds, now = R.now, past = end != null;
    const ms = (secs: number) => R.from + secs * 1000;
    const until = end ?? now, from = Math.max(R.from, until - hours * 3_600_000);
    const inWindow = (secs: number) => { const t = ms(secs); return t >= from && t <= until; };
    const calls = R.calls.filter((c) => inWindow(c[0]));
    const policy: WorldFilePolicy = await createWorldFilePolicy(home, [...R.wts.filter((w) => !w[3]).map((w) => w[2]), ...Object.values(R.projects)]);
    const allow = new Map<string, string>();
    const servable = async (p: string): Promise<boolean> => {
      if (allow.has(p)) return true;
      const a = abs(p);
      const real = (await policy.check(a)) ?? (await tempMedia(a));
      // a link may not turn one kind of file into another (a .png that is an .svg)
      if (!real || canvasKindOf(real) !== canvasKindOf(a)) return false;
      allow.set(p, real);
      return true;
    };
    const exists = async (p: string) => { try { return (await stat(abs(p))).isFile(); } catch { return false; } };

    /* sessions → agents: worktree from their newest call with one */
    const sessionCalls = new Map<number, number[][]>();
    for (const c of calls) { const l = sessionCalls.get(c[1]); if (l) l.push(c); else sessionCalls.set(c[1], [c]); }
    /* an open ask to the operator marks the session that asked, else its agent's newest session */
    const askingSession = new Set<number>(), askingActor = new Set<number>();
    for (const a of past ? [] : R.asks) {
      if (a[1] >= 0) continue;
      const target = R.actors[a[4]];
      if (!target || !/^(person|human|operator|user)$/i.test(target[1])) continue;
      if (a[8] >= 0) askingSession.add(a[8]); else askingActor.add(a[3]);
    }
    const agents: CanvasAgent[] = [], agentOf = new Map<number, number>();
    for (const [s, calls] of sessionCalls) {
      const sess = R.sessions[s];
      if (!sess || sess.sid.startsWith("agent-")) continue; // a subagent: the record does not say which session started it
      let w = -1;
      for (let i = calls.length - 1; i >= 0 && w < 0; i--) w = calls[i][4];
      if (w < 0) continue;
      const [project, worktree] = R.wts[w];
      const last = calls[calls.length - 1];
      const actor = sess.agent >= 0 ? R.actors[sess.agent] : null;
      const lastFile = [...calls].reverse().find((c) => c[5] >= 0 && R.files[c[5]][1] >= 0);
      const nowFileKey = lastFile ? S[R.files[lastFile[5]][2]] : null;
      const lastAt = ms(last[0]);
      /* what it was asked: the operator's latest prompt, else the latest Scout ask it took, by the window's end */
      let asked = "";
      for (let t = sess.turns.length - 1; t >= 0 && !asked; t--) if (ms(sess.turns[t][0]) <= until) asked = cleanPrompt(S[sess.turns[t][1]] || "");
      if (!asked) {
        let best: number[] | null = null;
        for (const q of R.asks) if (ms(q[0]) <= until && (q[8] === s || (q[8] < 0 && sess.agent >= 0 && q[4] === sess.agent)) && (!best || q[0] > best[0])) best = q as unknown as number[];
        if (best) asked = cleanPrompt(S[best[5]] || "");
      }
      agentOf.set(s, agents.length);
      agents.push({
        id: sess.sid, agentId: actor?.[4] || null, name: actor?.[0] || "", harness: sess.h || actor?.[3] || "",
        project, worktree,
        state: past ? "quiet" : askingSession.has(s) ? "asks" : now - lastAt <= CANVAS_WORKING_MS ? "working" : "quiet",
        lastAt, now: describe(last), nowFile: nowFileKey && nowFileKey.includes(":") ? nowFileKey : null,
        ref: sess.id ? formatSessionRouteRef(sess.h || actor?.[3] || "", sess.id) : null, title: null, asked: asked.slice(0, 280) || null,
      });
    }

    for (const actor of askingActor) {
      let newest = -1;
      for (const [s, i] of agentOf) if (R.sessions[s].agent === actor && (newest < 0 || agents[i].lastAt > agents[newest].lastAt)) newest = i;
      if (newest >= 0) agents[newest].state = "asks";
    }

    function describe(c: number[]): string {
      const k = K[c[2]], tool = S[c[3]] || "", tgt = (S[c[6]] || "").trim();
      const file = c[5] >= 0 ? basename(S[R.files[c[5]][0]]) : "";
      if (k === "e" && file) return `Edited ${file}`;
      if (k === "r" && file) return `Read ${file}`;
      if (k === "s") return `Searched ${tgt.slice(0, 48)}`;
      if (k === "c") return tgt.replace(/^cd\s+\S+\s*&&\s*/, "").slice(0, 64) || "Ran a command";
      if (k === "b") return `${tool.replace(/^mcp__\w+__browser_/, "Browser ").replace(/_/g, " ")} ${tgt.replace(/^https?:\/\//, "").slice(0, 40)}`.trim();
      if (k === "m") return "Messaged an agent";
      if (k === "w") return `Looked up ${tgt.replace(/^https?:\/\//, "").slice(0, 40)}`;
      return tool.replace(/^mcp__\w+__/, "").replace(/_/g, " ").slice(0, 40) || "Working";
    }

    /* items: per session and path, the strongest touch and the newest time */
    type Draft = { path: string; agent: number; at: number; how: CanvasHow; fileKey?: string };
    const drafts = new Map<string, Draft>();
    const note = (agent: number, path: string, at: number, how: CanvasHow, fileKey?: string) => {
      const k = agent + "\0" + path, d = drafts.get(k);
      if (!d) drafts.set(k, { path, agent, at, how, ...(fileKey ? { fileKey } : {}) });
      else { d.at = Math.max(d.at, at); d.how = strongerHow(d.how, how); }
    };
    for (const [s, calls] of sessionCalls) {
      const agent = agentOf.get(s); if (agent == null) continue;
      const fw = [...calls].reverse().find((c) => c[4] >= 0)?.[4] ?? -1, folder = fw >= 0 ? R.wts[fw][2] : "";
      for (const c of calls) {
        const k = K[c[2]], at = ms(c[0]);
        if (c[5] >= 0) {
          const [ps, , ks] = R.files[c[5]], path = S[ps], key = S[ks], kind = canvasKindOf(path);
          if (!kind || NOISE.test(path)) continue;
          const inRepo = key.includes(":") && !key.startsWith("~") && !key.startsWith("/");
          // a document counts when it was written in a repo (or is a page); an embed's source wherever the agent writes it
          if (kind === "doc" || kind === "embed") { if (k === "e" && (inRepo || kind === "embed" || /\.html?$/i.test(path))) note(agent, path, at, "wrote", inRepo ? key : undefined); continue; }
          note(agent, path, at, k === "e" ? "wrote" : "read", inRepo ? key : undefined);
          continue;
        }
        if (k !== "b" && k !== "c" && k !== "o") continue;
        const tgt = S[c[6]] || "";
        if (k === "c" && !CAPTURE.test(tgt)) continue;
        const cd = tgt.match(CD), base = cd ? abs(cd[1].replace(/^["']|["']$/g, "")) : abs(R.wts[c[4]]?.[2] || folder);
        for (const m of tgt.matchAll(MEDIA_IN_TEXT)) {
          let p = m[1];
          if (/^https?:/i.test(p) || p.includes("://")) continue;
          const kind = canvasKindOf(p);
          if (!kind || ((kind === "doc" || kind === "embed") && k !== "o")) continue;
          p = p.startsWith("~/") || isAbsolute(p) ? p : base ? join(base, p) : "";
          if (!p || NOISE.test(p)) continue;
          note(agent, tilde(normalize(abs(p))), at, k === "o" ? "named" : "captured");
        }
      }
    }

    /* one card per file: the session that touched it hardest, then last */
    const RANK: Record<CanvasHow, number> = { shown: 4, captured: 3, wrote: 2, read: 1, named: 0 };
    const owner = new Map<string, Draft>();
    for (const d of drafts.values()) {
      const o = owner.get(d.path);
      if (!o || RANK[d.how] > RANK[o.how] || (RANK[d.how] === RANK[o.how] && d.at > o.at)) owner.set(d.path, d);
    }
    /* keep what is still there and may be served, newest first, a few dozen per agent */
    const per = new Map<number, Draft[]>();
    for (const d of [...owner.values()].sort((a, b) => b.at - a.at)) {
      const l = per.get(d.agent) || []; if (l.length >= CANVAS_ITEMS_PER_AGENT * 2) continue; per.set(d.agent, l); l.push(d);
    }
    const items: CanvasItem[] = [];
    for (const [, list] of per) {
      let kept = 0;
      for (const d of list) {
        if (kept >= CANVAS_ITEMS_PER_AGENT || items.length >= ITEMS_CAP) break;
        if (!(await exists(d.path)) || !(await servable(d.path))) continue;
        const st = await stat(abs(d.path)).catch(() => null); if (!st) continue;
        const kind = canvasKindOf(d.path)!;
        if ((kind === "doc" || kind === "embed") && st.size > DOC_BYTES_CAP) continue;
        const embed = kind === "embed" ? embedFor(d.path) : null;
        items.push({ key: artifactKey(d.path), path: d.path, name: basename(d.path), kind, agent: d.agent, at: d.at, mt: st.mtimeMs, how: d.how, ...(d.fileKey ? { fileKey: d.fileKey } : {}), ...(embed ? { embed } : {}) });
        kept++;
      }
    }
    items.sort((a, b) => b.at - a.at);

    /* the Overview: every repo file the agents touched, by worktree; and per agent, the files it worked */
    const fileStats = new Map<string, CanvasFile>();
    const workOf = new Map<string, CanvasWork>(), workTree = new Map<string, number>();
    for (const c of calls) {
      if (c[5] < 0) continue;
      const [ps, w, ks] = R.files[c[5]];
      const key = S[ks];
      if (w < 0 || !key.includes(":") || key.startsWith("~") || key.startsWith("/")) continue;
      const path = S[ps]; if (NOISE.test(path)) continue;
      // an embed's source is plumbing: the canvas shows the live view, never its file in a map or a strip
      if (canvasKindOf(path) === "embed") continue;
      const [project, worktree] = R.wts[w];
      const id = worktree + "\0" + key;
      const edit = K[c[2]] === "e", at = ms(c[0]);
      const weight = edit ? 3 + Math.min(20, ((c[7] || 0) + (c[8] || 0)) / 10) : 1;
      let f = fileStats.get(id);
      if (!f) fileStats.set(id, (f = { key, project, worktree, rel: key.slice(key.indexOf(":") + 1), work: 0, last: 0 }));
      f.work += weight;
      f.last = Math.max(f.last, at);

      const agent = agentOf.get(c[1]);
      if (agent == null || canvasKindOf(path)) continue; // media and documents are cards
      const wid = agent + "\0" + key;
      let a = workOf.get(wid);
      if (!a) workOf.set(wid, (a = { agent, key, rel: f.rel, edits: 0, reads: 0, add: 0, del: 0, work: 0, last: 0 }));
      if (edit) { a.edits++; a.add += c[7] || 0; a.del += c[8] || 0; } else a.reads++;
      a.work += weight;
      if (at >= a.last) workTree.set(wid, w);
      a.last = Math.max(a.last, at);
    }
    const files = [...fileStats.values()].sort((a, b) => b.work - a.work).slice(0, FILES_CAP);

    /* a file the agent only read is context, not work; its busiest dozen, with its newest committed change */
    const commitOf = new Map(R.commits.map((c) => [c.id, c]));
    const newest = new Map<string, { t: number; patch: string; subj: string; id: string }>(), first = new Map<string, { t: number; id: string }>();
    for (const ch of R.changes) {
      const cm = commitOf.get(ch.c); if (!cm || cm.s < 0 || ms(cm.t) > until) continue;
      const agent = agentOf.get(cm.s); if (agent == null) continue;
      const wid = agent + "\0" + ch.key, n = newest.get(wid);
      if (!n || cm.t > n.t) newest.set(wid, { t: cm.t, patch: ch.patch, subj: cm.subj, id: cm.id });
      const f0 = first.get(wid);
      if (!f0 || cm.t < f0.t) first.set(wid, { t: cm.t, id: cm.id });
    }
    const perAgent = new Map<number, CanvasWork[]>(), commits = new Map<string, CommitSpan>();
    for (const [wid, a] of workOf) {
      if (!a.edits) continue;
      const n = newest.get(wid), ex = n ? patchExcerptAt(n.patch) : null;
      if (ex?.text) { a.patch = ex.text; a.commit = n!.subj; if (ex.line) a.line = ex.line; }
      const f0 = first.get(wid); if (f0) a.since = f0.id;
      const main = R.projects[a.key.slice(0, a.key.indexOf(":"))];
      if (f0 && n && main) commits.set(a.key + "\0" + f0.id, { dir: abs(main), rel: a.rel, since: f0.id, upto: n.id });
      const l = perAgent.get(a.agent); if (l) l.push(a); else perAgent.set(a.agent, [a]);
    }
    const work = [...perAgent.values()].flatMap((l) => l.sort((x, y) => y.work - x.work).slice(0, CANVAS_FILES_PER_AGENT));
    /* each area's name: its session's own title */
    await pool(agents, 8, async (a) => { a.title = await titleOf(a.ref); });
    /* each worked file: the copy its agent worked, when it may be read, and what the file says it is */
    await pool(work, 16, async (a) => {
      const w = workTree.get(a.agent + "\0" + a.key) ?? -1;
      const cur = R.currentByWorktree?.[JSON.stringify([a.key, w])] ?? R.current[a.key];
      if (!cur || cur.gone || cur.closed || cur.image || !cur.path || !(await servable(cur.path))) return;
      a.path = cur.path;
      const tree = R.wts[w]?.[1];
      if (tree) a.tree = tree;
      const full = abs(cur.path);
      if (full.endsWith("/" + a.rel)) a.root = full.slice(0, -a.rel.length - 1);
      const about = aboutOf(await readStart(allow.get(cur.path)!, 16_384).catch(() => ""));
      if (about) a.about = about;
    });

    /* projects: those with an agent area, newest first */
    const lastOf = new Map<string, number>();
    for (const a of agents) lastOf.set(a.project, Math.max(lastOf.get(a.project) || 0, a.lastAt));
    const scratch = (main: string) => /(^|\/)(tmp|\.claude\/jobs)\//.test(main) || main.startsWith("/private/");
    const projects: CanvasProject[] = [...lastOf].filter(([name]) => R.projects[name] && !scratch(R.projects[name]))
      .map(([name, lastAt]) => ({ name, main: R.projects[name], lastAt })).sort((a, b) => b.lastAt - a.lastAt);

    const roots = new Map<string, string>();
    for (const p of projects) { const r = await realpath(abs(p.main)).catch(() => null); if (r) roots.set(r, p.name); }

    return { data: { now, from, end: until, live: !past, hours, projects, agents, items, work, files }, allow, commits, roots, at: clock() };
  }

  /*
   * Shows: every project on the canvas, listed again after SHOWS_MS, merged into the build as it is served. A
   * runtime that cannot be read leaves the canvas as built. `known` remembers each version listed, for its head.
   */
  const known = new Map<string, RuntimeShow>();
  const listed = new Map<string, { at: number; byRoot: ShowsByRoot; build: Built }>();
  async function showsFor(b: Built, key: string): Promise<ShowsByRoot> {
    const hit = listed.get(key);
    if (hit && hit.build === b && clock() - hit.at < SHOWS_MS) return hit.byRoot;
    const byRoot: ShowsByRoot = new Map();
    await pool([...b.roots], 4, async ([root, project]) => {
      const shows = await options.shows!.list(root, Math.max(0, Math.floor(b.data.from))).catch((error) => {
        console.warn("[canvas] shows", root, error instanceof Error ? error.message : error);
        return [] as RuntimeShow[];
      });
      // a past window keeps only what was shown by its end
      const kept = shows.filter((s) => s.projectRoot === root && SHOW_ID.test(s.id) && (b.data.live || s.createdAt <= b.data.end));
      if (kept.length) byRoot.set(root, { project, shows: kept });
      for (const s of shows) known.set(s.id, s);
    });
    listed.set(key, { at: clock(), byRoot, build: b });
    return byRoot;
  }

  /*
   * A build reads the Review window, which can take seconds when its own cache has lapsed. A result younger than
   * FRESH_MS is served as is; an older one, up to STALE_MS, is served at once while the next one builds behind it,
   * so only the first open after a long quiet waits.
   */
  /** A shown document's first lines, read from the runtime's copy. A binary file has none. */
  async function showHead(p: string): Promise<CanvasFileHead | null> {
    if (!options.shows) return null;
    const id = p.slice(SHOW_PATH.length), show = known.get(id);
    if (!show || show.kind === "image" || show.kind === "video") return null;
    const res = await options.shows.bytes(id, `bytes=0-${HEAD_BYTES - 1}`).catch(() => null);
    if (!res || !res.ok) { await res?.body?.cancel(); return null; }
    const txt = new TextDecoder("utf-8", { fatal: false }).decode(await res.arrayBuffer());
    if (txt.includes("\0")) return null;
    return headOf(p, txt, /\.html?$/i.test(show.sourcePath) || show.mediaType === "text/html", show.createdAt);
  }

  /*
   * The newest version of a shown item, from the version a card names: an open diagram follows the agent showing it
   * again without waiting for the next canvas poll. Listed again after ARC_SHOWS_MS, per item.
   */
  const newestOf = new Map<string, { at: number; p: Promise<RuntimeShow | null> }>();
  function newestShow(id: string): Promise<RuntimeShow | null> {
    const show = known.get(id);
    if (!show || !options.shows) return Promise.resolve(null);
    const hit = newestOf.get(show.itemId);
    if (hit && clock() - hit.at < ARC_SHOWS_MS) return hit.p;
    const p = options.shows.list(show.projectRoot, Math.max(0, Math.floor(show.createdAt))).then((shows) => {
      let best = known.get(id) ?? show;
      for (const s of shows) {
        if (s.itemId !== show.itemId || s.projectRoot !== show.projectRoot || !SHOW_ID.test(s.id)) continue;
        known.set(s.id, s);
        if (s.createdAt > best.createdAt) best = s;
      }
      return best;
    }, () => known.get(id) ?? show);
    newestOf.set(show.itemId, { at: clock(), p });
    return p;
  }

  /* builds by window, "<hours>" live or "<hours>@<end>" past. A past window's calls are all in, so it stays fresh
     far longer; only the newest few are kept, since each step back is a window of its own. */
  const built = new Map<string, Built>();
  const pending = new Map<string, Promise<Built>>();
  const keep = (key: string, b: Built) => {
    built.set(key, b);
    if (!b.data.live) {
      const past = [...built].filter(([, x]) => !x.data.live).sort((x, y) => x[1].at - y[1].at);
      for (const [k] of past.slice(0, Math.max(0, past.length - PAST_KEPT))) built.delete(k);
    }
  };
  function get(hours: number, end: number | null): Promise<Built> {
    const key = end == null ? String(hours) : `${hours}@${end}`;
    const fresh = end == null ? FRESH_MS : PAST_FRESH_MS, stale = end == null ? STALE_MS : PAST_STALE_MS;
    const last = built.get(key);
    const age = last ? clock() - last.at : Number.POSITIVE_INFINITY;
    if (last && age < fresh) return Promise.resolve(last);
    let running = pending.get(key);
    if (!running) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("canvas build timed out")), BUILD_TIMEOUT_MS); });
      const p = Promise.race([build(hours, end), late]).then((b) => { keep(key, b); return b; }).finally(() => clearTimeout(timer));
      pending.set(key, p);
      p.finally(() => pending.delete(key)).catch(() => {});
      running = p;
    }
    if (last && age < stale) { running.catch(() => {}); return Promise.resolve(last); }
    return running;
  }

  return {
    /**
     * The canvas of `hours` (canvasHours) ending at `end` (`?end=`, clamped by canvasEnd: none or not before now is
     * the live window), with the shows of its projects.
     */
    data: async (hours: number, end?: string | number | null) => {
      const e = canvasEnd(end, hours, clock());
      const b = await get(hours, e);
      return options.shows ? mergeShows(b.data, await showsFor(b, e == null ? String(hours) : `${hours}@${e}`), home) : b.data;
    },
    /** A shown version's bytes from the runtime, a byte range when asked; null when there are no shows here. */
    showBytes: async (p: string, range?: string | null): Promise<Response | null> =>
      options.shows && isShowPath(p) ? options.shows.bytes(p.slice(SHOW_PATH.length), range) : null,
    /** The real path of a file a kept build listed (a page may still show an older one), re-checked now, or null. */
    async real(p: string): Promise<string | null> {
      let a: string | undefined;
      for (const b of built.values()) if ((a = b.allow.get(p))) break;
      if (!a) return null;
      const r = await realpath(a).catch(() => null);
      if (!r || r !== a) return null;
      try { return (await stat(r)).isFile() ? r : null; } catch { return null; }
    },
    /** A listed document's first lines, as text. */
    async head(p: string): Promise<CanvasFileHead | null> {
      if (isShowPath(p)) return showHead(p);
      const r = await this.real(p); if (!r || canvasKindOf(r) !== "doc") return null;
      const st = await stat(r); if (st.size > DOC_BYTES_CAP) return null;
      return headOf(p, await readStart(r, HEAD_BYTES), /\.html?$/i.test(r), st.mtimeMs);
    },
    /**
     * An Arc diagram's source as it is now: a listed `*.arc.json` file, or the newest shown version of one. `version`
     * names what was read (the file's saved time and size, or the show id); when it equals `seen`, the text is left out.
     * With `follow` false (a past window) a shown path is read as the version it names, which that window listed, not
     * the newest; a file has no history, so it is read as it is now either way.
     */
    async arc(p: string, seen?: string | null, follow = true): Promise<CanvasArcSource | null> {
      if (isShowPath(p)) {
        const id = p.slice(SHOW_PATH.length);
        const show = follow ? await newestShow(id) : known.get(id) ?? null;
        if (!show || !isArcPath(show.sourcePath) || show.byteSize > DOC_BYTES_CAP) return null;
        const version = `"show-${show.id}"`;
        if (version === seen) return { version, path: SHOW_PATH + show.id, mt: show.createdAt };
        const res = await options.shows!.bytes(show.id).catch(() => null);
        if (!res || !res.ok) { await res?.body?.cancel(); return null; }
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > DOC_BYTES_CAP) return null;
        return { version, path: SHOW_PATH + show.id, mt: show.createdAt, text: new TextDecoder().decode(bytes) };
      }
      if (!isArcPath(p)) return null;
      const r = await this.real(p); if (!r || !isArcPath(r)) return null;
      const st = await stat(r); if (st.size > DOC_BYTES_CAP) return null;
      const version = `"${Math.round(st.mtimeMs)}-${st.size}"`;
      if (version === seen) return { version, path: p, mt: st.mtimeMs };
      return { version, path: p, mt: st.mtimeMs, text: await readFile(r, "utf8") };
    },
    /** A worked source file as it is now, as written, up to CANVAS_TEXT_LINES lines. Never media or a document. */
    async text(p: string): Promise<CanvasFileText | null> {
      const r = await this.real(p); if (!r || canvasKindOf(r)) return null;
      const st = await stat(r);
      const txt = await readStart(r, TEXT_BYTES);
      if (txt.includes("\0")) return null;
      const ls = txt.split("\n"), keep = ls.slice(0, CANVAS_TEXT_LINES);
      const total = st.size > TEXT_BYTES ? Math.round(ls.length * (st.size / TEXT_BYTES)) : ls.length;
      return { path: p, text: keep.join("\n"), lines: total, cut: total - keep.length, mt: st.mtimeMs };
    },
    /**
     * What changed in a worked file: its copy now against just before `since` (the session's first commit on it), else
     * against HEAD; a file git does not hold is new, all of it. Never media or a document. Read-only git.
     */
    async diff(p: string, since?: string | null): Promise<CanvasFileDiff | null> {
      const r = await this.real(p); if (!r || canvasKindOf(r)) return null;
      const dir = dirname(r), opts = { maxBuffer: 8 * 1024 * 1024, timeout: 8000 };
      const sha = since && /^[0-9a-f]{7,40}$/.test(since) ? since : null;
      const run = (base: string) => git(dir, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", base, "--", r], opts);
      let from: CanvasFileDiff["from"] = "since";
      // a first commit that git no longer has, or a root commit, falls back to the copy's HEAD
      let out = sha ? await run(`${sha}^`) : null;
      if (out == null) { from = "uncommitted"; out = await run("HEAD"); }
      const at = out ? out.search(/^@@/m) : -1;
      let body = out && at >= 0 ? out.slice(at) : "";
      if (!body && (await git(dir, ["ls-files", "--error-unmatch", "--", r])) == null) {
        const txt = await readStart(r, TEXT_BYTES);
        if (txt.includes("\0")) return null;
        const ls = txt.replace(/\n$/, "").split("\n");
        from = "new"; body = `@@ -0,0 +1,${ls.length} @@\n` + ls.map((l) => "+" + l).join("\n");
      }
      return diffOf(p, from, body);
    },
    /**
     * A worked file whose copy is gone: its session's commits on it, from just before the first to the last, read from
     * the project's main checkout. Only a file and first commit a kept build listed.
     */
    async commitDiff(key: string, since: string): Promise<CanvasFileDiff | null> {
      let span: CommitSpan | undefined;
      for (const b of built.values()) if ((span = b.commits.get(key + "\0" + since))) break;
      if (!span) return null;
      const run = (base: string) => git(span.dir, ["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--no-renames", "-U3", base, span.upto, "--", span.rel], { maxBuffer: 8 * 1024 * 1024, timeout: 8000 });
      // a repository's first commit has no parent: it reads against the empty tree
      const out = (await run(`${span.since}^`)) ?? (await run(EMPTY_TREE));
      if (out == null) return null;
      const at = out.search(/^@@/m);
      return diffOf(key, "commits", at >= 0 ? out.slice(at) : "");
    },
  };
}
export type CanvasService = ReturnType<typeof createCanvasService>;

const VIDEO_TYPE: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
/** The content type of a film, or null for anything else. */
export function videoType(file: string): string | null {
  return VIDEO_TYPE[file.slice(file.lastIndexOf(".") + 1).toLowerCase()] ?? null;
}

/** A single byte range of a file `size` long, from a Range header; null when there is none or it cannot be served. */
export function byteRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { const n = Number(m[2]); if (n <= 0) return "unsatisfiable"; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (m[1] && m[2] && Number(m[1]) > Number(m[2])) return null; // not a valid range (RFC 9110 14.1.1): the whole file
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

