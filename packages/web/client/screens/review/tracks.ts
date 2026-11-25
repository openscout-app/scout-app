/* Review — Tracks: a track per worktree, a lane per session, over the window. A way into the Atlas. */
import { ALL, bsearch, callIn, commitIn, dur, fmtC, type Model, type Scope } from "./model.ts";
import { box, dprOf, fitText, sizeCanvas, snap, vline, type Pal } from "./paint.ts";
import { isMenuClick, modsOf, type Mods } from "./pick.ts";

type Lane = { s: number; calls: number[]; clips: [number, number][]; marks: [string, number, string][] };
type Track = { w: number; p: string; n: number; lanes: Map<number, Lane>; last: number; over: [number, number][]; commits: { id: string; t: number }[]; y?: number };
type Row = { type: "proj"; p: string; y: number; h: number; n: number; k: number } | { type: "track"; t: Track; y: number; h: number } | { type: "lane"; t: Track; l: Lane; y: number; h: number };
/** what to light: the selection, and every pick (w:… s:… c:… keys) when there are several */
export type Hi = { art?: string; session?: number; wt?: number; commit?: string; beat?: { s: number; t0: number; t1: number }; picks?: Set<string> };
export type TrackHit = { type: "proj"; p: string } | { type: "track"; w: number } | { type: "commit"; id: string; w: number } | { type: "lane"; s: number; w: number };
export type TrackHooks = {
  pal: () => Pal;
  hi: () => Hi;
  onTrack: (w: number, mods: Mods) => void;
  onLane: (s: number, w: number, mods: Mods) => void;
  onCommit: (id: string, mods: Mods) => void;
  /** a double-click; true when the screen took it, else a track or a lane solos its worktree */
  onDouble: (hit: TrackHit) => boolean;
  onSpan: (span: [number, number] | null) => void;
  /** a right-click on a project heading, a track, a commit on a track, or a session's lane */
  onMenu: (hit: TrackHit, e: MouseEvent) => void;
  tip: (html: string | null, x: number, y: number) => void;
  esc: (s: string) => string;
  hm: (t: number) => string;
  dhm: (t: number) => string;
  ticks: (a: number, b: number) => number[];
  info: (s: string) => void;
};
const GL = 196, GR = 92, AXH = 22, TH = 20, LH = 15, PH = 24;

export function createTracks(m: Model, cv: HTMLCanvasElement, ax: HTMLCanvasElement, scroll: HTMLElement, hooks: TrackHooks) {
  let ctx: CanvasRenderingContext2D | null = null, actx: CanvasRenderingContext2D | null = null, W = 0, Ht = 0, D = 1;
  let rows: Row[] = [], t0w = 0, t1w = 0, scope: Scope = ALL, span: [number, number] | null = null, solo: number | null = null, hover: Row | null = null;
  let bd: { x: number; live: boolean } | null = null;
  const X = (t: number) => GL + (t - t0w) / Math.max(1, t1w - t0w) * (W - GL - GR);
  const Tm = (x: number) => t0w + (x - GL) / Math.max(1, W - GL - GR) * (t1w - t0w);
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  function build() {
    const tm = new Map<number, Track>();
    const track = (w: number, p: string) => { let t = tm.get(w); if (!t) tm.set(w, (t = { w, p, n: 0, lanes: new Map(), last: 0, over: [], commits: [] })); return t; };
    let n = 0;
    for (let i = bsearch(m.CT, t0w), j = bsearch(m.CT, t1w + 1); i < j; i++) {
      const c = m.C[i]; if (!callIn(m, scope, c)) continue;
      const t = track(c[4], m.projOf(c)); t.n++; t.last = Math.max(t.last, c[0]); n++;
      let l = t.lanes.get(c[1]); if (!l) t.lanes.set(c[1], (l = { s: c[1], calls: [], clips: [], marks: [] })); l.calls.push(i);
    }
    for (const c of m.COMMITS) {
      if (c.t < t0w || c.t > t1w) continue;
      if (!commitIn(m, scope, c)) continue;
      const w = m.WT[c.wt];
      const t = track(c.wt, w.p); t.commits.push({ id: c.id, t: c.t }); t.last = Math.max(t.last, c.t);
    }
    for (const t of tm.values()) {
      for (const l of t.lanes.values()) {
        let cur: [number, number] | null = null;
        for (const i of l.calls) { const tt = m.C[i][0]; if (!cur || tt - cur[1] > 480) l.clips.push((cur = [tt, tt])); else cur[1] = tt; }
        const S = m.SES[l.s];
        for (const tr of S.turns) if (tr.t >= t0w && tr.t <= t1w && m.wtAt(l.s, tr.t) === t.w) l.marks.push([tr.kind === "turn" ? "turn" : "task", tr.t, tr.text]);
        for (const a of S.asks) if (a[0] >= t0w && a[0] <= t1w && m.wtAt(l.s, a[0]) === t.w) l.marks.push(["task", a[0], m.S[a[5]]]);
        for (const e of S.errs) if (e[0] >= t0w && e[0] <= t1w && m.wtAt(l.s, e[0]) === t.w) l.marks.push(["err", e[0], e[1] + " · " + e[3]]);
      }
      const L = [...t.lanes.values()];
      for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) for (const a of L[x].clips) for (const b of L[y].clips) { const s = Math.max(a[0], b[0]), e = Math.min(a[1], b[1]); if (e - s > 30) t.over.push([s, e]); }
    }
    const pc = new Map<string, number>(); for (const t of tm.values()) pc.set(t.p, (pc.get(t.p) || 0) + t.n + t.commits.length * 20);
    let tracks = [...tm.values()].sort((a, b) => (pc.get(b.p)! - pc.get(a.p)!) || a.p.localeCompare(b.p) || b.last - a.last);
    if (solo != null && !tracks.some((t) => t.w === solo)) solo = null;
    if (solo != null) tracks = tracks.filter((t) => t.w === solo);
    rows = []; let y = 4, lastP: string | null = null;
    for (const t of tracks) {
      if (t.p !== lastP) { rows.push({ type: "proj", p: t.p, y, h: PH, n: pc.get(t.p)!, k: tracks.filter((x) => x.p === t.p).length }); y += PH; lastP = t.p; }
      rows.push({ type: "track", t, y, h: TH }); t.y = y; y += TH;
      for (const l of [...t.lanes.values()].sort((a, b) => m.C[a.calls[0]][0] - m.C[b.calls[0]][0])) { rows.push({ type: "lane", t, l, y, h: LH }); y += LH; }
      y += 6;
    }
    Ht = Math.max(y + 8, scroll.clientHeight);
    const busy = tracks.filter((t) => t.over.length).length;
    hooks.info(`${tracks.length} worktree${tracks.length === 1 ? "" : "s"} · ${fmtC(n)} calls` + (busy ? ` · ${busy} with two sessions at once` : "") + (solo != null ? " · solo: Esc returns" : ""));
  }
  const line = (c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  function draw() {
    if (!ctx || !W) return;
    const c = ctx, P = hooks.pal(), H = hooks.hi(), hair = 1 / D;
    c.fillStyle = P.panel; c.fillRect(0, 0, W, Ht); c.lineWidth = 1;
    c.strokeStyle = P.line; for (const t of hooks.ticks(t0w, t1w)) vline(c, X(t), 0, Ht, hair, D);
    if (span) { const a = X(span[0]), b = X(span[1]); c.fillStyle = P.accentSoft; c.fillRect(a, 0, Math.max(2, b - a), Ht); c.strokeStyle = P.accentDim; box(c, a, 0, Math.max(2, b - a), Ht, 1, D); }
    for (const r of rows) {
      if (r.type === "proj") {
        c.fillStyle = P.faint; c.font = `10px ${P.mono}`;
        c.fillText(`${r.p.toUpperCase()}   ${r.k} WORKTREE${r.k === 1 ? "" : "S"}`, 12, r.y + 16);
        c.strokeStyle = P.pline; c.lineWidth = 1; line(c, 0, r.y + PH - 0.5, W, r.y + PH - 0.5);
      } else if (r.type === "track") {
        const t = r.t, sel = H.wt === t.w || !!H.picks?.has("w:" + t.w);
        c.fillStyle = sel ? P.accentSoft : P.inkA(0.03); c.fillRect(0, r.y, W, r.h);
        if (sel) { c.fillStyle = P.accent; c.fillRect(0, r.y, 3, r.h); }
        c.font = `11px ${P.mono}`; c.fillStyle = P.ink; c.fillText(fitText(c, t.w >= 0 ? m.WT[t.w].label : "unplaced", GL - 22), 12, r.y + 14);
        c.fillStyle = P.accent; for (const [a, b] of t.over) c.fillRect(X(a), r.y + r.h - 3, Math.max(2, X(b) - X(a)), 2);
        for (const cm of t.commits) {
          const x = Math.round(X(cm.t)), on = H.commit === cm.id || !!H.picks?.has("c:" + cm.id);
          c.fillStyle = on ? P.accent : P.ink; c.beginPath(); c.moveTo(x, r.y + 4); c.lineTo(x + 4.5, r.y + 10); c.lineTo(x, r.y + 16); c.lineTo(x - 4.5, r.y + 10); c.closePath(); c.fill();
        }
        const quiet = t1w - t.last; c.font = `10px ${P.mono}`; c.fillStyle = quiet < 300 ? P.accent : P.faint;
        c.fillText(quiet < 300 ? "active" : "quiet " + dur(quiet), W - GR + 10, r.y + 14);
      } else {
        const { t, l } = r, selL = H.session === l.s || !!H.picks?.has("s:" + l.s), hov = hover === r;
        if (selL || hov) { c.fillStyle = selL ? P.accentSoft : P.inkA(0.025); c.fillRect(0, r.y, W, r.h); }
        if (selL) { c.fillStyle = P.accent; c.fillRect(0, r.y, 3, r.h); }
        c.font = `10px ${P.mono}`; c.fillStyle = selL ? P.ink : P.dim; c.fillText(fitText(c, m.SES[l.s].short, GL - 36), 26, r.y + 11);
        // a burst of calls is a quiet band with no edge of its own: the ticks inside it are the only lines
        c.fillStyle = P.inkA(0.07);
        for (const [a, b] of l.clips) { const x = snap(X(a), D); c.fillRect(x, r.y + 3, Math.max(3, snap(X(b), D) - x), r.h - 6); }
        if (H.beat && H.beat.s === l.s && m.wtAt(l.s, H.beat.t0) === t.w) { const a = X(H.beat.t0), b = X(H.beat.t1); c.strokeStyle = P.accent; box(c, a - 2, r.y + 1, Math.max(5, b - a + 4), r.h - 2, 1, D); c.lineWidth = 1; }
        for (const i of l.calls) {
          const k = m.CK[i], x = X(m.C[i][0]), mid = r.y + r.h / 2, f = m.C[i][5];
          const lit = !!H.art && f >= 0 && m.FILES[f].key === H.art;
          if (lit) { c.strokeStyle = P.accent; vline(c, x - 0.5, r.y + 1, r.y + r.h - 1, 1.5, D); continue; }
          // device-pixel hairlines: a dense run stays a run of ticks instead of fusing into a bar
          if (k === "edit") { c.strokeStyle = P.inkA(0.82); vline(c, x, r.y + 2, r.y + r.h - 2, hair, D); }
          else if (k === "read") { c.strokeStyle = P.inkA(0.4); vline(c, x, mid - 2.5, mid + 2.5, hair, D); }
          else { c.fillStyle = P.inkA(0.3); c.fillRect(snap(x, D) - 0.5, mid - 0.5, 1.5, 1.5); }
        }
        for (const [kind, t, ] of l.marks) {
          const x = X(t), y = r.y;
          if (kind === "turn") { c.fillStyle = P.accent; c.beginPath(); c.moveTo(x - 3.5, y); c.lineTo(x + 3.5, y); c.lineTo(x, y + 5); c.fill(); }
          else if (kind === "task") { c.fillStyle = P.accent; c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x + 6, y + r.h / 2); c.lineTo(x, y + r.h - 2); c.fill(); }
          else { c.strokeStyle = P.ink; c.lineWidth = 1; line(c, x - 2.5, y + 2, x + 2.5, y + 7); line(c, x + 2.5, y + 2, x - 2.5, y + 7); }
        }
      }
    }
    drawAxis();
  }
  function drawAxis() {
    if (!actx) return;
    const c = actx, P = hooks.pal(); c.fillStyle = P.panel; c.fillRect(0, 0, W, AXH);
    c.strokeStyle = P.line; c.beginPath(); c.moveTo(0, AXH - 0.5); c.lineTo(W, AXH - 0.5); c.stroke();
    c.font = `10px ${P.mono}`; c.fillStyle = P.faint;
    for (const t of hooks.ticks(t0w, t1w)) {
      const x = X(t); c.fillRect(Math.round(x), AXH - 5, 1, 5);
      const s = t1w - t0w > 86400 ? hooks.dhm(t) : hooks.hm(t), w = c.measureText(s).width;
      if (x - w / 2 > GL - 6 && x + w / 2 < W - GR + 4) c.fillText(s, x - w / 2, 13);
    }
    c.fillStyle = P.dim; c.fillText(hooks.dhm(t0w), 12, 13);
    if (span) { c.fillStyle = P.accent; c.fillRect(Math.round(X(span[0])), AXH - 3, Math.max(2, Math.round(X(span[1]) - X(span[0]))), 2); }
  }
  const rowAt = (y: number) => rows.find((r) => y >= r.y && y < r.y + r.h) ?? null;
  const nearest = (list: number[], t: number, px: number) => { let best: number | null = null, bd = px; for (const i of list) { const d = Math.abs(X(m.C[i][0]) - X(t)); if (d < bd) { bd = d; best = i; } } return best; };
  const commitAt = (t: Track, x: number) => t.commits.find((c) => Math.abs(X(c.t) - x) < 6) ?? null;
  const onDown = (e: PointerEvent) => { if (isMenuClick(e)) return; cv.setPointerCapture(e.pointerId); bd = { x: e.offsetX, live: false }; };
  const onMove = (e: PointerEvent) => {
    const x = e.offsetX, y = e.offsetY, esc = hooks.esc;
    if (bd) {
      if (!bd.live && Math.abs(x - bd.x) > 5 && bd.x > GL) bd.live = true;
      if (bd.live) { const a = clamp(Math.min(bd.x, x), GL, W - GR), b = clamp(Math.max(bd.x, x), GL, W - GR); span = [Tm(a), Tm(b)]; draw(); hooks.tip(null, 0, 0); return; }
    }
    const r = rowAt(y), was = hover; hover = r;
    if (was !== r && (was?.type === "lane" || r?.type === "lane")) draw();
    if (!r) { hooks.tip(null, 0, 0); return; }
    if (r.type === "lane" && x > GL && x < W - GR) {
      const t = Tm(x), i = nearest(r.l.calls, t, 6), mk = r.l.marks.find((q) => Math.abs(X(q[1]) - x) < 5);
      if (mk) hooks.tip(`<b>${mk[0] === "turn" ? "your turn" : mk[0] === "err" ? "failed" : "task"}</b> · ${hooks.hm(mk[1])}\n${esc(mk[2].slice(0, 240))}`, e.clientX, e.clientY);
      else if (i != null) { const c = m.C[i], f = c[5]; hooks.tip(`<b>${hooks.hm(c[0])}</b> · ${m.CK[i]} · ${esc(m.S[c[3]])}\n${esc(f >= 0 ? m.FILES[f].rel : m.S[c[6]])}${m.CK[i] === "edit" ? `  +${c[7]} −${c[8]}` : ""}\n<span class="d">${esc(m.SES[c[1]].name)}</span>`, e.clientX, e.clientY); }
      else hooks.tip(`<b>${esc(m.SES[r.l.s].name)}</b>\n<span class="d">${esc(m.SES[r.l.s].title.slice(0, 160))}</span>`, e.clientX, e.clientY);
    } else if (r.type === "track") {
      const cm = commitAt(r.t, x);
      if (cm) { const c = m.COMMITS.find((q) => q.id === cm.id)!; hooks.tip(`<b>commit</b> · ${hooks.hm(c.t)}\n${esc(c.subj)}\n<span class="d">${c.changes.length} file${c.changes.length === 1 ? "" : "s"}${c.s >= 0 ? " · " + esc(m.SES[c.s].short) : " · a session outside this record"}</span>`, e.clientX, e.clientY); }
      else { const t = r.t; hooks.tip(`<b>${esc(t.w >= 0 ? m.WT[t.w].label : "unplaced")}</b>${t.w >= 0 && m.WT[t.w].path ? "\n<span class='d'>" + esc(m.WT[t.w].path!) + "</span>" : ""}\n${fmtC(t.n)} calls · ${t.lanes.size} session${t.lanes.size === 1 ? "" : "s"} · ${t.commits.length} commit${t.commits.length === 1 ? "" : "s"}\n<span class="d">click: open it in the Atlas · double-click: solo</span>`, e.clientX, e.clientY); }
    } else hooks.tip(null, 0, 0);
  };
  const onUp = (e: PointerEvent) => {
    const d = bd; bd = null; if (!d) return;
    if (d.live) { hooks.onSpan(span); return; }
    const r = rowAt(e.offsetY);
    if (!r || r.type === "proj") return;
    const mods = modsOf(e);
    if (r.type === "lane") hooks.onLane(r.l.s, r.t.w, mods);
    else { const cm = commitAt(r.t, e.offsetX); if (cm) hooks.onCommit(cm.id, mods); else hooks.onTrack(r.t.w, mods); }
  };
  const onLeave = () => { hooks.tip(null, 0, 0); if (hover) { hover = null; draw(); } };
  const onMenu = (e: MouseEvent) => {
    const r = rowAt(e.offsetY); if (!r) return; hooks.tip(null, 0, 0);
    if (r.type === "proj") return hooks.onMenu({ type: "proj", p: r.p }, e);
    if (r.type === "lane") return hooks.onMenu({ type: "lane", s: r.l.s, w: r.t.w }, e);
    const cm = commitAt(r.t, e.offsetX);
    hooks.onMenu(cm ? { type: "commit", id: cm.id, w: r.t.w } : { type: "track", w: r.t.w }, e);
  };
  const onDbl = (e: MouseEvent) => {
    const r = rowAt(e.offsetY); if (!r || r.type === "proj") return;
    const cm = r.type === "track" ? commitAt(r.t, e.offsetX) : null;
    if (hooks.onDouble(r.type === "lane" ? { type: "lane", s: r.l.s, w: r.t.w } : cm ? { type: "commit", id: cm.id, w: r.t.w } : { type: "track", w: r.t.w })) return;
    solo = solo === r.t.w ? null : r.t.w; build(); resize();
  };
  cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointerleave", onLeave); cv.addEventListener("dblclick", onDbl); cv.addEventListener("contextmenu", onMenu);
  function resize() { W = scroll.clientWidth; D = dprOf(); if (!W) return; actx = sizeCanvas(ax, W, AXH); ctx = sizeCanvas(cv, W, Ht); draw(); }
  return {
    set(a: number, b: number, sc: Scope, s: [number, number] | null) { t0w = a; t1w = b; scope = sc; span = s; W = scroll.clientWidth; if (!W) return; build(); resize(); },
    setSpan(s: [number, number] | null) { span = s; draw(); },
    /** scroll a worktree's track into view */
    reveal(w: number) { const r = rows.find((x) => x.type === "track" && x.t.w === w); if (r) scroll.scrollTo({ top: Math.max(0, r.y - 30), behavior: "smooth" }); },
    unsolo() { if (solo == null) return false; solo = null; build(); resize(); return true; },
    /** the tracks and lanes top to bottom, as pick keys, for a Shift run */
    order(): string[] { return [...new Set(rows.flatMap((r) => (r.type === "track" ? ["w:" + r.t.w] : r.type === "lane" ? ["s:" + r.l.s] : [])))]; },
    resize, repaint: draw,
    destroy() { cv.removeEventListener("pointerdown", onDown); cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerup", onUp); cv.removeEventListener("pointerleave", onLeave); cv.removeEventListener("dblclick", onDbl); cv.removeEventListener("contextmenu", onMenu); },
  };
}
export type Tracks = ReturnType<typeof createTracks>;
