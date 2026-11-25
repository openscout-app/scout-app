/*
 * The canvas at a glance, for a slot in Home's Feed: each agent at work as an area, the files it touched as faint
 * blocks, its cursor on the one it touched last, and a pulse where it shipped something. Laid out like the canvas
 * (an area per session, blocks in rows of four) but from the runtime's tail alone: the full canvas read
 * (GET /api/ops/canvas) is not made. Pure, so it can be tested without a page.
 *
 * Where a cursor is comes from the session's tool calls as the tail summarizes them ("Edit broker/service.ts",
 * "sed -n '1,80p' client/app.tsx"): the file a call names is a block, and the newest call's file holds the cursor.
 * A ship is a call that shows, pushes or captures something (`scout show`, `git push`, `gh pr create`, a render or
 * a screen capture). No thumbnails: blocks are faint shapes named by their file. Each area carries its session's
 * title, project and copy for a one-line label, and the cursor carries its harness's mark.
 */
import type { TailEvent } from "../../lib/types.ts";
import { CARD_W, GAP, LABEL_H, type Box } from "./scene.ts";

export type GlanceAgent = {
  id: string;
  /** the harness session the tail names; an agent without one has no blocks */
  sessionId: string | null;
  name: string;
  harness: string | null;
  project: string;
  /** what the session is about, for the area's label */
  title?: string | null;
  /** the copy or branch it works on */
  place?: string | null;
  /** blocked on the operator */
  asks: boolean;
};

export type GlanceBlock = { key: string; box: Box; at: number };
export type GlanceArea = {
  id: string;
  name: string;
  harness: string | null;
  project: string;
  title: string | null;
  place: string | null;
  asks: boolean;
  box: Box;
  blocks: GlanceBlock[];
  /** where its cursor sits, in world units */
  cursor: { x: number; y: number };
  /** its newest call, if the tail has one */
  at: number | null;
  /** its newest few calls as the tail summarizes them, newest first, for the hover card */
  recent: GlanceCall[];
  /** the file its cursor is on */
  file: string | null;
};
export type GlanceCall = { id: string; summary: string; ts: number };
export type GlanceShip = { id: string; area: string; x: number; y: number; at: number };
export type Glance = { areas: GlanceArea[]; ships: GlanceShip[]; bounds: Box };

/** areas drawn; the rest are counted in the slot's head */
export const GLANCE_AREAS = 6;
/** blocks per area: two rows of four, as an area's cards sit on the canvas */
export const GLANCE_BLOCKS = 8;
/** calls an area keeps for its hover card */
export const GLANCE_RECENT = 4;
/** a ship pulses while it is younger than this */
export const GLANCE_SHIP_MS = 90_000;
/** the slot's shape, wide and short: areas are arranged to fill it */
export const GLANCE_ASPECT = 3.4;

const COLS = 4;
const TILE_H = 150;
const AREA_W = COLS * CARD_W + (COLS - 1) * GAP;
const AREA_H = LABEL_H + 2 * TILE_H + GAP;
const AREA_GAP = 48;

const FILE_TOOL = /^(?:Read|Edit|Write|MultiEdit|NotebookEdit|Update|Create|View|Open)\s+(\S+)/;
const PATH_IN_TEXT = /(?:^|[\s'"=(])((?:[\w@~.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][\w]{0,5})(?=$|[\s'":;),])/;
const SHIP = /\b(?:scout show|mcp__scout__show|git push|gh pr create|capture:web|hyperframes render|screencapture)\b/i;

/** The file a tool call names, as the tail wrote it; null for a call that names none. */
export function fileOf(event: Pick<TailEvent, "kind" | "summary">): string | null {
  if (event.kind !== "tool" || !event.summary) return null;
  const named = FILE_TOOL.exec(event.summary)?.[1] ?? PATH_IN_TEXT.exec(event.summary)?.[1] ?? null;
  if (!named || named.includes("://") || /^\d+(?:\.\d+)+$/.test(named)) return null;
  return named.replace(/[.,]+$/, "");
}

/** What a block is called on the glance: its file's name, without the folders a block has no room for. */
export function blockName(key: string): string {
  return key.replace(/\/+$/, "").split("/").pop() || key;
}

/** A call that ships something: shows it, pushes it, opens a pull request, renders or captures it. */
export function ships(event: Pick<TailEvent, "kind" | "summary">): boolean {
  return event.kind === "tool" && SHIP.test(event.summary ?? "");
}

/** Columns of areas that draw them largest in a box `aspect` times wider than tall. */
function columns(n: number, aspect: number): number {
  let best = 1, score = 0;
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const w = cols * AREA_W + (cols - 1) * AREA_GAP;
    const h = rows * AREA_H + (rows - 1) * AREA_GAP;
    const s = Math.min(aspect / w, 1 / h);
    if (s > score) { score = s; best = cols; }
  }
  return best;
}

export function glance(agents: readonly GlanceAgent[], events: readonly TailEvent[], nowMs: number, aspect = GLANCE_ASPECT): Glance {
  const shown = agents.slice(0, GLANCE_AREAS);
  const cols = columns(shown.length, aspect);
  const bySession = new Map<string, TailEvent[]>();
  for (const event of events) {
    if (!event.sessionId || event.kind !== "tool") continue;
    (bySession.get(event.sessionId) ?? bySession.set(event.sessionId, []).get(event.sessionId)!).push(event);
  }
  const areas: GlanceArea[] = [];
  const pulses: GlanceShip[] = [];
  shown.forEach((agent, i) => {
    const box = { x: (i % cols) * (AREA_W + AREA_GAP), y: Math.floor(i / cols) * (AREA_H + AREA_GAP), w: AREA_W, h: AREA_H };
    const calls = [...(agent.sessionId ? bySession.get(agent.sessionId) ?? [] : [])].sort((a, b) => a.ts - b.ts);
    // per file, when the session first and last touched it
    const touched = new Map<string, { first: number; last: number }>();
    for (const call of calls) {
      const file = fileOf(call);
      if (!file) continue;
      const t = touched.get(file);
      touched.set(file, { first: t?.first ?? call.ts, last: call.ts });
    }
    // the newest few files, kept in the order they were first touched, so a block stays put while the cursor moves
    const kept = [...touched].sort((a, b) => b[1].last - a[1].last).slice(0, GLANCE_BLOCKS).sort((a, b) => a[1].first - b[1].first || (a[0] < b[0] ? -1 : 1));
    const blocks = kept.map(([key, t], j) => ({
      key,
      at: t.last,
      box: { x: box.x + (j % COLS) * (CARD_W + GAP), y: box.y + LABEL_H + Math.floor(j / COLS) * (TILE_H + GAP), w: CARD_W, h: TILE_H },
    }));
    const newest = blocks.reduce<GlanceBlock | null>((a, b) => (!a || b.at > a.at ? b : a), null);
    const cursor = newest
      ? { x: newest.box.x + newest.box.w * 0.62, y: newest.box.y + newest.box.h * 0.58 }
      // no file yet: where its first block will be, clear of the label
      : { x: box.x + CARD_W * 0.62, y: box.y + LABEL_H + TILE_H * 0.58 };
    const last = calls.at(-1)?.ts ?? null;
    const recent = calls.filter((c) => c.summary?.trim()).slice(-GLANCE_RECENT).reverse().map((c) => ({ id: c.id, summary: c.summary!.trim(), ts: c.ts }));
    areas.push({ id: agent.id, name: agent.name, harness: agent.harness, project: agent.project, title: agent.title ?? null, place: agent.place ?? null, asks: agent.asks, box, blocks, cursor, at: last, recent, file: newest?.key ?? null });
    for (const call of calls) {
      if (!ships(call) || nowMs - call.ts > GLANCE_SHIP_MS || call.ts > nowMs + 5_000) continue;
      pulses.push({ id: call.id, area: agent.id, x: cursor.x, y: cursor.y, at: call.ts });
    }
  });
  const rows = Math.max(1, Math.ceil(shown.length / cols));
  const bounds = {
    x: 0,
    y: 0,
    w: Math.max(AREA_W, Math.min(shown.length, cols) * (AREA_W + AREA_GAP) - AREA_GAP),
    h: rows * (AREA_H + AREA_GAP) - AREA_GAP,
  };
  return { areas, ships: pulses, bounds };
}

/** The area under a world point, if any. */
export function areaAt(g: Glance, p: { x: number; y: number }): GlanceArea | null {
  return g.areas.find((a) => p.x >= a.box.x && p.x <= a.box.x + a.box.w && p.y >= a.box.y && p.y <= a.box.y + a.box.h) ?? null;
}
