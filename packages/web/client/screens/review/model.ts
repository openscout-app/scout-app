/* Review — the model, built in the browser from GET /api/ops/review (server/review-window.ts). */
import { kindOfPath, splitArtKey, type ReviewAsk, type ReviewChange, type ReviewCommit, type ReviewCurrent, type ReviewData, type ReviewJudge } from "../../../shared/review-window.ts";

export type Data = ReviewData;
export type Current = ReviewCurrent;
export type Judge = ReviewJudge;
type RawCommit = ReviewCommit;
type RawChange = ReviewChange;
type RawAsk = ReviewAsk;

/** a worktree; `gone` when its folder no longer exists, so a new session goes to the project instead */
export type Wt = { i: number; p: string; w: string; label: string; path: string | null; gone: boolean };
export type FileRow = { i: number; p: string; w: number; rel: string; base: string; key: string };
export type Turn = { t: number; kind: "turn" | "message" | "brief" | "task"; text: string; desc?: boolean };
export type Ses = {
  i: number; sid: string; h: string; agent: string | null; agentId: string | null; sub: boolean; name: string; short: string;
  turns: Turn[]; colds: [number, number][]; errs: [number, string, string, string][];
  calls: number[]; callT: number[]; asks: RawAsk[]; title: string;
};
export type Commit = RawCommit & { wt: number; changes: Change[] };
export type Change = RawChange & { cm: Commit; I: number };
export type Art = { key: string; repo: string | null; rel: string; base: string; dir: string; kind: string; files: number[]; changes: Change[]; cur?: Current };
export type Beat = {
  id: string; s: number; t0: number; t1: number; calls: number[]; opener: Turn | null; wt: number;
  e: number; r: number; add: number; del: number; arts: { key: string; e: number; r: number }[];
  errs: [number, string, string, string][]; failed: number; openTask: boolean;
};

const KL: Record<string, string> = { r: "read", c: "command", s: "search", b: "browser", w: "web", a: "agent", o: "other" };
export const GROUP: Record<string, string> = { command: "commands", search: "searches", browser: "browser", web: "web", agent: "asks and agents", other: "other tools", read: "reads", edit: "edits" };
const clean = (t: string) => {
  t = (t || "").replace(/^\[Image[^\]]*\]\s*/i, "").replace(/^#+\s*\w+\s*/, "").replace(/\s+/g, " ").trim();
  for (let k = 0; k < 5; k++) t = t.replace(/^(hey|uh+|um+|so|okay|ok|yeah|alright|and|but)[,.!\s]+/i, "");
  t = t.replace(/\b(uh+|um+)[,]?\s+/gi, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const MSG = /^Another Claude session sent a message[^:]*:\s*(<agent-message[^>]*>)?\s*(\[Subagent hand-back\]\s*)?/i;
function turnOf(t: number, raw: string, sub: boolean, first: boolean): Turn {
  // the source keeps 140 characters of a turn, so a hand-back never reaches its report
  if (MSG.test(raw)) return /\[Subagent hand-back\]/.test(raw) ? { t, kind: "message", text: "Report back from a subagent", desc: true } : { t, kind: "message", text: clean(raw.replace(MSG, "")) };
  if (sub) return { t, kind: first ? "brief" : "message", text: clean(raw) };
  return { t, kind: "turn", text: clean(raw) };
}
export const bsearch = (arr: number[], t: number) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; };

/** How much a change asks to be read: the judge's score where it read the diff, else the diff's shape. */
export const changeInterest = (x: { shape: number; j?: Judge }) => (x.j ? 0.75 * (x.j.score - 1) / 4 + 0.25 * x.shape : x.shape * 0.85);
export const SURFACE_AT = 0.42;

export type Model = ReturnType<typeof buildModel>;
export function buildModel(D: Data) {
  const S = D.strs, C = D.calls, K = D.kinds, END = Math.round((D.now - D.from) / 1000);
  const CT = C.map((c) => c[0]);
  const CK = C.map((c) => { const k = K[c[2]]; if (k === "e") return c[5] >= 0 ? "edit" : /scout__ask|^Agent$|Subagent/.test(S[c[3]]) ? "agent" : "other"; return KL[k] || "other"; });
  const WT: Wt[] = D.wts.map(([p, w, path, gone], i) => ({ i, p, w, label: w === "main" ? p + " (main)" : w, path: path || null, gone: gone === 1 }));
  const mainOf = (p: string) => { const i = WT.findIndex((x) => x.p === p && x.w === "main"); if (i >= 0) return i; WT.push({ i: WT.length, p, w: "main", label: p + " (main)", path: D.projects[p] ?? null, gone: false }); return WT.length - 1; };
  const FILES: FileRow[] = D.files.map(([si, w, ki], i) => {
    const p = S[si], root = w >= 0 && WT[w].path, rel = root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
    return { i, p, w, rel, base: rel.slice(rel.lastIndexOf("/") + 1), key: S[ki] };
  });
  const ACT = D.actors.map(([name, kind, , , id]) => ({ name, kind, id: id || null }));

  const SES: Ses[] = D.sessions.map((s, i) => {
    const agent = s.agent >= 0 ? ACT[s.agent]?.name ?? null : null, agentId = s.agent >= 0 ? ACT[s.agent]?.id ?? null : null, sub = s.sid.startsWith("agent-");
    const name = agent || (sub ? "subagent " + s.sid.slice(6) : "session " + s.sid);
    return {
      i, sid: s.sid, h: s.h, agent, agentId, sub, name, short: agent ? agent.replace(/^(scout-app|scout)-/, "") : name,
      turns: s.turns.map(([t, x], k) => turnOf(t, S[x], sub, k === 0)), colds: s.colds,
      errs: s.errs.map(([t, a, b, c]) => [t, S[a], S[b], S[c]] as [number, string, string, string]),
      calls: [], callT: [], asks: [], title: "",
    };
  });
  C.forEach((c, i) => { SES[c[1]]?.calls.push(i); SES[c[1]]?.callT.push(c[0]); });
  for (const a of D.asks) if (a[8] >= 0 && SES[a[8]]) SES[a[8]].asks.push(a);
  for (const s of SES) s.title = s.turns.length ? s.turns[0].text : s.asks.length ? S[s.asks[0][5]] : "";

  /* commits and their changes; a commit sits in the worktree it was made in (the server places every one) */
  const COMMITS: Commit[] = D.commits.map((c) => ({ ...c, changes: [], wt: c.w >= 0 ? c.w : mainOf(c.repo) }));
  const CM = new Map(COMMITS.map((c) => [c.id, c]));
  const CHANGES: Change[] = [];
  for (const x of D.changes) { const cm = CM.get(x.c); if (!cm) continue; const ch: Change = { ...x, cm, I: changeInterest(x) }; cm.changes.push(ch); CHANGES.push(ch); }

  /* artifacts: every file the window touched or committed, keyed across worktrees */
  const ART = new Map<string, Art>();
  const art = (key: string) => {
    let a = ART.get(key);
    if (!a) {
      const k = splitArtKey(key), rel = k.repo ? k.rel : key;
      const cut = rel.lastIndexOf("/");
      a = { key, repo: k.repo, rel, base: rel.slice(cut + 1), dir: cut >= 0 ? rel.slice(0, cut + 1) : "", kind: kindOfPath(rel), files: [], changes: [], cur: D.current[key] };
      ART.set(key, a);
    }
    return a;
  };
  for (const f of FILES) art(f.key).files.push(f.i);
  for (const x of CHANGES) art(x.key).changes.push(x);
  for (const a of ART.values()) a.changes.sort((p, q) => p.cm.t - q.cm.t);

  /* beats: a stretch of one session's work, opened by what was said to it */
  const wtAt = (s: number, t: number) => {
    const ses = SES[s], T = ses.callT, k = bsearch(T, t);
    if (k < T.length && T[k] - t <= 900) return C[ses.calls[k]][4];
    if (k > 0 && t - T[k - 1] <= 120) return C[ses.calls[k - 1]][4];
    return null;
  };
  const BEATS: Beat[] = [];
  for (const s of SES) {
    const bounds: Turn[] = [...s.turns, ...s.asks.map((a) => ({ t: a[0], kind: "task" as const, text: S[a[5]] }))].sort((a, b) => a.t - b.t);
    let cur: Beat | null = null, bi = 0, prevT = -Infinity;
    for (const i of s.calls) {
      const t = C[i][0]; let opener: Turn | null = null;
      while (bi < bounds.length && bounds[bi].t <= t) { const b = bounds[bi++]; if (b.t > prevT && t - b.t <= 1800) opener = b; }
      if (!cur || t - prevT > 900 || opener || C[i][4] !== C[cur.calls[cur.calls.length - 1]][4]) {
        cur = { id: s.sid + "@" + t + ":" + i, s: s.i, t0: t, t1: t, calls: [], opener, wt: -1, e: 0, r: 0, add: 0, del: 0, arts: [], errs: [], failed: 0, openTask: false };
        BEATS.push(cur);
      }
      cur.calls.push(i); cur.t1 = t; prevT = t;
    }
  }
  for (const b of BEATS) {
    const s = SES[b.s], wm = new Map<number, number>(), am = new Map<string, { key: string; e: number; r: number }>();
    for (const i of b.calls) {
      const c = C[i]; wm.set(c[4], (wm.get(c[4]) || 0) + 1);
      if (CK[i] === "edit") { b.e++; b.add += c[7]; b.del += c[8]; } else if (CK[i] === "read") b.r++;
      if (c[5] >= 0) { const k = FILES[c[5]].key; let f = am.get(k); if (!f) am.set(k, (f = { key: k, e: 0, r: 0 })); CK[i] === "edit" ? f.e++ : f.r++; }
    }
    let wn = 0; for (const [w, n] of wm) if (w >= 0 && n > wn) { b.wt = w; wn = n; }
    b.arts = [...am.values()].sort((x, y) => (y.e * 2 + y.r) - (x.e * 2 + x.r));
    b.errs = s.errs.filter((e) => e[0] >= b.t0 - 5 && e[0] <= b.t1 + 5);
    b.failed = s.asks.filter((a) => a[2] === "f" && a[1] >= b.t0 && a[1] <= b.t1 + 60).length;
    b.openTask = s.asks.some((a) => a[0] <= b.t1 && a[0] >= b.t0 - 1800 && (a[1] < 0 || a[1] > END) && a[2] !== "f");
  }
  BEATS.sort((a, b) => a.t0 - b.t0);

  const currentCopies = new Map<string, Map<number, Current>>();
  for (const [key, cur] of Object.entries(D.currentByWorktree ?? {})) {
    const [artifact, w] = JSON.parse(key) as [string, number];
    let copies = currentCopies.get(artifact);
    if (!copies) currentCopies.set(artifact, (copies = new Map()));
    copies.set(w, cur);
  }
  const sessionWorktrees = new Map<number, Set<number>>();
  for (const c of C) {
    let ws = sessionWorktrees.get(c[1]);
    if (!ws) sessionWorktrees.set(c[1], (ws = new Set()));
    ws.add(c[4]);
  }
  for (const c of COMMITS) if (c.s >= 0) {
    let ws = sessionWorktrees.get(c.s);
    if (!ws) sessionWorktrees.set(c.s, (ws = new Set()));
    ws.add(c.wt);
  }
  return { currentCopies, sessionWorktrees, D, S, C, CT, CK, END, WT, FILES, SES, mainOf, COMMITS, CHANGES, ART, BEATS, wtAt, projOf: (c: number[]) => (c[4] >= 0 ? WT[c[4]].p : "(no folder)") };
}

/* ── what the window is narrowed to ── */
/** Everything reads the scope: the Atlas, Tracks, the rail and the counts. A project scope is the PROJECT filter; a worktree or a session is a focus. */
/** What the window is narrowed to. `many` is a multi-selection's focus: anything in any of its parts. */
export type One = { kind: "project"; p: string } | { kind: "wt"; w: number } | { kind: "session"; s: number };
export type Scope = { kind: "all" } | One | { kind: "many"; parts: One[] };
export const ALL: Scope = { kind: "all" };
/** one part stays itself; several become a union */
export const unionOf = (parts: One[]): Scope => (parts.length === 0 ? ALL : parts.length === 1 ? parts[0] : { kind: "many", parts });
export function callIn(m: Model, sc: Scope, c: number[]): boolean {
  switch (sc.kind) {
    case "all": return true;
    case "project": return m.projOf(c) === sc.p;
    case "wt": return c[4] === sc.w;
    case "session": return c[1] === sc.s;
    case "many": return sc.parts.some((x) => callIn(m, x, c));
  }
}
export function commitIn(m: Model, sc: Scope, c: Commit): boolean {
  switch (sc.kind) {
    case "all": return true;
    case "project": return c.repo === sc.p || m.WT[c.wt]?.p === sc.p;
    case "wt": return c.wt === sc.w;
    case "session": return c.s === sc.s;
    case "many": return sc.parts.some((x) => commitIn(m, x, c));
  }
}
export function beatIn(m: Model, sc: Scope, b: Beat): boolean {
  switch (sc.kind) {
    case "all": return true;
    case "project": return (b.wt >= 0 ? m.WT[b.wt].p : "(no folder)") === sc.p;
    case "wt": return b.wt === sc.w;
    case "session": return b.s === sc.s;
    case "many": return sc.parts.some((x) => beatIn(m, x, b));
  }
}
/** the name a scope goes by in the banner and the breadcrumb */
export function scopeName(m: Model, sc: Scope): string {
  switch (sc.kind) {
    case "all": return "All projects";
    case "project": return sc.p;
    case "wt": return sc.w >= 0 ? m.WT[sc.w].label : "unplaced";
    case "session": return m.SES[sc.s].name;
    case "many": {
      const names = sc.parts.map((x) => scopeName(m, x));
      return names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ");
    }
  }
}

/* ── what one artifact did in a span ── */
export type ArtSpan = { a: Art; e: number; r: number; add: number; del: number; last: number; ch: Change[]; I: number; ses: Set<number>; wts: Map<number, number> };
export function artInSpan(m: Model, A: number, B: number, scope: Scope): Map<string, ArtSpan> {
  const out = new Map<string, ArtSpan>();
  const get = (a: Art) => { let x = out.get(a.key); if (!x) out.set(a.key, (x = { a: scopedArt(m, a, scope), e: 0, r: 0, add: 0, del: 0, last: 0, ch: [], I: 0, ses: new Set(), wts: new Map() })); return x; };
  for (let i = bsearch(m.CT, A), j = bsearch(m.CT, B + 1); i < j; i++) {
    const c = m.C[i]; if (c[5] < 0) continue;
    if (!callIn(m, scope, c)) continue;
    const a = m.ART.get(m.FILES[c[5]].key); if (!a) continue;
    const x = get(a);
    if (m.CK[i] === "edit") { x.e++; x.add += c[7]; x.del += c[8]; } else x.r++;
    x.last = Math.max(x.last, c[0]); x.ses.add(c[1]);
    if (c[4] >= 0) x.wts.set(c[4], (x.wts.get(c[4]) || 0) + 1);
  }
  for (const ch of m.CHANGES) {
    if (ch.cm.t < A || ch.cm.t > B) continue;
    if (!commitIn(m, scope, ch.cm)) continue;
    const x = get(m.ART.get(ch.key)!);
    x.ch.push(ch); x.last = Math.max(x.last, ch.cm.t);
    x.wts.set(ch.cm.wt, (x.wts.get(ch.cm.wt) || 0) + 3);
    if (ch.cm.s >= 0) x.ses.add(ch.cm.s);
  }
  for (const x of out.values()) {
    const k = x.a.kind;
    let I = 0;
    for (const ch of x.ch) I = Math.max(I, ch.I);
    if (!x.ch.length) {
      if (x.e) I = k === "image" ? 0.46 : k === "doc" ? 0.5 : k === "generated" ? 0.02 : 0.24 + 0.22 * Math.min(1, Math.log1p(x.add + x.del) / Math.log1p(300));
      else I = k === "image" ? 0.3 : k === "doc" ? 0.2 : 0.06;
    }
    x.I = I;
  }
  return out;
}

/* ── formatting ── */
const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function clock(m: Model) {
  const at = (s: number) => new Date(m.D.from + s * 1000);
  const hm = (s: number) => { const d = at(s); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const dhm = (s: number) => DAYS[at(s).getDay()] + " " + hm(s);
  const ticks = (a: number, b: number) => {
    const span = b - a, step = span <= 2400 ? 300 : span <= 5 * 3600 ? 1800 : span <= 26 * 3600 ? 3 * 3600 : 6 * 3600;
    const off = m.D.from / 1000 - new Date(m.D.from).getTimezoneOffset() * 60, out: number[] = [];
    for (let L = Math.ceil((off + a) / step) * step; L - off <= b; L += step) out.push(L - off);
    return out;
  };
  return { at, hm, dhm, ticks, day: (s: number) => DAYS[at(s).getDay()] };
}
export const dur = (s: number) => s < 60 ? Math.max(1, Math.round(s)) + "s" : s < 3600 ? Math.round(s / 60) + "m" : (s < 36000 ? (s / 3600).toFixed(1) : Math.round(s / 3600)) + "h";
export const fmtC = (n: number) => Number(n).toLocaleString("en-US");
export const cleanCmd = (s: string) => (s || "").replace(/^cd\s+\S+\s*(&&|;)\s*/, "").replace(/^(\w+=\S*\s*(;|&&)?\s+)+/, "").replace(/\s+/g, " ").trim().slice(0, 64) || "(command)";

/** Resolve Now only within the focus; never substitute another worktree's source. */
export function scopedArt(m: Model, a: Art, scope: Scope): Art {
  if (scope.kind === "all" || scope.kind === "project") return a;
  const copies = m.currentCopies.get(a.key);
  if (scope.kind === "wt") return { ...a, cur: copies?.get(scope.w) };
  const inScope = (sc: Scope, w: number): boolean => {
    switch (sc.kind) {
      case "all": return true;
      case "wt": return sc.w === w;
      case "project": return m.WT[w]?.p === sc.p;
      case "session": return m.sessionWorktrees.get(sc.s)?.has(w) ?? false;
      case "many": return sc.parts.some((part) => inScope(part, w));
    }
  };
  const cur = copies && [...copies].find(([w]) => inScope(scope, w))?.[1];
  return { ...a, cur };
}
export const shellQuote = (x: string) => "'" + x.replace(/'/g, "'\\''") + "'";
export const shellProject = (x: string) => x.startsWith("~/") ? "~/" + shellQuote(x.slice(2)) : shellQuote(x);
