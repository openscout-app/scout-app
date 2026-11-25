/* Review — the Atlas: projects › worktrees › artifacts, sized by work, lit by what asks to be read. */
import { artInSpan, bsearch, callIn, cleanCmd, GROUP, SURFACE_AT, type Model, type Scope } from "./model.ts";
import { box, dprOf, fitText, sizeCanvas, snap, type Pal } from "./paint.ts";
import { isMenuClick, modsOf, PLAIN, type Mods } from "./pick.ts";

export type Show = "changes" | "images" | "docs" | "everything";
export type ANode = {
  kind: "root" | "project" | "wt" | "leaf" | "group" | "fold"; name: string; key: string; parent: ANode | null; kids: ANode[];
  v: number; n: number; e: number; rd: number; add: number; del: number; last: number; ses: Set<number>; cms: Set<string>; I: number;
  w?: number; art?: string; folded?: string[]; match?: boolean; bins?: number[]; cmds?: Map<string, number>; judge?: number;
  r: [number, number, number, number]; hd: number;
};
export type AtlasOpts = { A: number; B: number; scope: Scope; show: Show; surfaced: boolean; search: string };

const mk = (kind: ANode["kind"], name: string, parent: ANode | null, key: string): ANode =>
  ({ kind, name, key, parent, kids: [], v: 0, n: 0, e: 0, rd: 0, add: 0, del: 0, last: 0, ses: new Set(), cms: new Set(), I: 0, r: [0, 0, 0, 0], hd: 0 });

export function buildAtlas(m: Model, o: AtlasOpts): ANode {
  const root = mk("root", "All projects", null, "root");
  const pm = new Map<string, ANode>(), wm = new Map<number, ANode>(), q = o.search.trim().toLowerCase();
  const proj = (p: string) => { let n = pm.get(p); if (!n) { n = mk("project", p, root, "p:" + p); pm.set(p, n); root.kids.push(n); } return n; };
  const wtNode = (w: number) => {
    let n = wm.get(w);
    if (!n) { const p = proj(w >= 0 ? m.WT[w].p : "(no folder)"); n = mk("wt", w >= 0 ? m.WT[w].label : "unplaced", p, "w:" + w); n.w = w; n.bins = new Array(24).fill(0); wm.set(w, n); p.kids.push(n); }
    return n;
  };
  const span = Math.max(1, o.B - o.A), bin = (t: number) => Math.min(23, Math.max(0, Math.floor((t - o.A) / span * 24)));
  const spans = artInSpan(m, o.A, o.B, o.scope);
  for (const x of spans.values()) {
    const k = x.a.kind;
    if (o.show === "changes" && !x.e && !x.ch.length) continue;
    if (o.show === "images" && k !== "image") continue;
    if (o.show === "docs" && k !== "doc") continue;
    let w = -1, best = -1; for (const [ww, n] of x.wts) if (n > best) { best = n; w = ww; }
    const parent = wtNode(w), leaf = mk("leaf", x.a.base, parent, "a:" + x.a.key);
    leaf.art = x.a.key; leaf.e = x.e; leaf.rd = x.r; leaf.n = x.e + x.r; leaf.last = x.last; leaf.ses = x.ses; leaf.I = x.I;
    for (const ch of x.ch) { leaf.cms.add(ch.cm.id); leaf.add += ch.add; leaf.del += ch.del; if (ch.j) leaf.judge = Math.max(leaf.judge ?? 0, ch.j.score); }
    if (!x.ch.length) { leaf.add = x.add; leaf.del = x.del; }
    leaf.v = 1 + x.e * 2 + x.r * 0.35 + x.ch.reduce((s, ch) => s + Math.sqrt(ch.add + ch.del), 0) + (x.ch.length ? 0 : Math.sqrt(x.add + x.del) * 0.5);
    leaf.match = !!q && x.a.rel.toLowerCase().includes(q);
    parent.kids.push(leaf);
  }
  // everything: the calls that touched no file, grouped by what they were
  if (o.show === "everything") {
    for (let i = bsearch(m.CT, o.A), j = bsearch(m.CT, o.B + 1); i < j; i++) {
      const c = m.C[i]; if (c[5] >= 0) continue;
      if (!callIn(m, o.scope, c)) continue;
      const g = GROUP[m.CK[i]], parent = wtNode(c[4]), key = "g:" + c[4] + ":" + g;
      let leaf = parent.kids.find((k) => k.key === key);
      if (!leaf) { leaf = mk("group", g, parent, key); leaf.cmds = new Map(); parent.kids.push(leaf); }
      leaf.n++; leaf.v += 0.3; leaf.last = Math.max(leaf.last, c[0]); leaf.ses.add(c[1]); leaf.I = 0.05;
      const label = m.CK[i] === "command" || m.CK[i] === "search" ? cleanCmd(m.S[c[6]]) : (m.S[c[3]] || "").replace(/^mcp__\w+?__/, "");
      leaf.cmds!.set(label, (leaf.cmds!.get(label) || 0) + 1);
      leaf.match = !!q && label.toLowerCase().includes(q);
    }
  }
  // surfaced: the quieter artifacts in a worktree fold into one tile
  // Images and Docs already narrow the sheet; folding on top of them would hide what was asked for
  const fold = o.surfaced && (o.show === "changes" || o.show === "everything");
  for (const w of wm.values()) {
    if (!fold) continue;
    const quiet = w.kids.filter((k) => (k.kind === "leaf" || k.kind === "group") && k.I < SURFACE_AT && !k.match);
    if (quiet.length < 2) continue;
    const f = mk("fold", `${quiet.length} quieter`, w, "f:" + w.w);
    f.folded = quiet.filter((k) => k.art).map((k) => k.art!);
    for (const k of quiet) { f.n += k.n; f.e += k.e; f.rd += k.rd; f.add += k.add; f.del += k.del; f.last = Math.max(f.last, k.last); k.ses.forEach((s) => f.ses.add(s)); k.cms.forEach((c) => f.cms.add(c)); f.v += k.v; }
    f.v = Math.max(1, f.v * 0.22); f.I = 0;
    w.kids = w.kids.filter((k) => !quiet.includes(k)); w.kids.push(f);
  }
  // roll up, and the worktree's work over the span for its header
  const roll = (n: ANode) => {
    if (!n.kids.length) return;
    for (const k of n.kids) {
      roll(k);
      n.v += k.v; n.n += k.n; n.e += k.e; n.rd += k.rd; n.add += k.add; n.del += k.del; n.last = Math.max(n.last, k.last);
      k.ses.forEach((s) => n.ses.add(s)); k.cms.forEach((c) => n.cms.add(c)); n.I = Math.max(n.I, k.I); if (k.match) n.match = true;
    }
  };
  roll(root);
  for (const w of wm.values()) {
    for (let i = bsearch(m.CT, o.A), j = bsearch(m.CT, o.B + 1); i < j; i++) if (m.C[i][4] === w.w) w.bins![bin(m.C[i][0])]++;
    for (const id of w.cms) { const c = m.COMMITS.find((x) => x.id === id); if (c) w.bins![bin(c.t)] += 3; }
  }
  for (const p of root.kids) p.kids = p.kids.filter((w) => w.kids.length);
  root.kids = root.kids.filter((p) => p.kids.length);
  return root;
}

/* ── layout ── */
function squarify(items: { v: number; node: ANode }[], x: number, y: number, w: number, h: number) {
  const total = items.reduce((a, b) => a + b.v, 0);
  if (!total || w <= 0 || h <= 0) { for (const it of items) it.node.r = [x, y, 0, 0]; return; }
  const sc = (w * h) / total; let rest = items.map((it) => ({ node: it.node, a: it.v * sc }));
  while (rest.length) {
    const sh = Math.min(w, h); const row: typeof rest = []; let worst = Infinity, sum = 0, mx = 0, mn = Infinity;
    for (const it of rest) {
      const s2 = sum + it.a, mx2 = Math.max(mx, it.a), mn2 = Math.min(mn, it.a);
      const wv = Math.max(sh * sh * mx2 / (s2 * s2), (s2 * s2) / (sh * sh * mn2));
      if (row.length && wv > worst) break;
      row.push(it); worst = wv; sum = s2; mx = mx2; mn = mn2;
    }
    const th = sum / sh; let off = 0;
    for (const it of row) { const len = it.a / th; it.node.r = w >= h ? [x, y + off, th, len] : [x + off, y, len, th]; off += len; }
    if (w >= h) { x += th; w -= th; } else { y += th; h -= th; }
    rest = rest.slice(row.length);
  }
}
function lay(n: ANode, r: [number, number, number, number]) {
  n.r = r; if (!n.kids.length) return;
  const [x, y, w, h] = r, m = Math.min(w, h), isRoot = n.kind === "root";
  n.hd = isRoot ? 0 : m * 0.07; const p = isRoot ? 0 : m * 0.016;
  n.kids.sort((a, b) => (a.kind === "fold" ? 1 : 0) - (b.kind === "fold" ? 1 : 0) || b.v - a.v);
  squarify(n.kids.map((k) => ({ v: Math.max(k.v, 1e-6), node: k })), x + p, y + n.hd, w - 2 * p, h - n.hd - p);
  const g = isRoot ? 2.4 : m * 0.006;
  for (const k of n.kids) { const q = k.r; lay(k, [q[0] + g, q[1] + g, Math.max(0, q[2] - 2 * g), Math.max(0, q[3] - 2 * g)]); }
}

/* ── the engine ── */
export type AtlasHooks = {
  pal: () => Pal;
  /** 2 = selected, 1 = part of the selection (a commit's or a beat's files), 0 = not */
  selOf: (n: ANode) => 0 | 1 | 2;
  /** a click, with its Cmd and Shift */
  onSelect: (n: ANode | null, mods: Mods) => void;
  /** a double-click on a file: open it */
  onOpen: (n: ANode) => void;
  /** a right-click: the node under the pointer (the root on empty ground) */
  onMenu: (n: ANode, e: MouseEvent) => void;
  onFocus: (chain: ANode[]) => void;
  tip: (n: ANode | null, x: number, y: number) => void;
  hm: (t: number) => string;
  end: () => number;
  /** the URL of a file tile's picture, when it is an image this window may read; null for anything else */
  imgOf: (n: ANode) => string | null;
};
/** the longest side a tile's picture is kept at once decoded; a full screenshot held per tile would cost tens of MB each */
const THUMB_MAX = 1024;
export function createAtlas(cv: HTMLCanvasElement, wrap: HTMLElement, hooks: AtlasHooks) {
  let ctx: CanvasRenderingContext2D | null = null, W = 0, H = 0, D = 1, root: ANode | null = null, focus: ANode | null = null;
  let cam = { x: 0, y: 0, s: 1 }, anim = 0, hover: ANode | null = null, focusKey: string[] = [], wheelT: ReturnType<typeof setTimeout> | undefined, searching = false;
  const toS = (r: number[]) => [(r[0] - cam.x) * cam.s, (r[1] - cam.y) * cam.s, r[2] * cam.s, r[3] * cam.s];
  const isOpen = (n: ANode, w: number, h: number) => n.kids.length > 0 && (n.kind === "root" || (w > 54 && h > 42));
  const chain = (n: ANode) => { const a: ANode[] = []; for (let x: ANode | null = n; x; x = x.parent) a.unshift(x); return a; };
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  /* pictures: fetched the first time their tile is drawn large enough, kept as a scaled-down copy; null = could not be read */
  const pics = new Map<string, HTMLCanvasElement | "loading" | null>();
  let picFrame = 0;
  const repaintSoon = () => { if (!picFrame) picFrame = requestAnimationFrame(() => { picFrame = 0; draw(); }); };
  function picOf(url: string): HTMLCanvasElement | null {
    const p = pics.get(url);
    if (p !== undefined) return p === "loading" ? null : p;
    pics.set(url, "loading");
    const im = new Image(); im.decoding = "async";
    im.onload = () => {
      const k = Math.min(1, THUMB_MAX / Math.max(im.naturalWidth, im.naturalHeight, 1));
      const t = document.createElement("canvas"); t.width = Math.max(1, Math.round(im.naturalWidth * k)); t.height = Math.max(1, Math.round(im.naturalHeight * k));
      const tc = t.getContext("2d"); if (!tc) { pics.set(url, null); return; }
      tc.imageSmoothingQuality = "high"; tc.drawImage(im, 0, 0, t.width, t.height);
      pics.set(url, t); repaintSoon();
    };
    im.onerror = () => pics.set(url, null);
    im.src = url;
    return null;
  }
  /** a file tile's picture, fitted whole under its label */
  function picture(n: ANode, x: number, y: number, w: number, h: number) {
    if (n.kind !== "leaf" || w < 48 || h < 48) return;
    const url = hooks.imgOf(n); if (!url) return;
    const fs = clamp(Math.min(h * 0.3, w * 0.085), 8.5, 13), top = h > fs * 2 + 10 ? fs * 2 + 12 : fs + 8;
    const bx = x + 5, by = y + top, bw = w - 10, bh = h - top - 5;
    if (bw < 24 || bh < 24) return;
    const t = picOf(url); if (!t) return;
    const k = Math.min(bw / t.width, bh / t.height), dw = t.width * k, dh = t.height * k;
    const c = ctx!; c.imageSmoothingQuality = "high";
    c.drawImage(t, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
  }

  function draw() {
    if (!ctx || !W || !root) return;
    const P = hooks.pal(); ctx.fillStyle = P.panel; ctx.fillRect(0, 0, W, H);
    if (!root.kids.length) { ctx.fillStyle = P.faint; ctx.font = `11px ${P.mono}`; ctx.fillText("Nothing here in this span. Try a longer window or Everything.", 18, 28); return; }
    drawNode(root);
  }
  function drawNode(n: ANode) {
    const c = ctx!, P = hooks.pal(), [x, y, w, h] = toS(n.r);
    if (x > W || y > H || x + w < 0 || y + h < 0 || w < 1 || h < 1) return;
    const open = isOpen(n, w, h), dimmed = searching && !n.match;
    const tile = n.kind === "leaf" || n.kind === "group" || n.kind === "fold", hair = 1 / D;
    // tiles keep a clear channel to their siblings at any zoom, so two edges never sit a pixel apart
    const ins = tile && w > 12 && h > 12 ? 1 : 0;
    const bx = snap(x + ins, D), by = snap(y + ins, D), bw = snap(x + w - ins, D) - bx, bh = snap(y + h - ins, D) - by;
    if (dimmed) c.globalAlpha = 0.32;
    if (n.kind !== "root") {
      if (n.kind === "fold") {
        c.setLineDash([3, 3]); c.strokeStyle = n === hover ? P.inkA(0.42) : P.pline; box(c, bx, by, bw, bh, hair, D); c.setLineDash([]);
      } else {
        c.fillStyle = tile ? P.inkA(0.03 + 0.26 * n.I) : P.inkA(open ? 0.018 : 0.03 + 0.2 * n.I);
        c.fillRect(bx, by, bw, bh);
        // a project or worktree carries a 1px edge, a tile a hairline: nesting reads by weight, not by stacked lines
        c.strokeStyle = n === hover ? P.inkA(0.42) : tile ? P.pline : P.line;
        box(c, bx, by, bw, bh, n === hover || !tile ? 1 : hair, D);
        if (!open) picture(n, x, y, w, h);
        if (n.last >= hooks.end() - 600 && w > 12 && h > 12) { c.fillStyle = P.accent; c.fillRect(snap(bx + bw - 6, D), by, 5, 5); }
      }
      label(n, x, y, w, h, open);
    }
    if (open) for (const k of n.kids) drawNode(k);
    if (dimmed) c.globalAlpha = 1;
    const s = hooks.selOf(n);
    if (s) { c.strokeStyle = P.accent; if (s === 1) c.setLineDash([4, 3]); box(c, bx, by, bw, bh, s === 2 ? 2 : 1, D); c.setLineDash([]); c.lineWidth = 1; }
  }
  function label(n: ANode, x: number, y: number, w: number, h: number, open: boolean) {
    const c = ctx!, P = hooks.pal();
    if (open) {
      const hp = n.hd * cam.s; if (hp < 9) return;
      const fs = clamp(hp * 0.44, 8.5, 15), cy = y + hp / 2 + fs * 0.36;
      const stats = (n.cms.size ? `${n.cms.size} commit${n.cms.size === 1 ? "" : "s"} · ` : "") + `${n.e} edits · ${n.ses.size} session${n.ses.size === 1 ? "" : "s"}`;
      const sp = n.kind === "wt" && w > 380 ? Math.min(120, w * 0.2) : 0;
      c.font = `${Math.max(8.5, fs * 0.8)}px ${P.mono}`; const sw = c.measureText(stats).width;
      c.font = `${fs}px ${P.mono}`; c.fillStyle = P.ink;
      c.fillText(fitText(c, n.name, w - 16 - (w > 300 ? sw + sp + 24 : 0)), x + 7, cy);
      if (w > 300) {
        c.font = `${Math.max(8.5, fs * 0.8)}px ${P.mono}`; c.fillStyle = P.faint; c.fillText(stats, x + w - 10 - sw - (sp ? sp + 12 : 0), cy);
        if (sp && n.bins) {
          const bx = x + w - 10 - sp, bh = hp * 0.46, mxb = Math.max(1, ...n.bins), bw = sp / 24; c.fillStyle = P.inkA(0.45);
          n.bins.forEach((v, k) => { if (v) { const hh = Math.max(1, bh * v / mxb); c.fillRect(bx + k * bw, y + hp / 2 + bh / 2 - hh, Math.max(1, bw - 1), hh); } });
        }
      }
      return;
    }
    if (w < 30 || h < 12) return;
    const fs = clamp(Math.min(h * 0.3, w * 0.085), 8.5, 13);
    c.font = `${fs}px ${P.mono}`;
    c.fillStyle = n.kind === "fold" ? P.faint : n.kind === "leaf" && !n.e && !n.cms.size ? P.dim : P.ink;
    c.fillText(fitText(c, n.name, w - 12), x + 5, y + fs + 3);
    if (h > fs * 2 + 10) {
      c.font = `${Math.max(8, fs * 0.82)}px ${P.mono}`; c.fillStyle = P.faint;
      let s2 = "";
      if (n.kind === "fold") s2 = "fold: click to list";
      else if (n.kind === "group") s2 = `${n.n} calls`;
      else {
        const bits: string[] = [];
        if (n.cms.size) bits.push(`${n.cms.size} commit${n.cms.size === 1 ? "" : "s"}`);
        if (n.e) bits.push(`${n.e} edit${n.e === 1 ? "" : "s"}`);
        if (n.add || n.del) bits.push(`+${n.add} −${n.del}`);
        if (!bits.length) bits.push(`read ${n.rd}×`);
        s2 = bits.join(" · ");
      }
      c.fillText(fitText(c, s2, w - 12), x + 5, y + fs * 2 + 6);
      if (n.judge && h > fs * 3 + 14) { c.fillStyle = n.judge >= 4 ? P.ink : P.faint; c.fillText(fitText(c, `read ${n.judge} of 5`, w - 12), x + 5, y + fs * 3 + 9); }
    }
    if (n.kind === "group" && n.cmds && w > 170 && h > 74) {
      c.font = `10px ${P.mono}`; let yy = y + 54;
      for (const [k, v] of [...n.cmds.entries()].sort((a, b) => b[1] - a[1])) { if (yy > y + h - 10) break; c.fillStyle = P.faint; c.fillText("×" + v, x + 8, yy); c.fillStyle = P.dim; c.fillText(fitText(c, k, w - 60), x + 46, yy); yy += 15; }
    }
  }
  function hit(n: ANode, sx: number, sy: number): ANode | null {
    const [x, y, w, h] = toS(n.r);
    if (sx < x || sy < y || sx > x + w || sy > y + h) return null;
    if (isOpen(n, w, h)) for (const k of n.kids) { const r = hit(k, sx, sy); if (r) return r; }
    return n;
  }
  const fitCam = (n: ANode) => { const [x, y, w, h] = n.r; const s = Math.min(W / Math.max(w, 1e-3), H / Math.max(h, 1e-3)) * (n.kind === "root" ? 1 : 0.96); return { s, x: x + w / 2 - W / (2 * s), y: y + h / 2 - H / (2 * s) }; };
  function flyTo(n: ANode, instant?: boolean) { flyCam(fitCam(n), instant); }
  function flyCam(g: typeof cam, instant?: boolean, ms = 520, done?: () => void) {
    cancelAnimationFrame(anim);
    if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) { cam = g; draw(); done?.(); return; }
    const a = { ...cam }, T0 = performance.now();
    const ca = { x: a.x + W / (2 * a.s), y: a.y + H / (2 * a.s) }, cb = { x: g.x + W / (2 * g.s), y: g.y + H / (2 * g.s) };
    const step = (now: number) => {
      let k = Math.min(1, (now - T0) / ms); k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const s = Math.exp(Math.log(a.s) + (Math.log(g.s) - Math.log(a.s)) * k), cx = ca.x + (cb.x - ca.x) * k, cy = ca.y + (cb.y - ca.y) * k;
      cam = { s, x: cx - W / (2 * s), y: cy - H / (2 * s) }; draw();
      if (k < 1) anim = requestAnimationFrame(step); else done?.();
    };
    anim = requestAnimationFrame(step);
  }
  function setFocus(n: ANode, instant?: boolean) { focus = n; focusKey = chain(n).map((x) => x.key); hooks.onFocus(chain(n)); flyTo(n, instant); }
  function syncFocus() {
    if (!root) return; let n = root;
    for (;;) {
      const k = n.kids.find((k) => { const [x, y, w, h] = toS(k.r); return W / 2 >= x && W / 2 <= x + w && H / 2 >= y && H / 2 <= y + h && w * h >= 0.3 * W * H; });
      if (!k) break; n = k;
    }
    if (n !== focus) { focus = n; focusKey = chain(n).map((x) => x.key); hooks.onFocus(chain(n)); }
  }
  const find = (keys: string[]) => { if (!root) return null; let n = root; for (const k of keys.slice(1)) { const m = n.kids.find((x) => x.key === k); if (!m) break; n = m; } return n; };
  function findKey(key: string, n: ANode | null = root): ANode | null { if (!n) return null; if (n.key === key) return n; for (const k of n.kids) { const r = findKey(key, k); if (r) return r; } return null; }

  let drag: { x: number; y: number; cx: number; cy: number; live: boolean } | null = null;
  const onDown = (e: PointerEvent) => { if (isMenuClick(e)) return; cv.setPointerCapture(e.pointerId); drag = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y, live: false }; };
  const onMove = (e: PointerEvent) => {
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (!drag.live && Math.hypot(dx, dy) > 4) { drag.live = true; cancelAnimationFrame(anim); cv.style.cursor = "grabbing"; }
      if (drag.live) { cam.x = drag.cx - dx / cam.s; cam.y = drag.cy - dy / cam.s; draw(); hooks.tip(null, 0, 0); return; }
    }
    const n = root && hit(root, e.offsetX, e.offsetY);
    if (n !== hover) { hover = n; draw(); }
    cv.style.cursor = n && n.kind !== "root" ? "pointer" : "grab";
    hooks.tip(n && n.kind !== "root" ? n : null, e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => {
    const d = drag; drag = null; if (!d) return; cv.style.cursor = "grab";
    if (d.live) { syncFocus(); return; }
    const n = root && hit(root, e.offsetX, e.offsetY);
    hooks.onSelect(n && n.kind !== "root" ? n : null, modsOf(e));
  };
  const onLeave = () => { if (hover) { hover = null; draw(); } hooks.tip(null, 0, 0); };
  const onMenu = (e: MouseEvent) => { const n = root && hit(root, e.offsetX, e.offsetY); if (!n) return; hooks.tip(null, 0, 0); hooks.onMenu(n, e); };
  const onDbl = (e: MouseEvent) => {
    const n = root && hit(root, e.offsetX, e.offsetY); if (!n || !focus) return;
    // a file opens wherever it is; anything else goes in one level
    if (n.kind === "leaf") { hooks.onOpen(n); return; }
    const next = chain(n)[chain(focus).length];
    if (next) { setFocus(next); hooks.onSelect(next, PLAIN); }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); cancelAnimationFrame(anim); if (!root) return;
    const zoom = e.ctrlKey || e.metaKey || (e.deltaX === 0 && (e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY))));
    if (zoom) {
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022)), wx = cam.x + e.offsetX / cam.s, wy = cam.y + e.offsetY / cam.s;
      const s = clamp(cam.s * f, fitCam(root).s * 0.8, 6000); cam = { s, x: wx - e.offsetX / s, y: wy - e.offsetY / s };
    } else { cam.x += e.deltaX / cam.s; cam.y += e.deltaY / cam.s; }
    draw(); hooks.tip(null, 0, 0); clearTimeout(wheelT); wheelT = setTimeout(syncFocus, 160);
  };
  cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointerleave", onLeave); cv.addEventListener("dblclick", onDbl); cv.addEventListener("wheel", onWheel, { passive: false }); cv.addEventListener("contextmenu", onMenu);

  function size() { W = wrap.clientWidth; H = wrap.clientHeight; D = dprOf(); if (W && H) ctx = sizeCanvas(cv, W, H); return W > 0 && H > 0; }
  return {
    setTree(r: ANode, search: string) {
      root = r; searching = !!search.trim(); if (!size()) return;
      lay(root, [0, 0, 1000, 1000 * H / W]);
      let n = find(focusKey) ?? root;
      if (n === root && root.kids.length === 1) n = root.kids[0];
      focus = n; focusKey = chain(n).map((x) => x.key); hooks.onFocus(chain(n)); flyTo(n, true);
    },
    resize() { if (!root || !size()) return; lay(root, [0, 0, 1000, 1000 * H / W]); const n = find(focusKey) ?? root; focus = n; flyTo(n, true); },
    /** fly to the deepest node along a key path that exists */
    goTo(keys: string[]) { const n = find(["root", ...keys]); if (n) setFocus(n); },
    goToKey(key: string) { const n = findKey(key); if (n) setFocus(n.kind === "leaf" || n.kind === "group" || n.kind === "fold" ? n.parent ?? n : n); },
    up() { if (focus && focus.parent) { setFocus(focus.parent); return true; } return false; },
    /** zoom by a factor around the middle of the canvas; the focus follows what ends up in the middle */
    zoom(f: number) {
      if (!root || !W) return; hooks.tip(null, 0, 0);
      const cx = cam.x + W / (2 * cam.s), cy = cam.y + H / (2 * cam.s), s = clamp(cam.s * f, fitCam(root).s * 0.8, 6000);
      flyCam({ s, x: cx - W / (2 * s), y: cy - H / (2 * s) }, false, 200, syncFocus);
    },
    /** the focused level, whole again */
    fit() { if (focus) flyTo(focus); },
    repaint: draw,
    destroy() {
      cancelAnimationFrame(anim); cancelAnimationFrame(picFrame); pics.clear();
      cv.removeEventListener("pointerdown", onDown); cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointerleave", onLeave); cv.removeEventListener("dblclick", onDbl); cv.removeEventListener("wheel", onWheel); cv.removeEventListener("contextmenu", onMenu);
    },
  };
}
export type Atlas = ReturnType<typeof createAtlas>;
