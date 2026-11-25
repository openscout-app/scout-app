/*
 * Canvas: where everything sits, in world units. Pure, so the layouts can be tested without a page.
 *
 * Canvas: Shared is a column on the left; each agent's area sits to its right, newest first, in two columns that
 * fill the shorter one first. An area shows the live views the agent drives (embeds) first, as wide as the area and
 * tall enough to follow without opening them; then what it made to look at (screenshots, films, documents) as cards,
 * and under them the repo files it worked as a strip of tiles, sized by work. With files, one row of cards shows
 * until the area is opened out; without, two.
 * Overview: every file the agents touched, as the Review window maps it: projects, then worktrees, then files,
 * squarified and sized by the work done on them.
 */
import type { CanvasAgent, CanvasFile, CanvasItem, CanvasWork } from "../../../shared/canvas.ts";

export type Box = { x: number; y: number; w: number; h: number };

export const CARD_W = 232;
export const MEDIA_H = 145;
export const CARD_H = MEDIA_H + 50;
export const GAP = 16;
/** an area's head: its name line, what the agent said last, and the operator's latest prompt */
export const LABEL_H = 70;
export const AREA_COLS = 4;
export const AREA_ROWS = 2;
const AREA_W = AREA_COLS * CARD_W + (AREA_COLS - 1) * GAP;
/** embeds an area draws until it is opened out */
const EMBEDS_SHOWN = 2;
const AREA_GAP = 48;
const COLUMN_GAP = 72;
/** the canvas's full width: both columns of areas */
export const ROW_W = 2 * AREA_W + COLUMN_GAP;
/**
 * An embed's size until the operator sizes it: the full row, and tall enough that a diagram about 1660 by 700 (ten
 * large nodes in four columns, with its view rail) is drawn at 1:1 at 100% canvas zoom.
 */
export const EMBED_W = ROW_W;
export const EMBED_H = 860;
/** expanded in place: the full row, and tall */
export const EMBED_TALL_H = 1400;
export const EMBED_MIN_W = 480;
export const EMBED_MIN_H = 280;
export type EmbedSize = { w: number; h: number };
/** A size the operator asked for, kept to what the canvas can lay out. */
export const clampEmbed = (z: EmbedSize): EmbedSize => ({
  w: Math.round(Math.min(ROW_W, Math.max(EMBED_MIN_W, z.w))),
  h: Math.round(Math.min(4 * EMBED_H, Math.max(EMBED_MIN_H, z.h))),
});
const SHARED: Box = { x: 32, y: 32, w: CARD_W + 48, h: 0 };
const SHARED_HEAD = 56;
export const FILES_H = 208;
/** files in a strip until the area is opened out */
const FILES_SHOWN = 8;
/** grouped by work: the head over the sessions that share a checkout, and the space after them */
export const FRAME_HEAD = 56;
const FRAME_GAP = 40;

export type Area = {
  agent: number;
  /** where the label sits: the mark's resting place */
  home: { x: number; y: number };
  box: Box;
  shown: CanvasItem[];
  /** cards and files left out until the area is opened out */
  more: number;
  /** cards and files in all */
  total: number;
  /** the files strip, with a tile per file, busiest first */
  files: { box: Box; tiles: { work: CanvasWork; r: Box }[] } | null;
};

export type CanvasScene = {
  shared: Box;
  sharedSlot: (i: number) => Box;
  areas: Area[];
  /** item key → its box in its area */
  boxes: Map<string, Box>;
  /** grouped by work: a head over each group of areas; empty when the canvas is not grouped */
  heads: FrameHead[];
  bounds: Box;
};

/** The head of a group of areas: the checkout its sessions worked in, or null over the sessions on main. */
export type FrameHead = { title: string | null; sessions: number; box: Box };

/** How the areas are grouped: the checkouts sessions worked in, then the sessions left over. Indexes into `agents`. */
export type Grouping = { frames: readonly { title: string; agents: readonly number[] }[]; rest: readonly number[] };

/**
 * Agents with something to show, or at work now, newest first; their items in a grid each. `agents` is the whole
 * list, so item indexes hold; an agent outside the canvas's project is null. `sharedCount` null: no Shared column.
 * `sizeOf` is the size the operator gave an embed, by item key; an embed without one is EMBED_W by EMBED_H. An area
 * holding an embed wider than a column spans both.
 */
export function canvasScene(
  agents: readonly (CanvasAgent | null)[], items: readonly CanvasItem[], work: readonly CanvasWork[], sharedCount: number | null, open: ReadonlySet<number>,
  grouping: Grouping | null = null, sizeOf: (key: string) => EmbedSize | undefined = () => undefined,
): CanvasScene {
  const byAgent = new Map<number, CanvasItem[]>();
  for (const it of items) { const l = byAgent.get(it.agent); if (l) l.push(it); else byAgent.set(it.agent, [it]); }
  const filesOf = new Map<number, CanvasWork[]>();
  for (const w of work) { const l = filesOf.get(w.agent); if (l) l.push(w); else filesOf.set(w.agent, [w]); }
  const order = agents
    .map((a, i) => ({ a, i }))
    .filter((x): x is { a: CanvasAgent; i: number } => !!x.a && (byAgent.has(x.i) || filesOf.has(x.i) || x.a.state !== "quiet"))
    .sort((x, y) => y.a.lastAt - x.a.lastAt);

  /* no Shared column without a board (sharedCount null): the areas start at its place */
  const sharedH = sharedCount === null ? 0 : SHARED_HEAD + Math.max(1, sharedCount) * (CARD_H + GAP) + 8;
  const shared: Box = sharedCount === null ? { ...SHARED, w: 0, h: 0 } : { ...SHARED, h: sharedH };
  const sharedSlot = (i: number): Box => ({ x: SHARED.x + 24, y: SHARED.y + SHARED_HEAD + i * (CARD_H + GAP), w: CARD_W, h: CARD_H });

  const left = sharedCount === null ? SHARED.x : SHARED.x + SHARED.w + COLUMN_GAP;
  const cols = [{ x: left, y: SHARED.y }, { x: left + AREA_W + COLUMN_GAP, y: SHARED.y }];
  const areas: Area[] = [];
  const boxes = new Map<string, Box>();
  const heads: FrameHead[] = [];
  const place = (i: number) => {
    const all = byAgent.get(i) ?? [];
    const allWorked = (filesOf.get(i) ?? []).slice().sort((a, b) => b.work - a.work);
    const worked = open.has(i) ? allWorked : allWorked.slice(0, FILES_SHOWN);
    const embeds = all.filter((it) => it.kind === "embed").slice(0, open.has(i) ? undefined : EMBEDS_SHOWN);
    const cards = all.filter((it) => it.kind !== "embed");
    const cap = open.has(i) ? cards.length : AREA_COLS * (worked.length ? 1 : AREA_ROWS);
    const shown = [...embeds, ...cards.slice(0, cap)];
    const rows = Math.ceil((shown.length - embeds.length) / AREA_COLS);
    const sizes = embeds.map((it) => clampEmbed(sizeOf(it.key) ?? { w: EMBED_W, h: EMBED_H }));
    const embedsH = sizes.reduce((sum, z) => sum + z.h + GAP, 0);
    const w = Math.max(AREA_W, ...sizes.map((z) => z.w));
    const cardsH = rows ? rows * CARD_H + (rows - 1) * GAP : 0;
    const top = LABEL_H + 12;
    const cardsY = top + embedsH;
    const filesY = cardsY + (rows ? cardsH + GAP : 0);
    const h = worked.length ? filesY + FILES_H : rows ? cardsY + cardsH : embeds.length ? cardsY - GAP : top + 36;
    /* wider than a column: the area starts under both columns, at the left one, and both continue under it */
    const wide = w > AREA_W;
    const col = wide ? { x: cols[0].x, y: Math.max(cols[0].y, cols[1].y) } : cols[0].y <= cols[1].y ? cols[0] : cols[1];
    const box: Box = { x: col.x, y: col.y, w, h };
    let ey = col.y + top;
    embeds.forEach((it, k) => { boxes.set(it.key, { x: col.x, y: ey, ...sizes[k] }); ey += sizes[k].h + GAP; });
    shown.slice(embeds.length).forEach((it, k) => boxes.set(it.key, {
      x: col.x + (k % AREA_COLS) * (CARD_W + GAP),
      y: col.y + cardsY + Math.floor(k / AREA_COLS) * (CARD_H + GAP),
      w: CARD_W, h: CARD_H,
    }));
    let files: Area["files"] = null;
    if (worked.length) {
      /* a strip as wide as its files need: one card's width for one file, the area's for eight */
      const fb: Box = { x: col.x, y: col.y + filesY, w: Math.min(AREA_W, Math.max(CARD_W, worked.length * (AREA_W / FILES_SHOWN))), h: FILES_H };
      files = { box: fb, tiles: squarify(worked.map((w) => ({ item: w, v: Math.max(1, w.work) })), fb).map((t) => ({ work: t.item, r: inset(t.r, 2) })) };
    }
    areas.push({ agent: i, home: { x: col.x, y: col.y }, box, shown, more: all.length - shown.length + allWorked.length - worked.length, total: all.length + allWorked.length, files });
    if (wide) cols[0].y = cols[1].y = col.y + h + AREA_GAP;
    else col.y += h + AREA_GAP;
  };
  /* grouped by work: each group starts both columns level under its head, and ends them level */
  const showing = new Set(order.map((x) => x.i));
  const groups = grouping
    ? [...grouping.frames.map((f) => ({ title: f.title as string | null, list: f.agents.filter((i) => showing.has(i)) })), { title: null, list: grouping.rest.filter((i) => showing.has(i)) }].filter((g) => g.list.length)
    : [];
  if (groups.some((g) => g.title !== null)) {
    for (const g of groups) {
      const y = Math.max(cols[0].y, cols[1].y);
      heads.push({ title: g.title, sessions: g.list.length, box: { x: left, y, w: 2 * AREA_W + COLUMN_GAP, h: FRAME_HEAD } });
      cols[0].y = cols[1].y = y + FRAME_HEAD;
      for (const i of g.list) place(i);
      cols[0].y = cols[1].y = Math.max(cols[0].y, cols[1].y) - AREA_GAP + FRAME_GAP;
    }
  } else {
    for (const { i } of order) place(i);
  }
  const right = areas.length ? Math.max(...areas.map((a) => a.box.x + a.box.w)) : left + AREA_W;
  const bottom = Math.max(shared.y + shared.h, ...cols.map((c) => c.y));
  return { shared, sharedSlot, areas, boxes, heads, bounds: { x: 0, y: 0, w: right + 32, h: bottom + 32 } };
}

/* ── the Overview ─────────────────────────────────────────────────────────── */

export const RAIL_W = 288;
const OV_PAD = 16;
const PROJECT_HEAD = 34;
export const TREE_HEAD = 34;
const TREES_CAP = 18;
const FILES_PER_TREE = 14;

export type OvTree = { id: string; project: string; worktree: string; files: CanvasFile[]; work: number };
export type OverviewScene = {
  projects: { name: string; work: number; r: Box }[];
  trees: { tree: OvTree; r: Box }[];
  /** file id (worktree, then key) → tile */
  tiles: Map<string, { file: CanvasFile; r: Box }>;
  bounds: Box;
};

export const fileId = (worktree: string, key: string) => `${worktree}\u0000${key}`;

/** The busiest worktrees and their busiest files, mapped into a view `vw` by `vh` beside the Now rail. */
export function overviewScene(files: readonly CanvasFile[], vw: number, vh: number): OverviewScene {
  const trees = new Map<string, OvTree>();
  for (const f of files) {
    const id = `${f.project}/${f.worktree}`;
    let t = trees.get(id);
    if (!t) trees.set(id, (t = { id, project: f.project, worktree: f.worktree, files: [], work: 0 }));
    t.files.push(f);
    t.work += f.work;
  }
  const kept = [...trees.values()].sort((a, b) => b.work - a.work).slice(0, TREES_CAP);
  for (const t of kept) { t.files.sort((a, b) => b.work - a.work); t.files = t.files.slice(0, FILES_PER_TREE); t.work = t.files.reduce((s, f) => s + f.work, 0); }
  const names = [...new Set(kept.map((t) => t.project))];
  const area: Box = { x: OV_PAD, y: OV_PAD, w: Math.max(200, vw - RAIL_W - 2 * OV_PAD), h: Math.max(200, vh - 2 * OV_PAD) };
  const out: OverviewScene = { projects: [], trees: [], tiles: new Map(), bounds: { x: 0, y: 0, w: area.w + 2 * OV_PAD, h: area.h + 2 * OV_PAD } };
  const byProject = names.map((name) => ({ item: name, v: kept.filter((t) => t.project === name).reduce((s, t) => s + t.work, 0) }));
  for (const p of squarify(byProject, area)) {
    const pr = inset(p.r, 5);
    out.projects.push({ name: p.item, work: byProject.find((x) => x.item === p.item)?.v ?? 0, r: pr });
    const inner: Box = { x: pr.x + 8, y: pr.y + PROJECT_HEAD, w: pr.w - 16, h: pr.h - PROJECT_HEAD - 8 };
    for (const w of squarify(kept.filter((t) => t.project === p.item).map((t) => ({ item: t, v: t.work })), inner)) {
      const wr = inset(w.r, 4);
      out.trees.push({ tree: w.item, r: wr });
      const body: Box = { x: wr.x + 6, y: wr.y + TREE_HEAD, w: wr.w - 12, h: wr.h - TREE_HEAD - 6 };
      for (const f of squarify(w.item.files.map((file) => ({ item: file, v: file.work })), body)) {
        out.tiles.set(fileId(f.item.worktree, f.item.key), { file: f.item, r: inset(f.r, 3) });
      }
    }
  }
  return out;
}

const inset = (b: Box, g: number): Box => ({ x: b.x + g, y: b.y + g, w: Math.max(0, b.w - 2 * g), h: Math.max(0, b.h - 2 * g) });

/** Squarified treemap, as the Review window lays out its Atlas. */
export function squarify<T>(items: { v: number; item: T }[], r: Box): { item: T; r: Box }[] {
  const out: { item: T; r: Box }[] = [];
  let { x, y, w, h } = r;
  const total = items.reduce((sum, it) => sum + it.v, 0);
  if (!total || w <= 0 || h <= 0) return items.map((it) => ({ item: it.item, r: { x, y, w: 0, h: 0 } }));
  const scale = (w * h) / total;
  let rest = [...items].sort((a, b) => b.v - a.v).map((it) => ({ item: it.item, a: it.v * scale }));
  while (rest.length) {
    const side = Math.min(w, h);
    const row: typeof rest = [];
    let worst = Number.POSITIVE_INFINITY, sum = 0, max = 0, min = Number.POSITIVE_INFINITY;
    for (const it of rest) {
      const s2 = sum + it.a, max2 = Math.max(max, it.a), min2 = Math.min(min, it.a);
      const ratio = Math.max((side * side * max2) / (s2 * s2), (s2 * s2) / (side * side * min2));
      if (row.length && ratio > worst) break;
      row.push(it); worst = ratio; sum = s2; max = max2; min = min2;
    }
    const thick = sum / side;
    let off = 0;
    for (const it of row) {
      const len = it.a / thick;
      out.push({ item: it.item, r: w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick } });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}

/** How lit a file is: 1 while an agent is on it, fading to nothing over half an hour after its last touch. */
export function litness(last: number, now: number, on: boolean): number {
  if (on) return 1;
  if (!last) return 0;
  return Math.max(0, 1 - (now - last) / (30 * 60_000));
}
