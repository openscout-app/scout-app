/*
 * What a detailed (L) Feed item reads from its owner's session, when it
 * opens: the turn that finished the post, that turn's steps in brief, the
 * files it edited with their diff lines, and the session's last few lines.
 *
 * Steps and lines come from observe events, through the session screens' own
 * readers (session-turns.ts, turn-beats.ts), so a step reads the same here as
 * in the session. Files changed come from git: the session's branch diff
 * (/api/repo-diff/session, patch tier) parsed per file; when its worktree is
 * gone, the trace's short edit previews stand in. Nothing here invents a step
 * or a line.
 */
import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { beatSummary, readTurnBeats, type TurnChangedFile } from "../chat/turn-beats.ts";
import { observedSessionTurns, splitObservedTurn, type ObservedSessionTurn } from "../sessions/session-turns.ts";
import { clip } from "./post-size.ts";

/** A post finishes a little after its turn's last event: the reply lands, then the task closes. */
const SLACK_MS = 2 * 60_000;
export const MAX_STEPS = 8;
export const LAST_LINES = 4;
/** Lines one file shows inline; past this, the rest is a count. */
export const MAX_PATCH_LINES = 400;

export type BriefStep = { id: string; say: string | null; did: string; add: number; del: number; failed: boolean };
/** One changed file, its diff lines in unified form. `cut`: lines past MAX_PATCH_LINES, not shown. */
export type DiffFile = { path: string; name: string; add: number; del: number; lines: string[]; cut?: number };
export type SessionRead = {
  /** The turn's steps, oldest first, at most MAX_STEPS. */
  steps: BriefStep[];
  /** Steps past MAX_STEPS. */
  moreSteps: number;
  /** Files the turn edited, with the edits' diff lines. */
  files: DiffFile[];
  /** The session's newest lines, oldest first. */
  last: string[];
};

function bound(turn: ObservedSessionTurn, pick: (a: number, b: number) => number): number | null {
  let out: number | null = null;
  for (const event of [...turn.prompt, ...turn.work]) {
    if (event.at == null) continue;
    out = out == null ? event.at : pick(out, event.at);
  }
  return out;
}

/**
 * The turn that finished a post at `at`: the newest finished turn that ended
 * by then. A trace without times, or one that starts after `at`, gives its
 * newest finished turn.
 */
export function turnAt(turns: readonly ObservedSessionTurn[], at: number): ObservedSessionTurn | null {
  const done = turns.filter((turn) => !turn.working && turn.work.length > 0);
  let best: ObservedSessionTurn | null = null;
  let bestEnd = -Infinity;
  for (const turn of done) {
    const end = bound(turn, Math.max);
    if (end != null && end <= at + SLACK_MS && end > bestEnd) { best = turn; bestEnd = end; }
  }
  return best ?? done.at(-1) ?? null;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.!?](\s|$)/);
  return stop > 0 ? flat.slice(0, stop + 1) : flat;
}

export function diffFile(file: TurnChangedFile): DiffFile {
  const lines: string[] = [];
  for (const edit of file.edits) {
    if (!edit.diff?.lines.length) continue;
    // Two edits to one file read as two hunks.
    if (lines.length) lines.push("@@");
    lines.push(...edit.diff.lines);
  }
  return { path: file.path, name: file.name, add: file.add, del: file.del, lines };
}

const DRAWN = /[\u2500-\u259f\u2605\u2606`]+/g;

/** A line without its drawn rules and frames; a framed line that leaves one word (a label) reads as nothing. */
function bare(line: string): string {
  // Markdown emphasis reads as plain words here.
  const trimmed = line.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
  const out = trimmed.replace(DRAWN, " ").replace(/\s+/g, " ").trim();
  return out === trimmed || out.split(" ").length >= 2 ? out : "";
}

function nameOf(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** The path a `diff --git` section names: the new side, else the old one for a deletion. */
function sectionPath(lines: readonly string[]): string | null {
  const side = (prefix: string) => {
    const line = lines.find((l) => l.startsWith(prefix));
    const value = line?.slice(prefix.length).trim();
    return value && value !== "/dev/null" ? value.replace(/^[ab]\//, "") : null;
  };
  return side("+++ ") ?? side("--- ") ?? lines[0]?.match(/^a\/(.+?) b\/(.+)$/)?.[2] ?? null;
}

/**
 * Git's unified patch, one entry per file: its hunks' lines with the file
 * headers dropped. A file with no hunks (binary, a pure rename) is left out.
 */
export function patchFiles(raw: string, maxLines = MAX_PATCH_LINES): DiffFile[] {
  const out: DiffFile[] = [];
  for (const section of raw.split(/^diff --git /m).slice(1)) {
    const lines = section.split("\n");
    const path = sectionPath(lines);
    const start = lines.findIndex((line) => line.startsWith("@@"));
    if (!path || start < 0) continue;
    const body = lines.slice(start).filter((line) => line && !line.startsWith("\\"));
    let add = 0;
    let del = 0;
    for (const line of body) {
      if (line.startsWith("+")) add += 1;
      else if (line.startsWith("-")) del += 1;
    }
    const cut = Math.max(0, body.length - maxLines);
    out.push({ path, name: nameOf(path), add, del, lines: body.slice(0, maxLines), ...(cut ? { cut } : {}) });
  }
  return out;
}

/** Files from several diff layers (branch, staged, unstaged), one entry per path, hunks in layer order. */
export function mergeDiffFiles(groups: readonly (readonly DiffFile[])[]): DiffFile[] {
  const byPath = new Map<string, DiffFile>();
  for (const file of groups.flat()) {
    const had = byPath.get(file.path);
    if (!had) { byPath.set(file.path, { ...file, lines: [...file.lines] }); continue; }
    const cut = (had.cut ?? 0) + (file.cut ?? 0);
    byPath.set(file.path, { ...had, add: had.add + file.add, del: had.del + file.del, lines: [...had.lines, ...file.lines], ...(cut ? { cut } : {}) });
  }
  return [...byPath.values()];
}

/**
 * The agent's newest lines in the session, oldest first: what it said last,
 * not its calls. With `after`, only what it said after that time: a post's
 * own turn and the turns before it are its story, not what came since.
 */
export function lastLines(events: readonly ObserveEvent[], count = LAST_LINES, after = -Infinity): string[] {
  const out: string[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < count; i -= 1) {
    const event = events[i]!;
    if (event.kind !== "message") continue;
    if (after > -Infinity && (event.at == null || event.at <= after)) continue;
    const lines = event.text.split("\n").map(bare).filter(Boolean);
    for (let j = lines.length - 1; j >= 0 && out.length < count; j -= 1) out.unshift(lines[j]!);
  }
  return out;
}

function plain(text: string): string {
  return text.replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The last lines the post does not already say. A session that ended on the
 * reply the post was written from adds nothing; one that went on shows what
 * came after.
 */
export function newLines(lines: readonly string[], said: readonly (string | null | undefined)[]): string[] {
  const known = said.filter((t): t is string => Boolean(t)).map(plain).join("\n");
  return lines.filter((line) => {
    const flat = plain(line);
    return flat.length > 0 && !known.includes(flat);
  });
}

export function readSession(data: ObserveData, at: number): SessionRead {
  const turn = turnAt(observedSessionTurns(data, false), at);
  // What came after the post's turn, else after the post.
  const last = lastLines(data.events, LAST_LINES, (turn ? bound(turn, Math.max) : null) ?? at);
  if (!turn) return { steps: [], moreSteps: 0, files: [], last };
  const { trace } = splitObservedTurn(turn);
  const settled = trace.map((event) => (event.live ? { ...event, live: false } : event));
  const view = settled.length ? readTurnBeats(settled, { running: false }) : null;
  const steps = (view?.beats ?? []).map((beat): BriefStep => {
    const summary = beatSummary(beat);
    return { id: beat.id, say: beat.say ? clip(firstSentence(beat.say.text), 24) || null : null, did: summary.text, add: summary.add, del: summary.del, failed: summary.failed };
  }).filter((step) => step.say || step.did);
  const files = (view?.files ?? []).map(diffFile).filter((file) => file.lines.length > 0);
  return { steps: steps.slice(0, MAX_STEPS), moreSteps: Math.max(0, steps.length - MAX_STEPS), files, last };
}
