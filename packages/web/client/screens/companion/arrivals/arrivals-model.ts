/**
 * The arrivals board (Studio: /studies/companion-looks-ii, take 2): the crew
 * as rows on a board, names and states on split flaps. Built on the system
 * corner's threads, so the board and the corner always agree on who is doing
 * what. Pure, so the rules are testable without a host.
 */

import { ledName } from "../../../components/led/led-model.ts";
import type { CornerState, CornerThread } from "../system-corner/system-corner-model.ts";
import { PASS_ROW_MS, passFloor } from "./board-motion.ts";

export const NAME_CELLS = 10;
export const STATUS_CELLS = 7;

export const STATUS_WORD: Record<CornerState, string> = {
  asking: "ASKING",
  waiting: "WAITING",
  working: "WORKING",
  ended: "DONE",
};

/** The agent as the board shows it: the handle without its project, in capitals, cut to the cells. */
export function boardName(handle: string): string {
  return ledName(handle).slice(0, NAME_CELLS);
}

/** "Claude fda13913": what a session is called when nothing says what it is about. */
function isPlaceholder(text: string, harness: string | null | undefined): boolean {
  if (!harness) return false;
  const name = harness.replace(/[^\w-]/g, "");
  return new RegExp(`^${name}( subagent)? [0-9a-f]{8}$`, "i").test(text.trim());
}

/**
 * What a row is called. An agent goes by its name, uncut. A session with no
 * agent goes by its harness, which the coin beside it already shows, so it
 * is named by its work: the task when something says what it is, else the
 * project.
 */
export function rowName(t: Pick<CornerThread, "handle" | "harness" | "task" | "project">): string {
  const unnamed = t.handle === "session" || (t.harness != null && t.handle === t.harness);
  if (!unnamed) return ledName(t.handle).toLowerCase();
  const task = t.task.trim();
  if (task && !isPlaceholder(task, t.harness)) return task;
  return t.project ?? t.harness ?? "session";
}

/**
 * Where it works (project · branch), without what the name already says. A
 * session named only by a placeholder keeps its short id here, so two
 * untitled sessions in one project still tell apart.
 */
export function rowWhere(t: Pick<CornerThread, "handle" | "harness" | "task" | "project" | "branch">): string {
  const name = rowName(t);
  const untitled = isPlaceholder(t.task, t.harness);
  const id = untitled ? t.task.trim().split(" ").pop() : null;
  const where = [t.project === name ? null : t.project, t.branch, id].filter(Boolean).join(" · ");
  if (where) return where;
  return t.task === name ? "" : t.task;
}

/** The latest line, unless it only repeats a placeholder name. */
export function rowNow(t: Pick<CornerThread, "now" | "harness">): string {
  return isPlaceholder(t.now, t.harness) ? "" : t.now;
}

/**
 * Who speaks on a row (Studio /studies/companion-board-light): the agent by
 * its name, or a session with no agent by its harness. Its words follow.
 */
export function rowSpeaker(t: Pick<CornerThread, "handle" | "harness">): string {
  const unnamed = t.handle === "session" || (t.harness != null && t.handle === t.harness);
  return unnamed ? (t.harness ?? "session").toLowerCase() : ledName(t.handle).toLowerCase();
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
/** A weekday is three cells. */
export const DAY_CELLS = 3;

/** An earlier day's time says its weekday instead of a clock; today's says nothing here. */
export function sinceDay(at: number, now: number): string | null {
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) return null;
  const a = new Date(at);
  const b = new Date(now);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()) return null;
  return WEEKDAYS[a.getDay()]!;
}

/** When the row last changed, as a 24-hour clock ("14:02"). */
export function sinceClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "--:--";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type FlipMemory = Map<string, { status: string; changedAt: number }>;

/**
 * Which rows flip. A row flips when its status word changes, or when it
 * first arrives after the board has loaded. The first snapshot flips
 * nothing: a board you open should already be settled.
 */
export function nextFlips(prev: FlipMemory | null, rows: readonly CornerThread[], now: number): FlipMemory {
  const next: FlipMemory = new Map();
  for (const row of rows) {
    const status = STATUS_WORD[row.state];
    const before = prev?.get(row.id);
    if (!prev) next.set(row.id, { status, changedAt: -Infinity });
    else if (!before) next.set(row.id, { status, changedAt: now });
    else next.set(row.id, before.status === status ? before : { status, changedAt: now });
  }
  return next;
}

/*
 * The remark and the pass (Studio /studies/companion-board-rewrites). The
 * board is an airport board: it rewrites on a beat, PASS_MS on the wall
 * clock, and between passes nothing on it moves but an ask. Each row carries
 * one plain word for its state and the clock time that state began.
 */

/**
 * One word per row, the way an airport board says BOARDING or DELAYED.
 * COMPACTING is ten letters and the status flap is STATUS_CELLS = 7 cells,
 * so the board says COMPACT.
 */
export type Remark = "WORKING" | "QUIET" | "ASKING" | "READY" | "DONE" | "STOPPED" | "COMPACT" | "ENDED" | "IDLE";
export const REMARKS: readonly Remark[] = ["WORKING", "QUIET", "ASKING", "READY", "DONE", "STOPPED", "COMPACT", "ENDED", "IDLE"];

/** A thread with no remark of its own reads one from its state. */
const STATE_REMARK: Record<CornerState, Remark> = { asking: "ASKING", working: "WORKING", waiting: "DONE", ended: "DONE" };

/**
 * The row's word. An open ask always reads ASKING. READY is a task the operator
 * asked to hear about, done: their move is Continue or Hold, so it is never ASKING.
 */
export function remarkOf(t: Pick<CornerThread, "state" | "remark">): Remark {
  if (t.state === "asking") return "ASKING";
  return t.remark ?? STATE_REMARK[t.state];
}

/** When the row's state began: its own since, else when it last changed. */
export function sinceOf(t: Pick<CornerThread, "at" | "since">): number {
  return t.since ?? t.at;
}

/** The corner state a word reads as, for urgency, the folded lead and Blink. */
export function remarkState(remark: Remark): CornerState {
  switch (remark) {
    case "ASKING": return "asking";
    case "WORKING": case "QUIET": case "COMPACT": case "IDLE": return "working";
    case "ENDED": return "ended";
    default: return "waiting";
  }
}

/** Departures (still out with an agent) or Arrivals (came back to you). */
export function remarkSection(remark: Remark): BoardSection {
  return boardSection(remarkState(remark));
}

/**
 * Where a row sits: Arrivals (asks, then what came back, then what ended)
 * over Departures, which is one group so WORKING and QUIET never swap places.
 */
const SLOT: Record<Remark, number> = { ASKING: 0, READY: 0, DONE: 1, STOPPED: 1, ENDED: 2, WORKING: 3, QUIET: 3, COMPACT: 3, IDLE: 3 };
const DEPARTURES_SLOT = 3;
/** Where a word sits on the board, top first: asks, then what came back, what ended, then what is still out. */
export function remarkSlot(remark: Remark): number {
  return SLOT[remark];
}
/** The folded board shows the most urgent row. */
const URGENCY: Record<Remark, number> = { ASKING: 0, READY: 0.5, DONE: 1, STOPPED: 1, WORKING: 2, QUIET: 2, COMPACT: 2, IDLE: 2, ENDED: 3 };

/** How long something took, the way the board says it: "47s", "6m 07s". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Each half of a clock time (HH, MM, SS) is two flap cells. */
export const TIME_CELLS = 2;

export type ClockParts = { hh: string; mm: string; ss: string };

/** A moment as a 24-hour clock, in halves for the flaps. */
export function clockParts(at: number): ClockParts {
  if (!Number.isFinite(at) || at <= 0) return { hh: "--", mm: "--", ss: "--" };
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return { hh: two(d.getHours()), mm: two(d.getMinutes()), ss: two(d.getSeconds()) };
}

/** A row on the board: what it shows, and when each cell last turned. */
export type BoardRow = {
  id: string;
  /** The thread as the board shows it: written on a pass or by an ask, held between. */
  thread: CornerThread;
  name: string;
  where: string;
  now: string;
  remark: Remark;
  hh: string;
  mm: string;
  section: BoardSection;
  slot: number;
  /** Asking now: the remark blinks on the shared pulse. */
  asking: boolean;
  /** When each cell turns (ms on the page clock); -Infinity is settled. */
  remarkAt: number;
  /** The remark the row shows until remarkAt: a row later in a pass's stagger holds still until its turn. */
  prevRemark: Remark;
  hhAt: number;
  mmAt: number;
  /** The now line rolls up from prevNow; roll counts the rolls, so each one plays once. */
  prevNow: string;
  roll: number;
  rollAt: number;
};

export type BoardMemory = {
  /** The pass the board was last rewritten on. */
  passAt: number;
  /** Arrivals over Departures, in the order they sit. Frozen between passes. */
  rows: BoardRow[];
  /** This write moved rows, so the board glides them. Never under Reduce Motion. */
  glide: boolean;
};

export type PassOptions = {
  /** Reduce Motion: the same passes, but every cell just changes. */
  reduced?: boolean;
  /** The board hangs from a bottom corner, so its bottom row rewrites first. */
  fromBottom?: boolean;
};

type Cells = Pick<BoardRow, "name" | "where" | "now" | "remark" | "hh" | "mm" | "section" | "slot" | "asking">;

function cellsOf(t: CornerThread): Cells {
  const remark = remarkOf(t);
  const { hh, mm } = clockParts(sinceOf(t));
  const slot = SLOT[remark];
  return { name: rowName(t), where: rowWhere(t), now: rowNow(t), remark, hh, mm, slot, section: slot < DEPARTURES_SLOT ? "arrivals" : "departures", asking: remark === "ASKING" };
}

/** A thread as a row with nothing turning: a new board's rows, and a live line the board has not written yet. */
export function settledRow(t: CornerThread): BoardRow {
  const cells = cellsOf(t);
  return { id: t.id, thread: t, ...cells, remarkAt: -Infinity, prevRemark: cells.remark, hhAt: -Infinity, mmAt: -Infinity, prevNow: "", roll: 0, rollAt: -Infinity };
}

/** Something the row shows is different. */
function differs(r: BoardRow, c: Cells): boolean {
  return r.remark !== c.remark || r.hh !== c.hh || r.mm !== c.mm || r.now !== c.now || r.name !== c.name || r.where !== c.where;
}

/**
 * Write a row: only the cells whose value changed turn, each stamped `at`.
 * Name and where are long text: they change in place, never on flaps. The
 * row moves to its new place only when `withPlace` (a pass).
 */
function write(r: BoardRow, t: CornerThread, c: Cells, at: number, withPlace: boolean): BoardRow {
  const next: BoardRow = { ...r, thread: t, name: c.name, where: c.where, asking: c.asking };
  if (c.remark !== r.remark) { next.prevRemark = r.remark; next.remark = c.remark; next.remarkAt = at; }
  if (c.hh !== r.hh) { next.hh = c.hh; next.hhAt = at; }
  if (c.mm !== r.mm) { next.mm = c.mm; next.mmAt = at; }
  if (c.now !== r.now) { next.prevNow = r.now; next.now = c.now; next.roll = r.roll + 1; next.rollAt = at; }
  if (withPlace) { next.section = c.section; next.slot = c.slot; }
  return next;
}

/**
 * Rows in their places: by slot, and within a slot in the order they held.
 * A row new to its slot goes first in it, newest first, the way the board
 * has always put the latest at the top of its group.
 */
function place(before: readonly BoardRow[], rows: readonly BoardRow[]): BoardRow[] {
  const held = new Map(before.map((r, i) => [r.id, { i, slot: r.slot }]));
  const out: BoardRow[] = [];
  for (let slot = 0; slot <= DEPARTURES_SLOT; slot++) {
    const here = rows.filter((r) => r.slot === slot);
    const stays = here.filter((r) => held.get(r.id)?.slot === slot).sort((a, b) => held.get(a.id)!.i - held.get(b.id)!.i);
    const comes = here.filter((r) => held.get(r.id)?.slot !== slot).sort((a, b) => b.thread.at - a.thread.at);
    out.push(...comes, ...stays);
  }
  return out;
}

/** Where rows sit and which carry an ask strip: when this changes, rows move. */
const layoutKey = (rows: readonly BoardRow[]) => rows.map((r) => `${r.id}\u0000${r.section}\u0000${r.asking ? 1 : 0}`).join("\u0001");

/**
 * Stamps for the rows written now, one PASS_ROW_MS apart from the board's
 * corner: on a bottom corner the bottom row turns first.
 */
function staggered(rows: readonly BoardRow[], due: ReadonlySet<string>, fromBottom: boolean, stamp: (k: number) => number): Map<string, number> {
  const order = rows.map((r, i) => ({ id: r.id, rank: fromBottom ? rows.length - 1 - i : i })).filter((x) => due.has(x.id)).sort((a, b) => a.rank - b.rank);
  return new Map(order.map((x, k) => [x.id, stamp(k)]));
}

/** What an ask is: its request, or for a session's own ask, when it began. */
const askKey = (t: CornerThread) => t.request?.id ?? `since:${sinceOf(t)}`;

/**
 * The board's memory after `now`, given the live pool. Pure.
 *
 *  - The first snapshot is settled: a board you open is already still.
 *  - On a pass (each PASS_MS on the wall clock) every change lands at once:
 *    rows come and go, a row that changed section moves to its place (the
 *    board glides it), and only the cells whose value changed turn, the rows
 *    one PASS_ROW_MS apart from the board's corner.
 *  - Between passes only an ask breaks in, at once: its remark turns to
 *    ASKING, it blinks, and its answer breaks out the same way. Its row keeps
 *    its place until the pass. Everything else waits.
 *  - Reduced motion: the same passes, every stamp settled, no glide.
 *
 * Returns `prev` itself when there is nothing to write, so nothing re-renders.
 */
export function boardPass(prev: BoardMemory | null, pool: readonly CornerThread[], now: number, opts: PassOptions = {}): BoardMemory {
  const { reduced = false, fromBottom = true } = opts;
  const stamp = (k: number) => (reduced ? -Infinity : now + k * PASS_ROW_MS);
  const passAt = passFloor(now);
  if (!prev) {
    return {
      passAt,
      rows: place([], pool.map(settledRow)),
      glide: false,
    };
  }
  const live = new Map(pool.map((t) => [t.id, t]));
  const before = new Map(prev.rows.map((r) => [r.id, r]));

  if (passAt > prev.passAt) {
    // Sections first, all at once: the rows that move glide together. Each
    // carries the live thread, so rows new to a group sort by when they last
    // changed now, not at the pass before.
    const placed = place(prev.rows, pool.map((t) => {
      const c = cellsOf(t);
      const r = before.get(t.id);
      return r ? { ...r, thread: t, section: c.section, slot: c.slot } : settledRow(t);
    }));
    // Then the rows with something new, nearest the corner first.
    const due = new Set(placed.filter((r) => { const old = before.get(r.id); return !old || differs(old, cellsOf(live.get(r.id)!)); }).map((r) => r.id));
    const at = staggered(placed, due, fromBottom, stamp);
    const rows = placed.map((r) => {
      const t = live.get(r.id)!;
      const old = before.get(r.id);
      const when = at.get(r.id);
      if (!old) return { ...r, remarkAt: when!, hhAt: when!, mmAt: when! };
      // Nothing it shows changed: its details (the live thread) still freshen, unseen.
      if (when === undefined) return r;
      return write(old, t, cellsOf(t), when, true);
    });
    return {
      passAt,
      rows,
      glide: !reduced && layoutKey(prev.rows) !== layoutKey(rows),
    };
  }

  // Between passes: asks break in and out; everything else waits.
  let touched = false;
  const kept: BoardRow[] = [];
  const due = new Set<string>();
  for (const r of prev.rows) {
    const t = live.get(r.id);
    if (!t) {
      // An answered request with nothing behind it leaves at once; other rows wait for the pass.
      if (r.asking) { touched = true; continue; }
      kept.push(r);
      continue;
    }
    const asking = remarkOf(t) === "ASKING";
    if ((asking && (!r.asking || askKey(t) !== askKey(r.thread))) || (!asking && r.asking)) {
      touched = true;
      due.add(r.id);
    }
    kept.push(r);
  }
  // An ask from a thread not on the board yet comes in at once, at the top of Arrivals.
  const fresh = pool.filter((t) => !before.has(t.id) && remarkOf(t) === "ASKING").sort((a, b) => b.at - a.at).map(settledRow);
  for (const r of fresh) due.add(r.id);
  if (!touched && !fresh.length) return prev;
  const order = [...fresh, ...kept];
  const at = staggered(order, due, fromBottom, stamp);
  const rows = order.map((r) => {
    const when = at.get(r.id);
    if (when === undefined) return r;
    if (!before.has(r.id)) return { ...r, remarkAt: when, hhAt: when, mmAt: when };
    const t = live.get(r.id)!;
    return write(r, t, cellsOf(t), when, false);
  });
  return {
    ...prev,
    rows,
    glide: !reduced && layoutKey(prev.rows) !== layoutKey(rows),
  };
}

/** The row the folded board shows: the most urgent, then the first in place. */
export function boardLead(rows: readonly BoardRow[]): BoardRow | undefined {
  let lead: BoardRow | undefined;
  for (const r of rows) if (!lead || URGENCY[r.remark] < URGENCY[lead.remark]) lead = r;
  return lead;
}

/** A raw session id ("session-mv7czimj-kgu1fq"): a last resort, never a name. */
function sessionLike(label: string): boolean {
  return /^session[-_ ]/i.test(label) || /^[0-9a-f-]{16,}$/i.test(label);
}

/** The first readable name an agent carries: handle, selector, then name. */
function choiceLabel(a: { name: string; handle?: string | null; selector?: string | null; defaultSelector?: string | null }): string {
  const candidates = [a.handle, a.selector, a.defaultSelector, a.name]
    .map((v) => (v ?? "").replace(/^@/, "").trim())
    .filter(Boolean)
    .map((v) => ledName(v).toLowerCase());
  return candidates.find((v) => !sessionLike(v)) ?? candidates[0] ?? "agent";
}

export type AgentChoice = {
  id: string;
  /** How the board writes it: the handle without its project, lowercase. */
  label: string;
  conversationId: string | null;
  projectRoot: string | null;
  cwd: string | null;
  selector: string | null;
  name: string;
};

/**
 * Agents you can start a conversation with, most recently active first,
 * one per id, without bare session ids. The crew on the board comes first, so the agent you were
 * just looking at is one keystroke away.
 */
export function agentChoices(
  agents: ReadonlyArray<{ id: string; name: string; handle?: string | null; selector?: string | null; defaultSelector?: string | null; conversationId?: string | null; projectRoot?: string | null; cwd?: string | null; updatedAt?: number | null }>,
  crewHandles: readonly string[] = [],
): AgentChoice[] {
  const seen = new Set<string>();
  const crew = new Set(crewHandles.map((h) => h.toLowerCase()));
  const rank = (a: (typeof agents)[number]) => (crew.has((a.handle ?? a.name).toLowerCase()) || crew.has(a.name.toLowerCase()) ? 2 : sessionLike(choiceLabel(a)) ? 0 : 1);
  return [...agents]
    .filter((a) => a.id && !seen.has(a.id) && seen.add(a.id))
    // A raw session id is not someone you start a conversation with, unless it is on the board.
    .filter((a) => rank(a) > 0)
    .sort((a, b) => rank(b) - rank(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map((a) => ({
      id: a.id,
      label: choiceLabel(a),
      conversationId: a.conversationId ?? null,
      projectRoot: a.projectRoot ?? null,
      cwd: a.cwd ?? null,
      selector: a.selector ?? a.defaultSelector ?? null,
      name: a.name,
    }));
}

/*
 * The storyline (2026-10-14): a stable corner board with Departures (asks
 * out, still with an agent) and Arrivals (what came back: asks for you,
 * work waiting on you, work done); Scoutbot beside it when wanted; attached
 * agents on app windows or the desk, shown by a hotkey.
 */

export type BoardSection = "arrivals" | "departures";

/** Out with an agent is a departure; anything that came back to you is an arrival. */
export function boardSection(state: CornerState): BoardSection {
  return state === "working" ? "departures" : "arrivals";
}

/** The rows of each section, in the order given. Arrivals first: they are what wants you. */
export function splitSections<T extends { state: CornerState }>(rows: readonly T[]): Record<BoardSection, T[]> {
  const out: Record<BoardSection, T[]> = { arrivals: [], departures: [] };
  for (const row of rows) out[boardSection(row.state)].push(row);
  return out;
}

/** The folded board's count: "2 in · 3 out", leaving out a zero side. */
export function sectionCount(rows: readonly { state: CornerState }[]): string {
  const { arrivals, departures } = splitSections(rows);
  return [arrivals.length ? `${arrivals.length} in` : "", departures.length ? `${departures.length} out` : ""].filter(Boolean).join(" · ");
}

/** An attached plate shows while the overlay is on; an ask shows regardless, so it is never missed. */
export function plateShown(state: CornerState, overlay: boolean, held: boolean): boolean {
  return overlay || held || state === "asking";
}

export type PlateSide = "bottom" | "top" | "left" | "right" | null;

/**
 * Where a plate sits for the host's anchor: on a window top it stands on the
 * edge like a tab, hanging under one it hangs, on a side it sits beside it,
 * and free on the desk it is centred above the point.
 */
export function plateBox(anchor: { x: number; y: number; down: PlateSide }, w: number, h: number): { left: number; top: number } {
  switch (anchor.down) {
    case "top": return { left: anchor.x - w / 2, top: anchor.y };
    case "left": return { left: anchor.x, top: anchor.y - h / 2 };
    case "right": return { left: anchor.x - w, top: anchor.y - h / 2 };
    default: return { left: anchor.x - w / 2, top: anchor.y - h };
  }
}

/**
 * Where a strip sized to its own text sits for the host's anchor, as plateBox
 * places a box of known width: the point it hangs from, and the shift
 * (a CSS translate) that puts its measured width on the anchor's side.
 */
export function plateFit(anchor: { x: number; y: number; down: PlateSide }, h: number): { left: number; top: number; shift: string } {
  switch (anchor.down) {
    case "top": return { left: anchor.x, top: anchor.y, shift: "-50% 0" };
    case "left": return { left: anchor.x, top: anchor.y - h / 2, shift: "0 0" };
    case "right": return { left: anchor.x, top: anchor.y - h / 2, shift: "-100% 0" };
    default: return { left: anchor.x, top: anchor.y - h, shift: "-50% 0" };
  }
}

export type BoardCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const CORNERS: readonly BoardCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
export const BOARD_CORNER_KEY = "scout:companion:board-corner";

export function parseBoardCorner(value: unknown): BoardCorner | null {
  return CORNERS.includes(value as BoardCorner) ? (value as BoardCorner) : null;
}

/**
 * Where a moved board sits: its distance from its corner's two edges, in CSS
 * pixels. The board still hangs from that corner, so it grows away from it.
 * Null is the corner's own inset.
 */
export type BoardInset = { x: number; y: number };
export const BOARD_INSET_KEY = "scout:companion:board-inset";
export const DEFAULT_BOARD_INSET = 12;

export function parseBoardInset(value: unknown): BoardInset | null {
  if (typeof value === "string") {
    try { return parseBoardInset(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
}

/**
 * A board dropped at `rect` hangs from the corner nearest its middle, at its
 * distance from that corner's edges, and never off the display.
 */
export function anchorBoard(
  rect: { left: number; top: number; width: number; height: number },
  view: { width: number; height: number },
): { corner: BoardCorner; inset: BoardInset } {
  const left = rect.left + rect.width / 2 < view.width / 2;
  const top = rect.top + rect.height / 2 < view.height / 2;
  const clamp = (v: number, size: number, room: number) => Math.round(Math.min(Math.max(0, v), Math.max(0, room - size)));
  const x = clamp(left ? rect.left : view.width - rect.left - rect.width, rect.width, view.width);
  const y = clamp(top ? rect.top : view.height - rect.top - rect.height, rect.height, view.height);
  return { corner: `${top ? "top" : "bottom"}-${left ? "left" : "right"}`, inset: { x, y } };
}

/** The four offsets that put the board at its inset from its corner. */
export function boardInsetStyle(corner: BoardCorner, inset: BoardInset | null): { top: string; right: string; bottom: string; left: string } {
  const x = `${inset?.x ?? DEFAULT_BOARD_INSET}px`;
  const y = `${inset?.y ?? DEFAULT_BOARD_INSET}px`;
  const top = corner.startsWith("top");
  const left = corner.endsWith("left");
  return { top: top ? y : "auto", bottom: top ? "auto" : y, left: left ? x : "auto", right: left ? "auto" : x };
}

/**
 * The companion's Floating position: the board stands on the bottom edge,
 * centred on `share` of the display's width and never closer to a side than
 * the corner's own inset. It grows up, away from the edge.
 */
export function floatingBoardStyle(share: number, boardWidth: number, viewWidth: number): { top: string; right: string; bottom: string; left: string } {
  const centred = share * viewWidth - boardWidth / 2;
  const room = Math.max(DEFAULT_BOARD_INSET, viewWidth - DEFAULT_BOARD_INSET - boardWidth);
  const left = Math.round(Math.min(Math.max(DEFAULT_BOARD_INSET, centred), room));
  return { top: "auto", right: "auto", bottom: `${DEFAULT_BOARD_INSET}px`, left: `${left}px` };
}

/** Where a floating board let go at `rect` stands: the share of the width under its middle. */
export function floatShareOf(rect: { left: number; width: number }, viewWidth: number): number {
  if (!(viewWidth > 0)) return 0.5;
  const share = (rect.left + rect.width / 2) / viewWidth;
  return Math.round(Math.min(1, Math.max(0, share)) * 1000) / 1000;
}

/** The corner a floating board grows from: the bottom one on the side nearer its middle. */
export function floatingCorner(share: number): BoardCorner {
  return share < 0.5 ? "bottom-left" : "bottom-right";
}
