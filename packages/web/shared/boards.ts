/**
 * Boards: the artifacts of a scope (a project, a work item, an agent) on one
 * spatial surface, with a layer per participant.
 *
 * Two things make a board:
 *
 *  - Automatic frames. A projection of records the runtime already keeps:
 *    flights, work items, messages and the files work touched. They are
 *    computed on every read and never stored, so a board is never empty and
 *    never stale, and its log grows only with what people do on the board.
 *  - The board's own events. Only deliberate acts: placing a frame, promoting
 *    it to Shared, writing a note. Each event has a per-board sequence number
 *    assigned by the server, and the board is the fold of its events.
 *
 * A promotion is a copy bound to the revision the frame had then. When the
 * live frame moves on, the copy is marked as changed, never silently updated.
 *
 * Pure module: safe on the client, the server and in tests.
 */

// ── Scope and identity ──────────────────────────────────────────────────

/** Maximum persisted events returned by one catch-up page. */
export const BOARD_EVENTS_PAGE_SIZE = 5000;

export type BoardScopeKind = "project" | "work" | "agent";

export type BoardScope = { kind: BoardScopeKind; id: string };

const SCOPE_KINDS: readonly BoardScopeKind[] = ["project", "work", "agent"];
const MAX_SCOPE_ID = 400;

/** `project:<root>`, `work:<id>`, `agent:<id>`. */
export function boardIdFor(scope: BoardScope): string {
  return `${scope.kind}:${scope.id}`;
}

export function parseBoardId(value: unknown): BoardScope | null {
  if (typeof value !== "string") return null;
  const colon = value.indexOf(":");
  if (colon <= 0) return null;
  const kind = value.slice(0, colon) as BoardScopeKind;
  const id = value.slice(colon + 1);
  if (!SCOPE_KINDS.includes(kind)) return null;
  if (!id || id.length > MAX_SCOPE_ID || /[\u0000-\u001f\u007f]/.test(id) || id !== id.trim()) return null;
  return { kind, id };
}

// ── Frames ──────────────────────────────────────────────────────────────

export type BoardFrameKind = "work" | "flight" | "message" | "material" | "note";

/** The operator's layer. Notes and anything the operator authored land here. */
export const OPERATOR_LAYER = "operator";
/** Agreed work. Only the operator moves frames here. */
export const SHARED_LAYER = "shared";
/** Records with no known actor. */
export const UNKNOWN_LAYER = "unattributed";

export type BoardFrameRef = {
  workId?: string;
  flightId?: string;
  messageId?: string;
  conversationId?: string;
  agentId?: string;
  path?: string;
};

/** One artifact on a board: projected from a record, or a note. */
export type BoardFrame = {
  /** Stable across reads: `flight:<id>`, `work:<id>`, `note:<id>`… */
  key: string;
  kind: BoardFrameKind;
  /** Whose work this is: an actor id, or one of the reserved layers. */
  layer: string;
  title: string;
  summary: string | null;
  /** Last meaningful change, ms. */
  at: number;
  state: string | null;
  ref: BoardFrameRef;
  /**
   * What a promotion binds to. Changes when the source changes in a way
   * the reader should see (state, last activity); notes use the board
   * sequence of their last edit.
   */
  revision: string;
};

export function revisionOf(state: string | null, at: number): string {
  return `${state ?? "-"}@${at}`;
}

// ── Events ──────────────────────────────────────────────────────────────

/** What the copy on Shared shows: the frame as it was when promoted. */
export type PromotedCopy = {
  kind: BoardFrameKind;
  layer: string;
  title: string;
  summary: string | null;
  at: number;
  state: string | null;
  ref: BoardFrameRef;
  revision: string;
};

export type BoardEventInput =
  | { kind: "place"; frameKey: string; x: number; y: number }
  | { kind: "unplace"; frameKey: string }
  | { kind: "promote"; frameKey: string; copy: PromotedCopy }
  | { kind: "unpromote"; frameKey: string }
  | { kind: "note.write"; frameKey: string; body: string; x?: number; y?: number }
  | { kind: "note.remove"; frameKey: string };

export type BoardEvent = BoardEventInput & {
  boardId: string;
  seq: number;
  at: number;
  actorId: string;
};

export const MAX_NOTE = 8000;
const MAX_KEY = 600;
const MAX_TEXT = 600;
const MAX_COORD = 10_000_000;

function coord(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_COORD ? Math.round(n) : null;
}

/** A millisecond timestamp, or 0 for "no time known". */
function timestamp(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 8.64e15 ? n : null;
}

function text(v: unknown, max = MAX_TEXT): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}

function isFrameKey(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_KEY && !/[\u0000-\u001f]/.test(v);
}

export function sharedKey(frameKey: string): string {
  return `shared:${frameKey}`;
}

export function isSharedKey(frameKey: string): boolean {
  return frameKey.startsWith("shared:");
}

const FRAME_KINDS: readonly BoardFrameKind[] = ["work", "flight", "message", "material", "note"];

function sanitizeRef(input: unknown): BoardFrameRef {
  const ref: BoardFrameRef = {};
  if (!input || typeof input !== "object") return ref;
  const r = input as Record<string, unknown>;
  for (const k of ["workId", "flightId", "messageId", "conversationId", "agentId", "path"] as const) {
    const v = text(r[k], MAX_KEY);
    if (v) ref[k] = v;
  }
  return ref;
}

function sanitizeCopy(input: unknown): PromotedCopy | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const kind = c.kind as BoardFrameKind;
  const title = text(c.title);
  const revision = text(c.revision, 200);
  const at = timestamp(c.at);
  if (!FRAME_KINDS.includes(kind) || !title || !revision || at === null) return null;
  return {
    kind,
    layer: text(c.layer, MAX_KEY) || UNKNOWN_LAYER,
    title,
    summary: kind === "note" ? text(c.summary, MAX_NOTE) : text(c.summary),
    at,
    state: text(c.state, 80),
    ref: sanitizeRef(c.ref),
    revision,
  };
}

/** One event from untrusted input, or null. The server assigns seq, time and actor. */
export function sanitizeEventInput(input: unknown): BoardEventInput | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  if (!isFrameKey(e.frameKey)) return null;
  const frameKey = e.frameKey;
  switch (e.kind) {
    case "place": {
      const x = coord(e.x);
      const y = coord(e.y);
      return x === null || y === null ? null : { kind: "place", frameKey, x, y };
    }
    case "unplace":
      return { kind: "unplace", frameKey };
    case "promote": {
      if (isSharedKey(frameKey)) return null;
      const copy = sanitizeCopy(e.copy);
      return copy ? { kind: "promote", frameKey, copy } : null;
    }
    case "unpromote":
      return isSharedKey(frameKey) ? null : { kind: "unpromote", frameKey };
    case "note.write": {
      if (!frameKey.startsWith("note:")) return null;
      const body = text(e.body, MAX_NOTE);
      if (body === null || !body.trim()) return null;
      const x = coord(e.x);
      const y = coord(e.y);
      return x === null || y === null
        ? { kind: "note.write", frameKey, body }
        : { kind: "note.write", frameKey, body, x, y };
    }
    case "note.remove":
      return frameKey.startsWith("note:") ? { kind: "note.remove", frameKey } : null;
    default:
      return null;
  }
}

// ── Fold ────────────────────────────────────────────────────────────────

export type BoardNote = { key: string; body: string; actorId: string; createdAt: number; editedAt: number; version: number };

export type BoardState = {
  /** The last sequence folded in. */
  seq: number;
  placed: Map<string, { x: number; y: number }>;
  promoted: Map<string, { copy: PromotedCopy; seq: number; at: number; actorId: string }>;
  notes: Map<string, BoardNote>;
};

export function emptyBoardState(): BoardState {
  return { seq: 0, placed: new Map(), promoted: new Map(), notes: new Map() };
}

/**
 * Applies events in sequence order onto a state. Events at or below the
 * state's sequence are skipped, so a client can fold the same tail twice.
 */
export function foldBoard(events: readonly BoardEvent[], from: BoardState = emptyBoardState()): BoardState {
  const state: BoardState = {
    seq: from.seq,
    placed: new Map(from.placed),
    promoted: new Map(from.promoted),
    notes: new Map(from.notes),
  };
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    if (event.seq <= state.seq) continue;
    state.seq = event.seq;
    switch (event.kind) {
      case "place":
        state.placed.set(event.frameKey, { x: event.x, y: event.y });
        break;
      case "unplace":
        state.placed.delete(event.frameKey);
        break;
      case "promote":
        state.promoted.set(event.frameKey, { copy: event.copy, seq: event.seq, at: event.at, actorId: event.actorId });
        break;
      case "unpromote":
        state.promoted.delete(event.frameKey);
        state.placed.delete(sharedKey(event.frameKey));
        break;
      case "note.write": {
        const prev = state.notes.get(event.frameKey);
        state.notes.set(event.frameKey, {
          key: event.frameKey,
          body: event.body,
          actorId: prev?.actorId ?? event.actorId,
          createdAt: prev?.createdAt ?? event.at,
          editedAt: event.at,
          version: event.seq,
        });
        if (event.x !== undefined && event.y !== undefined) state.placed.set(event.frameKey, { x: event.x, y: event.y });
        break;
      }
      case "note.remove":
        state.notes.delete(event.frameKey);
        state.placed.delete(event.frameKey);
        break;
    }
  }
  return state;
}

/** Notes as frames, in the layer of whoever wrote them. */
export function noteFrames(state: BoardState): BoardFrame[] {
  return [...state.notes.values()].map((note) => ({
    key: note.key,
    kind: "note" as const,
    layer: note.actorId,
    title: firstLine(note.body),
    summary: note.body,
    at: note.editedAt,
    state: null,
    ref: {},
    revision: `note@${note.version}`,
  }));
}

function firstLine(body: string): string {
  const line = body.trim().split("\n")[0]?.replace(/^#+\s*/, "").trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "Note";
}

/** A Shared frame: the promoted copy, plus whether its source has moved on. */
export type SharedFrame = BoardFrame & {
  sourceKey: string;
  /** The layer the frame was promoted from. */
  sourceLayer: string;
  /** The live frame's revision differs from the one promoted. */
  changed: boolean;
  /** The source is no longer in this board's projection. */
  missing: boolean;
};

export function sharedFrames(state: BoardState, live: readonly BoardFrame[]): SharedFrame[] {
  const byKey = new Map(live.map((f) => [f.key, f]));
  return [...state.promoted.entries()]
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([sourceKey, { copy }]) => {
      const current = byKey.get(sourceKey);
      return {
        ...copy,
        key: sharedKey(sourceKey),
        layer: SHARED_LAYER,
        sourceKey,
        sourceLayer: copy.layer,
        changed: !!current && current.revision !== copy.revision,
        missing: !current,
      };
    });
}

export function copyOf(frame: BoardFrame): PromotedCopy {
  return {
    kind: frame.kind,
    layer: frame.layer,
    title: frame.title,
    summary: frame.summary,
    at: frame.at,
    state: frame.state,
    ref: frame.ref,
    revision: frame.revision,
  };
}

// ── Layout ──────────────────────────────────────────────────────────────

export const CARD_W = 360;
export const CARD_H = 200;
export const CARD_GAP = 32;
/** Room above a lane's first row for its label. */
export const LANE_HEAD = 72;
export const LANE_GAP = 120;
/** Unplaced frames wrap after this many columns. */
export const LANE_COLS = 8;

export type Rect = { x: number; y: number; width: number; height: number };

export type LaidFrame<F extends BoardFrame = BoardFrame> = Rect & { frame: F; placed: boolean };

export type LaidLane = Rect & { layer: string; count: number };

export type BoardLayout<F extends BoardFrame = BoardFrame> = { frames: LaidFrame<F>[]; lanes: LaidLane[] };

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Lane order: Shared, the operator, then every other layer by its newest
 * frame. Pass `layerOrder` to pin an order the viewer chose.
 */
export function orderLayers(frames: readonly BoardFrame[], layerOrder: readonly string[] = []): string[] {
  const newest = new Map<string, number>();
  for (const f of frames) newest.set(f.layer, Math.max(newest.get(f.layer) ?? 0, f.at));
  const rank = (layer: string) => {
    const pinned = layerOrder.indexOf(layer);
    if (pinned >= 0) return pinned - 1_000;
    if (layer === SHARED_LAYER) return -3;
    if (layer === OPERATOR_LAYER) return -2;
    return 0;
  };
  return [...newest.keys()].sort(
    (a, b) => rank(a) - rank(b) || (newest.get(b) ?? 0) - (newest.get(a) ?? 0) || a.localeCompare(b),
  );
}

/**
 * Placed frames where the board puts them. Every other frame sits in its
 * layer's lane to the right of the placed ones, newest first, one lane per
 * layer stacked top to bottom.
 */
export function layoutBoard<F extends BoardFrame>(
  frames: readonly F[],
  placed: ReadonlyMap<string, { x: number; y: number }>,
  layerOrder: readonly string[] = [],
): BoardLayout<F> {
  const out: LaidFrame<F>[] = [];
  const loose: F[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    if (seen.has(frame.key)) continue;
    seen.add(frame.key);
    const at = placed.get(frame.key);
    if (at) out.push({ frame, x: at.x, y: at.y, width: CARD_W, height: CARD_H, placed: true });
    else loose.push(frame);
  }

  const placedBounds = boundsOf(out);
  const originX = placedBounds ? placedBounds.x + placedBounds.width + LANE_GAP * 2 : 0;
  let cursorY = placedBounds ? placedBounds.y : 0;
  const lanes: LaidLane[] = [];
  const pitchW = CARD_W + CARD_GAP;
  const pitchH = CARD_H + CARD_GAP;

  for (const layer of orderLayers(loose, layerOrder)) {
    const members = loose.filter((f) => f.layer === layer).sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
    const cols = Math.min(LANE_COLS, members.length);
    const rows = Math.ceil(members.length / cols);
    const width = cols * pitchW - CARD_GAP;
    const height = LANE_HEAD + rows * pitchH - CARD_GAP;
    lanes.push({ layer, count: members.length, x: originX, y: cursorY, width, height });
    members.forEach((frame, i) => {
      out.push({
        frame,
        x: originX + (i % cols) * pitchW,
        y: cursorY + LANE_HEAD + Math.floor(i / cols) * pitchH,
        width: CARD_W,
        height: CARD_H,
        placed: false,
      });
    });
    cursorY += height + LANE_GAP;
  }

  return { frames: out, lanes };
}

/** Where a new note goes: below everything placed, or at the origin. */
export function spotForNew(layout: BoardLayout): { x: number; y: number } {
  const placedBounds = boundsOf(layout.frames.filter((f) => f.placed));
  if (!placedBounds) {
    const all = boundsOf(layout.frames);
    return all ? { x: all.x - CARD_W - LANE_GAP * 2, y: all.y } : { x: 0, y: 0 };
  }
  return { x: placedBounds.x, y: placedBounds.y + placedBounds.height + CARD_GAP };
}
