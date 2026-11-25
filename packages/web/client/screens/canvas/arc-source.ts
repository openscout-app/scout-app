/*
 * Canvas › Arc diagrams: the source of an `*.arc.json` item, read again while it is on screen, so the canvas follows
 * an agent editing it. The card and the open lightbox share one reading per item. A save that is not valid yet (a
 * write in progress, a typo, a diagram Arc refuses) keeps the last valid diagram and says why in one line.
 *
 * Data: GET /api/ops/canvas-file?p=<path>&as=arc (routes/world.ts), conditional on the version last read. Validation
 * is Arc's own `validateDiagram`, loaded with the renderer's chunk, so none of Arc is in the main bundle.
 */
import { useEffect, useState } from "react";

/** Arc's diagnostics, as far as the canvas reads them. */
export type ArcDiagnostic = { severity: "error" | "warning"; message: string };
export type ArcValidate = (value: unknown) => ArcDiagnostic[];

export type ArcRead = { ok: true; data: unknown } | { ok: false; reason: string };

export type ArcState = {
  /** the last valid diagram; null until one has been read */
  data: unknown | null;
  /** the version of `data`: a new one is drawn over the last, marked against it */
  version: string | null;
  /** the valid diagram before `data`, which the marks compare against; null for the first one read */
  prev: unknown | null;
  /** when `data` was saved (its file's saved time, or when it was shown), in ms; null until one has been read */
  changedAt: number | null;
  /** the version last read, valid or not: the next read asks whether it changed */
  seen: string | null;
  /** why the newest read is not drawn, in one line; null when it is */
  problem: string | null;
};

export const ARC_EMPTY: ArcState = { data: null, version: null, prev: null, changedAt: null, seen: null, problem: null };

/** How often an Arc card reads its source again; an open lightbox reads faster. */
export const ARC_CARD_MS = 4000;
export const ARC_OPEN_MS = 1000;

const oneLine = (s: string, max = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A source read as a diagram: parsed, then checked by Arc. Warnings draw; an error does not. */
export function readArc(text: string, validate: ArcValidate): ArcRead {
  let value: unknown;
  try { value = JSON.parse(text); } catch (e) {
    return { ok: false, reason: text.trim() ? `Not valid JSON yet: ${oneLine(e instanceof Error ? e.message : String(e), 100)}` : "The file is empty." };
  }
  let diagnostics: ArcDiagnostic[];
  try { diagnostics = validate(value); } catch (e) {
    return { ok: false, reason: `Arc could not read it: ${oneLine(e instanceof Error ? e.message : String(e), 100)}` };
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length) return { ok: false, reason: `Arc refused it: ${oneLine(errors[0].message, 100)}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}` };
  return { ok: true, data: value };
}

/**
 * The state after reading `version`, saved at `mt`: a valid read replaces the diagram and keeps the one it replaces,
 * so the view can mark what changed; an invalid one keeps the last valid diagram and says why.
 */
export function nextArc(prev: ArcState, version: string, text: string, validate: ArcValidate, mt: number | null = null): ArcState {
  const r = readArc(text, validate);
  if (!r.ok) return { ...prev, seen: version, problem: r.reason };
  return { data: r.data, version, prev: prev.data, changedAt: mt, seen: version, problem: null };
}

/* ── the shared reading ───────────────────────────────────────────────────── */

type Entry = {
  path: string;
  /** false: the version this path names, read once (a past window), never the newest */
  follow: boolean;
  state: ArcState;
  /** each following subscriber's wanted interval */
  wants: Map<symbol, number>;
  listeners: Set<(s: ArcState) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  /** when its last subscriber left; null while one is mounted */
  idleAt: number | null;
};
const entries = new Map<string, Entry>();
/** readings no view holds, kept so a card and its details reopen on the diagram they had; the oldest go first */
const IDLE_KEPT = 24;

let validator: Promise<ArcValidate> | null = null;
/** Arc's validator, from the renderer's own chunk. A failed load is tried again on the next read, not kept. */
export const loadArcValidate = () => (validator ??= import("@hudsonkit/arc").then(
  (m) => m.validateDiagram as unknown as ArcValidate,
  (err: unknown) => { validator = null; throw err; },
));

const arcUrl = (p: string, follow: boolean) => `/api/ops/canvas-file?p=${encodeURIComponent(p)}&as=arc${follow ? "" : "&follow=0"}`;

function publish(e: Entry, state: ArcState) {
  e.state = state;
  for (const l of e.listeners) l(state);
}

async function read(key: string, e: Entry) {
  if (e.reading) return;
  e.reading = true;
  try {
    const validate = await loadArcValidate();
    const res = await fetch(arcUrl(e.path, e.follow), { credentials: "include", cache: "no-store", headers: e.state.seen ? { "if-none-match": e.state.seen } : {} });
    if (entries.get(key) !== e) return;
    if (res.status === 304) return;
    if (!res.ok) {
      await res.body?.cancel();
      if (e.state.problem !== UNREADABLE) publish(e, { ...e.state, problem: UNREADABLE });
      return;
    }
    const version = res.headers.get("etag") ?? String(Date.now());
    const mt = Number(res.headers.get("x-mtime"));
    const text = await res.text();
    publish(e, nextArc(e.state, version, text, validate, Number.isFinite(mt) && mt > 0 ? mt : null));
  } catch {
    if (entries.get(key) === e && e.state.problem !== UNREACHED) publish(e, { ...e.state, problem: UNREACHED });
  } finally {
    e.reading = false;
  }
}
const UNREADABLE = "The diagram can't be read from here now.";
const UNREACHED = "Scout could not be reached to read the diagram.";

function schedule(key: string, e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  if (!e.wants.size) return;
  const ms = Math.min(...e.wants.values());
  e.timer = setTimeout(() => {
    e.timer = null;
    const go = typeof document === "undefined" || !document.hidden ? read(key, e) : Promise.resolve();
    void go.finally(() => { if (entries.get(key) === e) schedule(key, e); });
  }, ms);
}

/** Drops the readings no view has held for longest, past IDLE_KEPT. */
function prune() {
  const idle = [...entries].filter(([, e]) => e.idleAt !== null).sort((a, b) => a[1].idleAt! - b[1].idleAt!);
  for (const [key, e] of idle.slice(0, Math.max(0, idle.length - IDLE_KEPT))) {
    if (e.timer) clearTimeout(e.timer);
    entries.delete(key);
  }
}

/**
 * Follows one item's diagram while mounted: `key` is the item's board key (stable across shown versions), `path` the
 * file to read, `ms` how often. Subscribers of one key share a reading at the fastest interval any of them asks for.
 * With `follow` false (a past window) the path's own version is read once, apart from the live reading, and not
 * again: a shown item stays the version that window listed, and a file is read as it is now.
 */
export function useArcSource(key: string, path: string, ms: number, on = true, follow = true): ArcState {
  const id = follow ? key : `${key}\0${path}`;
  const [state, setState] = useState<ArcState>(() => entries.get(id)?.state ?? ARC_EMPTY);
  useEffect(() => {
    if (!on || !key || !path) return;
    let e = entries.get(id);
    if (!e) {
      e = { path, follow, state: ARC_EMPTY, wants: new Map(), listeners: new Set(), timer: null, reading: false, idleAt: null };
      entries.set(id, e);
    }
    // a shown item's newer version is a new path; its last valid diagram stays up until the new one reads
    const moved = e.path !== path;
    e.path = path;
    e.idleAt = null;
    const me = Symbol(id), entry = e;
    if (follow) entry.wants.set(me, ms);
    entry.listeners.add(setState);
    setState(entry.state);
    if (moved || !entry.state.seen || (follow && ms < ARC_CARD_MS)) void read(id, entry);
    schedule(id, entry);
    return () => {
      entry.wants.delete(me);
      entry.listeners.delete(setState);
      schedule(id, entry);
      if (!entry.listeners.size) { entry.idleAt = Date.now(); prune(); }
    };
  }, [id, key, path, ms, on, follow]);
  return state;
}

/* ── the view the operator is on ──────────────────────────────────────────── */

/*
 * The chapter (Arc view) the operator is on, per item, for this page: the embed in the flow, full screen and the
 * details view all draw the same item on the same chapter, so moving between them, or a new version, never loses it.
 */
const chapters = new Map<string, string | null>();
const chapterListeners = new Map<string, Set<(v: string | null) => void>>();

export function setArcChapter(key: string, view: string | null) {
  if (!key || chapters.get(key) === view) return;
  chapters.set(key, view);
  for (const l of chapterListeners.get(key) ?? []) l(view);
}

/** The chapter the operator is on for one item, and how to change it; null explores freely. */
export function useArcChapter(key: string): [string | null, (view: string | null) => void] {
  const [view, setView] = useState<string | null>(() => chapters.get(key) ?? null);
  useEffect(() => {
    if (!key) return;
    let set = chapterListeners.get(key);
    if (!set) chapterListeners.set(key, (set = new Set()));
    const l = set;
    l.add(setView);
    setView(chapters.get(key) ?? null);
    return () => { l.delete(setView); if (!l.size) chapterListeners.delete(key); };
  }, [key]);
  return [view, (v) => setArcChapter(key, v)];
}
