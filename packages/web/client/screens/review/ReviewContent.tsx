/*
 * Review: one window for reviewing what the agents did. The banner sets what the window shows, the Atlas leads,
 * Tracks under it is the way in, and the rail on the right reads the window by time. A file has its current state;
 * its only past versions are its commits. Data: GET /api/ops/review (server/review-window.ts), read-only.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useOptionalFlag } from "hudsonkit/flags";
import { api } from "../../lib/api.ts";
import { useContextMenu } from "../../components/ContextMenu.tsx";
import type { ReviewFileHead } from "../../../shared/review-window.ts";
import { REVIEW_HEAD_LINES } from "../../../shared/review-window.ts";
import { shellProject, scopedArt, ALL, artInSpan, beatIn, bsearch, buildModel, clock, commitIn, dur, fmtC, scopeName, SURFACE_AT, type Art, type Beat, type Change, type Commit, type Data, type Model, type Scope } from "./model.ts";
import { buildAtlas, createAtlas, type ANode, type Atlas, type Show } from "./atlas.ts";
import { createTracks, type Hi, type TrackHit, type Tracks } from "./tracks.ts";
import { menuItems, pickKeyOf, picksMenuItems, type AskOf, type MenuActs, type MenuOf } from "./menu.ts";
import { modsOf, NONE, pickClick, plain, type Mods, type Picks } from "./pick.ts";
import { diffOrder, hunksOf, openTab, Pane, type Tab } from "./pane.tsx";
import { readPalette, type Pal } from "./paint.ts";
import s from "./review.module.css";

const DAYS = 2;
/** data older than this reloads when the tab comes back, unless something is open */
const STALE_MS = 5 * 60_000;
/** the rail's width until it is dragged, and the narrowest it goes */
const RAIL_W = 392, RAIL_MIN = 280;
/** one press of + or −: half again, or two thirds */
const ZOOM_STEP = 1.5;
const fileUrl = (p: string, as: "head" | "raw") => `/api/ops/review-file?p=${encodeURIComponent(p)}&as=${as}`;
const WINS = [{ v: 1800, l: "30m", say: "30 minutes" }, { v: 14400, l: "4h", say: "4 hours" }, { v: 86400, l: "24h", say: "24 hours" }, { v: 172800, l: "48h", say: "48 hours" }];
const SHOWS: { v: Show; l: string }[] = [{ v: "changes", l: "Changes" }, { v: "images", l: "Images" }, { v: "docs", l: "Docs" }, { v: "everything", l: "Everything" }];

type Sel =
  | { type: "art"; key: string; v?: string; back?: Sel }
  | { type: "commit"; id: string; back?: Sel }
  | { type: "fold"; w: number; keys: string[]; back?: Sel }
  | { type: "beat"; id: string }
  | { type: "wt"; w: number; what?: string }
  | { type: "session"; s: number; w?: number }
  | { type: "project"; p: string }
  | null;
/** paneW: the code pane's width in px once dragged; railW: the rail's, once dragged; wide: the pane lies over the Atlas and Tracks */
type Prefs = { win: number; project: string; show: Show; surfaced: boolean; paneW: number | null; railW: number | null; wide: boolean };
type Item = { kind: "commit"; t: number; c: Commit; I: number; key: boolean } | { kind: "beat"; t: number; b: Beat; key: boolean };
type Band = { a: number; b: number; items: Item[]; quiet: number; commits: number; beats: number };
type Target = { s: number; wt: number; path?: string | null; scope: string };
type Sent = { state: "sending" | "sent" | "failed"; note: string } | null;

const PREFS_KEY = "scout.review:prefs";
function loadPrefs(): Prefs {
  const d: Prefs = { win: 14400, project: "all", show: "changes", surfaced: true, paneW: null, railW: null, wide: false };
  try { const raw = localStorage.getItem(PREFS_KEY); if (raw) return { ...d, ...JSON.parse(raw) }; } catch { /* storage can be off */ }
  return d;
}
const esc = (x: string) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const shq = (x: string) => "'" + x.replace(/'/g, "'\\''") + "'";
const plural = (n: number, w: string) => `${fmtC(n)} ${w}${n === 1 ? "" : "s"}`;
const isSheet = (x: Sel): x is Extract<NonNullable<Sel>, { type: "art" | "commit" | "fold" }> => !!x && (x.type === "art" || x.type === "commit" || x.type === "fold");
// a tool call that exits non-zero is routine for an agent; a failed or still-open task is not
const hotBeat = (b: Beat) => b.failed > 0 || b.openTask;
/* a selection as a pick key (pick.ts), and back */
const keyOfSel = (x: Sel): string | null =>
  !x ? null : x.type === "art" ? "a:" + x.key : x.type === "commit" ? "c:" + x.id : x.type === "beat" ? "b:" + x.id
    : x.type === "wt" ? (x.what ? null : "w:" + x.w) : x.type === "session" ? "s:" + x.s : x.type === "project" ? "p:" + x.p : null;
function selOfKey(k: string): Sel {
  const v = k.slice(2);
  switch (k[0]) {
    case "a": return { type: "art", key: v };
    case "c": return { type: "commit", id: v };
    case "b": return { type: "beat", id: v };
    case "w": return { type: "wt", w: Number(v) };
    case "s": return { type: "session", s: Number(v) };
    case "p": return { type: "project", p: v };
  }
  return null;
}
const itemKey = (x: Item) => (x.kind === "beat" ? "b:" + x.b.id : "c:" + x.c.id);

export function ReviewContent() {
  const enabled = useOptionalFlag("surface.review", false);
  return enabled ? <EnabledReviewContent /> : null;
}

function EnabledReviewContent() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const at = useRef(0);
  const load = useCallback(() => {
    setLoading(true);
    api<Data>(`/api/ops/review?days=${DAYS}`, { cache: "no-store" })
      .then((d) => { at.current = Date.now(); setData(d); setErr(null); }, (e: Error) => setErr(e.message || "could not load"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const m = useMemo(() => (data ? buildModel(data) : null), [data]);
  return (
    <div className={s.page}>
      {m ? (
        <Window key={m.D.now} m={m} loading={loading} reload={load} stale={() => Date.now() - at.current > STALE_MS} />
      ) : (
        <div className={s.empty}>{err ? <>Could not load the review: {err}</> : <>Loading the review…</>}</div>
      )}
    </div>
  );
}

function Window({ m, loading, reload, stale }: { m: Model; loading: boolean; reload: () => void; stale: () => boolean }) {
  const ck = useMemo(() => clock(m), [m]);
  const [prefs, setPrefsRaw] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) => setPrefsRaw((o) => { const n = { ...o, ...p }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch { /* storage can be off */ } return n; });
  const [end, setEnd] = useState(m.END);
  const [span, setSpan] = useState<[number, number] | null>(null);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Sel>(null);
  const [crumb, setCrumb] = useState<ANode[]>([]);
  const [openBands, setOpenBands] = useState<Set<number>>(new Set());
  const [tracksInfo, setTracksInfo] = useState("");
  const [focusReq, setFocusReq] = useState<{ keys?: string[]; key?: string; n: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<Sent>(null);
  // a worktree or a session the whole window is narrowed to; a project is the PROJECT filter
  const [focus, setFocus] = useState<Scope | null>(null);
  const [askReq, setAskReq] = useState(0);
  // several things picked with Cmd or Shift; one pick is just the selection
  const [picks, setPicks] = useState<Picks>(NONE);
  // the code pane: its tabs and the one shown
  const [pane, setPane] = useState<{ tabs: Tab[]; at: number }>({ tabs: [], at: 0 });
  const [dragW, setDragW] = useState<number | null>(null), [dragRail, setDragRail] = useState<number | null>(null);

  const win = prefs.win, project = prefs.project;
  const scope = useMemo<Scope>(() => focus ?? (project === "all" ? ALL : { kind: "project", p: project }), [focus, project]);
  const scopeLabel = scopeName(m, scope);
  const t0w = Math.max(0, end - win), t1w = end;
  const A = span ? span[0] : t0w, B = span ? span[1] : t1w;
  const fly = (x: { keys?: string[]; key?: string }) => setFocusReq((o) => ({ ...x, n: (o?.n ?? 0) + 1 }));
  const wtKeys = (w: number) => ["p:" + (w >= 0 ? m.WT[w].p : "(no folder)"), "w:" + w];

  const projects = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of m.C) { const p = m.projOf(c); n.set(p, (n.get(p) || 0) + 1); }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [m]);
  const tree = useMemo(() => buildAtlas(m, { A, B, scope, show: prefs.show, surfaced: prefs.surfaced, search }), [m, A, B, scope, prefs.show, prefs.surfaced, search]);
  const spans = useMemo(() => artInSpan(m, A, B, scope), [m, A, B, scope]);

  /* ── the rail: the window by time ── */
  const bands = useMemo<Band[]>(() => {
    const kindOk = (keys: string[]) => prefs.show === "changes" || prefs.show === "everything" || keys.some((k) => m.ART.get(k)?.kind === (prefs.show === "images" ? "image" : "doc"));
    const items: Item[] = [];
    for (const c of m.COMMITS) {
      if (c.t < t0w || c.t > t1w || !commitIn(m, scope, c)) continue;
      if (!kindOk(c.changes.map((x) => x.key))) continue;
      const I = c.changes.reduce((v, x) => Math.max(v, x.I), 0);
      items.push({ kind: "commit", t: c.t, c, I, key: I >= SURFACE_AT });
    }
    for (const b of m.BEATS) {
      if (b.t1 < t0w || b.t0 > t1w || !beatIn(m, scope, b)) continue;
      if (prefs.show === "changes" && !b.e && !hotBeat(b)) continue;
      if ((prefs.show === "images" || prefs.show === "docs") && !kindOk(b.arts.map((x) => x.key))) continue;
      const narrowed = prefs.show === "images" || prefs.show === "docs";
      items.push({ kind: "beat", t: b.t0, b, key: narrowed || hotBeat(b) || (b.opener?.kind === "turn" && b.e > 0) || b.e >= 6 || b.add + b.del >= 150 });
    }
    items.sort((x, y) => y.t - x.t);
    const cuts = [t0w, ...ck.ticks(t0w, t1w).filter((t) => t > t0w && t < t1w), t1w];
    const out: Band[] = [];
    for (let k = cuts.length - 1; k > 0; k--) {
      const a = cuts[k - 1], b = cuts[k];
      const its = items.filter((x) => Math.max(t0w, Math.min(t1w, x.t)) >= a && (Math.max(t0w, Math.min(t1w, x.t)) < b || (b === t1w && x.t >= b)));
      if (!its.length) continue;
      out.push({ a, b, items: its, quiet: its.filter((x) => !x.key).length, commits: its.filter((x) => x.kind === "commit").length, beats: its.filter((x) => x.kind === "beat").length });
    }
    return out;
  }, [m, ck, t0w, t1w, scope, prefs.show]);
  const visibleItems = useMemo(() => bands.flatMap((b) => b.items.filter((x) => !prefs.surfaced || x.key || openBands.has(b.a))), [bands, prefs.surfaced, openBands]);
  useEffect(() => { setSpan(null); setOpenBands(new Set()); }, [end, win]);
  // a new filter starts the rail from the newest band
  useEffect(() => { railTop.current = 0; if (list$.current && !isSheet(sel)) list$.current.scrollTop = 0; }, [end, win, scope, prefs.show, prefs.surfaced]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── selection helpers ── */
  const beatById = useMemo(() => new Map(m.BEATS.map((b) => [b.id, b])), [m]);
  const commitById = useMemo(() => new Map(m.COMMITS.map((c) => [c.id, c])), [m]);
  const selKeys = useMemo(() => {
    if (sel?.type === "commit") return new Set(commitById.get(sel.id)?.changes.map((x) => x.key));
    if (sel?.type === "beat") return new Set(beatById.get(sel.id)?.arts.map((x) => x.key));
    return null;
  }, [sel, beatById, commitById]);
  const selKey = keyOfSel(sel);
  const picked = useMemo(() => new Set(picks.keys.length > 1 ? picks.keys : []), [picks]);
  // a selection made any other way than picking ends the picks
  useEffect(() => { if (picks.keys.length > 1 && !(selKey && picks.keys.includes(selKey))) setPicks(NONE); }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selOf = (n: ANode): 0 | 1 | 2 => {
    if (picked.has(n.key)) return 2;
    if (!sel) return 0;
    switch (sel.type) {
      case "art": return n.art === sel.key ? 2 : n.kind === "fold" && n.folded?.includes(sel.key) ? 1 : 0;
      case "commit": case "beat": return n.art && selKeys?.has(n.art) ? 1 : n.kind === "fold" && n.folded?.some((k) => selKeys?.has(k)) ? 1 : 0;
      case "fold": return n.key === "f:" + sel.w ? 2 : 0;
      case "wt": return sel.what ? (n.kind === "group" && n.parent?.w === sel.w && n.name === sel.what ? 2 : 0) : n.kind === "wt" && n.w === sel.w ? 2 : 0;
      case "project": return n.kind === "project" && n.name === sel.p ? 2 : 0;
      case "session": return n.kind === "leaf" && n.ses.has(sel.s) ? 1 : 0;
    }
    return 0;
  };
  const hi = (): Hi => {
    const x = hi1();
    return picked.size ? { ...x, picks: picked } : x;
  };
  const hi1 = (): Hi => {
    if (!sel) return {};
    if (sel.type === "art") return { art: sel.key };
    if (sel.type === "commit") return { commit: sel.id };
    if (sel.type === "beat") { const b = beatById.get(sel.id); return b ? { session: b.s, beat: { s: b.s, t0: b.t0, t1: b.t1 } } : {}; }
    if (sel.type === "session") return { session: sel.s };
    if (sel.type === "wt" || sel.type === "fold") return { wt: sel.w };
    return {};
  };
  /** a Cmd or Shift click: add, drop or run from the anchor; the rail shows the last one picked */
  const pickMore = (key: string, mods: Mods, order?: string[]) => {
    const cur: Picks = picks.keys.length > 1 ? picks : { keys: selKey ? [selKey] : [], at: selKey, anchor: selKey };
    const next = pickClick(cur, key, mods, order);
    setPicks(next.keys.length > 1 ? next : NONE);
    setSel(next.at ? selOfKey(next.at) : null);
  };
  const pickBeat = (b: Beat) => {
    setSel({ type: "beat", id: b.id });
    setSpan([Math.max(t0w, b.t0 - 60), Math.min(t1w, Math.max(b.t1 + 60, b.t0 + 180))]);
    if (b.wt >= 0) fly({ keys: wtKeys(b.wt) });
  };
  const pickItem = (x: Item) => (x.kind === "beat" ? pickBeat(x.b) : setSel({ type: "commit", id: x.c.id }));
  const openArt = (key: string, v?: string) => { setSel({ type: "art", key, v, back: sel ?? undefined }); fly({ key: "a:" + key }); };

  /* ── the code pane ── */
  const paneOpen = pane.tabs.length > 0;
  const openSide = (t: Tab) => setPane((p) => openTab(p.tabs, t));
  const sideArt = (key: string, v?: string) => { openArt(key, v); openSide({ type: "art", key, v: v ?? null, pin: true }); };
  const sideCommit = (id: string) => { setSel({ type: "commit", id }); openSide({ type: "commit", id, pin: true }); };
  const openMany = (keys: string[]) => setPane((p) => keys.reduce((acc, k) => openTab(acc.tabs, k.startsWith("a:") ? { type: "art", key: k.slice(2), v: null, pin: true } : { type: "commit", id: k.slice(2), pin: true }), p));
  const closeTab = (i: number) => setPane((p) => { const tabs = p.tabs.filter((_, j) => j !== i); return { tabs, at: Math.max(0, Math.min(tabs.length - 1, i < p.at ? p.at - 1 : p.at)) }; });
  const closePane = () => setPane({ tabs: [], at: 0 });
  // while the pane is open it follows a click on a file or a commit in a preview tab
  useEffect(() => {
    if (!paneOpen || !sel) return;
    if (sel.type === "art") openSide({ type: "art", key: sel.key, v: sel.v ?? null, pin: false });
    else if (sel.type === "commit") openSide({ type: "commit", id: sel.id, pin: false });
  }, [selKey, sel && sel.type === "art" ? sel.v : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const body$ = useRef<HTMLDivElement>(null), rail$ = useRef<HTMLDivElement>(null);
  const onGrip = (e: ReactPointerEvent) => {
    e.preventDefault();
    const body = body$.current, rail = rail$.current; if (!body || !rail) return;
    let w = 0;
    const move = (ev: PointerEvent) => {
      const r = body.getBoundingClientRect(), railW = rail.getBoundingClientRect().width;
      w = Math.round(Math.max(360, Math.min(r.width - railW - 260, r.right - railW - ev.clientX)));
      setDragW(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.style.userSelect = ""; document.body.style.cursor = "";
      if (w) setPrefs({ paneW: w }); setDragW(null);
    };
    document.body.style.userSelect = "none"; document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  // the rail's left edge drags too; it leaves 260px for the Atlas, and 360px more while the pane is open
  const onRailGrip = (e: ReactPointerEvent) => {
    e.preventDefault();
    const body = body$.current; if (!body) return;
    let w = 0;
    const move = (ev: PointerEvent) => {
      const r = body.getBoundingClientRect();
      w = Math.round(Math.max(RAIL_MIN, Math.min(r.width - 260 - (paneOpen ? 360 : 0), r.right - ev.clientX)));
      setDragRail(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.style.userSelect = ""; document.body.style.cursor = "";
      if (w) setPrefs({ railW: w }); setDragRail(null);
    };
    document.body.style.userSelect = "none"; document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const paneW = dragW ?? prefs.paneW, railW = dragRail ?? prefs.railW;
  const bodyStyle = {
    ...(railW ? { "--rail-w": `max(${RAIL_MIN}px, min(${railW}px, calc(100% - 260px)))` } : {}),
    ...(paneOpen && paneW ? { "--pane-w": `max(360px, min(${paneW}px, calc(100% - var(--rail-w, ${RAIL_W}px) - 260px)))` } : {}),
  } as CSSProperties;

  /* ── focus, and the right-click menu ── */
  const focusOn = (sc: Scope) => {
    if (sc.kind === "all" || sc.kind === "project") { setFocus(null); setPrefs({ project: sc.kind === "all" ? "all" : sc.p }); return; }
    setFocus(sc); setPicks(NONE);
    if (sc.kind === "wt") fly({ keys: wtKeys(sc.w) });
  };
  const clearFocus = () => (focus ? setFocus(null) : setPrefs({ project: "all" }));
  const askAbout = (x: AskOf) => {
    if (x.type === "art") openArt(x.key);
    else if (x.type === "beat") { const b = beatById.get(x.id); if (b) pickBeat(b); }
    else setSel(x);
    setAskReq((n) => n + 1);
  };
  const showMenu = useContextMenu();
  const nodeMenu = (n: ANode): MenuOf =>
    n.kind === "root" ? { type: "root" } : n.kind === "project" ? { type: "project", p: n.name } : n.kind === "leaf" ? { type: "art", key: n.art! }
      : { type: "wt", w: n.kind === "wt" ? n.w! : n.parent!.w! };
  const acts: MenuActs = {
    focusOn, clearFocus, openArt: (k) => sideArt(k), openCommit: sideCommit, openBeat: pickBeat, ask: askAbout,
    flyWt: (w) => fly({ keys: wtKeys(w) }), revealWt: (w) => tracks.current?.reveal(w), copy: (t) => { navigator.clipboard?.writeText(t).catch(() => {}); },
    openMany, clearPicks: () => setPicks(NONE),
  };
  const openMenu = (e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, x: MenuOf) => {
    // a right-click on one of several picks acts on all of them; anywhere else, on what it landed on
    const k = pickKeyOf(x);
    const items = k && picked.has(k) ? picksMenuItems(m, scope, picks.keys, acts) : menuItems(m, scope, spans, x, acts);
    if (items.length) showMenu(e, items); else { e.preventDefault(); e.stopPropagation(); }
  };

  /* ── canvases ── */
  const frame = useRef<HTMLDivElement>(null), atlasWrap = useRef<HTMLDivElement>(null), atlasCv = useRef<HTMLCanvasElement>(null);
  const trCv = useRef<HTMLCanvasElement>(null), trAx = useRef<HTMLCanvasElement>(null), trScroll = useRef<HTMLDivElement>(null), tip = useRef<HTMLDivElement>(null);
  const search$ = useRef<HTMLInputElement>(null), ask$ = useRef<HTMLInputElement>(null), list$ = useRef<HTMLDivElement>(null), railTop = useRef(0);
  const pal = useRef<Pal | null>(null), atlas = useRef<Atlas | null>(null), tracks = useRef<Tracks | null>(null);
  // the engines hold these hooks for their lifetime; L carries the current closures
  type Live = {
    selOf: (n: ANode) => 0 | 1 | 2; hi: () => Hi; t1w: number; onAtlas: (n: ANode | null, mods: Mods) => void; onAtlasOpen: (n: ANode) => void;
    onTrack: (w: number, mods: Mods) => void; onLane: (s: number, w: number, mods: Mods) => void; onCommit: (id: string, mods: Mods) => void; onTrackDouble: (h: TrackHit) => boolean;
    onSpan: (s: [number, number] | null) => void; atlasTip: (n: ANode) => string; retrack: () => void; imgOf: (n: ANode) => string | null;
    onAtlasMenu: (n: ANode, e: MouseEvent) => void; onTrackMenu: (h: TrackHit, e: MouseEvent) => void;
  };
  const L = useRef<Live>(null as unknown as Live);
  L.current = {
    selOf, hi, t1w,
    onAtlas: (n, mods) => {
      // files, worktrees and projects can be picked together; the Atlas has no order, so Shift adds
      if (n && !plain(mods) && (n.kind === "leaf" || n.kind === "wt" || n.kind === "project")) return pickMore(n.key, mods);
      setPicks(NONE);
      if (!n) return setSel(null);
      if (n.kind === "leaf") setSel({ type: "art", key: n.art! });
      else if (n.kind === "group") setSel({ type: "wt", w: n.parent!.w!, what: n.name });
      else if (n.kind === "fold") setSel({ type: "fold", w: n.parent!.w!, keys: n.folded! });
      else if (n.kind === "wt") { setSel({ type: "wt", w: n.w! }); tracks.current?.reveal(n.w!); }
      else if (n.kind === "project") setSel({ type: "project", p: n.name });
    },
    onAtlasOpen: (n) => { if (n.art) sideArt(n.art); },
    onTrack: (w, mods) => { if (!plain(mods)) return pickMore("w:" + w, mods, tracks.current?.order()); setPicks(NONE); setSel({ type: "wt", w }); fly({ keys: wtKeys(w) }); },
    onLane: (si, w, mods) => { if (!plain(mods)) return pickMore("s:" + si, mods, tracks.current?.order()); setPicks(NONE); setSel({ type: "session", s: si, w }); },
    onCommit: (id, mods) => { if (!plain(mods)) return pickMore("c:" + id, mods); setPicks(NONE); setSel({ type: "commit", id }); },
    // double-click goes in: a commit opens, a session's lane becomes the focus, a track solos (tracks.ts)
    onTrackDouble: (h) => {
      if (h.type === "commit") { sideCommit(h.id); return true; }
      if (h.type === "lane") { focusOn({ kind: "session", s: h.s }); return true; }
      return false;
    },
    onSpan: (sp) => setSpan(sp && sp[1] - sp[0] >= 30 ? sp : null),
    atlasTip: (n) => atlasTip(m, ck, n, spans, A, B),
    retrack: () => tracks.current?.set(t0w, t1w, scope, span),
    // the copy the rail would show in this scope; a gone or unreadable file has no picture
    imgOf: (n) => {
      const a = n.art ? m.ART.get(n.art) : undefined; if (!a) return null;
      const cur = scopedArt(m, a, scope).cur;
      return cur && cur.image && !cur.gone && !cur.closed ? fileUrl(cur.path, "raw") : null;
    },
    onAtlasMenu: (n, e) => openMenu(e, nodeMenu(n)),
    onTrackMenu: (h, e) => openMenu(e, h.type === "proj" ? { type: "project", p: h.p } : h.type === "track" ? { type: "wt", w: h.w } : h.type === "commit" ? { type: "commit", id: h.id } : { type: "session", s: h.s, w: h.w }),
  };
  const showTip = (html: string | null, x: number, y: number) => {
    const el = tip.current; if (!el) return;
    if (!html) { el.style.display = "none"; return; }
    el.innerHTML = html; el.style.display = "block";
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = (x + 16 + w > innerWidth ? x - w - 12 : x + 16) + "px";
    el.style.top = (y + 16 + h > innerHeight ? y - h - 10 : y + 16) + "px";
  };
  useEffect(() => {
    pal.current = readPalette(frame.current!);
    const a = createAtlas(atlasCv.current!, atlasWrap.current!, {
      pal: () => pal.current!, selOf: (n) => L.current.selOf(n), onSelect: (n, mods) => L.current.onAtlas(n, mods), onOpen: (n) => L.current.onAtlasOpen(n), onMenu: (n, e) => L.current.onAtlasMenu(n, e), onFocus: setCrumb,
      tip: (n, x, y) => showTip(n ? L.current.atlasTip(n) : null, x, y), hm: ck.hm, end: () => L.current.t1w, imgOf: (n) => L.current.imgOf(n),
    });
    const t = createTracks(m, trCv.current!, trAx.current!, trScroll.current!, {
      pal: () => pal.current!, hi: () => L.current.hi(), onTrack: (w, mods) => L.current.onTrack(w, mods), onLane: (x, w, mods) => L.current.onLane(x, w, mods),
      onCommit: (id, mods) => L.current.onCommit(id, mods), onDouble: (h) => L.current.onTrackDouble(h), onSpan: (x) => L.current.onSpan(x), onMenu: (h, e) => L.current.onTrackMenu(h, e), tip: showTip, esc, hm: ck.hm, dhm: ck.dhm, ticks: ck.ticks, info: setTracksInfo,
    });
    atlas.current = a; tracks.current = t;
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { a.resize(); L.current.retrack(); }); });
    ro.observe(atlasWrap.current!); ro.observe(trScroll.current!);
    // the theme lives on the Provider's scope elements (and <html>); the canvases re-read the palette when it changes
    const mo = new MutationObserver(() => requestAnimationFrame(() => { if (!frame.current) return; pal.current = readPalette(frame.current); a.repaint(); t.repaint(); }));
    const scopes = new Set([frame.current!.closest("[data-scout-theme-mode]"), frame.current!.closest("[data-scout-theme]"), document.documentElement]);
    for (const el of scopes) if (el) mo.observe(el, { attributes: true, attributeFilter: ["data-scout-theme-mode", "data-scout-theme", "data-scout-palette", "data-scout-accent", "data-scout-contrast", "data-hudson-theme", "class", "style"] });
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); a.destroy(); t.destroy(); atlas.current = tracks.current = null; };
  }, [m, ck]);
  useEffect(() => { atlas.current?.setTree(tree, search); }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!focusReq || !atlas.current) return; if (focusReq.key) atlas.current.goToKey(focusReq.key); else if (focusReq.keys) atlas.current.goTo(focusReq.keys); }, [focusReq]);
  useEffect(() => { tracks.current?.set(t0w, t1w, scope, span); }, [t0w, t1w, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (askReq) ask$.current?.focus(); }, [askReq]);
  useEffect(() => { tracks.current?.setSpan(span); }, [span]);
  useEffect(() => { atlas.current?.repaint(); tracks.current?.repaint(); }, [sel, picks]);
  useEffect(() => {
    const id = sel?.type === "beat" ? sel.id : sel?.type === "commit" ? sel.id : null;
    if (id) list$.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  /* ── the ask ── */
  const winLabel = span ? `${ck.hm(A)} to ${ck.hm(B)}` : end === m.END ? "the last " + (WINS.find((w) => w.v === win)?.say ?? dur(win)) : `${ck.dhm(t0w)} to ${ck.dhm(t1w)}`;
  const target = useMemo(() => targetOf(m, sel, t0w, t1w, ck, beatById, commitById), [m, sel, t0w, t1w, ck, beatById, commitById]);
  const PRE = {
    good: (x: Target) => `Reviewed ${x.scope} in ${winLabel}. Looks good, carry on.`,
    follow: (x: Target) => `Follow up on ${x.scope}: `,
    wrap: (x: Target) => `Wrap up ${x.scope}: commit what is done, say what is left, then stop.`,
  };
  const selId = sel ? JSON.stringify({ ...sel, back: undefined }) : "";
  useEffect(() => { setMsg(""); setCopied(false); setSent(null); }, [selId]);
  const cmd = target ? command(m, target, msg.trim() || "…") : null;
  const copy = () => {
    if (!target || !msg.trim()) return; const c = command(m, target, msg.trim()); if (!c.cmd) return;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    navigator.clipboard?.writeText(c.cmd).then(done, () => {});
  };
  // a session with a Scout name gets the ask as a task; the runtime routes it by agent id, never by the lane label
  const send = () => {
    const S = target && target.s >= 0 ? m.SES[target.s] : null, text = msg.trim();
    if (!target || !S?.agentId || !text || sent?.state === "sending") return;
    setSent({ state: "sending", note: `Sending to ${S.agent}…` });
    api("/api/ask", { method: "POST", body: JSON.stringify({ targetAgentId: S.agentId, targetLabel: S.agent, body: text, metadata: { source: "review", scope: target.scope } }) })
      .then(() => { setSent({ state: "sent", note: `Sent to ${S.agent} as a task.` }); setMsg(""); }, (e: Error) => setSent({ state: "failed", note: `Not sent: ${e.message || "the runtime refused it"}` }));
  };
  const canSend = !!(target && target.s >= 0 && m.SES[target.s].agentId);

  useEffect(() => {
    const f = () => { if (document.visibilityState === "visible" && !sel && !msg && stale()) reload(); };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [sel, msg, stale, reload]);

  /* ── keys ── */
  const K = useRef<(e: KeyboardEvent) => void>(() => {});
  K.current = (e) => {
    if (document.querySelector(".s-context-menu")) return; // the menu takes its own keys
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) { if (e.key === "Escape") t.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!frame.current || frame.current.getBoundingClientRect().bottom < 0) return;
    const k = e.key;
    if (k === "/") { e.preventDefault(); search$.current?.focus(); return; }
    if (k === "+" || k === "=") { e.preventDefault(); atlas.current?.zoom(ZOOM_STEP); return; }
    if (k === "-" || k === "_") { e.preventDefault(); atlas.current?.zoom(1 / ZOOM_STEP); return; }
    if (k === "0") { e.preventDefault(); atlas.current?.fit(); return; }
    if (k === "[" || k === "]") { e.preventDefault(); setEnd((x) => Math.max(Math.min(win, m.END), Math.min(m.END, x + (k === "]" ? win : -win)))); return; }
    if (k === "j" || k === "k" || k === "J" || k === "K" || k === "ArrowDown" || k === "ArrowUp") {
      if (!visibleItems.length) return; e.preventDefault();
      const id = sel?.type === "beat" ? sel.id : sel?.type === "commit" ? sel.id : null;
      let i = visibleItems.findIndex((x) => (x.kind === "beat" ? x.b.id : x.c.id) === id);
      i = i < 0 ? 0 : Math.max(0, Math.min(visibleItems.length - 1, i + (k === "j" || k === "J" || k === "ArrowDown" ? 1 : -1)));
      // Shift runs the picks down or up the rail
      if (e.shiftKey) { pickMore(itemKey(visibleItems[i]), { add: false, range: true }, visibleItems.map(itemKey)); return; }
      setPicks(NONE); pickItem(visibleItems[i]); return;
    }
    if (k === "Enter") {
      const open = picked.size ? picks.keys.filter((x) => x.startsWith("a:") || x.startsWith("c:")) : [];
      if (open.length) { e.preventDefault(); openMany(open); return; }
      if (sel?.type === "art") { e.preventDefault(); sideArt(sel.key, sel.v); }
      else if (sel?.type === "commit") { e.preventDefault(); sideCommit(sel.id); }
      return;
    }
    if (k === "Escape") {
      e.preventDefault();
      if (isSheet(sel)) setSel(sel.back ?? null);
      else if (span) setSpan(null);
      else if (tracks.current?.unsolo()) return;
      else if (atlas.current?.up()) return;
      else if (picked.size) setPicks(NONE);
      else if (focus) setFocus(null);
      else if (paneOpen) closePane();
      else setSel(null);
    }
  };
  useEffect(() => { const f = (e: KeyboardEvent) => K.current(e); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, []);

  /* ── render ── */
  const nArts = spans.size, nCommits = m.COMMITS.filter((c) => c.t >= A && c.t <= B && commitIn(m, scope, c)).length;
  const sheet = isSheet(sel) ? sel : null;
  const sheetId = sheet ? sheet.type + ":" + (sheet.type === "art" ? sheet.key + ":" + (sheet.v ?? "") : sheet.type === "commit" ? sheet.id : sheet.w) : "";
  // a sheet opens at its top; the rail comes back where it was
  useLayoutEffect(() => { const el = list$.current; if (el) el.scrollTop = sheetId ? 0 : railTop.current; }, [sheetId]);
  return (
    <div className={s.frame} ref={frame}>
      <div className={s.banner}>
        <div className={s.grp}>
          <span className={s.k}>Window</span>
          <div className={s.seg}>{WINS.map((w) => <button key={w.v} data-on={win === w.v} onClick={() => setPrefs({ win: w.v })}>{w.l}</button>)}</div>
          <button className={s.step} title="Previous window ( [ )" disabled={end <= Math.min(win, m.END)} onClick={() => setEnd((x) => Math.max(Math.min(win, m.END), x - win))}>[</button>
          <button className={s.step} title="Next window ( ] )" disabled={end >= m.END} onClick={() => setEnd((x) => Math.min(m.END, x + win))}>]</button>
          <span className={s.endLabel}>{end === m.END ? "to now · " + ck.dhm(m.END) : ck.dhm(t0w) + " → " + ck.dhm(t1w)}</span>
        </div>
        <div className={s.grp}>
          {focus ? (
            <>
              <span className={s.k}>Focus</span>
              <span className={s.spanChip} title={focus.kind === "wt" && focus.w >= 0 ? m.WT[focus.w].path ?? undefined : scopeLabel}>
                {focus.kind === "session" ? "SESSION " : focus.kind === "wt" ? "WORKTREE " : ""}{scopeLabel}<button aria-label="Clear the focus" onClick={() => setFocus(null)}>×</button>
              </span>
            </>
          ) : (
            <>
              <span className={s.k}>Project</span>
              <select className={s.select} value={project} onChange={(e) => setPrefs({ project: e.target.value })}>
                <option value="all">All projects</option>
                {projects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </>
          )}
        </div>
        <div className={s.grp}>
          <span className={s.k}>Show</span>
          <div className={s.seg}>{SHOWS.map((x) => <button key={x.v} data-on={prefs.show === x.v} onClick={() => setPrefs({ show: x.v })}>{x.l}</button>)}</div>
          <div className={s.seg}>
            <button data-on={prefs.surfaced} onClick={() => setPrefs({ surfaced: true })} title="Fold what reads as routine">Surfaced</button>
            <button data-on={!prefs.surfaced} onClick={() => setPrefs({ surfaced: false })}>All</button>
          </div>
        </div>
        <input ref={search$} className={s.search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="/  find a file or command" aria-label="Search" />
        {span ? <span className={s.spanChip}>SPAN {ck.hm(span[0])}–{ck.hm(span[1])}<button aria-label="Clear the span" onClick={() => setSpan(null)}>×</button></span> : null}
        {picked.size ? <span className={s.spanChip} title="Right-click one of them for what they can do together">{picked.size} PICKED<button aria-label="Deselect them" onClick={() => setPicks(NONE)}>×</button></span> : null}
        <span className={s.grow} />
        <span className={s.stat}>{plural(nArts, "artifact")} · {plural(nCommits, "commit")}</span>
        <button className={s.step} disabled={loading} onClick={reload} title={`Read the last ${DAYS} days again`}>{loading ? "LOADING" : "RELOAD"}</button>
      </div>

      <div className={s.body} ref={body$} data-pane={paneOpen} data-wide={paneOpen && prefs.wide} style={bodyStyle}>
        <div className={s.left}>
          <div className={s.crumb}>
            {crumb.map((n, i) => (
              <span key={n.key} style={{ display: "contents" }}>
                {i ? <span className={s.crumbSep}>›</span> : null}
                <button onClick={() => atlas.current?.goTo(crumb.slice(1, i + 1).map((x) => x.key))} onContextMenu={(e) => openMenu(e, nodeMenu(n))}>{n.kind === "root" ? scopeLabel : n.name}</button>
              </span>
            ))}
            <span className={s.grow} />
            <span className={s.keys}>double-click goes in or opens · <b>+</b> <b>−</b> zoom · <b>⌘</b> <b>⇧</b> pick more · right-click: focus · <b>esc</b> up</span>
          </div>
          <div className={s.atlasWrap} ref={atlasWrap}>
            <canvas ref={atlasCv} />
            <div className={s.zoom} role="group" aria-label="Zoom the Atlas">
              <button type="button" onClick={() => atlas.current?.zoom(1 / ZOOM_STEP)} aria-label="Zoom out" title="Zoom out · −">−</button>
              <button type="button" onClick={() => atlas.current?.fit()} title="Fit the focused level · 0">Fit</button>
              <button type="button" onClick={() => atlas.current?.zoom(ZOOM_STEP)} aria-label="Zoom in" title="Zoom in · +">+</button>
            </div>
          </div>
          <div className={s.tracksHead}>
            <span className={s.k}>Tracks</span>
            <span className={s.stat}>{tracksInfo}</span>
            <span className={s.grow} />
            <span className={s.keys}>drag: set the span · <b>⌘</b> <b>⇧</b> pick more · double-click: solo a track, focus a session, open a commit</span>
          </div>
          <div className={s.tracksPane}>
            <div className={s.axis}><canvas ref={trAx} /></div>
            <div className={s.tracksScroll} ref={trScroll}><canvas ref={trCv} /></div>
          </div>
        </div>

        {paneOpen ? (
          <Pane m={m} scope={scope} ck={ck} tabs={pane.tabs} at={pane.at} wide={prefs.wide}
            onAt={(i) => setPane((p) => ({ ...p, at: i }))} onPin={(i) => setPane((p) => ({ ...p, tabs: p.tabs.map((x, j) => (j === i ? { ...x, pin: true } : x)) }))}
            onClose={closeTab} onCloseAll={closePane} onWide={() => setPrefs({ wide: !prefs.wide })} onGrip={onGrip}
            onView={(i, v) => setPane((p) => ({ ...p, tabs: p.tabs.map((x, j) => (j === i && x.type === "art" ? { ...x, v, pin: true } : x)) }))}
            onArt={(k, v) => sideArt(k, v)} onCommit={sideCommit} onSession={(x) => setSel({ type: "session", s: x })} />
        ) : null}

        <div className={s.rail} ref={rail$}>
          <div className={s.railGrip} onPointerDown={onRailGrip} onDoubleClick={() => setPrefs({ railW: null })} role="separator" aria-orientation="vertical" aria-label="Resize the rail" title="Drag to resize · double-click to reset" />
          <div className={s.railHead}>
            {sheet ? (
              <button className={s.back} onClick={() => setSel(sheet.back ?? null)}>← {sheet.back ? "BACK" : "BY TIME"}</button>
            ) : (
              <>
                <span className={s.k}>By time</span>
                <span className={s.stat}>{plural(bands.reduce((n, b) => n + b.commits, 0), "commit")} · {plural(bands.reduce((n, b) => n + b.beats, 0), "beat")}</span>
                <span className={s.grow} />
                <span className={s.keys}><b>j</b> <b>k</b> <b>↵</b> <b>[</b> <b>]</b></span>
              </>
            )}
          </div>
          <div className={s.scroll} ref={list$} onScroll={(e) => { if (!sheet) railTop.current = e.currentTarget.scrollTop; }}>
            {sheet?.type === "art" ? (
              m.ART.get(sheet.key) ? <FileSheet key={sheet.key + (sheet.v ?? "")} m={m} ck={ck} a={scopedArt(m, m.ART.get(sheet.key)!, scope)} v={sheet.v} t0w={t0w} t1w={t1w}
                onSession={(x) => setSel({ type: "session", s: x })} onCommit={(id) => setSel({ type: "commit", id, back: sheet })}
                onSide={(v) => openSide({ type: "art", key: sheet.key, v: v ?? null, pin: true })} /> : null
            ) : sheet?.type === "commit" ? (
              commitById.get(sheet.id) ? <CommitSheet m={m} ck={ck} c={commitById.get(sheet.id)!} onArt={(k, v) => setSel({ type: "art", key: k, v, back: sheet })} onSession={(x) => setSel({ type: "session", s: x })}
                onSide={() => openSide({ type: "commit", id: sheet.id, pin: true })} onSideArt={(k, v) => sideArt(k, v)} /> : null
            ) : sheet?.type === "fold" ? (
              <FoldSheet m={m} ck={ck} w={sheet.w} keys={sheet.keys} spans={spans} onArt={(k) => setSel({ type: "art", key: k, back: sheet })} />
            ) : (
              <Rail m={m} ck={ck} bands={bands} surfaced={prefs.surfaced} openBands={openBands} sel={sel} picked={picked} A={A} B={B} span={!!span}
                onBand={(b) => setSpan([b.a, b.b])} onToggle={(a) => setOpenBands((o) => { const n = new Set(o); n.has(a) ? n.delete(a) : n.add(a); return n; })}
                onItem={(x, mods) => { if (!plain(mods)) return pickMore(itemKey(x), mods, visibleItems.map(itemKey)); setPicks(NONE); pickItem(x); }}
                onOpen={(x) => (x.kind === "commit" ? sideCommit(x.c.id) : focusOn({ kind: "session", s: x.b.s }))}
                onArt={(k) => openArt(k)} onOpenArt={(k) => sideArt(k)} onMenu={openMenu} show={prefs.show} />
            )}
          </div>
        </div>
      </div>

      <div className={s.fb}>
        <div className={s.fbWho}>
          {target ? <>TO <b>{target.s >= 0 ? m.SES[target.s].name : "a new session"}</b> · ABOUT <b title={target.scope}>{target.scope.length > 80 ? target.scope.slice(0, 79) + "…" : target.scope}</b></>
            : "Select a file, a commit, a beat, a track or a session to ask about it"}
        </div>
        <div className={s.fbPre}>
          {(["good", "follow", "wrap"] as const).map((p) => (
            <button key={p} disabled={!target} onClick={() => target && setMsg(PRE[p](target))}>{p === "good" ? "Looks good" : p === "follow" ? "Follow up" : "Wrap up"}</button>
          ))}
        </div>
        <input ref={ask$} className={s.fbMsg} value={msg} disabled={!target} onChange={(e) => { setMsg(e.target.value); if (sent?.state !== "sending") setSent(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && canSend) { e.preventDefault(); send(); } }}
          placeholder={target ? "What should the session do?" : ""} aria-label="Ask" />
        {canSend ? (
          <button className={s.fbCopy} disabled={!msg.trim() || sent?.state === "sending"} onClick={send}>{sent?.state === "sending" ? "SENDING" : "SEND ASK"}</button>
        ) : (
          <button className={s.fbCopy} disabled={!cmd?.cmd || !msg.trim()} onClick={copy}>{copied ? "COPIED" : "COPY ASK"}</button>
        )}
        <div className={s.fbCmd}>{!canSend && cmd?.cmd ? <><b>$</b> {cmd.cmd}</> : null}</div>
        {sent ? <div className={s.fbNote} data-state={sent.state}>{sent.note}</div> : cmd ? <div className={s.fbNote}>{cmd.note}</div> : null}
      </div>
      <div className={s.tip} ref={tip} />
    </div>
  );
}

/* ── the rail ── */
function Rail({ m, ck, bands, surfaced, openBands, sel, picked, A, B, span, onBand, onToggle, onItem, onOpen, onArt, onOpenArt, onMenu, show }: {
  m: Model; ck: ReturnType<typeof clock>; bands: Band[]; surfaced: boolean; openBands: Set<number>; sel: Sel; picked: Set<string>; A: number; B: number; span: boolean; show: Show;
  onBand: (b: Band) => void; onToggle: (a: number) => void; onItem: (x: Item, mods: Mods) => void; onOpen: (x: Item) => void;
  onArt: (key: string) => void; onOpenArt: (key: string) => void; onMenu: (e: ReactMouseEvent, x: MenuOf) => void;
}) {
  if (!bands.length) return <div className={s.emptyNote}>Nothing in this window for this filter. Try a longer window, another project, or Everything.</div>;
  const selS = sel?.type === "session" ? sel.s : null, selW = sel?.type === "wt" ? sel.w : null;
  const selId = sel?.type === "beat" || sel?.type === "commit" ? sel.id : null;
  return (
    <>
      {bands.map((band) => {
        const open = !surfaced || openBands.has(band.a);
        const shown = open ? band.items : band.items.filter((x) => x.key);
        const inSpan = span && band.a < B && band.b > A;
        return (
          <div key={band.a} className={s.band}>
            <button className={s.bandHead} data-in={inSpan} onClick={() => onBand(band)} title="Set the span to this band">
              <span className={s.bandWhen}>{(band.b - band.a >= 3 * 3600 ? ck.dhm(band.a) : ck.hm(band.a)) + "–" + ck.hm(band.b)}</span>
              <span className={s.bandMeta}>{[band.commits ? plural(band.commits, "commit") : "", band.beats ? plural(band.beats, "beat") : ""].filter(Boolean).join(" · ")}</span>
            </button>
            {shown.map((x) => {
              const id = x.kind === "beat" ? x.b.id : x.c.id;
              const mark = x.kind === "beat" ? x.b.s === selS || x.b.wt === selW : (selS != null && x.c.s === selS) || x.c.wt === selW;
              const out = span && (x.t < A - 1 || x.t > B + 1) && !(x.kind === "beat" && x.b.t1 >= A && x.b.t0 <= B);
              return (
                <div key={id} data-id={id} className={s.item} data-sel={id === selId || picked.has(itemKey(x))} data-mark={mark} data-out={out}
                  // Shift and Cmd pick; keep the browser from selecting text on the way
                  onMouseDown={(e) => { if (e.shiftKey || e.metaKey) e.preventDefault(); }}
                  onClick={(e) => onItem(x, modsOf(e))} onDoubleClick={() => onOpen(x)}
                  onContextMenu={(e) => onMenu(e, x.kind === "beat" ? { type: "beat", id: x.b.id } : { type: "commit", id: x.c.id })}>
                  {x.kind === "beat" ? <BeatRow m={m} ck={ck} b={x.b} onArt={onArt} onOpenArt={onOpenArt} onMenu={onMenu} show={show} /> : <CommitRow m={m} ck={ck} c={x.c} I={x.I} />}
                </div>
              );
            })}
            {surfaced && band.quiet ? (
              <button className={s.quieter} onClick={() => onToggle(band.a)}>{open ? `fold ${band.quiet} quieter` : `${band.quiet} quieter`}</button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
function BeatRow({ m, ck, b, onArt, onOpenArt, onMenu, show }: { m: Model; ck: ReturnType<typeof clock>; b: Beat; onArt: (key: string) => void; onOpenArt: (key: string) => void; onMenu: (e: ReactMouseEvent, x: MenuOf) => void; show: Show }) {
  const S = m.SES[b.s], op = b.opener;
  const want = show === "images" ? "image" : show === "docs" ? "doc" : null;
  const arts = want ? [...b.arts].sort((p, q) => Number(m.ART.get(q.key)?.kind === want) - Number(m.ART.get(p.key)?.kind === want)) : b.arts;
  return (
    <>
      <div className={s.when}>{ck.hm(b.t0)}<span>{dur(b.t1 - b.t0)}</span></div>
      <div style={{ minWidth: 0 }}>
        <div className={s.l1}>
          <span className={s.nm}>{S.short}</span>
          <span className={`${s.meta} ${s.metaGrow}`}>{b.wt >= 0 ? m.WT[b.wt].label : "unplaced"}</span>
          <span className={s.grow} />
          <span className={s.meta}>{b.e ? `${plural(b.e, "edit")} · +${b.add} −${b.del}` : plural(b.calls.length, "call")}</span>
        </div>
        <div className={s.said}>{op ? (op.desc ? <em>{op.text}</em> : <>“{op.text.slice(0, 280)}”</>) : <em>Continues the work from earlier.</em>}</div>
        {b.arts.length || hotBeat(b) || b.errs.length ? (
          <div className={s.chips}>
            {b.failed ? <span className={`${s.tag} ${s.tagHot}`}>Task failed</span> : null}
            {b.openTask ? <span className={`${s.tag} ${s.tagHot}`}>Open task</span> : null}
            {arts.slice(0, 4).map((f) => {
              const a = m.ART.get(f.key);
              return a ? <button key={f.key} className={s.chip} data-on={f.e > 0} title={(a.repo ? a.repo + "/" : "") + a.rel} onClick={(e) => { e.stopPropagation(); onArt(f.key); }} onDoubleClick={(e) => { e.stopPropagation(); onOpenArt(f.key); }} onContextMenu={(e) => onMenu(e, { type: "art", key: f.key })}>{a.base}{f.e ? ` e${f.e}` : ` r${f.r}`}</button> : null;
            })}
            {b.arts.length > 4 ? <span className={s.meta}>and {b.arts.length - 4} more</span> : null}
            {b.errs.length ? <span className={s.meta}>· {plural(b.errs.length, "failed call")}</span> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
function CommitRow({ m, ck, c, I }: { m: Model; ck: ReturnType<typeof clock>; c: Commit; I: number }) {
  const add = c.changes.reduce((n, x) => n + x.add, 0), del = c.changes.reduce((n, x) => n + x.del, 0);
  return (
    <>
      <div className={s.when}>{ck.hm(c.t)}<span>commit</span></div>
      <div style={{ minWidth: 0 }}>
        <div className={s.l1}>
          <span className={s.diamond} />
          <span className={`${s.meta} ${s.metaGrow}`}>{c.repo}{c.branch && c.branch !== "main" ? " · " + c.branch : ""}{c.merged ? ` · #${c.merged}` : c.mergedAs ? ` · landed as #${c.mergedAs}` : ""}</span>
          <span className={s.grow} />
          <span className={s.meta}>{plural(c.changes.length, "file")} · +{add} −{del}<span className={s.meter}><i style={{ width: Math.round(I * 100) + "%" }} /></span></span>
        </div>
        <div className={s.subj}>{c.subj}</div>
        <div className={s.meta} style={{ marginTop: 3 }}>{c.s >= 0 ? m.SES[c.s].short : "a session outside this record"}</div>
      </div>
    </>
  );
}

/* ── sheets ── */
function FileSheet({ m, ck, a, v, t0w, t1w, onSession, onCommit, onSide }: {
  m: Model; ck: ReturnType<typeof clock>; a: Art; v?: string; t0w: number; t1w: number; onSession: (s: number) => void; onCommit: (id: string) => void;
  /** open the file (or one of its commits) in the code pane */
  onSide: (v?: string) => void;
}) {
  const versions = useMemo(() => [...a.changes].reverse(), [a]);
  const [open, setOpen] = useState<string | null>(v ?? versions[0]?.id ?? null);
  const touch = useMemo(() => {
    const fs = new Set(a.files), by = new Map<number, { e: number; r: number; last: number }>();
    let lastEdit = -Infinity;
    for (let i = 0; i < m.C.length; i++) {
      const c = m.C[i]; if (!fs.has(c[5])) continue;
      const ed = m.CK[i] === "edit"; if (ed) lastEdit = Math.max(lastEdit, c[0]);
      if (c[0] < t0w || c[0] > t1w) continue;
      let x = by.get(c[1]); if (!x) by.set(c[1], (x = { e: 0, r: 0, last: 0 }));
      ed ? x.e++ : x.r++; x.last = Math.max(x.last, c[0]);
    }
    return { lastEdit, by: [...by.entries()].sort((p, q) => q[1].last - p[1].last) };
  }, [m, a, t0w, t1w]);
  const lastCommit = a.changes.length ? a.changes[a.changes.length - 1].cm.t : -Infinity;
  const cur = a.cur;
  // which checkout the copy was read from: a branch's files may not have reached it
  const where = cur && cur.w >= 0 ? m.WT[cur.w]?.label ?? null : null;
  const [head, setHead] = useState<ReviewFileHead | "none" | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    if (!cur || cur.gone || cur.image || cur.closed) return;
    let live = true;
    api<ReviewFileHead>(fileUrl(cur.path, "head"), { cache: "no-store" }).then((h) => live && setHead(h), () => live && setHead("none"));
    return () => { live = false; };
  }, [cur]);
  const stale = !!cur && !cur.gone && a.changes.length > 0 && cur.mt < lastCommit - 60;
  return (
    <div className={s.sheet}>
      <div className={s.sheetTop}>
        <div style={{ minWidth: 0 }}>
          <div className={s.sheetTitle}>{a.base}</div>
          <div className={s.sheetSub}>{(a.repo ? a.repo + " · " : "") + (a.dir || "/")} · {a.kind}</div>
        </div>
        <button className={s.openBtn} onClick={() => onSide()} title="Read it in the code pane ( ↵ )">Open</button>
      </div>

      <div className={s.sec}>
        <div className={s.secHead}><span className={s.k}>Current state</span><span className={s.grow} />{cur && !cur.gone ? <span className={s.meta}>{where ? where + " · " : ""}saved {ck.dhm(cur.mt)}</span> : null}</div>
        <div className={s.cur}>
          {cur?.gone ? <div className={s.noteQuiet}>No longer on disk. Its commits below are all that is left.</div>
            : !cur ? <div className={s.noteQuiet}>Not read for this file.</div>
            : cur.closed ? <div className={s.noteQuiet}>Outside the folders this window may read, so there is no preview. It is at {cur.path}.</div>
            : cur.image ? (imgFailed ? <div className={s.noteQuiet}>The image could not be read.</div>
              : <img className={s.thumb} src={fileUrl(cur.path, "raw")} alt={a.base} loading="lazy" onError={() => setImgFailed(true)} />)
            : head == null ? <div className={s.noteQuiet}>Reading…</div>
            : head === "none" ? <div className={s.noteQuiet}>No preview for this file: it is generated, too large, or outside the folders this window may read.</div>
            : <><pre className={s.headPre}>{head.head}</pre><div className={s.meta} style={{ marginTop: 4 }}>{head.lines > REVIEW_HEAD_LINES ? `first ${REVIEW_HEAD_LINES} of ${fmtC(head.lines)} lines` : plural(head.lines, "line")}</div></>}
        </div>
        {stale ? <div className={s.noteQuiet}>This copy in {where ?? "its checkout"} is older than the file&apos;s last commit; that commit has not reached this checkout. The newest version is the top commit below.</div> : null}
        {touch.lastEdit > lastCommit + 30 ? (
          <div className={s.note}>{a.changes.length ? `Edited after its last commit, at ${ck.dhm(touch.lastEdit)}. The current state has that edit; no version holds it yet.` : `Edited at ${ck.dhm(touch.lastEdit)} and not committed. The current state is its only version.`}</div>
        ) : null}
      </div>

      <div className={s.sec}>
        <div className={s.secHead}><span className={s.k}>Versions are commits</span><span className={s.grow} /><span className={s.meta}>{versions.length ? plural(versions.length, "commit") : "none in the record"}</span></div>
        {versions.map((ch) => (
          <div key={ch.id} className={s.vrow} data-open={open === ch.id}>
            <button className={s.vhead} onClick={() => setOpen(open === ch.id ? null : ch.id)}>
              <span className={s.when}>{ck.dhm(ch.cm.t)}</span>
              <span className={s.nm} style={{ fontFamily: "var(--rw-sans)" }}>{ch.cm.subj}</span>
              <span className={s.meta}>{ch.isNew ? "new · " : ch.isGone ? "removed · " : ""}+{ch.add} −{ch.del}<span className={s.meter}><i style={{ width: Math.round(ch.I * 100) + "%" }} /></span></span>
              <span className={s.why}>{ch.j ? `Read ${ch.j.score} of 5. ${ch.j.why}` : ch.shapeWhy}</span>
            </button>
            {open === ch.id ? (
              <>
                <Diff ch={ch} />
                <div style={{ display: "flex", gap: 8, margin: "-2px 0 10px" }}>
                  <button className={s.chip} onClick={() => onSide(ch.id)} title="Read this diff in the code pane">full width</button>
                  <button className={s.chip} onClick={() => onCommit(ch.cm.id)}>open the commit</button>
                  {ch.cm.s >= 0 ? <button className={s.chip} onClick={() => onSession(ch.cm.s)}>{m.SES[ch.cm.s].short}</button> : <span className={s.meta}>a session outside this record</span>}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>

      <div className={s.sec}>
        <div className={s.secHead}><span className={s.k}>Touched by</span><span className={s.grow} /><span className={s.meta}>in this window</span></div>
        {touch.by.length ? touch.by.map(([si, x]) => (
          <button key={si} className={s.rowBtn} onClick={() => onSession(si)}>
            <span className={s.nm}>{m.SES[si].short}</span><span className={s.grow} />
            <span className={s.meta}>{[x.e ? plural(x.e, "edit") : "", x.r ? plural(x.r, "read") : ""].filter(Boolean).join(" · ")} · {ck.hm(x.last)}</span>
          </button>
        )) : <div className={s.noteQuiet}>No session touched it in this window.</div>}
      </div>
    </div>
  );
}
function Diff({ ch }: { ch: Change }) {
  const hs = useMemo(() => hunksOf(ch.patch || ""), [ch]);
  const [showQuiet, setShowQuiet] = useState(false);
  if (!hs.length) return <div className={s.noteQuiet} style={{ marginBottom: 10 }}>{ch.isGone ? "Removed in this commit." : "No text diff (binary or renamed)."}</div>;
  const { key, quiet, loud, soft } = diffOrder(ch, hs.length);
  const hunk = (i: number) => (
    <div key={i} className={s.hunk}>
      <div className={s.hunkHead}>{i === key ? <b>read first</b> : null}<span>hunk {i} of {hs.length}</span>{quiet.has(i) ? <span>quiet</span> : null}</div>
      <pre className={s.code}>
        {hs[i - 1].head ? <span className={s.at}>{hs[i - 1].head}</span> : null}
        {hs[i - 1].lines.map((ln, k) => <span key={k} className={ln[0] === "+" ? s.add : ln[0] === "-" ? s.del : undefined}>{ln || " "}</span>)}
      </pre>
    </div>
  );
  return (
    <div className={s.diff}>
      {loud.map(hunk)}
      {soft.length ? (showQuiet ? soft.map(hunk) : <button className={s.foldBtn} onClick={() => setShowQuiet(true)}>{plural(soft.length, "quiet hunk")}: show</button>) : null}
      {ch.cut > 0 ? <div className={s.cutNote}>and {plural(ch.cut, "more line")} not kept</div> : null}
    </div>
  );
}
function CommitSheet({ m, ck, c, onArt, onSession, onSide, onSideArt }: {
  m: Model; ck: ReturnType<typeof clock>; c: Commit; onArt: (key: string, v: string) => void; onSession: (s: number) => void;
  /** read the whole commit, or one file as it changed, in the code pane */
  onSide: () => void; onSideArt: (key: string, v: string) => void;
}) {
  const files = [...c.changes].sort((a, b) => b.I - a.I);
  return (
    <div className={s.sheet}>
      <div className={s.sheetTop}>
        <div style={{ minWidth: 0 }}>
          <div className={s.sheetTitle} style={{ fontFamily: "var(--rw-sans)", wordBreak: "normal" }}>{c.subj}</div>
          <div className={s.sheetSub}>
            {ck.dhm(c.t)} · {c.repo}{c.branch ? " · " + c.branch : ""}{c.merged ? ` · merged as #${c.merged}` : c.mergedAs ? ` · landed as #${c.mergedAs}` : ""}
          </div>
        </div>
        <button className={s.openBtn} onClick={onSide} title="Read every file it changed in the code pane ( ↵ )">Open</button>
      </div>
      <div className={s.sec}>
        <div className={s.secHead}><span className={s.k}>Made by</span></div>
        {c.s >= 0 ? <button className={s.rowBtn} onClick={() => onSession(c.s)}><span className={s.nm}>{m.SES[c.s].name}</span><span className={s.grow} /><span className={s.meta}>{c.how === "edits" ? "matched by its edits" : "ran git commit"}</span></button>
          : <div className={s.noteQuiet}>A session outside this record, or by hand.</div>}
      </div>
      <div className={s.sec}>
        <div className={s.secHead}><span className={s.k}>Files</span><span className={s.grow} /><span className={s.meta}>most worth reading first</span></div>
        {files.length ? files.map((x) => {
          const cut = x.path.lastIndexOf("/");
          return (
            <button key={x.id} className={s.rowBtn} onClick={() => onArt(x.key, x.id)} onDoubleClick={() => onSideArt(x.key, x.id)} title={x.j ? x.j.why : x.shapeWhy}>
              <span className={s.nm}>{x.path.slice(cut + 1)}</span>
              <span className={`${s.meta} ${s.metaGrow}`}>{x.path.slice(0, cut + 1)}</span>
              <span className={s.grow} />
              <span className={s.meta}>+{x.add} −{x.del}<span className={s.meter}><i style={{ width: Math.round(x.I * 100) + "%" }} /></span></span>
            </button>
          );
        }) : <div className={s.noteQuiet}>No file diff was kept for this commit.</div>}
      </div>
    </div>
  );
}
function FoldSheet({ m, w, keys, spans, onArt }: { m: Model; ck: ReturnType<typeof clock>; w: number; keys: string[]; spans: Map<string, { e: number; r: number; add: number; del: number }>; onArt: (key: string) => void }) {
  const arts = keys.map((k) => m.ART.get(k)!).filter(Boolean).sort((a, b) => (spans.get(b.key)?.e ?? 0) - (spans.get(a.key)?.e ?? 0));
  return (
    <div className={s.sheet}>
      <div className={s.sheetTitle}>{plural(arts.length, "quieter file")}</div>
      <div className={s.sheetSub}>{w >= 0 ? m.WT[w].label : "unplaced"} · folded because each reads as routine. All shows them as tiles.</div>
      <div className={s.sec}>
        {arts.map((a) => { const x = spans.get(a.key); return (
          <button key={a.key} className={s.rowBtn} onClick={() => onArt(a.key)}>
            <span className={s.nm}>{a.base}</span><span className={`${s.meta} ${s.metaGrow}`}>{a.dir}</span><span className={s.grow} />
            <span className={s.meta}>{x ? [x.e ? `e${x.e}` : "", x.r ? `r${x.r}` : "", x.add || x.del ? `+${x.add} −${x.del}` : ""].filter(Boolean).join(" ") : ""}</span>
          </button>
        ); })}
      </div>
    </div>
  );
}

/* ── hover card for the Atlas ── */
function atlasTip(m: Model, ck: ReturnType<typeof clock>, n: ANode, spans: Map<string, { ch: Change[] }>, A: number, B: number): string {
  const stats = (x: ANode) => [x.cms.size ? plural(x.cms.size, "commit") : "", x.e ? plural(x.e, "edit") : "", x.rd ? plural(x.rd, "read") : "", x.add || x.del ? `+${x.add} −${x.del}` : ""].filter(Boolean).join(" · ");
  if (n.kind === "leaf") {
    const a = m.ART.get(n.art!)!, ch = (spans.get(a.key)?.ch ?? []).filter((x) => x.j).sort((p, q) => q.I - p.I)[0];
    const who = [...n.ses].slice(0, 3).map((x) => m.SES[x].short).join(", ") + (n.ses.size > 3 ? ` and ${n.ses.size - 3} more` : "");
    return `<b>${esc(a.base)}</b>  <span class="d">${esc((a.repo ? a.repo + "/" : "") + a.dir)}</span>\n${esc(stats(n))}` +
      (ch?.j ? `\nRead ${ch.j.score} of 5. ${esc(ch.j.why)}` : "") + (who ? `\n<span class="d">${esc(who)} · last ${ck.hm(n.last)}</span>` : "") + `\n<span class="d">click: open the file</span>`;
  }
  if (n.kind === "group") return `<b>${esc(n.name)}</b> · ${plural(n.n, "call")}\n` + [...(n.cmds ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `×${v}  ${esc(k)}`).join("\n");
  if (n.kind === "fold") return `<b>${esc(n.name)}</b>\n${esc(stats(n))}\n<span class="d">files that read as routine · click to list them</span>`;
  const wt = n.kind === "wt" && n.w != null && n.w >= 0 ? m.WT[n.w] : null;
  return `<b>${esc(n.name)}</b>${wt?.path ? `\n<span class="d">${esc(wt.path)}</span>` : ""}\n${esc(stats(n))} · ${plural(n.ses.size, "session")}\n<span class="d">${ck.hm(A)}–${ck.hm(B)} · double-click to go in</span>`;
}

/* ── who an ask goes to ── */
function targetOf(m: Model, sel: Sel, t0w: number, t1w: number, ck: ReturnType<typeof clock>, beats: Map<string, Beat>, commits: Map<string, Commit>): Target | null {
  if (!sel) return null;
  const i0 = bsearch(m.CT, t0w), i1 = bsearch(m.CT, t1w + 1);
  const lastSession = (pred: (c: number[]) => boolean, preferEdit = false) => {
    if (preferEdit) for (let k = i1 - 1; k >= i0; k--) if (m.CK[k] === "edit" && pred(m.C[k])) return m.C[k][1];
    for (let k = i1 - 1; k >= i0; k--) if (pred(m.C[k])) return m.C[k][1];
    return -1;
  };
  const mainWt = (x: number) => {
    const n = new Map<number, number>();
    for (let k = i0; k < i1; k++) if (m.C[k][1] === x && m.C[k][4] >= 0) n.set(m.C[k][4], (n.get(m.C[k][4]) || 0) + 1);
    let best = -1, bn = 0; for (const [w, c] of n) if (c > bn) { best = w; bn = c; }
    if (best < 0) for (let k = m.SES[x].calls.length - 1; k >= 0; k--) { const w = m.C[m.SES[x].calls[k]][4]; if (w >= 0) return w; }
    return best;
  };
  // a new session goes to the worktree the commit was made in while it exists, else to the project's main checkout
  const branchPath = (c: Commit) => { const w = m.WT[c.wt]; return w?.path && !w.gone ? w.path : m.D.projects[c.repo] ?? null; };
  switch (sel.type) {
    case "session": { const w = sel.w ?? mainWt(sel.s); return { s: sel.s, wt: w, scope: "the work in " + (w >= 0 ? m.WT[w].label : "this session") }; }
    case "wt": { const x = lastSession((c) => c[4] === sel.w); return { s: x, wt: sel.w, scope: (sel.what ? `the ${sel.what} in ` : "the work in ") + (sel.w >= 0 ? m.WT[sel.w].label : "unplaced calls") }; }
    case "fold": { const x = lastSession((c) => c[4] === sel.w); return { s: x, wt: sel.w, scope: "the quieter files in " + (sel.w >= 0 ? m.WT[sel.w].label : "unplaced calls") }; }
    case "project": { const x = lastSession((c) => m.projOf(c) === sel.p); return { s: x, wt: x >= 0 ? mainWt(x) : -1, scope: "the work in " + sel.p }; }
    case "beat": {
      const b = beats.get(sel.id); if (!b) return null;
      const op = b.opener && !b.opener.desc ? ` ("${b.opener.text.slice(0, 60).trim()}${b.opener.text.length > 60 ? "…" : ""}")` : "";
      return { s: b.s, wt: b.wt, scope: `the ${ck.hm(b.t0)} to ${ck.hm(b.t1)} work in ${b.wt >= 0 ? m.WT[b.wt].label : "this session"}${op}` };
    }
    case "commit": {
      const c = commits.get(sel.id); if (!c) return null;
      const s0 = c.s >= 0 ? c.s : lastSession((x) => x[4] === c.wt);
      const w = m.WT[c.wt];
      return { s: s0, wt: c.wt, path: w?.path && !w.gone ? null : branchPath(c), scope: `the commit "${c.subj}"` };
    }
    case "art": {
      const a = m.ART.get(sel.key); if (!a) return null;
      const ch = (sel.v && a.changes.find((x) => x.id === sel.v)) || a.changes.filter((x) => x.cm.t >= t0w && x.cm.t <= t1w).pop() || null;
      let si = ch && ch.cm.s >= 0 ? ch.cm.s : -1, w = ch ? ch.cm.wt : -1;
      if (si < 0) {
        const fs = new Set(a.files); let hit = -1;
        for (let k = i1 - 1; k >= i0 && hit < 0; k--) if (m.CK[k] === "edit" && fs.has(m.C[k][5])) hit = k;
        for (let k = i1 - 1; k >= i0 && hit < 0; k--) if (fs.has(m.C[k][5])) hit = k;
        if (hit >= 0) { si = m.C[hit][1]; w = m.C[hit][4]; }
      }
      if (w < 0 && si >= 0) w = mainWt(si);
      let path: string | null = null;
      if (ch) path = branchPath(ch.cm); else if (a.repo && w < 0) path = m.D.projects[a.repo] ?? null;
      const wp = w >= 0 && !m.WT[w].gone ? m.WT[w].path : null;
      return { s: si, wt: w, path: wp && (!path || wp === path) ? null : path, scope: (a.repo ? a.repo + "/" : "") + a.rel + (ch ? ` as changed in "${ch.cm.subj}"` : "") };
    }
  }
  return null;
}
function command(m: Model, x: Target, msg: string): { cmd: string; note: ReactNode } {
  const S = x.s >= 0 ? m.SES[x.s] : null, w0 = x.wt >= 0 ? m.WT[x.wt] : null;
  const path = x.path ?? (w0?.path && !w0.gone ? w0.path : w0 ? m.D.projects[w0.p] ?? null : null);
  if (S?.agentId) return { cmd: "", note: `Goes to ${S.agent}, the session that did this work. It lands as a task, not as typing into the session.` };
  if (path) return {
    cmd: `scout ask --project ${shellProject(path)} --harness ${S ? S.h : "claude"} ${shq(msg)}`,
    note: (S ? `${S.name} has no Scout name${S.sub ? " (it ran as a subagent)" : " (you ran it directly)"}, so this` : "This") + ` starts a new session in ${path}. Give it the context it needs.`,
  };
  return { cmd: "", note: "Nothing to send this to: no named session and no known folder." };
}
