// @ts-nocheck
/*
 * World · Modale engine. Imperative by design: one WebGL point cloud, one 2D
 * overlay canvas, and DOM panels painted by hand at ~7 Hz. Ported from the
 * standalone HTML study; mountWorld() owns every listener, timer and GL
 * resource it creates and returns a disposer.
 */
import { listTooltipTop } from "./list-tooltip.ts";
import { buildFindIndex, findResults, type WorldTarget } from "./find.ts";
import { rhythmTime, rhythmCurrent } from "./rhythm.ts";
import { recentFiles } from "./recent-files.ts";
import * as THREE from "three";
import { mountFileView } from "./files.tsx";
import { STYLES, THEMES, accentPaint, appMode, isStyle, isTheme, nextStyle, nextTheme, resolveAccent, resolveStyle, resolveThemeId, rgba as hexA, storeStylePick, storeThemePick } from "./theme.ts";
import { STUCK_DEFAULT, STUCK_CHOICES, STALE_DEFAULT, parseStuck, parseStuckArgs, stuckLabel as stuckLbl, stuckable, isStuck, isStale, isWorking, isFailed, isReconciled, isUndeliverable, stuckBuckets } from "./trouble.ts";
import { COMMANDS, CMD_LINE, GESTURES, KEYMAP, SCOPE_NAME, commandFor, keySig, paletteRows, parseLine, sheetRows, stripFor } from "./commands.ts";
import { CAT_LABEL, pickRecap, recapTour } from "./recap.ts";
import { buildSlots, topSlots } from "./slots.ts";
import { NO_ROSTER, rosterLabelFor, rosterLabels, rosterNameHit } from "./roster-names.ts";
import { VERBS, TRACED, VERB_KEY, VERB_LABEL, ROUTE_LABEL, routeOf, inferVerb, landsOf, silentRule, payloadFor, canSend, groupFrame, answerFrozen, jevFramePayload, modeLine, plainWhy } from "./opcenter.ts";
import { parseTour, parseRate, rateLabel, parseFly, RUNGS, parseRung, windowSpan, foldLevel, FOLD_BLURB, spanLabel } from "./tour.ts";

// slots: optional seam for a host to take the two side columns into its own panels (the composed World view,
// screens/views/modules/world-*; the full /ops/world screen leaves them in the frame)
export type WorldSlots = { attach(side: "left" | "right", node: HTMLElement | null): void;
  /** something opened in that column (inspect, a preview): the host shows it. Without it the shell's inspector is asked */
  reveal?(side: "left" | "right"): void };
export type WorldSource = "week" | "live" | "otlp";
export type WorldRestore = { playhead?: number; playing?: boolean; speed?: number; rate?: number; direction?: number; slicing?: boolean; sliceInspector?: boolean; view?: string; rung?: number; cam?: unknown; follow?: boolean } | null;
export type WorldOptions = { onSelect?: (target: WorldTarget | null) => void; operator?: string; api?: string; slots?: WorldSlots; onFreeText?: (text: string) => void;
  /** :tell <question> — the host answers it out loud (voice.tsx → /api/ops/world-ask) */
  onAsk?: (text: string) => void;
  // live (world-live.ts): which source this mount shows, how to switch, what to carry across a remount, when to re-seed
  source?: WorldSource; onSource?: (source: WorldSource, state: WorldState) => void; restore?: WorldRestore; live?: { reseed?: () => void }; otlpEndpoint?: string;
  /** A wider window can need more history than the host loaded. True means a new snapshot is coming. */
  onWindow?: (rung: number, window: string) => boolean;
  /** true: the host takes this key (another panel has focus, a grid panel's own keys); the HUD leaves it alone */
  keyGate?: (e: KeyboardEvent) => boolean;
  /** the DATA chip: the host switches to the team (true) or the week. Without it the page reloads with ?data= flipped */
  onData?: (team: boolean) => void;
  /** false: theme and accent picks stay off the page's ?theme= / ?accent= (a HUD drawn off its own route) */
  urlParams?: boolean;
  /** the Inspector's OPEN rows (a session, a conversation, a flight): an in-app path. Without it the page goes there */
  navigate?: (path: string) => void };
export type WorldState = { t: number; from: number; to: number; playing: boolean; speed: number; rate?: number; direction?: number; slicing?: boolean; sliceInspector?: boolean; view: string; roster: string[]; lanes: string[]; open: "work" | "preview" | "inspector" | null; tzOffset: number;
  soloHost?: string | null; window?: string | null; rung: number; follow: boolean; source: WorldSource; cam: unknown; tour?: unknown;
  // FAILED · STUCK at T: :errors on, the stuck threshold, and the counts the tally shows
  theme?: string; accent?: string; errors?: boolean; stuckMs?: number; trouble?: { stuck: number; failed: number; ask: number; msg: number; tool: number; undeliverable?: number; oldestMs: number | null } };
export type WorldHandle = (() => void) & { select: (target: WorldTarget | null) => void; runCommand: (text: string) => string; state: () => WorldState; appendLive: (delta: unknown) => boolean | "reseed"; liveStatus: (status: unknown) => void;
  // point & speak: while ⌥ is held the host hands heard words here instead of the world-command route
  psHeard?: (text: string) => void; psListening?: () => boolean;
  /** what the HUD shows right now, compact, for a model to answer questions about it */
  brief: () => unknown;
  /** measure again: the host moved a column in or out of the frame, so the world's box changed without a resize */
  relayout: () => void };
export function mountWorld(root: HTMLElement, D: any, FONT: string, opts: WorldOptions = {}): WorldHandle {
const API = opts.api || "/api/ops", OPERATOR = (opts.operator || "operator").replace(/^@/, "");
  const disposers: (() => void)[] = [];
  const on = (t, ev, fn, opt?) => { t.addEventListener(ev, fn, opt); disposers.push(() => t.removeEventListener(ev, fn, opt)); };
  let alive = true, rafId = 0;
  let CFONT = FONT;
  // slots (optional): a host can take the two side columns out of the HUD's frame into its own panels.
  // Each column gets a .wm host of its own; opts.slots.attach(side, node) hands it over and the host decides
  // where — and whether — it is mounted (the composed World view docks a column back into the frame while it
  // has no panel for it). Without slots (/ops/world, the Studio study) the columns stay in the frame.
  const SLOTTED = !!(opts.slots && opts.slots.attach);
  const wmHost = (cls, child?) => { const w = document.createElement("div"); w.className = "wm " + cls; w.style.setProperty("--wm-font", getComputedStyle(root).getPropertyValue("--wm-font") || FONT); if (child) w.appendChild(child); return w; };
  const SLOT_WRAPS = SLOTTED ? [...root.querySelectorAll("aside.col")].map((col, i) => wmHost("wm--slot wm--slot-" + (i ? "right" : "left"), col)) : [];
  if (SLOTTED) root.querySelector(".frame")?.classList.add("slotted");
  const SCOPES = [root, ...SLOT_WRAPS];
  // perf probe (?wmperf, ?wmperf=mouse): frame cost, rAF gaps, long tasks, slow paints, resize callbacks, $ misses —
  // a 10 s window at a time, written to a corner readout (#wmperf) and window.__wmperf; =mouse sweeps a pointer over the world
  // the app router canonicalizes the URL before this lazy module loads, so fall back to the original navigation URL
  const PQ = new URLSearchParams(location.search + "&" + (((performance.getEntriesByType("navigation")[0] as any)?.name || "").split("?")[1] || "")), PERF = PQ.has("wmperf") ? { f: [], gap: [], lt: 0, ps: 0, ro: 0, miss: 0, t0: 0, mouse: PQ.get("wmperf") === "mouse", log: [], sec: {}, skip: (PQ.get("wmskip") || "").split(",") } : null;
  // something opened in the right column while the shell has it collapsed: ask the shell to bring it back
  const revealRight = () => { if (SLOTTED && opts.slots.reveal) { opts.slots.reveal("right"); return; } if (SLOTTED && SLOT_WRAPS[1] && !SLOT_WRAPS[1].isConnected) window.dispatchEvent(new CustomEvent("scout:set-inspector-width", { detail: { width: 380 } })); };

// colours: every one comes from the palette (theme.ts; a Theme in code); applyTheme / paintAccent reassign these live, no remount
let theme = THEMES[resolveThemeId()];
let themeId = theme.id;
let accentChoice = resolveAccent(theme.id);
// the THEME, the shape: Panels or Hairline (theme.ts › STYLES). CSS only, stamped as data-style on each .wm host
let styleId = resolveStyle();
let bootPaint = accentPaint(theme, accentChoice);
let ACC = bootPaint.cAccent, FG = theme.cInk, FAINT = theme.cFaint, DIM = theme.cDim, LINE = theme.cLine, HAIR = theme.hair;
let accentCss = bootPaint.accent, accentHot = bootPaint.hot;
let PEAK = theme.peak, PIN = theme.pin, PINSUB = bootPaint.pinSub, TAG = theme.tag, TICK = theme.tick, DOT = theme.dot;
let MESHDOT = theme.meshDot, MESHEDGE = theme.meshEdge, MESHEDGEDIM = theme.meshEdgeDim, MESHNODE = theme.meshNode;
// streaming text: words arrive where something new is being said — an ask in flight, a prompt just typed, the log, the hover
const STREAM = new Map();
function streamed(key, text, cps = 90) {
  if (reduced || !text) return text || "";
  const now = performance.now(); let t0 = STREAM.get(key);
  if (t0 == null) { if (STREAM.size > 800) STREAM.clear(); t0 = now; STREAM.set(key, t0); }
  const n = Math.floor((now - t0) * cps / 1000);
  return n >= text.length ? text : text.slice(0, Math.max(0, n));
}
const caretOn = () => ((performance.now() / 380) | 0) % 2 === 0;
const idMemo = new Map();
const $ = id => { let el = idMemo.get(id); if (!el) { if (PERF) PERF.miss++; for (const sc of SCOPES) { el = sc.querySelector("#" + id); if (el) break; } if (el) idMemo.set(id, el); } return el; };
const $$ = sel => SCOPES.flatMap(sc => [...sc.querySelectorAll(sel)]);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pad = n => String(n).padStart(2, "0");
const hhmm = ms => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dayTag = ms => { const d = new Date(ms); return DOW[d.getDay()] + " " + pad(d.getMonth() + 1) + "/" + pad(d.getDate()); };
const dur = ms => { if (ms == null) return "—"; const s = ms / 1000; return s < 60 ? Math.round(s) + "s" : s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? (s / 3600).toFixed(1) + "h" : (s / 86400).toFixed(1) + "d"; };
const esc = s => String(s || "").replace(/[<&]/g, c => c === "<" ? "&lt;" : "&amp;");
// one line of plain words: pasted images arrive as "[Image: original 2794x168, …]" and say nothing in the air
const sq = s => String(s || "").replace(/\[Image:[^\]]*(\]|$)/g, "[image]").replace(/\s+/g, " ").trim();
// at most n lines of up to cols characters, broken between words; what doesn't fit ends the last line with "…"
function wrapWords(text, cols, n) {
  const out = []; let rest = text;
  while (rest && out.length < n) {
    if (rest.length <= cols) { out.push(rest); rest = ""; break; }
    let cut = rest.lastIndexOf(" ", cols); if (cut < cols * 0.5) cut = cols;
    out.push(rest.slice(0, cut).trimEnd()); rest = rest.slice(cut).trimStart();
  }
  if (rest && out.length) { const last = out[out.length - 1]; out[out.length - 1] = (last.length >= cols ? last.slice(0, cols - 1).replace(/\s+\S*$/, "") : last) + "…"; }
  return out;
}
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => (s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= model ================= */
const NOW = D.now, T0 = D.from, T1 = NOW, SPAN = T1 - T0, HOURS = Math.ceil(SPAN / 36e5);
/** Local midnight `d` calendar days after T0's. Days run 23 to 25 hours across a clock change, so never step by 24 h. */
const midnight = (d) => { const t = new Date(T0); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + d).getTime(); };
// the snapshot's own length (`--days`, ?days=): a day reads as 24 H, longer as N DAYS / N D
const SPAN_DAYS = Math.round(SPAN / 864e5), SPAN_LONG = SPAN_DAYS > 1 ? `${SPAN_DAYS} DAYS` : `${HOURS} H`, SPAN_SHORT = SPAN_DAYS > 1 ? `${SPAN_DAYS} D` : `${HOURS} H`;
// live (?source=live|otlp, world-live.ts): the seed's axis runs a little past the wall clock and rows keep arriving
// (appendLive below); while it plays the playhead IS the wall clock. The plain week has no D.live
const LIVE = D.live || null;
const SOURCES = ["week", "live", "otlp"], SRC = SOURCES.includes(opts.source) ? opts.source : LIVE ? LIVE.source : "week";
// two modes: the recorded span plays back; our machines, and OTLP exporters, arrive in real time
const SOURCE_LABEL = { week: "PLAYBACK", live: "REAL TIME", otlp: "OTLP" };
const SOURCE_ALIAS = { playback: "week", realtime: "live", "real-time": "live" };
// no window open: everything the page holds, in the terms of its mode
const WHOLE_SPAN = LIVE ? `THE LAST ${LIVE.hours} H` : `ALL ${SPAN_LONG}`;
let LIVE_HOSTS = (LIVE && LIVE.hosts) || [], liveSlow = 0, reseedAsked = false;
const liveLat = new Map();   // host → ms from a call being made to its dot existing here, for calls made since the seed
const OTLP_URL = opts.otlpEndpoint || (location.origin + "/api/ops/world-otlp");
// an agent reads as its roster code ("SP 253", the runtime's number for it: roster-names.ts); `full` is its own name,
// for hover titles, search and anything sent on. An agent the runtime has not numbered, or a person, reads as `full`.
let ROSTER = NO_ROSTER;
const actors = D.actors.map(a => named({ ...a }));
function named(a) { a.full = tailName(a); a.tag = rosterLabelFor(a, ROSTER); a.short = a.tag || a.full; return a; }
// for a model or a voice: the code and the name it stands for
const spoken = a => a.tag ? `${a.tag} (${a.full})` : a.short;
// :find and :fly match the code (with or without its space: "sp253"), the short name and the whole name
const nameHit = rosterNameHit;
// the part of a name that tells agents apart: "demo-app-rutherford-11" is "rutherford-11" (its lane already says demo-app)
function tailName(a) {
  let n = (a.name || a.id).replace(/^openscout-/i, "").replace(/^Openscout /, "");
  const pj = String(a.project || "").toLowerCase();
  if (pj && n.toLowerCase().startsWith(pj + "-") && n.length - pj.length > 3) n = n.slice(pj.length + 1);
  return n.length > 22 ? n.slice(0, 21) + "…" : n;
}
// a row's ids are indexes into strs (-1 or absent: none); read through D.strs, which live deltas grow in place
const refOf = k => k != null && k >= 0 ? D.strs[k] ?? null : null;
// src (newer builds): "b" a broker ask, "t" an operator's turn, "s" a subagent — only a broker ask can be STUCK.
// A broker ask then carries its ids: invocation, flight, conversation (world-week.ts › WorldAsk)
const askOf = ([ts, done, st, rq, tg, task, err, src, inv, fl, conv], i) => {
  const end = done || (st === "f" ? ts : null);
  return { i, ts, done: end, st, rq: actors[rq], tg: actors[tg], task, err, src, ids: { invocation: refOf(inv), flight: refOf(fl), conversation: refOf(conv) } };
};
const asks = D.asks.map((r, i) => {
  return askOf(r, i);
});
// ask → the session that received it, and what that session touched while the ask was open
const WORK = D.work || {};
asks.forEach(a => { const w = WORK[a.i]; if (w) a.work = w; });
const linked = asks.filter(a => a.work);
let focusWork = null; // { a, w, lane, evs, set } while zeroed in
let stash = [], stashSel = 0, stashPrevFocus = null; // the right-column stash canvas
// people: every person who asked something. One is the operator; a team dataset has several, and the HUD says so
const PEOPLE = [...new Set(asks.filter(a => a.rq && a.rq.kind === "person").map(a => a.rq))];
const TEAM = PEOPLE.length > 1;
const HUB = (D.hosts.find(x => x.self) || { name: "this host" }).name;
// real hosts: a team week names each machine as a persona (Art, Mini…); wherever it shows a persona it can also say the
// machine, so the HUD never hides where the work happened. Files from another machine carry "host:" in their display path
const HOST_BY = new Map(D.hosts.filter(x => x.host).map(x => [x.host, x])), SELF_HOST = (D.hosts.find(x => x.self) || {}).host || null;
const pathHost = p => { const m = /^([A-Za-z0-9._-]+):(?=[~/])/.exec(p || ""); return m ? m[1] : null; };
const hostLabel = h => { if (!h) return "—"; const x = HOST_BY.get(h); return x && x.name && x.name !== h ? `${x.name} · ${h}` : h; };
const actorHost = a => a ? a.host || (D.hosts.find(x => x.name === a.node) || {}).host || null : null;
const SESS_HOST = new Map(); asks.forEach(a => { if (a.work && !SESS_HOST.has(a.work.s)) SESS_HOST.set(a.work.s, actorHost(a.tg)); });
// the machine a session ran on: a team week says so for every session (team.sessionHost → team.hosts); otherwise the asks it took
const TEAM_HOSTS = (D.team && D.team.hosts) || [];
const sessHostOf = i => { const k = D.team && D.team.sessionHost ? D.team.sessionHost[i] : null; return k != null && TEAM_HOSTS[k] ? TEAM_HOSTS[k].host : SESS_HOST.get(i) || null; };
let soloHost = null;   // :solo host mini — one machine's work stays lit, the others fall back
// :only <agent>, a click on its roster row: that agent's asks, sessions and files stay lit, the rest falls back.
// The camera and the playhead stay where they are (setFocusAgent)
let focusAgent = null, focusSess = new Set(), focusSig = "";
const remoteHost = f => { const h = pathHost(f && f.disp); return h && h !== SELF_HOST ? h : null; };
const msgs = D.msgs.map(([ts, a, c]) => ({ ts, a: actors[a], c }));
const STR = D.strs;
const KIND = {
  e: { label: "EDIT", band: 0, b: 1.0, s: 1.45 },
  r: { label: "READ", band: 1, b: 0.55, s: 1.0 },
  // a search (Grep, Glob, LS, or rg/grep/find in a shell) names a pattern or a folder, not a file: its own band, dimmer than a read
  s: { label: "SEARCH", band: 2, b: 0.45, s: 0.95 },
  c: { label: "COMMAND", band: 3, b: 0.72, s: 1.0 },
  b: { label: "BROWSER", band: 4, b: 0.5, s: 0.95 },
  m: { label: "AGENT COMMS", band: 5, b: 0.9, s: 1.2 },
  w: { label: "WEB", band: 6, b: 0.55, s: 1.0 },
  o: { label: "OTHER TOOL", band: 7, b: 0.38, s: 0.9 },
};
const KIND_ORDER = ["e", "r", "s", "c", "b", "m", "w", "o"];
const sessions = D.sessions.map(([sid, h, root, turns], i) => ({ i, sid, h, root, turns: (turns || []).map(([s, t]) => ({ t: T0 + s * 1000, text: STR[t] })) }));
// edits may carry [lines added, lines removed] (the builder's diff of the call's input); older builds don't
const events = D.events.map(([s, root, k, sess, name, tgt, file, add, rem], i) => ({ i, t: T0 + s * 1000, root: STR[root], k, sess, name: STR[name], tgt: STR[tgt], file: file >= 0 ? STR[file] : null, add: add || 0, rem: rem || 0, dl: add != null }));
/* ================= trouble: FAILED · STUCK =================
 * Two plain states, nothing statistical. FAILED: an ask that failed, a message the broker could not deliver, a tool call
 * that errored (world-transcript.ts decides which). STUCK: a broker ask or an undelivered message still open past STUCK_MS
 * (:stuck 10m|30m|1h). The colours are one block, the theme's fail token when a theme is applied (no traffic lights). */
let ALARM, ALARM_DIM, ALARM_FAINT, ALARM_VEIL;
// the alarm follows the treatment's own alarm token (never the accent); the :errors veil is the ground, so paper washes out
function paintAlarm() { ALARM = theme.alarm; ALARM_DIM = hexA(theme.alarm, theme.light ? 0.75 : 0.62); ALARM_FAINT = hexA(theme.alarm, theme.light ? 0.4 : 0.26); ALARM_VEIL = hexA(theme.ground, theme.light ? 0.72 : 0.62); }
paintAlarm();
let stuckMs = parseStuck(PQ.get("stuck")) || STUCK_DEFAULT;
// the staleness horizon (:stuck 30m 24h · ?stale=): open longer than this is STALE, a quiet count, not STUCK
let staleMs = (PQ.get("stale") && parseStuckArgs("1m " + PQ.get("stale"))?.horizon) || STALE_DEFAULT;
const stuckLabel = (ms = stuckMs) => stuckLbl(ms);
const MOUNT_WALL = Date.now();   // "since you opened"
// undelivered messages: [created, finished|null, o|c|f, sender, target name, text, error, then ids as strs indexes:
// delivery, target, message, flight, conversation, and when the target session ended] — they draw on the target's lane
const DLV = [];
// a broadcast: the copies one sender sent at one moment with one text share a fan, so trouble lists them as one row
const FANS = new Map();
function addDlv([ts, done, st, rq, toName, text, err, did, tid, mid, fl, conv, ended]) {
  const target = refOf(tid);
  const from = actors[rq] || null, to = actors.find(a => (target && a.id === target) || a.id === toName || a.name === toName) || null;
  const key = rq + "\u0000" + ts + "\u0000" + (text || ""); let fan = FANS.get(key); if (!fan) FANS.set(key, fan = { n: 0 }); fan.n++;
  DLV.push({ i: DLV.length, kind: "msg", ts, done: done != null ? done : st === "f" ? ts : null, st, rq: from, tg: to || from, toA: to, toName: toName || "—", task: text || "", err: err || "", fan, fanN: 1,
    ended: ended ?? null, ids: { delivery: refOf(did), target, message: refOf(mid), flight: refOf(fl), conversation: refOf(conv) } });
}
(D.dlv || []).forEach(addDlv);
// failed tool calls: [secs, session, tool, target, error]
const ERRS = [];
const addErr = ([sec, sess, tool, tgt, err]) => ERRS.push({ i: ERRS.length, kind: "tool", t: T0 + sec * 1000, sess, tool: STR[tool] || "tool", tgt: STR[tgt] || "", err: STR[err] || "" });
(D.errs || []).forEach(addErr);
ERRS.sort((x, y) => x.t - y.t);
// worktrees: root → [the repo it was cut from, branch ("" when detached)]. Their work folds into the repo's lane
// and they draw as strands off its back edge — lanes are repos, worktrees are branches of them.
const ROOTS = D.roots || {};
// vcs tally, every entry stamped in secs since T0 so the HUD counts what existed by T. Older builds carry only roots:
// a worktree then counts from the first tool call made inside it
const VCS = (() => {
  const v = D.vcs || {}, first = new Map();
  if (!v.worktrees) for (const e of D.events) { const r = STR[e[1]]; if (ROOTS[r] && !first.has(r)) first.set(r, e[0]); }
  const wt = (v.worktrees || [...first.entries()].map(([r, s]) => [s, r])).map(([s]) => T0 + s * 1000).sort((a, b) => a - b);
  // branches and PRs only exist when the builder could read git / gh; otherwise they read as unknown, not zero
  const at = x => x == null ? null : T0 + x * 1000;
  const prs = v.prs ? v.prs.map(([s, m, repo, num, title, branch, c, url]) => ({ t0: at(s), tm: at(m), tc: at(c), repo: repo || "", num, title: title || "", branch: branch || "", url: url || "" })).sort((a, b) => a.t0 - b.t0) : null;
  return { wt, br: v.branches ? v.branches.map(([s]) => T0 + s * 1000) : null, pr: prs ? prs.map(p => [p.t0, p.tm]) : null, prs };
})();
const countTo = (list, t) => { let n = 0; for (const x of list) if (x <= t) n++; return n; };
events.forEach(e => { if (ROOTS[e.root]) e.wt = e.root; });
// tokens: per session, cumulative by hour [fresh, cache hit, cache write, out] — so any T reads in O(1)
const HOUR_USE = Array.from({ length: HOURS }, () => [0, 0, 0, 0]);
sessions.forEach(se => {
  const cum = new Float64Array((HOURS + 1) * 4), rows = (D.usage || {})[se.i] || [];
  rows.forEach(([h, f, hit, wr, o]) => { if (h < 0 || h >= HOURS) return; const b = (h + 1) * 4; cum[b] += f; cum[b + 1] += hit; cum[b + 2] += wr; cum[b + 3] += o; const u = HOUR_USE[h]; u[0] += f; u[1] += hit; u[2] += wr; u[3] += o; });
  for (let h = 1; h <= HOURS; h++) for (let k = 0; k < 4; k++) cum[h * 4 + k] += cum[(h - 1) * 4 + k];
  se.cum = cum; se.colds = [];
});
const useAt = (se, t) => { const h = clamp(Math.floor((t - T0) / 36e5), -1, HOURS - 1) + 1, c = se.cum; return [c[h * 4], c[h * 4 + 1], c[h * 4 + 2], c[h * 4 + 3]]; };
const tokSum = u => u[0] + u[1] + u[2] + u[3];
const hitRate = u => { const inp = u[0] + u[1] + u[2]; return inp ? u[1] / inp : null; };
// cold restarts: the prompt cache had to be rebuilt (idle past its TTL, a fresh session, a compaction)
const COLDS = (D.colds || []).map(([s, i, n]) => ({ t: T0 + s * 1000, se: sessions[i], n })).filter(c => c.se);
COLDS.forEach(c => c.se.colds.push(c));
const COLD_H = new Uint16Array(HOURS); COLDS.forEach(c => { const h = Math.floor((c.t - T0) / 36e5); if (h >= 0 && h < HOURS) COLD_H[h]++; });
// quota: each provider's own window over the week, as the web server sampled it
const PROVIDER = { anthropic: "CLAUDE", openai: "CODEX", xai: "GROK", kimi: "KIMI", minimax: "MINIMAX", cursor: "CURSOR" };
const Q_ORDER = ["anthropic|5h", "anthropic|7d", "openai|5h", "openai|7d", "xai|7d"];
const QUOTA = (D.quota || []).map(q => ({ key: q.p + "|" + q.l, name: `${PROVIDER[q.p] || q.p.toUpperCase()} · ${q.l.toUpperCase()}`, pts: q.pts.map(([s, v]) => [T0 + s * 1000, v]) }))
  .sort((a, b) => ((Q_ORDER.indexOf(a.key) + 1) || 99) - ((Q_ORDER.indexOf(b.key) + 1) || 99));
const quotaAt = (q, t) => { let v = null; for (const [ts, x] of q.pts) { if (ts > t) break; v = x; } return v; };
const fmtTok = n => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));

function hostOf(a) {
  return actorHost(a) || a.node || SELF_HOST || HUB;
}
function normRoot(r) { if (!r) return null; if (ROOTS[r] && ROOTS[r][0]) r = ROOTS[r][0]; if (r.startsWith("/private/tmp")) return "~/scratch"; return r; }
function laneKeyOf(a) { const r = normRoot(a.root); if (!r) return a.kind === "person" ? null : "~/unrooted"; return r; }
function laneName(k) {
  if (k === "~") return "home";
  if (k === "~/unrooted") return "unrooted";
  if (k === "~/scratch") return "scratch";
  if (k === "~/dev/openscout") return "openscout";
  const m = k.match(/worktrees\/([^/]+)/); if (m) return "wt · " + m[1];
  const home = /^\/(?:Users|home)\/([^/]+)$/.exec(k); if (home) return "~" + home[1];
  const parts = k.split("/").filter(Boolean); return parts[parts.length - 1];
}

// lanes: workspaces ranked by real activity
const laneScore = new Map();
const bump = (k, v) => { if (k) laneScore.set(k, (laneScore.get(k) || 0) + v); };
events.forEach(e => bump(normRoot(e.root), 1));
asks.forEach(a => bump(laneKeyOf(a.tg), 8));
const ranked = [...laneScore.entries()].sort((a, b) => b[1] - a[1]);
const TOP = ranked.slice(0, 7).map(([k]) => k);
if (LIVE && D.team && D.team.lanes) for (const k of D.team.lanes) if (TOP.length < 7 && !TOP.includes(k)) TOP.push(k);
const lanes = TOP.map((k, i) => ({ key: k, name: laneName(k), idx: i }));
// the same project on two hosts shares a folder name: the one under another home says where (its host, else whose home)
{ const n = new Map(); lanes.forEach(l => n.set(l.name, (n.get(l.name) || 0) + 1));
  lanes.forEach(l => { const m = n.get(l.name) > 1 && /^\/(?:Users|home)\/([^/]+)/.exec(l.key); if (!m) return;
    const host = actors.find(a => a.node && laneKeyOf(a) === l.key)?.node; l.name += " · " + (host || "~" + m[1]); }); }
if (ranked.length > 7) lanes.push({ key: "*", name: "other · " + (ranked.length - 7), idx: lanes.length });
else if (LIVE && !TOP.includes("other")) lanes.push({ key: "*", name: "other", idx: lanes.length });
const laneByKey = k => { if (!k) return null; return lanes.find(l => l.key === k) || lanes.find(l => l.key === "*") || null; };
const laneFor = a => laneByKey(laneKeyOf(a));
events.forEach(e => e.lane = laneByKey(normRoot(e.root) || "~"));
const zOrder = lanes.map((l, i) => ({ l, slot: Math.ceil(i / 2) * (i % 2 ? -1 : 1) }));
const LANE_GAP = 30;
zOrder.forEach(({ l, slot }) => l.z = slot * LANE_GAP);
// live order: lanes are baked at z0; z is where they are now, zt where they're headed (busiest around T takes the centre)
const SLOTS = lanes.map((_, i) => Math.ceil(i / 2) * (i % 2 ? -1 : 1) * LANE_GAP);
lanes.forEach(l => { l.z0 = l.z; l.zt = l.z; l.rank = l.idx; });
const OPERATOR_Z = Math.min(...lanes.map(l => l.z)) - LANE_GAP * 1.0;
const Z_MAX = Math.max(...lanes.map(l => l.z)) + 14;

// hourly series per lane (for sparklines + profile)
lanes.forEach(l => { l.smooth = new Float32Array(HOURS); l.asks = 0; l.events = 0; l.solo = false; l.off = false; });
events.forEach(e => { if (!e.lane) return; const h = Math.floor((e.t - T0) / 36e5); if (h >= 0 && h < HOURS) e.lane.smooth[h]++; e.lane.events++; });
asks.forEach(a => { const l = laneFor(a.tg); if (!l) return; l.asks++; });

// sessions index + file index for unpacking
const sessEvents = new Map(); events.forEach(e => { if (!sessEvents.has(e.sess)) sessEvents.set(e.sess, []); sessEvents.get(e.sess).push(e); });
const fileEvents = new Map(); events.forEach(e => { if ((e.k === "e" || e.k === "r") && e.tgt && /[./]/.test(e.tgt) && !/\s/.test(e.tgt)) { if (!fileEvents.has(e.tgt)) fileEvents.set(e.tgt, []); fileEvents.get(e.tgt).push(e); } });

// sessions as threads: every conversation on this machine, native or one that took a Scout ask
const viaScout = new Set(Object.values(WORK).map(w => w.s));
sessions.forEach(se => {
  const list = sessEvents.get(se.i) || [], tally = new Map();
  list.forEach(e => e.lane && tally.set(e.lane, (tally.get(e.lane) || 0) + 1));
  se.lane = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  se.n = list.length; se.native = !viaScout.has(se.i);
  const firstTurn = se.turns.find(u => u.t >= T0);
  se.t0 = Math.min(list.length ? list[0].t : Infinity, firstTurn ? firstTurn.t : Infinity);
  se.t1 = Math.max(list.length ? list[list.length - 1].t : -Infinity, se.turns.length ? se.turns[se.turns.length - 1].t : -Infinity);
  se.title = (se.turns[0] && se.turns[0].text) || (list[0] ? `${list[0].name} ${list[0].tgt || ""}` : "—");
  se.edits = list.filter(e => e.k === "e").length;
});
// overlapping sessions in one lane get their own track on the lane's front edge
lanes.forEach(l => {
  const ends = [];
  sessions.filter(se => se.lane === l && Number.isFinite(se.t0)).sort((a, b) => a.t0 - b.t0).forEach(se => {
    let k = ends.findIndex(t => t < se.t0 - 10 * 60e3); if (k < 0) { k = ends.length; ends.push(0); }
    ends[k] = se.t1; se.track = Math.min(k, 7);
  });
});

// worktrees as strands: first call to last, packed into tracks behind their repo's lane
const WTS = [];
{ const m = new Map();
  events.forEach(e => { if (!e.wt || !e.lane) return; let w = m.get(e.wt);
    if (!w) { const segs = e.wt.split("/").filter(Boolean), parent = (ROOTS[e.wt][0] || "").split("/").pop();
      const name = (e.wt.match(/worktrees\/([^/]+)/) || [])[1] || (segs[segs.length - 1] === parent ? segs[segs.length - 2] : segs[segs.length - 1]);
      w = { root: e.wt, name, branch: ROOTS[e.wt][1] || "", parent: ROOTS[e.wt][0], lane: e.lane, t0: e.t, t1: e.t, n: 0, edits: 0, sess: new Set(), evs: [] }; m.set(e.wt, w); WTS.push(w); }
    w.t1 = e.t; w.n++; if (e.k === "e") w.edits++; w.sess.add(e.sess); w.evs.push(e); });
  lanes.forEach(l => { const ends = [];
    WTS.filter(w => w.lane === l).sort((a, b) => a.t0 - b.t0).forEach(w => { let k = ends.findIndex(t => t < w.t0 - 30 * 60e3); if (k < 0) { k = ends.length; ends.push(0); } ends[k] = w.t1; w.track = Math.min(k, 7); }); });
}
/* code side: who worked in each checkout, what it added and removed, and the PRs that came out of it — read ≤ T */
const nUpTo = (list, t) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t <= t) lo = m + 1; else hi = m; } return lo; };
const askBySess = new Map(); linked.forEach(a => { const l = askBySess.get(a.work.s) || []; l.push(a); askBySess.set(a.work.s, l); });
const SOLO_PERSON = PEOPLE.length === 1 ? PEOPLE[0] : null;
// crew: one entry per linked ask (the agent asked, the person who asked) or per native session (its harness), stamped so lists grow with T
function crewOf(sessSet) {
  const out = [];
  sessSet.forEach(i => { const se = sessions[i]; if (!se) return; const as = askBySess.get(i) || [];
    if (as.length) as.forEach(a => out.push({ t: a.ts, agent: a.tg.short, person: a.rq && a.rq.kind === "person" ? a.rq.short : null }));
    else if (Number.isFinite(se.t0)) out.push({ t: se.t0, agent: se.h, person: SOLO_PERSON ? SOLO_PERSON.short : null }); });
  return out.sort((a, b) => a.t - b.t);
}
function crewAt(crew, t) { const ag = new Set(), pp = new Set(); for (const c of crew) { if (c.t > t) break; ag.add(c.agent); if (c.person) pp.add(c.person); } return { agents: [...ag], people: [...pp] }; }
const CHECKOUTS = new Map();   // checkout root → its edits, cumulative lines and files so any T reads in O(log n)
events.forEach(e => { if (e.k !== "e" || !e.lane) return; const key = e.wt || e.root; let c = CHECKOUTS.get(key);
  if (!c) { const w = e.wt ? WTS.find(x => x.root === e.wt) : null; c = { root: key, name: w ? w.name : e.lane.name, wt: w, lane: e.lane, ed: [], sess: new Set() }; CHECKOUTS.set(key, c); }
  c.ed.push(e); c.sess.add(e.sess); });
CHECKOUTS.forEach(c => { c.ed.sort((a, b) => a.t - b.t); let a = 0, r = 0; const seen = new Set(); c.cumA = []; c.cumR = []; c.cumF = [];
  c.ed.forEach(e => { a += e.add; r += e.rem; if (e.tgt) seen.add(e.tgt); c.cumA.push(a); c.cumR.push(r); c.cumF.push(seen.size); });
  c.dl = c.ed.some(e => e.dl); c.crew = crewOf(c.sess); });
function diffAt(c, t) { const n = c ? nUpTo(c.ed, t) : 0; return n ? { n, add: c.cumA[n - 1], rem: c.cumR[n - 1], files: c.cumF[n - 1], last: c.ed[n - 1].t, dl: c.dl } : null; }
const PRS = VCS.prs || [];
const tailOf = s => (s || "").split("/").pop().toLowerCase();
// a PR's checkout: the worktree on its branch, else a detached worktree named after the branch (codex cuts them that way)
PRS.forEach(p => { const tb = tailOf(p.branch);
  p.wt = WTS.find(w => w.branch && w.branch === p.branch) || (tb ? WTS.find(w => { const wn = w.name.toLowerCase(); return !w.branch && (!p.repo || !w.parent || p.repo === w.parent) && (tb === wn || tb.endsWith("-" + wn) || wn.endsWith("-" + tb)); }) : null) || null; });
WTS.forEach(w => { w.crew = crewOf(w.sess); w.co = CHECKOUTS.get(w.root) || null; w.prs = PRS.filter(p => p.wt === w); });
const prState = (p, t) => p.t0 > t ? null : p.tm != null && p.tm <= t ? "merged" : p.tc != null && p.tc <= t ? "closed" : "open";
const repoName = r => (r || "").split("/").filter(Boolean).pop() || "—";
const fmtN = n => n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
const dlText = d => d.dl ? `+${fmtN(d.add)} −${fmtN(d.rem)}` : `${d.files} FILES`;
const whenTag = t => DOW[new Date(t).getDay()] + " " + hhmm(t);

// roster: agents that received asks
const rosterAll = (() => {
  const m = new Map();
  asks.forEach(a => { const r = m.get(a.tg) || { a: a.tg, list: [] }; r.list.push(a); m.set(a.tg, r); });
  return [...m.values()].sort((x, y) => y.list.length - x.list.length);
})();

/* ================= time state ================= */
let T = T0 + SPAN * 0.02, playing = !reduced, speed = 1;
if (reduced) T = T1;
if (LIVE) { T = Math.min(T1, Date.now()); playing = true; }
const LOOP_MS = 150e3;
function stateAt(a, t) {
  if (a.ts > t) return "future";
  if (a.done != null && a.done <= t) return a.st === "f" ? "failed" : a.st === "c" ? "done" : "done";
  return stuckAt(a, t) ? "stuck" : "flight";
}
// stuck: open past the threshold, and the session that took it quiet that long too (trouble.ts isWorking). The session's
// last call is looked up only for an ask that would otherwise be stuck.
const stuckAt = (a, t) => isStuck(a, t, stuckMs, staleMs) && !isWorking(lastActAt(a, t), t, stuckMs);
// the last call the session that took this ask made at or before t; null when the ask has no session here
function lastActAt(a, t) {
  const se = a.work && sessions[a.work.s], evs = se && sessEvents.get(se.i);
  if (!evs || !evs.length) return null;
  const k = nUpTo(evs, t); return k ? evs[k - 1].t : null;
}

/* ================= helpers: canvas ================= */
// sizes come from a ResizeObserver, not getBoundingClientRect: a read right after the panels' innerHTML writes forces a
// synchronous layout of the whole app, and the frame did that a dozen times over
const sizes = new WeakMap(), sizeRO = new ResizeObserver(es => { for (const e of es) { const b = e.borderBoxSize?.[0]; sizes.set(e.target, b ? { width: b.inlineSize, height: b.blockSize } : { width: e.contentRect.width, height: e.contentRect.height }); } });
disposers.push(() => sizeRO.disconnect());
function sizeOf(el) { let s = sizes.get(el); if (!s) { const r = el.getBoundingClientRect(); s = { width: r.width, height: r.height }; sizes.set(el, s); sizeRO.observe(el); } return s; }
// readouts written from the frame wait for its end, and land at most ~8 times a second: a canvas font set right after a
// DOM write forces a style recalc of the whole app (~7 ms here), and the browser then pays for another one to paint
const domQ = new Map(); let domAt = 0;
function later(el, html) { domQ.set(el, html); }
function flushLater(now, force = false) { if (!domQ.size || (!force && now - domAt < 120)) return; domAt = now; domQ.forEach((h, el) => setHTML(el, h)); domQ.clear(); }
// write only what changed: an identical innerHTML still tears the subtree down and dirties layout
function setHTML(el, html) { if (el.__wmh !== html) { el.__wmh = html; el.innerHTML = html; } }
function fit(c) {
  const r = sizeOf(c), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const P0 = PERF && c.id === "mesh" ? performance.now() : 0;
  const g = c.getContext("2d"); const P1 = P0 && performance.now(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); const P2 = P0 && performance.now();
  g.font = `300 7.5px ${CFONT}, ui-monospace, monospace`; g.textBaseline = "middle"; g.lineWidth = HAIR;
  if (P0) { const P3 = performance.now(); PERF.sec["fit:ctx"] = (PERF.sec["fit:ctx"] || 0) + P1 - P0; PERF.sec["fit:clear"] = (PERF.sec["fit:clear"] || 0) + P2 - P1; PERF.sec["fit:font"] = (PERF.sec["fit:font"] || 0) + P3 - P2; }
  return { g, w, h };
}
const font = (g, px) => g.font = `300 ${px}px ${CFONT}, ui-monospace, monospace`;

/* ================= header ================= */
$("hostCount").textContent = D.hosts.length;
const paintTicker = () => $("ticker").innerHTML = [
  `<span>ASKS <b>${asks.length}</b></span>`,
  `<span>DONE <b>${asks.filter(a => a.st === "c").length}</b></span>`,
  `<span>FAILED <b>${asks.filter(a => a.st === "f").length}</b></span>`,
  `<span>MESSAGES <b>${msgs.length}</b></span>`,
  ...(TEAM ? [`<span>PEOPLE <b>${PEOPLE.length}</b></span>`] : []),
  `<span>${TEAM ? "AGENTS" : "AGENTS ASKED"} <b>${rosterAll.length}</b></span>`,
  `<span>${dayTag(T0)} → ${dayTag(T1)}</span>`].join("");
paintTicker();

/* ================= world ================= */
const gl = $("gl"), ov = $("ov"), panelW = $("worldPanel");
THREE.ColorManagement.enabled = false;
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.5, 5000);
const XS = 2.0; // world units per hour
const X0 = -HOURS * XS / 2;
const xOf = t => X0 + (t - T0) / 36e5 * XS;
const tOf = x => T0 + (x - X0) / XS * 36e5;
const BIN = 20 * 60e3, NBIN = Math.ceil(SPAN / BIN), BIN_W = BIN / 36e5 * XS;
const BAND_W = 3.0, BAND0 = -BAND_W * 3, NBANDS = KIND_ORDER.length;
const COLS = 4, ROWS = 7, PITCH_X = BIN_W / COLS, PITCH_Z = (BAND_W - 0.6) / ROWS;
let LAYER_H = 0.42;

// every event becomes one dot: lane → kind band → 20-minute column → stacked cell
const cellCount = new Map();
let evPos = new Float32Array(events.length * 3);
const colTop = lanes.map(() => new Float32Array(NBIN));
const binCount = lanes.map(() => new Uint16Array(NBIN));
events.forEach(e => {
  if (!e.lane) return;
  const bin = clamp(Math.floor((e.t - T0) / BIN), 0, NBIN - 1), band = KIND[e.k].band;
  const key = e.lane.idx * 1e6 + bin * 10 + band, n = cellCount.get(key) || 0; cellCount.set(key, n + 1);
  const layer = Math.floor(n / (COLS * ROWS)), slot = n % (COLS * ROWS), cx = slot % COLS, cz = Math.floor(slot / COLS);
  e.bin = bin; e.layer = layer;
  evPos[e.i * 3] = X0 + bin * BIN_W + (cx + 0.5) * PITCH_X;
  evPos[e.i * 3 + 1] = 0.3 + layer;
  evPos[e.i * 3 + 2] = e.lane.z + BAND0 + band * BAND_W + 0.3 + (cz + 0.5) * PITCH_Z;
  colTop[e.lane.idx][bin] = Math.max(colTop[e.lane.idx][bin], layer + 1);
  binCount[e.lane.idx][bin]++;
});
// FLOORS layout: files (stashable) and tool calls stack separately — files stay on the ground, tool calls hang from the floor below
const FLOOR_D = 16, LIFT_H = 9;
// artifacts: files you'd open and look at (pages, images, docs) — they get the biggest lift
const ARTIFACT = /\.(html?|png|jpe?g|gif|webp|svg|pdf|md|mp4|mov|csv)$/i;
// once files leave the ground they cluster by what kind of file they are: one band per group, front to back
const FILE_GROUPS = [
  { k: "pages", label: "PAGES · IMAGES", re: /\.(html?|png|jpe?g|gif|webp|svg|pdf|mp4|mov)$/i },
  { k: "docs", label: "DOCS", re: /\.(md|mdx|txt|rst)$/i },
  { k: "code", label: "CODE", re: /\.(tsx?|jsx?|mjs|cjs|swift|py|rs|go|rb|java|kt|c|cc|cpp|h|m|mm|css|scss|sh|zsh|sql)$/i },
  { k: "data", label: "DATA · CONFIG", re: /\.(json|jsonl|csv|ya?ml|toml|plist|xml|lock|env|ini)$/i },
  { k: "other", label: "OTHER", re: /./ },
];
const groupOf = f => FILE_GROUPS.findIndex(g => g.re.test(f));
const GROUP_BAND = [0, 1.4, 2.8, 4.2, 5.6];       // in BAND_W units, spread across the lane's depth
let evPos2 = new Float32Array(events.length * 3), evCtr = new Float32Array(events.length * 3); const cell2 = new Map();
events.forEach(e => { if (e.file) e.group = groupOf(e.file); });
const GROUP_N = {}; events.forEach(e => { if (!e.file || !e.lane) return; (GROUP_N[e.lane.idx] ||= FILE_GROUPS.map(() => 0))[e.group]++; });
events.forEach(e => {
  if (!e.lane) return;
  const band = e.file ? GROUP_BAND[e.group] : KIND[e.k].band, key = (e.lane.idx * 1e6 + e.bin * 10 + Math.round(band * 1.5)) * 2 + (e.file ? 1 : 0), n = cell2.get(key) || 0; cell2.set(key, n + 1);
  const layer = Math.floor(n / (COLS * ROWS)), slot = n % (COLS * ROWS), cx = slot % COLS, cz = Math.floor(slot / COLS);
  evPos2[e.i * 3] = X0 + e.bin * BIN_W + (cx + 0.5) * PITCH_X;
  evPos2[e.i * 3 + 1] = 0.3 + layer;
  evPos2[e.i * 3 + 2] = e.lane.z + BAND0 + band * BAND_W + 0.3 + (cz + 0.5) * PITCH_Z;
  // cluster centre: CLUSTER tight/loose scales each dot's offset from here (x and z only; stacks keep their height)
  evCtr[e.i * 3] = X0 + e.bin * BIN_W + COLS * PITCH_X / 2;
  evCtr[e.i * 3 + 2] = e.lane.z + BAND0 + band * BAND_W + 0.3 + ROWS * PITCH_Z / 2;
});
lanes.forEach(l => { let best = 0; for (let b = 0; b < NBIN; b++) if (binCount[l.idx][b] > binCount[l.idx][best]) best = b; l.peakBin = best; l.peakN = binCount[l.idx][best]; });
const colH = (l, x) => { const b = clamp(Math.floor((x - X0) / BIN_W), 0, NBIN - 1); let m = 0; for (let k = -1; k <= 1; k++) m = Math.max(m, colTop[l.idx][clamp(b + k, 0, NBIN - 1)] || 0); return m * LAYER_H; };

/* the window ladder (tour.ts has the rungs): the window is the zoom. Every call keeps its exact time (et) so a 60 s window
 * lights 60 s of calls, not their 20-minute bin; the Mesh fold (pos3) re-stacks each call into its machine's band:
 * one band per machine (team.sessionHost), a sub-row per lane inside it, stacked by (machine, lane, bin) so volume is height. */
const EVT = events.filter(e => e.lane).sort((a, b) => a.t - b.t), EVT_T = EVT.map(e => e.t);
const lowerBound = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; };
const ASK_T = asks.map(a => a.ts);   // asks arrive sorted by ts (the log and stepAsk lean on it too)
// the data's last event: a call, an ask landing or finishing — never the wall clock
let LAST_EVENT = Math.min(T1, Math.max(EVT.length ? EVT_T[EVT_T.length - 1] : T0, ...asks.map(a => a.done || a.ts), T0));
const MESH_HOSTS = [];   // { host, name, k, n } in the team's own order, then any other machine the sessions name
let evHostK = new Int16Array(events.length).fill(-1);
{ const order = TEAM_HOSTS.map(x => x.host).filter(Boolean), seen = new Map();
  const add = h => { if (!seen.has(h)) { const hh = HOST_BY.get(h); seen.set(h, MESH_HOSTS.length); MESH_HOSTS.push({ host: h, name: hh && hh.name ? hh.name : h, k: MESH_HOSTS.length, n: 0 }); } return seen.get(h); };
  order.forEach(add);
  EVT.forEach(e => { const h = sessHostOf(e.sess); if (h) { const k = add(h); evHostK[e.i] = k; MESH_HOSTS[k].n++; } });
  // a call whose session names no machine is not guessed onto one: it gets its own band, and the band says so
  const loose = EVT.filter(e => evHostK[e.i] < 0);
  if (loose.length) { const k = MESH_HOSTS.length; MESH_HOSTS.push({ host: null, name: "NO HOST", k, n: loose.length }); loose.forEach(e => evHostK[e.i] = k); }
  const empty = LIVE ? [] : MESH_HOSTS.filter(m => !m.n);   // live keeps every machine's band: its calls may come yet empty.forEach(m => MESH_HOSTS.splice(MESH_HOSTS.indexOf(m), 1)); MESH_HOSTS.forEach((m, i) => { if (m.k !== i) EVT.forEach(e => { if (evHostK[e.i] === m.k) evHostK[e.i] = i; }); m.k = i; });
}
const UNPLACED = EVT.filter(e => !sessHostOf(e.sess)).length;
const HB_SUB = 2.6, HB_D = lanes.length * HB_SUB, HB_GAP = Math.max(30, HB_D + 12);
const MESH_MID = lanes.reduce((s, l) => s + l.z0, 0) / Math.max(1, lanes.length) + BAND0 + NBANDS / 2 * BAND_W;   // LANE_MID, which is declared further down
MESH_HOSTS.forEach(m => { m.z0 = MESH_MID + (m.k - (MESH_HOSTS.length - 1) / 2) * HB_GAP - HB_D / 2; m.zc = m.z0 + HB_D / 2; });
const MESH_BY = new Map(MESH_HOSTS.filter(m => m.host).map(m => [m.host, m]));
let evPos3 = new Float32Array(events.length * 3), evEt = new Float32Array(events.length);
const cell3 = new Map(), R3 = 3, PZ3 = (HB_SUB - 0.5) / R3;
{
  EVT.forEach(e => {
    const m = MESH_HOSTS[evHostK[e.i]], key = (m.k * 64 + e.lane.idx) * NBIN + e.bin, n = cell3.get(key) || 0; cell3.set(key, n + 1);
    const layer = Math.floor(n / (COLS * R3)), slot = n % (COLS * R3), cx = slot % COLS, cz = Math.floor(slot / COLS);
    evPos3[e.i * 3] = X0 + e.bin * BIN_W + (cx + 0.5) * PITCH_X;
    evPos3[e.i * 3 + 1] = 0.3 + layer;
    evPos3[e.i * 3 + 2] = m.z0 + e.lane.idx * HB_SUB + 0.25 + (cz + 0.5) * PZ3;
    evEt[e.i] = xOf(e.t);
  });
}
let rung = -1, win = null;      // rung -1 = no window: the plain week

// views are angles only — switching never loses your place or zoom
const VIEWS = {
  iso: { az: -0.34, el: 0.58, label: "ISO" },
  top: { az: 0, el: 1.45, label: "TOP" },
  side: { az: 0, el: 0.06, label: "SIDE" },
  low: { az: -1.25, el: 0.16, label: "LOW" },
};
// zoom is a ladder of framings, not a free dolly: a fast wheel can't skip past where you meant to stop
const LEVELS = [
  { k: "WEEK", r: 520 }, { k: "2 DAYS", r: 170 }, { k: "DAY", r: 88 }, { k: "6 H", r: 34 }, { k: "2 H", r: 14 },
];
let viewName = "iso", level = 0;
// the turn pivots on the middle of the work: activity-weighted time, centre lane's band middle
const WORK_X = (() => { let sx = 0, n = 0; events.forEach(e => { if (e.lane) { sx += xOf(e.t); n++; } }); return n ? sx / n : 0; })();
const LANE_MID = BAND0 + NBANDS / 2 * BAND_W;
const cam = { az: VIEWS.iso.az, el: VIEWS.iso.el, r: LEVELS[0].r, tx: WORK_X, tz: LANE_MID }, camGoal = { ...cam };
let follow = !!LIVE, followDX = 0;   // followDX: a fly's "follow x 6" keeps the camera that far ahead of the playhead
// :fly — a timed, eased move that lands exactly when it says; :cam save/go — named cameras (this browser's)
let tour = null, tourQuiet = false;   // :tour — see startTour
let flight = null, ride = null;   // ride: a lane the camera stays on as lanes re-rank (zero in, fly lane …)
const CAMS_KEY = "world-modale.cams";
let cams = {}; try { cams = JSON.parse(localStorage.getItem(CAMS_KEY) || "{}") || {}; } catch {}
const saveCams = () => { try { localStorage.setItem(CAMS_KEY, JSON.stringify(cams)); } catch {} };

function pointsFrom(arrPos, arrCol, arrSize, arrLane, arrEid, arrPos2 = arrPos, arrFl = null, arrCtr = null, arrNat = null, arrWt = null, arrPos3 = null, arrEt = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arrPos, 3));
  g.setAttribute("pos2", new THREE.Float32BufferAttribute(arrPos2, 3));
  g.setAttribute("fl", new THREE.Float32BufferAttribute(arrFl || new Float32Array(arrEid.length), 1));
  g.setAttribute("ctr", new THREE.Float32BufferAttribute(arrCtr || arrPos2, 3));
  g.setAttribute("nat", new THREE.Float32BufferAttribute(arrNat || new Float32Array(arrEid.length).fill(-1), 1));
  g.setAttribute("wt", new THREE.Float32BufferAttribute(arrWt || new Float32Array(arrEid.length).fill(-1), 1));
  g.setAttribute("color", new THREE.Float32BufferAttribute(arrCol, 1));
  g.setAttribute("psize", new THREE.Float32BufferAttribute(arrSize, 1));
  g.setAttribute("lane", new THREE.Float32BufferAttribute(arrLane, 1));
  g.setAttribute("eid", new THREE.Float32BufferAttribute(arrEid, 1));
  g.setAttribute("foc", new THREE.Float32BufferAttribute(new Float32Array(arrEid.length), 1));
  g.setAttribute("hs", new THREE.Float32BufferAttribute(new Float32Array(arrEid.length), 1));
  g.setAttribute("pos3", new THREE.Float32BufferAttribute(arrPos3 || arrPos, 3));
  g.setAttribute("et", new THREE.Float32BufferAttribute(arrEt || new Float32Array(arrEid.length), 1));
  return g;
}
const uniforms = {
  uCursor: { value: 0 }, uSize: { value: 2.0 }, uScale: { value: 800 }, uWorld: { value: 0.15 }, uPR: { value: Math.min(2, devicePixelRatio || 1) }, uLayer: { value: LAYER_H },
  uAcc: { value: new THREE.Color(ACC) }, uInk: { value: new THREE.Color(theme.point) }, uHot: { value: new THREE.Color(accentHot || theme.hot) }, uInkOn: { value: theme.inkPoints ? 1 : 0 }, uMask: { value: new Float32Array(16).fill(1) }, uSel: { value: -1 },
  uSlice: { value: 0 }, uSliceHW: { value: BIN_W / 2 }, uHover: { value: -1 }, uPick: { value: -1 }, uFocusOn: { value: 0 }, uHostSolo: { value: 0 },
  uLaneDZ: { value: new Float32Array(16) }, uFloors: { value: 0 }, uFloorD: { value: FLOOR_D }, uLift: { value: 0 }, uLiftH: { value: LIFT_H }, uSpread: { value: 1 }, uNatDim: { value: 0 }, uScoutDim: { value: 0 }, uWtLens: { value: 0 }, uShowF: { value: 1 }, uShowT: { value: 1 }, uTint: { value: Array.from({ length: 16 }, () => new THREE.Vector3(1, 1, 1)) }, uTintOn: { value: 0 },
  // the window ladder: uFold eases between rungs' folds; uWinA/uWinB are the window's x; uWinGlow lights a short window's calls
  uFold: { value: 0 }, uWinOn: { value: 0 }, uWinA: { value: 0 }, uWinB: { value: 0 }, uWinGlow: { value: 0 }, uLaneZ0: { value: new Float32Array(16) },
};
const VERT = `
  attribute float color; attribute float psize; attribute float lane; attribute float eid; attribute float foc; attribute vec3 pos2; attribute float fl; attribute vec3 ctr; attribute float nat; attribute float wt; attribute float hs; attribute vec3 pos3; attribute float et;
  uniform float uFold, uWinOn, uWinA, uWinB, uWinGlow; uniform float uLaneZ0[16];
  uniform float uFloors, uFloorD, uShowF, uShowT, uLift, uLiftH, uSpread, uNatDim, uScoutDim, uWtLens;
  uniform float uCursor, uSize, uScale, uWorld, uPR, uSel, uSlice, uSliceHW, uHover, uPick, uLayer, uFocusOn, uHostSolo; uniform float uMask[16];
  uniform float uLaneDZ[16]; uniform vec3 uTint[16]; uniform float uTintOn;
  varying float vB; varying float vA; varying float vGlow; varying float vHot; varying vec3 vTint; varying float vF;
  void main() {
    vec3 p = position; float isEv = eid >= 0.0 ? 1.0 : 0.0;
    // fl on events: 0 tool call · 1 file · 3 artifact file; on scaffold: 2 lower-floor rail · 4 artifacts-floor rail
    float isF = (isEv > 0.5 && fl > 0.5) ? 1.0 : 0.0, isArt = (isEv > 0.5 && fl > 2.5) ? 1.0 : 0.0;
    float show = isEv > 0.5 ? (isF > 0.5 ? uShowF : uShowT * (1.0 - 0.35 * uFloors) * (1.0 - 0.8 * uLift)) : (fl > 4.5 ? smoothstep(0.5, 1.0, uFold) * 0.9 : fl > 3.5 ? uLift * 0.8 : fl > 1.5 ? uFloors * uShowT : 1.0);
    if (isEv < 0.5 && lane >= 0.0) show *= 1.0 - smoothstep(0.5, 1.0, uFold);   // lane rails give way to the machine bands
    if (isEv > 0.5) {
      vec3 a = vec3(position.x, 0.3 + (position.y - 0.3) * uLayer, position.z);
      vec3 b = vec3(pos2.x, isF > 0.5 ? 0.3 + (pos2.y - 0.3) * uLayer : -uFloorD - (pos2.y - 0.3) * uLayer, pos2.z);
      vec3 bs = b; if (isF > 0.5) { bs.x = ctr.x + (b.x - ctr.x) * uSpread; bs.z = ctr.z + (b.z - ctr.z) * uSpread; }
      p = mix(a, bs, isF > 0.5 ? max(uFloors, uLift) : uFloors);
      p.y += isF * uLift * uLiftH;            // ARTIFACTS: files rise above the sessions' ground
    }
    // the window's fold: 0 → 0.5 squeezes a lane's kind rows toward its front edge (calls as density);
    // 0.5 → 1 carries every call into its machine's band (pos3) and lets go of the live lane order
    float lf = smoothstep(0.0, 0.5, uFold), mf = smoothstep(0.5, 1.0, uFold);
    if (isEv > 0.5 && lane >= 0.0) { float zf = uLaneZ0[int(lane)]; p.z = zf + (p.z - zf) * (1.0 - 0.55 * lf); }
    if (lane >= 0.0) p.z += uLaneDZ[int(lane)] * (1.0 - mf);
    if (isEv > 0.5 && mf > 0.0) p = mix(p, vec3(pos3.x, 0.3 + (pos3.y - 0.3) * uLayer, pos3.z), mf);
    vTint = (uTintOn > 0.5 && lane >= 0.0) ? uTint[int(lane)] : vec3(1.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dx = p.x - uCursor;
    float past = dx <= 0.0 ? 1.0 : 0.0;
    float near = exp(-abs(dx) / 5.0);
    float m = lane < 0.0 ? 1.0 : uMask[int(lane)];
    float inSlice = (uSlice > 0.5 && abs(dx) <= uSliceHW) ? 1.0 : 0.0;
    float hot = (isEv > 0.5 && (abs(eid - uHover) < 0.5 || abs(eid - uPick) < 0.5)) ? 1.0 : 0.0;
    float sel = (uSel >= 0.0 && abs(lane - uSel) < 0.5) ? 1.0 : 0.0;
    vHot = hot; vF = isF;
    vGlow = isEv * (uSlice > 0.5 ? inSlice : near * (dx <= 0.0 ? 1.0 : 0.3));
    float base = isEv > 0.5 ? mix(0.2, 0.85, past) + near * 0.3 : 0.7;
    if (uSlice > 0.5 && isEv > 0.5 && uWinOn < 0.5) base *= inSlice > 0.5 ? 1.3 : 0.45;
    // the window: calls inside it read as seen from its anchor (lit, whatever the playhead); outside they dim, never vanish
    float inW = (uWinOn > 0.5 && isEv > 0.5 && et >= uWinA && et <= uWinB) ? 1.0 : 0.0;
    if (uWinOn > 0.5 && isEv > 0.5) { base = inW > 0.5 ? max(base, 0.9) : base * 0.16; vGlow = inW * max(vGlow * (1.0 - uFold), uWinGlow); }
    // zero-in: only the linked session's calls inside the ask's window stay lit — and, like everywhere else,
    // the ones still ahead of the playhead wait at a trace until it reaches them
    float inF = uFocusOn * foc;
    if (uFocusOn > 0.5) { if (isEv > 0.5) { base = inF > 0.5 ? mix(0.22, 1.0, past) : 0.08; vGlow = inF * mix(0.15, 1.0, past); } else base *= 0.6; }
    if (uLift > 0.01 && isF > 0.5) { base = max(base, mix(base, 0.8 + 0.2 * isArt, uLift)); vGlow = max(vGlow, uLift * (0.45 + 0.55 * isArt)); }
    // lens: SESSIONS dims calls from sessions that took a Scout ask, SCOUT dims native ones
    if (isEv > 0.5 && nat >= 0.0) show *= 1.0 - 0.88 * (nat > 0.5 ? uScoutDim : uNatDim);
    // WORKTREES lens: the main checkouts fall back, work done in a worktree stays lit
    if (isEv > 0.5 && wt >= 0.0) show *= 1.0 - 0.88 * uWtLens * (1.0 - wt);
    // SOLO HOST: the other machines' calls fall back to a trace
    if (isEv > 0.5 && uHostSolo > 0.5 && hs < 0.5) show *= 0.1;
    vA = clamp(base, 0.0, 1.0) * m * show;
    vB = color * (1.0 + sel * 0.4);
    // a diamond fills half its sprite: a file's sprite is larger so it weighs the same as a call's square
    float px = uWorld * psize * (1.0 + 0.4 * isF) * (1.0 + (uFocusOn > 0.5 ? inF * 0.35 : inSlice * 0.25 * (1.0 - uWinOn))) * (1.0 + uLift * (0.15 * isF + 0.55 * isArt)) * uScale / -mv.z;
    gl_PointSize = max(px, (isEv > 0.5 ? 1.25 : 0.9) * uPR) + hot * 5.0 * uPR;
    if (show < 0.01) gl_PointSize = 0.0;
  }`;
const FRAG = `
  uniform vec3 uAcc; uniform vec3 uInk; uniform vec3 uHot; uniform float uInkOn; uniform float uTintOn;
  varying float vB; varying float vA; varying float vGlow; varying float vHot; varying vec3 vTint; varying float vF;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (vHot > 0.5) { float d = max(abs(c.x), abs(c.y)); if (d < 0.32 && d > 0.18) discard; gl_FragColor = vec4(uHot, 1.0); return; }
    if (vF > 0.5 && abs(c.x) + abs(c.y) > 0.5) discard;   // a file is a diamond; a tool call stays a square
    float b = clamp(vB, 0.0, 1.0);
    vec3 gray = uInkOn > 0.5 ? mix(uInk, vTint, uTintOn) : vec3(vB) * vTint;
    vec3 acc = uInkOn > 0.5 ? uAcc : uAcc * (0.5 + b * 0.6);
    float glow = clamp(vGlow * (uInkOn > 0.5 ? 0.55 : 0.85), 0.0, 1.0);
    vec3 col = mix(gray, acc, glow);
    float a = uInkOn > 0.5 ? clamp(vA * (0.15 + 0.95 * b), 0.0, 0.9) : vA;
    gl_FragColor = vec4(col, a);
  }`;
const mat = new THREE.ShaderMaterial({ uniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending, vertexShader: VERT, fragmentShader: FRAG });

// event dots
let evGeo = null, evPoints = null, evCount = 0, evCap = 0;
(function buildEvents() {
  const col = [], size = [], lane = [], eid = [], pos = [], pos2 = [], fl = [], ctr = [], nat = [], wt = [];
  events.forEach(e => {
    if (!e.lane) return;
    pos.push(evPos[e.i * 3], evPos[e.i * 3 + 1], evPos[e.i * 3 + 2]);
    pos2.push(evPos2[e.i * 3], evPos2[e.i * 3 + 1], evPos2[e.i * 3 + 2]); fl.push(e.file ? (ARTIFACT.test(e.file) ? 3 : 1) : 0);
    ctr.push(evCtr[e.i * 3], 0, evCtr[e.i * 3 + 2]); nat.push(sessions[e.sess] && !sessions[e.sess].native ? 0 : 1); wt.push(e.wt ? 1 : 0);
    const top = colTop[e.lane.idx][e.bin], lift = top > 1 ? 0.75 + 0.25 * (e.layer / top) : 1;
    e.gi = eid.length; col.push(KIND[e.k].b * lift); size.push(KIND[e.k].s); lane.push(e.lane.idx); eid.push(e.i);
  });
  const p3 = new Float32Array(eid.length * 3), et = new Float32Array(eid.length);
  eid.forEach((i, g) => { p3[g * 3] = evPos3[i * 3]; p3[g * 3 + 1] = evPos3[i * 3 + 1]; p3[g * 3 + 2] = evPos3[i * 3 + 2]; et[g] = evEt[i]; });
  // live: room to grow (doubling, see growEvGeo); the draw range stops at the last real call
  evCount = eid.length; evCap = LIVE ? Math.max(4096, 2 ** Math.ceil(Math.log2(evCount + 2048))) : evCount;
  const F = (arr, k) => { if (!LIVE) return arr; const t = new Float32Array(evCap * k); t.set(arr); return t; };
  evGeo = pointsFrom(F(pos, 3), F(col, 1), F(size, 1), F(lane, 1), F(eid, 1), F(pos2, 3), F(fl, 1), F(ctr, 3), F(nat, 1), F(wt, 1), F(p3, 3), F(et, 1));
  evGeo.setDrawRange(0, evCount);
  evPoints = new THREE.Points(evGeo, mat); if (LIVE) evPoints.frustumCulled = false;
  scene.add(evPoints);
})();
// scaffold: band rails, day meridians, operator rail, ground grid
let scaffoldCount = 0;
(function buildScaffold() {
  const pos = [], col = [], size = [], lane = [], eid = [], fl = [];
  const P = (x, y, z, b, l = -1, s = 0.7, f = 0) => { pos.push(x, y, z); col.push(b); size.push(s); lane.push(l); eid.push(-1); fl.push(f); };
  lanes.forEach(l => {
    for (let x = X0; x <= -X0; x += 2.5) { P(x, 0, l.z + BAND0 - 0.4, 0.16, l.idx, 0.6); }
    for (let b = 1; b < NBANDS; b++) for (let x = X0; x <= -X0; x += 8) P(x, 0, l.z + BAND0 + b * BAND_W, 0.06, l.idx, 0.45);
  });
  for (let d = 0; d <= 8; d++) { const day = midnight(d); if (day < T0 || day > T1) continue;
    const x = xOf(day); for (let z = OPERATOR_Z - 8; z <= Z_MAX; z += 1.6) P(x, 0.02, z, 0.22, -1, 0.6); }
  for (let x = X0; x <= -X0; x += 1.4) P(x, 0, OPERATOR_Z, 0.26, -1, 0.6);
  for (let x = X0 - 24; x <= -X0 + 24; x += 24) for (let z = OPERATOR_Z - 24; z <= Z_MAX + 24; z += 6) P(x, -0.4, z, 0.05, -1, 0.5);
  // the lower floor's rails (fl 2: only drawn while FLOORS is on)
  lanes.forEach(l => { for (let x = X0; x <= -X0; x += 2.5) P(x, -FLOOR_D, l.z + BAND0 - 0.4, 0.14, l.idx, 0.55, 2); });
  for (let x = X0; x <= -X0; x += 1.4) P(x, -FLOOR_D, OPERATOR_Z, 0.2, -1, 0.55, 2);
  // the artifacts floor (fl 4: only while ARTIFACTS is up)
  lanes.forEach(l => { for (let x = X0; x <= -X0; x += 3) P(x, LIFT_H, l.z + BAND0 - 0.4, 0.16, l.idx, 0.55, 4); });
  // the machine bands (fl 5: only as the window folds into the Mesh): a front and a back rail per machine
  MESH_HOSTS.forEach(m => { for (let x = X0; x <= -X0; x += 2) { P(x, 0, m.z0 - 0.4, 0.2, -1, 0.6, 5); P(x, 0, m.z0 + HB_D + 0.2, 0.08, -1, 0.45, 5); } });
  scaffoldCount = pos.length / 3;
  scene.add(new THREE.Points(pointsFrom(pos, col, size, lane, eid, pos, fl), mat));
})();
let totalPts = events.length + scaffoldCount;

let keepOut = [];   // HUD rects over the world that scene labels stay out of (resizeWorld measures them)
function resizeWorld() {
  const r = panelW.getBoundingClientRect(), w = Math.max(50, r.width), h = Math.max(50, r.height);
  const pr = Math.min(2, devicePixelRatio || 1); if (renderer.getPixelRatio() !== pr) { renderer.setPixelRatio(pr); uniforms.uPR.value = pr; } // dragged to another display
  renderer.setSize(w, h, false); camera.aspect = w / h;
  // docked, the time stack runs across the View's foot (styles.ts › the timeline in the View's foot): lift the
  // picture by half the band it covers, so the world centres in the part that is clear. P() and picking both go
  // through the projection, so labels and clicks follow.
  const ts = SLOTTED ? $("tstack") : null, tr = ts && ts.offsetHeight ? ts.getBoundingClientRect() : null;
  const foot = tr && tr.left < r.right && tr.right > r.left ? Math.max(0, Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top)) : 0;
  if (foot > 0) camera.setViewOffset(w, h, 0, Math.round(foot / 2), w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  // the scope rail sits over the world at the right edge: scene labels keep out of it
  const zr = $("zoomrail"), zb = zr && zr.offsetHeight ? zr.getBoundingClientRect() : null;
  keepOut = zb ? [{ x: zb.left - r.left - 6, y: zb.top - r.top - 4, w: zb.width + 12, h: zb.height + 8, rank: 8 }] : [];
  uniforms.uScale.value = h * uniforms.uPR.value / (2 * Math.tan(THREE.MathUtils.degToRad(16)));
  const dpr = Math.min(2, devicePixelRatio || 1); ov.width = w * dpr; ov.height = h * dpr;
}
// idle turn: after a few still seconds the camera sways slowly around wherever you left it (±26°, ~48 s a swing).
// Any input stops it; it resumes from the new angle. A sway, not a spin — a full turn would run time backwards.
// what's on the floor: FILES (stashable dots) · TOOLS (calls with no file) · ASKS (arcs); FLOORS puts tool calls one floor down
let show = { files: true, tools: true, asks: true, sessions: true, worktrees: true }, floors = false, lift = false;
// CLUSTER: how tightly lifted files pack around their group's centre · LENS: everything, native sessions, or Scout work
const SPREADS = [{ k: "tight", v: 0.4 }, { k: "normal", v: 1 }, { k: "loose", v: 1.9 }];
let spread = 1, lens = "all";
const LENSES = ["all", "sessions", "scout", "worktrees"];
const LENS_LABEL = { all: "ALL", sessions: "SESSIONS", scout: "SCOUT", worktrees: "WORKTREES" };
// ROSTER shows who was asked, or what each agent burned (B again while it's focused)
let rosterView = "asked";
try { const v = JSON.parse(localStorage.getItem("world-modale.show") || "null"); if (v) { show = { ...show, ...v.show }; floors = !!v.floors; } } catch {}
const saveShow = () => { try { localStorage.setItem("world-modale.show", JSON.stringify({ show, floors })); } catch {} };
// held movement keys, left hand: Z X turn · C V zoom (⇧ faster)
const held = new Set(); let heldFast = false;
// hoisted: renderViews reads these at boot
let liveOrder = !LIVE, restackAt = 0;   // live holds the seed's lane order: nothing reorders under the operator
const LANE_STYLES = ["plain", "marks", "lines", "tint"];
let laneStyle = "marks"; try { laneStyle = LANE_STYLES.includes(localStorage.getItem("world-modale.lanes")) ? localStorage.getItem("world-modale.lanes") : "marks"; } catch {}
// a plain drag: the pointer's (the world holds still) or the hand's (it orbits); Space held is the hand either way
// drag: the press in progress · mouse: the pointer over the world · gestHeld: what a drag or a scroll does now (move, turn, zoom)
let drag = null, mouse = null, gestHeld = "move";
let autoTurn = !reduced, lastInput = performance.now(), turnBase = null, turnPhase = 0;
const poke = () => { lastInput = performance.now(); turnBase = null; };
function idleTurn(dt) {
  if (!autoTurn || drag || hover || focusWork || flight || tour || performance.now() - lastInput < 3500) return;
  if (turnBase == null) { turnBase = camGoal.az; turnPhase = 0; }
  turnPhase += dt / 48000 * Math.PI * 2;
  const ramp = Math.min(1, turnPhase / 1.2);                  // ease in, no lurch on the first frame
  camGoal.az = turnBase + 0.45 * ramp * Math.sin(turnPhase);
}
function placeCamera(dt) {
  if (flight) { flyStep(); return; }
  if (ride && !drag) { const d = ride.lane.z - ride.lz; if (d) { camGoal.tz += d; cam.tz += d; } ride.lz = ride.lane.z; }
  const k = reduced ? 1 : 1 - Math.pow(0.006, dt / 1000);
  idleTurn(dt);
  if (follow) camGoal.tx = xOf(T) + followDX;
  camGoal.el = clamp(camGoal.el, 0.03, 1.52); camGoal.r = clamp(camGoal.r, 8, 1400);
  boundCam(camGoal);
  for (const p of ["az", "el", "r", "tx", "tz"]) cam[p] += (camGoal[p] - cam[p]) * k;
  applyCam();
}
const wrapAz = (a, ref) => ref + ((((a - ref) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
const nearestLevel = r => { let n = 0; LEVELS.forEach((L, i) => { if (Math.abs(Math.log(L.r / r)) < Math.abs(Math.log(LEVELS[n].r / r))) n = i; }); return n; };
function flyTo(spec) {
  const from = { ...cam }, to = { ...camGoal }; let lane = null;
  if (spec.cam) { const c = cams[spec.cam]; if (!c) return "CAM · NO " + spec.cam.toUpperCase() + " SAVED · :cam save " + spec.cam; Object.assign(to, c); }
  if (spec.view) { to.az = VIEWS[spec.view].az; to.el = VIEWS[spec.view].el; viewName = spec.view; }
  if (spec.level) to.r = LEVELS.find(L => L.k === spec.level).r;
  if (spec.az != null) to.az = spec.az * Math.PI / 180;
  if (spec.el != null) to.el = spec.el * Math.PI / 180;
  to.az = spec.turn != null ? from.az + spec.turn * Math.PI / 180 : wrapAz(to.az, from.az);
  if (spec.home) { to.tx = WORK_X; to.tz = LANE_MID; }
  if (spec.r != null) to.r = spec.r; if (spec.x != null) to.tx = spec.home ? WORK_X + spec.x : spec.x; if (spec.z != null) to.tz = spec.home ? LANE_MID + spec.z : spec.z;
  if (spec.lane) { lane = lanes.find(l => l.name.toLowerCase().includes(spec.lane)); if (!lane) return "NO LANE MATCHES " + spec.lane.toUpperCase(); }
  if (spec.work) { if (!focusWork) return "FLY · ZERO IN FIRST"; const f = workFrame(); to.tx = f.tx; to.r = f.r; }
  to.el = clamp(to.el, 0.03, 1.52); to.r = clamp(to.r, 8, 1400);
  follow = false; ride = null;
  flight = { from, to, spec, lane, t0: performance.now(), dur: Math.max(0, spec.over) * 1000 };
  flyStep();
  return `FLY · ${spec.over ? spec.over + "S" : "CUT"}`;
}
function flyStep() {
  const f = flight, k = f.dur ? clamp((performance.now() - f.t0) / f.dur, 0, 1) : 1;
  const e = f.spec.linear ? k : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const to = { ...f.to };   // live targets: the playhead and the lanes keep moving while you fly
  if (f.spec.cine) return cineStep(f, k, to);
  // with a live target, x / z are offsets from it (playhead + x 6 = a little ahead; lane web z -11 = its session threads)
  if (f.spec.playhead || f.spec.follow) to.tx = xOf(T) + (f.spec.x || 0);
  if (f.lane) to.tz = f.lane.z + (f.spec.z || 0);
  if (f.spec.work && focusWork) to.tz = focusWork.lane.z;
  for (const p of ["az", "el", "r", "tx", "tz"]) cam[p] = camGoal[p] = f.from[p] + (to[p] - f.from[p]) * e;
  boundCam(cam); boundCam(camGoal); applyCam();
  if (k < 1) return;
  flight = null;
  if (f.spec.follow) { follow = true; followDX = f.spec.x || 0; }
  const rl = f.lane || (f.spec.work && focusWork ? focusWork.lane : null); if (rl) ride = { lane: rl, lz: rl.z };
  const n = nearestLevel(cam.r); if (n !== level) { level = n; renderZoomRail(); }
  renderViews();
}
// FRAME: a cinematic route to whatever is pointed. Three beats over one curve: lift away (the camera rises and
// pulls back in proportion to how far it has to travel), cross while high, then settle in. The angle turns late,
// so the move reads as travel first and composition last; a short hop barely lifts and is over quickly
const easeIO = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
function cineStep(f, k, to) {
  const { from } = f, c = f.spec.cine, eT = easeIO(clamp(k / 0.85, 0, 1)), eA = easeIO(clamp((k - 0.2) / 0.8, 0, 1)), arc = Math.sin(Math.PI * k);
  cam.tx = camGoal.tx = from.tx + (to.tx - from.tx) * eT;
  cam.tz = camGoal.tz = from.tz + (to.tz - from.tz) * eT;
  // zoom in log space (each doubling feels the same), lifted mid-route by the crane
  cam.r = camGoal.r = Math.exp(Math.log(from.r) + (Math.log(to.r) - Math.log(from.r)) * easeIO(k)) * (1 + c.lift * arc);
  cam.az = camGoal.az = from.az + (to.az - from.az) * eA;
  cam.el = camGoal.el = clamp(from.el + (to.el - from.el) * eA + c.crane * arc, 0.03, 1.52);
  boundCam(cam); boundCam(camGoal); applyCam();
  if (k < 1) return;
  flight = null; const n = nearestLevel(cam.r); if (n !== level) { level = n; renderZoomRail(); } renderViews();
}
// the world points the pointer's brackets wrap (psBox's set): the session's recent calls and its thread end
function frameSession(se, TR) {
  if (!se || !se.lane) return "FRAME · POINT AT A SESSION FIRST";
  // keep the view you set up (same angle, same tilt); only the aim and the distance change
  const az = cam.az, el = cam.el;
  // aim by measuring, not predicting: stand the camera at the goal, project what the brackets wrap, dolly until the
  // group fills about 40% of the frame, then slide its centre onto the frame's middle; the last passes only re-centre
  const cx = xOf(Math.max(T0, Math.min(se.t1, TR))), cz = se.lane.z;
  const rr = sizeOf(panelW), W = rr.width, H = rr.height, want = { x: W * 0.5, y: H * 0.5 };
  const to = { az, el, r: clamp(cam.r, LEVELS[4].r, LEVELS[1].r), tx: cx, tz: cz }, save = { ...cam };
  const box = () => { Object.assign(cam, to); applyCam(); return psBox(se, W, H, TR, true); };
  for (let i = 0; i < 10; i++) {
    let b = box(); if (!b) { to.r *= 1.6; continue; }
    if (i < 6) {
      const fill = Math.max((b.x1 - b.x0 + 24) / (W * 0.4), (b.y1 - b.y0 + 24) / (H * 0.4));
      to.r = clamp(to.r * clamp(fill, 0.5, 2), LEVELS[4].r * 0.6, LEVELS[0].r);
      b = box(); if (!b) continue;
    }
    const ga = groundAt({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }), gb = groundAt(want);
    if (ga && gb) { to.tx += ga.x - gb.x; to.tz += ga.z - gb.z; boundCam(to); }
  }
  Object.assign(cam, save); applyCam();
  const dist = Math.hypot(to.tx - cam.tx, to.tz - cam.tz), reach = dist / Math.min(cam.r, to.r);
  const lift = clamp(reach * 0.35, 0, 1.4), crane = clamp(reach * 0.06, 0, 0.22);
  const secs = reduced ? 0 : clamp(0.7 + 0.45 * Math.log2(1 + reach), 0.7, 2.6);
  follow = false; ride = null; poke();
  flight = { from: { ...cam }, to, spec: { cine: { lift, crane } }, lane: null, t0: performance.now(), dur: secs * 1000 };
  return "";
}
// the camera as words you can paste after ":fly" in a tour
const camLine = c => `az ${(((c.az * 180 / Math.PI) % 360 + 360) % 360).toFixed(1)} el ${(c.el * 180 / Math.PI).toFixed(1)} r ${c.r.toFixed(1)} x ${c.tx.toFixed(1)} z ${c.tz.toFixed(1)}`;
function applyCam() {
  camera.position.set(cam.tx + Math.sin(cam.az) * Math.cos(cam.el) * cam.r, Math.sin(cam.el) * cam.r, cam.tz + Math.cos(cam.az) * Math.cos(cam.el) * cam.r);
  camera.up.set(0, 1, 0); if (cam.el > 1.4) camera.up.set(0, 0, -1);
  camera.lookAt(cam.tx, Math.min(3, cam.r * 0.08) - FLOOR_D * 0.45 * uniforms.uFloors.value + LIFT_H * 0.4 * uniforms.uLift.value, cam.tz);
  camera.updateMatrixWorld();
}
// the mouse: one meaning per modifier, the same for a drag and a scroll
//   plain → move (the ground stays under the pointer) · ⇧ or the right button → orbit (turn and tilt) · ⌘ → zoom (a drag up goes in)
// ⌥ means nothing here. A press moves nothing until it travels DRAG_SLOP pixels, so a click stays a click
const DRAG_SLOP = 5;
const gestOf = e => e.metaKey ? "zoom" : e.shiftKey ? "turn" : "move";
// the legend in the nav board lights the word for what a drag would do now
function heldGest(e) { const m = gestOf(e); if (m !== gestHeld) { gestHeld = m; paintGest(); } }
const gestNow = () => drag && drag.live ? drag.mode : gestHeld;
function paintGest() { const m = gestNow(); $("navchips")?.querySelectorAll("[data-g]").forEach(x => x.classList.toggle("on", x.dataset.g === m)); }
on(window, "keydown", heldGest, true); on(window, "keyup", heldGest, true);
on(window, "blur", () => { gestHeld = "move"; paintGest(); });
gl.addEventListener("pointerdown", e => {
  poke(); flight = null;
  if (e.ctrlKey && e.button === 0) return;  // macOS: a ctrl-click is the right click
  const mode = e.button === 2 ? "turn" : gestOf(e), p = localPt(e), at = mode === "move" ? groundAt(p) : null;
  // hit: what the pointer was on when pressed. Hover goes blank while a button is down, so a click reads this on release
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, mode, live: false, p, hit: hover, at: at && Math.hypot(at.x - cam.tx, at.z - cam.tz) < cam.r * 1.6 ? { ...at } : null };
  gl.setPointerCapture(e.pointerId); if (focus !== "w" && focus !== "x") setFocus("w");
});
gl.addEventListener("pointermove", e => {
  mouse = localPt(e); heldGest(e);
  if (!drag) return;
  if (!drag.live) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_SLOP) return; drag.live = true; paintGest(); }
  // the first live move carries the slop too: drag.x / y still hold the press
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (drag.mode === "turn") { camGoal.az -= dx * 0.004; camGoal.el += dy * 0.003; }
  else if (drag.mode === "zoom") zoomBy(Math.exp(clamp(dy, -60, 60) * 0.008), drag.p);
  else if (drag.at) {
    const now = groundAt(mouse), mx = now ? drag.at.x - now.x : 0, mz = now ? drag.at.z - now.z : 0;
    // grabbed near the horizon, one pixel can be hundreds of units — switch to a steady screen-space pan
    if (!now || Math.hypot(mx, mz) > cam.r * 0.25) { drag.at = null; panBy(dx, dy, true); } else shiftCam(mx, mz);
  }
  else panBy(dx, dy, true);
  drag.x = e.clientX; drag.y = e.clientY;
});
gl.addEventListener("pointerleave", () => { mouse = null; hover = null; });
gl.addEventListener("pointerup", () => {
  // a press that never left the slop is a click
  if (drag && !drag.live) {
    // a dot is content: it opens on what it was. A session's thread or an ask is who to talk to: it opens the strip
    const hit = drag.hit;
    if (hit) select(hit);
    if (hit && hit.type === "delivery") activateTarget(hit);
    else if (hit && hit.type === "event") { if (psSel) psClose(); openDot(hit.e); }
    else { const tg = psOn && !frozen ? psTargetOf(hit) : null; if (tg) flash(psOpen(tg)); else if (psSel && !hit) psClose(); else if (hit) pick(hit); }
  }
  const was = drag; drag = null; if (was && was.live) paintGest();
});
gl.addEventListener("pointercancel", () => { drag = null; paintGest(); });
function localPt(e) { const r = gl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
// one set of bounds for the goal and the live camera, so a drag never fights a clamp and springs back
function boundCam(c) { c.tx = clamp(c.tx, X0 - 40, -X0 + 40); c.tz = clamp(c.tz, OPERATOR_Z - 60, Z_MAX + 60); }
function shiftCam(mx, mz) {
  ride = null;
  camGoal.tx += mx; camGoal.tz += mz; cam.tx += mx; cam.tz += mz; boundCam(camGoal); boundCam(cam); applyCam();
  if (follow) { follow = false; renderViews(); }
}
// wheel, by device, with the drag's modifiers:
//   trackpad two-finger scroll → move       pinch (ctrl+wheel) or ⌘ + scroll → smooth zoom to cursor
//   ⇧ + scroll → orbit: turn (sideways) and tilt (up / down, on a trackpad)
//   notched mouse wheel → one rung of the ladder per notch, held ~⅓s so a spun wheel stays readable
let wheelAcc = 0, wheelLock = 0, wheelLast = 0, trackpad = false;
gl.addEventListener("wheel", e => {
  e.preventDefault(); poke(); flight = null; heldGest(e);
  const now = performance.now(), px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  if (e.ctrlKey || e.metaKey) { zoomBy(Math.exp(clamp(e.deltaY * px, -60, 60) * 0.012), mouse); return; }
  // before the trackpad sniff: macOS turns a mouse wheel's ⇧ scroll sideways, which would read as a trackpad
  if (e.shiftKey) {
    const sx = clamp(e.deltaX * px, -60, 60), sy = clamp(e.deltaY * px, -60, 60);
    if (trackpad) { camGoal.az += sx * 0.004; camGoal.el -= sy * 0.003; } else camGoal.az += (sx || sy) * 0.004;
    return;
  }
  if (e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40)) trackpad = true;
  const notched = !trackpad && (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40);
  if (!notched) { panBy(-e.deltaX * px, -e.deltaY * px, true); return; }
  const d = clamp(e.deltaY * px, -120, 120);
  if (now - wheelLast > 220) wheelAcc = 0; wheelLast = now;
  if (now < wheelLock) return;
  wheelAcc += d;
  if (Math.abs(wheelAcc) >= 50) { setLevel(level + (wheelAcc > 0 ? -1 : 1), mouse); wheelAcc = 0; wheelLock = now + 340; }
}, { passive: false });
// Safari pinch arrives as gesture events, not ctrl+wheel
let gScale = 1;
gl.addEventListener("gesturestart", e => { e.preventDefault(); poke(); gScale = 1; });
gl.addEventListener("gesturechange", e => { e.preventDefault(); zoomBy(gScale / e.scale, mouse); gScale = e.scale; });
// free zoom between rungs: the ladder still names where you are (nearest rung)
function zoomBy(f, anchor) {
  const r0 = camGoal.r, r1 = clamp(r0 * f, 8, 1400); if (r1 === r0) return;
  const hit = groundAt(anchor);
  if (hit) { const k = r1 / r0; camGoal.tx = hit.x + (camGoal.tx - hit.x) * k; camGoal.tz = hit.z + (camGoal.tz - hit.z) * k; if (follow) { follow = false; renderViews(); } }
  camGoal.r = r1;
  let n = 0; LEVELS.forEach((L, i) => { if (Math.abs(Math.log(L.r / r1)) < Math.abs(Math.log(LEVELS[n].r / r1))) n = i; });
  if (n !== level) { level = n; renderZoomRail(); renderViews(); }
}
// double-click: frame this spot a rung closer (at least DAY)
gl.addEventListener("dblclick", () => setLevel(Math.max(level + 1, 2), mouse));

const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
function groundAt(pt) {
  if (!pt) return null;
  const r = gl.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(pt.x / r.width * 2 - 1, -(pt.y / r.height) * 2 + 1), camera);
  return ray.ray.intersectPlane(ground, hitV) ? { x: hitV.x, z: hitV.z } : null;
}
function setLevel(n, anchor) {
  n = clamp(n, 0, LEVELS.length - 1);
  if (n === level && !anchor) return;
  const r0 = camGoal.r, r1 = LEVELS[n].r;
  if (n === 0) { camGoal.tx = follow ? xOf(T) : WORK_X; camGoal.tz = LANE_MID; }
  else {
    // keep the point under the pointer fixed on screen (zoom-to-cursor); keyboard zooms toward the slice or centre
    const hit = groundAt(anchor) || (slicing ? { x: xOf(sliceStart() + BIN / 2), z: camGoal.tz } : null);
    if (hit) { const f = r1 / r0; camGoal.tx = hit.x + (camGoal.tx - hit.x) * f; camGoal.tz = hit.z + (camGoal.tz - hit.z) * f; if (anchor || slicing) follow = false; }
  }
  level = n; camGoal.r = r1; renderViews(); renderZoomRail(); flash("ZOOM · " + LEVELS[n].k);
}
function panBy(dx, dy, immediate) {
  const r = gl.getBoundingClientRect(), upp = 2 * cam.r * Math.tan(THREE.MathUtils.degToRad(16)) / r.height;
  const sa = Math.sin(cam.az), ca = Math.cos(cam.az), tilt = Math.max(0.35, Math.sin(cam.el));
  const mx = -(dx * ca + dy * sa / tilt) * upp, mz = -(-dx * sa + dy * ca / tilt) * upp;
  ride = null; camGoal.tx += mx; camGoal.tz += mz; boundCam(camGoal); if (immediate) { cam.tx += mx; cam.tz += mz; boundCam(cam); }
  if (follow) { follow = false; renderViews(); }
}
// bottom-left: the last few things the fleet was asked, newest at the foot, streaming in as they land
// where the stream may sit: its last line clears the highest visible control along the bottom of the world (source
// control, window rungs, key hints), measured from the DOM so it follows that row as it grows, wraps or hides; its
// oldest line stays below the camera readout and the lower half of the panel. Re-measured at most 4× a second
const CHAT_ROWS = 12, CHAT_LH = 10.5, SCRIM_FADE = 16, GRID_EDGE = 48;   // GRID_EDGE: the HUD's content edge (styles.ts grid block)
// the chatter starts on the section keys' edge (the W, L, E, F of the panel titles), 16px in, behind everything else
const CHAT_EDGE = 16;
let chatAt = -1e9, chatBase = 0, chatTop = 0;
function chatterBand(h) {
  const now = performance.now(); if (now - chatAt < 250 && chatBase) return;
  chatAt = now;
  const ov = $("ov"); if (!ov) { chatBase = h - 62; chatTop = h * 0.5; return; }
  const r0 = ov.getBoundingClientRect(), H = r0.height || h; let top = H;
  // the scrims: the world dims under the HUD bands so nothing drawn on the canvases ever runs under a control.
  // bottom band = the nav board (bottom left) and the camera readout (bottom right);
  // top band = the title, the filters (top left) and the time controls (top right)
  for (const el of [$("navboard"), $("cam"), $("scan")]) {
    if (!el || el.hidden || !el.offsetHeight) continue;
    top = Math.min(top, el.getBoundingClientRect().top - r0.top);
  }
  let tb = 0;
  for (const el of [ov.parentElement && ov.parentElement.querySelector(":scope > .hd"), $("views"), $("timebar")]) {
    if (!el || el.hidden || !el.offsetHeight) continue;
    tb = Math.max(tb, el.getBoundingClientRect().bottom - r0.top);
  }
  const pw = ov.parentElement;
  if (pw) { pw.style.setProperty("--scrim-b", Math.max(0, Math.round(H - top + SCRIM_FADE)) + "px"); pw.style.setProperty("--scrim-t", Math.round(tb + SCRIM_FADE) + "px"); }
  chatBase = top - SCRIM_FADE - 6;   // middle-aligned text: the last line sits just above the bottom scrim's fade
  chatTop = Math.max(tb + SCRIM_FADE + 6, H * 0.3);
}
/* the chatter feels the world under it: a coarse occupancy grid of terrain dots (a projected sample of the calls so far)
 * and of last frame's overlay labels, rebuilt with the band. Rows thin out over busy terrain and stop short of a label
 * instead of running through it. */
const OCC_C = 8, OCC_MS = 250;
let occD = null, occT = null, occW = 0, occH = 0, occAt = -1e9, occKey = "", occRec = false, occText = [], occTextNext = [];
{ const og = ov.getContext("2d"), raw = og.fillText.bind(og);
  og.fillText = (str, x, y, mw) => {
    if (occRec && x < GRID_EDGE + 480 && y > chatTop - 12) { const tw = og.measureText(str).width, al = og.textAlign;
      occTextNext.push(al === "right" ? x - tw : al === "center" ? x - tw / 2 : x, y, tw); }
    return mw === undefined ? raw(str, x, y) : raw(str, x, y, mw);
  }; }
/* one ledger for the scene's words, so two never print over each other. A label is left out where it would land on one
 * already placed this frame at its rank or above, or on a higher-ranked one placed last frame: the families draw in a
 * fixed order, and last frame's ledger lets a later, higher-ranked family keep its place (a new overlap lasts one frame,
 * then the lower label yields). Ranks: 4 trouble · 3 ask callouts · 2 lane names and pins · 1 session and worktree
 * words · 0 peaks. */
let roomNow = [], roomPrev = [];
function roomFor(x, y, rw, rh, rank, take = true) {
  const hit = r => x < r.x + r.w && x + rw > r.x && y < r.y + r.h && y + rh > r.y;
  if (roomNow.some(r => r.rank >= rank && hit(r)) || roomPrev.some(r => r.rank > rank && hit(r))) return false;
  if (take) roomNow.push({ x, y, w: rw, h: rh, rank });
  return true;
}
function roomTake(x, y, rw, rh, rank) { roomNow.push({ x, y, w: rw, h: rh, rank }); }
// text with a halo of the ground: lines behind it break around the words instead of running through them
function haloText(g, t, x, y) { const a = g.globalAlpha; g.save(); g.globalAlpha = Math.min(1, a * 1.15); g.strokeStyle = theme.ground; g.lineWidth = 3; g.lineJoin = "round"; g.strokeText(t, x, y); g.restore(); g.fillText(t, x, y); }
// one line of text, middle baseline, left-aligned at x
function lineBox(x, y, tw, size) { return [x - 2, y - size * 0.6, tw + 4, size * 1.2]; }
function buildOcc(w, h, TR) {
  const now = performance.now(), key = `${w | 0}x${h | 0}`;
  if (now - occAt < OCC_MS && key === occKey && occD) return; occAt = now; occKey = key;
  occW = Math.ceil(w / OCC_C); occH = Math.ceil(h / OCC_C); occD = new Uint16Array(occW * occH); occT = new Uint8Array(occW * occH);
  const xMax = GRID_EDGE + 480, yMin = chatTop - 12;
  const n = lowerBound(EVT_T, TR + 1), stride = Math.max(1, Math.floor(n / 2400));
  for (let i = 0; i < n; i += stride) {
    const e = EVT[i]; if (e.lane.off || (e.file ? !show.files : !show.tools)) continue;
    const [x, y, z] = evXYZ(e), p = P(x, y, z, w, h); if (!p.vis || p.x < 0 || p.x > xMax || p.y < yMin || p.y >= h) continue;
    const c = ((p.y / OCC_C) | 0) * occW + ((p.x / OCC_C) | 0); if (occD[c] < 65535) occD[c] += stride;
  }
  for (let i = 0; i < occText.length; i += 3) {
    const x0 = occText[i], y = occText[i + 1], x1 = x0 + occText[i + 2];
    for (let cy = Math.max(0, ((y - 5) / OCC_C) | 0); cy <= Math.min(occH - 1, ((y + 5) / OCC_C) | 0); cy++)
      for (let cx = Math.max(0, (x0 / OCC_C) | 0); cx <= Math.min(occW - 1, (x1 / OCC_C) | 0); cx++) occT[cy * occW + cx] = 1;
  }
}
// along one chatter row from x0: where the first label sits (px, or Infinity) and how busy the terrain is (0–1)
function occRow(y, x0, x1) {
  if (!occD) return { stop: Infinity, busy: 0 };
  const cy = clamp((y / OCC_C) | 0, 0, occH - 1), a = Math.max(0, (x0 / OCC_C) | 0), b = Math.min(occW - 1, (x1 / OCC_C) | 0);
  let stop = Infinity, dots = 0, cells = 0;
  for (let cx = a; cx <= b; cx++) { const c = cy * occW + cx; if (occT[c] && stop === Infinity) stop = cx * OCC_C; if (stop === Infinity) { dots += occD[c]; cells++; } }
  return { stop, busy: cells ? Math.min(1, dots / cells / 40) : 0 };
}
// guides (:guides): the edges the HUD actually uses, measured from the DOM. Solid = a line two or more rows share,
// dashed = a line only one row uses (a near-miss to fix or a deliberate exception); a faint 8px grid sits under them
let guidesOn = PQ.get("wmguides") === "1", guidesAt = -1e9, guidesSig = "";
const GUIDE_SRC = [".hd", "#views", "#timebar", "#livebar", "#winbar", "#tally", "#navboard", "#zoomrail", "#cam", "#scan"];
function paintGuides() {
  let el = panelW && panelW.querySelector(".guides");
  if (!guidesOn) { if (el) el.remove(); guidesSig = ""; return; }
  const now = performance.now(); if (now - guidesAt < 250) return; guidesAt = now;
  if (!el) { el = document.createElement("div"); el.className = "guides"; panelW.appendChild(el); }
  const r0 = panelW.getBoundingClientRect(), V = [], H = [];
  for (const sel of GUIDE_SRC) {
    const box = panelW.querySelector(sel); if (!box || box.hidden || !box.offsetHeight) continue;
    const kids = [...box.children].filter(k => k.offsetHeight && k.className !== "br");
    for (const k of kids.length ? kids : [box]) {
      const r = k.getBoundingClientRect(); if (!r.width) continue;
      V.push(r.left - r0.left, r.right - r0.left); H.push(r.top - r0.top, r.bottom - r0.top);
    }
  }
  const cluster = xs => { const out = []; for (const x of xs.map(Math.round).sort((a, b) => a - b)) { const c = out[out.length - 1]; if (c && x - c.x <= 1) c.n++; else out.push({ x, n: 1 }); } return out; };
  const v = cluster(V), hz = cluster(H), sig = JSON.stringify([v, hz, r0.width | 0, r0.height | 0]);
  if (sig === guidesSig) return; guidesSig = sig;
  el.innerHTML = v.map(c => `<i class="gv${c.n > 1 ? " on" : ""}" style="left:${c.x}px"><b>${c.x}</b></i>`).join("")
    + hz.map(c => `<i class="gh${c.n > 1 ? " on" : ""}" style="top:${c.x}px"><b>${c.x}</b></i>`).join("");
}
function setGuides(on) { guidesOn = !!on; guidesAt = -1e9; paintGuides(); return guidesOn ? "GUIDES · ON · SOLID = SHARED EDGE · DASHED = ALONE · 8PX GRID" : "GUIDES · OFF"; }
function drawChatterStream(g, w, h, TR = T, W = null) {
  chatterBand(h);
  const LH = CHAT_LH, nRows = Math.max(3, Math.min(CHAT_ROWS, Math.floor((chatBase - chatTop) / LH) + 1));
  let n = 0; for (let lo = 0, hi = asks.length; lo < hi;) { const m = (lo + hi) >> 1; if (asks[m].ts <= TR) lo = n = m + 1; else hi = m; }
  const rows = asks.slice(Math.max(0, n - nRows), n).filter(a => show.asks && !(laneFor(a.tg) || {}).off && (!W || a.ts >= W.a));
  if (!rows.length) return;
  const x = CHAT_EDGE, base = chatBase, maxW = Math.min(440, w * 0.42), last = Math.max(1, rows.length - 1);
  buildOcc(w, h, TR);
  font(g, 7.5); g.textAlign = "left";
  rows.reverse().forEach((a, k) => {
    const s = stateAt(a, TR), head = `${DOW[new Date(a.ts).getDay()]} ${hhmm(a.ts)}  ${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()}  `;
    const y0 = base - k * LH, hw = g.measureText(head).width, near = occRow(y0, x, x + maxW);
    // a label ahead: the row ends before it; a label right at the start: the row ghosts behind it rather than vanish.
    // busy terrain under the row: it recedes
    const ahead = Math.min(maxW, near.stop - x - 8), blocked = ahead < hw + 36;
    const recede = (1 - 0.8 * near.busy) * (blocked ? 0.3 : 1);
    let body = sq(a.task || ""); const room = (blocked ? maxW : ahead) - hw;
    while (body.length > 4 && g.measureText(body).width > room) body = body.slice(0, -2);
    if (body && body !== sq(a.task || "")) body = body.slice(0, -1) + "…";
    const shown = streamed("feed:" + a.ts + ":" + a.tg.id, body, 80), y = y0;
    // newest at the bottom, oldest fading out toward the top; all of it a background to the surface
    g.globalAlpha = (k === 0 ? 0.42 : 0.32 - (k / last) * 0.28) * recede * (focusWork ? 0.5 : 1);
    g.fillStyle = FAINT; g.fillText(head, x, y);
    const hx = x + g.measureText(head).width;
    g.fillStyle = s === "flight" ? ACC : DIM; g.fillText(shown, hx, y);
    if (shown.length < body.length && caretOn()) { g.fillStyle = ACC; g.fillRect(hx + g.measureText(shown).width + 2, y - 5, 3, 6); }
  });
  g.globalAlpha = 1;
}
function resetCamera() { follow = false; viewName = "iso"; Object.assign(camGoal, { az: VIEWS.iso.az, el: VIEWS.iso.el }); level = 1; setLevel(0); }
function renderZoomRail() {
  $("zoomrail").innerHTML = LEVELS.map((L, i) => `<button class="opt${i === level ? " on" : ""}" data-level="${i}"><i></i>${L.k}</button>`).join("");
}
$("zoomrail").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setLevel(+b.dataset.level); });
/* the window ladder: 1–6 · [ ] · :window. A window ends at the data's last event while the replay plays, at the playhead
 * while it's paused (the bar says which). Its rung picks the camera rung (LEVELS, through flyTo) and the fold. */
lanes.forEach(l => uniforms.uLaneZ0.value[l.idx] = l.z0 + BAND0);
function winNow() {
  if (rung < 0) return null;
  // Include quiet time at the end when this window covers the recording.
  const ms = RUNGS[rung].ms;
  const wholeRecording = ms == null || ms >= SPAN;
  const at = !playing ? "PLAYHEAD" : LIVE ? "WALL CLOCK" : wholeRecording ? "RECORDING END" : "LAST EVENT";
  const anchor = !playing ? T : LIVE ? Math.min(T1, Date.now()) : wholeRecording ? T1 : LAST_EVENT;
  const sp = windowSpan(rung, anchor, T0);
  const i0 = lowerBound(EVT_T, sp.a), i1 = lowerBound(EVT_T, sp.b + 1), a0 = lowerBound(ASK_T, sp.a), a1 = lowerBound(ASK_T, sp.b + 1);
  return { ...sp, rung, R: RUNGS[rung], at, xa: xOf(sp.a), xb: xOf(sp.b), i0, i1, a0, a1, calls: i1 - i0, nAsks: a1 - a0 };
}
// per-machine counts for the window, recounted only when its edges move
let winCountsKey = "", winCounts = null;
function winHostCounts(w) {
  const key = w.a + ":" + w.b; if (key === winCountsKey) return winCounts;
  const calls = new Array(MESH_HOSTS.length).fill(0), byHost = new Map();
  for (let i = w.i0; i < w.i1; i++) calls[evHostK[EVT[i].i]]++;
  for (let i = w.a0; i < w.a1; i++) { const h = actorHost(asks[i].tg); byHost.set(h, (byHost.get(h) || 0) + 1); }
  winCountsKey = key; return (winCounts = { calls, asks: byHost });
}
let waitingForWindow = false;
function setRung(i, restoring = false, toggle = false) {
  if (toggle && i === rung && !waitingForWindow) i = "off";
  waitingForWindow = !restoring && !!opts.onWindow?.(RUNGS[i] ? i : -1, RUNGS[i]?.k ?? "off");
  if (waitingForWindow) return "LOADING " + RUNGS[i].label + " HISTORY";
  if (i === "off" || i < 0) { const was = rung; rung = -1; win = null; renderWinbar(); return was < 0 ? "WINDOW · NONE OPEN" : `WINDOW · OFF · ${WHOLE_SPAN}`; }
  rung = i; const R = RUNGS[i]; win = winNow(); restackAt = 0;
  // the camera: the rung's framing on the window's middle; the whole week frames home; the Mesh centres on the machine bands
  const zc = R.fold >= 1 ? MESH_MID : LANE_MID;
  // the Mesh is read from higher up, so the machine bands stack as rows instead of crowding the horizon
  const look = R.fold >= 1 ? { az: -6, el: 54 } : { view: VIEWS[viewName] ? viewName : "iso" };   // the World rungs return to the chosen view's angle
  const over = restoring ? 0 : 1.2;
  flyTo(R.ms == null ? { level: R.level, home: true, z: zc - LANE_MID, over, ...look } : { level: R.level, x: (win.xa + win.xb) / 2, z: zc, over, ...look });
  renderWinbar(); poke();
  const lv = foldLevel(R.fold);
  return `WINDOW · ${R.label} · ${lv}${win.calls || win.nAsks ? ` · ${win.calls.toLocaleString("en-US")} CALLS · ${win.nAsks} ASKS` : " · NOTHING IN IT"}`;
}
function renderWinbar() {
  const w = win, lv = w ? foldLevel(w.R.fold) : null;
  const btns = RUNGS.map((R, i) => `<button class="opt${i === rung ? " on" : ""}" data-rung="${i}" title="${R.label} (${i + 1})">${R.label}</button>`).join("");
  let line2;
  if (!w) line2 = "";
  else {
    const anchor = `ANCHOR · <b>${w.at}</b> ${dayTag(w.b)} ${hhmm(w.b)}`;
    const span = `${spanLabel(w.b - w.a)} · ${dayTag(w.a)} ${hhmm(w.a)}–${hhmm(w.b)}`;
    const what = w.calls || w.nAsks ? `${w.calls.toLocaleString("en-US")} CALLS · ${w.nAsks} ASKS` : `<span class="acc">NOTHING IN THIS WINDOW · ${spanLabel(w.R.ms || (w.b - w.a))} BEFORE ${w.at}</span>`;
    line2 = `${anchor} · ${span} · ${what}${w.clamped ? ` · <span class="faint">LONGER THAN THE SNAPSHOT · SHOWS ALL OF IT</span>` : ""}${w.at === "LAST EVENT" ? ` · <span class="faint">NOT THE WALL CLOCK · PAUSE TO ANCHOR AT THE PLAYHEAD</span>` : ""}`;
  }
  later($("winbar"), `<div class="wr"><span class="wl">WINDOW <kbd>1–6</kbd></span><span class="seg">${btns}</span>${w ? `<span class="wf"><b>${lv}</b> · ${FOLD_BLURB[lv]}</span>` : ""}</div>${line2 ? `<div class="wa">${line2}</div>` : ""}`);
}
$("winbar").addEventListener("click", e => { const b = e.target.closest("button"); if (b) flash(setRung(+b.dataset.rung, false, true)); });
renderWinbar();
function setView(n) { viewName = n; camGoal.az = VIEWS[n].az; camGoal.el = VIEWS[n].el; renderViews(); flash("VIEW · " + VIEWS[n].label); }
// the filter rows stay folded behind one chip; what differs from the defaults is spelled out beside it
let filtersOpen = false;
// chatter: what the fleet is saying, written on the world — ask text beside the arcs, session prompts, and a stream bottom-left
let chatter = true;
try { chatter = localStorage.getItem("world-modale.chatter") !== "0"; } catch {}
function setChatter(on) { chatter = !!on; try { localStorage.setItem("world-modale.chatter", chatter ? "1" : "0"); } catch {} renderViews(); flash(chatter ? "CHATTER · ON" : "CHATTER · OFF · HOVER STILL TAGS"); }
try { filtersOpen = localStorage.getItem("world-modale.filters") === "1"; } catch {}
function toggleFilters() { filtersOpen = !filtersOpen; try { localStorage.setItem("world-modale.filters", filtersOpen ? "1" : "0"); } catch {} renderViews(); }
function filterSummary() {
  const out = [];
  // only what is drawn: the camera and arrangement show on the nav board's own chips
  const hid = Object.keys(show).filter(k => !show[k]); if (hid.length) out.push("HIDDEN " + hid.join(" ").toUpperCase());
  if (lens !== "all") out.push("LENS " + LENS_LABEL[lens]); if (!chatter) out.push("CHATTER OFF");
  if (soloHost) out.push("SOLO " + hostLabel(soloHost).toUpperCase()); if (tour) out.push("TOUR · " + tour.name.toUpperCase());
  return out.join(" · ");
}
function renderViews() {
  // kind: "" = a control (does something), "tog" = a toggle (a mode that stays), "flt" = a filter (what is drawn),
  // "opt" = one option of a choice (inside a .seg). The look of each is the design language in styles.ts.
  const c = (on, attr, label, kbd = "", kind = "") => `<button class="chip${kind ? " " + kind : ""}${on ? " on" : ""}" ${attr}${kind === "tog" || kind === "flt" ? ` aria-pressed="${!!on}"` : ""}>${label}${kbd ? `<kbd>${kbd}</kbd>` : ""}</button>`;
  renderNav(c);
  const sum = filterSummary(); $("views").classList.toggle("open", filtersOpen);
  // focus: one agent lit. Its chip sits beside FILTERS, open or shut; a click (or Esc with no panel focused) lets go
  const fc = focusAgent ? c(true, `data-unfocus="1" title="${esc(spoken(focusAgent))} lit, the rest quiet · click or Esc to let go"`, `FOCUS <b>${esc(focusAgent.short.toUpperCase())}</b> ×`) : "";
  if (!filtersOpen) { $("views").innerHTML = c(false, 'data-filters="1"', "FILTERS ▸", "\\") + fc + (sum ? `<span class="vsum">${sum}</span>` : ""); return; }
  // open: a sheet under the chip, a row per group; a crowded group wraps its own chips
  const grp = (label, chips, key = "") => `<div class="vg"><span class="vlbl">${label}${key ? `<em>${key}</em>` : ""}</span><div class="vc">${chips}</div></div>`;
  $("views").innerHTML = `<div class="vbar">`
    + `<div class="vhd">${c(true, 'data-filters="1"', "FILTERS ▾", "\\")}${fc}</div>`
    // what's drawn
    + grp("SHOW", c(show.files, 'data-show="files"', "FILES", "", "flt") + c(show.tools, 'data-show="tools"', "TOOLS", "", "flt") + c(show.asks, 'data-show="asks"', "ASKS", "", "flt") + c(show.sessions, 'data-show="sessions"', "SESSIONS", "", "flt") + c(show.worktrees, 'data-show="worktrees"', "WORKTREES", "", "flt")
      + (stash.length ? c(false, 'data-tab="s"', `STASH ${stash.length}`, "⇧S") : ""))
    // what the fleet is saying, on the world
    + grp("CHATTER", c(chatter, 'data-chatter="1" title="The latest asks, written over the view · :chatter"', "LATEST ASKS", "", "tog"))
    // whose work
    + grp("LENS", `<span class="seg">${LENSES.map(l => c(lens === l, `data-lens="${l}"`, LENS_LABEL[l], "", "opt")).join("")}</span>`, "M")
    + `</div>`;
}
// the nav board, bottom left: how the camera moves, then (on hover) how the world is laid out. Zoom levels and CENTER sit
// beside these chips in the board's markup.
function renderNav(c) {
  const el = $("navchips"); if (!el) return;
  const g = (k, key, word) => `<span data-g="${k}"${gestNow() === k ? ' class="on"' : ""}>${key} <b>${word}</b></span>`;
  el.innerHTML = c(autoTurn, 'data-turn="1"', "TURN", "", "tog") + c(follow, 'data-follow="1"', "FOLLOW", "F", "tog") + c(focusWork, 'data-zero="1"', "ZERO IN", "Q", "tog")
    // the mouse, always in view: a drag or a scroll moves; hold Shift to orbit, Cmd to zoom. The word for what a drag does now is lit.
    // Keys in words: ⇧ and ⌘ don't read at this size, and TURN is already the chip beside it
    + `<div class="gest" title="A drag or two fingers move the camera. Hold Shift to orbit (turn and tilt) or Cmd to zoom, with a drag or a scroll. A right-drag orbits too; a pinch zooms.">`
    + g("move", "DRAG", "MOVE") + g("turn", "SHIFT", "ORBIT") + g("zoom", "CMD", "ZOOM") + `</div>`
    + `<div class="arr">`
    + c(liveOrder, 'data-live="1"', "LIVE ORDER", "", "tog") + c(lift, 'data-lift="1"', "ARTIFACTS ↑", "U", "tog") + c(floors, 'data-floors="1"', "TOOLS BELOW", "", "tog")
    + c(false, 'data-lanes="1"', `LANES <b>${laneStyle.toUpperCase()}</b>`) + c(false, 'data-spread="1"', `CLUSTER <b>${SPREADS[spread].k.toUpperCase()}</b>`, "O")
    + `</div>`;
}
function onViewsClick(e) { const b = e.target.closest("button"); if (!b) return; if (b.dataset.filters) return toggleFilters(); if (b.dataset.view) setView(b.dataset.view); if (b.dataset.show) { const key = b.dataset.show; show[key] = !show[key]; saveShow(); renderViews(); flash(`${key.toUpperCase()} · ${show[key] ? "SHOWN" : "HIDDEN"}${key === "tools" && !show.tools ? " · ONLY STASHABLE FILES" : ""}`); }
  if (b.dataset.chatter) setChatter(!chatter);
  if (b.dataset.unfocus) flash(setFocusAgent(null));
  if (b.dataset.tab === "s") showStash();
  if (b.dataset.lift) toggleLift();
  if (b.dataset.spread) cycleSpread();
  if (b.dataset.lens) setLens(b.dataset.lens);
  if (b.dataset.floors) { floors = !floors; saveShow(); renderViews(); flash(floors ? "TOOLS BELOW · TOOL CALLS ONE FLOOR DOWN" : "ONE GROUND"); }
  if (b.dataset.follow) toggleFollow(); if (b.dataset.live) { liveOrder = !liveOrder; restackAt = 0; renderViews(); flash(liveOrder ? "LIVE ORDER · BUSIEST AT THE CENTRE" : "LIVE ORDER · OFF · THE WEEK'S ORDER"); } if (b.dataset.lanes) { applyLaneStyle(LANE_STYLES[(LANE_STYLES.indexOf(laneStyle) + 1) % LANE_STYLES.length]); flash("LANES · " + laneStyle.toUpperCase()); } if (b.dataset.turn) { autoTurn = !autoTurn; if (!autoTurn && turnBase != null) camGoal.az = cam.az; turnBase = null; renderViews(); flash(autoTurn ? "TURN · ON" : "TURN · OFF"); } if (b.dataset.zero) zeroIn(); }
$("views").addEventListener("click", onViewsClick);
$("navchips")?.addEventListener("click", onViewsClick);
function toggleFollow() { follow = !follow; followDX = 0; if (!follow) camGoal.tx = cam.tx; renderViews(); flash(follow ? "FOLLOW · ON" : "FOLLOW · OFF"); }
renderViews(); renderZoomRail();

const v3 = new THREE.Vector3();
function P(x, y, z, w, h) { v3.set(x, y, z).project(camera); return { x: (v3.x + 1) / 2 * w, y: (1 - v3.y) / 2 * h, vis: v3.z < 1 && v3.z > -1, d: v3.z }; }

/* picking: nearest event dot or ask arc under the pointer */
let hover = null, arcHits = [], sessHits = [], wtHits = [], troubleHits = [];
// where a dot is drawn right now — mirrors the vertex shader (floors blend, stack height, live lane)
function evXYZ(e) {
  const i = e.i * 3, up = uniforms.uLift.value, f = e.file ? Math.max(uniforms.uFloors.value, up) : uniforms.uFloors.value, L = LAYER_H;
  const ay = 0.3 + (evPos[i + 1] - 0.3) * L, by = e.file ? 0.3 + (evPos2[i + 1] - 0.3) * L : -FLOOR_D - (evPos2[i + 1] - 0.3) * L;
  const sp = e.file ? uniforms.uSpread.value : 1, bx = e.file ? evCtr[i] + (evPos2[i] - evCtr[i]) * sp : evPos2[i], bz = e.file ? evCtr[i + 2] + (evPos2[i + 2] - evCtr[i + 2]) * sp : evPos2[i + 2];
  const fo = uniforms.uFold.value, lf = sstep(0, 0.5, fo), mf = sstep(0.5, 1, fo), zf = e.lane.z0 + BAND0;
  let x = evPos[i] + (bx - evPos[i]) * f, y = ay + (by - ay) * f + (e.file ? up * LIFT_H : 0), z = evPos[i + 2] + (bz - evPos[i + 2]) * f;
  z = zf + (z - zf) * (1 - 0.55 * lf) + (e.lane.z - e.lane.z0) * (1 - mf);
  if (mf > 0) { x += (evPos3[i] - x) * mf; y += (0.3 + (evPos3[i + 1] - 0.3) * L - y) * mf; z += (evPos3[i + 2] - z) * mf; }
  return [x, y, z];
}
function sstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
const PM = new THREE.Matrix4();
function findHover(w, h) {
  if (!mouse || drag) return null;
  PM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); const m = PM.elements;
  let best = null, bd = 64;
  const anyMask = lanes.some(l => l.solo || l.off);
  // with a window only its own calls are candidates: walk the time-sorted index between its edges
  const src = win ? EVT : events, i0 = win ? lowerBound(EVT_T, win.a) : 0, i1 = win ? lowerBound(EVT_T, win.b + 1) : events.length;
  for (let ii = i0; ii < i1; ii++) {
    const e = src[ii];
    if (!e.lane) continue;
    if (anyMask && maskBase(e.lane) < 0.5) continue;
    if (win ? e.t < win.a || e.t > win.b : e.t > T + BIN && !slicing) continue;   // a window grabs only what it lights
    if (focusWork && !focusWork.set.has(e)) continue;
    if (e.file ? !show.files : (!show.tools || lift)) continue;   // hidden things can't be grabbed; ARTIFACTS up = files only
    if ((lens === "sessions" || lens === "scout") && sessions[e.sess] && (lens === "scout") === sessions[e.sess].native) continue;
    if (lens === "worktrees" && !e.wt) continue;
    const [x, y, z] = evXYZ(e);
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15]; if (cw <= 0) continue;
    const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) / 2 * w, sy = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) / 2 * h;
    const d = (sx - mouse.x) ** 2 + (sy - mouse.y) ** 2; if (d < bd) { bd = d; best = { type: "event", e, sx, sy }; }
  }
  for (const a of arcHits) for (let i = 1; i < a.pts.length; i++) {
    const p = a.pts[i - 1], q = a.pts[i], vx = q.x - p.x, vy = q.y - p.y, L2 = vx * vx + vy * vy || 1;
    const t = clamp(((mouse.x - p.x) * vx + (mouse.y - p.y) * vy) / L2, 0, 1), d = (p.x + vx * t - mouse.x) ** 2 + (p.y + vy * t - mouse.y) ** 2;
    if (d < bd * 0.8) { bd = d; best = { type: "ask", a: a.ask, sx: p.x + vx * t, sy: p.y + vy * t }; }
  }
  for (const h of sessHits) {
    const p = h.a, q = h.b, vx = q.x - p.x, vy = q.y - p.y, L2 = vx * vx + vy * vy || 1;
    const t = clamp(((mouse.x - p.x) * vx + (mouse.y - p.y) * vy) / L2, 0, 1), d = (p.x + vx * t - mouse.x) ** 2 + (p.y + vy * t - mouse.y) ** 2;
    if (d < bd * 0.6) { bd = d; best = { type: "session", s: h.s, sx: p.x + vx * t, sy: p.y + vy * t }; }
  }
  for (const h of wtHits) {
    const p = h.a, q = h.b, vx = q.x - p.x, vy = q.y - p.y, L2 = vx * vx + vy * vy || 1;
    const t = clamp(((mouse.x - p.x) * vx + (mouse.y - p.y) * vy) / L2, 0, 1), d = (p.x + vx * t - mouse.x) ** 2 + (p.y + vy * t - mouse.y) ** 2;
    if (d < bd * 0.6) { bd = d; best = { type: "worktree", wt: h.wt, sx: p.x + vx * t, sy: p.y + vy * t }; }
  }
  for (const hit of troubleHits) {
    const distance = (hit.sx - mouse.x) ** 2 + (hit.sy - mouse.y) ** 2;
    if (distance < 225) { best = hit; break; }
  }
  return best;
}

// left rail: a heading tape. Drag it up / down to turn the world; the iso angle is the home detent.
const turnEl = $("turnrail"), TAPE_DEG = 180;
const azDeg = a => ((a * 180 / Math.PI) % 360 + 360) % 360;
function drawTurnRail(g, pr) {
  const tr = turnEl.getBoundingClientRect(); if (!tr.height) return;
  const ax = tr.left - pr.left + tr.width - 6, a1 = tr.top - pr.top, a0 = tr.bottom - pr.top, mid = (a0 + a1) / 2, half = (a0 - a1) / 2, ppd = (a0 - a1) / TAPE_DEG;
  const cur = azDeg(cam.az), home = azDeg(VIEWS.iso.az), hot = turnDrag || turnHover;
  g.strokeStyle = hot ? FAINT : LINE; g.beginPath(); g.moveTo(ax + .5, a1); g.lineTo(ax + .5, a0); g.stroke();
  font(g, 7);
  for (let d = Math.ceil((cur - TAPE_DEG / 2) / 5) * 5; d <= cur + TAPE_DEG / 2; d += 5) {
    const y = mid + (d - cur) * ppd, dd = ((d % 360) + 360) % 360, big = dd % 45 === 0, med = dd % 15 === 0;
    g.globalAlpha = Math.max(0.1, 1 - Math.abs(y - mid) / half); g.strokeStyle = big ? FG : med ? DIM : FAINT;
    g.beginPath(); g.moveTo(ax - (big ? 8 : med ? 5 : 2.5), Math.round(y) + .5); g.lineTo(ax, Math.round(y) + .5); g.stroke();
    if (big && Math.abs(y - mid) > 9) { g.fillStyle = DIM; g.textAlign = "right"; g.fillText(String(dd).padStart(3, "0"), ax - 11, y); }
    if (Math.abs(dd - Math.round(home / 5) * 5) < 0.5) { g.strokeStyle = DIM; g.strokeRect(ax + 3.5, Math.round(y) - 2.5, 5, 5); }
  }
  g.globalAlpha = 1;
  // the needle: where you're looking from, now
  g.strokeStyle = ACC; g.beginPath(); g.moveTo(ax - 14, Math.round(mid) + .5); g.lineTo(ax + 2, Math.round(mid) + .5); g.stroke();
  g.fillStyle = ACC; g.beginPath(); g.moveTo(ax + 2, mid); g.lineTo(ax + 7, mid - 3.5); g.lineTo(ax + 7, mid + 3.5); g.closePath(); g.fill();
  g.textAlign = "right"; font(g, 8); g.fillText(String(Math.round(cur)).padStart(3, "0") + "°", ax - 16, mid);
  g.save(); g.translate(ax - 26, a1 + 34); g.rotate(-Math.PI / 2); g.fillStyle = hot ? DIM : FAINT; g.textAlign = "center"; font(g, 6.5); g.fillText("TURN", 0, 0); g.restore();
}
let turnDrag = null, turnHover = false;
const turnBy = deg => { const da = deg * Math.PI / 180; camGoal.az += da; cam.az += da; poke(); };
on(turnEl, "pointerenter", () => turnHover = true); on(turnEl, "pointerleave", () => turnHover = false);
on(turnEl, "pointerdown", e => { turnDrag = { y: e.clientY }; turnEl.setPointerCapture(e.pointerId); e.preventDefault(); });
on(turnEl, "pointermove", e => { if (!turnDrag) return; const ppd = turnEl.getBoundingClientRect().height / TAPE_DEG; turnBy((e.clientY - turnDrag.y) / ppd); turnDrag.y = e.clientY; });
on(turnEl, "pointerup", () => { if (turnDrag) flash("TURN · " + String(Math.round(azDeg(camGoal.az))).padStart(3, "0") + "°"); turnDrag = null; });
on(turnEl, "wheel", e => { e.preventDefault(); turnBy(e.deltaY * 0.25); }, { passive: false });
on(turnEl, "dblclick", () => { const d = ((VIEWS.iso.az - camGoal.az) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; camGoal.az += d; poke(); flash("TURN · ISO"); });
// CENTER: bring the playhead (or the slice) to the middle of the world, keeping zoom and angle
function centerOnNow() { follow = false; camGoal.tx = xOf(slicing ? sliceStart() + BIN / 2 : T); camGoal.tz = LANE_MID; boundCam(camGoal); poke(); renderViews(); flash("CENTER · " + dayTag(T) + " " + hhmm(T)); }
$("centerBtn").addEventListener("click", centerOnNow);

let pins = [], pinSel = -1, lastHoverKey = null;
/* the window on the world: its two edges across the ground, the playhead still marked while the replay plays */
function drawWindowSlab(g, w, h, W, zMin) {
  const mf = sstep(0.5, 1, uniforms.uFold.value), last = MESH_HOSTS[MESH_HOSTS.length - 1];
  const za = mf > 0.5 && last ? MESH_HOSTS[0].z0 - 6 : zMin, zb = mf > 0.5 && last ? last.z0 + HB_D + 3 : Z_MAX;
  const A0 = P(W.xa, 0, za, w, h), A1 = P(W.xa, 0, zb, w, h), B0 = P(W.xb, 0, za, w, h), B1 = P(W.xb, 0, zb, w, h);
  if (A0.vis && A1.vis && B0.vis && B1.vis) { g.fillStyle = ACC; g.globalAlpha = 0.045; g.beginPath(); g.moveTo(A0.x, A0.y); g.lineTo(B0.x, B0.y); g.lineTo(B1.x, B1.y); g.lineTo(A1.x, A1.y); g.closePath(); g.fill(); }
  g.strokeStyle = ACC; g.globalAlpha = 0.8; g.setLineDash([3, 3]);
  [[A0, A1], [B0, B1]].forEach(([p, q]) => { if (!p.vis || !q.vis) return; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); });
  g.setLineDash([]); g.globalAlpha = 1;
  const top = P(W.xb, 14, za, w, h);
  if (B0.vis && top.vis) { g.strokeStyle = ACC; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(B0.x, B0.y); g.lineTo(top.x, top.y); g.stroke(); g.globalAlpha = 1;
    font(g, 8.5); g.fillStyle = ACC; g.textAlign = "left";
    g.fillText(`WINDOW · ${W.R.label} · ${W.at} ${dayTag(W.b)} ${hhmm(W.b)} · ${W.calls.toLocaleString("en-US")} CALLS · ${W.nAsks} ASKS`, top.x + 6, top.y); }
  if (playing && Math.abs(xOf(T) - W.xb) > 0.05) { const a = P(xOf(T), 0, za, w, h), b = P(xOf(T), 0, zb, w, h);
    if (a.vis && b.vis) { g.strokeStyle = FG; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.globalAlpha = 0.6; font(g, 7.5); g.fillStyle = FG; g.textAlign = "left"; g.fillText(`PLAYHEAD ${dayTag(T)} ${hhmm(T)}`, a.x + 5, a.y + 10); g.globalAlpha = 1; } }
}
/* short windows: the newest calls inside it, readable where they sit */
function drawWindowCalls(g, w, h, W, lf) {
  const placed = []; let n = 0; font(g, 7.5); g.textAlign = "left";
  for (let i = W.i1 - 1; i >= W.i0 && n < 14; i--) {
    const e = EVT[i]; if (e.lane.off || (e.file ? !show.files : !show.tools)) continue;
    if (soloHost && sessHostOf(e.sess) !== soloHost) continue;
    const [x, y, z] = evXYZ(e), p = P(x, y, z, w, h); if (!p.vis || p.x < 40 || p.x > w - 60) continue;
    const txt = `${hhmm(e.t)}:${pad(new Date(e.t).getSeconds())} ${KIND[e.k].label} · ${e.name}${e.tgt ? " " + sq(e.tgt).slice(0, 48) : ""}`, tw = g.measureText(txt).width;
    let ty = p.y - 8; for (let k = 0; k < 4 && placed.some(r => Math.abs(r.y - ty) < 10 && p.x + 6 < r.x1 && p.x + 6 + tw > r.x0); k++) ty -= 10;
    if (placed.some(r => Math.abs(r.y - ty) < 10 && p.x + 6 < r.x1 && p.x + 6 + tw > r.x0)) continue;
    placed.push({ x0: p.x + 6, x1: p.x + 6 + tw, y: ty }); n++;
    g.globalAlpha = (1 - 2 * lf) * (n === 1 ? 0.95 : 0.7); g.strokeStyle = LINE; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 5, ty); g.stroke();
    g.fillStyle = n === 1 ? ACC : FG; g.fillText(txt, p.x + 6, ty);
  }
  g.globalAlpha = 1;
}
/* the Mesh fold: a band per machine (persona · host), its calls and asks in the window; asks between machines fly as
 * traffic at the moment each one launched (xOf(a.ts)), asks that stayed on one machine tick along its band's front edge */
function drawMeshBands(g, w, h, W, mf, TR) {
  const halfW = cam.r * Math.tan(THREE.MathUtils.degToRad(16)) * (w / h), lx = clamp(cam.tx - halfW * 0.72, X0 - 4, -X0 + 4);
  const counts = W ? winHostCounts(W) : null;
  g.globalAlpha = mf;
  MESH_HOSTS.forEach(m => {
    const p = P(lx, 0, m.zc, w, h); if (!p.vis || p.x < 30 || p.x > w - 30) return;
    const away = soloHost && m.host !== soloHost;
    font(g, 9); g.textAlign = "left"; g.fillStyle = away ? FAINT : (m.host && m.host === soloHost ? ACC : FG);
    g.fillText(m.host ? `${m.name.toUpperCase()} · ${m.host}` : "NO HOST · SESSIONS THAT NAME NO MACHINE", p.x, p.y - 6);
    font(g, 7.5); g.fillStyle = DIM;
    const nc = counts ? counts.calls[m.k] : m.n, na = counts ? counts.asks.get(m.host) || 0 : 0;
    g.fillText(counts ? `${nc.toLocaleString("en-US")} CALLS · ${na} ASKS IN THE WINDOW` : `${nc.toLocaleString("en-US")} CALLS · THE WEEK`, p.x, p.y + 5);
    if (cam.r < 120) { font(g, 6.5); g.fillStyle = FAINT; g.textAlign = "right";
      lanes.forEach(l => { const q = P(clamp(cam.tx + halfW * 0.55, X0, -X0), 0, m.z0 + l.idx * HB_SUB + HB_SUB / 2, w, h); if (q.vis) g.fillText(l.name.toUpperCase(), q.x, q.y); }); }
  });
  if (!W || !show.asks) { g.globalAlpha = 1; return; }
  let cross = 0, local = 0; const ticks = new Map(), labels = [];
  for (let i = W.a0; i < W.a1; i++) {
    const a = asks[i], mt = MESH_BY.get(actorHost(a.tg)), mr = a.rq ? MESH_BY.get(actorHost(a.rq)) : null; if (!mt) continue;
    const x = xOf(a.ts), s = stateAt(a, TR);
    if (!mr || mr === mt) { local++; (ticks.get(mt) || ticks.set(mt, []).get(mt)).push(x); continue; }
    cross++;
    const lift = 6 + Math.abs(mt.zc - mr.zc) * 0.22, pts = [];
    for (let k = 0; k <= 16; k++) { const f = k / 16; pts.push(P(x, 0.6 + Math.sin(f * Math.PI) * lift, mr.zc + (mt.zc - mr.zc) * f, w, h)); }
    if (!pts[0].vis || !pts[16].vis) continue;
    arcHits.push({ ask: a, pts });
    g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
    if (s === "flight") { g.strokeStyle = ACC; g.setLineDash([3, 3]); g.lineDashOffset = -performance.now() / 50; g.globalAlpha = mf; }
    else { g.strokeStyle = FG; g.setLineDash(s === "stuck" ? [1, 3] : []); g.globalAlpha = mf * (s === "failed" ? 0.45 : 0.75); }
    g.stroke(); g.setLineDash([]);
    const e = pts[16]; if (s === "failed") { g.beginPath(); g.moveTo(e.x - 3, e.y - 3); g.lineTo(e.x + 3, e.y + 3); g.moveTo(e.x + 3, e.y - 3); g.lineTo(e.x - 3, e.y + 3); g.stroke(); }
    else { g.fillStyle = s === "flight" ? ACC : FG; g.fillRect(e.x - 1.5, e.y - 1.5, 3, 3); }
    labels.push({ a, p: pts[8], s });
  }
  // one path per machine: a tick per ask that stayed on it, at its own time
  ticks.forEach((xs, m) => { g.strokeStyle = FG; g.globalAlpha = mf * 0.5; g.beginPath();
    xs.forEach(x => { const p = P(x, 0, m.z0 - 1.4, w, h), q = P(x, 2.4, m.z0 - 1.4, w, h); if (p.vis && q.vis) { g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); } }); g.stroke(); });
  font(g, 7.5); g.textAlign = "left"; const placed = [];
  (cam.r < 120 ? labels.slice(-12) : []).forEach(({ a, p, s }) => {   // names on the arcs once the framing is a day or closer let y = p.y - 6; for (let k = 0; k < 3 && placed.some(r => Math.abs(r.y - y) < 10 && Math.abs(r.x - p.x) < 140); k++) y -= 10;
    placed.push({ x: p.x, y }); g.globalAlpha = mf * 0.9; g.fillStyle = s === "flight" ? ACC : FG;
    g.fillText(`${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()} · ${hostLabel(actorHost(a.rq)).toUpperCase()} → ${hostLabel(actorHost(a.tg)).toUpperCase()}`, p.x + 4, y); });
  const first = MESH_HOSTS[0]; if (first) { const p = P(lx, 0, first.z0 - 7, w, h); if (p.vis) { font(g, 7.5); g.fillStyle = DIM; g.globalAlpha = mf; g.textAlign = "left";
    g.fillText(`ASKS IN THE WINDOW · ${cross} BETWEEN MACHINES (ARCS) · ${local} ON ONE MACHINE (TICKS)${UNPLACED ? ` · ${UNPLACED.toLocaleString("en-US")} CALLS NAME NO MACHINE` : ""}`, p.x, p.y); } }
  g.globalAlpha = 1;
}
/* trouble on the world: a failure blooms once as it lands at the head, then keeps a ring, a dot and a scar across its
 * lane's slab at its time; a stuck item gets a dashed bracket from when it was sent to now and a slow halo that widens with
 * its age; a resolve shrinks a ring into the spot. Only real trouble draws (trouble.ts): reconciled deliveries, tool-call
 * errors and stale items are quiet counts in the tally, no marks. Drawn after the arcs and pins; under :errors a veil goes down first */
function drawTrouble(g, w, h, W, TR, lf, mf) {
  troubleHits = [];
  const tr = trouble, now = performance.now(), on = errorsOn;
  if (on) { g.globalAlpha = 1; g.fillStyle = ALARM_VEIL; g.fillRect(0, 0, w, h); }
  if (mf > 0.5 || !show.asks) { g.globalAlpha = 1; return; }
  const slab = (l, k) => l.z + BAND0 + k * BAND_W;
  const away = o => (soloHost && o.kind !== "tool" && o.tg && actorHost(o.tg) !== soloHost) || (focusAgent && o.kind !== "tool" && o.tg !== focusAgent && o.rq !== focusAgent);
  // failed asks + messages: scar across the slab, riser, ring + dot; the newest few get a word under :errors
  const labels = [];
  for (const o of tr.failed) {
    const blo = troubleSeen.get(o), isTool = o.kind === "tool";
    if (isTool && !blo) continue;
    if (o.kind === "msg" && !on && !blo && !W && TR - o.done > 864e5) continue;
    const l = troubleLane(o); if (!l || l.off) continue;
    const x = xOf(failT(o)), top = P(x, colH(l, x) + 1.6, l.z, w, h); if (!top.vis || top.x < -40 || top.x > w + 40) continue;
    troubleHits.push({ ...workTarget(o), sx: top.x, sy: top.y });
    const dimF = away(o) ? 0.2 : 1;
    if (!isTool) {
      const s0 = P(x, 0.05, slab(l, 0), w, h), s1 = P(x, 0.05, slab(l, 7), w, h), base = P(x, 0.05, l.z, w, h);
      g.strokeStyle = ALARM; g.globalAlpha = (on ? 0.85 : 0.5) * dimF; g.lineWidth = 1;
      if (s0.vis && s1.vis) { g.beginPath(); g.moveTo(s0.x, s0.y); g.lineTo(s1.x, s1.y); g.stroke(); }
      g.globalAlpha = (on ? 0.7 : 0.35) * dimF; if (base.vis) { g.beginPath(); g.moveTo(base.x, base.y); g.lineTo(top.x, top.y); g.stroke(); }
      g.globalAlpha = (on ? 1 : 0.85) * dimF; g.beginPath(); g.arc(top.x, top.y, 4, 0, Math.PI * 2); g.stroke();
      g.fillStyle = ALARM; g.beginPath(); g.arc(top.x, top.y, 1.6, 0, Math.PI * 2); g.fill();
      if (on && labels.length < 8) labels.push({ o, p: top });
    }
    if (blo != null && !reduced) {   // the bloom: once, ~1.1 s, as it lands
      const e = (now - blo) / 1100; if (e < 1) { const ee = 1 - Math.pow(1 - e, 3), r = (isTool ? 3 : 5) + (isTool ? 12 : 30) * ee;
        g.strokeStyle = ALARM; g.lineWidth = isTool ? 1 : 1.5; g.globalAlpha = (1 - e) * (isTool ? 0.6 : 0.95) * dimF; g.beginPath(); g.arc(top.x, top.y, r, 0, Math.PI * 2); g.stroke();
        if (!isTool) { g.fillStyle = ALARM_FAINT; g.globalAlpha = (1 - e) * 0.8 * dimF; g.beginPath(); g.arc(top.x, top.y, r * 0.55, 0, Math.PI * 2); g.fill(); }
        g.lineWidth = 1; }
    }
  }
  // stuck: per lane, one slow halo at now that widens with its oldest item's age; a dashed bracket from when that one (and
  // the selected one) was sent to now. Many stuck on one lane read as one halo and a count, not a pile of rings
  const stuckL = [], byLane = new Map();
  for (const o of tr.stuck) { const l = troubleLane(o); if (!l || l.off || TR - o.ts <= stuckMs || TR - o.ts > staleMs) continue; const g0 = byLane.get(l); if (g0) g0.n++; else byLane.set(l, { l, o, n: 1 }); }
  const bracket = (o, l, alpha) => {
    const x0 = xOf(o.ts), x1 = xOf(TR), yb = Math.max(colH(l, x1), 1) + 2.4, zb = slab(l, -0.4);
    const a = P(x0, yb, zb, w, h), b = P(x1, yb, zb, w, h), a0 = P(x0, 0.05, zb, w, h); if (!a.vis || !b.vis) return;
    g.strokeStyle = ALARM; g.lineWidth = 1; g.globalAlpha = alpha; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(a0.vis ? a0.x : a.x, a0.vis ? a0.y : a.y); g.lineTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
  };
  let k = 0;
  byLane.forEach(({ l, o, n }) => {
    const age = TR - o.ts, x1 = xOf(TR), b = P(x1, Math.max(colH(l, x1), 1) + 2.4, slab(l, -0.4), w, h); if (!b.vis) return;
    const dimF = away(o) ? 0.2 : 1, grow = clamp(Math.log2(age / stuckMs), 0, 4);
    bracket(o, l, (on ? 0.8 : 0.5) * dimF);
    g.strokeStyle = ALARM; g.lineWidth = 1;
    const r = 5 + grow * 3.5, ph = reduced ? 0.5 : ((now + k++ * 377) % 2600) / 2600;
    g.globalAlpha = (1 - ph) * 0.7 * dimF; g.beginPath(); g.arc(b.x, b.y, r * (1 + 0.9 * ph), 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.95 * dimF; g.beginPath(); g.arc(b.x, b.y, r * 0.55, 0, Math.PI * 2); g.stroke();
    g.fillStyle = ALARM; g.beginPath(); g.arc(b.x, b.y, 1.8, 0, Math.PI * 2); g.fill();
    troubleHits.push({ ...workTarget(o), sx: b.x, sy: b.y });
    stuckL.push({ o, p: b, age, r, dimF, n });
  });
  const selected = selectionWork();
  if (selected && tr.stuck.includes(selected)) { const l = troubleLane(selected); if (l && !l.off) bracket(selected, l, 1); }
  // resolves: a ring shrinks into the spot — accent when it got done, alarm when it turned into a failure
  resolves = resolves.filter(z => now - z.t0 < 800);
  resolves.forEach(z => { const l = troubleLane(z.o); if (!l || l.off) return; const x = xOf(z.o.done || TR), p = P(x, Math.max(colH(l, x), 1) + 2.4, slab(l, -0.4), w, h); if (!p.vis) return;
    const e = (now - z.t0) / 800; g.strokeStyle = z.failed ? ALARM : ACC; g.lineWidth = 1.2; g.globalAlpha = 1 - e * 0.7; g.beginPath(); g.arc(p.x, p.y, 2 + 16 * (1 - e), 0, Math.PI * 2); g.stroke(); g.lineWidth = 1; });
  // words: STUCK 34M · ART → MINI/WEB · 'review the…' — the age ticks with the clock
  font(g, 8); g.textAlign = "left"; const placed = [];
  const say = (x, y, head, body, alpha) => {
    for (let k = 0; k < 5 && placed.some(r => Math.abs(r.y - y) < 11 && Math.abs(r.x - x) < 260); k++) y -= 11;
    placed.push({ x, y }); const hw = g.measureText(head).width, tagW = Math.min(hw + 6 + g.measureText(body).width, 380);
    roomTake(x - 3, y - 6, tagW, 12, 4);
    g.globalAlpha = alpha; g.fillStyle = TAG; g.fillRect(x - 3, y - 6, tagW, 12);
    g.fillStyle = ALARM; g.fillText(head, x, y); g.fillStyle = FG; g.globalAlpha = alpha * 0.85; g.fillText(body, x + hw, y);
  };
  stuckL.sort((x, y) => y.age - x.age).slice(0, on ? 8 : 4).forEach(({ o, p, age, r, dimF, n }) => { const t = troubleWhat(o), cut = t.length > 34 ? t.slice(0, 33) + "…" : t;
    const x = clamp(p.x + r + 8, 8, w - 390); say(x, p.y, `STUCK ${dur(age).toUpperCase()} · `, `${troubleWho(o)} · '${cut}'${n > 1 ? ` · +${n - 1} MORE ON ${o.kind === "tool" ? "" : (troubleLane(o).name || "").toUpperCase()}` : ""}`, 0.95 * dimF); });
  labels.forEach(({ o, p }) => { const t = sq(o.err) || troubleWhat(o), cut = t.length > 40 ? t.slice(0, 39) + "…" : t;
    say(clamp(p.x + 9, 8, w - 380), p.y, `FAILED · ${KIND_TAG[o.kind]} · `, `${troubleWho(o)} · ${cut}`, 0.95); });
  if (on) { font(g, 9); g.textAlign = "center"; g.fillStyle = ALARM; g.globalAlpha = 0.9;
    g.fillText(`:ERRORS · ${tr.stuck.length} STUCK > ${stuckLabel()} · ${tr.nFail} FAILED · ${rungLabel()} · N / ⇧N STEP · :errors off`, w / 2, 142); }
  g.globalAlpha = 1; g.lineWidth = HAIR;
}
function drawWorldOverlay() {
  const r = sizeOf(panelW), w = r.width, h = r.height, dpr = ov.width / w, g = ov.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); g.textBaseline = "middle"; g.lineWidth = HAIR;
  occText = occTextNext; occTextNext = []; occRec = true;   // labels drawn this frame shape next frame's chatter
  roomPrev = roomNow; roomNow = keepOut.slice();
  const xc = xOf(slicing ? sliceStart() + BIN / 2 : T), zMin = OPERATOR_Z - 8;
  // the window: TR is the moment it's seen from (its anchor); lf / mf how far it has folded into lanes / into the Mesh
  const W = win, TR = W ? W.b : T, fo = uniforms.uFold.value, lf = sstep(0, 0.5, fo), mf = sstep(0.5, 1, fo);

  safe("turnrail", () => drawTurnRail(g, r));

  font(g, 7.5);
  for (let d = 0; d <= 8; d++) { const day = midnight(d); if (day > T1) continue;
    const mid = clamp(day + 432e5, T0, T1); const p = P(xOf(mid), 0, zMin - 6, w, h); if (!p.vis) continue;
    g.fillStyle = FAINT; g.textAlign = "center"; g.fillText(dayTag(day), p.x, p.y); }

  const halfW = cam.r * Math.tan(THREE.MathUtils.degToRad(16)) * (w / h);
  // close in (a day or nearer), the lane under the camera owns the air: what neither leaves nor lands on it steps back
  const near = W || focusWork || mf > 0.5 ? 0 : clamp((150 - cam.r) / 60, 0, 1);
  const homeLane = near > 0 ? lanes.reduce((b, l) => l.off || l.key === "*" ? b : !b || Math.abs(l.z - cam.tz) < Math.abs(b.z - cam.tz) ? l : b, null) : null;
  const home = homeLane && Math.abs(homeLane.z - cam.tz) < LANE_GAP * 0.6 ? homeLane : null;
  // wide, a name sits at each end of its lane; close in, it steps toward the middle of the view until it's in frame
  const ends = level === 0 ? [[[X0 - 4, "right"]], [[-X0 + 4, "left"]]] : [[0.72, 0.5, 0.28, 0.06].map(f => [clamp(cam.tx - halfW * f, X0 - 4, -X0 + 4), "left"])];
  if (mf < 0.98) { g.globalAlpha = 1 - mf; lanes.forEach(l => { ends.forEach(tries => tries.some(([lx, al]) => { const p = P(lx, 0, l.z + (level === 0 ? 0 : BAND0 - 1.2), w, h); if (!p.vis || p.x < 40 || p.x > w - 20 || p.y < 24 || p.y > h - 24) return false; font(g, 8);
    const nm = l.name.toUpperCase(), tw = g.measureText(nm).width, bx = (al === "right" ? p.x - tw : p.x) - 13;
    if (keepOut.some(k => bx < k.x + k.w && bx + tw + 15 > k.x && p.y - 5 < k.y + k.h && p.y + 5 > k.y)) return false;   // under the scope rail
    g.textAlign = al; g.fillStyle = l.solo ? ACC : l.off ? FAINT : laneStyle === "tint" ? tintCss(l.idx) : ((laneSel === l.idx && focus === "c") || l === home ? FG : DIM); g.fillText(nm, p.x, p.y);
    roomTake(bx, p.y - 5, tw + 15, 10, 2);
    if (!l.off) laneLabelMark(g, l, p.x, p.y, al, tw); return true; })); }); g.globalAlpha = 1; }
  if (mf < 0.5) drawLaneIdentity(g, w, h, xc);
  // hour ticks once you're inside a day
  if (level >= 2) { const step = level >= 4 ? 0.5 : level === 3 ? 1 : 3, t0 = tOf(cam.tx - halfW * 1.2), t1 = tOf(cam.tx + halfW * 1.2);
    for (let t = Math.ceil(t0 / (step * 36e5)) * step * 36e5; t <= t1; t += step * 36e5) { if (t < T0 || t > T1) continue;
      const zt = cam.tz + BAND0 - 2.5, a = P(xOf(t), 0, zt - 1.5, w, h), b = P(xOf(t), 0, zt, w, h); if (!a.vis) continue;
      g.strokeStyle = LINE; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.fillStyle = DIM; g.textAlign = "center"; font(g, 7.5); g.fillText(hhmm(t), a.x, a.y + 9); } }
  { const p = P(X0 - 4, 0, OPERATOR_Z, w, h); if (p.vis) { g.textAlign = "right"; g.fillStyle = FG; font(g, 8); g.fillText(TEAM ? `TEAM · ${PEOPLE.length} OPERATORS · ${PEOPLE.map(x => x.short.toUpperCase()).join(" ")}` : `@${OPERATOR.toUpperCase()} · OPERATOR`, p.x, p.y); } }
  if (uniforms.uLift.value > 0.3) { const p = P(X0 - 4, LIFT_H, OPERATOR_Z, w, h); if (p.vis) { g.textAlign = "right"; g.fillStyle = ACC; font(g, 8); g.fillText(`ARTIFACTS · ${ART_N.files} FILES · ${ART_N.art} TO LOOK AT`, p.x, p.y); } }
  // group labels on the files' floor, pinned near the left of what's in view
  { const sep = Math.max(uniforms.uLift.value, uniforms.uFloors.value);
    if (sep > 0.3 && show.files) { const y = 0.3 + uniforms.uLift.value * LIFT_H, x = Math.max(X0 - 1, cam.tx - halfW * 0.85);
      font(g, 7); g.textAlign = "right";
      lanes.forEach(l => { if (l.off || !GROUP_N[l.idx]) return;
        FILE_GROUPS.forEach((G, gi) => { if (!GROUP_N[l.idx][gi]) return;
          const p = P(x, y, l.z + BAND0 + GROUP_BAND[gi] * BAND_W + 0.3 + ROWS * PITCH_Z / 2, w, h); if (!p.vis) return;
          g.fillStyle = gi === 0 ? ACC : DIM; g.globalAlpha = Math.min(1, (sep - 0.3) * 2.5); g.fillText(`${G.label} ${GROUP_N[l.idx][gi]}`, p.x - 4, p.y); });
      }); g.globalAlpha = 1; } }
  if (uniforms.uFloors.value > 0.3 && show.tools) { const p = P(X0 - 4, -FLOOR_D, OPERATOR_Z, w, h); if (p.vis) { g.textAlign = "right"; g.fillStyle = DIM; font(g, 8); g.fillText("LOWER FLOOR · TOOL CALLS", p.x, p.y); } }

  // band legend on the lane in view (else the selected one) when zoomed in; it yields to anything that says more
  if (cam.r < 260 && lf < 0.5) { const l = home || lanes[laneSel] || lanes[0]; font(g, 7); g.fillStyle = FAINT; g.textAlign = "left";
    KIND_ORDER.forEach(k => { const p = P(xc + 3, 0, l.z + BAND0 + KIND[k].band * BAND_W + BAND_W / 2, w, h); if (!p.vis) return;
      const lb = KIND[k].label; if (roomFor(...lineBox(p.x + 4, p.y, g.measureText(lb).width, 7), 1)) g.fillText(lb, p.x + 4, p.y); }); }

  // peaks
  if (mf < 0.5) lanes.forEach(l => { if (l.off || !l.peakN) return; const t = T0 + (l.peakBin + 0.5) * BIN, x = xOf(t), y = colTop[l.idx][l.peakBin] * LAYER_H + 0.3;
    const b = P(x, y, l.z, w, h), top = P(x, y + 8, l.z, w, h); if (!b.vis) return;
    if (t > T && !slicing) { g.fillStyle = FAINT; g.fillRect(b.x - 1, b.y - 1, 2, 2); return; }
    g.strokeStyle = PEAK; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(top.x, top.y); g.stroke();
    g.beginPath(); g.moveTo(top.x, top.y - 2); g.lineTo(top.x + 3, top.y - 7); g.lineTo(top.x - 3, top.y - 7); g.closePath(); g.fillStyle = FG; g.fill();
    font(g, 7.5); g.textAlign = "left"; const pk = `PEAK ${l.peakN} · ${DOW[new Date(t).getDay()]} ${hhmm(t - BIN / 2)}`;
    if (roomFor(...lineBox(top.x + 6, top.y - 5, g.measureText(pk).width, 7.5), 0)) g.fillText(pk, top.x + 6, top.y - 5); });

  // cursor curtain / slice slab
  if (focusWork) drawWorkBracket(g, w, h);
  else if (W) drawWindowSlab(g, w, h, W, zMin);
  else if (slicing) {
    const hw = BIN_W / 2, sb = clamp(Math.floor((sliceStart() - T0) / BIN), 0, NBIN - 1), xa = xc - hw, xb = xc + hw;
    const H = clamp(Math.max(0, ...lanes.map(l => colTop[l.idx][sb] || 0)) * LAYER_H + 2.5, 3, 16); // hugs the tallest stack it cuts
    const c = (x, y, z) => P(x, y, z, w, h);
    const q = [[xa, 0, zMin], [xb, 0, zMin], [xb, 0, Z_MAX], [xa, 0, Z_MAX], [xa, H, zMin], [xb, H, zMin], [xb, H, Z_MAX], [xa, H, Z_MAX]].map(p => c(...p));
    g.strokeStyle = ACC; g.globalAlpha = 0.85; g.setLineDash([3, 3]);
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([i, j]) => { if (!q[i].vis || !q[j].vis) return; g.beginPath(); g.moveTo(q[i].x, q[i].y); g.lineTo(q[j].x, q[j].y); g.stroke(); });
    g.setLineDash([]); g.globalAlpha = 0.07; g.fillStyle = ACC; g.beginPath(); [4, 5, 6, 7].forEach((i, k) => k ? g.lineTo(q[i].x, q[i].y) : g.moveTo(q[i].x, q[i].y)); g.closePath(); g.fill(); g.globalAlpha = 1;
    if (q[4].vis) { font(g, 8.5); g.fillStyle = ACC; g.textAlign = "left"; g.fillText(`SLICE · ${dayTag(T)} ${hhmm(sliceStart())}–${hhmm(sliceStart() + BIN)} · ${sliceHits().events.length} EVENTS · ${sliceHits().air.length} IN AIR`, q[4].x + 6, q[4].y - 8); }
  } else {
    const a = P(xc, 0, zMin, w, h), b = P(xc, 0, Z_MAX, w, h), c = P(xc, 30, zMin, w, h);
    if (a.vis && b.vis) { g.strokeStyle = ACC; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.globalAlpha = 0.4; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke(); g.globalAlpha = 1;
      font(g, 8.5); g.fillStyle = ACC; g.textAlign = "left"; g.fillText(`${dayTag(T)} ${hhmm(T)}`, c.x + 6, c.y); }
  }

  // sessions: a thread per conversation along its lane's front edge — first call to last, a tick per prompt typed
  sessHits = [];
  if (show.sessions && (!slicing || W) && lf < 0.98) {
    const SW = 20 * 36e5, ps = selection && selection.type === "session" ? selection.s : null, hs = hover && hover.type === "session" ? hover.s : null;
    const live = [];
    sessions.forEach(se => {
      if (!se.lane || se.lane.off || !Number.isFinite(se.t0) || se.t0 > TR || se.t1 < (W ? W.a : T - SW)) return;
      if ((lens === "sessions" || lens === "scout") && (lens === "scout") === se.native) return;
      const z = se.lane.z + BAND0 - 1.4 - se.track * 0.9, end = Math.min(se.t1, TR), x0 = xOf(se.t0), x1 = xOf(Math.max(end, se.t0 + 3e5));
      const a = P(x0, 0.12, z, w, h), b = P(x1, 0.12, z, w, h); if (!a.vis || !b.vis) return;
      sessHits.push({ s: se, a, b });
      const on = TR - se.t1 < 15 * 60e3, hot = se === ps || se === hs, fade = W ? 1 : 1 - Math.max(0, T - se.t1) / SW;
      const col = se.native ? FG : ACC;
      g.strokeStyle = col; g.globalAlpha = (hot ? 1 : on ? 0.75 : 0.12 + 0.4 * fade) * (1 - 0.7 * uniforms.uLift.value) * (1 - lf); g.lineWidth = hot ? HAIR + 0.6 : HAIR;
      if (focusWork) g.globalAlpha *= 0.15;
      const away = (soloHost && sessHostOf(se.i) !== soloHost) || !mineSess(se.i); if (away) g.globalAlpha *= 0.12;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.beginPath(); se.turns.forEach(u => { if (u.t < se.t0 || u.t > TR) return; const q = P(xOf(u.t), 0.12, z, w, h); if (!q.vis) return; g.moveTo(q.x, q.y - 3.5); g.lineTo(q.x, q.y + 3.5); }); g.stroke();   // one path per session, not one per turn
      g.beginPath(); g.moveTo(a.x, a.y - 3); g.lineTo(a.x + 3, a.y); g.lineTo(a.x, a.y + 3); g.lineTo(a.x - 3, a.y); g.closePath(); g.stroke();
      // cold restarts: a hollow square where the cache was rebuilt, sized by what it cost to rebuild
      se.colds.forEach(c => { if (c.t > TR) return; const q = P(xOf(c.t), 0.12, z, w, h); if (!q.vis) return; const r = 1.5 + clamp(Math.log10(c.n / 2e4) * 2.2, 0, 3.5); g.strokeRect(q.x - r + .5, q.y - r + .5, r * 2, r * 2); });
      g.lineWidth = HAIR; g.globalAlpha = 1;
      if (hot || (on && chatter && !away && lf < 0.5)) live.push({ se, b, hot });
    });
    // name the live ones at their growing end: harness · what you asked
    font(g, 7.5); g.textAlign = "left";
    live.sort((p, q) => (q.hot - p.hot) || (q.se.n - p.se.n)).slice(0, lens === "sessions" || lens === "scout" ? 18 : 10).forEach(({ se, b, hot }) => {
      const fresh = [...se.turns].reverse().find(u => u.t <= TR && TR - u.t < 25 * 60e3);
      const said = fresh ? sq(fresh.text) : se.title, cut = said.length > 58 ? said.slice(0, 57) + "…" : said;
      const shown = fresh ? streamed("turn:" + se.i + ":" + fresh.t, cut, 60) : (cut.length > 46 ? cut.slice(0, 45) + "…" : cut);
      const txt = `${se.h.toUpperCase()} ${fresh ? "›" : "·"} ${shown}`, tw = g.measureText(`${se.h.toUpperCase()} · ${cut}`).width;
      let y = b.y + 1;   // step down past words already placed; give up after a few rows
      for (let k = 0; k < 4 && !roomFor(...lineBox(b.x + 6, y, tw, 7.5), 1, false); k++) y += 10;
      if (!roomFor(...lineBox(b.x + 6, y, tw, 7.5), 1)) return;
      g.fillStyle = se.native ? (hot || fresh ? FG : DIM) : ACC; g.fillText(txt, b.x + 6, y);
      if (fresh && shown.length < cut.length && caretOn()) { g.fillStyle = ACC; g.fillRect(b.x + 6 + g.measureText(txt).width + 2, y - 4, 4, 7); }
    });
  }

  // worktrees: a strand per worktree off its repo's back edge — fork tick where it was cut, first call to last
  wtHits = [];
  if (show.worktrees && (!slicing || W) && lf < 0.98) {
    const hw = hover && hover.type === "worktree" ? hover.wt : null, pw = selection && selection.type === "worktree" ? selection.wt : null;
    const labels = [];
    WTS.forEach(wt => {
      if (wt.lane.off || wt.t0 > TR) return;
      const zb = wt.lane.z + BAND0 + NBANDS * BAND_W + 0.3, z = zb + 1.1 + wt.track * 0.9, end = Math.min(wt.t1, TR);
      const fk = P(xOf(wt.t0) - 1.6, 0.06, zb, w, h), a = P(xOf(wt.t0), 0.06, z, w, h), b = P(xOf(Math.max(end, wt.t0 + 3e5)), 0.06, z, w, h);
      if (!a.vis || !b.vis) return;
      wtHits.push({ wt, a, b });
      const hot = wt === hw || wt === pw, on = TR - wt.t1 < 30 * 60e3, lensOn = lens === "worktrees";
      g.strokeStyle = hot ? ACC : FG; g.globalAlpha = (hot ? 1 : on ? 0.7 : lensOn ? 0.45 : 0.2) * (focusWork ? 0.15 : 1) * (1 - lf); g.lineWidth = hot ? HAIR + 0.6 : HAIR;
      if (fk.vis) { g.beginPath(); g.moveTo(fk.x, fk.y); g.lineTo(a.x, a.y); g.stroke(); }
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.beginPath(); g.arc(a.x, a.y, 2.2, 0, Math.PI * 2); g.stroke();
      if (wt.t1 <= TR && TR - wt.t1 > 2 * 36e5) { g.beginPath(); g.moveTo(b.x, b.y - 3); g.lineTo(b.x, b.y + 3); g.stroke(); }
      g.lineWidth = HAIR; g.globalAlpha = 1;
      if (hot || ((on || lensOn || level >= 2) && lf < 0.5)) labels.push({ wt, a, hot, on });
    });
    font(g, 7.5); g.textAlign = "left";
    labels.sort((p, q) => (q.hot - p.hot) || (q.on - p.on) || (q.wt.n - p.wt.n)).slice(0, 14).forEach(({ wt, a, hot, on }) => {
      const txt = `WT · ${wt.name}${wt.branch && wt.branch !== wt.name ? " · " + wt.branch : ""}`, tw = g.measureText(txt).width, x = a.x + 6;
      let y = a.y - 7; for (let k = 0; k < 3 && !roomFor(...lineBox(x, y, tw, 7.5), 1, false); k++) y -= 10;
      if (!roomFor(...lineBox(x, y, tw, 7.5), 1)) return;
      g.fillStyle = hot ? ACC : on ? FG : DIM; g.fillText(txt, x, y);
    });
  }

  // asks in the air
  // LIVE with no window: a finished ask fades out over LIVE_SETTLE after it lands, not over the whole 20 h
  const WIN = 20 * 36e5, LIVE_SETTLE = 2 * 36e5; let lit = new Set(); arcHits = []; const airText = [], landings = [];
  // close in, the air holds what this view's span can explain: a finished ask from before it is history, not traffic
  const spanT = Math.max(2 * 36e5, tOf(cam.tx + halfW) - tOf(cam.tx - halfW)), WINe = WIN + (Math.min(WIN, spanT) - WIN) * near;
  const pickedAsk = selection && selection.type === "ask" ? selection.a : null, hoverAsk = hover && hover.type === "ask" ? hover.a : null;
  asks.forEach(a => {
    if (!show.asks || lens === "sessions" || mf > 0.98) return;
    // in a window: the asks launched inside it, and (fainter) the ones launched earlier still open at its start
    const placed = W ? a.ts >= W.a && a.ts <= W.b : true;
    if (W ? !placed && !(a.ts < W.a && (a.done == null || a.done > W.a)) : a.ts > T || a.ts < T - WIN) return;
    const lt = laneFor(a.tg); if (!lt || lt.off) return;
    const lr = a.rq && laneFor(a.rq); const zFrom = (a.rq && a.rq.kind === "person") || !lr ? OPERATOR_Z : lr.z;
    const s = stateAt(a, TR), x0 = xOf(a.ts), endT = (s === "done" || s === "failed") ? a.done : TR, x1 = xOf(Math.max(endT, a.ts + 6e5));
    const settling = LIVE && !W && s === "done";
    if (settling && T - a.done > LIVE_SETTLE) return;
    const fade = W ? (placed ? 1 : 0.35) : settling ? 1 - (T - a.done) / LIVE_SETTLE : Math.max(0, 1 - (T - a.ts) / WINe);
    const hot = a === pickedAsk || a === hoverAsk || (slicing && sliceHits().air.includes(a));
    if (!W && !settling && s === "done" && TR - a.ts > WINe && !hot) return;
    // LIVE with no window: only a broker ask flies. An operator's turn or a subagent is work on its own lane: it keeps
    // the lane's pulse and its words, not an arc — dozens of sessions would otherwise fill the air
    const quiet = LIVE && !W && (a.src === "t" || a.src === "s") && s !== "failed" && !hot && !(focusWork && a === focusWork.a);
    const aside = !!home && lt !== home && lr !== home && !hot; let step = aside ? 1 - 0.82 * near : 1;
    // close in, arcs fly lower so an arch keeps both its ends in frame and reads as one thing going somewhere
    const y1 = colH(lt, x1) + 1.2, lift = (10 + Math.min(26, Math.abs(lt.z - zFrom) * 0.35)) * (1 - 0.6 * near);
    // only STUCK hangs in the air short of its lane; in flight lands on the lane at the playhead and pulses there
    const hang = s === "stuck";
    const steps = 22, pts = [];
    for (let i = 0; i <= steps; i++) { const f = i / steps, ff = hang ? f * 0.82 : f;
      const x = x0 + (x1 - x0) * ff, z = zFrom + (lt.z - zFrom) * ff, y = (1 - ff) * 0.5 + ff * y1 + Math.sin(ff * Math.PI) * lift + (hang ? ff * lift * 0.5 : 0);
      const p = P(x, y, z, w, h); pts.push(p); }
    if (s === "flight") lit.add(lt.idx);
    const e = pts[pts.length - 1], inFrame = p => p.vis && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
    // close in, an arc that only passes through the frame (neither end in it) is background
    if (near > 0 && !hot && !inFrame(pts[0]) && !inFrame(e)) step *= 1 - 0.7 * near;
    // focus: an ask that is not the agent's falls back like another machine's, and keeps quiet
    const off = !mineAsk(a);
    if (quiet) {
      const away = (soloHost && actorHost(a.tg) !== soloHost) || off;
      if (s === "flight") { g.fillStyle = ACC; g.globalAlpha = 0.95 * (focusWork || away ? 0.12 : 1) * (slicing ? 0.4 : 1) * step;
        g.beginPath(); g.arc(e.x, e.y, 2.2 + Math.sin(performance.now() / 180) * 0.8, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      if (chatter && placed && mf < 0.5 && !(aside && near > 0.5) && !off) airText.push({ a, e, s, dim: !!focusWork || slicing || !!away });
      return;
    }
    arcHits.push({ ask: a, pts });
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
    if (s === "flight") { g.strokeStyle = ACC; g.globalAlpha = 0.95; g.setLineDash([3, 3]); g.lineDashOffset = -performance.now() / 50; }
    else if (s === "stuck") { g.strokeStyle = FG; g.globalAlpha = 0.8; g.setLineDash([1, 3]); }
    else if (s === "failed") { g.strokeStyle = FG; g.globalAlpha = 0.35 + 0.4 * fade; g.setLineDash([]); }
    else { g.strokeStyle = FG; g.globalAlpha = 0.12 + 0.5 * fade; g.setLineDash([]); }
    if (slicing && !hot && !W) g.globalAlpha *= 0.4;
    if (W) g.globalAlpha *= (placed ? 1 : 0.45) * (1 - mf);
    if (focusWork) { if (a === focusWork.a) { g.globalAlpha = 1; g.lineWidth = HAIR + 0.6; } else g.globalAlpha *= 0.12; }
    const away = (soloHost && actorHost(a.tg) !== soloHost) || off; if (away) g.globalAlpha *= 0.12;
    if (focusAgent && !off && !hot) { g.globalAlpha = Math.max(g.globalAlpha, s === "done" ? 0.55 : 0.9); step = 1; }
    g.globalAlpha *= step;
    if (hot) { g.globalAlpha = 1; g.lineWidth = HAIR + 0.6; if (s !== "flight") g.strokeStyle = FG; }
    g.stroke(); g.setLineDash([]); g.lineWidth = HAIR;
    if (s === "done") { g.beginPath(); g.moveTo(e.x - 3, e.y); g.lineTo(e.x + 3, e.y); g.stroke(); }
    else if (s === "failed") { g.beginPath(); g.moveTo(e.x - 3, e.y - 3); g.lineTo(e.x + 3, e.y + 3); g.moveTo(e.x + 3, e.y - 3); g.lineTo(e.x - 3, e.y + 3); g.stroke(); }
    else if (s === "stuck") { g.strokeRect(e.x - 3, e.y - 3, 6, 6); }
    else { g.fillStyle = ACC; g.beginPath(); g.arc(e.x, e.y, 2.2 + Math.sin(performance.now() / 180) * 0.8, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    // chatter: every arc may speak; the one open in the inspector doesn't (its words are already on the right)
    const inspected = !insp.hidden && (a === pickedAsk || (focusWork && a === focusWork.a));
    if (chatter && !inspected && placed && mf < 0.5 && !(aside && near > 0.5) && !off) airText.push({ a, e, s, dim: !!focusWork || (slicing && !hot && !W) || !!away });
    if ((home || focusAgent) && !aside && !away && inFrame(e)) landings.push({ a, e });
  });
  // the newest asks in flight say what they were asked, streaming in as they launch
  // playback moves faster than reading: once an ask has started speaking it stays a few real seconds, then fades
  const spoke = new Set();
  { const nowMs = performance.now(), keyOf = a => "ask:" + a.ts + ":" + a.tg.id;
    const holdFor = a => 3200 + Math.min(132, (a.task || "").length) * 14;
    const justNow = Math.max(20 * 60e3, SPAN * 600 / LOOP_MS * speed);   // "just launched", at least ~0.6 s of real time
    // paused: what's in flight and what just happened around the playhead holds still; playing: the newest speak and fade
    const still = !playing, AROUND = 2 * 36e5;
    airText.filter(({ a, s }) => s === "flight" || s === "stuck" && still || TR - a.ts < (still || W ? Math.max(AROUND, W ? W.b - W.a : 0) : justNow) || (STREAM.has(keyOf(a)) && nowMs - STREAM.get(keyOf(a)) < holdFor(a)))
      .sort((p, q) => (q.s === "flight") - (p.s === "flight") || q.a.ts - p.a.ts).slice(0, 3).forEach(({ a, e, s, dim }) => {
      const full = sq(a.task || ""), all = wrapWords(full, 66, 2), whole = all.join(" ");
      // live, the words arrive as the ask launches; a replay shows them whole, so a held frame never reads as cut off
      const typed = streamed(keyOf(a), whole, 70), body = LIVE ? typed : whole;
      const age = nowMs - STREAM.get(keyOf(a)), fadeA = (s === "flight" || still ? 1 : clamp((holdFor(a) - age) / 700, 0, 1)) * (dim ? 0.35 : 1);
      const lines = []; { let left = body.length; all.forEach(ln => { if (left > 0) lines.push(ln.slice(0, left)); left -= ln.length + 1; }); }   // typed text on the whole lines, so it never re-flows
      const tagS = s === "flight" ? "ASKING" : s === "done" ? "DONE · " + dur(a.done - a.ts) : s.toUpperCase();
      const head = `${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()} · ${tagS}`;
      // its room is sized to the whole ask, not to what has streamed in, so it keeps its place mid-sentence
      const n = Math.max(1, all.length); font(g, 7); let bw = g.measureText(head).width; font(g, 8); all.forEach(ln => { bw = Math.max(bw, g.measureText(ln).width); });
      let x = e.x + 10, y = clamp(e.y - 10, 60, h - 90); if (x + 320 > w - 56) x = e.x - 330; x = clamp(x, 56, Math.max(56, w - 376));
      const box = yy => [x - 2, yy - 5, bw + 4, 11 + n * 10];
      for (let k = 0; k < 4 && !roomFor(...box(y), 3, false); k++) y += 15 + n * 10;
      if (!roomFor(...box(y), 3)) return;
      spoke.add(a);
      // a hairline back to where its arc lands: the words belong to a line
      { const lx = x > e.x ? x - 4 : x + bw + 4, ly = y + n * 5; if (Math.hypot(lx - e.x, ly - e.y) > 16) {
        g.strokeStyle = s === "flight" ? ACC : DIM; g.globalAlpha = 0.45 * fadeA; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(lx, ly); g.stroke(); } }
      font(g, 7); g.textAlign = "left"; g.fillStyle = s === "flight" ? ACC : DIM; g.globalAlpha = 0.85 * fadeA;
      haloText(g, head, x, y);
      font(g, 8); g.fillStyle = FG; g.globalAlpha = 0.92 * fadeA;
      lines.forEach((ln, i) => haloText(g, ln, x, y + 11 + i * 10));
      if (body.length < whole.length && caretOn()) { const last = lines[lines.length - 1] || ""; g.fillStyle = ACC; g.fillRect(x + g.measureText(last).width + 2, y + 11 + (lines.length - 1) * 10 - 4, 4, 7); }
      g.globalAlpha = 1;
    }); }
  // close in, each landing on or from the lane in view says whose it is; nearby landings to one agent share one name
  if ((home && near > 0.5) || focusAgent) { const groups = [];
    landings.filter(({ a }) => !spoke.has(a)).sort((p, q) => q.a.ts - p.a.ts).forEach(({ a, e }) => {
      const c = groups.find(c => c.tg === a.tg && Math.hypot(c.e.x - e.x, c.e.y - e.y) < 48);
      if (c) { c.n++; c.rqs.add(a.rq || null); } else groups.push({ tg: a.tg, e, n: 1, rqs: new Set([a.rq || null]) }); });
    font(g, 7); g.textAlign = "left"; g.fillStyle = DIM;
    groups.slice(0, 10).forEach(({ tg, e, n, rqs }) => { const one = rqs.size === 1 ? [...rqs][0] : null, to = tg.short.toUpperCase();
      const t = one ? `${one.short.toUpperCase()} → ${to}${n > 1 ? ` · ${n} ASKS` : ""}` : `${n > 1 ? n + " ASKS " : ""}→ ${to}`;
      const x = e.x + 5, y = e.y + 9; if (!roomFor(...lineBox(x, y, g.measureText(t).width, 7), 1)) return;
      g.globalAlpha = 0.85 * (focusAgent ? 1 : near); haloText(g, t, x, y); });
    g.globalAlpha = 1; }
  later($("rLit"), String(lit.size));
  chatterBand(h);   // sizes the scrims every frame, chatter or not
  paintGuides();
  occRec = false; if (chatter) drawChatterStream(g, w, h, TR, W); occRec = true;
  if (W && lf < 0.5 && W.R.ms != null && W.R.ms <= 30 * 60e3) safe("calls", () => drawWindowCalls(g, w, h, W, lf));
  if (mf > 0.02) safe("meshbands", () => drawMeshBands(g, w, h, W, mf, TR));
  if (W && !W.calls && !W.nAsks) { font(g, 9); g.textAlign = "center"; g.fillStyle = FG; g.globalAlpha = 0.85;
    g.fillText(`NOTHING IN THIS WINDOW · ${spanLabel(W.R.ms || (W.b - W.a))} BEFORE ${W.at}`, w / 2, h * 0.42); g.globalAlpha = 1; }

  // pins: agents asked in the last 6h
  const PW = 6 * 36e5, seen = new Map();
  if (show.asks && lens !== "sessions" && mf < 0.5) asks.forEach(a => { if (a.ts <= TR && a.ts > (W ? W.a : T - PW) && mineAsk(a)) { const prev = seen.get(a.tg); if (!prev || prev.ts < a.ts) seen.set(a.tg, a); } });
  const prevSel = pins[pinSel] && pins[pinSel].agent;
  pins = [...seen.values()].sort((a, b) => b.ts - a.ts).slice(0, 12).map(a => ({ agent: a.tg, ask: a }));
  pinSel = prevSel ? pins.findIndex(p => p.agent === prevSel) : Math.min(pinSel, pins.length - 1);
  if ((!slicing || W) && !focusWork) pins.forEach((p, k) => {
    const lt = laneFor(p.agent); if (!lt || lt.off) return;
    const x = xOf(p.ask.ts), z = lt.z + ((hash(p.agent.id) % 100) / 100 - 0.5) * 8, y = colH(lt, x) + 0.3;
    const b = P(x, y, z, w, h), t = P(x, y + 12 + (k % 3) * 5, z, w, h); if (!b.vis) return;
    const s = stateAt(p.ask, TR), on = s === "flight", sel = k === pinSel && focus === "w";
    g.strokeStyle = on ? ACC : sel ? FG : PIN; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke();
    g.beginPath(); g.arc(t.x, t.y - 4, sel ? 6 : on ? 4.5 : 3.5, 0, Math.PI * 2); g.stroke();
    g.fillStyle = on ? ACC : FG; g.beginPath(); g.arc(t.x, t.y - 4, 1.3, 0, Math.PI * 2); g.fill();
    if (sel) { g.strokeStyle = FG; g.strokeRect(t.x - 10.5, t.y - 14.5, 21, 21); }
    // a crowded landing keeps its rings and names only the pins with room (newest first; the selection one always)
    const nm = p.agent.short.toUpperCase(), sub = `${s === "flight" ? "IN FLIGHT" : s === "stuck" ? "STUCK" : s === "failed" ? "FAILED" : "DONE " + dur(p.ask.done - p.ask.ts)} · ${(p.agent.harness || "—").toUpperCase()}`;
    font(g, 8.5); let bw = g.measureText(nm).width; font(g, 7); bw = Math.max(bw, g.measureText(sub).width);
    if (!roomFor(t.x + 8, t.y - 12, bw + 4, 21, sel ? 9 : 2)) return;
    font(g, 8.5); g.textAlign = "left"; g.fillStyle = on ? ACC : FG; g.fillText(nm, t.x + 10, t.y - 6);
    font(g, 7); g.fillStyle = on ? PINSUB : FAINT; g.fillText(sub, t.x + 10, t.y + 4);
  });

  safe("trouble", () => drawTrouble(g, w, h, W, TR, lf, mf));
  safe("selection", () => drawSelection(g, w, h));
  // hover tag + selection marker
  hover = findHover(w, h);
  uniforms.uHover.value = hover && hover.type === "event" ? hover.e.i : -1;
  // an open hand over the ground (a drag moves it), a pointing hand on what a click opens, a closed hand while a drag is live
  gl.style.cursor = drag && drag.live ? (drag.mode === "zoom" ? "ns-resize" : "grabbing") : hover ? "pointer" : "grab";
  const hitKey = hit => hit.type === "event" ? "e" + hit.e.i : hit.type === "session" ? "s" + hit.s.i : hit.type === "worktree" ? "w" + hit.wt.root : hit.type === "delivery" ? "d" + hit.d.ts : "a" + hit.a.ts;
  const hk = hover ? hitKey(hover) : null; if (hk !== lastHoverKey) { if (hk) STREAM.delete("hov:" + hk); lastHoverKey = hk; }
  const tagFor = (hit, strong) => {
    const lines = hit.type === "event"
      ? [`${KIND[hit.e.k].label} · ${hit.e.name}`, hit.e.tgt || "—", `${hit.e.file ? "◆ FILE · CLICK TO OPEN" : (hit.e.k === "e" || hit.e.k === "r") ? "FILE GONE FROM DISK" : hit.e.k === "s" ? "SEARCH · NO FILE" : "TOOL CALL · NO FILE"} · ${dayTag(hit.e.t)} ${hhmm(hit.e.t)} · ${hit.e.lane.name.toUpperCase()}`]
      : hit.type === "session"
      ? (() => { const u = useAt(hit.s, T), hr = hitRate(u), cold = hit.s.colds.filter(c => c.t <= T).length;
          return [`SESSION · ${hit.s.h.toUpperCase()} · ${hit.s.native ? "NATIVE" : "TOOK A SCOUT ASK"}`, hit.s.title, `${hit.s.turns.length} PROMPTS · ${hit.s.n} CALLS · ${tokSum(u) ? fmtTok(tokSum(u)) + " TOK · HIT " + (hr == null ? "—" : Math.round(hr * 100) + "%") + " · " + cold + " COLD · " : ""}${hit.s.lane.name.toUpperCase()}`]; })()
      : hit.type === "worktree"
      ? [`WORKTREE · ${hit.wt.name.toUpperCase()}`, `${hit.wt.branch ? "BRANCH " + hit.wt.branch : "DETACHED HEAD"} · CUT FROM ${hit.wt.parent}`, `${hit.wt.n} CALLS · ${hit.wt.edits} EDITS · ${hit.wt.sess.size} SESSION${hit.wt.sess.size === 1 ? "" : "S"} · ${dayTag(hit.wt.t0)} ${hhmm(hit.wt.t0)}–${hhmm(hit.wt.t1)}`]
      : hit.type === "delivery" ? [`MESSAGE · ${troubleWho(hit.d)}`, troubleWhat(hit.d), trouble.stuck.includes(hit.d) ? "STUCK " + dur(T - hit.d.ts) : "FAILED"]
      : [`ASK · ${(hit.a.rq ? hit.a.rq.short : "—").toUpperCase()} → ${hit.a.tg.short.toUpperCase()}`, hit.a.task, `${stateAt(hit.a, T).toUpperCase()} · ${dayTag(hit.a.ts)} ${hhmm(hit.a.ts)}${hit.a.done ? " · " + dur(hit.a.done - hit.a.ts) : ""}`];
    font(g, 8); const tw = Math.min(300, Math.max(...lines.map(s => g.measureText(s).width)) + 16);
    let bx = hit.sx + 14, by = hit.sy - 46; if (bx + tw > w - 8) bx = hit.sx - tw - 14; if (by < 40) by = hit.sy + 14;
    g.strokeStyle = strong ? ACC : FG; g.beginPath(); g.moveTo(hit.sx, hit.sy); g.lineTo(bx + (bx > hit.sx ? 0 : tw), by + 20); g.stroke();
    g.fillStyle = TAG; g.fillRect(bx, by, tw, 40); g.strokeRect(bx + .5, by + .5, tw - 1, 39);
    lines.forEach((s, i) => { font(g, i ? 7.5 : 8); g.fillStyle = i === 0 ? (strong ? ACC : FG) : i === 1 ? FG : DIM; g.textAlign = "left";
      let txt = s; while (g.measureText(txt).width > tw - 14 && txt.length > 4) txt = txt.slice(0, -2); if (txt !== s) txt = txt.slice(0, -1) + "…";
      if (i === 1) { const full = txt; txt = streamed("hov:" + hitKey(hit), full, 240); if (txt.length < full.length && caretOn()) { g.fillStyle = ACC; g.fillRect(bx + 7 + g.measureText(txt).width + 2, by + 9 + i * 11 - 4, 4, 7); g.fillStyle = FG; } }
      g.fillText(txt, bx + 7, by + 9 + i * 11); });
  };
  safe("pointtrack", () => psTrack(hover));
  if (hover && !((psSel || psPoint) && psTargetOf(hover) && psTargetOf(hover).se === (psSel || psPoint).se)) tagFor(hover, false);
  safe("pointspeak", () => psDraw(g, w, h, TR));
  if (selection && selection.type === "event" && (!hover || hover.e !== selection.e)) {
    const e = selection.e, [ex, ey, ez] = evXYZ(e), p = P(ex, ey, ez, w, h);
    if (p.vis) { g.strokeStyle = ACC; g.strokeRect(p.x - 6.5, p.y - 6.5, 13, 13); g.beginPath(); g.moveTo(p.x, p.y - 6.5); g.lineTo(p.x, p.y - 22); g.stroke(); font(g, 7.5); g.fillStyle = ACC; g.textAlign = "center"; g.fillText("PICKED", p.x, p.y - 28); }
  }

  const deg = a => ((a * 180 / Math.PI) % 360 + 360) % 360;
  later($("cam"), `${follow ? "<span class=acc>FOLLOW</span>&nbsp; " : ""}${slicing ? "<span class=acc>SLICE</span>&nbsp; " : ""}CAM&nbsp; AZ ${deg(cam.az).toFixed(1).padStart(5, "0")}°&nbsp; EL ${deg(cam.el).toFixed(1)}°&nbsp; ${LEVELS[level].k}&nbsp; Y ×${(LAYER_H / 0.42).toFixed(1)}`);
}

/* ================= slice + inspector ================= */
let slicing = false, selection = null;
/** Selection is an object reference shared by the View, queues, lists, and Find.
 * List indices below are only keyboard cursors, recomputed from this identity. */
const workTarget = o => !o ? null : o.kind === "msg" ? { type: "delivery", d: o } : { type: "ask", a: o };
function selectionSession(target = selection) {
  if (!target) return null;
  if (target.type === "session") return target.s;
  if (target.type === "event") return sessions[target.e.sess];
  if (target.type === "ask") return target.a.work ? sessions[target.a.work.s] : null;
  return null;
}
function selectionWork(target = selection) {
  if (!target) return null;
  if (target.type === "ask" || target.type === "work") return target.a;
  if (target.type === "delivery") return target.d;
  if (target.type === "event") return askOfEvent(target.e);
  const se = selectionSession(target);
  const list = se ? (askBySess.get(se.i) || []).filter(a => a.ts <= T) : [];
  return list.find(a => trouble.stuck.includes(a)) || list.find(a => trouble.failed.includes(a)) || list[list.length - 1] || null;
}
function selectionAgent(target = selection) {
  if (target?.type === "agent") return target.agent;
  return selectionWork(target)?.tg || null;
}
function selectionLane(target = selection) {
  if (!target) return null;
  if (target.type === "lane") return target.lane;
  if (target.type === "event") return target.e.lane;
  if (target.type === "diff") return target.c.lane;
  if (target.type === "worktree") return target.wt.lane;
  if (target.type === "pr") return target.p.wt?.lane || lanes.find(l => repoName(l.key) === repoName(target.p.repo));
  const se = selectionSession(target);
  return se?.lane || (selectionAgent(target) && laneFor(selectionAgent(target))) || (target.type === "delivery" && troubleLane(target.d)) || null;
}
function select(target: WorldTarget | null) {
  const changed = !selection || !target ? selection !== target : selection.type !== target.type || Object.keys(target).some(k => k !== "type" && target[k] !== selection[k]);
  selection = target;
  uniforms.uPick.value = target?.type === "event" ? target.e.i : -1;
  const lane = selectionLane(), agent = selectionAgent();
  uniforms.uSel.value = lane ? lane.idx : -1;
  if (lane) laneSel = lane.idx;
  const ri = rosterCache.findIndex(r => r.a === agent); if (ri >= 0) rosterSel = ri;
  const si = stallCache.indexOf(selectionWork()); if (si >= 0) stallSel = si;
  paintStalls(); paintRunning(); paintRoster(); paintLanes();
  if (changed) opts.onSelect?.(target);
}
function frameTarget(target) {
  const work = selectionWork(target), lane = selectionLane(target), se = selectionSession(target);
  const stuck = work && trouble.stuck.includes(work);
  const t = work ? stuck ? (work.ts + T) / 2 : work.done && work.done <= T ? work.done : work.ts
    : target.type === "event" ? target.e.t : target.type === "worktree" ? Math.min(T, target.wt.t1) : se ? Math.min(T, se.t1) : T;
  flight = null; follow = false; ride = null;
  camGoal.tx = xOf(t); if (lane) camGoal.tz = lane.z;
  else if (target.type === "host") { const host = MESH_BY.get(target.host.host); if (host) camGoal.tz = host.zc; }
  level = 2; camGoal.r = LEVELS[2].r; renderZoomRail(); renderViews();
}
function activateTarget(target) {
  if (!target) return;
  if (playing) setPlaying(false, false);
  select(target); frameTarget(target); openInspector(target);
  const panel = target.type === "agent" ? "b" : target.type === "lane" ? "c" : selectionWork(target) ? "h" : null;
  if (panel && folded.has(panel)) { folded.delete(panel); applyFold(); }
  paintStalls(); paintRunning(); paintRoster(); paintLanes();
  for (const id of ["stalls", "running", "roster", "lanes"]) $(id).querySelector(".sel")?.scrollIntoView({ block: "nearest" });
}
function drawSelection(g, w, h) {
  if (!selection) return;
  const lane = selectionLane(), se = selectionSession(), work = selectionWork();
  let at;
  if (selection.type === "event") at = P(...evXYZ(selection.e), w, h);
  else if (lane) {
    const t = work ? trouble.stuck.includes(work) ? T : work.done && work.done <= T ? work.done : work.ts : se ? Math.min(T, se.t1) : T;
    const x = xOf(t), stuck = work && trouble.stuck.includes(work), failed = work && trouble.failed.includes(work);
    at = P(x, failed ? colH(lane, x) + 1.6 : Math.max(colH(lane, x), 1) + 2.4, stuck ? lane.z + BAND0 - 0.4 * BAND_W : lane.z, w, h);
  } else if (selection.type === "host") {
    const host = MESH_BY.get(selection.host.host); if (host) at = P(xOf(T), 1, host.zc, w, h);
  }
  if (!at?.vis) return;
  g.globalAlpha = 1; g.strokeStyle = FG; g.lineWidth = 1.5;
  g.strokeRect(at.x - 16.5, at.y - 16.5, 33, 33);
  g.beginPath(); g.moveTo(at.x - 23, at.y - 8); g.lineTo(at.x - 23, at.y + 8);
  g.moveTo(at.x + 23, at.y - 8); g.lineTo(at.x + 23, at.y + 8); g.stroke(); g.lineWidth = 1;
}
const sliceStart = () => T0 + Math.floor((T - T0) / BIN) * BIN;
let sliceCache = { key: -1 };
function sliceHits() {
  const s0 = sliceStart(); if (sliceCache.key === s0) return sliceCache;
  const evs = events.filter(e => e.lane && e.t >= s0 && e.t < s0 + BIN && !(e.lane.off));
  const air = asks.filter(a => a.ts <= s0 + BIN && (a.done == null || a.done >= s0) && a.ts >= T0);
  sliceCache = { key: s0, events: evs, air };
  return sliceCache;
}
function snapSlice() { T = sliceStart() + BIN / 2; }
function setSlicing(on, inspect = true) {
  slicing = on; uniforms.uSlice.value = on ? 1 : 0;
  if (!inspect) return;
  if (on) { snapSlice(); sliceCache.key = -1; if (level === 0) { follow = false; camGoal.tx = xOf(T); setLevel(1); } if (!selection) openInspector({ type: "slice" }); else renderInspector(); }
  else if (!selection) closeInspector();
}
// a dot: the inspector on the call, and a file's preview beside it
function openDot(e) {
  pick({ type: "event", e });
  const f = dotFile(e); if (!f) return;
  const a = askOfEvent(e); pvFor = null; showFile(f, a ? ctxOf(a) : null);
}
function pick(hit) {
  if (playing) setPlaying(false);
  select(hit);
  openInspector(selection);
}

const insp = $("insp");
let inspStack = [], inspItems = [], inspSel = 0, inspPrevFocus = null;
function openInspector(view) {
  if (view.type !== "slice") select(view.type === "work" ? { type: "ask", a: view.a } : view);
  if (!inspStack.length || inspStack[inspStack.length - 1] !== view) inspStack.push(view);
  if (inspStack.length > 12) inspStack.shift();
  revealRight();
  if (!pvPinned && !pv.hidden) hidePreview();   // a new view lands on top of the pane, not under an old preview
  insp.hidden = false; requestAnimationFrame(() => insp.classList.add("open"));
  if (focus !== "x") inspPrevFocus = focus;
  inspSel = 0; setFocus("x"); renderInspector();
}
function closeInspector() {
  insp.classList.remove("open"); setTimeout(() => { if (!insp.classList.contains("open")) insp.hidden = true; }, 220);
  inspStack = []; select(null); syncPreview();
  if (focusWork) exitWork();
  if (focus === "x") setFocus(inspPrevFocus === "x" ? null : inspPrevFocus);
}
function inspBack() {
  if (inspStack.length > 1) { const gone = inspStack.pop(); if (gone.type === "work") exitWork(); const v = inspStack[inspStack.length - 1]; select(v.type === "slice" ? null : v); uniforms.uPick.value = v.type === "event" ? v.e.i : -1; inspSel = 0; renderInspector(); }
  else closeInspector();
}
const row = (item, label, meta, cls = "") => { inspItems.push(item); const i = inspItems.length - 1; return `<div class="it ${cls}${i === inspSel ? " sel" : ""}" data-i="${i}"><span>${label}</span><span>${meta || ""}</span></div>`; };
function kv(k, v) { return `<div class="kv"><span>${k}</span><span>${v}</span></div>`; }
// a selection's ids, copyable: [label, id] pairs; the ones it lacks are left out
const idRows = pairs => { const has = pairs.filter(([, id]) => id); return has.length ? `<div class="sec">IDS</div>` + has.map(([k, id]) => row({ type: "copy", text: id, what: k }, `<em>${k}</em>${esc(id)}`, "COPY", "id")).join("") : ""; };
// where an id opens in the app: a session's page, or the agent's when the target is an agent that can be woken
const isSessionId = (id, session) => session || /^session-/.test(id);
const targetPath = (id, session) => (isSessionId(id, session) ? "/sessions/" : "/agents/") + encodeURIComponent(id);
// the OPEN rows the runtime's records back: the target, the conversation, the flight
function openRows({ target, conversation, flight }, targetLabel, session = false) {
  let h = "";
  if (target) h += row({ type: "nav", path: targetPath(target, session) }, `<em>OPEN</em>THE ${isSessionId(target, session) ? "SESSION" : "AGENT"} · ${esc(targetLabel || target)}`, "↵", "acc");
  if (conversation) h += row({ type: "nav", path: "/c/" + encodeURIComponent(conversation) }, `<em>OPEN</em>THE CONVERSATION`, "↵", "acc");
  if (flight) h += row({ type: "nav", path: "/flights/" + encodeURIComponent(flight) + "/observe" }, `<em>OPEN</em>THE FLIGHT`, "↵", "acc");
  return h;
}
// a delivery this host's runtime holds: in a team dataset, only one sent from this host (the route says no to the rest)
const dlvLocal = d => !TEAM_HOSTS.length || !SELF_HOST || actorHost(d.rq) === SELF_HOST;
// an actor's id on this host's runtime: a team dataset keys actors "host:id", and another host's ids don't open here
const localActorId = a => !a ? null : !TEAM_HOSTS.length ? a.id : SELF_HOST && actorHost(a) === SELF_HOST && a.id.startsWith(SELF_HOST + ":") ? a.id.slice(SELF_HOST.length + 1) : null;
function diffFiles(c, label) {
  const n = nUpTo(c.ed, T), by = new Map();
  for (let i = 0; i < n; i++) { const e = c.ed[i]; if (!e.tgt) continue; const f = by.get(e.tgt) || { e, add: 0, rem: 0, n: 0 }; f.add += e.add; f.rem += e.rem; f.n++; f.e = e; by.set(e.tgt, f); }
  if (!by.size) return "";
  const list = [...by.values()].sort((a, b) => (b.add + b.rem) - (a.add + a.rem) || b.n - a.n), root0 = c.root;
  const rel = p => p.startsWith(root0 + "/") ? p.slice(root0.length + 1) : p;
  return `<div class="sec">FILES CHANGED · ${by.size}</div>` + list.slice(0, 30).map(({ e, add, rem, n: k }) => { const f = dotFile(e), meta = c.dl ? `+${add} −${rem}` : k > 1 ? "×" + k : hhmm(e.t);
    return f ? row({ type: "file", f, ctx: { t1: T, label: label.toUpperCase() } }, `<em>EDIT</em>${esc(rel(e.tgt))}`, meta) : row({ type: "event", e }, `<em>EDIT</em>${esc(rel(e.tgt))}`, meta); }).join("") + (by.size > 30 ? `<div class="none">+${by.size - 30} more</div>` : "");
}
function sparkFor(list) {
  const N = 56, b = new Array(N).fill(0); list.forEach(e => b[clamp(Math.floor((e.t - T0) / SPAN * N), 0, N - 1)]++); const mx = Math.max(...b, 1);
  return `<div class="spark7">${b.map((v, i) => `<i style="height:${v ? 2 + 16 * v / mx : 1}px;opacity:${v ? 0.9 : 0.25}${T0 + (i + 0.5) / N * SPAN <= T ? "" : ";background:var(--faint)"}"></i>`).join("")}</div>`;
}
function inspectorSelectionIndex(previous, items, fallback) {
  const index = previous ? items.findIndex(item => item.type === previous.type && (
    item === previous || ["a", "e", "s", "wt", "p", "c"].some(key => item[key] && item[key] === previous[key])
    || (item.f?.abs && item.f.abs === previous.f?.abs) || (item.url && item.url === previous.url)
  )) : -1;
  return index >= 0 ? index : clamp(fallback, 0, Math.max(0, items.length - 1));
}
function renderInspector(preserve = false) {
  const previous = preserve ? inspItems[inspSel] : null, scroll = $("inspBody").scrollTop;
  const v = inspStack[inspStack.length - 1]; if (!v) return;
  inspItems = []; let html = "";
  const crumbs = inspStack.map(x => x.type === "slice" ? "SLICE" : x.type === "event" ? KIND[x.e.k].label : x.type === "work" ? "ZERO IN" : x.type === "session" ? "SESSION" : x.type === "worktree" ? "WORKTREE" : x.type === "pr" ? "PR" : x.type === "diff" ? "DIFF" : x.type.toUpperCase()).join(" › ");
  if (v.type === "agent") {
    const a = v.agent; html += `<div class="ih"><b>AGENT · ${esc(spoken(a))}</b></div>` + kv("HARNESS", esc(a.harness || "—")) + kv("HOST", esc(hostLabel(actorHost(a))));
    html += (rosterAll.find(r => r.a === a)?.list || []).filter(a => a.ts <= T).slice().reverse().map(a => row({ type: "ask", a }, esc(a.task), stateAt(a, T).toUpperCase())).join("");
  } else if (v.type === "lane") {
    html += `<div class="ih"><b>LANE · ${esc(v.lane.name)}</b></div>` + kv("PATH", esc(v.lane.key)) + kv("HOSTS", esc(laneHosts(v.lane)));
    html += sessions.filter(se => se.lane === v.lane && se.t0 <= T).map(s => row({ type: "session", s }, esc(s.h + " · " + s.sid), hhmm(s.t0))).join("");
  } else if (v.type === "host") {
    html += `<div class="ih"><b>HOST · ${esc(v.host.name || v.host.host)}</b></div>` + kv("PLATFORM", esc(v.host.platform || "—")) + kv("HOST", esc(v.host.host || "—"));
  } else if (v.type === "delivery") {
    const d = v.d, ids = d.ids || {}, open = d.done == null || d.done > T, gone = isUndeliverable(d, T);
    html += `<div class="ih"><b>MESSAGE · ${esc(troubleWho(d))}</b><small>SENT ${dayTag(d.ts)} ${hhmm(d.ts)}${d.ended != null ? ` · ITS SESSION ENDED ${dayTag(d.ended)} ${hhmm(d.ended)}` : ""}</small></div><div class="target">${esc(d.task || "")}</div>`
      + kv("STATE", isFailed(d, T) ? "FAILED" : !open ? (d.dismissed ? "DISMISSED" : "DONE") : gone ? "UNDELIVERABLE" : trouble.stuck.includes(d) ? "STUCK " + dur(T - d.ts) : "IN FLIGHT") + kv("ERROR", esc(d.err || "—"));
    if (gone) html += `<div class="none">Its session ended, so this message will never arrive</div>`;
    if (dlvLocal(d)) html += openRows(ids, d.toName !== "—" ? d.toName : null, d.ended != null);
    if (open && ids.delivery && dlvLocal(d)) html += row({ type: "dismiss", d }, `<em>DISMISS</em>THE MESSAGE · THE RUNTIME MARKS IT CANCELLED`, "↵");
    html += idRows([["DELIVERY", ids.delivery], ["TARGET", ids.target], ["MESSAGE", ids.message], ["FLIGHT", ids.flight], ["CONVERSATION", ids.conversation]]);
  } else if (v.type === "slice") {
    const s = sliceHits(), s0 = sliceStart();
    const byKind = {}; s.events.forEach(e => byKind[e.k] = (byKind[e.k] || 0) + 1); const mk = Math.max(1, ...Object.values(byKind));
    html += `<div class="ih"><b>${dayTag(s0)} · ${hhmm(s0)}–${hhmm(s0 + BIN)}</b><small>${s.events.length} EVENTS ON THE GROUND · ${s.air.length} ASKS IN THE AIR</small></div>`;
    html += `<div class="kinds">${KIND_ORDER.map(k => `<div><span>${KIND[k].label}</span><i style="width:${(byKind[k] || 0) / mk * 100}%"></i><span>${byKind[k] || "·"}</span></div>`).join("")}</div>`;
    html += `<div class="sec">IN THE AIR</div>`;
    html += s.air.length ? s.air.map(a => row({ type: "ask", a }, `${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()}`, stateAt(a, s0 + BIN).toUpperCase(), stateAt(a, s0 + BIN) === "flight" ? "acc" : "")).join("") : `<div class="none">Nothing in the air</div>`;
    const byLane = new Map(); s.events.forEach(e => { if (!byLane.has(e.lane)) byLane.set(e.lane, []); byLane.get(e.lane).push(e); });
    [...byLane.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([l, list]) => {
      html += `<div class="sec">${esc(l.name.toUpperCase())} · ${list.length}</div>`;
      const order = list.slice().sort((a, b) => KIND[a.k].band - KIND[b.k].band || a.t - b.t);
      const dedup = new Map(); order.forEach(e => { const key = e.k + "|" + e.tgt; if (!dedup.has(key)) dedup.set(key, { e, n: 0 }); dedup.get(key).n++; });
      [...dedup.values()].slice(0, 14).forEach(({ e, n }) => html += row({ type: "event", e }, `<em>${KIND[e.k].label.slice(0, 4)}</em>${esc(e.tgt || e.name)}`, n > 1 ? "×" + n : hhmm(e.t)));
      if (dedup.size > 14) html += `<div class="none">+${dedup.size - 14} more distinct</div>`;
    });
  } else if (v.type === "event") {
    const e = v.e, se = sessions[e.sess];
    html += `<div class="ih"><b>${KIND[e.k].label} · ${esc(e.name)}</b><small>${dayTag(e.t)} ${new Date(e.t).toLocaleTimeString("en-GB")} · ${se.h.toUpperCase()}</small></div>`;
    html += `<div class="target">${esc(e.tgt || "—")}</div>`;
    // a search or a command reads as little on its own: lead with the work it served, or what was asked before it
    const f = dotFile(e), a = askOfEvent(e), said = a ? null : se.turns.filter(u => u.t <= e.t).pop();
    if (f) html += row({ type: "file", f, ctx: a ? ctxOf(a) : null }, `<em>OPEN</em>THE FILE · ${esc(f.disp.split("/").pop())}`, "↵", "acc");
    if (a) html += `<div class="sec">FOR THE ASK</div>` + row({ type: "ask", a }, esc((a.task || "—").slice(0, 90)), `${dayTag(a.ts)} ${hhmm(a.ts)}`);
    else if (said) html += `<div class="sec">AFTER YOU ASKED</div><div class="target"><small>${dayTag(said.t)} ${hhmm(said.t)}</small> ${esc(said.text.slice(0, 240))}</div>`;
    html += kv("WORKSPACE", esc(e.root)) + kv("LANE", esc(e.lane.name)) + kv("SESSION", `${se.sid.slice(0, 8)}`) + kv("HARNESS", se.h) + kv("HOST", esc(hostLabel(pathHost(e.root) || pathHost(e.file) || SESS_HOST.get(e.sess) || (TEAM ? null : SELF_HOST))));
    const fl = fileEvents.get(e.tgt);
    if (fl && fl.length) {
      html += `<div class="sec">THIS FILE · ${fl.length} TOUCHES · 7D</div>` + sparkFor(fl);
      const ed = fl.filter(x => x.k === "e").length; html += kv("EDITS / READS", `${ed} / ${fl.length - ed}`) + kv("SESSIONS", new Set(fl.map(x => x.sess)).size);
    }
    html += row({ type: "session", s: se }, `<em>OPEN</em>THE SESSION · ${esc(se.title.slice(0, 60))}`, se.native ? "NATIVE" : "SCOUT", se.native ? "" : "acc");
    const sl = sessEvents.get(e.sess) || [], idx = sl.indexOf(e);
    html += `<div class="sec">SESSION AROUND · ${sl.length} EVENTS TOTAL</div>`;
    sl.slice(Math.max(0, idx - 6), idx + 7).forEach(x => html += row({ type: "event", e: x }, `<em>${KIND[x.k].label.slice(0, 4)}</em>${esc(x.tgt || x.name)}`, hhmm(x.t), x === e ? "cur" : ""));
  } else if (v.type === "ask") {
    const a = v.a, s = stateAt(a, T);
    html += `<div class="ih"><b>ASK · ${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()}</b><small>${s.toUpperCase()} AT T · OPENED ${dayTag(a.ts)} ${hhmm(a.ts)}</small></div>`;
    html += `<div class="target">${esc(a.task || "—")}</div>`;
    html += a.work
      ? row({ type: "work", a }, `<em>ZERO</em>IN ON THE WORK · ${a.work.files.length} FILES · ${a.work.n} CALLS`, "Q", "acc")
      : `<div class="none">No transcript on this machine received this ask</div>`;
    html += kv("OUTCOME", a.st === "c" ? "completed" : a.st === "f" ? "failed" : "still open") + kv("TIME TO DONE", a.done ? dur(a.done - a.ts) : "—") + kv("TARGET HARNESS", esc(a.tg.harness || "—")) + kv("WORKSPACE", esc(a.tg.root || "unrooted")) + kv("HOST", esc(hostLabel(actorHost(a.tg)) === "—" ? hostOf(a.tg) : hostLabel(actorHost(a.tg))));
    if (a.err) html += `<div class="sec">REASON</div><div class="target">${esc(a.err)}</div>`;
    { const ids = a.ids || {}, broker = !!(ids.invocation || ids.flight || ids.conversation), tid = broker ? localActorId(a.tg) : null;
      if (broker && (!TEAM_HOSTS.length || tid)) html += openRows({ target: tid, conversation: ids.conversation, flight: ids.flight }, spoken(a.tg));
      html += idRows([["INVOCATION", ids.invocation], ["FLIGHT", ids.flight], ["CONVERSATION", ids.conversation], ["TARGET", tid]]); }
    const lt = laneFor(a.tg);
    if (lt) { const during = events.filter(e => e.lane === lt && e.t >= a.ts && e.t <= (a.done || a.ts + 36e5));
      html += `<div class="sec">${esc(lt.name.toUpperCase())} WHILE IT WAS OPEN · ${during.length}</div>`;
      during.filter(e => e.k === "e").slice(0, 8).forEach(x => html += row({ type: "event", e: x }, `<em>EDIT</em>${esc(x.tgt)}`, hhmm(x.t)));
      if (!during.some(e => e.k === "e")) during.slice(0, 6).forEach(x => html += row({ type: "event", e: x }, `<em>${KIND[x.k].label.slice(0, 4)}</em>${esc(x.tgt || x.name)}`, hhmm(x.t))); }
    const others = (rosterAll.find(r => r.a === a.tg) || { list: [] }).list.filter(x => x !== a);
    if (others.length) { html += `<div class="sec">${a.tg.short.toUpperCase()} · OTHER ASKS</div>`; others.slice(-6).reverse().forEach(x => html += row({ type: "ask", a: x }, esc(x.task), `${DOW[new Date(x.ts).getDay()]} ${hhmm(x.ts)}`)); }
  }
  else if (v.type === "session") {
    const se = v.s, list = sessEvents.get(se.i) || [];
    html += `<div class="ih"><b>SESSION · ${se.h.toUpperCase()} ${esc(se.sid)}</b><small>${se.native ? "NATIVE" : "TOOK A SCOUT ASK"} · ${dayTag(se.t0)} ${hhmm(se.t0)}–${hhmm(se.t1)} · ${dur(se.t1 - se.t0)}</small></div>`;
    html += kv("WORKSPACE", esc(se.root || "—")) + kv("LANE", esc(se.lane ? se.lane.name : "—")) + kv("HOST", esc(hostLabel(pathHost(se.root) || SESS_HOST.get(se.i) || (TEAM ? null : SELF_HOST)))) + kv("CALLS · EDITS", `${se.n} · ${se.edits}`);
    { const u = useAt(se, T), hr = hitRate(u), cold = se.colds.filter(c => c.t <= T);
      if (tokSum(u)) html += kv("TOKENS · ≤ T", `${fmtTok(tokSum(u))} · ${fmtTok(u[3])} OUT`) + kv("CACHE", `HIT ${hr == null ? "—" : Math.round(hr * 100) + "%"} · ${fmtTok(u[1])} READ · ${fmtTok(u[0] + u[2])} PAID IN`) + kv("COLD RESTARTS", cold.length ? `${cold.length} · ${fmtTok(cold.reduce((s, c) => s + c.n, 0))} REBUILT` : "none"); }
    html += `<div class="sec">WHAT YOU ASKED · ${se.turns.length}</div>`;
    html += se.turns.length ? se.turns.slice(0, 24).map(u => `<div class="target"><small>${dayTag(u.t)} ${hhmm(u.t)}</small> ${esc(u.text)}</div>`).join("") : `<div class="none">No typed prompts this week (resumed or delegated)</div>`;
    const dedup = new Map(); list.filter(e => e.k === "e").forEach(e => { if (!dedup.has(e.tgt)) dedup.set(e.tgt, { e, n: 0 }); dedup.get(e.tgt).n++; });
    if (dedup.size) { html += `<div class="sec">FILES EDITED · ${dedup.size}</div>`; [...dedup.values()].slice(0, 12).forEach(({ e, n }) => html += row({ type: "event", e }, `<em>EDIT</em>${esc(e.tgt)}`, n > 1 ? "×" + n : hhmm(e.t))); }
    html += `<div class="sec">LAST CALLS</div>`;
    list.slice(-8).reverse().forEach(x => html += row({ type: "event", e: x }, `<em>${KIND[x.k].label.slice(0, 4)}</em>${esc(x.tgt || x.name)}`, hhmm(x.t)));
  }
  else if (v.type === "worktree") {
    const wt = v.wt, ss = [...wt.sess].map(i => sessions[i]).filter(Boolean);
    html += `<div class="ih"><b>WORKTREE · ${esc(wt.name.toUpperCase())}</b><small>${wt.branch ? "BRANCH " + esc(wt.branch) : "DETACHED HEAD"} · ${dayTag(wt.t0)} ${hhmm(wt.t0)}–${hhmm(wt.t1)} · ${dur(wt.t1 - wt.t0)}</small></div>`;
    const cr = crewAt(wt.crew, T), dd = diffAt(wt.co, T);
    html += kv("PATH", esc(wt.root)) + kv("CUT FROM", esc(wt.parent || "—")) + kv("CALLS · EDITS", `${wt.n} · ${wt.edits}`) + kv("DIFF · ≤ T", dd ? `${dlText(dd)} · ${dd.files} FILES` : "—") + kv("AGENTS", esc(cr.agents.join(", ") || "—")) + (cr.people.length ? kv("PEOPLE", esc(cr.people.join(", "))) : "");
    { const u = ss.reduce((acc, se) => useAt(se, T).map((x, k) => acc[k] + x), [0, 0, 0, 0]), hr = hitRate(u); if (tokSum(u)) html += kv("TOKENS · ≤ T", `${fmtTok(tokSum(u))} · HIT ${hr == null ? "—" : Math.round(hr * 100) + "%"}`); }
    html += `<div class="sec">SESSIONS · ${ss.length}</div>`;
    ss.forEach(se => html += row({ type: "session", s: se }, `<em>${se.h.slice(0, 4).toUpperCase()}</em>${esc(se.title)}`, hhmm(se.t0)));
    const prs = wt.prs.filter(p => p.t0 <= T);
    if (prs.length) { html += `<div class="sec">PRS · ${prs.length}</div>`; prs.forEach(p => html += row({ type: "pr", p }, `<em>#${p.num}</em>${esc(p.title)}`, prState(p, T).toUpperCase(), prState(p, T) === "open" ? "acc" : "")); }
    if (wt.co) html += diffFiles(wt.co, wt.name);
  }
  else if (v.type === "pr") {
    const p = v.p, st = prState(p, T);
    html += `<div class="ih"><b>PR #${p.num} · ${st ? st.toUpperCase() : "NOT YET OPENED"}</b><small>${esc(repoName(p.repo).toUpperCase())} · OPENED ${dayTag(p.t0)} ${hhmm(p.t0)}${p.tm ? ` · MERGED ${dayTag(p.tm)} ${hhmm(p.tm)} · ${dur(p.tm - p.t0)} OPEN` : p.tc ? ` · CLOSED ${dayTag(p.tc)} ${hhmm(p.tc)}` : ""}</small></div>`;
    html += `<div class="target">${esc(p.title || "—")}</div>`;
    html += kv("BRANCH", esc(p.branch || "—")) + kv("REPO", esc(p.repo || "—"));
    if (p.url) html += row({ type: "url", url: p.url, title: `#${p.num} ${p.title}` }, `<em>OPEN</em>${esc(p.url.replace(/^https?:\/\//, ""))}`, "↵");
    if (p.wt) { const d = diffAt(p.wt.co, T); html += `<div class="sec">WORKTREE</div>` + row({ type: "worktree", wt: p.wt }, `<em>WT</em>${esc(p.wt.name)}`, d ? dlText(d) : hhmm(p.wt.t0)); if (p.wt.co) html += diffFiles(p.wt.co, p.wt.name); }
    else html += `<div class="none">No worktree on this machine carried ${esc(p.branch || "this branch")}</div>`;
  }
  else if (v.type === "diff") {
    const c = v.c, d = diffAt(c, T), cr = crewAt(c.crew, T);
    html += `<div class="ih"><b>DIFF · ${esc(c.name.toUpperCase())}</b><small>${c.wt ? "WORKTREE" : "MAIN CHECKOUT"} · EDITS ≤ T${d ? ` · LAST ${dayTag(d.last)} ${hhmm(d.last)}` : ""}</small></div>`;
    html += kv("PATH", esc(c.root)) + kv("LINES", d && d.dl ? `+${d.add} −${d.rem}` : d ? "no line counts in this build" : "—") + kv("FILES · EDITS", d ? `${d.files} · ${d.n}` : "—") + kv("AGENTS", esc(cr.agents.join(", ") || "—")) + (cr.people.length ? kv("PEOPLE", esc(cr.people.join(", "))) : "");
    html += diffFiles(c, c.name);
  }
  else if (v.type === "work") html += workInspector(v.a);
  $("inspCrumb").textContent = crumbs;
  $("inspBody").innerHTML = html;
  inspSel = inspectorSelectionIndex(previous, inspItems, inspSel);
  $("inspBody").querySelectorAll(".it").forEach(el => el.classList.toggle("sel", +el.dataset.i === inspSel));
  if (preserve) $("inspBody").scrollTop = scroll;
  else { const selEl = $("inspBody").querySelector(".it.sel"); if (selEl) selEl.scrollIntoView({ block: "nearest" }); }
  syncPreview();
}
$("inspBody").addEventListener("click", e => { const st = e.target.closest("[data-step]"); if (st) { stepWork(+st.dataset.step); return; } const it = e.target.closest(".it"); if (!it) return; inspSel = +it.dataset.i; drill(); });
$("inspBack").addEventListener("click", () => inspBack());
$("inspClose").addEventListener("click", () => closeInspector());
function drill() {
  const item = inspItems[inspSel]; if (!item) return;
  if (item.type === "work") { enterWork(item.a); return; }
  if (item.type === "file" || item.type === "url") { renderInspector(); openPreview(item); return; }
  if (item.type === "copy") { copy(item.text, item.what); return; }
  if (item.type === "nav") { goTo(item.path); return; }
  if (item.type === "dismiss") { dismissDelivery(item.d); return; }
  select(item);
  if (item.type === "event") { const x = evPos[item.e.i * 3]; if (Math.abs(x - xOf(T)) > BIN_W * 3 || !slicing) { /* keep time; nudge camera */ } camGoal.tx = x; follow = false; renderViews(); }
  inspStack.push(item); inspSel = 0; renderInspector();
}

/* ================= zero in: one ask, the session that did it, every file it touched ================= */
const VISUAL = /^(html?|png|jpe?g|gif|webp|svg|pdf)$/;
const extOf = p => { const m = p.match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toLowerCase() : ""; };
const kb = n => n < 0 ? "GONE" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : (n / 1048576).toFixed(1) + " MB";
const fileUrl = abs => `${API}/world-file?p=` + encodeURIComponent(abs);
function workFiles(a) {
  return a.work.files.map(([disp, abs, e, r, size, mtime]) => ({ disp, abs, e, r, size, mtime, ext: extOf(abs) }));
}
function enterWork(a) {
  const w = a.work; if (!w) { flash("NO LINKED SESSION FOR THIS ASK"); return; }
  const evs = (sessEvents.get(w.s) || []).filter(e => e.lane && e.t >= w.t0 && e.t <= w.t1 + 6e4);
  const foc = evGeo.getAttribute("foc"); foc.array.fill(0); evs.forEach(e => foc.array[e.gi] = 1); foc.needsUpdate = true;
  uniforms.uFocusOn.value = 1;
  const count = new Map(); evs.forEach(e => count.set(e.lane, (count.get(e.lane) || 0) + 1));
  const lane = [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || laneFor(a.tg) || lanes[0];
  focusWork = { a, w, lane, evs, set: new Set(evs) };
  if (playing) setPlaying(false);
  T = clamp(w.t1, T0, T1); sliceCache.key = -1;
  frameWork();
  select({ type: "ask", a });
  if (!inspStack.length || inspStack[inspStack.length - 1].type !== "work") openInspector({ type: "work", a }); else { inspStack[inspStack.length - 1] = { type: "work", a }; inspSel = 0; setFocus("x"); renderInspector(); }
  flash(`ZERO IN · ${a.tg.short.toUpperCase()} · ${w.files.length} FILES`);
}
function exitWork() {
  focusWork = null; ride = null; uniforms.uFocusOn.value = 0; pvBig = false; paintFoc(true); renderViews();
  if (focus === "x") setFocus("x"); flash("ZERO IN · OFF");
}
function frameWork() {
  const f = workFrame(); flight = null;
  follow = false; camGoal.tx = f.tx; camGoal.tz = f.tz; level = f.n; camGoal.r = f.r; renderZoomRail(); renderViews();
  ride = { lane: focusWork.lane, lz: focusWork.lane.z };   // lanes re-rank as the playhead moves: the camera stays on this one
}
function workFrame() {
  const { w, lane } = focusWork, r = gl.getBoundingClientRect(), aspect = r.width / Math.max(1, r.height);
  const need = Math.max(w.t1 - w.t0, 20 * 6e4) / 36e5 * XS * 1.5;           // world units the window needs on screen
  const rNeed = need / (2 * Math.tan(THREE.MathUtils.degToRad(16)) * aspect * 0.6); // leave room for the preview
  let n = 1; for (let i = 3; i >= 1; i--) if (LEVELS[i].r >= rNeed) { n = i; break; }
  return { tx: xOf((w.t0 + w.t1) / 2) + need * 0.12, tz: lane.z, r: LEVELS[n].r, n };
}
function stepWork(dir) {
  const from = focusWork ? focusWork.a.ts : T;
  const next = dir > 0 ? linked.find(a => a.ts > from + 1) : [...linked].reverse().find(a => a.ts < from - 1);
  if (!next) { flash(dir > 0 ? "NO LATER LINKED ASK" : "NO EARLIER LINKED ASK"); return; }
  inspStack = inspStack.filter(v => v.type !== "work" && v.type !== "event"); enterWork(next);
}
function zeroIn() {
  if (focusWork) { closeInspector(); return; }
  const top = inspStack[inspStack.length - 1];
  const a = (hover && hover.type === "ask" && hover.a.work && hover.a)
    || (top && top.type === "ask" && top.a.work && top.a)
    || [...linked].reverse().find(x => x.ts <= T) || linked[0];
  if (a) enterWork(a); else flash("NO LINKED ASKS IN THIS WEEK");
}
function drawWorkBracket(g, w, h) {
  const { w: wk, lane, a } = focusWork, xa = xOf(wk.t0), xb = xOf(Math.max(wk.t1, wk.t0 + 6e5));
  const za = lane.z + BAND0, zb = lane.z + BAND0 + NBANDS * BAND_W, c = (x, z, y = 0.05) => P(x, y, z, w, h);
  const q = [c(xa, za), c(xb, za), c(xb, zb), c(xa, zb)];
  if (q.some(p => !p.vis)) return;
  g.strokeStyle = ACC; g.globalAlpha = 0.9; g.setLineDash([3, 3]);
  g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.stroke(); g.setLineDash([]);
  g.globalAlpha = 0.05; g.fillStyle = ACC; g.fill(); g.globalAlpha = 1;
  [xa, xb].forEach((x, i) => { const b = c(x, za), t = c(x, za, 6); g.strokeStyle = ACC; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke();
    font(g, 7.5); g.fillStyle = ACC; g.textAlign = i ? "left" : "right"; g.fillText(hhmm(i ? wk.t1 : wk.t0), t.x + (i ? 5 : -5), t.y); });
  const t = c(xa, za, 6); font(g, 8.5); g.fillStyle = ACC; g.textAlign = "left";
  g.fillText(`WORK · ${dur(wk.t1 - wk.t0)} · ${wk.n} CALLS · ${wk.files.length} FILES · ${(sessions[wk.s].h || "").toUpperCase()} ${sessions[wk.s].sid}`, t.x, t.y - 12);
}
function workInspector(a) {
  const w = a.work, se = sessions[w.s], k = linked.indexOf(a);
  const files = workFiles(a), rootT = a.tg.root || se.root || "";
  const rel = d => rootT && d.startsWith(rootT + "/") ? d.slice(rootT.length + 1) : d;
  const arts = files.filter(f => VISUAL.test(f.ext) || f.ext === "md");
  const changed = files.filter(f => !arts.includes(f) && f.e > 0), read = files.filter(f => !arts.includes(f) && f.e === 0);
  const fileRow = f => row({ type: "file", f, a }, `<em>${f.e ? "EDIT" + (f.e > 1 ? "×" + f.e : "") : "READ"}</em>${esc(rel(f.disp))}`, f.size < 0 ? "GONE" : kb(f.size), VISUAL.test(f.ext) ? "acc" : "");
  let html = `<div class="ih"><b>ZERO IN · ${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()}</b><small>${se.h.toUpperCase()} ${se.sid} · ${dayTag(w.t0)} ${hhmm(w.t0)}–${hhmm(w.t1)} · ${dur(w.t1 - w.t0)} · ${w.n} CALLS · LINKED ASK ${k + 1} OF ${linked.length}</small><span class="steps"><button class="chip" data-step="-1">‹ [</button><button class="chip" data-step="1">] ›</button></span></div>`;
  html += `<div class="target">${esc(w.task || a.task || "—")}</div>`;
  html += kv("OUTCOME", a.st === "c" ? "completed" : a.st === "f" ? "failed" : "still open") + kv("WORKSPACE", esc(rootT || "—"));
  const byKind = {}; focusWork?.evs.forEach(e => byKind[e.k] = (byKind[e.k] || 0) + 1); const mk = Math.max(1, ...Object.values(byKind));
  html += `<div class="kinds">${KIND_ORDER.filter(x => byKind[x]).map(x => `<div><span>${KIND[x].label}</span><i style="width:${byKind[x] / mk * 100}%"></i><span>${byKind[x]}</span></div>`).join("")}</div>`;
  html += `<div class="sec">ARTIFACTS · ${arts.length}</div>` + (arts.length ? arts.map(fileRow).join("") : `<div class="none">No pages, images or docs touched</div>`);
  html += `<div class="sec">CHANGED · ${changed.length}</div>` + (changed.length ? changed.map(fileRow).join("") : `<div class="none">No code edits</div>`);
  if (read.length) html += `<div class="sec">READ · ${read.length}</div>` + read.slice(0, 40).map(fileRow).join("") + (read.length > 40 ? `<div class="none">+${read.length - 40} more</div>` : "");
  if (w.urls.length) html += `<div class="sec">URLS · ${w.urls.length}</div>` + w.urls.map(([u, n]) => row({ type: "url", url: u }, `<em>OPEN</em>${esc(u.replace(/^https?:\/\//, ""))}`, n > 1 ? "×" + n : "")).join("");
  if (w.cmds.length) html += `<div class="sec">COMMANDS · ${w.cmds.length}</div>` + w.cmds.map(c => `<div class="cmdl">${esc(c)}</div>`).join("");
  return html;
}

/* preview: files, artifacts and sites open in the right pane, stacked over the inspector (and the stash).
 * H / ESC goes back to the list underneath; P lifts the same window over the world and back */
const pv = document.createElement("div"); pv.className = "pv dock"; pv.hidden = true;
const aside = insp.parentElement; aside.appendChild(pv);
let pvBig = false, pvFor = null, pvTimer = 0, pvFile = null, pvUnmount = null, pvPinned = false;
const textCache = new Map();
const fetchText = abs => { if (!textCache.has(abs)) textCache.set(abs, fetch(fileUrl(abs)).then(r => r.ok ? r.text() : Promise.reject(r.status))); return textCache.get(abs); };
const ctxOf = a => ({ t1: a.work.t1, label: `${a.tg.short.toUpperCase()} · ${dayTag(a.ts)} ${hhmm(a.ts)}` });
function placePv() {
  pv.classList.toggle("big", pvBig); pv.classList.toggle("dock", !pvBig);
  if (!pvBig) { if (pv.parentElement !== aside) aside.appendChild(pv); pv.removeAttribute("style"); return; }
  if (pv.parentElement !== root) root.appendChild(pv);
  const host = root.getBoundingClientRect(), wr = panelW.getBoundingClientRect();
  Object.assign(pv.style, { left: wr.left - host.left + 8 + "px", top: wr.top - host.top + 30 + "px", width: wr.width - 16 + "px", height: wr.height - 38 + "px" });
}
// the pane follows the inspector: when its trail is gone, so is an unpinned preview
function syncPreview() { if (!inspStack.length && !pvPinned && !pv.hidden) hidePreview(); }
function hidePreview() {
  const was = !pv.hidden; pv.hidden = true; pvFor = null; pvFile = null; pvPinned = false; pvBig = false; placePv();
  if (pvUnmount) { pvUnmount(); pvUnmount = null; }
  if (was) { paintKeys(); if (!insp.hidden) renderInspector(); }
}
const PREVIEWABLE = it => it && (it.type === "file" || it.type === "url");
function openPreview(item) {
  if (item.type === "url") showSite(item.url, item.title); else showFile(item.f, item.ctx || (item.a ? ctxOf(item.a) : null));
}
// J K while the pane is open: the next file or site in the list underneath
function stepPreview(dir) {
  for (let i = inspSel + dir; i >= 0 && i < inspItems.length; i += dir) if (PREVIEWABLE(inspItems[i])) { inspSel = i; renderInspector(); openPreview(inspItems[i]); return; }
  flash(dir > 0 ? "LAST FILE IN THIS LIST" : "FIRST FILE IN THIS LIST");
}
const pvHead = (name, sub, tags, chips) => `<div class="pvh"><div class="pvt"><button class="chip" data-pv="close" title="Back (H · ESC)">‹ H</button><b>${esc(name)}</b><span class="r">${chips}</span></div><small>${esc(sub)}</small>${tags.length ? `<div class="pvtags">${tags.join("")}</div>` : ""}</div>`;
const bigChip = () => `<button class="chip" data-pv="big">${pvBig ? "DOCK" : "EXPAND"}<kbd>P</kbd></button>`;
function showFile(f, ctx, pinned = false) {
  pvPinned = pinned;
  if (pvFor === f.abs && !pv.hidden) return;
  if (pvUnmount) { pvUnmount(); pvUnmount = null; }
  const was = !pv.hidden;
  pvFor = f.abs; pvFile = { f, ctx }; pv.hidden = false; placePv(); if (!pvBig) revealRight();
  const name = f.disp.split("/").pop(), dir = f.disp.slice(0, -name.length - 1);
  const later = ctx && f.size >= 0 && f.mtime > ctx.t1 + 6e4;
  const tags = [f.e ? `<span class="acc">EDITED ×${f.e} ${ctx ? "DURING THE ASK" : "THIS WEEK"}</span>` : `<span>READ ONLY</span>`, remoteHost(f) ? `<span>ON ${esc(hostLabel(remoteHost(f)).toUpperCase())}</span>` : f.size < 0 ? `<span>GONE FROM DISK</span>` : f.size == null ? `<span>ON DISK</span>` : `<span>ON DISK NOW · ${kb(f.size)}</span>`];
  if (later) tags.push(`<span>CHANGED ${dur(f.mtime - ctx.t1)} AFTER</span>`);
  if (ctx && ctx.label) tags.push(`<span>${esc(ctx.label)}</span>`);
  const stashed = stash.some(x => x.f.abs === f.abs);
  pv.innerHTML = pvHead(name, dir, tags, `<button class="chip${stashed ? " on" : ""}" data-pv="stash">${stashed ? "STASHED" : "STASH"}<kbd>S</kbd></button>${bigChip()}<button class="chip" data-pv="open">OPEN<kbd>O</kbd></button>`)
    + `<div class="pvb"><div class="gone">LOADING…</div></div>`;
  clearTimeout(pvTimer); pvTimer = setTimeout(() => loadPreview(f), 90);
  if (!was) paintKeys();
}
// sites: an iframe where the site allows it; a card (title, host, open) where it won't, can't or isn't real
const NO_FRAME = /(^|\.)(github\.com|google\.com|youtube\.com|x\.com|twitter\.com|linkedin\.com|stackoverflow\.com|npmjs\.com|apple\.com|openai\.com|chatgpt\.com|anthropic\.com|claude\.ai|figma\.com|notion\.so|vercel\.com|stripe\.com|slack\.com|discord\.com|reddit\.com|medium\.com|amazon\.com|microsoft\.com)$/i;
function showSite(url, title) {
  pvPinned = false;
  if (pvFor === url && !pv.hidden) return;
  if (pvUnmount) { pvUnmount(); pvUnmount = null; }
  const was = !pv.hidden;
  pvFor = url; pvFile = { url }; pv.hidden = false; placePv(); if (!pvBig) revealRight();
  let u = null; try { u = new URL(url); } catch {}
  const host = u ? u.host : url, path = u ? decodeURI(u.pathname + u.search).replace(/^\/$/, "") : "";
  const name = title || (path.split("/").filter(Boolean).pop() || host).replace(/[-_]+/g, " ");
  const why = !u || !/^https?:$/.test(u.protocol) ? "NOT A WEB ADDRESS"
    : D.mock ? "SEEDED TEAM WEEK · THE SITE ISN'T REAL"
    : NO_FRAME.test(u.hostname) ? "THIS SITE REFUSES TO BE EMBEDDED"
    : /\.(internal|corp|lan)$/i.test(u.hostname) ? "PRIVATE HOST · OPEN IT FROM A MACHINE THAT CAN REACH IT" : "";
  pv.innerHTML = pvHead(name, host + path, [`<span>SITE</span>`, `<span>${esc(host)}</span>`], `${bigChip()}<button class="chip" data-pv="open">OPEN ↗<kbd>O</kbd></button>`)
    + `<div class="pvb">${why
      ? `<div class="sitecard"><small>SITE</small><b>${esc(name)}</b><span>${esc(host)}</span><span class="dim">${esc(path || "/")}</span><button class="chip" data-pv="open">OPEN IN A BROWSER TAB<kbd>O</kbd></button><p>${why}</p></div>`
      : `<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer" src="${esc(url).replace(/"/g, "&quot;")}"></iframe>`}</div>`
    + (why ? "" : `<div class="pvf"><span>BLANK? THE SITE REFUSES EMBEDDING OR ISN'T RUNNING</span><span>O · OPEN IN A TAB</span></div>`);
  if (!was) paintKeys();
}
function loadPreview(f) {
  const body = pv.querySelector(".pvb"); if (!body || pvFor !== f.abs) return;
  const rh = remoteHost(f); if (rh) { body.innerHTML = `<div class="sitecard"><small>FILE</small><b>${esc(f.disp.split("/").pop())}</b><span>on ${esc(hostLabel(rh))} · not on this host</span><span class="dim">${esc(f.disp.slice(rh.length + 1))}</span></div>`; return; }
  if (f.size < 0) { body.innerHTML = `<div class="gone">The session touched this file; nothing is there now.</div>`; return; }
  if (/^(png|jpe?g|gif|webp|svg)$/.test(f.ext)) { body.innerHTML = `<div class="pvimg"><img alt="" src="${fileUrl(f.abs)}"></div>`; return; }
  if (f.ext === "pdf") { body.innerHTML = `<iframe src="${fileUrl(f.abs)}"></iframe>`; return; }
  fetchText(f.abs).then(text => {
    if (pvFor !== f.abs) return;
    body.innerHTML = "";
    if (/^html?$/.test(f.ext)) { const fr = document.createElement("iframe"); fr.setAttribute("sandbox", "allow-scripts"); fr.srcdoc = text; body.appendChild(fr); return; }
    const host = document.createElement("div"); host.className = "fv"; body.appendChild(host);
    pvUnmount = mountFileView(host, f.abs, text.length > 200000 ? text.slice(0, 200000) : text);
  }).catch(() => { if (pvFor === f.abs) body.innerHTML = `<div class="gone">Not served — the file isn't on this week's list.</div>`; });
}
function toggleBig() {
  pvBig = !pvBig; placePv();
  const b = pv.querySelector('[data-pv="big"]'); if (b) b.firstChild.textContent = pvBig ? "DOCK" : "EXPAND";
}
const openOut = () => { if (!pvFile) return; window.open(pvFile.url || fileUrl(pvFile.f.abs), "_blank", "noopener"); };
function previewKey(k) {
  if (!pvFile || pv.hidden) return false;
  if (k === "o" || k === "O") { openOut(); return true; }
  if (k === "p" || k === "P") { toggleBig(); return true; }
  if (k === "s") { if (pvFile.f) stashFile(pvFile.f, pvFile.ctx); else flash("SITES DON'T STASH · O OPENS IT"); return true; }
  return false;
}
pv.addEventListener("click", e => {
  const b = e.target.closest("[data-pv]"); if (!b) return;
  const act = b.dataset.pv;
  if (act === "close") hidePreview(); else if (act === "big") toggleBig(); else if (act === "open") openOut();
  else if (act === "stash" && pvFile.f) stashFile(pvFile.f, pvFile.ctx);
});

/* stash: a canvas on the right column — files you keep, laid out where you drop them */
const STASH_KEY = "world-modale.stash.v1", stashEl = $("stash"), board = $("board");
try { stash = (JSON.parse(localStorage.getItem(STASH_KEY) || "[]") || []).filter(x => x && x.f && x.f.abs); } catch {}
// the stash lives on the server (survives browsers + devices); localStorage is only the instant first paint
let stashPut = 0;
function saveStash() {
  try { localStorage.setItem(STASH_KEY, JSON.stringify(stash)); } catch {}
  clearTimeout(stashPut);
  stashPut = setTimeout(() => { fetch(`${API}/world-stash`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(stash) }).catch(() => flash("STASH NOT SAVED · SERVER UNREACHABLE")); }, 400);
}
fetch(`${API}/world-stash`).then(r => r.ok ? r.json() : null).then(list => {
  if (!alive || !Array.isArray(list)) return;
  stash = list.filter(x => x && x.f && x.f.abs); try { localStorage.setItem(STASH_KEY, JSON.stringify(stash)); } catch {}
  renderStash(); renderViews();
}).catch(() => {});
function stashFile(f, ctx) {
  const name = f.disp.split("/").pop();
  if (stash.some(x => x.f.abs === f.abs)) { flash("ALREADY STASHED · " + name.toUpperCase()); return; }
  const n = stash.length;
  stash.push({ f, ctx: ctx || null, x: 10 + (n % 2) * 156, y: 10 + Math.floor(n / 2) * 140 });
  stashSel = stash.length - 1; saveStash(); renderStash(); renderViews();
  const b = pv.querySelector('[data-pv="stash"]'); if (b && pvFile && pvFile.f.abs === f.abs) { b.classList.add("on"); b.firstChild.textContent = "STASHED"; }
  flash("STASHED · " + name.toUpperCase() + " · " + stash.length + " IN STASH");
}
function unstash(i) { stash.splice(i, 1); stashSel = clamp(stashSel, 0, Math.max(0, stash.length - 1)); saveStash(); renderStash(); renderViews(); }
function renderTabs() {
  const t = cur => `<button class="tab${cur === "x" ? " on" : ""}" data-tab="x">INSPECT</button><button class="tab${cur === "s" ? " on" : ""}" data-tab="s">STASH<b>${stash.length}</b></button>`;
  $("inspTabs").innerHTML = t("x"); $("stashTabs").innerHTML = t("s");
}
function renderStash() {
  renderTabs();
  if (!stash.length) { board.innerHTML = `<div class="stash-empty">Press S on an open file to keep it here.</div>`; return; }
  board.innerHTML = stash.map((x, i) => { const name = x.f.disp.split("/").pop();
    return `<div class="card${i === stashSel && focus === "s" ? " sel" : ""}${pvFor === x.f.abs ? " live" : ""}" data-i="${i}" style="left:${x.x}px;top:${x.y}px"><div class="ch"><b>${esc(name)}</b><button data-x="${i}" title="Remove">×</button></div><small>${esc(x.ctx ? x.ctx.label : x.f.disp)}</small><div class="thumb" data-thumb="${i}"></div></div>`; }).join("");
  board.querySelectorAll("[data-thumb]").forEach(el => {
    const x = stash[+el.dataset.thumb], f = x.f;
    if (f.size < 0) { el.innerHTML = `<span class="tk">GONE</span>`; return; }
    if (/^(png|jpe?g|gif|webp|svg)$/.test(f.ext)) { el.innerHTML = `<img alt="" src="${fileUrl(f.abs)}">`; return; }
    if (f.ext === "pdf") { el.innerHTML = `<span class="tk">PDF</span>`; return; }
    fetchText(f.abs).then(text => {
      if (/^html?$/.test(f.ext)) { el.innerHTML = ""; const fr = document.createElement("iframe"); fr.setAttribute("sandbox", ""); fr.setAttribute("tabindex", "-1"); fr.srcdoc = text; el.appendChild(fr); el.classList.add("page"); return; }
      el.innerHTML = `<pre>${esc(text.split("\n").slice(0, 12).join("\n"))}</pre>`;
    }).catch(() => el.innerHTML = `<span class="tk">NOT SERVED</span>`);
  });
}
function showStash() {
  if (focus !== "s") stashPrevFocus = focus;
  stashEl.hidden = false; requestAnimationFrame(() => stashEl.classList.add("open")); setFocus("s"); renderStash();
}
function hideStash() {
  stashEl.classList.remove("open"); setTimeout(() => { if (!stashEl.classList.contains("open")) stashEl.hidden = true; }, 200);
  if (pvPinned) hidePreview();
  if (focus === "s") setFocus(!insp.hidden ? "x" : stashPrevFocus === "s" ? null : stashPrevFocus);
}
function openStashed(i) { const x = stash[i]; if (!x) return; stashSel = i; showFile(x.f, x.ctx, true); renderStash(); }
SCOPES.forEach(sc => sc.addEventListener("click", e => {
  const t = e.target.closest("[data-tab]"); if (!t) return;
  if (t.dataset.tab === "s") showStash();
  else { hideStash(); if (insp.hidden) openInspector({ type: "slice" }); else setFocus("x"); }
}));
$("stashClose").addEventListener("click", () => hideStash());
// cards: drag to arrange, click to open in the file window, × to remove
let cardDrag = null;
board.addEventListener("pointerdown", e => {
  if (e.button !== 0 || e.ctrlKey) return;
  const x = e.target.closest("[data-x]"); if (x) { unstash(+x.dataset.x); return; }
  const c = e.target.closest(".card"); if (!c) return;
  cardDrag = { i: +c.dataset.i, el: c, x: e.clientX, y: e.clientY, moved: 0 }; c.setPointerCapture(e.pointerId); c.classList.add("dragging"); e.preventDefault();
});
board.addEventListener("pointermove", e => {
  if (!cardDrag) return; const it = stash[cardDrag.i], dx = e.clientX - cardDrag.x, dy = e.clientY - cardDrag.y;
  cardDrag.moved += Math.abs(dx) + Math.abs(dy); cardDrag.x = e.clientX; cardDrag.y = e.clientY;
  it.x = Math.max(0, it.x + dx); it.y = Math.max(0, it.y + dy); cardDrag.el.style.left = it.x + "px"; cardDrag.el.style.top = it.y + "px";
});
const endCardDrag = () => { if (!cardDrag) return; const d = cardDrag; cardDrag = null; d.el.classList.remove("dragging"); if (d.moved < 4) openStashed(d.i); else saveStash(); };
board.addEventListener("pointerup", endCardDrag); board.addEventListener("pointercancel", endCardDrag);

/* right-click: one menu for anything that names a file — dots, arcs, stash cards, inspector rows, the file window.
 * Every item is backed: preview/stash/arrange happen here; reveal + open go to /api/ops/world-file (allowlisted, never moves or deletes). */
const cmHost = SLOTTED ? wmHost("wm--float") : root; if (SLOTTED) { document.body.appendChild(cmHost); disposers.push(() => cmHost.remove()); }
const cm = document.createElement("div"); cm.className = "cm"; cm.hidden = true; cmHost.appendChild(cm);
let cmItems = [], cmSel = -1;
function openMenu(cx, cy, head, items) {
  cmItems = items.filter(Boolean); cmSel = -1;
  cm.innerHTML = (head ? `<div class="cmh">${head}</div>` : "") + cmItems.map((it, i) => it === "-" ? `<hr>` : `<button data-m="${i}"${it.off ? " disabled" : ""}><span>${it.label}</span>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ""}</button>`).join("");
  cm.hidden = false;
  const host = cmHost.getBoundingClientRect(), w = cm.offsetWidth, h = cm.offsetHeight;
  cm.style.left = clamp(cx - host.left, 4, host.width - w - 4) + "px";
  cm.style.top = (cy - host.top + h > host.height - 4 ? Math.max(4, cy - host.top - h) : cy - host.top) + "px";
}
function closeMenu() { if (!cm.hidden) { cm.hidden = true; cmItems = []; } }
function menuMove(d) {
  const n = cmItems.length; if (!n) return;
  for (let k = 0; k < n; k++) { cmSel = (cmSel + d + n) % n; const it = cmItems[cmSel]; if (it !== "-" && !it.off) break; }
  cm.querySelectorAll("button").forEach(b => b.classList.toggle("sel", +b.dataset.m === cmSel));
}
function runMenu(i) { const it = cmItems[i]; if (!it || it === "-" || it.off) return; closeMenu(); it.act(); }
cm.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) runMenu(+b.dataset.m); });
cm.addEventListener("pointermove", e => { const b = e.target.closest("[data-m]"); if (b && +b.dataset.m !== cmSel) { cmSel = +b.dataset.m; cm.querySelectorAll("button").forEach(x => x.classList.toggle("sel", x === b)); } });
cm.addEventListener("contextmenu", e => e.preventDefault());
on(window, "pointerdown", e => { if (!cm.hidden && !cm.contains(e.target)) closeMenu(); }, true);
on(window, "blur", closeMenu);
on(window, "keydown", e => {
  if (cm.hidden) return;
  const k = e.key;
  if (k === "Escape") closeMenu();
  else if (k === "ArrowDown" || k === "j") menuMove(1);
  else if (k === "ArrowUp" || k === "k") menuMove(-1);
  else if (k === "Enter" || k === " ") { if (cmSel >= 0) runMenu(cmSel); }
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);

async function fileAction(f, action) {
  const name = f.disp.split("/").pop().toUpperCase();
  try {
    const r = await fetch(`${API}/world-file`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p: f.abs, action }) });
    flash(r.ok ? (action === "reveal" ? "REVEALED IN FINDER · " : "OPENED · ") + name : "NOT ON DISK · " + name);
  } catch { flash("STUDIO SERVER UNREACHABLE"); }
}
// an OPEN row: the app's own route when the host gave one, the page otherwise
function goTo(path) { if (opts.navigate) opts.navigate(path); else window.location.assign(path); }
// DISMISS: the runtime records the delivery as cancelled by the operator (routes/world.ts › world-delivery/dismiss);
// the row then reads as finished here, and the tally counts again
let dismissing = null;
async function dismissDelivery(d) {
  const id = d.ids && d.ids.delivery; if (!id || dismissing === id) return;
  dismissing = id; flash("DISMISSING");
  try {
    const r = await fetch(`${API}/world-delivery/dismiss`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const j = await r.json().catch(() => ({}));
    if (!alive) return;
    if (!r.ok) { flash(String(j.error || "the runtime did not take the change").toUpperCase()); return; }
    d.done = Math.max(d.ts, Math.min(T, j.at || Date.now())); d.st = "c"; d.dismissed = true;
    afterDismiss();
    flash("DISMISSED · THE RUNTIME MARKED IT CANCELLED");
  } catch { if (alive) flash("THE RUNTIME DID NOT TAKE THE CHANGE"); }
  finally { dismissing = null; }
}
function afterDismiss() {
  recapData = null; buildLog(); logLaneKey = "\u0000"; logSig = ""; paintSlow(); renderLivebar();
  if (recapOn) { recapSel = -1; paintRecap(); }
  if (!insp.hidden && inspStack.length) renderInspector(true);
}
function copy(text, what) { navigator.clipboard?.writeText(text).then(() => flash("COPIED " + what), () => flash("CLIPBOARD BLOCKED")); }
// the file items every menu shares
function fileItems(f, ctx) {
  const gone = f.size < 0, stashed = stash.findIndex(x => x.f.abs === f.abs);
  return [
    { label: "PREVIEW", kbd: "↵", off: gone, act: () => { pvBig = false; pvFor = null; showFile(f, ctx, true); } },
    { label: "EXPAND", kbd: "P", off: gone, act: () => { pvBig = true; pvFor = null; showFile(f, ctx, true); } },
    stashed < 0 ? { label: "STASH", kbd: "S", act: () => stashFile(f, ctx) } : { label: "REMOVE FROM STASH", act: () => unstash(stashed) },
    "-",
    { label: "REVEAL IN FINDER", off: gone, act: () => fileAction(f, "reveal") },
    { label: "OPEN WITH DEFAULT APP", off: gone, act: () => fileAction(f, "open") },
    { label: "OPEN IN BROWSER TAB", kbd: "O", off: gone, act: () => window.open(fileUrl(f.abs), "_blank", "noopener") },
    "-",
    { label: "COPY PATH", act: () => copy(f.abs, "PATH") },
    { label: "COPY NAME", act: () => copy(f.abs.split("/").pop(), "NAME") },
  ];
}
const fileHead = f => `<b>${esc(f.disp.split("/").pop())}</b><small>${esc(f.disp)}</small>`;
// a dot's file, shaped like a zero-in file row
function dotFile(e) {
  if (!e.file) return null;
  const fl = fileEvents.get(e.tgt) || [], ed = fl.filter(x => x.k === "e").length;
  return { disp: e.file.replace(/^\/Users\/[^/]+\//, "~/"), abs: e.file, e: ed, r: fl.length - ed, size: null, mtime: 0, ext: extOf(e.file) };
}
const askOfEvent = e => linked.find(a => a.work.s === e.sess && e.t >= a.work.t0 - 6e4 && e.t <= a.work.t1 + 6e4) || null;
function eventMenu(cx, cy, e) {
  const f = dotFile(e), a = askOfEvent(e);
  openMenu(cx, cy, `<b>${KIND[e.k].label} · ${esc(e.name)}</b><small>${esc(e.tgt || "—")}</small>`, [
    { label: "INSPECT", act: () => pick({ type: "event", e }) },
    a && { label: "ZERO IN ON ITS ASK", kbd: "Q", act: () => { pick({ type: "ask", a }); enterWork(a); } },
    ...(f ? ["-", ...fileItems(f, a ? ctxOf(a) : null)] : ["-", { label: e.k === "e" || e.k === "r" ? "FILE IS GONE FROM DISK" : e.k === "s" ? "A SEARCH · NO FILE" : "NO FILE ON THIS CALL", off: true, act: () => {} }, { label: "COPY TARGET", act: () => copy(e.tgt || e.name, "TARGET") }]),
  ]);
}
function askMenu(cx, cy, a) {
  openMenu(cx, cy, `<b>ASK · ${(a.rq ? a.rq.short : "—").toUpperCase()} → ${a.tg.short.toUpperCase()}</b><small>${esc((a.task || "").slice(0, 90))}</small>`, [
    { label: "INSPECT", act: () => pick({ type: "ask", a }) },
    { label: a.work ? `ZERO IN · ${a.work.files.length} FILES` : "NO LINKED SESSION", kbd: a.work ? "Q" : "", off: !a.work, act: () => { pick({ type: "ask", a }); enterWork(a); } },
    "-",
    { label: focusAgent === a.tg ? `LET GO OF ${a.tg.short.toUpperCase()}` : `FOCUS ON ${a.tg.short.toUpperCase()}`, act: () => flash(toggleFocusAgent(a.tg)) },
    ...(a.rq && a.rq.kind !== "person" && a.rq !== a.tg ? [{ label: focusAgent === a.rq ? `LET GO OF ${a.rq.short.toUpperCase()}` : `FOCUS ON ${a.rq.short.toUpperCase()}`, act: () => flash(toggleFocusAgent(a.rq)) }] : []),
    "-",
    { label: "COPY TASK", act: () => copy(a.task || "", "TASK") },
  ]);
}
function tidyStash() { stash.forEach((x, i) => { x.x = 10 + (i % 2) * 156; x.y = 10 + Math.floor(i / 2) * 140; }); saveStash(); renderStash(); flash("STASH · TIDIED"); }
function cardMenu(cx, cy, i) {
  const x = stash[i]; stashSel = i; renderStash();
  openMenu(cx, cy, fileHead(x.f), [
    ...fileItems(x.f, x.ctx).map(it => it && it.label === "PREVIEW" ? { ...it, act: () => openStashed(i) } : it),
    "-",
    { label: "BRING TO FRONT", off: i === stash.length - 1, act: () => { stash.push(stash.splice(i, 1)[0]); stashSel = stash.length - 1; saveStash(); renderStash(); } },
    { label: "TIDY THE STASH", act: tidyStash },
  ]);
}
board.addEventListener("contextmenu", e => {
  e.preventDefault(); const c = e.target.closest(".card");
  if (c) cardMenu(e.clientX, e.clientY, +c.dataset.i);
  else if (stash.length) openMenu(e.clientX, e.clientY, `<b>STASH</b><small>${stash.length} FILES</small>`, [{ label: "TIDY THE STASH", act: tidyStash }, { label: "CLEAR THE STASH", act: () => { stash = []; saveStash(); renderStash(); renderViews(); flash("STASH · CLEARED"); } }]);
});
gl.addEventListener("contextmenu", e => {
  e.preventDefault();
  const hit = (drag && drag.hit) || hover;  // where the menu opens on release, hover has gone blank under the held button
  if (!hit) return;                         // empty ground: right-drag orbits, no menu
  drag = null;
  if (hit.type === "event") eventMenu(e.clientX, e.clientY, hit.e); else if (hit.a) askMenu(e.clientX, e.clientY, hit.a);
});
$("inspBody").addEventListener("contextmenu", e => {
  const it = e.target.closest(".it"); if (!it) return; e.preventDefault();
  const i = +it.dataset.i, item = inspItems[i]; if (!item) return;
  if (i !== inspSel) { inspSel = i; renderInspector(); }
  if (item.type === "file") openMenu(e.clientX, e.clientY, fileHead(item.f), fileItems(item.f, item.ctx || (item.a ? ctxOf(item.a) : null)));
  else if (item.type === "event") eventMenu(e.clientX, e.clientY, item.e);
  else if (item.type === "ask" || item.type === "work") askMenu(e.clientX, e.clientY, item.a);
  else if (item.type === "url") openMenu(e.clientX, e.clientY, `<b>URL</b><small>${esc(item.url)}</small>`, [{ label: "OPEN IN BROWSER TAB", act: () => window.open(item.url, "_blank", "noopener") }, { label: "COPY URL", act: () => copy(item.url, "URL") }]);
});
pv.addEventListener("contextmenu", e => {
  if (!e.target.closest(".pvh") || !pvFile) return; e.preventDefault();
  if (pvFile.url) { openMenu(e.clientX, e.clientY, `<b>SITE</b><small>${esc(pvFile.url)}</small>`, [{ label: "OPEN IN BROWSER TAB", act: openOut }, { label: "COPY URL", act: () => copy(pvFile.url, "URL") }, "-", { label: "CLOSE", act: hidePreview }]); return; }
  openMenu(e.clientX, e.clientY, fileHead(pvFile.f), [...fileItems(pvFile.f, pvFile.ctx), "-", { label: "CLOSE", act: hidePreview }]);
});

/* palettes: paper linen ember dusk scout (theme.ts). CSS vars live in the page's theme block; this repaints canvas + GL live */
const wmEl = root.closest(".wm") || root;
function stampTheme(el) {
  if (!el) return;
  el.classList.add("wm-themes");
  el.dataset.theme = theme.id;
  el.dataset.accent = accentChoice.id;
  if (theme.light) el.dataset.light = "1"; else delete el.dataset.light;
  if (theme.skin) el.dataset.skin = theme.skin; else delete el.dataset.skin;
  el.dataset.style = styleId;
}
function paintPerfChrome() {
  const el = document.getElementById("wmperf"); if (!el) return;
  el.style.background = theme.sheet; el.style.color = accentCss;
}
// the accent is the palette's own (or a study's ?accent=): canvas + shader update here; the page restyles its CSS vars from wm-accent
function paintAccent() {
  const paint = accentPaint(theme, accentChoice);
  ACC = paint.cAccent; PINSUB = paint.pinSub; accentCss = paint.accent; accentHot = paint.hot;
  uniforms.uAcc.value.set(paint.cAccent);
  uniforms.uHot.value.set(paint.hot || theme.hot);
  [wmEl, ...SLOT_WRAPS, cmHost].forEach(el => { if (el) el.dataset.accent = accentChoice.id; });
  paintPerfChrome();
  window.dispatchEvent(new CustomEvent("wm-accent", { detail: { id: accentChoice.id, explicit: accentChoice.explicit } }));
}
function applyTheme(id, fromUser) {
  theme = isTheme(id) ? THEMES[id] : THEMES.scout; themeId = theme.id;
  if (!accentChoice.explicit) accentChoice = resolveAccent(theme.id);
  FG = theme.cInk; DIM = theme.cDim; FAINT = theme.cFaint; LINE = theme.cLine; HAIR = theme.hair;
  PEAK = theme.peak; PIN = theme.pin; TAG = theme.tag; TICK = theme.tick; DOT = theme.dot;
  MESHDOT = theme.meshDot; MESHEDGE = theme.meshEdge; MESHEDGEDIM = theme.meshEdgeDim; MESHNODE = theme.meshNode;
  paintAlarm();
  CFONT = theme.skin === "scout" ? '"SF Mono", ui-monospace, Menlo' : FONT;
  stampTheme(wmEl); [...SLOT_WRAPS, cmHost].forEach(w => { if (w && w !== root) stampTheme(w); });
  uniforms.uInk.value.set(theme.point);
  uniforms.uInkOn.value = theme.inkPoints ? 1 : 0;
  const blend = theme.blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
  if (mat.blending !== blend) { mat.blending = blend; mat.needsUpdate = true; }
  syncTints();
  const btn = $("paletteBtn"); if (btn) { btn.innerHTML = `PALETTE <b>${theme.label}</b>`; btn.title = `${theme.title} — cycle (')`; }
  // only a pick is kept, and for the app mode it was made in: a mount or a mode switch stores nothing
  if (fromUser) storeThemePick(theme.id);
  paintAccent();
  window.dispatchEvent(new CustomEvent("wm-theme", { detail: theme.id }));
  relayout();
  return `PALETTE · ${theme.label}`;
}
// the THEME: Panels boxes each section like the rest of the app; Hairline reads them as rows and runs the timeline
// across the View's foot. Only CSS changes (world-panels.css, styles.ts), so a relayout re-measures the View and its foot
function applyStyle(id, fromUser) {
  styleId = isStyle(id) ? id : "panels";
  [wmEl, ...SLOT_WRAPS, cmHost].forEach(el => { if (el) el.dataset.style = styleId; });
  const btn = $("themeBtn"); if (btn) { btn.innerHTML = `THEME <b>${STYLES[styleId].label}</b>`; btn.title = `${STYLES[styleId].title} — cycle (;)`; }
  if (fromUser) storeStylePick(styleId);
  if (fromUser && opts.urlParams !== false) { try { const u = new URL(location.href); u.searchParams.set("theme", styleId); history.replaceState(history.state, "", u); } catch {} }
  window.dispatchEvent(new CustomEvent("wm-style", { detail: styleId }));
  relayout();
  return `THEME · ${STYLES[styleId].label}`;
}
$("themeBtn").addEventListener("click", () => applyStyle(nextStyle(styleId), true));
$("paletteBtn").addEventListener("click", () => applyTheme(nextTheme(themeId), true));
// dataset: this machine's real week, or the synthetic team (?data=team). The page reads the param and loads the file
if (D.label) $("brandSub").textContent = `WORLD · ${D.label} · ${LIVE ? LIVE.hours + " H" : SPAN_LONG}`;
else $("brandSub").textContent = $("brandSub").textContent.replace("7 DAYS", LIVE ? LIVE.hours + " H" : SPAN_LONG);
$("dataBtn").innerHTML = `DATA <b>${D.label ? "TEAM" : "WEEK"}</b>`;
$("dataBtn").addEventListener("click", () => { if (opts.onData) { opts.onData(!D.label); return; } const u = new URL(location.href); if (D.label) u.searchParams.delete("data"); else u.searchParams.set("data", "team"); location.assign(u.toString()); });

/* ================= panels ================= */
let rosterSel = 0, laneSel = 0, stallSel = 0, rhythmSel = null;
function rosterRows() {
  return rosterAll.map(r => {
    const upto = r.list.filter(a => a.ts <= T);
    const done = upto.filter(a => stateAt(a, T) === "done");
    const stall = upto.filter(a => { const s = stateAt(a, T); return s === "failed" || s === "stuck"; });
    const durs = done.map(a => a.done - a.ts).sort((x, y) => x - y);
    const last = upto.length ? upto[upto.length - 1] : null;
    const live = upto.some(a => stateAt(a, T) === "flight");
    return { a: r.a, n: upto.length, done: done.length, stall: stall.length, med: durs.length ? durs[Math.floor(durs.length / 2)] : null, last, live };
  }).filter(r => r.n > 0).sort((x, y) => (y.last?.ts || 0) - (x.last?.ts || 0));
}
// BURN: each asked agent's sessions, whole-session tokens up to T; native sessions pooled per harness
function burnRows() {
  const seen = new Set(), rows = [], tot = {};
  sessions.forEach(se => { const n = tokSum(useAt(se, T)); tot[se.h] = (tot[se.h] || 0) + n; });
  const roll = (label, harness, list, a) => { const u = list.reduce((acc, se) => useAt(se, T).map((x, k) => acc[k] + x), [0, 0, 0, 0]), n = tokSum(u); if (!n) return;
    rows.push({ a, label, harness, n, hr: hitRate(u), cold: list.reduce((s, se) => s + se.colds.filter(c => c.t <= T).length, 0), share: tot[harness] ? n / tot[harness] : 0 }); };
  rosterAll.forEach(r => { const ss = [...new Set(r.list.filter(a => a.work && a.ts <= T).map(a => sessions[a.work.s]).filter(Boolean))]; ss.forEach(se => seen.add(se)); roll(r.a.short, (r.a.harness || ss[0]?.h || "—").replace("-acp", ""), ss, r.a); });
  [...new Set(sessions.map(se => se.h))].forEach(h => { const ss = sessions.filter(se => se.h === h && !seen.has(se) && se.native); roll(`native · ${ss.length}`, h, ss, null); });
  return rows.sort((x, y) => y.n - x.n);
}
let rosterCache = [], rosterRowH = 17.6;   // measured once per layout (relayout clears it), like the stalls
const rowsMeasured = new Set();
// the roster panel stops at its last row: a short roster hands its height to ASKS · OUTCOMES (flex-grow) instead of
// sitting on empty table. chrome = panel minus its scroll box, both from the ResizeObserver cache (no forced layout)
let rosterCap = "";
function capRoster(rows) {
  const box = $("roster").parentElement, panel = box.parentElement, chrome = sizeOf(panel).height - sizeOf(box).height;
  const cap = `${Math.ceil(chrome + 18 + Math.max(1, rows) * rosterRowH + 4)}px`;
  if (cap === rosterCap) return; rosterCap = cap; panel.style.maxHeight = cap;
  // and never squeezed past its first three rows: a short window takes the room from the outcomes list and lanes instead
  panel.style.minHeight = `${Math.ceil(chrome + 18 + clamp(rows, 1, 3) * rosterRowH + 4)}px`;
  // the outcomes list just gained or lost room; two frames so the ResizeObserver has its new size first
  requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) paintStalls(); }));
}
function paintRoster() {
  $("rosterHd").textContent = rosterView === "burn" ? "ROSTER · BURN" : "ROSTER · ASKED";
  $("rosterR").textContent = rosterView === "burn" ? "B · ASKED · SHARE = OF ITS HARNESS" : "J K · → FOCUS · ↵ FLY · B · BURN";
  if (rosterView === "burn") {
    rosterCache = burnRows(); const selectedIndex = rosterCache.findIndex(r => r.a && r.a === selectionAgent()); if (selectedIndex >= 0) rosterSel = selectedIndex; rosterSel = clamp(rosterSel, 0, Math.max(0, rosterCache.length - 1));
    const box = $("roster").parentElement, rowH = rosterRowH, vis = Math.max(3, Math.floor((sizeOf(box).height - 18) / rowH));
    const start = clamp(rosterSel - Math.floor(vis / 2), 0, Math.max(0, rosterCache.length - vis));
    setHTML($("roster"), `<tr><th style="width:31%">AGENT</th><th style="width:15%">HARN.</th><th class="n">TOKENS</th><th class="n">HIT</th><th class="n">COLD</th><th class="n" style="width:15%">SHARE</th></tr>` +
      rosterCache.slice(start, start + vis).map((r, k) => `<tr${r.a ? ` data-ai="${start + k}"` : ""} class="${r.a ? "" : "idle "}${r.a && r.a === focusAgent ? "foc " : ""}${(r.a && r.a === selectionAgent()) || (start + k === rosterSel && focus === "b") ? "sel" : ""}"><td>${esc(r.label)}</td><td>${esc(r.harness)}</td><td class="n">${fmtTok(r.n)}</td><td class="n">${r.hr == null ? "—" : Math.round(r.hr * 100) + "%"}</td><td class="n">${r.cold || "·"}</td><td class="n">${Math.round(r.share * 100)}%</td></tr>`).join("") +
      (rosterCache.length ? "" : `<tr><td colspan="6" class="dim">No token usage yet</td></tr>`));
    if (!rowsMeasured.has("roster")) { const row = $("roster").rows[1]; if (row && row.offsetHeight) { rosterRowH = row.offsetHeight; rowsMeasured.add("roster"); } }
    capRoster(rosterCache.length);
    return;
  }
  rosterCache = rosterRows(); const selectedIndex = rosterCache.findIndex(r => r.a === selectionAgent()); if (selectedIndex >= 0) rosterSel = selectedIndex; rosterSel = clamp(rosterSel, 0, Math.max(0, rosterCache.length - 1));
  const box = $("roster").parentElement, rowH = rosterRowH, vis = Math.max(3, Math.floor((sizeOf(box).height - 18) / rowH));
  const start = clamp(rosterSel - Math.floor(vis / 2), 0, Math.max(0, rosterCache.length - vis));
  setHTML($("roster"), `<tr><th style="width:34%">AGENT</th><th style="width:15%">HARN.</th><th class="n">ASKS</th><th class="n">DONE</th><th class="n">F·S</th><th class="n" style="width:15%">MED</th></tr>` +
    rosterCache.slice(start, start + vis).map((r, k) => `<tr data-ai="${start + k}" title="${esc((r.a.tag ? r.a.tag + " · " : "") + r.a.full + " · on " + hostLabel(actorHost(r.a)) + " · click to focus")}" class="${r.live ? "lit " : ""}${r.a === focusAgent ? "foc " : ""}${(r.a && r.a === selectionAgent()) || (start + k === rosterSel && focus === "b") ? "sel" : ""}"><td>${esc(r.a.short)}</td><td>${esc((r.a.harness || "—").replace("-acp", ""))}</td><td class="n">${r.n}</td><td class="n">${r.done}</td><td class="n">${r.stall || "·"}</td><td class="n">${dur(r.med)}</td></tr>`).join("") +
    (rosterCache.length ? "" : `<tr><td colspan="6" class="dim">No asks yet</td></tr>`));
  if (!rowsMeasured.has("roster")) { const row = $("roster").rows[1]; if (row && row.offsetHeight) { rosterRowH = row.offsetHeight; rowsMeasured.add("roster"); } }
  capRoster(rosterCache.length);
}
// a click on a row focuses that agent (again: lets go); the camera stays where it is. ↵ still flies
$("roster").addEventListener("click", ev => { const r = ev.target.closest("[data-ai]"); if (!r) return; const x = rosterCache[+r.dataset.ai]; if (!x || !x.a) return;
  rosterSel = +r.dataset.ai; select({ type: "agent", agent: x.a }); flash(toggleFocusAgent(x.a)); paintRoster(); });
// QUOTA · CACHE: the providers' own windows, then what the cache did — hourly, lit up to T
function paintQuota() {
  const rows = QUOTA.map((q, i) => ({ id: "q" + i, name: q.name, val: quotaAt(q, T), q }));
  const h = clamp(Math.floor((T - T0) / 36e5), 0, HOURS - 1), u = HOUR_USE[h], miss = u[0] + u[1] + u[2] ? (u[0] + u[2]) / (u[0] + u[1] + u[2]) : null;
  const coldN = COLDS.filter(c => c.t <= T && c.t > T - 864e5).length;
  setHTML($("quota"), (rows.length ? "" : `<div class="none">No quota samples in this period</div>`) +
    rows.map(r => `<div class="lane-row q-row"><span class="nm">${r.name}</span><span class="qv${r.val >= 90 ? " acc" : ""}">${r.val == null ? "—" : Math.round(r.val) + "%"}</span><canvas class="spark" data-q="${r.id}"></canvas></div>`).join("") +
    `<div class="q-sep"></div>` +
    `<div class="lane-row q-row"><span class="nm">CACHE · MISS</span><span class="qv">${miss == null ? "—" : (miss * 100).toFixed(miss < 0.1 ? 1 : 0) + "%"}</span><canvas class="spark" data-q="miss"></canvas></div>` +
    `<div class="lane-row q-row"><span class="nm">COLD · 24H</span><span class="qv">${coldN}</span><canvas class="spark" data-q="cold"></canvas></div>`);
  $$("[data-q]").forEach(c => { const { g, w, h: H } = fit(c), id = c.dataset.q, tx = (T - T0) / SPAN * w;
    if (id === "miss" || id === "cold") {
      const v = id === "cold" ? Array.from(COLD_H) : HOUR_USE.map(x => x[0] + x[1] + x[2] ? (x[0] + x[2]) / (x[0] + x[1] + x[2]) : 0);
      const mx = Math.max(...v, id === "miss" ? 0.05 : 1);
      v.forEach((x, i) => { const bx = i / HOURS * w, bh = x / mx * (H - 2); g.fillStyle = T0 + i * 36e5 <= T ? FG : FAINT; g.fillRect(bx, H - 1 - bh, 1, Math.max(x ? 1 : 0, bh)); });
    } else {
      const q = rows.find(r => r.id === id).q;
      g.fillStyle = LINE; g.fillRect(0, 1, w, 1);   // 100%
      for (let i = 0; i < HOURS; i++) { const t = T0 + (i + 1) * 36e5, v = quotaAt(q, t); if (v == null) continue; const bx = i / HOURS * w, bh = clamp(v, 0, 100) / 100 * (H - 2);
        g.fillStyle = t - 36e5 > T ? FAINT : v >= 90 ? ACC : FG; g.fillRect(bx, H - 1 - bh, 1, Math.max(1, bh)); }
    }
    g.fillStyle = ACC; g.fillRect(tx, 0, 1, H); });
}
// which machines worked in a lane: asks it took, by the target's host
const LANE_HOSTS = new Map(); asks.forEach(a => { const l = laneFor(a.tg), h = actorHost(a.tg); if (!l || !h) return; if (!LANE_HOSTS.has(l)) LANE_HOSTS.set(l, new Set()); LANE_HOSTS.get(l).add(h); });
const laneHosts = l => { const hs = LANE_HOSTS.get(l); return hs && hs.size ? "on " + [...hs].map(hostLabel).join(", ") : "no asks yet"; };
function paintLanes() {
  setHTML($("lanes"), lanes.map(l => `<div class="lane-row${l === selectionLane() || (l.idx === laneSel && focus === "c") ? " sel" : ""}${l.solo ? " solo" : ""}${l.off ? " off" : ""}" data-lane="${l.idx}" title="${esc(l.name + " · " + laneHosts(l))}">
    <span class="ix">${l.idx + 1}</span><span class="nm">${esc(l.name)}</span><canvas class="spark" data-spark="${l.idx}"></canvas></div>`).join(""));
  $$("[data-spark]").forEach(c => { const l = lanes[+c.dataset.spark]; const { g, w, h } = fit(c);
    const mx = Math.max(...l.smooth, 0.01); for (let i = 0; i < HOURS; i++) { const x = i / HOURS * w, v = l.smooth[i] / mx, t = T0 + i * 36e5;
      g.fillStyle = t <= T ? (l.solo ? ACC : FG) : FAINT; g.fillRect(x, h - 1 - v * (h - 2), 1, Math.max(1, v * (h - 2))); }
    g.fillStyle = ACC; g.fillRect((T - T0) / SPAN * w, 0, 1, h); });
}
function toggleRosterView() { rosterView = rosterView === "burn" ? "asked" : "burn"; paintRoster(); flash(rosterView === "burn" ? "ROSTER · BURN · TOKENS PER AGENT" : "ROSTER · ASKED"); }
$("rosterHd").style.cursor = "pointer"; $("rosterHd").addEventListener("click", toggleRosterView);
$("lanes").addEventListener("click", e => { const r = e.target.closest("[data-lane]"); if (!r) return; laneSel = +r.dataset.lane; setFocus("c"); select({ type: "lane", lane: lanes[laneSel] }); soloLane(laneSel); });
function soloLane(i) { const l = lanes[i]; const was = l.solo; lanes.forEach(x => x.solo = false); if (!was) l.solo = true; applyMask(); flash(was ? "LANES · ALL" : "SOLO · " + l.name.toUpperCase()); }
function setSoloHost(h) {
  soloHost = h; const at = evGeo.getAttribute("hs");
  events.forEach(e => { if (e.gi != null) at.array[e.gi] = h && sessHostOf(e.sess) === h ? 1 : 0; }); at.needsUpdate = true;
  uniforms.uHostSolo.value = h ? 1 : 0; renderViews(); paintSlow();
}
/* ================= focus: one agent lit, the rest quiet =================
   Its asks (to it or from it) keep their arcs and their words; the sessions that took its asks keep their calls and
   files; everything else falls back to a trace. Nothing moves: the camera and the playhead stay put. Zero in (one
   ask) takes the points over while it is open and hands them back (paintFoc). */
const mineAsk = a => !focusAgent || a.tg === focusAgent || a.rq === focusAgent;
const mineSess = i => !focusAgent || focusSess.has(i);
function focusSessions(agent) { const out = new Set(); asks.forEach(a => { if (a.tg === agent && a.work) out.add(a.work.s); }); return out; }
// live: new calls, and asks that link a session later, re-light; the signature keeps a still frame from refilling
function paintFoc(force) {
  if (focusWork) return;
  if (!focusAgent) { if (uniforms.uFocusOn.value) uniforms.uFocusOn.value = 0; focusSig = ""; return; }
  let linked = 0; asks.forEach(a => { if (a.tg === focusAgent && a.work) linked++; });
  const sig = `${focusAgent.id}|${events.length}|${linked}`; if (!force && sig === focusSig && uniforms.uFocusOn.value) return; focusSig = sig;
  focusSess = focusSessions(focusAgent);
  const at = evGeo.getAttribute("foc"); at.array.fill(0);
  events.forEach(e => { if (e.gi != null && focusSess.has(e.sess)) at.array[e.gi] = 1; }); at.needsUpdate = true;
  uniforms.uFocusOn.value = 1;
}
function setFocusAgent(agent) {
  focusAgent = agent || null; paintFoc(true); filesSig = ""; renderViews(); paintSlow();
  if (!focusAgent) return "FOCUS · OFF";
  const n = asks.filter(a => a.tg === focusAgent || a.rq === focusAgent).length;
  return `FOCUS · ${focusAgent.short.toUpperCase()} · ${n} ASK${n === 1 ? "" : "S"} · ${focusSess.size} SESSION${focusSess.size === 1 ? "" : "S"}`;
}
const toggleFocusAgent = agent => setFocusAgent(focusAgent === agent ? null : agent);
/** An agent by name or roster code: the asked ones first, then anyone the World knows (not people). */
function agentNamed(q) {
  const hit = rosterAll.find(r => nameHit(r.a, q)); if (hit) return hit.a;
  return actors.find(a => a.kind !== "person" && nameHit(a, q)) || null;
}

// the base mask (off · solo) decides what can be selection; pointing only steps the other lanes back
function maskBase(l) { const any = lanes.some(x => x.solo); return l.off ? 0.06 : any && !l.solo ? 0.12 : 1; }
function applyMask() { const any = lanes.some(l => l.solo), pl = psLane(); lanes.forEach((l, i) => { const b = maskBase(l); uniforms.uMask.value[i] = pl && l !== pl ? Math.min(b, 0.22) : b; }); lanes.forEach(l => { if (any && !l.solo) l.dim = true; else l.dim = false; }); paintLanes(); }

function drawTTD() {
  const { g, w, h } = fit($("ttd"));
  const done = asks.filter(a => stateAt(a, T) === "done").map(a => Math.max(1000, a.done - a.ts));
  const L = 4, R = w - 4, top = 14, bot = h - 14, lo = Math.log(1000), hi = Math.log(864e5);
  const NB = 34, bins = new Array(NB).fill(0); done.forEach(d => bins[clamp(Math.floor((Math.log(d) - lo) / (hi - lo) * NB), 0, NB - 1)]++);
  const max = Math.max(...bins, 1), bw = (R - L) / NB;
  bins.forEach((v, i) => { for (let k = 0; k < v; k++) { const y = bot - (k + 0.5) * Math.min(5, (bot - top) / max); g.fillStyle = FG; g.globalAlpha = 0.85; g.fillRect(L + i * bw + bw / 2 - 1.5, y - 1.5, 3, 3); } }); g.globalAlpha = 1;
  const x = ms => L + (R - L) * (Math.log(ms) - lo) / (hi - lo);
  [[1000, "1S"], [60e3, "1M"], [stuckMs, stuckLabel()], [36e5, "1H"], [864e5, "1D"]].filter(([ms], i, all) => i === 2 || ms !== stuckMs).forEach(([ms, l]) => { const N = ms === stuckMs; g.strokeStyle = N ? ALARM_DIM : LINE; g.setLineDash(N ? [2, 2] : []); g.beginPath(); g.moveTo(x(ms) + .5, top); g.lineTo(x(ms) + .5, bot); g.stroke(); g.setLineDash([]); g.fillStyle = FAINT; g.textAlign = "center"; g.fillText(l, x(ms), h - 5); });
  const s = done.slice().sort((a, b) => a - b);
  // the count, MED and P90 share the row above the dots: each marker's label takes the side of its line that's free
  const row = top - 6, cnt = `${done.length} DONE`, taken = [[L, L + g.measureText(cnt).width]];
  g.fillStyle = DIM; g.textAlign = "left"; g.fillText(cnt, L, row);
  if (s.length) { const med = s[Math.floor(s.length / 2)], p90 = s[Math.floor(s.length * 0.9)];
    [[med, "MED " + dur(med), -1], [p90, "P90 " + dur(p90), 1]].forEach(([ms, l, side]) => { const mx = x(ms) + .5, tw = g.measureText(l).width;
      g.strokeStyle = ACC; g.beginPath(); g.moveTo(mx, top - 4); g.lineTo(mx, bot); g.stroke();
      const spans = [side, -side].map(sd => sd < 0 ? [mx - 4 - tw, mx - 4] : [mx + 4, mx + 4 + tw]);
      const fit = spans.find(([a, b]) => a >= L && b <= R && !taken.some(([p, q]) => a < q + 6 && b > p - 6)); if (!fit) return;
      taken.push(fit); g.fillStyle = ACC; g.textAlign = "left"; g.fillText(l, fit[0], row); }); }
}

// time stack: timeline, activity, rhythm keep their rows; one is open, the others stay as strips
const TS = ["l", "e", "f"];
let tsCur = "l";
try { const v = localStorage.getItem("world-modale.ts"); if (TS.includes(v)) tsCur = v; } catch {}
const tstack = $("tstack");
function setTs(p, quiet) {
  if (!TS.includes(p)) return; tsCur = p; try { localStorage.setItem("world-modale.ts", p); } catch {}
  tstack.style.gridTemplateRows = TS.map(x => x === p ? "minmax(0, 1fr)" : "24px").join(" ");
  tstack.querySelectorAll(".ts").forEach(el => el.classList.toggle("cur", el.dataset.panel === p));
  if (!quiet) flash("TIME · " + PANEL_NAME[p]);
}
setTs(tsCur, true);
tstack.querySelectorAll(".ts").forEach(el => on(el, "click", () => { if (el.dataset.panel !== tsCur) setFocus(el.dataset.panel); }));
const stepTs = d => { const i = clamp(TS.indexOf(tsCur) + d, 0, TS.length - 1); setFocus(TS[i]); };
let tsWheelAt = 0;
on(tstack, "wheel", e => { if (Math.abs(e.deltaY) < 4 || performance.now() - tsWheelAt < 380) return; e.preventDefault(); tsWheelAt = performance.now(); stepTs(e.deltaY > 0 ? 1 : -1); }, { passive: false });
// the strips change size as the stack moves: redraw the canvases at their new size
let tsRaf = 0;
const tsRO = new ResizeObserver(() => { if (PERF) PERF.ro++; cancelAnimationFrame(tsRaf); tsRaf = requestAnimationFrame(() => { if (alive) { drawScrub(); drawProfile(); drawRhythm(); } }); });
tsRO.observe($("scrub")); tsRO.observe($("profile")); tsRO.observe($("rhythm")); disposers.push(() => tsRO.disconnect());

// timeline: the week as one line — days, every ask, the playhead; drag anywhere to scrub
let scrubGeom = null;
function drawScrub() {
  const { g, w, h } = fit($("scrub")), small = h < 30;
  const L = small ? 4 : 6, R = w - 6, mid = small ? h / 2 : h * 0.42; scrubGeom = { L, R };
  const xT = t => L + (R - L) * (t - T0) / SPAN, cx = xT(T);
  g.strokeStyle = LINE; g.beginPath(); g.moveTo(L, mid + .5); g.lineTo(R, mid + .5); g.stroke();
  g.strokeStyle = ACC; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(L, mid + .5); g.lineTo(cx, mid + .5); g.stroke(); g.globalAlpha = 1;
  // day labels shrink to fit a narrow scrub: "TUE 10/06" -> "TUE" -> every other day, never overlapping
  const dayPx = (R - L) * 864e5 / SPAN, full = g.measureText("WED 10/07").width + 10, short = g.measureText("WED").width + 8;
  const tagOf = dayPx >= full ? dayTag : d => DOW[new Date(d).getDay()], every = dayPx >= short ? 1 : 2;
  dayStarts.forEach((d, i) => { if (d < T0) return; const x = Math.round(xT(d)) + .5; g.strokeStyle = LINE; g.beginPath(); g.moveTo(x, mid - (small ? 4 : 10)); g.lineTo(x, mid + (small ? 4 : 10)); g.stroke();
    if (!small && i % every === 0) { g.fillStyle = d <= T ? DIM : FAINT; g.textAlign = "left"; g.fillText(tagOf(d), x + 4, h - 6); } });
  const tick = small ? 3 : 7;
  asks.forEach(a => { if (a.ts > T1) return; const x = Math.round(xT(a.ts)) + .5, st = stateAt(a, T), past = a.ts <= T;
    g.globalAlpha = past ? 0.85 : 0.22; g.strokeStyle = st === "flight" ? ACC : FG; g.beginPath(); g.moveTo(x, mid - tick); g.lineTo(x, mid - 1); g.stroke();
    if (st === "failed" && !small) { g.beginPath(); g.moveTo(x - 2, mid - tick - 4); g.lineTo(x + 2, mid - tick); g.moveTo(x + 2, mid - tick - 4); g.lineTo(x - 2, mid - tick); g.stroke(); } });
  g.globalAlpha = 1;
  const sp = loopSpan();
  if (sp) { g.fillStyle = ACC; g.globalAlpha = 0.1; g.fillRect(xT(sp[0]), mid - tick - 3, xT(sp[1]) - xT(sp[0]), tick + 6); g.globalAlpha = 1; }
  [["i", 1], ["o", -1]].forEach(([k, s]) => { if (inout[k] == null) return; const x = Math.round(xT(inout[k])) + .5, y0 = mid - tick - 3, y1 = mid + 3;
    g.strokeStyle = ACC; g.beginPath(); g.moveTo(x + 3 * s, y0); g.lineTo(x, y0); g.lineTo(x, y1); g.lineTo(x + 3 * s, y1); g.stroke(); });
  g.strokeStyle = ACC; g.beginPath(); g.moveTo(Math.round(cx) + .5, small ? 2 : 4); g.lineTo(Math.round(cx) + .5, small ? h - 2 : mid + 12); g.stroke();
  if (!small) { g.fillStyle = ACC; g.textAlign = cx > w - 90 ? "right" : "left"; g.fillText(`${DOW[new Date(T).getDay()]} ${hhmm(T)}`, cx + (cx > w - 90 ? -5 : 5), 6); }
}
// Pointer events can arrive faster than the map draws. The frame consumes the
// latest position; details catch up once, when the pointer is released.
const scrub = $("scrub");
let scrubPointer: number | null = null, scrubX: number | null = null;
let nextScrubDetails = 0;
function applyScrub() {
  if (scrubX == null || !scrubGeom) return;
  const width = scrubGeom.R - scrubGeom.L;
  if (width > 0) T = T0 + SPAN * clamp((scrubX - scrub.getBoundingClientRect().left - scrubGeom.L) / width, 0, 1);
  scrubX = null;
}
on(scrub, "pointerdown", ev => {
  if (scrubPointer !== null || ev.button !== 0) return;
  scrubPointer = ev.pointerId; scrubX = ev.clientX;
  if (LIVE && playing) setPlaying(false, false);
  scrub.setPointerCapture(ev.pointerId);
});
on(scrub, "pointermove", ev => { if (ev.pointerId === scrubPointer) scrubX = ev.clientX; });
const finishScrub = ev => {
  if (ev.pointerId !== scrubPointer) return;
  if (ev.type === "pointerup") scrubX = ev.clientX;
  applyScrub(); scrubPointer = null;
  paintSlow();
};
on(scrub, "pointerup", finishScrub);
on(scrub, "pointercancel", finishScrub);
on(scrub, "lostpointercapture", finishScrub);

let profGeom = null;
function drawProfile() {
  const { g, w, h } = fit($("profile"));
  if (h < 30) return drawProfileStrip(g, w, h);
  const L = 26, R = w - 4, top = 18, bot = h - 14;
  const aH = new Array(HOURS).fill(0), mH = new Array(HOURS).fill(0);
  asks.forEach(a => { const i = Math.floor((a.ts - T0) / 36e5); if (i >= 0 && i < HOURS) aH[i]++; });
  events.forEach(m => { const i = Math.floor((m.t - T0) / 36e5); if (i >= 0 && i < HOURS) mH[i]++; });
  const max = Math.max(...aH.map((v, i) => v * 20 + mH[i]), 1); profGeom = { L, R };
  g.strokeStyle = LINE; [0, .5, 1].forEach(f => { const y = bot - (bot - top) * f; g.beginPath(); g.moveTo(L, y + .5); g.lineTo(R, y + .5); g.stroke(); g.fillStyle = FAINT; g.textAlign = "right"; g.fillText(Math.round(max * f), L - 5, y); });
  const bw = (R - L) / HOURS, cur = (T - T0) / 36e5;
  for (let i = 0; i < HOURS; i++) { const x = L + i * bw, past = i <= cur;
    const ha = (bot - top) * aH[i] * 20 / max, hm = (bot - top) * mH[i] / max;
    g.fillStyle = FG; g.globalAlpha = past ? 0.55 : 0.15; g.fillRect(x, bot - hm, Math.max(1, bw - 0.6), hm);
    g.fillStyle = ACC; g.globalAlpha = past ? 0.95 : 0.25; g.fillRect(x, bot - hm - ha, Math.max(1, bw - 0.6), ha); }
  g.globalAlpha = 1;
  for (let d = 0; d <= 7; d++) { const day = midnight(d); if (day < T0 || day > T1) continue; const x = L + (R - L) * (day - T0) / SPAN;
    g.strokeStyle = LINE; g.beginPath(); g.moveTo(x + .5, top); g.lineTo(x + .5, bot); g.stroke(); g.fillStyle = FAINT; g.textAlign = "left"; g.fillText(DOW[new Date(day).getDay()], x + 3, h - 5); }
  const cx = L + (R - L) * (T - T0) / SPAN;
  g.strokeStyle = ACC; g.beginPath(); g.moveTo(cx + .5, top - 8); g.lineTo(cx + .5, bot); g.stroke();
  g.fillStyle = ACC; g.textAlign = cx > w - 80 ? "right" : "left"; g.fillText(`${DOW[new Date(T).getDay()]} ${hhmm(T)}`, cx + (cx > w - 80 ? -5 : 5), top - 6);
  g.fillStyle = FG; g.textAlign = "left"; g.fillText("TOOL EVENTS", L, 6); g.fillStyle = ACC; g.fillText("ASKS (×20)", L + 76, 6);
}
function drawProfileStrip(g, w, h) {
  const L = 4, R = w - 6, mH = new Array(HOURS).fill(0); profGeom = { L, R };
  events.forEach(m => { const i = Math.floor((m.t - T0) / 36e5); if (i >= 0 && i < HOURS) mH[i]++; });
  const max = Math.max(...mH, 1), bw = (R - L) / HOURS, cur = (T - T0) / 36e5;
  for (let i = 0; i < HOURS; i++) { const v = (h - 4) * Math.sqrt(mH[i] / max); g.fillStyle = FG; g.globalAlpha = i <= cur ? 0.5 : 0.14; g.fillRect(L + i * bw, h - 2 - v, Math.max(1, bw - 0.4), v); }
  g.globalAlpha = 1; const cx = Math.round(L + (R - L) * (T - T0) / SPAN) + .5; g.strokeStyle = ACC; g.beginPath(); g.moveTo(cx, 1); g.lineTo(cx, h - 1); g.stroke();
}
$("profile").addEventListener("click", ev => { if (!profGeom || tsCur !== "e") return; const r = ev.currentTarget.getBoundingClientRect(); setT(T0 + SPAN * clamp((ev.clientX - r.left - profGeom.L) / (profGeom.R - profGeom.L), 0, 1)); setFocus("e"); });

let rhythmGeom = null;
const dayStarts = (() => { const out = []; for (let d = 0, ms = midnight(0); ms <= T1; ms = midnight(++d)) out.push(ms); return out; })();
/** The dayStarts row `ts` falls in, -1 before the first. */
const dayOf = (ts) => { if (ts < dayStarts[0]) return -1; let i = 0; while (i + 1 < dayStarts.length && dayStarts[i + 1] <= ts) i++; return i; };
/** The local midnight that ends dayStarts row `i`. */
const dayEnd = (i) => dayStarts[i + 1] ?? midnight(i + 1);
function drawRhythm() {
  const { g, w, h } = fit($("rhythm"));
  if (h < 30) return drawRhythmStrip(g, w, h);
  const rows = dayStarts.length, L = 54, R = w - 6, top = 6, bot = h - 14, cw = (R - L) / 24, rh = (bot - top) / rows;
  rhythmGeom = { L, R, top, bot, cw, rh, rows };
  const grid = Array.from({ length: rows }, () => new Array(24).fill(0));
  const add = (ts, v) => { if (ts > T) return; const d = dayOf(ts); const hr = new Date(ts).getHours(); if (d >= 0 && d < rows) grid[d][hr] += v; };
  asks.forEach(a => add(a.ts, 20)); events.forEach(e => add(e.t, 1));
  const max = Math.max(...grid.flat(), 1);
  for (let d = 0; d < rows; d++) {
    const y = top + rh * (d + 0.5);
    g.fillStyle = DIM; g.textAlign = "left"; g.fillText(dayTag(dayStarts[d]), 0, y);
    for (let hr = 0; hr < 24; hr++) { const x = L + cw * (hr + 0.5), v = grid[d][hr] / max;
      const isCur = rhythmCurrent(dayStarts[d], hr, T);
      if (v > 0) { const s = 1.5 + Math.sqrt(v) * Math.min(cw, rh) * 0.8; g.fillStyle = isCur ? ACC : FG; g.globalAlpha = 0.25 + 0.75 * Math.sqrt(v); g.fillRect(x - s / 2, y - s / 2, s, s); g.globalAlpha = 1; }
      else { g.fillStyle = DOT; g.fillRect(x - 0.5, y - 0.5, 1, 1); }
      if (isCur) { g.strokeStyle = ACC; g.strokeRect(x - cw / 2 + .5, y - rh / 2 + .5, cw - 1, rh - 1); }
      if (rhythmSel && rhythmSel.d === d && rhythmSel.h === hr && focus === "f") { g.strokeStyle = FG; g.strokeRect(x - cw / 2 + 1.5, y - rh / 2 + 1.5, cw - 3, rh - 3); }
    }
  }
  [0, 6, 12, 18, 23].forEach(hr => { g.fillStyle = FAINT; g.textAlign = "center"; g.fillText(pad(hr), L + cw * (hr + 0.5), h - 5); });
}
// folded rhythm: the whole week × 24 hours as a 2px heat strip, same cells, no labels
function drawRhythmStrip(g, w, h) {
  const rows = dayStarts.length, L = 4, R = w - 6, cw = (R - L) / 24, rh = (h - 4) / rows, grid = Array.from({ length: rows }, () => new Array(24).fill(0));
  rhythmGeom = null;
  const add = (ts, v) => { if (ts > T) return; const d = dayOf(ts); if (d >= 0 && d < rows) grid[d][new Date(ts).getHours()] += v; };
  asks.forEach(a => add(a.ts, 20)); events.forEach(e => add(e.t, 1));
  const max = Math.max(...grid.flat(), 1);
  for (let d = 0; d < rows; d++) for (let hr = 0; hr < 24; hr++) { const v = grid[d][hr] / max, isCur = rhythmCurrent(dayStarts[d], hr, T);
    g.fillStyle = isCur ? ACC : FG; g.globalAlpha = isCur ? 1 : v > 0 ? 0.15 + 0.85 * Math.sqrt(v) : 0.05; g.fillRect(L + hr * cw + 0.5, 2 + d * rh, Math.max(1, cw - 1), Math.max(1, rh - 0.6)); }
  g.globalAlpha = 1;
}
$("rhythm").addEventListener("click", ev => { if (!rhythmGeom || tsCur !== "f") return; const r = ev.currentTarget.getBoundingClientRect(), G = rhythmGeom;
  const hr = Math.floor((ev.clientX - r.left - G.L) / G.cw), d = Math.floor((ev.clientY - r.top - G.top) / G.rh);
  if (hr >= 0 && hr < 24 && d >= 0 && d < G.rows) { rhythmSel = { d, h: hr }; setT(rhythmTime(dayStarts[d], hr)); setFocus("f"); } });

/* mesh map */
const hostAsks = new Map(); asks.forEach(a => { const hn = hostOf(a.tg); hostAsks.set(hn, (hostAsks.get(hn) || 0) + 1); });
const RINGS = { macos: 1, linux: 2, ios: 2.85 };
const hostNodes = (() => {
  const byRing = {}; D.hosts.forEach(hh => { if (hh.self) return; (byRing[hh.platform] ||= []).push(hh); });
  const out = [{ ...(D.hosts.find(x => x.self) || { name: "this host", platform: "macos", self: true, caps: [] }), x: 0, z: 0 }];
  Object.entries(byRing).forEach(([p, list]) => { list.sort((a, b) => a.name.localeCompare(b.name)); const R = RINGS[p] || 3.3, off = { macos: 0.4, linux: 0.15, ios: 1.1 }[p] || 0;
    list.forEach((hh, i) => { const a = off + i / list.length * Math.PI * 2; out.push({ ...hh, x: Math.cos(a) * R, z: Math.sin(a) * R }); }); });
  return out;
})();
const meshCam = { yaw: 0.6, pitch: 0.95, yawG: 0.6, pitchG: 0.95, zoom: 1 };
let meshDrag = null;
$("mesh").addEventListener("pointerdown", e => { meshDrag = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); setFocus("g"); });
$("mesh").addEventListener("pointermove", e => { if (!meshDrag) return; meshCam.yawG += (e.clientX - meshDrag.x) * 0.01; meshCam.pitchG = clamp(meshCam.pitchG + (e.clientY - meshDrag.y) * 0.008, 0.12, 1.45); meshDrag = { x: e.clientX, y: e.clientY }; });
$("mesh").addEventListener("pointerup", () => meshDrag = null);
// hover a machine: persona and the real host, never one without the other
let meshPts = [];
$("mesh").addEventListener("pointermove", e => { if (meshDrag) return; const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bd = 18 * 18; meshPts.forEach(({ n, p }) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = n; } });
  const t = best ? `${best.name}${best.host && best.host !== best.name ? " · " + best.host : ""} · ${best.platform || "?"}${best.self ? " · this machine" : ""}${best.stale ? " · stale" : ""}` : ""; if (e.currentTarget.title !== t) e.currentTarget.title = t; });
function drawMesh(dt) {
  let mt = PERF ? performance.now() : 0; const mk = k => { if (!PERF) return; const t = performance.now(); PERF.sec["mesh:" + k] = (PERF.sec["mesh:" + k] || 0) + t - mt; mt = t; };
  const k = reduced ? 1 : 1 - Math.pow(0.004, dt / 1000);
  meshCam.yaw += (meshCam.yawG - meshCam.yaw) * k; meshCam.pitch += (meshCam.pitchG - meshCam.pitch) * k;
  if (!reduced && !meshDrag && focus !== "g") meshCam.yawG += dt * 0.00006;
  mk("fit");
  const { g, w, h } = fit($("mesh"));
  const cx = w / 2, cy = h * 0.56, S = Math.min(w, h * 1.5) * 0.15 * meshCam.zoom;
  const cyaw = Math.cos(meshCam.yaw), syaw = Math.sin(meshCam.yaw), cp = Math.cos(meshCam.pitch), sp = Math.sin(meshCam.pitch);
  const pr = (x, y, z) => { const rx = x * cyaw - z * syaw, rz = x * syaw + z * cyaw; const yy = y * cp - rz * sp, zz = y * sp + rz * cp; const f = 1 / (1 + zz * 0.06); return { x: cx + rx * S * f, y: cy - yy * S * f, z: zz }; };
  mk("pre");
  // dotted ground plane
  g.fillStyle = MESHDOT; g.beginPath();
  for (let x = -3.6; x <= 3.6; x += 0.3) for (let z = -3.6; z <= 3.6; z += 0.3) { if (x * x + z * z > 13.5) continue; const p = pr(x, 0, z); g.rect(p.x, p.y, 1, 1); }
  g.fill();
  mk("ground");
  // rings
  [[1, "MAC"], [2, "LINUX"], [2.85, "IOS"]].forEach(([R, l]) => { g.strokeStyle = LINE; g.setLineDash([1, 3]); g.beginPath();
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, p = pr(Math.cos(a) * R, 0, Math.sin(a) * R); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.stroke(); g.setLineDash([]);
    const p = pr(R + 0.12, 0, 0); g.fillStyle = FAINT; g.textAlign = "left"; font(g, 7); g.fillText(l, p.x, p.y); });
  mk("rings");
  // ticks around
  g.strokeStyle = LINE; g.beginPath();
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, R1 = 3.45, R2 = i % 6 ? 3.55 : 3.7, p1 = pr(Math.cos(a) * R1, 0, Math.sin(a) * R1), p2 = pr(Math.cos(a) * R2, 0, Math.sin(a) * R2); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); }
  g.stroke();
  mk("ticks");
  const hub = hostNodes[0]; const recent = new Map();
  asks.forEach(a => { if (a.ts <= T && a.ts > T - 36e5) { const hn = hostOf(a.tg); recent.set(hn, (recent.get(hn) || 0) + 1); } });
  const maxA = Math.max(...hostAsks.values(), 1);
  const sorted = hostNodes.map(n => ({ n, p: pr(n.x, 0, n.z) })); meshPts = sorted; const _s = sorted.sort((a, b) => b.p.z - a.p.z);
  mk("recent");
  // edges
  hostNodes.slice(1).forEach(n => { const a = pr(0, 0, 0), b = pr(n.x, 0, n.z), traffic = hostAsks.get(n.name) || 0;
    g.strokeStyle = traffic ? MESHEDGE : MESHEDGEDIM; g.setLineDash(traffic ? [] : [1, 3]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    const live = recent.get(n.name) || 0; if (live) { for (let q = 0; q < Math.min(4, live); q++) { const f = ((performance.now() / 1600) + q / 4) % 1; g.fillStyle = ACC; g.fillRect(a.x + (b.x - a.x) * f - 1.5, a.y + (b.y - a.y) * f - 1.5, 3, 3); } } });
  mk("edges");
  // pillars, then their labels: the busiest hosts name themselves first and a label that would print over one yields
  const tags = [];
  sorted.forEach(({ n }) => { const v = hostAsks.get(n.name) || 0, H = v ? 0.25 + 1.6 * Math.sqrt(v / maxA) : 0.06;
    const b = pr(n.x, 0, n.z), t = pr(n.x, H, n.z), live = (recent.get(n.name) || 0) > 0;
    g.strokeStyle = n.self || live ? ACC : v ? FG : FAINT; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke();
    for (let yy = 0; yy < H; yy += 0.12) { const p = pr(n.x, yy, n.z); g.fillStyle = g.strokeStyle; g.fillRect(p.x - 2, p.y, 4, 0.8); }
    const s = n.self ? 5 : 3; g.fillStyle = n.self ? ACC : v ? FG : MESHNODE; g.fillRect(t.x - s / 2, t.y - s / 2, s, s);
    tags.push({ n, v, t }); });
  { const taken = [], rank = q => (q.n.self ? 1e9 : 0) + (soloHost && q.n.host === soloHost ? 1e8 : 0) + q.v;
    tags.sort((p, q) => rank(q) - rank(p)).forEach(({ n, v, t }) => {
      const name = n.host && n.host !== n.name ? `${n.name.toUpperCase()} · ${n.host}` : n.name.toUpperCase();
      let sub = null, subA = FAINT;
      if (win) { const c = winHostCounts(win), mh = MESH_BY.get(n.host); subA = mh && c.calls[mh.k] ? ACC : FAINT; sub = `${win.R.label} · ${(mh ? c.calls[mh.k] : 0).toLocaleString("en-US")} CALLS · ${c.asks.get(n.host) || 0} ASKS`; }
      else if (v) sub = `${v} ASKS`;
      font(g, n.self ? 8 : 7); let bw = g.measureText(name).width; if (sub) { font(g, 7); bw = Math.max(bw, g.measureText(sub).width); }
      const box = [t.x + 4, t.y - 7, bw + 4, sub ? 18 : 10];
      if (taken.some(r => box[0] < r[0] + r[2] && box[0] + box[2] > r[0] && box[1] < r[1] + r[3] && box[1] + box[3] > r[1])) return;
      taken.push(box);
      font(g, n.self ? 8 : 7); g.textAlign = "left"; g.fillStyle = n.self || (soloHost && n.host === soloHost) ? ACC : v ? FG : DIM; g.fillText(name, t.x + 6, t.y - 2);
      if (sub) { g.fillStyle = subA; font(g, 7); g.fillText(sub, t.x + 6, t.y + 7); } }); }
  mk("pillars");
  font(g, 7.5); g.fillStyle = DIM; g.textAlign = "left";
  g.fillText(`YAW ${((meshCam.yaw * 180 / Math.PI) % 360 + 360).toFixed(0) % 360}°  TILT ${(meshCam.pitch * 180 / Math.PI).toFixed(0)}°`, 0, 6);
  // The hub label holds the left; the key takes the longest form that clears it, or none, so the two never overprint.
  const hubLabel = `■ HUB · ${HUB.toUpperCase()}`, clear = w - g.measureText(hubLabel).width - 12;
  const key = [win ? `PILLAR = ASKS HANDLED · 7D · COUNTS = WINDOW ${win.R.label}` : null, "PILLAR = ASKS HANDLED · 7D", "PILLAR = ASKS · 7D"]
    .find(k => k && g.measureText(k).width <= clear);
  if (key) { g.textAlign = "right"; g.fillText(key, w, h - 4); }
  g.textAlign = "left"; g.fillStyle = ACC; g.fillText(hubLabel, 0, h - 4);
  mk("text");
}

/* outcomes + stalls */
function paintOutcomes() {
  const upto = asks.filter(a => a.ts <= T);
  const done = upto.filter(a => stateAt(a, T) === "done"), stalls = upto.filter(a => { const s = stateAt(a, T); return s === "failed" || s === "stuck"; });
  const d = done.map(a => a.done - a.ts).sort((x, y) => x - y);
  // per-day bars: the week's (live, the running list takes their place)
  if (!LIVE) { const { g, w, h } = fit($("days")); const n = dayStarts.length, bw = w / n;
  const mx = Math.max(...dayStarts.map((ds, i) => asks.filter(a => a.ts >= ds && a.ts < dayEnd(i)).length), 1);
  dayStarts.forEach((ds, i) => { const list = asks.filter(a => a.ts >= ds && a.ts < dayEnd(i) && a.ts <= T);
    const c = list.filter(a => stateAt(a, T) === "done").length, s = list.filter(a => { const q = stateAt(a, T); return q === "failed" || q === "stuck"; }).length, f = list.filter(a => stateAt(a, T) === "flight").length;
    const x = i * bw + 4, ww = bw - 8, base = h - 12, sc = (h - 22) / mx;
    g.fillStyle = FG; g.globalAlpha = 0.8; g.fillRect(x, base - c * sc, ww, c * sc); g.globalAlpha = 1;
    g.fillStyle = ACC; g.fillRect(x, base - (c + f) * sc, ww, f * sc);
    g.strokeStyle = FG; if (s) g.strokeRect(x + .5, base - (c + f + s) * sc + .5, ww - 1, s * sc - 1);
    const cur = T >= ds && T < dayEnd(i); g.fillStyle = cur ? ACC : FAINT; g.textAlign = "center"; g.fillText(DOW[new Date(ds).getDay()], x + ww / 2, h - 4);
    if (list.length) { g.fillStyle = DIM; g.fillText(c + (s ? "·" + s : ""), x + ww / 2, base - (c + f + s) * sc - 6); } }); }
  // DOM after the canvas: a canvas font set after a DOM write forces a style recalc
  $("mDone").textContent = done.length; $("mStall").innerHTML = `${trouble.nFail}<em class="dim"> · ${trouble.stuck.length}</em>`; $("mStall").classList.toggle("al", !!(trouble.nFail || trouble.stuck.length));
  $("mMed").textContent = d.length ? dur(d[Math.floor(d.length / 2)]) : "—"; $("mP90").textContent = d.length ? dur(d[Math.floor(d.length * 0.9)]) : "—";
  $("rFlight").textContent = upto.filter(a => stateAt(a, T) === "flight").length;
  $("rAsk").textContent = upto.length;
  const last = upto[upto.length - 1]; $("rLast").textContent = last ? last.tg.short.toUpperCase() : "—";
}
/* code: worktrees, PRs and diffs as they stood at T — the right pane's resting list; ↵ opens one in the inspector */
let codeItems = [], codeSel = 0, codePin = null;   // codePin: :select worktree — the row that stays selected as the list re-sorts
function paintCode() {
  const t = T, wts = WTS.filter(w => w.t0 <= t).map(w => ({ w, last: (w.evs[nUpTo(w.evs, t) - 1] || w).t || w.t0 })).sort((a, b) => b.last - a.last);
  const prs = PRS.filter(p => p.t0 <= t), merged = prs.filter(p => prState(p, t) === "merged").length;
  const cos = [...CHECKOUTS.values()].map(c => ({ c, d: diffAt(c, t) })).filter(x => x.d).sort((a, b) => b.d.last - a.d.last);
  $("vcs").innerHTML = `<div><span>WORKTREES</span><b>${countTo(VCS.wt, t)}</b></div><div><span>BRANCHES</span><b>${VCS.br ? countTo(VCS.br, t) : "—"}</b></div>` +
    `<div><span>PRS</span><b>${VCS.pr ? `${prs.length}<em> · ${merged} MERGED</em>` : "—"}</b></div>`;
  codeItems = []; let html = "";
  if (codePin) { const i = wts.findIndex(x => x.w === codePin); if (i >= 0) codeSel = i; }
  const item = (it, l1, l2) => { codeItems.push(it); const i = codeItems.length - 1; return `<div class="cr${i === codeSel && focus === "v" ? " sel" : ""}" data-ci="${i}"><div class="l1">${l1}</div><div class="l2">${l2}</div></div>`; };
  const who = c => esc(c.agents.slice(0, 3).join(", ") || "—") + (c.agents.length > 3 ? ` +${c.agents.length - 3}` : "") + (c.people.length ? ` · ${esc(c.people.join(", "))}` : "");
  html += `<div class="csec"><span>WORKTREES · ${wts.length}</span><span>FIRST – LAST ≤ T</span></div>`;
  html += wts.length ? wts.map(({ w, last }) => { const d = diffAt(w.co, t);
    const pr = w.prs.filter(p => p.t0 <= t).pop(), ps = pr && prState(pr, t);
    return item({ type: "worktree", wt: w }, `<b>${esc(w.name)}</b><span>${esc(w.branch || "detached")}${pr ? ` <em class="pr${ps === "open" ? " acc" : ""}">#${pr.num} ${ps}</em>` : ""}</span><span class="n">${whenTag(w.t0)}–${dayTag(last) === dayTag(w.t0) ? hhmm(last) : whenTag(last)}</span>`,
      `<span>${esc(repoName(w.parent))}</span><span>${who(crewAt(w.crew, t))}</span><span class="n">${d ? dlText(d) : ""}</span>`); }).join("") : `<div class="none">No worktrees yet</div>`;
  const tot = cos.reduce((a, { d }) => [a[0] + d.add, a[1] + d.rem, a[2] + d.files], [0, 0, 0]), anyDl = cos.some(x => x.d.dl);
  const mx = Math.max(1, ...cos.map(x => x.d.add + x.d.rem));
  html += `<div class="csec"><span>DIFFS · BY CHECKOUT</span><span>${anyDl ? `+${fmtN(tot[0])} −${fmtN(tot[1])} · ` : ""}${tot[2]} FILES</span></div>`;
  html += cos.length ? cos.slice(0, 40).map(({ c, d }) => item({ type: "diff", c }, `<b>${esc(c.name)}</b><span>${c.wt ? "worktree" : "main checkout"}</span><span class="n">${dlText(d)}</span>`,
    `<span>${d.files} files · ${d.n} edits</span><span class="db">${d.dl ? `<i style="width:${d.add / mx * 100}%"></i><i class="rm" style="width:${d.rem / mx * 100}%"></i>` : ""}</span><span class="n">${whenTag(d.last)}</span>`)).join("") : `<div class="none">No edits yet</div>`;
  $("code").innerHTML = html;
  codeSel = clamp(codeSel, 0, Math.max(0, codeItems.length - 1));
  if (codePin && focus === "v") codeSelIntoView();
}
const codeSelIntoView = () => { const el = $("code").querySelector(".cr.sel"); if (el) el.scrollIntoView({ block: "nearest" }); };
function openCode() {
  const it = codeItems[codeSel]; if (!it) return;
  if (it.type === "diff") openInspector(it.c.wt ? { type: "worktree", wt: it.c.wt } : { type: "diff", c: it.c });
  else openInspector(it);
}
$("code").addEventListener("click", e => { const r = e.target.closest("[data-ci]"); if (!r) return; codeSel = +r.dataset.ci; codePin = null; setFocus("v"); openCode(); });
/* ---- FAILED · STUCK: one scan at T (~7×/s while playing, so on the wall clock in LIVE), read by the panel, the tally,
 * the overlay and N / ⇧N. Nothing here moves the camera or reorders anything by itself: only a key or a click flies ---- */
let errorsOn = PQ.get("errors") === "1";   // :errors — the world dims under a veil; only trouble stays lit
let tallyMode = PQ.get("wmtally") === "inline" ? "inline" : "foot";
const failT = o => o.kind === "tool" ? o.t : o.done;
const troubleLane = o => o.kind === "tool" ? (sessions[o.sess] && sessions[o.sess].lane) || null : (o.tg && laneFor(o.tg)) || (o.rq && laneFor(o.rq)) || null;
const troubleWho = o => o.kind === "tool" ? `${((sessions[o.sess] && sessions[o.sess].h) || "—").toUpperCase()} · ${String(o.tool).toUpperCase()}`
  : `${(o.rq ? o.rq.short : "—").toUpperCase()} → ${(o.kind === "msg" ? (o.fanN > 1 ? o.fanN + " AGENTS" : o.toA ? o.toA.short : o.toName) : o.tg.short).toUpperCase()}`;
const troubleWhat = o => o.kind === "tool" ? sq(o.err || o.tgt || "errored") : sq(o.kind === "msg" ? o.task : o.task);
const KIND_TAG = { ask: "ASK", msg: "MSG", tool: "TOOL" };
let trouble = { stuck: [], failed: [], nFail: 0, kinds: { ask: 0, msg: 0 }, quiet: { reconciled: 0, tool: 0, stale: 0, undeliverable: 0 }, since: 0, buckets: [0, 0, 0], t: T0, a: T0, b: T0 };
const troubleSeen = new Map();   // failure → performance.now() it was first seen arriving at the head while playing: its bloom
let resolves = [];               // { o, t0, failed } — a stuck item that just cleared (done) or turned into a failure
let lastScan = { t: -1, ms: stuckMs, keys: new Set() };
// bounded in time: a playhead step this big is a seek, not time passing — no blooms, no resolves
const troubleStep = () => Math.max(10e3, LIVE ? 10e3 : SPAN * 600 / LOOP_MS * speed);
const ltIdx = (list, t) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < t) lo = m + 1; else hi = m; } return lo; };
function scanTrouble() {
  const t = T, W = win, a0 = W ? W.a : T0, b0 = W ? Math.min(W.b, t) : t, now = performance.now();
  // alarm: failed asks, really-failed deliveries, stuck inside the horizon. quiet: reconciled deliveries, tool errors, stale,
  // and messages to a session that has ended (undeliverable: they will never arrive, so they are not stuck)
  const stuck = [], failed = [], kinds = { ask: 0, msg: 0 }, quiet = { reconciled: 0, tool: 0, stale: 0, undeliverable: 0 };
  for (const a of asks) {
    if (a.ts > t) continue;
    if (isFailed(a, t)) { if (a.done >= a0 && a.done <= b0) { a.kind = "ask"; failed.push(a); kinds.ask++; } }
    else if (stuckAt(a, t)) { a.kind = "ask"; stuck.push(a); }
    else if (isStale(a, t, stuckMs, staleMs)) quiet.stale++;
  }
  // a broadcast takes one row (its first copy in that state), carrying how many copies are in it
  const fanRow = (d, list, seen) => { const head = d.fan.n > 1 ? seen.get(d.fan) : null; if (head) { head.fanN++; return false; } d.fanN = 1; if (d.fan.n > 1) seen.set(d.fan, d); list.push(d); return true; };
  const fanStuck = new Map(), fanFailed = new Map();
  for (const d of DLV) {
    if (d.ts > t) continue;
    if (isReconciled(d)) { if (d.done != null && d.done >= a0 && d.done <= b0) quiet.reconciled++; }
    else if (isFailed(d, t)) { if (d.done >= a0 && d.done <= b0 && fanRow(d, failed, fanFailed)) kinds.msg++; }
    else if (isUndeliverable(d, t)) quiet.undeliverable++;
    else if (isStuck(d, t, stuckMs, staleMs)) fanRow(d, stuck, fanStuck);
    else if (isStale(d, t, stuckMs, staleMs)) quiet.stale++;
  }
  quiet.tool = ltIdx(ERRS, b0 + 1) - ltIdx(ERRS, a0);
  stuck.sort((x, y) => x.ts - y.ts);                 // oldest on top
  failed.sort((x, y) => failT(y) - failT(x));        // newest first
  const buckets = stuckBuckets(stuck.map(o => t - o.ts), stuckMs);
  let since = 0;
  if (LIVE) { for (const a of asks) if (isFailed(a, t) && a.done >= MOUNT_WALL) since++; for (const d of DLV) if (isFailed(d, t) && d.done >= MOUNT_WALL) since++; }
  // arrivals: what crossed the head since the last scan — a failure blooms; a stuck item that left the list resolves
  const stepped = playing && lastScan.t >= 0 && t >= lastScan.t && t - lastScan.t <= troubleStep() && lastScan.ms === stuckMs;
  if (stepped) {
    let nb = 0;
    for (const o of failed) { const ft = failT(o); if (ft <= lastScan.t) break; if (!troubleSeen.has(o) && nb++ < 24) troubleSeen.set(o, now); }
    const keys = new Set(stuck);
    lastScan.keys.forEach(o => { if (!keys.has(o) && o.done != null && o.done <= t) resolves.push({ o, t0: now, failed: o.st === "f" }); });
  }
  if (troubleSeen.size > 600) for (const [o, t0] of troubleSeen) if (now - t0 > 2000) troubleSeen.delete(o);
  lastScan = { t, ms: stuckMs, keys: new Set(stuck) };
  trouble = { stuck, failed, nFail: failed.length, kinds, quiet, since, buckets, t, a: a0, b: b0 };
}
const rungLabel = () => win ? win.R.label : "THE WEEK ≤ T";
let stallCache = [], stallRowH = 18.4;   // measured from the last paint, so any skin's row size fills the panel
function paintStalls() {
  const tr = trouble;
  stallCache = [...tr.stuck, ...tr.failed];
  if (selectionWork()) { const i = stallCache.indexOf(selectionWork()); if (i >= 0) stallSel = i; }
  stallSel = clamp(stallSel, 0, Math.max(0, stallCache.length - 1));
  const box = $("stalls").parentElement, vis = Math.max(1, Math.floor((sizeOf(box).height - 18) / stallRowH));   // whole rows only: a squeezed panel shows fewer, never a half row
  const start = clamp(stallSel - Math.floor(vis / 2), 0, Math.max(0, stallCache.length - vis));
  const when = ms => `${DOW[new Date(ms).getDay()]} ${hhmm(ms)}`;
  setHTML($("stalls"), `<tr><th style="width:84px">STATE</th><th style="width:34%">WHO</th><th>WHAT</th><th class="n" style="width:62px">WHEN</th></tr>` +
    stallCache.slice(start, start + vis).map((o, k) => { const isStuck = k + start < tr.stuck.length;
      const tag = isStuck ? `STUCK ${dur(tr.t - o.ts).toUpperCase()}` : `FAILED · ${KIND_TAG[o.kind]}`;
      const what = isStuck ? troubleWhat(o) : o.kind === "tool" ? troubleWhat(o) : sq(o.err || "") || troubleWhat(o) || "no reason recorded";
      return `<tr data-ti="${start + k}" class="tr-${isStuck ? "stuck" : o.kind}${start + k === stallSel && (focus === "h" || selectionWork() === o) ? " sel" : ""}"><td class="al">${tag}</td><td>${esc(troubleWho(o))}</td><td class="dim">${esc(what)}</td><td class="n">${when(isStuck ? o.ts : failT(o))}</td></tr>`; }).join("") +
    (stallCache.length ? "" : `<tr><td colspan="4" class="dim">Nothing failed or stuck past ${stuckLabel().toLowerCase()} · ${win ? "in this window" : "at this point in the week"}</td></tr>`));
  $("stallH").innerHTML = `FAILED · STUCK &gt; ${stuckLabel()}`;
  $("stallR").textContent = stallCache.length ? `${tr.nFail} FAILED · ${tr.stuck.length} STUCK${win ? " · " + win.R.label : ""} · N ↵` : "NONE";
  $("stallR").classList.toggle("al", !!stallCache.length);
  if (!rowsMeasured.has("stalls")) { const row = $("stalls").rows[1]; if (row && row.offsetHeight) { stallRowH = row.offsetHeight; rowsMeasured.add("stalls"); } }
}
$("stalls").addEventListener("click", ev => { const r = ev.target.closest("[data-ti]"); if (!r) return; const o = stallCache[+r.dataset.ti]; if (o) { setFocus("h"); activateTarget(workTarget(o)); flash(flyToTrouble(o)); } });
/* RUNNING (live): each ask and turn open at T, with the session that took it: how long it has run, its last call and how
 * long ago. Working (a call in the last 5 minutes, as psState reads it) on top, the quiet ones under them, longest quiet
 * last. A click flies to its lane at T and opens the ask in the inspector. Subagent calls stay inside their session's row. */
const WORKING_MS = 5 * 60e3;
let runCache = [], runRowH = 26;   // measured from the last paint
const callWhat = e => { if (e.k === "m") return String(e.name || "").replace(/^mcp__[^_]+__/, ""); const p = String(e.file || e.tgt || e.name || ""); return e.k === "e" || e.k === "r" ? p.split("/").pop() : sq(p); };
function runningAt(t) {
  const out = [];
  for (const a of asks) {
    if (a.ts > t || (a.done != null && a.done <= t) || a.src === "s") continue;
    const se = a.work && sessions[a.work.s], evs = (se && sessEvents.get(se.i)) || [], k = nUpTo(evs, t);
    // a call from before the ask arrived is earlier work: the ask has not started
    const last = k && evs[k - 1].t >= a.ts ? evs[k - 1] : null;
    const quiet = t - (last ? last.t : a.ts);
    out.push({ a, last, quiet, working: !!last && quiet <= WORKING_MS, stuck: stuckAt(a, t) });
  }
  return out.sort((x, y) => (!x.working) - (!y.working) || x.quiet - y.quiet || x.a.ts - y.a.ts);
}
function paintRunning() {
  if (!LIVE) return;
  const t = T; runCache = runningAt(t);
  const nW = runCache.filter(r => r.working).length;
  // whole rows only, in at most about half the section (the stalls keep the rest)
  const vis = Math.max(1, Math.floor((sizeOf($("runBox").parentElement).height * 0.48) / runRowH)), more = Math.max(0, runCache.length - vis);
  const runIndex = runCache.findIndex(r => r.a === selectionWork()), runStart = clamp(runIndex - Math.floor(vis / 2), 0, Math.max(0, runCache.length - vis));
  // two lines a row, as the code rows: who · the ask · how long it has run, then its last call · how long ago
  setHTML($("running"), runCache.slice(runStart, runStart + vis).map((r, k) => { const w = r.working, kind = r.last ? (KIND[r.last.k] || { label: r.last.k }).label : "NOT STARTED";
    return `<div class="cr${r.a === selectionWork() ? " sel" : ""}" data-ri="${runStart + k}" title="${esc(`${r.a.tg.full}: ${sq(r.a.task)}`)}"><div class="l1"><b class="${w ? "acc" : ""}">${esc(r.a.tg.short)}</b><span>${esc(sq(r.a.task))}</span><span class="n">${dur(t - r.a.ts)}</span></div>` +
      `<div class="l2"><span>${kind}</span><span>${r.last ? esc(callWhat(r.last)) : ""}</span><span class="n${r.stuck ? " al" : w ? " acc" : ""}">${dur(r.quiet)} ago</span></div></div>`; }).join("") ||
    `<div class="none">Nothing open at this point</div>`);
  $("runR").textContent = runCache.length ? `${nW} WORKING · ${runCache.length - nW} QUIET${more ? ` · +${more} MORE` : ""}` : "NONE";
  const row = $("running").firstElementChild; if (row && row.classList.contains("cr") && row.offsetHeight) runRowH = row.offsetHeight;
}
$("running").addEventListener("click", ev => { const r = ev.target.closest("[data-ri]"); if (!r) return; const x = runCache[+r.dataset.ri]; if (!x) return; activateTarget({ type: "ask", a: x.a }); });
if (LIVE) { $("days").style.display = "none"; $("runHd").hidden = false; $("runBox").hidden = false; }
// N / ⇧N: the next / previous item down the panel (oldest stuck first, then the newest failure) — on the keypress only
function stepTrouble(dir) {
  if (lastFind !== null) return stepFind(dir);
  const list = [...trouble.stuck, ...trouble.failed]; if (!list.length) return `NOTHING FAILED OR STUCK > ${stuckLabel()}${win ? " IN THIS WINDOW" : ""}`;
  const i = selectionWork() ? list.indexOf(selectionWork()) : -1, j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  return flyToTrouble(list[j], `${j + 1}/${list.length}`);
}
function flyToTrouble(o, pos = "") {
  select(workTarget(o)); const lt = troubleLane(o), isStuck = trouble.stuck.includes(o);
  if (lt) { follow = false; camGoal.tx = xOf(isStuck ? (o.ts + T) / 2 : failT(o)); camGoal.tz = lt.z; level = 2; camGoal.r = LEVELS[2].r; renderZoomRail(); renderViews(); }
  paintStalls();
  const line = isStuck ? `STUCK ${dur(T - o.ts).toUpperCase()} · ${troubleWho(o)} · ${troubleWhat(o).slice(0, 48)}` : `FAILED · ${KIND_TAG[o.kind]} · ${troubleWho(o)} · ${(sq(o.err) || troubleWhat(o)).slice(0, 56)}`;
  return (pos ? pos + " · " : "") + line;
}
function setErrors(on) { errorsOn = !!on;  renderViews(); paintSlow(); return errorsOn ? `ERRORS · ${trouble.stuck.length} STUCK > ${stuckLabel()} · ${trouble.nFail} FAILED · ${rungLabel()} · N NEXT` : "ERRORS · OFF"; }
function setStuck(ms, horizon) { stuckMs = ms; recapData = null; if (horizon) staleMs = horizon; else if (staleMs <= ms) staleMs = Math.max(STALE_DEFAULT, ms * 2); buildLog(); logLaneKey = "\u0000"; logSig = ""; paintSlow(); renderLivebar(); if (recapOn) { recapSel = -1; paintRecap(); } return `STUCK > ${stuckLabel()} · STALE AFTER ${stuckLabel(staleMs)} · ${trouble.stuck.length} STUCK · ${trouble.quiet.stale} STALE`; }
// the tally: top-right of the world in its own corner (foot), or inline beside the source control in the livebar — calm at zero
let tallyHTML = "", tallyHot = false;
function paintTally() {
  const tr = trouble, N = stuckLabel(), s = tr.stuck.length, f = tr.nFail, b = tr.buckets;
  const oldest = s ? tr.t - tr.stuck[0].ts : 0;
  // calm at zero: a count shows only while it is not zero; its breakdown and the quiet counts (housekeeping closes,
  // tool-call errors, items past the horizon: counted, never alarmed) sit in its tooltip
  const q = tr.quiet, quiet = ` · quiet: ${q.reconciled} reconciled by the runtime, ${q.tool} tool errors, ${q.stale} open longer than ${stuckLabel(staleMs).toLowerCase()}, ${q.undeliverable} undeliverable (their session ended)`;
  const stuckPart = s ? `<button class="tn hot" data-tally="stuck" title="STUCK: a runtime ask or an undelivered message open longer than ${N.toLowerCase()} · over ${N.toLowerCase()} ${b[0]}, over ${stuckLabel(2 * stuckMs).toLowerCase()} ${b[1]}, over ${stuckLabel(4 * stuckMs).toLowerCase()} ${b[2]} · oldest ${dur(oldest)}${quiet} · click: :errors · N jumps to the oldest"><span>STUCK &gt; ${N}</span><b>${s}</b></button>` : "";
  const failPart = f ? `<button class="tn hot" data-tally="failed" title="FAILED: runtime asks that failed and message deliveries that failed for a real reason, in the window · ${tr.kinds.ask} asks, ${tr.kinds.msg} messages${LIVE ? ` · ${tr.since} since you opened` : ""}${quiet} · click: :errors"><span>FAILED · ${win ? win.R.label : "≤ T"}</span><b>${f}</b></button>` : "";
  const parts = [stuckPart, failPart].filter(Boolean);
  const html = tallyMode === "foot" ? parts.map(p => `<div class="tw">${p}</div>`).join("") : parts.join(`<i class="tsep"></i>`);
  if (html !== tallyHTML || tallyHot !== !!(s || f)) { tallyHTML = html; tallyHot = !!(s || f); renderLivebar(); }
}
// broker log: every ask as it opens, finishes, fails or sits past the stuck threshold; undelivered messages fail or stick too
const STALL_AFTER = () => stuckMs;
let logEvents = [];
// declared here, not with the rest of point & speak below: buildLog() runs first, and Turbopack folds a guard
// on the later `var psRows = []` to true, so a hoisted undefined would reach the spread
var psRows = [];
function buildLog() {
  const ev = [];
  asks.forEach(a => { ev.push({ ts: a.ts, k: "open", a });
    if (a.done) ev.push({ ts: a.done, k: a.st === "f" ? "fail" : "done", a });
    if (stuckable(a) && (!a.done || a.done - a.ts > stuckMs) && a.ts + stuckMs <= T1) ev.push({ ts: a.ts + stuckMs, k: "stall", a }); });
  DLV.forEach(d => { if (d.st === "f" && d.done) ev.push({ ts: d.done, k: "fail", a: d });
    // a message reads as undeliverable from the moment its session ended; it stalls only if it was stuck before that
    const gone = d.ended != null && !d.done ? Math.max(d.ts, d.ended) : null;
    if (gone != null && gone <= T1) ev.push({ ts: gone, k: "gone", a: d });
    if ((gone == null || gone > d.ts + stuckMs) && (!d.done || d.done - d.ts > stuckMs) && d.ts + stuckMs <= T1) ev.push({ ts: d.ts + stuckMs, k: "stall", a: d }); });
  ev.push(...psRows);   // the op center's DRY RUN lines stay in the log
  logEvents = ev.sort((x, y) => x.ts - y.ts);
}
buildLog();
// panel J holds two tabs: Files (first) and the broker log; the pick is kept per viewer
let jTab = "files";
try { if (localStorage.getItem("world-modale.jtab") === "log") jTab = "log"; } catch {}
const LOG_ROW_H = 13, LOG_AHEAD = 4;
let LOG_ROWS = 24; // the panel takes the column's leftover height; rows follow it
let logCount = -1, logStreams = [], logSel = -1, logSig = "", logList = logEvents, logLaneKey = "";
const logUpTo = (list, t) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].ts <= t) lo = m + 1; else hi = m; } return lo; };
const logText = e => e.k === "dry" ? e.a.task : (e.a.kind === "msg" ? "message · " : "") + (e.k === "open" ? sq(e.a.task) : e.k === "done" ? `done · ${dur(e.a.done - e.a.ts)} · ${sq(e.a.task)}` : e.k === "fail" ? sq(e.a.err || e.a.task || "failed · no reason recorded") : e.k === "gone" ? `undeliverable · its session ended · ${sq(e.a.task)}` : `stuck > ${stuckLabel().toLowerCase()} · ${sq(e.a.task)}`);
const logWho = e => e.k === "dry" ? `YOU → ${e.a.name} · ${e.a.verb.toUpperCase()}` : troubleWho(e.a.kind ? e.a : Object.assign(e.a, { kind: "ask" }));
function paintLog() {
  if (jTab !== "log") return;   // the panel shows Files; switching back repaints from scratch (logSig = "")
  const solo = lanes.find(l => l.solo), lk = solo ? String(solo.idx) : "";
  if (lk !== logLaneKey) { logLaneKey = lk; logList = solo ? logEvents.filter(e => (e.k === "dry" ? e.a.lane : laneFor(e.a.tg)) === solo) : logEvents; logCount = -1; logSel = -1; }
  const list = logList, n = logUpTo(list, T), cur = n - 1, focused = focus === "j";
  if (!focused || playing || logSel < 0) logSel = cur;
  logSel = clamp(logSel, 0, Math.max(0, list.length - 1));
  const anchor = focused ? logSel : cur, start = clamp(anchor - (LOG_ROWS - 1 - LOG_AHEAD), 0, Math.max(0, list.length - LOG_ROWS));
  // header counts: this slice when paused into one, the week so far otherwise
  const w0 = slicing ? sliceStart() : T0, w1 = slicing ? sliceStart() + BIN : T;
  const sig = `${LOG_ROWS}|${n}|${start}|${focused ? logSel : -1}|${lk}|${w0}|${slicing}`; if (sig === logSig) return; logSig = sig;
  let na = 0, nd = 0, nf = 0; for (let i = logUpTo(list, w0 - 1); i < list.length && list[i].ts <= w1; i++) { const k = list[i].k; if (k === "open") na++; else if (k === "done") nd++; else if (k === "fail") nf++; }
  $("logR").textContent = `${slicing ? "SLICE" : "≤ T"} · ${na} ASKS · ${nd} DONE · ${nf} FAILED`;
  $("logLane").innerHTML = solo ? `<button class="chip on" data-loglane="1" title="Following the soloed lane · click for all lanes">LANE · ${esc(solo.name.toUpperCase())} ×</button>` : "";
  const fresh = logCount >= 0 && n > logCount && n - logCount <= 3 ? n - logCount : 0; logCount = n;
  if (!n) { $("log").innerHTML = `<div class="lr quiet"><span class="t">—</span><i></i><span class="tx">quiet · no broker traffic before ${list.length ? DOW[new Date(list[0].ts).getDay()] + " " + hhmm(list[0].ts) : "the end of the week"}</span></div>`; logStreams = []; return; }
  $("log").innerHTML = list.slice(start, start + LOG_ROWS).map((e, k) => { const i = start + k, live = e.k === "open" && stateAt(e.a, T) === "flight";
    return `<div class="lr k-${e.k}${live ? " live" : ""}${i > cur ? " fut" : ""}${i === cur ? " cur" : ""}${focused && i === logSel ? " sel" : ""}${i > cur - fresh && i <= cur ? " fl" : ""}" data-li="${i}"><span class="t">${DOW[new Date(e.ts).getDay()]} ${hhmm(e.ts)}</span><i class="mk"></i><span class="ft">${esc(logWho(e))}</span><span class="tx">${esc(logText(e))}</span></div>`; }).join("");
  logStreams = reduced || !fresh ? [] : [...$("log").querySelectorAll(".lr.fl .tx")].map(el => { const full = el.textContent; el.textContent = ""; return { el, full, t0: performance.now() }; });
}
function logOpen(i) {
  const e = logList[i]; if (!e) return; logSel = i; if (playing) setPlaying(false);
  setT(e.ts); if (e.k === "dry") { flash(`LOG · ${logWho(e)} · ${e.a.dry ? "DRY RUN" : "SENT"}`); return; } if (e.a.kind === "msg") { flash(flyToTrouble(e.a)); return; } openInspector({ type: "ask", a: e.a }); flash(`LOG · ${logWho(e)} · ${dayTag(e.ts)} ${hhmm(e.ts)}`);
}
const logRO = new ResizeObserver(() => { const rows = Math.max(6, Math.floor($("log").clientHeight / LOG_ROW_H)); if (rows !== LOG_ROWS) { LOG_ROWS = rows; logSig = ""; paintLog(); } });
logRO.observe($("log")); disposers.push(() => logRO.disconnect());
$("log").addEventListener("click", ev => { const r = ev.target.closest("[data-li]"); if (!r) return; setFocus("j"); logOpen(+r.dataset.li); });
$("logLane").addEventListener("click", ev => { if (ev.target.closest("[data-logfocus]")) { flash(setFocusAgent(null)); return; } if (ev.target.closest("[data-loglane]")) { lanes.forEach(l => { l.solo = false; }); applyMask(); paintLanes(); paintLog(); paintFiles(); flash("LANES · ALL"); } });
// hover: the whole line in the tag style, under the row
$("log").addEventListener("mousemove", ev => { const r = ev.target.closest("[data-li]"), tip = $("logTip"); if (!r) { tip.hidden = true; return; }
  const e = logList[+r.dataset.li]; if (!e) return; const key = r.dataset.li; if (tip.dataset.k === key && !tip.hidden) return; tip.dataset.k = key;
  tip.innerHTML = `<b>${esc(logWho(e))} · ${e.k === "open" ? "ASKED" : e.k === "done" ? "DONE" : e.k === "fail" ? "FAILED" : e.k === "dry" ? (e.a.dry ? "DRY RUN" : "SENT") : "QUIET"} · ${DOW[new Date(e.ts).getDay()]} ${hhmm(e.ts)}</b>${esc(logText(e))}`;
  tip.hidden = false; const box = r.closest(".panel"); tip.style.top = listTooltipTop(r.getBoundingClientRect(), box.getBoundingClientRect(), tip.offsetHeight) + "px"; });
$("log").addEventListener("mouseleave", () => { $("logTip").hidden = true; });

/* files: the panel's other tab (and its first). Every file a call read or edited, newest first at the playhead: one row per file at
 * its latest touch ≤ T, so playing the week shows what was being worked on as it happened. Follows the soloed lane and hidden lanes. */
let filesSig = "", fileRows = [], fileSel = -1, fileTop = "", fileTallyKey = "", fileTallyN = null;
const upToT = () => { let lo = 0, hi = EVT_T.length; while (lo < hi) { const m = (lo + hi) >> 1; if (EVT_T[m] <= T) lo = m + 1; else hi = m; } return lo; };
// distinct files and edited files up to each event, for the head's counts: rebuilt only when the events or the solo lane change
function fileTally(solo) {
  const key = `${EVT.length}|${solo ? solo.idx : ""}|${focusSig}|${lanes.map(l => l.off ? 1 : 0).join("")}`;
  if (key === fileTallyKey) return fileTallyN;
  const seen = new Set(), edited = new Set(), n = new Int32Array(EVT.length + 1), ne = new Int32Array(EVT.length + 1);
  for (let i = 0; i < EVT.length; i++) { const e = EVT[i]; n[i + 1] = n[i]; ne[i + 1] = ne[i];
    if (!e.file || e.lane.off || (solo && e.lane !== solo) || !mineSess(e.sess)) continue;
    if (!seen.has(e.file)) { seen.add(e.file); n[i + 1]++; }
    if (e.k === "e" && !edited.has(e.file)) { edited.add(e.file); ne[i + 1]++; } }
  fileTallyKey = key; return (fileTallyN = { n, ne });
}
const fileDir = e => { const abs = e.file, name = abs.split("/").pop(), root = e.root && abs.startsWith(e.root + "/") ? e.root : "";
  const dir = root ? abs.slice(root.length + 1, -name.length - 1) : abs.replace(/^\/Users\/[^/]+\//, "~/").slice(0, -name.length - 1);
  return { name, dir: root ? `${laneName(normRoot(root))}${dir ? " · " + dir : ""}` : dir }; };
function paintFiles() {
  if (jTab !== "files") return;
  const solo = lanes.find(l => l.solo), upto = upToT(), focused = focus === "j";
  const sig = `${upto}|${EVT.length}|${solo ? solo.idx : ""}|${lanes.map(l => l.off ? 1 : 0).join("")}|${focused ? fileSel : -1}|${focusSig}`;
  if (sig === filesSig) return; filesSig = sig;
  const rows = recentFiles(EVT, upto, e => !e.lane.off && (!solo || e.lane === solo) && mineSess(e.sess));
  const fresh = rows.length && fileTop && rows[0].file !== fileTop && playing; fileTop = rows.length ? rows[0].file : "";
  fileRows = rows; fileSel = clamp(fileSel, -1, rows.length - 1);
  const tally = fileTally(solo);
  $("logR").textContent = `≤ T · ${tally.n[upto]} FILES · ${tally.ne[upto]} EDITED`;
  $("logLane").innerHTML = (solo ? `<button class="chip on" data-loglane="1" title="Following the soloed lane · click for all lanes">LANE · ${esc(solo.name.toUpperCase())} ×</button>` : "")
    + (focusAgent ? `<button class="chip on" data-logfocus="1" title="The files ${esc(spoken(focusAgent))}'s sessions touched · click to let go of the focus">AGENT · ${esc(focusAgent.short.toUpperCase())} ×</button>` : "");
  if (!rows.length) {
    // a focused agent whose asks never linked to a session has no files to show; say that, not "nothing yet"
    const why = focusAgent && !focusSess.size ? `no session is linked to ${esc(focusAgent.short)}'s asks, so no files` : "no files read or edited before the playhead";
    $("files").innerHTML = `<div class="lr quiet"><span class="t">—</span><i></i><span class="ft"></span><span class="tx">${why}</span></div>`; return;
  }
  $("files").innerHTML = rows.map((e, i) => { const { name, dir } = fileDir(e), fl = fileEvents.get(e.tgt) || [];
    let n = 0; for (const x of fl) if (x.t <= T) n++;
    const ago = T - e.t, when = ago < 6e4 ? "NOW" : "−" + dur(ago).toUpperCase();
    return `<div class="lr k-${e.k === "e" ? "edit" : "read"}${i === 0 && fresh ? " fl" : ""}${focused && i === fileSel ? " sel" : ""}" data-fi="${i}"><span class="t">${when}</span><i class="mk"></i><span class="ft">${esc(name)}</span><span class="tx">${esc(dir)}${n > 1 ? ` · ×${n}` : ""}</span></div>`; }).join("");
}
function fileOpen(i) { const e = fileRows[i]; if (!e) return; fileSel = i; const f = dotFile(e); if (f) { showFile(f, null); flash(`FILE · ${f.disp.split("/").pop()} · ${KIND[e.k].label} ${dayTag(e.t)} ${hhmm(e.t)}`); } }
function setJTab(tab) {
  if (tab === jTab) return; jTab = tab; try { localStorage.setItem("world-modale.jtab", tab); } catch {}
  $$("#jTabs .tab").forEach(b => b.classList.toggle("on", b.dataset.jtab === tab));
  $("files").hidden = tab !== "files"; $("log").hidden = tab !== "log"; $("logTip").hidden = true;
  filesSig = ""; logSig = ""; logCount = -1; paintFiles(); paintLog();
}
$("jTabs").addEventListener("click", ev => { const b = ev.target.closest("[data-jtab]"); if (b) setJTab(b.dataset.jtab); });
$("files").hidden = jTab !== "files"; $("log").hidden = jTab !== "log"; $$("#jTabs .tab").forEach(b => b.classList.toggle("on", b.dataset.jtab === jTab));
$("files").addEventListener("click", ev => { const r = ev.target.closest("[data-fi]"); if (!r) return; setFocus("j"); fileOpen(+r.dataset.fi); });
$("files").addEventListener("contextmenu", ev => { const r = ev.target.closest("[data-fi]"), e = r && fileRows[+r.dataset.fi], f = e && dotFile(e); if (!f) return; ev.preventDefault(); openMenu(ev.clientX, ev.clientY, fileHead(f), fileItems(f, null)); });
// hover: the whole path and its latest touch, under the row
$("files").addEventListener("mousemove", ev => { const r = ev.target.closest("[data-fi]"), tip = $("logTip"); if (!r) { tip.hidden = true; return; }
  const e = fileRows[+r.dataset.fi]; if (!e) return; const key = "f" + r.dataset.fi + e.file; if (tip.dataset.k === key && !tip.hidden) return; tip.dataset.k = key;
  tip.innerHTML = `<b>${KIND[e.k].label} · ${DOW[new Date(e.t).getDay()]} ${hhmm(e.t)} · ${esc(e.lane.name.toUpperCase())}</b>${esc(e.file.replace(/^\/Users\/[^/]+\//, "~/"))}`;
  tip.hidden = false; const box = r.closest(".panel"); tip.style.top = listTooltipTop(r.getBoundingClientRect(), box.getBoundingClientRect(), tip.offsetHeight) + "px"; });
$("files").addEventListener("mouseleave", () => { $("logTip").hidden = true; });

function tickLogStreams(now) {
  if (!logStreams.length) return;
  logStreams = logStreams.filter(s => { const n = Math.floor((now - s.t0) * 110 / 1000); if (n >= s.full.length) { s.el.textContent = s.full; return false; }
    s.el.innerHTML = esc(s.full.slice(0, n)) + '<i class="caret"></i>'; return true; });
}
function paintReplay() {
  // playback counts down to the end of the recording; real time counts back from the wall clock
  const dt = Math.max(0, (LIVE ? Date.now() : T1) - T), hh = Math.floor(dt / 36e5), mm = Math.floor(dt / 6e4) % 60;
  $("tclock").textContent = dt < 6e4 ? "T 00:00" : hh >= 24 ? `T−${Math.floor(hh / 24)}D ${pad(hh % 24)}H` : `T−${pad(hh)}:${pad(mm)}`;
  $("tdate").textContent = `${dayTag(T)} ${hhmm(T)}`;
  $("rangeLbl").textContent = LIVE ? (playing ? `LAST ${LIVE.hours} H` : `${dur(Date.now() - T).toUpperCase()} BACK`) : `${SPAN_SHORT} · ${playing ? "PLAYING " + speedLabel(speed) : "PAUSED"}`;
  if (LIVE) $("live").classList.toggle("on", playing);
  $("pos").textContent = `${dayTag(T)} ${hhmm(T)} · ${Math.round((T - T0) / SPAN * 100)}%`;
}
const pt = (k, f) => { if (!PERF) return f(); const s0 = performance.now(); f(); PERF.sec["·" + k] = (PERF.sec["·" + k] || 0) + performance.now() - s0; };
const LIVE_VIEWS = ["slice", "worktree", "pr", "diff", "agent", "lane", "delivery"];   // views that read "≤ T" follow the playhead while it plays
function paintSlow() { if (PERF) PERF.ps++; // canvases first, DOM writers after (see later())
  if (focusAgent) pt("paintFoc", paintFoc);
  pt("scanTrouble", scanTrouble);
  if (!insp.hidden && inspStack.length && LIVE_VIEWS.includes(inspStack[inspStack.length - 1].type)) renderInspector(true);
  pt("drawProfile", drawProfile); pt("drawRhythm", drawRhythm); pt("drawTTD", drawTTD); pt("drawScrub", drawScrub); pt("paintLanes", paintLanes); pt("paintQuota", paintQuota); pt("paintOutcomes", paintOutcomes);
  pt("paintReplay", paintReplay); pt("paintStalls", paintStalls); pt("paintRunning", paintRunning); pt("paintTally", paintTally); pt("paintRoster", paintRoster); pt("paintLog", paintLog); pt("paintFiles", paintFiles); pt("paintCode", paintCode); pt("renderTransport", renderTransport); }

/* ================= time control ================= */
function setT(t) { T = clamp(t, T0, T1); paintSlow(); }
// the editor's transport: J K L shuttle the replay back · hold · forward, I and O mark a span the replay loops
let dirn = 1;
const inout = { i: null, o: null };
const loopSpan = () => inout.i != null && inout.o != null && inout.i !== inout.o ? [Math.min(inout.i, inout.o), Math.max(inout.i, inout.o)] : null;
function shuttle(arg) {
  if (LIVE) return "SHUTTLE · PLAYBACK ONLY";
  if (arg === "hold") { if (!playing) return "SHUTTLE · HOLDING"; setPlaying(false); return "SHUTTLE · HOLD · " + dayTag(T) + " " + hhmm(T); }
  const d = arg === "back" ? -1 : 1;
  if (playing && dirn === d) setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)] || speed);
  else { if (!SPEEDS.includes(speed) || speed > 1) setSpeed(1); setPlaying(true); dirn = d; }
  return `SHUTTLE · ${d < 0 ? "BACK" : "FORWARD"} ${speedLabel(speed)} · AGAIN FOR FASTER · K HOLDS`;
}
function markInOut(arg) {
  if (LIVE) return "MARKS · PLAYBACK ONLY";
  if (arg === "clear") { if (!loopSpan() && inout.i == null && inout.o == null) return "MARKS · NONE SET"; inout.i = inout.o = null; drawScrub(); return "MARKS · CLEARED · THE REPLAY RUNS THE WEEK"; }
  inout[arg === "out" ? "o" : "i"] = T; drawScrub();
  const sp = loopSpan(), at = `${arg === "out" ? "OUT" : "IN"} · ${dayTag(T)} ${hhmm(T)}`;
  return sp ? `${at} · LOOPS ${dur(sp[1] - sp[0])} · ⌫ CLEARS` : `${at} · ${arg === "out" ? "I" : "O"} SETS THE OTHER END`;
}
function stepAsk(dir) { const list = asks.map(a => a.ts); let t; if (dir > 0) t = list.find(x => x > T + 1); else t = [...list].reverse().find(x => x < T - 1); if (t != null) { setT(t); const a = asks.find(x => x.ts === t); flash(`${a.rq ? a.rq.short.toUpperCase() : ""} → ${a.tg.short.toUpperCase()}`); } }
function setPlaying(p, updateSlice = true) { const was = playing; playing = p; if (!p) dirn = 1; if (updateSlice && (was !== p || (!p && !slicing))) setSlicing(!p); $("play").firstChild.textContent = p ? "PAUSE" : "PLAY"; $("play").classList.toggle("on", p); paintReplay(); renderTransport(); }
// transport: playback has the big play / pause / stop (back to the start), speed and END. Real time has none of
// those: it shows where the playhead stands, and once the timeline is dragged back, the way back to now
const ICON = { play: `<svg viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>`, pause: `<svg viewBox="0 0 12 12"><path d="M2.6 1.8h2.4v8.4H2.6zM7 1.8h2.4v8.4H7z" fill="currentColor"/></svg>`, stop: `<svg viewBox="0 0 12 12"><path d="M2.4 2.4h7.2v7.2H2.4z" fill="currentColor"/></svg>` };
function renderTransport() {
  const el = $("transport"); if (!el) return;
  if (LIVE) return renderRealTime(el);
  if (!el.firstChild) el.innerHTML = `<button class="tp main" data-tp="toggle"><i></i><span></span></button>`
    + `<button class="tp" data-tp="stop" title="Stop: back to the start">${ICON.stop}</button>`
    + `<span class="tpt"><b></b><small></small></span>`
    + `<button class="tp sp" data-tp="speed" title="Speed (, .)"></button>`
    + `<button class="tp sp" data-tp="now" title="Jump to the end (End)">END</button>`;
  el.classList.toggle("on", playing);
  const main = el.querySelector(".main"), mode = playing ? "pause" : "play";
  if (main.dataset.mode !== mode) { main.dataset.mode = mode; main.firstChild.outerHTML = `<i>${ICON[mode]}</i>`; main.lastChild.textContent = mode.toUpperCase(); main.title = (playing ? "Pause" : "Play") + " (Space)"; }
  el.querySelector(".tpt b").textContent = `${dayTag(T)} ${hhmm(T)}`;
  el.querySelector(".tpt small").textContent = playing ? "PLAYING" : T >= T1 - 6e4 ? "AT THE END" : "PAUSED";
  el.querySelector('[data-tp="speed"]').textContent = speedLabel(speed);
}
// real time: following, the playhead is the wall clock; dragged back, it holds there until BACK TO NOW (or End)
function renderRealTime(el) {
  if (!el.firstChild) { el.classList.add("rt"); el.innerHTML = `<span class="tpt"><b></b><small></small></span>`
    + `<button class="tp sp" data-tp="now" title="Back to now (End)">BACK TO NOW</button>`; }
  el.classList.toggle("on", playing);
  el.querySelector(".tpt b").textContent = `${dayTag(T)} ${hhmm(T)}`;
  el.querySelector(".tpt small").textContent = playing ? "REAL TIME" : `${dur(Date.now() - T).toUpperCase()} BACK`;
  el.querySelector('[data-tp="now"]').hidden = playing;
}
$("transport").addEventListener("click", e => {
  const b = e.target.closest("[data-tp]"); if (!b) return; const a = b.dataset.tp;
  if (a === "toggle") setPlaying(!playing);
  else if (a === "stop") { setPlaying(false); setT(T0); flash("STOPPED · AT THE START"); }
  else if (a === "speed") setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  else if (a === "now") { if (LIVE) flash(goLive()); else { setPlaying(false); setT(T1); } }
  renderTransport();
});
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
// the ladder's own steps read ×n; anything else (:speed 1h/s) reads as the rate it is
const speedLabel = s => SPEEDS.includes(s) ? "×" + (s < 1 ? (s === 0.5 ? "½" : "¼") : s) : rateLabel(SPAN * s / LOOP_MS);
function setSpeed(s) { speed = s; $("speed").firstChild.textContent = speedLabel(s); paintReplay(); renderTransport(); flash("SPEED " + speedLabel(s)); }
$("play").onclick = () => setPlaying(!playing);
$("live").onclick = () => { if (LIVE) flash(goLive()); else { setPlaying(false); setT(T1); } };
// real time has no replay to play, pause or speed up: the panel keeps NOW (back to the wall clock) and KEYS.
// Playback's chip jumps to the end of the recording
if (LIVE) { $("play").style.display = $("speed").style.display = "none"; const hd = $("rangeLbl")?.previousSibling; if (hd?.nodeType === 3) hd.textContent = "FLEET"; }
else { $("live").firstChild.textContent = "END"; $("live").querySelector("kbd")?.remove(); $("live").title = "Jump to the end of the recording (End)"; }
{ const hd = $("worldR")?.previousSibling; if (hd?.nodeType === 3) hd.textContent = "VIEW"; }
// real time: NOW is the wall clock — follow it again, and the playhead with it
function goLive() { setPlaying(true); T = Math.min(T1, Date.now()); follow = true; followDX = 0; renderViews(); renderTransport(); paintSlow(); return "BACK TO NOW"; }
function realTimeHold() { if (playing) setPlaying(false); return `HELD AT ${hhmm(T)} · END GOES BACK TO NOW`; }
$("speed").onclick = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
$("helpBtn").onclick = () => toggleHelp();

/* ================= keyboard + commands ================= */
// commands.ts is the one registry: keys, the ":" palette, tours, voice and the "?" sheet all run an entry's handler below
const PANELS_BASE = ["w", "a", "q", "h", "d", "b", "c", "l", "e", "f", "j", "v", "g"];
const panelsNow = () => insp.hidden ? PANELS_BASE : [...PANELS_BASE, "x"];
const PANEL_NAME = { s: "STASH", w: "VIEW", a: "REPLAY", b: "ROSTER", c: "LANES", q: "QUOTA", l: "TIMELINE", d: "TIME TO DONE", e: "ACTIVITY", f: "RHYTHM", g: "MESH", h: "OUTCOMES", j: "LOG", v: "CODE", x: "INSPECT", null: "GLOBAL" };
let focus = null;
// point & speak state (var: read by applyMask / buildLog before the section below has run)
var psOn = PQ.get("opcenter") !== "0", psLive = PQ.get("live") === "1", psPoint = null, psPointKey = null, psPointAt = 0, psLostAt = 0, psSel = null, psStage = null,
  psVerb = "ask", psText = "", psEditing = false, psResult = null, psReply = null, psAwait = null, psArcs = [], frozen = null, psJev = PQ.get("jev") === "1", psPinned = false;
// folding: a side panel can shrink to its header bar; the panels that flex take the room. Remembered per browser.
const FOLD_KEY = "world-modale.folded", FOLDABLE = ["a", "q", "h", "d", "b", "c", "v", "j", "g"];
const FOLD_ALIAS = { k: "c", p: "q", r: "v" };
let folded = new Set();
try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) || "[]"); if (Array.isArray(v)) folded = new Set(v.filter(x => FOLDABLE.includes(x))); } catch {}
function applyFold() {
  FOLDABLE.forEach(p => {
    const el = $$(`.panel[data-panel="${p}"]`)[0]; if (!el) return;
    const f = folded.has(p); el.classList.toggle("folded", f);
    const b = el.querySelector(".hd .fold"); if (b) { b.textContent = f ? "+" : "\u2212"; b.title = (f ? "Expand" : "Collapse") + (p === "g" ? "" : " (\u2212 while focused)"); }
  });
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch {}
  relayout();
}
function foldPanel(arg) {
  const a = (arg || "").trim().toLowerCase();
  if (a === "all") { FOLDABLE.forEach(p => folded.add(p)); applyFold(); return "FOLD · ALL SIDE PANELS"; }
  if (a === "none") { folded.clear(); applyFold(); return "FOLD · NONE"; }
  const p = a ? (FOLD_ALIAS[a] || a) : focus;
  if (!FOLDABLE.includes(p)) return a ? "FOLD · NO SIDE PANEL " + a.toUpperCase() : "FOLD · FOCUS A SIDE PANEL FIRST";
  if (folded.has(p)) folded.delete(p); else folded.add(p);
  applyFold(); return (folded.has(p) ? "FOLDED · " : "OPENED · ") + (PANEL_NAME[p] || p.toUpperCase());
}
FOLDABLE.forEach(p => {
  const hd = $$(`.panel[data-panel="${p}"] > .hd`)[0]; if (!hd) return;
  const b = document.createElement("button"); b.className = "chip fold"; b.type = "button";
  b.addEventListener("click", e => { e.stopPropagation(); flash(foldPanel(p)); });
  hd.appendChild(b);
});
function setFocus(p) {
  focus = p; if (TS.includes(p) && p !== tsCur) setTs(p); $$(".panel").forEach(el => el.classList.toggle("focus", el.dataset.panel === p));
  $("mode").textContent = PANEL_NAME[p] || "GLOBAL";
  paintKeys();
  if (p === "f" && !rhythmSel) { const d = clamp(dayOf(T), 0, dayStarts.length - 1); rhythmSel = { d, h: new Date(T).getHours() }; }
  paintSlow();
}
// where a key is looked up, innermost first: an open file preview, the focused panel, zeroed-in work, then everywhere
function activeScopes() {
  const out = [];
  if (psStage && psStage !== "speak") out.push("ps");
  if (ringOn()) out.push("ring");
  if (frozen) out.push("frozen");
  if ((focus === "x" || focus === "s") && !pv.hidden && !pvPinned) out.push("preview");
  if (focus) out.push(focus);
  if (focusWork) out.push("work");
  out.push("global");
  return out;
}
// the footer strip: ~8 essentials in GLOBAL, what the focused panel binds otherwise; the rest is one key away
function paintKeys() {
  $("keys").innerHTML = stripFor(activeScopes()).map(([k, l]) => `<span><kbd>${esc(k)}</kbd>${esc(l)}</span>`).join("") +
    `<span class="more"><button data-kh="help"><kbd>?</kbd>all keys</button><button data-kh="cmd"><kbd>:</kbd>commands</button></span>`;
}
// the strip's way in for a pointer: the sheet and the palette are one click away too
$("keys").addEventListener("click", e => { const b = e.target.closest("[data-kh]"); if (!b) return; if (b.dataset.kh === "help") toggleHelp(true); else openCmd(); });
$$(".panel").forEach(el => el.addEventListener("pointerdown", () => { if (el.dataset.panel !== focus) setFocus(el.dataset.panel); }));
let flashTimer = 0;
let flashFull = "", flashT0 = 0;
function flash(s) { if (tourQuiet || !s) return; flashFull = s; flashT0 = performance.now(); STREAM.delete("flash"); tickFlash(); clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashFull = ""; $("msg").textContent = ""; }, 1800 + s.length * 6); }
function tickFlash() { if (!flashFull) return; const t = streamed("flash", flashFull, 220); if ($("msg").textContent !== t) $("msg").textContent = t; }

/* the "?" sheet: generated from the registry, grouped, searchable */
const phraseText = p => Array.isArray(p) ? p[0] : p;
function renderHelp() {
  const q = $("helpQ").value, groups = sheetRows(q);
  const n = groups.reduce((a, g) => a + g.rows.length, 0);
  $("helpN").textContent = q ? `${n} OF ${COMMANDS.length}` : `${COMMANDS.length} COMMANDS`;
  // a key bound in panels says where: up to three names, then how many more
  const where = sc => sc.includes("global") ? "" : sc.length > 3 ? sc.slice(0, 2).map(x => SCOPE_NAME[x]).join(" · ") + ` +${sc.length - 2}` : sc.map(x => SCOPE_NAME[x]).join(" · ");
  const kb = r => r.keys.map(k => `<span class="kb${where(k.scopes) ? " sc" : ""}"><kbd>${esc(k.label)}</kbd>${where(k.scopes) ? `<small>${esc(where(k.scopes))}</small>` : ""}</span>`).join("");
  const gest = !q || GESTURES.some(([a, b]) => (a + " " + b).toLowerCase().includes(q.toLowerCase()))
    ? `<div class="hg"><h3>POINTER</h3><dl>${GESTURES.filter(([a, b]) => !q || (a + " " + b).toLowerCase().includes(q.toLowerCase())).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl></div>` : "";
  $("helpBody").innerHTML = groups.map(g => `<div class="hg"><h3>${esc(g.group.toUpperCase())}</h3><dl>${g.rows.map(r =>
    `<dt>${kb(r)}</dt><dd><code>${esc(r.syntax)}</code><span>${esc(r.desc)}</span>${r.voice.length ? `<i>say “${esc(phraseText(r.voice[0]))}”</i>` : ""}</dd>`).join("")}</dl></div>`).join("") + gest
    || `<div class="hg"><h3>NOTHING MATCHES</h3><dl><dt></dt><dd>Try a key (n, [), a verb (window) or a word (stuck)</dd></dl></div>`;
}
function toggleHelp(force, q) {
  const el = $("help"), show = force != null ? !!force : el.hidden;
  el.hidden = !show;
  if (show) { $("helpQ").value = q || ""; renderHelp(); setTimeout(() => $("helpQ").focus(), 0); } else $("helpQ").blur();
}
$("help").addEventListener("click", e => { if (e.target === $("help")) toggleHelp(false); });
$("helpQ").addEventListener("input", renderHelp);
$("helpQ").addEventListener("keydown", e => {
  if (e.key === "Escape") { if ($("helpQ").value) { $("helpQ").value = ""; renderHelp(); } else toggleHelp(false); e.preventDefault(); e.stopPropagation(); }
  else if (e.key === "?" && !$("helpQ").value) { toggleHelp(false); e.preventDefault(); e.stopPropagation(); }
});

function flyToAgent(agent, ask) {
  const lt = laneFor(agent); if (!lt) return;
  if (ask) setT(ask.ts + 6e4);
  follow = false; camGoal.tx = xOf(ask ? ask.ts : T); camGoal.tz = lt.z; level = 2; camGoal.r = LEVELS[2].r; renderZoomRail();
  renderViews(); flash("FLY · " + agent.short.toUpperCase());
}

// one place the panel-local moves live: down · up · right (into) · left (back) · enter · remove, per focused panel.
// false = this panel has no such move (the key falls through to the next scope)
function nav(dir, ctx) {
  if (ctx && ctx.scope === "preview") {
    if (dir === "left") { hidePreview(); return ""; }
    if ((dir === "down" || dir === "up") && focus === "x") { stepPreview(dir === "down" ? 1 : -1); return ""; }
    return false;
  }
  const f = focus;
  if (f === "x") {
    if (dir === "down") { inspSel = Math.min(inspItems.length - 1, inspSel + 1); renderInspector(); }
    else if (dir === "up") { inspSel = Math.max(0, inspSel - 1); renderInspector(); }
    else if (dir === "right" || dir === "enter") drill();
    else if (dir === "left") inspBack();
    else return false;
    return "";
  }
  if (f === "s") {
    if (dir === "down" || dir === "right") { stashSel = Math.min(stash.length - 1, stashSel + 1); renderStash(); if (pvPinned) openStashed(stashSel); }
    else if (dir === "up" || dir === "left") { stashSel = Math.max(0, stashSel - 1); renderStash(); if (pvPinned) openStashed(stashSel); }
    else if (dir === "enter") openStashed(stashSel);
    else if (dir === "remove") { if (stash[stashSel]) { if (pvFor === stash[stashSel].f.abs) hidePreview(); unstash(stashSel); } }
    else return false;
    return "";
  }
  if (f === "w") {
    if (dir !== "enter") return false;
    if (hover) pick(hover); else if (pins[pinSel]) flyToAgent(pins[pinSel].agent, pins[pinSel].ask);
    return "";
  }
  if (f === "v") {
    if (dir === "down" || dir === "up") { codePin = null; codeSel = dir === "down" ? Math.min(codeItems.length - 1, codeSel + 1) : Math.max(0, codeSel - 1); paintCode(); codeSelIntoView(); return ""; }
    if (dir === "right" || dir === "enter") { openCode(); return ""; }
    return false;
  }
  if (f === "b" || f === "h") {
    const isB = f === "b";
    if (dir === "down") { if (isB) rosterSel++; else stallSel++; }
    else if (dir === "up") { if (isB) rosterSel--; else stallSel--; }
    else if (dir === "right" && isB) { const r = rosterCache[rosterSel]; if (r && r.a) flash(toggleFocusAgent(r.a)); }
    else if (dir === "enter") {
      if (isB) { const r = rosterCache[rosterSel]; if (r) flyToAgent(r.a, r.last); }
      else { const o = stallCache[stallSel]; if (o) flash(flyToTrouble(o)); }
    }
    else return false;
    if (isB) { const r = rosterCache[rosterSel]; if (r?.a) select({ type: "agent", agent: r.a }); paintRoster(); } else { select(workTarget(stallCache[clamp(stallSel, 0, Math.max(0, stallCache.length - 1))])); paintStalls(); }
    return "";
  }
  if (f === "c") {
    if (dir === "down") laneSel = Math.min(lanes.length - 1, laneSel + 1);
    else if (dir === "up") laneSel = Math.max(0, laneSel - 1);
    else if (dir === "enter") soloLane(laneSel);
    else if (dir === "remove") { lanes[laneSel].off = !lanes[laneSel].off; applyMask(); flash((lanes[laneSel].off ? "HIDE · " : "SHOW · ") + lanes[laneSel].name.toUpperCase()); }
    else return false;
    select({ type: "lane", lane: lanes[laneSel] }); paintLanes();
    return "";
  }
  if (f === "j" && jTab === "files") {
    if (dir === "down") fileSel = Math.min(fileRows.length - 1, fileSel + 1);
    else if (dir === "up") fileSel = Math.max(0, fileSel - 1);
    else if (dir === "right" || dir === "enter") { fileOpen(Math.max(0, fileSel)); return ""; }
    else if (dir === "left") { setJTab("log"); return ""; }
    else return false;
    paintFiles(); $("files").querySelector(`[data-fi="${fileSel}"]`)?.scrollIntoView({ block: "nearest" }); return "";
  }
  if (f === "j") {
    if (dir === "down") { if (playing) setPlaying(false); logSel = Math.min(logList.length - 1, logSel + 1); }
    else if (dir === "up") { if (playing) setPlaying(false); logSel = Math.max(0, logSel - 1); }
    else if (dir === "right" || dir === "enter") { logOpen(logSel); return ""; }
    else return false;
    paintLog(); return "";
  }
  if (f === "f") {
    const s = rhythmSel || { d: 0, h: 12 };
    if (dir === "left") s.h = (s.h + 23) % 24; else if (dir === "right") s.h = (s.h + 1) % 24;
    else if (dir === "up") s.d = Math.max(0, s.d - 1); else if (dir === "down") s.d = Math.min(dayStarts.length - 1, s.d + 1);
    else if (dir === "enter") { setT(rhythmTime(dayStarts[s.d], s.h)); flash(`JUMP · ${dayTag(dayStarts[s.d])} ${pad(s.h)}:00`); }
    else return false;
    rhythmSel = s; drawRhythm(); return "";
  }
  return false;
}
const onOff = (arg, cur) => arg === "on" ? true : arg === "off" ? false : !cur;

/* handlers: one per registry id (commands.ts). (arg, ctx) → a status line, "" for quiet, or false = not here */
/* ================= point & speak (the op center, inside the world) ================= */
// Point at a session → reticle + tag, the other lanes step back. Click its thread or an arc (or *) → the action strip, anchored to it.
// Hold ⌥ → the strip listens. Release or pick a verb → review. ⏎ → act: a DRY RUN (payload to the log + an arc from
// YOU) unless :opcenter live and the server has that route. F freezes the frame and groups it locally.
// The rules (verbs, routes, payloads, grouping) live in opcenter.ts; this is the drawing and the wiring.
const psEl = document.createElement("div"); psEl.className = "ps"; psEl.hidden = true; panelW.appendChild(psEl);
const fzEl = document.createElement("div"); fzEl.className = "psfz"; fzEl.hidden = true; panelW.appendChild(fzEl);
const psTalkEl = document.createElement("div"); psTalkEl.className = "ps pstalk"; psTalkEl.hidden = true; panelW.appendChild(psTalkEl);
const psRootOf = se => { const r = typeof se.root === "string" && se.root ? se.root : se.lane ? se.lane.key : ""; return /^[~/]|^[A-Za-z0-9._-]+:[~/]/.test(r) ? r.replace(/^[A-Za-z0-9._-]+:(?=[~/])/, "") : null; };
const psHostName = h => h ? ((HOST_BY.get(h) || {}).name || h) : null;
function psTarget(se) {
  if (!se || !se.lane) return null;
  const linkedAsks = askBySess.get(se.i) || [], agent = linkedAsks.length ? linkedAsks[linkedAsks.length - 1].tg : null;
  const host = sessHostOf(se.i) || (agent ? actorHost(agent) : null), hostName = psHostName(host);
  const who = agent ? agent.short : se.lane.name;
  return { se, agent, host, hostName, name: `${hostName ? String(hostName).toUpperCase() + "/" : ""}${String(who).toUpperCase()}` };
}
function psTargetOf(hit) {
  if (!hit) return null;
  const se = hit.type === "event" ? sessions[hit.e.sess] : hit.type === "session" ? hit.s : hit.type === "ask" && hit.a.work ? sessions[hit.a.work.s] : null;
  return se && se.lane && !se.lane.off ? psTarget(se) : null;
}
// what the pointed session is doing at TR: stuck (trouble.ts rules), working since its burst began, or quiet since
function psState(tg, TR) {
  const se = tg.se, evs = sessEvents.get(se.i) || [], n = nUpTo(evs, TR);
  const st = trouble.stuck.find(o => o.kind !== "msg" && ((o.work && o.work.s === se.i) || (tg.agent && o.tg === tg.agent)));
  if (st) return { word: "stuck", ms: TR - st.ts, cls: "stuck" };
  const last = n ? evs[n - 1].t : null;
  if (last != null && TR - last < 5 * 60e3) { let k = n - 1; while (k > 0 && evs[k].t - evs[k - 1].t < 10 * 60e3) k--; return { word: "working", ms: TR - evs[k].t, cls: "working" }; }
  if (last != null) return { word: "quiet", ms: TR - last, cls: "quiet" };
  return { word: "not started", ms: 0, cls: "quiet" };
}
const psSub = (tg, TR) => { const s = psState(tg, TR); return `${tg.se.h} · ${s.word}${s.ms ? " " + dur(s.ms) : ""}`; };
// the plain record the rules take (opcenter.ts Target)
const psPlain = tg => ({ name: tg.name, harness: tg.se.h, lane: tg.se.lane.name, root: psRootOf(tg.se), host: tg.host, hostName: tg.hostName,
  agentId: tg.agent ? tg.agent.id : null, agentName: tg.agent ? tg.agent.full : null, sessionId: tg.se.sid || null });

// screen box around the target's recent activity: its calls in the window (or the last 30 minutes), its thread's end
function psBox(se, w, h, TR, fresh) {
  const evs = sessEvents.get(se.i) || [], a = win ? win.a : TR - 30 * 60e3, b = win ? win.b : TR;
  const i1 = nUpTo(evs, b); let i0 = i1; while (i0 > 0 && evs[i0 - 1].t >= a) i0--;
  if (i1 - i0 < 3) i0 = Math.max(0, i1 - 24);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); n++; };
  for (let i = Math.max(i0, i1 - 400); i < i1; i++) { const e = evs[i]; if (!e.lane) continue; const [x, y, z] = evXYZ(e), p = P(x, y, z, w, h); if (p.vis) add(p.x, p.y); }
  const sh = fresh ? null : sessHits.find(q => q.s === se); if (sh) add(sh.b.x, sh.b.y);
  if (fresh) { const q = P(xOf(Math.max(Math.min(se.t1, TR), se.t0 + 3e5)), 0.12, se.lane.z + BAND0 - 1.4 - (se.track || 0) * 0.9, w, h); if (q.vis) add(q.x, q.y); }
  if (!n) { const lt = se.lane, p = P(xOf(Math.min(se.t1, TR)), 0.5, lt.z + BAND0 - 1.4 - (se.track || 0) * 0.9, w, h); if (!p.vis) return null; add(p.x, p.y); }
  const pad = 10, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = Math.max(48, x1 - x0 + pad * 2), bh = Math.max(26, y1 - y0 + pad * 2);
  return { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
}
function psBrackets(g, b, col, len = 9) {
  g.strokeStyle = col; g.lineWidth = 1; g.beginPath();
  [[b.x0, b.y0, 1, 1], [b.x1, b.y0, -1, 1], [b.x0, b.y1, 1, -1], [b.x1, b.y1, -1, -1]].forEach(([x, y, sx, sy]) => { g.moveTo(x + sx * len, y); g.lineTo(x, y); g.lineTo(x, y + sy * len); });
  g.stroke(); g.lineWidth = HAIR;
}
function psTag(g, x, y, name, sub, w) {
  font(g, 8); const t1 = name, t2 = " · " + sub, tw = g.measureText(t1).width + g.measureText(t2).width + 14;
  const bx = clamp(x, 6, w - tw - 6), by = y - 17;
  g.fillStyle = TAG; g.fillRect(bx, by, tw, 14); g.strokeStyle = LINE; g.strokeRect(bx + .5, by + .5, tw - 1, 13);
  g.textAlign = "left"; g.fillStyle = ACC; g.fillText(t1, bx + 7, by + 7.5); g.fillStyle = FG; g.fillText(t2, bx + 7 + g.measureText(t1).width, by + 7.5);
}

// pointing: the session under the pointer, after a short rest; a short grace before it lets go
function psTrack(hit) {
  if (!psOn || psSel || drag || frozen) return;
  const now = performance.now(), tg = psTargetOf(hit), key = tg ? tg.se.i : null;
  if (key == null) { if (psPoint && !psPinned && now - psLostAt > 380) { psPoint = null; psPointKey = null; applyMask(); } return; }
  psLostAt = now;
  if (key !== psPointKey) { psPointKey = key; psPointAt = now; return; }
  if ((!psPoint || psPoint.se !== tg.se) && now - psPointAt > 200) { psPoint = tg; psPinned = false; applyMask(); }
}
function psLane() { const t = psSel || psPoint; return t && t.se ? t.se.lane : null; }

// the strip / pill / review / result: one panel, anchored beside the target's box (it follows the target only)
let psPlaced = "";
function psPlace(b, w, h) {
  if (psEl.hidden) return;
  const pw = psEl.offsetWidth || 300, ph = psEl.offsetHeight || 80;
  let x = b ? b.x1 + 14 : w / 2 - pw / 2, y = b ? b.y0 : h / 2 - ph / 2;
  if (b && x + pw > w - 60) x = b.x0 - pw - 14;
  x = clamp(x, 46, Math.max(46, w - pw - 60)); y = clamp(y, 54, Math.max(54, h - ph - 70));
  const k = Math.round(x) + "," + Math.round(y); if (k !== psPlaced) { psPlaced = k; psEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; }
}
const psWave = (n = 26, quiet = false) => `<span class="pswave${quiet ? " quiet" : ""}">${Array.from({ length: n }, (_, i) => `<i style="animation-delay:-${((i * 137) % 900) / 1000}s;--h:${quiet ? 3 + (i * 7) % 5 : 5 + (i * 11) % 16}px"></i>`).join("")}</span>`;
const psKbd = k => `<kbd>${esc(k)}</kbd>`;
function paintPs() {
  const tg = psSel;
  if (!tg || !psStage) { psEl.hidden = true; psEl.innerHTML = ""; return; }
  psEl.hidden = false;
  const plain = psPlain(tg), live = psLive ? "LIVE" : "DRY RUN";
  let html = "";
  if (psStage === "choose") {
    const b = v => `<button class="chip${psVerb === v ? " on" : ""}${v === "send" ? " dash" : ""}" data-ps="${v}">${esc(VERB_LABEL[v].toUpperCase())}${psKbd(VERB_KEY[v].toUpperCase())}</button>`;
    html = `<div class="psgs"><div class="psg"><div class="psr">${esc(ROUTE_LABEL.traced.toUpperCase())}</div><div class="psb">${b("ask")}${b("report")}${b("dispatch")}</div></div>`
      + `<div class="psg direct"><div class="psr">${esc(ROUTE_LABEL.direct.toUpperCase())}</div><div class="psb">${b("send")}</div></div></div>`
      + `<div class="psf">${psKbd("⌥")} HOLD TO SPEAK · ${psKbd("ESC")} CLOSE · ${live}</div>`;
  } else if (psStage === "speak") {
    html = `<div class="psv">${psWave()}<span class="pss">LISTENING · AMBIENT VOICE</span></div>`
      + `<div class="pssaid">${psText ? "“" + esc(psText) + "”" : `<span class="faint">say it to ${esc(tg.name)}</span>`}<i class="caret"></i></div>`
      + `<div class="psf">HEARD AS <b>${esc(psVerb.toUpperCase())}</b> · ${TRACED[psVerb] ? "TRACED" : "DIRECT"} · RELEASE ${psKbd("⌥")} TO REVIEW</div>`;
  } else if (psStage === "review") {
    const pl = payloadFor(psVerb, plain, psText, { selfHost: SELF_HOST }), real = canSend(pl, psLive);
    const words = psEditing ? `<input class="psin" id="psIn" value="${attr(psText)}" spellcheck="false" autocomplete="off" aria-label="Words">` : (psText ? "“" + esc(psText) + "”" : `<span class="faint">no words yet · E to write them</span>`);
    html = `<div class="pskv"><span>${esc(psVerb.toUpperCase())}</span><span>${words}</span></div>`
      + `<div class="pskv"><span>TO</span><span>${esc(tg.name)} · ${esc(tg.se.h)}${tg.hostName ? " on " + esc(tg.hostName) : ""}</span></div>`
      + `<div class="pskv"><span>ROUTE</span><span class="${TRACED[psVerb] ? "acc" : "direct"}">${esc(routeOf(psVerb))}</span></div>`
      + `<div class="pskv"><span>LANDS</span><span>${esc(landsOf(psVerb, plain))}</span></div>`
      + `<div class="pskv"><span>IF SILENT</span><span>${esc(silentRule(psVerb, stuckLabel()))}</span></div>`
      + `<div class="pskv"><span>MODE</span><span>${esc(modeLine(pl, psLive))}</span></div>`
      + `<div class="psf">${psKbd("⏎")} ${real ? "SEND" : pl.missing ? "LOG IT (STUB)" : "DRY RUN"} · ${psKbd("E")} EDIT · ${psKbd("ESC")} CANCEL</div>`;
  } else if (psStage === "sent" && psResult) {
    const r = psResult, json = JSON.stringify(r.pl.body);
    html = `<div class="psh"><b class="${r.live ? "acc" : ""}">${esc(r.status)}</b> · ${esc(r.pl.verb.toUpperCase())} → ${esc(tg.name)}</div>`
      + `<div class="pscode">${esc(r.pl.method)} ${esc(r.pl.url || "(no route)")}\n${esc(json.length > 420 ? json.slice(0, 419) + "…" : json)}</div>`
      + (r.pl.missing ? `<div class="psnote">missing: ${esc(r.pl.missing)}</div>` : "")
      + `<div class="psf">${r.live ? "IN THE RUNTIME LOG · ARC FROM YOU" : "LOGGED TO THE RUNTIME LOG AS DRY RUN · ARC FROM YOU"} · ${psKbd("ESC")} CLOSE</div>`;
  } else if (psStage === "reply" && psReply) {
    const r = psReply;
    html = `<div class="psh"><b>${esc(r.from)}</b> replied · ${esc(hhmm(r.at))} · via broker</div><div class="psbody">${esc(r.body)}</div>`
      + (r.choices && r.choices.length ? `<div class="psb">${r.choices.map((c, i) => `<button class="chip" data-psc="${i}">${esc(c)}</button>`).join("")}</div>` : "")
      + `<div class="psb"><button class="chip quiet" data-ps="open">OPEN SESSION</button></div><div class="psf">${psKbd("ESC")} CLOSE</div>`;
  }
  setHTML(psEl, html);
  const inp = psEl.querySelector("#psIn"); if (inp && document.activeElement !== inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
psEl.addEventListener("pointerdown", e => e.stopPropagation());
psEl.addEventListener("click", e => {
  const b = e.target.closest("[data-ps]"); if (!b) return;
  const v = b.dataset.ps;
  if (v === "open") { if (psSel) pick({ type: "session", s: psSel.se }); return; }
  if (VERBS.includes(v)) flash(psChoose(v, ""));
});
psEl.addEventListener("keydown", e => {
  if (e.target.id !== "psIn") return;
  if (e.key === "Enter") { psText = e.target.value.trim(); psEditing = false; paintPs(); e.preventDefault(); e.stopPropagation(); }
  else if (e.key === "Escape") { psEditing = false; paintPs(); e.preventDefault(); e.stopPropagation(); }
});

function psOpen(tg) {
  if (!tg) return "POINT AT A SESSION FIRST";
  if (frozen) setFreeze(false);
  psSel = tg; psPoint = tg; psStage = "choose"; psText = ""; psVerb = "ask"; psEditing = false; psResult = null; psReply = null;
  applyMask(); paintPs(); paintKeys();
  return `POINT · ${tg.name} · A ASK · R REPORT · D DISPATCH · S SEND (DIRECT)`;
}
// pointing without a pointer (keyboard, voice, deep links): the lane's most recent session at the playhead
function psPointAt_(q) {
  const TR = win ? win.b : T, l = lanes.find(x => x.name.toLowerCase() === q) || lanes.find(x => x.name.toLowerCase().includes(q));
  if (!l) return "POINT · NO LANE MATCHES " + q.toUpperCase();
  let best = null, bt = -Infinity;
  for (const se of sessions) { if (se.lane !== l) continue; const evs = sessEvents.get(se.i) || [], k = nUpTo(evs, TR); if (k && evs[k - 1].t > bt) { bt = evs[k - 1].t; best = se; } }
  if (!best) return "POINT · NOTHING IN " + l.name.toUpperCase() + " BEFORE THE PLAYHEAD";
  if (psSel) psClose();
  psPoint = psTarget(best); psPinned = true; psPointKey = best.i; applyMask();
  return `POINT · ${psPoint.name} · * OPENS THE STRIP · ⌥ SPEAKS`;
}
/* keyboard pointing. The ring IS the pointed session (psPoint, pinned): arrows move it to the nearest session that way
 * on screen, a/r/d/s act on it, Enter opens its strip, Esc lets go. Tags (`) put a letter on every session in view. */
function ringCands() {
  const r = sizeOf(panelW), w = r.width, h = r.height, TR = win ? win.b : T, SW = 20 * 36e5, out = [];
  for (const se of sessions) {
    if (!se.lane || se.lane.off || !Number.isFinite(se.t0) || se.t0 > TR || se.t1 < (win ? win.a : T - SW)) continue;
    if ((lens === "sessions" || lens === "scout") && (lens === "scout") === se.native) continue;
    const z = se.lane.z + BAND0 - 1.4 - (se.track || 0) * 0.9, p = P(xOf(Math.min(se.t1, TR)), 0.12, z, w, h);
    if (p.vis && p.x > 8 && p.x < w - 8 && p.y > 8 && p.y < h - 8) out.push({ se, x: p.x, y: p.y });
  }
  return { list: out, w, h };
}
function ringSet(se, how) {
  if (psSel) psClose();
  psPoint = psTarget(se); psPinned = true; psPointKey = se.i; applyMask(); paintKeys();
  return `POINT · ${psPoint.name}${how ? " · " + how : ""} · ARROWS MOVE · A R D S ACT · ↵ STRIP · ESC LETS GO`;
}
const ringOn = () => !!(psOn && psPoint && psPinned && !psStage && !frozen);
function ringStart() {
  const { list, w, h } = ringCands(); if (!list.length) return "POINT · NO SESSIONS IN VIEW · WIDEN THE WINDOW OR ZOOM OUT";
  let best = list[0], bd = Infinity; for (const c of list) { const d = (c.x - w / 2) ** 2 + (c.y - h / 2) ** 2; if (d < bd) { bd = d; best = c; } }
  return ringSet(best.se, "NEAREST THE MIDDLE");
}
function ringMove(dir) {
  if (!ringOn()) return ringStart();
  const { list } = ringCands(), cur = list.find(c => c.se === psPoint.se);
  if (!cur) return ringStart();
  const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  let best = null, bs = Infinity;
  for (const c of list) {
    if (c.se === cur.se) continue;
    const vx = c.x - cur.x, vy = c.y - cur.y, along = vx * dx + vy * dy, across = Math.abs(vx * dy - vy * dx);
    if (along < 4) continue;
    const score = along + 2.2 * across; if (score < bs) { bs = score; best = c; }
  }
  if (!best) return `POINT · NOTHING FURTHER ${dir.toUpperCase()}`;
  return ringSet(best.se);
}
function ringRelease() { psPinned = false; psPoint = null; psPointKey = null; applyMask(); paintKeys(); return "POINT · LET GO"; }
// tags: home row first, then two letters when the view holds more than one row of keys
const HINT_KEYS = "asdfghjklqwertyuiopzxcvbnm";
let hints = null;   // { tags: [{ tag, se, x, y }], typed }
function hintStart() {
  const { list } = ringCands(); if (!list.length) return "TAGS · NO SESSIONS IN VIEW";
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  const two = list.length > HINT_KEYS.length, tags = list.map((c, i) => ({ ...c, tag: two ? HINT_KEYS[(i / HINT_KEYS.length) | 0] + HINT_KEYS[i % HINT_KEYS.length] : HINT_KEYS[i] }));
  hints = { tags: tags.slice(0, HINT_KEYS.length * HINT_KEYS.length), typed: "" }; paintKeys();
  return `TAGS · ${hints.tags.length} SESSIONS · TYPE A TAG · SHIFT OPENS ITS STRIP · ESC CANCELS`;
}
// a keystroke while tags are up: narrow, land, or give up. true = the key was ours
function hintKey(e) {
  if (!hints) return false;
  if (e.key === "Escape" || e.key === "`") { hints = null; paintKeys(); flash("TAGS · CANCELLED"); return true; }
  if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return true;
  const typed = hints.typed + e.key.toLowerCase(), hit = hints.tags.find(t => t.tag === typed);
  if (hit) { hints = null; const out = ringSet(hit.se, "TAGGED"); flash(e.shiftKey ? psOpen(psPoint) : out); return true; }
  if (!hints.tags.some(t => t.tag.startsWith(typed))) { hints = null; paintKeys(); flash(`TAGS · NO TAG ${typed.toUpperCase()}`); return true; }
  hints.typed = typed; return true;
}
// bookmarks: Shift+B then a letter keeps this view (camera, zoom, the moment); Shift+G then the letter flies back to it
const MARKS_KEY = "world-modale.marks";
let bmarks = {}; try { bmarks = JSON.parse(localStorage.getItem(MARKS_KEY) || "{}") || {}; } catch {}
let chord = null;   // "set" | "go" while waiting for the letter
const bmList = () => Object.keys(bmarks).sort().join(" ").toUpperCase();
function bookmark(op, l) {
  const L = String(l || "").toUpperCase();
  if (op === "list") return Object.keys(bmarks).length ? "MARKS · " + bmList() + " · SHIFT+G THEN A LETTER" : "MARKS · NONE · SHIFT+B THEN A LETTER KEEPS ONE";
  if (!/^[a-z]$/.test(l || "")) return "MARK · ONE LETTER, A TO Z";
  if (op === "rm") { if (!bmarks[l]) return "MARK · NO " + L; delete bmarks[l]; try { localStorage.setItem(MARKS_KEY, JSON.stringify(bmarks)); } catch {} return "MARK · REMOVED " + L; }
  if (op === "set") {
    bmarks[l] = { az: camGoal.az, el: camGoal.el, r: camGoal.r, tx: camGoal.tx, tz: camGoal.tz, level, t: T };
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(bmarks)); } catch {}
    return `MARK ${L} · KEPT · ${dayTag(T)} ${hhmm(T)} · SHIFT+G ${L} COMES BACK`;
  }
  const m = bmarks[l]; if (!m) return `MARK · NO ${L} · SHIFT+B ${L} KEEPS THIS VIEW`;
  if (!LIVE) { setPlaying(false); setT(m.t); }
  follow = false; Object.assign(camGoal, { az: m.az, el: m.el, r: m.r, tx: m.tx, tz: m.tz }); boundCam(camGoal);
  if (LEVELS[m.level]) level = m.level; renderZoomRail(); renderViews();
  return `MARK ${L} · ${dayTag(m.t)} ${hhmm(m.t)}`;
}
function chordKey(e) {
  if (!chord) return false;
  if (e.key.length !== 1 && e.key !== "Escape") return true;   // Shift on its way to the letter
  const op = chord; chord = null; paintKeys();
  flash(e.key === "Escape" ? "MARK · CANCELLED" : bookmark(op, e.key.toLowerCase()));
  return true;
}
function hintDraw(g, w, h) {
  if (!hints) return;
  const { list } = ringCands(), at = new Map(list.map(c => [c.se, c]));
  font(g, 8); g.textAlign = "left";
  // threads that end together (everything still running ends at the playhead) would stack their
  // tags into one unreadable block: place greedily, step each clash upward, and draw a leader home
  const placed = [];
  const clash = (x, y, tw) => placed.some(q => x < q.x + q.w + 2 && x + tw + 2 > q.x && y < q.y + 15 && y + 15 > q.y);
  for (const t of hints.tags) {
    if (!t.tag.startsWith(hints.typed)) continue;
    const c = at.get(t.se) || t, label = t.tag.toUpperCase(), tw = g.measureText(label).width + 8;
    const at0 = (i, j) => [clamp(c.x - tw / 2 + i * (tw + 3), 4, w - tw - 4), clamp(c.y - 20 + j * 15, 4, h - 17)];
    let [bx, by] = at0(0, 0), n = 0;
    // ring by ring around the point, upper cells first, until a free slot turns up
    search: for (let r = 1; clash(bx, by, tw) && r < 12; r++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const [x, y] = at0(i, j); if (!clash(x, y, tw)) { bx = x; by = y; n = r; break search; }
      }
    }
    placed.push({ x: bx, y: by, w: tw });
    if (n) { g.globalAlpha = 0.35; g.strokeStyle = ACC; g.beginPath(); g.moveTo(c.x + .5, c.y - 3); g.lineTo(bx + tw / 2 + .5, by + 13); g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = TAG; g.fillRect(bx, by, tw, 13); g.strokeStyle = ACC; g.strokeRect(bx + .5, by + .5, tw - 1, 12);
    g.fillStyle = FAINT; g.fillText(label.slice(0, hints.typed.length), bx + 4, by + 7);
    g.fillStyle = ACC; g.fillText(label.slice(hints.typed.length), bx + 4 + g.measureText(label.slice(0, hints.typed.length)).width, by + 7);
  }
}
function psClose() {
  const was = !!psSel; psPinned = false; psSel = null; psStage = null; psEditing = false; psText = ""; psResult = null; psReply = null; psPoint = null; psPointKey = null;
  applyMask(); paintPs(); paintKeys();
  return was ? "" : false;
}
// a verb selection (key, click, :ask words): words given → review; none → review with the words to write
function psChoose(v, words) {
  const tg = psSel || psPoint; if (!tg) return "POINT AT A SESSION FIRST · HOVER ONE IN THE WORLD";
  if (!psSel) psOpen(tg);
  psVerb = v; if (words) psText = words;
  psStage = "review"; psEditing = !psText; paintPs(); paintKeys();
  return `${v.toUpperCase()} · ${routeOf(v).toUpperCase()} · REVIEW`;
}
// words arriving (voice while ⌥ is held, or :say): the verb is inferred, Ask unless the words say otherwise
function psHear(words) {
  const text = String(words || "").trim(); if (!text) return "";
  if (frozen) return fzAnswer(text);
  const tg = psSel || psPoint; if (!tg) return "SAY · POINT AT A SESSION FIRST";
  if (!psSel) psOpen(tg);
  const v = inferVerb(text); psVerb = v.verb; psText = v.text;
  if (psStage !== "speak") { psStage = "review"; psEditing = false; }
  paintPs(); paintKeys();
  return `HEARD AS ${v.verb.toUpperCase()} · ${routeOf(v.verb).toUpperCase()}`;
}
function psSpeak(on) {
  if (frozen) { fzListen(on); return ""; }
  if (on) {
    const tg = psSel || psPoint; if (!tg) return "SPEAK · POINT AT A SESSION FIRST";
    if (!psSel) psOpen(tg);
    psStage = "speak"; psText = ""; psVerb = "ask"; paintPs(); paintKeys(); return "LISTENING · " + tg.name;
  }
  if (psStage !== "speak") return "";
  psStage = psText ? "review" : "choose"; psEditing = false; paintPs(); paintKeys();
  return psText ? "REVIEW · ⏎ SENDS · E EDITS" : "NOTHING HEARD";
}
// ⏎ in review: build the exact payload; a real request only when live and the route exists, never another verb's route
function psAct() {
  if (psStage !== "review" || !psSel) return false;
  if (!psText && psVerb !== "dispatch") { psEditing = true; paintPs(); return "WRITE THE WORDS FIRST · ⏎ WHEN DONE"; }
  const tg = psSel, pl = payloadFor(psVerb, psPlain(tg), psText, { selfHost: SELF_HOST }), real = canSend(pl, psLive);
  console.info(`[world · point & speak] ${real ? "LIVE" : "DRY RUN"} ${pl.verb} ${pl.method} ${pl.url || "(no route)"}`, pl.body);
  psLog(tg, pl, !real);
  psArcs.push({ se: tg.se, verb: pl.verb, t0: performance.now(), dry: !real, name: tg.name });
  psResult = { pl, live: real, status: real ? "SENDING" : pl.missing ? "STUB · NOT SENT" : "DRY RUN" };
  psStage = "sent"; paintPs(); paintKeys();
  if (real) {
    fetch(pl.url, { method: pl.method, headers: { "content-type": "application/json" }, body: JSON.stringify(pl.body) })
      .then(r => r.json().catch(() => ({})).then(j => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => {
        if (!alive) return;
        psResult = { ...psResult, status: ok ? "SENT" : `REFUSED · ${status} · ${String(j && j.error || "").slice(0, 60)}` }; paintPs();
        if (ok && pl.verb === "ask" && tg.agent) psAwait = { agent: tg.agent, tg, since: Date.now() - 5e3, text: psText, ask: null };
      })
      .catch(() => { if (alive) { psResult = { ...psResult, status: "NOT SENT · SERVER UNREACHABLE" }; paintPs(); } });
  }
  return `${real ? "SENDING" : pl.missing ? "STUB" : "DRY RUN"} · ${pl.verb.toUpperCase()} → ${tg.name}${pl.missing ? " · NOT SENT" : ""}`;
}
// the log line: the exact request, marked DRY RUN (kept across rebuilds of the log)
function psLog(tg, pl, dry) {
  const row = { ts: T, k: "dry", a: { kind: "dry", dry, tg: tg.agent || null, lane: tg.se.lane, name: tg.name, verb: pl.verb, task: `${dry ? (pl.missing ? "STUB" : "DRY RUN") : "LIVE"} · ${pl.method} ${pl.url || "(no route)"} · ${JSON.stringify(pl.body)}` } };
  psRows.push(row);
  logEvents.splice(logUpTo(logEvents, row.ts), 0, row); logLaneKey = "\u0000"; logSig = ""; logCount = -1; paintLog();
}
// outbound arcs: from YOU (the operator's row, at the playhead) to the target's thread; dashed while fresh
function psDrawArcs(g, w, h, TR) {
  const now = performance.now(); psArcs = psArcs.filter(a => now - a.t0 < 180e3);
  if (!psArcs.length && !psStage) return;
  const you = P(xOf(TR) - 2, 0.5, OPERATOR_Z, w, h);
  for (const a of psArcs) {
    const se = a.se, z = se.lane.z + BAND0 - 1.4 - (se.track || 0) * 0.9, x1 = xOf(clamp(TR, se.t0, TR)), x0 = xOf(TR) - 2;
    const lift = 10 + Math.min(26, Math.abs(se.lane.z - OPERATOR_Z) * 0.35), age = now - a.t0, grow = clamp(age / 900, 0, 1), pts = [];
    // the arc bows back in time (off the playhead's own beam) so it reads as a send, not a cursor
    const bow = xOf(TR) - xOf(TR - 4 * 36e5);
    for (let i = 0; i <= 26; i++) { const f = (i / 26) * grow; pts.push(P(x0 + (x1 - x0) * f - Math.sin(f * Math.PI) * bow, 0.5 + f * 0.8 + Math.sin(f * Math.PI) * lift * 0.5, OPERATOR_Z + (z - OPERATOR_Z) * f, w, h)); }
    const direct = a.verb === "send";
    g.strokeStyle = direct ? FG : ACC; g.globalAlpha = age < 60e3 ? 0.95 : 0.4; g.setLineDash(direct ? [6, 3] : [3, 3]); g.lineDashOffset = -now / 50;
    g.lineWidth = 1.4; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]); g.lineWidth = HAIR;
    const e = pts[pts.length - 1], m = pts[13];
    if (grow >= 1) { g.fillStyle = direct ? FG : ACC; g.beginPath(); g.arc(e.x, e.y, 2.4, 0, Math.PI * 2); g.fill(); }
    if (m && m.vis) { font(g, 8); g.textAlign = "right"; g.fillStyle = direct ? FG : ACC; g.fillText(`${a.dry ? "DRY RUN · " : ""}${a.verb.toUpperCase()}${direct ? " · DIRECT" : " · VIA SCOUT"} → ${a.name}`, m.x - 8, m.y); }
    g.globalAlpha = 1;
  }
  if (you.vis) { g.strokeStyle = ACC; g.beginPath(); g.arc(you.x, you.y, 3.5, 0, Math.PI * 2); g.stroke(); g.fillStyle = ACC; g.beginPath(); g.arc(you.x, you.y, 1.3, 0, Math.PI * 2); g.fill();
    font(g, 8); g.textAlign = "right"; g.fillStyle = FG; g.fillText("YOU", you.x - 8, you.y + 0.5); }
}
function psDraw(g, w, h, TR) {
  if (frozen) { fzDraw(g, w, h, TR); return; }
  hintDraw(g, w, h);
  if (psAwait && LIVE) psCheckReply();
  psDrawArcs(g, w, h, TR);
  const tg = psSel || psPoint; if (!psOn || !tg) { psEl.hidden || psPlace(null, w, h); return; }
  const b = psBox(tg.se, w, h, TR);
  if (b) { psBrackets(g, b, ACC); psTag(g, b.x0, b.y0, tg.name, psSub(tg, TR), w); }
  psPlace(b, w, h);
}
// a traced ask that got its answer (LIVE): the reply anchors to the target; buttons only for choices it declared
function psCheckReply() {
  const aw = psAwait; if (!aw) return;
  if (!aw.ask) aw.ask = asks.find(a => a.tg === aw.agent && a.ts >= aw.since && sq(a.task).startsWith(sq(aw.text).slice(0, 40))) || null;
  const a = aw.ask; if (!a || !a.done) return;
  psAwait = null;
  if (a.st === "f") { psSel = aw.tg; psStage = "sent"; psResult = { ...(psResult || { pl: { verb: "ask", method: "POST", url: "/api/ask", body: {} } }), status: "FAILED · " + sq(a.err || "no reason recorded").slice(0, 60) }; paintPs(); return; }
  const said = msgs.filter(m => m.a === aw.agent && m.ts >= a.ts).pop();
  psSel = aw.tg; psStage = "reply"; psReply = { from: aw.agent.short, at: a.done, body: said && said.c ? sq(said.c) : `Done in ${dur(a.done - a.ts)}. The reply is in the broker log.`, choices: (said && Array.isArray(said.choices)) ? said.choices : [] };
  applyMask(); paintPs();
}

/* ---------- freeze: the frame holds, greys, and what's on it is grouped locally ---------- */
const FZ_SPAN = 3 * 36e5;   // with no window open, the frame is the last three hours before the playhead
// a trouble row in plain words for the grouping: who it was for, what it was, when, and the broker's reason (short)
const fzTrouble = (o, cls, at) => o.kind === "tool"
  ? { cls, who: ((sessions[o.sess] && sessions[o.sess].h) || "a session") + " · " + String(o.tool || "tool").toLowerCase(), what: "tool call", at, why: plainWhy(o.err) }
  : { cls, who: o.kind === "msg" ? (o.fanN > 1 ? o.fanN + " agents" : o.toA ? o.toA.tag || o.toA.short.toLowerCase() : String(o.toName || "an agent").toLowerCase()) : (o.tg && o.tg.tag) || String((o.tg && o.tg.short) || "an agent").toLowerCase(), what: o.kind === "msg" ? "message" : "ask", at, why: plainWhy(o.err) };
function fzUnits(TR) {
  const a = win ? win.a : TR - FZ_SPAN, b = win ? win.b : TR, by = new Map();
  const unit = (lane, host) => { const k = lane.name + "|" + (host || "—"); let u = by.get(k); if (!u) { u = { key: k, lane: lane.name, laneRef: lane, host, hostName: psHostName(host) || HUB, calls: 0, last: null, stuck: 0, stuckSince: null, failed: 0, evs: [], spots: [], trouble: [] }; by.set(k, u); } return u; };
  for (let i = lowerBound(EVT_T, a), i1 = lowerBound(EVT_T, b + 1); i < i1; i++) { const e = EVT[i]; if (!e.lane || e.lane.off) continue;
    const u = unit(e.lane, sessHostOf(e.sess)); u.calls++; u.last = Math.max(u.last || 0, e.t); if (u.evs.length < 300) u.evs.push(e); }
  for (const o of trouble.stuck) { const l = troubleLane(o); if (!l || l.off) continue; const u = unit(l, o.tg ? actorHost(o.tg) : null); u.stuck++; u.stuckSince = u.stuckSince == null ? o.ts : Math.min(u.stuckSince, o.ts); u.spots.push(o); u.trouble.push(fzTrouble(o, "stuck", o.ts)); }
  for (const o of trouble.failed) { if (failT(o) < a) continue; const l = troubleLane(o); if (!l || l.off) continue; const u = unit(l, o.tg ? actorHost(o.tg) : o.kind === "tool" ? sessHostOf(o.sess) : null); u.failed++; u.spots.push(o); u.trouble.push(fzTrouble(o, "failed", failT(o))); }
  return [...by.values()];
}
function setFreeze(on) {
  if (on && !frozen) {
    const TR = win ? win.b : T, units = fzUnits(TR), groups = groupFrame(units, TR);
    const keyed = new Map(units.map(u => [u.key, u]));
    groups.forEach(gr => { gr.units = gr.keys.map(k => keyed.get(k)).filter(Boolean); });
    frozen = { T: TR, groups, lit: null, talk: null, listening: false };
    if (psSel) { psSel = null; psStage = null; paintPs(); }
    psPoint = null; applyMask();
    gl.style.filter = theme.light ? "grayscale(1) opacity(0.55)" : "grayscale(1) brightness(0.62)";
    paintFz(); paintKeys();
    if (psJev) fzJev();
    return `FROZEN · ${dayTag(TR)} ${hhmm(TR)} · ${groups.length} GROUPS · LOCAL GROUPING · F RESUMES`;
  }
  if (!on && frozen) {
    frozen = null; gl.style.filter = ""; fzEl.hidden = true; psTalkEl.hidden = true; paintKeys();
    if (LIVE && playing) T = Math.min(T1, Date.now());
    return "RESUMED";
  }
  return frozen ? "FROZEN · F RESUMES" : "NOT FROZEN";
}
function paintFz() {
  if (!frozen) { fzEl.hidden = true; psTalkEl.hidden = true; return; }
  fzEl.hidden = false;
  setHTML(fzEl, `<b>FROZEN</b> · ${esc(dayTag(frozen.T))} ${esc(hhmm(frozen.T))} · LOCAL GROUPING · ${frozen.groups.length} GROUPS · ${psKbd("F")} RESUME · ${psKbd("⌥")} ASK ABOUT THIS FRAME`
    + (psJev ? `<small>JEV · ON · the groups (lanes, machines, counts; prompt text redacted) went to the world-command route</small>` : `<small>nothing leaves this machine · :freeze jev on to share the groups</small>`));
  const t = frozen.talk;
  if (!t && !frozen.listening) { psTalkEl.hidden = true; return; }
  psTalkEl.hidden = false;
  const lit = t && t.lit ? frozen.groups.find(gr => gr.id === t.lit) : null;
  setHTML(psTalkEl, (t ? `<div class="psline"><span>YOU</span>“${esc(t.q)}”</div><div class="psline scout"><span>SCOUT</span>${esc(t.a)}</div>` : "")
    + (lit ? `<div class="psb"><button class="chip on" data-fz="point">POINT AT ${esc(lit.id)}</button><button class="chip" data-fz="report">REPORT ON ${esc(lit.id)}</button></div>` : "")
    + `<div class="psv small">${psWave(22, !frozen.listening)}<span class="pss">${frozen.listening ? "LISTENING · ABOUT THE FROZEN FRAME" : "LOCAL ANSWER · FROM THE GROUPING · HOLD ⌥ TO ASK AGAIN"}</span></div>`);
}
psTalkEl.addEventListener("pointerdown", e => e.stopPropagation());
psTalkEl.addEventListener("click", e => {
  const b = e.target.closest("[data-fz]"); if (!b || !frozen || !frozen.talk || !frozen.talk.lit) return;
  const gr = frozen.groups.find(x => x.id === frozen.talk.lit); const lead = gr && fzLead(gr); if (!lead) { flash("NO SESSION IN " + (gr ? gr.id : "THAT GROUP")); return; }
  setFreeze(false); flash(b.dataset.fz === "report" ? (psOpen(lead), psChoose("report", "")) : psOpen(lead));
});
// a group's lead session: the busiest one in its units' calls
function fzLead(gr) {
  const n = new Map(); for (const u of gr.units || []) for (const e of u.evs) n.set(e.sess, (n.get(e.sess) || 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0]; return best ? psTarget(sessions[best[0]]) : null;
}
function fzListen(on) { if (!frozen) return; frozen.listening = on; paintFz(); }
function fzAnswer(q) {
  if (!frozen) return "";
  const ans = answerFrozen(q, frozen.groups, frozen.T);
  frozen.talk = { q, a: ans.text, lit: ans.lit }; frozen.lit = ans.lit; paintFz();
  return ans.lit ? "ANSWERED · " + ans.lit + " LIT" : "ANSWERED";
}
// :freeze jev on — only then, and only the redacted shape of the groups
function fzJev() {
  if (!frozen) return;
  const body = jevFramePayload(frozen.groups, { t: frozen.T, from: T0, to: T1, lanes: lanes.map(l => l.name), view: viewName });
  console.info("[world · freeze] jev", body);
  fetch(`${typeof API === "string" ? API : "/api/ops"}/world-command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(r => r.json()).then(j => { if (alive) flash(`JEV · ${String(j && (j.echo || j.status) || "no answer").toUpperCase().slice(0, 60)} · GROUPING STAYS LOCAL`); })
    .catch(() => { if (alive) flash("JEV · UNREACHABLE · GROUPING STAYS LOCAL"); });
}
function fzDraw(g, w, h, TR) {
  const fr = frozen; if (!fr) return;
  fr.groups.forEach(gr => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    const add = p => { if (!p.vis) return; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); n++; };
    for (const u of gr.units || []) {
      for (const e of u.evs) { const [x, y, z] = evXYZ(e); add(P(x, y, z, w, h)); }
      if (!u.evs.length) add(P(xOf(fr.T), 1, u.laneRef.z, w, h));
    }
    if (!n) return;
    const pad = 12; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const lit = fr.lit === gr.id, back = fr.lit && !lit;
    g.strokeStyle = lit ? ACC : FG; g.globalAlpha = back ? 0.25 : lit ? 1 : 0.7; g.setLineDash([4, 3]); g.lineWidth = lit ? 1 : HAIR;
    const r = 6; g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x1, y0, x1, y1, r); g.arcTo(x1, y1, x0, y1, r); g.arcTo(x0, y1, x0, y0, r); g.arcTo(x0, y0, x1, y0, r); g.closePath(); g.stroke();
    g.setLineDash([]); g.lineWidth = HAIR;
    font(g, 7.5); g.textAlign = "left"; g.fillStyle = lit ? ACC : FG; g.fillText(gr.label.toUpperCase(), x0 + 2, y0 - 7);
    g.globalAlpha = 1;
  });
}

const HANDLERS = {
  search: (arg) => { openFind(arg || ""); return ""; },
  // real time has nothing to play: Space holds the moment on screen, and again goes back to now
  play: (arg) => { if (LIVE) { if (arg === "toggle" && playing) return realTimeHold(); return goLive(); }
    if (arg === "toggle") { setPlaying(!playing); return ""; } setPlaying(true); return "PLAY"; },
  pause: () => { if (LIVE) return realTimeHold(); setPlaying(false); return "PAUSE"; },
  goto: (arg) => {
    if (arg === "now") { if (LIVE) return goLive(); setT(T1); return "GOTO · THE END"; }
    if (arg === "end") { if (LIVE) return goLive(); setPlaying(false); setT(T1); return "GOTO · THE END · PAUSED"; }
    if (LIVE && playing) setPlaying(false);   // real time: anywhere but now holds there, or following would pull it straight back
    if (arg === "start") { setT(T0); return "GOTO · START"; }
    const abs = arg.match(/^@(\d{10,})$/); if (abs) { setT(+abs[1]); return "GOTO · " + dayTag(T) + " " + hhmm(T); }
    const rel = arg.match(/^([+-]\d+(?:\.\d+)?)([dhm])$/); if (rel) { const n = parseFloat(rel[1]), u = { d: 864e5, h: 36e5, m: 6e4 }[rel[2]]; setT(T + n * u); return "GOTO · " + dayTag(T) + " " + hhmm(T); }
    const m = arg.match(/^(sun|mon|tue|wed|thu|fri|sat)?\s*(\d{1,2})?(?::(\d{2}))?$/);
    if (m && (m[1] || m[2])) { let base = T; if (m[1]) { const di = DOW.indexOf(m[1].toUpperCase()); const ds = dayStarts.find(d => new Date(d).getDay() === di); if (ds == null) return "NO " + m[1].toUpperCase() + " IN THIS WEEK"; base = ds; } else { const d = new Date(T); d.setHours(0, 0, 0, 0); base = d.getTime(); }
      const at = new Date(base); at.setHours(m[2] ? +m[2] : 12, m[3] ? +m[3] : 0, 0, 0); setT(at.getTime()); return "GOTO · " + dayTag(T) + " " + hhmm(T); }
    return "GOTO · try wed 14:00, -2d, now";
  },
  speed: (arg) => {
    if (LIVE) return "SPEED · PLAYBACK ONLY";
    if (arg === "faster") { setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]); return ""; }
    if (arg === "slower") { setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]); return ""; }
    const r = parseRate(arg); if (r) { setSpeed(r * LOOP_MS / SPAN); return "SPEED · " + rateLabel(r); }
    const n = parseFloat(arg); if (!n || /[a-z]/.test(arg)) return "SPEED · 2 · 1h/s · 10m/s · realtime"; setSpeed(n); return "SPEED " + speedLabel(n);
  },
  ask: (arg, ctx) => {
    if (ctx.key && (ctx.scope === "ps" || ctx.scope === "ring")) return psChoose("ask", "");
    if (!arg || arg === "next" || arg === "prev") { stepAsk(arg === "prev" ? -1 : 1); return ""; }
    return psChoose("ask", psWords(ctx));
  },
  point: (arg) => {
    if (arg && arg !== "open" && arg !== "close") return psPointAt_(arg);
    if (arg === "close") return psClose() || "POINT · CLOSED"; if (psSel && arg !== "open") return psClose() || "";
    const tg = psSel || psPoint || psTargetOf(hover);
    // nothing under the pointer and nothing pointed: the keyboard starts the ring instead of failing
    if (!tg) return ringStart();
    if (!psPinned && !psSel && arg !== "open" && !hover) return ringSet(tg.se);
    return psOpen(tg); },
  ring: (arg) => arg === "release" ? (ringOn() ? ringRelease() : "POINT · NOTHING POINTED") : ringMove(arg),
  hint: () => hints ? ((hints = null), paintKeys(), "TAGS · CANCELLED") : hintStart(),
  shuttle: (arg) => shuttle(arg),
  frame: () => {
    const tg = psSel || psPoint; if (!tg) return "FRAME · POINT AT A SESSION FIRST · * OR ` TO POINT";
    const out = frameSession(tg.se, win ? win.b : T); return out || `FRAME · ${tg.name}`;
  },
  mark: (arg) => markInOut(arg),
  fold: (arg) => foldPanel(arg),
  tell: (arg, ctx) => { const q = ((ctx && ctx.rest) || []).join(" ").trim(); if (!q) return "TELL · SAY A QUESTION AFTER :tell"; if (!opts.onAsk) return "TELL · NOT AVAILABLE HERE"; opts.onAsk(q); return ""; },
  // a key waits for the letter; typed, it's :bookmark set a · go a · rm a · list
  bookmark: (arg, ctx) => {
    if (ctx.key) { chord = arg; paintKeys(); return arg === "set" ? "MARK · A LETTER KEEPS THIS VIEW · ESC CANCELS" : "MARK · A LETTER FLIES BACK" + (Object.keys(bmarks).length ? " · " + bmList() : " · NONE KEPT YET"); }
    const [op = "list", l] = ctx.rest.map(x => x.toLowerCase());
    return bookmark(op, l);
  },
  report: (arg, ctx) => psChoose("report", psWords(ctx)),
  dispatch: (arg, ctx) => psChoose("dispatch", psWords(ctx)),
  send: (arg, ctx) => psChoose("send", psWords(ctx)),
  speak: (arg) => psSpeak(arg !== "off"),
  say: (arg, ctx) => psHear(psWords(ctx)),
  confirm: () => psAct(),
  edit: () => { if (psStage !== "review") return false; psEditing = true; paintPs(); return "EDIT · ⏎ KEEPS · ESC LEAVES IT"; },
  freeze: (arg) => {
    if (arg === "jev on" || arg === "jev") { psJev = true; if (frozen) { paintFz(); fzJev(); } return "FREEZE · JEV ON · GROUPS (NO PROMPT TEXT) GO TO THE WORLD-COMMAND ROUTE WHEN FROZEN"; }
    if (arg === "jev off") { psJev = false; paintFz(); return "FREEZE · JEV OFF · NOTHING LEAVES THIS MACHINE"; }
    return setFreeze(arg === "on" ? true : arg === "off" ? false : !frozen);
  },
  opcenter: (arg) => {
    if (arg === "off") { psClose(); psOn = false; return "POINT & SPEAK · OFF"; }
    if (arg === "on" || !arg) { psOn = true; return `POINT & SPEAK · ON · ${psLive ? "LIVE" : "DRY RUN"}`; }
    psOn = true; psLive = arg === "live"; paintPs();
    return psLive ? "POINT & SPEAK · LIVE · ROUTES THAT EXIST SEND FOR REAL · SEND STAYS A STUB" : "POINT & SPEAK · DRY RUN · PAYLOADS ONLY";
  },
  slice: (arg) => {
    if (playing) setPlaying(false);
    const step = /1h$/.test(arg) ? 36e5 : BIN, dir = arg.startsWith("-") ? -1 : 1;
    setT(sliceStart() + BIN / 2 + dir * step); sliceCache.key = -1;
    return `SLICE · ${dayTag(T)} ${hhmm(sliceStart())} · ${sliceHits().events.length} HITS`;
  },
  stack: (arg) => { stepTs(arg === "prev" ? -1 : 1); return ""; },
  turn: (arg) => { camGoal.az += arg === "right" ? -0.35 : 0.35; poke(); return "TURN · " + arg.toUpperCase(); },
  zoom: (arg) => { zoomBy(Math.exp(arg === "in" ? -0.35 : 0.35), null); return "ZOOM · " + arg.toUpperCase(); },
  view: (arg) => { if (VIEWS[arg]) { setView(arg); return "VIEW · " + arg.toUpperCase(); } return "VIEW · iso top side low"; },
  pan: (arg) => {
    const pw = gl.getBoundingClientRect(), sx = pw.width * 0.18, sy = pw.height * 0.18;
    if (arg === "left") panBy(sx, 0); else if (arg === "right") panBy(-sx, 0); else if (arg === "up") panBy(0, sy); else panBy(0, -sy);
    return "";
  },
  orbit: (arg) => { if (arg === "left") camGoal.az += 0.12; else if (arg === "right") camGoal.az -= 0.12; else if (arg === "up") camGoal.el += 0.08; else camGoal.el -= 0.08; return ""; },
  level: (arg) => { setLevel(level + (arg === "out" ? -1 : 1)); return ""; },
  follow: (arg) => { if (onOff(arg, follow) !== follow) toggleFollow(); return ""; },
  center: () => { centerOnNow(); return ""; },
  reset: () => { resetCamera(); return "CAMERA · THE WEEK"; },
  height: (arg) => { LAYER_H = clamp(LAYER_H * (arg === "down" ? 1 / 1.35 : 1.35), 0.12, 2.4); uniforms.uLayer.value = LAYER_H; return "HEIGHT ×" + (LAYER_H / 0.42).toFixed(1); },
  pin: (arg) => { if (!pins.length) return "NO PINS IN VIEW"; pinSel = (pinSel + (arg === "prev" ? -1 : 1) + pins.length) % pins.length; return "PIN · " + pins[pinSel].agent.short.toUpperCase(); },
  only: (arg) => {
    if (!arg) return focusAgent ? `FOCUS · ${focusAgent.short.toUpperCase()} · :only off` : "FOCUS · :only <agent> · or click a roster row";
    if (arg === "off") return setFocusAgent(null);
    const hit = agentNamed(arg); return hit ? setFocusAgent(hit) : "NO AGENT MATCHES " + arg.toUpperCase();
  },
  find: (arg, ctx) => {
    if ((ctx && ctx.key) || !arg) { openCmd(); $("cmd").value = "find "; paintPal(); return ""; }
    const hit = rosterAll.find(r => nameHit(r.a, arg)); if (!hit) return "NO AGENT MATCHES " + arg.toUpperCase();
    const last = hit.list.filter(a => a.ts <= T).pop() || hit.list[hit.list.length - 1]; setPlaying(false); flyToAgent(hit.a, last); return "FOUND · " + hit.a.short.toUpperCase() + " · " + hit.list.length + " ASKS";
  },
  fly: (arg) => { const spec = parseFly(arg); return typeof spec === "string" ? spec : flyTo(spec); },
  cam: (arg, ctx) => {
    const [op, nm, ...more] = ctx.rest.map(x => x.toLowerCase());
    if (!op) return "CAM · " + camLine(camGoal);
    if (op === "list") { const k = Object.keys(cams); return k.length ? "CAMS · " + k.join(" · ").toUpperCase() : "CAMS · NONE SAVED · :cam save <name>"; }
    if (!nm || !/^[\w.-]{1,32}$/.test(nm)) return "CAM · save go rm list · then a name";
    if (op === "save") { cams[nm] = { az: camGoal.az, el: camGoal.el, r: camGoal.r, tx: camGoal.tx, tz: camGoal.tz }; saveCams(); return "CAM · SAVED " + nm.toUpperCase(); }
    if (op === "rm") { if (!cams[nm]) return "CAM · NO " + nm.toUpperCase(); delete cams[nm]; saveCams(); return "CAM · REMOVED " + nm.toUpperCase(); }
    if (op === "go") { const spec = parseFly(`cam ${nm}${more.length ? " over " + more.join(" ").replace(/^(over|in)\s+/, "") : ""}`); return typeof spec === "string" ? spec : flyTo(spec); }
    return "CAM · save go rm list";
  },
  mesh: (arg, ctx) => {
    const fast = ctx.e && ctx.e.shiftKey ? 4 : 1;
    if (arg === "left") meshCam.yawG += 0.15 * fast; else if (arg === "right") meshCam.yawG -= 0.15 * fast;
    else if (arg === "up") meshCam.pitchG = clamp(meshCam.pitchG + 0.1, 0.12, 1.5); else if (arg === "down") meshCam.pitchG = clamp(meshCam.pitchG - 0.1, 0.12, 1.5);
    else if (arg === "in") meshCam.zoom = clamp(meshCam.zoom * 1.12, 0.5, 2.5); else if (arg === "out") meshCam.zoom = clamp(meshCam.zoom / 1.12, 0.5, 2.5);
    else { meshCam.yawG = 0.6; meshCam.pitchG = 0.95; meshCam.zoom = 1; }
    return "";
  },
  lift: (arg) => { if (onOff(arg, lift) !== lift) toggleLift(); return ""; },
  cluster: () => { cycleSpread(); return ""; },
  lens: (arg) => { setLens(LENSES.includes(arg) ? arg : LENSES[(LENSES.indexOf(lens) + 1) % LENSES.length]); return ""; },
  filters: (arg) => { if (onOff(arg, filtersOpen) !== filtersOpen) toggleFilters(); return ""; },
  chatter: (arg) => { setChatter(onOff(arg, chatter)); return ""; },
  // the LIVE ORDER chip as a verb: fixed holds the week's lane order, so a close camera isn't swept by re-ranking lanes
  order: (arg) => { liveOrder = arg === "live" ? true : arg === "fixed" ? false : !liveOrder; restackAt = 0; renderViews(); return liveOrder ? "LIVE ORDER · BUSIEST AT THE CENTRE" : "LIVE ORDER · OFF · THE WEEK'S ORDER"; },
  roster: (arg) => { if (!arg || arg !== rosterView) toggleRosterView(); return ""; },
  // the window ladder: :window 4h · wider · off · alone says what's open
  window: (arg) => {
    if (!arg) return win ? `WINDOW · ${win.R.label} · ANCHOR ${win.at} ${dayTag(win.b)} ${hhmm(win.b)} · ${win.calls.toLocaleString("en-US")} CALLS · ${win.nAsks} ASKS` : "WINDOW · OFF · :window 1m 5m 30m 4h 24h all";
    const r = parseRung(arg, rung); if (r == null) return "WINDOW · live 5m 30m 4h 24h all · wider · narrower · off";
    return setRung(r);
  },
  lane: (arg) => {
    if (arg === "all" || !arg) { lanes.forEach(l => { l.solo = false; l.off = false; }); applyMask(); paintLanes(); return "LANES · ALL"; }
    const l = lanes.find(x => x.name.toLowerCase().includes(arg)); if (!l) return "NO LANE MATCHES " + arg.toUpperCase();
    lanes.forEach(x => x.solo = false); l.solo = true; select({ type: "lane", lane: l }); applyMask(); paintLanes(); return "SOLO · " + l.name.toUpperCase();
  },
  solo: (arg) => {
    if (arg === "off" || arg === "all") { setSoloHost(null); lanes.forEach(l => l.solo = false); applyMask(); return "SOLO · OFF"; }
    const m = arg.match(/^(host|machine)\s+(.+)$/); if (!m) return "SOLO · host <name> · off";
    const q = m[2].trim(), hn = x => (x.host || "").toLowerCase(), pn = x => (x.name || "").toLowerCase();
    const hh = D.hosts.find(x => hn(x) === q || pn(x) === q) || D.hosts.find(x => hn(x).includes(q) || pn(x).includes(q));
    if (!hh) return "NO MACHINE MATCHES " + q.toUpperCase();
    setSoloHost(hh.host || hh.name); return "SOLO · " + hostLabel(hh.host || hh.name).toUpperCase();
  },
  select: (arg, ctx) => {
    const verb = ctx.verb === "open" ? "open" : "select";
    if (verb === "select" && (arg === "off" || arg === "none")) { codePin = null; select(null); paintCode(); return "SELECT · OFF"; }
    const m = arg.match(/^(worktree|wt)\s+(.+)$/); if (!m) return verb === "select" ? "SELECT · worktree <name> · off" : "OPEN · worktree <name>";
    const q = m[2].trim(), wt = WTS.find(x => x.name.toLowerCase() === q) || WTS.find(x => x.name.toLowerCase().includes(q));
    if (!wt) return "NO WORKTREE MATCHES " + q.toUpperCase();
    codePin = wt; select({ type: "worktree", wt });
    if (verb === "open") { openInspector({ type: "worktree", wt }); return "WORKTREE · " + wt.name.toUpperCase(); }
    setFocus("v"); paintCode(); return "SELECT · WORKTREE " + wt.name.toUpperCase() + (wt.t0 > T ? " · NOT CUT YET AT THIS POINT" : "");
  },
  // where the world comes from: playback of the recorded span, or real time from our machines or only OTLP exporters
  // (week and live still name the first two)
  source: (raw) => {
    const arg = SOURCE_ALIAS[raw] || raw;
    if (!arg) return `SOURCE · ${SOURCE_LABEL[SRC]} · :source playback realtime otlp`;
    if (!SOURCES.includes(arg)) return "SOURCE · playback realtime otlp";
    if (arg === SRC) return `SOURCE · ${SOURCE_LABEL[arg]} · ALREADY`;
    if (!opts.onSource) return "SOURCE · THIS PAGE CAN'T SWITCH";
    const st = state(); setTimeout(() => opts.onSource(arg, st), 0);   // the page remounts after this line returns
    return `SOURCE · ${SOURCE_LABEL[arg]}`;
  },
  // :theme is the shape; a palette name (an old line, a film's wmrun) still lands on :palette
  theme: (arg) => { if (arg && isTheme(arg)) return applyTheme(arg, true); if (arg && arg !== "next" && !isStyle(arg)) return "THEME · panels hairline"; return applyStyle(arg && arg !== "next" ? arg : nextStyle(styleId), true); },
  palette: (arg) => { if (arg && arg !== "next" && !isTheme(arg)) return "PALETTE · paper linen ember dusk scout"; return applyTheme(arg && arg !== "next" ? arg : nextTheme(themeId), true); },
  // trouble: :errors dims the world to what failed or is stuck · N / ⇧N fly to the next / previous · :stuck sets the threshold
  errors: (arg) => setErrors(onOff(arg, errorsOn)),
  trouble: (arg) => stepTrouble(arg === "prev" ? -1 : 1),
  stuck: (arg) => { if (!arg) return `STUCK > ${stuckLabel()} · STALE AFTER ${stuckLabel(staleMs)} · ${trouble.stuck.length} NOW · :stuck ${STUCK_CHOICES.map(c => c[0]).join(" ")} [24h]`; const v = parseStuckArgs(arg); if (!v) return "STUCK · 10m 30m 1h · then a horizon, like :stuck 30m 24h"; return setStuck(v.ms, v.horizon); },
  guides: (arg) => setGuides(onOff(arg, guidesOn)),
  tally: (arg) => { tallyMode = arg === "inline" ? "inline" : arg === "foot" ? "foot" : tallyMode === "foot" ? "inline" : "foot"; tallyHTML = ""; paintTally(); return "TALLY · " + tallyMode.toUpperCase(); },
  open: (arg, ctx) => {
    if (/^(worktree|wt)\s/.test(arg)) return HANDLERS.select(arg, { ...ctx, verb: "open" });
    // the key: the first press pauses into a slice, the next opens it; open, it focuses the inspector
    if (ctx.key) { if (insp.hidden) { if (playing) setPlaying(false); else openInspector({ type: "slice" }); } else setFocus("x"); return ""; }
    if (playing) setPlaying(false); openInspector({ type: "slice" }); return "INSPECTOR · " + dayTag(T) + " " + hhmm(T);
  },
  zero: () => { zeroIn(); return focusWork ? "ZERO IN · " + focusWork.a.tg.short.toUpperCase() : ""; },
  linked: (arg) => { if (!focusWork) return "LINKED · ZERO IN FIRST (Q)"; stepWork(arg === "prev" ? -1 : 1); return ""; },
  back: () => {
    if (!pv.hidden) { hidePreview(); return "BACK · PREVIEW CLOSED"; }
    if (!insp.hidden) { inspBack(); return "BACK"; }
    setFocus(null); return "BACK · GLOBAL";
  },
  close: () => {
    if (psStage) { psClose(); return ""; }
    if (frozen && frozen.talk) { frozen.talk = null; frozen.lit = null; paintFz(); return ""; }
    if (!pv.hidden && (pvPinned || focus === "x" || focus === "s")) { hidePreview(); return ""; }
    if (focus === "x") { closeInspector(); return ""; }
    if (focus === "s") { hideStash(); return ""; }
    if (!focus && focusAgent) return setFocusAgent(null);
    setFocus(null); return "";
  },
  preview: (arg, ctx) => previewKey("p") ? "" : ctx.key ? false : "OPEN A FILE FIRST · Q TO ZERO IN",
  external: (arg, ctx) => previewKey("o") ? "" : ctx.key ? false : "OPEN A FILE FIRST · Q TO ZERO IN",
  stash: (arg) => {
    if (arg === "add") return previewKey("s") ? "" : "OPEN A FILE FIRST · Q TO ZERO IN";
    if (arg === "show" || (!arg && stashEl.hidden)) showStash(); else hideStash();
    return "";
  },
  focus: (arg) => {
    if (arg === "none") { setFocus(null); return ""; }
    if (arg === "next" || arg === "prev") { const P = panelsNow(), i = P.indexOf(focus); setFocus(P[(i + (arg === "prev" ? -1 : 1) + P.length) % P.length]); return ""; }
    const p = { k: "c", t: "h", p: "q", r: "v" }[arg] || arg;
    if (p === "x" && insp.hidden) return "INSPECTOR CLOSED · I OPENS IT";
    setFocus(p); return "";
  },
  down: (arg, ctx) => nav("down", ctx),
  up: (arg, ctx) => nav("up", ctx),
  right: (arg, ctx) => nav("right", ctx),
  left: (arg, ctx) => nav("left", ctx),
  enter: (arg, ctx) => nav("enter", ctx),
  remove: (arg, ctx) => nav("remove", ctx),
  asks: (arg) => {
    const r = rosterCache[rosterSel]; if (!r) return "ASKS · PICK AN AGENT IN THE ROSTER (B)";
    const list = rosterAll.find(x => x.a === r.a).list;
    const t = arg === "next" ? list.find(a => a.ts > T + 1) : [...list].reverse().find(a => a.ts < T - 1);
    if (!t) return r.a.short.toUpperCase() + " · NO MORE ASKS";
    setT(t.ts); paintRoster(); return r.a.short.toUpperCase() + " · " + dayTag(t.ts) + " " + hhmm(t.ts);
  },
  tour: (arg) => {
    if (!arg) return tour ? `TOUR · ${tour.name.toUpperCase()} · ${Math.round((performance.now() - tour.t0) / 1000)}S OF ${Math.round(tour.length)}S` : "TOUR · :tour <name> · :tour stop";
    return arg === "stop" ? stopTour() : loadTour(arg);
  },
  recap: (arg) => runRecap(arg),
  help: (arg) => { toggleHelp(true, arg); return ""; },
  commands: () => { openCmd(); return ""; },
};
/* /handlers */
const psWords = ctx => ctx && !ctx.key ? (ctx.rest || []).join(" ").trim() : "";
const MISSING = COMMANDS.filter(c => typeof HANDLERS[c.id] !== "function").map(c => c.id);
if (MISSING.length) console.error("world-modale · commands without a handler: " + MISSING.join(", "));

// a key: the first binding along the active scopes whose handler takes it (false falls through)
function onKey(e) {
  if (e.key === "Alt" && !e.repeat && !e.metaKey && !e.ctrlKey && psOn && (psSel || psPoint || frozen) && !psEditing) { flash(psSpeak(true)); e.preventDefault(); return; }
  if (psEl.contains(document.activeElement)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$("help").hidden) { if (document.activeElement === $("helpQ")) return; if (e.key === "Escape" || e.key === "?") { toggleHelp(false); e.preventDefault(); } return; }
  if (hints && hintKey(e)) { e.preventDefault(); return; }
  if (chord && chordKey(e)) { e.preventDefault(); return; }
  runKey(e);
}
function runKey(e) {
  const sig = keySig(e);
  for (const scope of activeScopes()) {
    const hit = KEYMAP[scope] && KEYMAP[scope][sig]; if (!hit) continue;
    // Z X turn · C V zoom act while held (the frame loop reads `held`); ":" runs them once
    if (hit.bind.hold) { held.add(e.key.toLowerCase()); heldFast = e.shiftKey; e.preventDefault(); return; }
    const h = HANDLERS[hit.cmd.id]; if (!h) continue;
    const out = h(hit.bind.arg || "", { e, key: true, scope, verb: hit.cmd.names[0], rest: hit.bind.arg ? hit.bind.arg.split(" ") : [] });
    if (out === false) continue;
    if (out) flash(out);
    e.preventDefault(); return;
  }
}
on(window, "keyup", e => { if (e.key !== "Alt") return; if (frozen && frozen.listening) { fzListen(false); return; } if (psStage === "speak") { const out = psSpeak(false); if (out) flash(out); } }, true);
on(window, "blur", () => { if (psStage === "speak") psSpeak(false); if (frozen && frozen.listening) fzListen(false); });
// capture phase: the app shell binds letters too; keys the HUD handles stop here — unless you're typing somewhere else
const typingElsewhere = () => { const a = document.activeElement; return !!a && a !== document.body && !root.contains(a) && (a.matches("input, textarea, select, [contenteditable=''], [contenteditable='true']")); };
on(window, "keydown", e => { if (!root.isConnected || typingElsewhere() || (opts.keyGate && opts.keyGate(e))) return; poke(); if (document.activeElement === $("cmd")) return; onKey(e); if (e.defaultPrevented) e.stopImmediatePropagation(); }, true);

/* ":" — a line in the registry's grammar runs here; anything else is words for whoever mounted us */
function runCmd(s) {
  const line = String(s || "").trim().replace(/^:/, "").trim();
  if (!line) return "";
  const p = parseLine(line);
  if (!p) return "UNKNOWN · " + line.split(/\s+/)[0].toUpperCase() + " · press ? for commands";
  const h = HANDLERS[p.cmd.id]; if (!h) return "NO HANDLER · " + p.cmd.id.toUpperCase();
  const out = h(p.arg, { verb: p.verb, raw: p.raw, rest: p.raw.split(/\s+/).slice(1), key: false });
  if (out === false) return `${p.cmd.names[0].toUpperCase()} · NOTHING HERE TO ${p.cmd.names[0].toUpperCase()} · FOCUS A PANEL FIRST`;
  return typeof out === "string" ? out : "";
}

/* Find uses the same footer input and palette sheet as commands, with a frozen playhead snapshot. */
let findRenderedRows = null, findPageStart = -1;
let findMode = false, findIndex = [], findRows = [], lastFind = null, lastFindPos = -1, findBefore = null;
function findSnapshot() {
  scanTrouble();
  const docs = [], order = new Map([...trouble.stuck, ...trouble.failed].map((o, i) => [o, i]));
  const place = (lane, host) => [lane?.name, host ? hostLabel(host) : [...(LANE_HOSTS.get(lane) || [])].map(hostLabel).join(", ")].filter(Boolean).join(" · ");
  const state = o => trouble.stuck.includes(o) ? "stuck" : isFailed(o, T) ? "failed" : o.ts <= T && (o.done == null || o.done > T) ? "running" : "done";
  const stateLabel = (o, st) => st === "stuck" ? "STUCK " + dur(T - o.ts).toUpperCase() : st === "running" ? "IN FLIGHT" : st.toUpperCase();
  const workDoc = (o, id) => { const st = state(o), host = o.tg ? actorHost(o.tg) : null;
    return { id, kind: o.kind === "msg" ? "MESSAGE" : "ASK", name: o.task || troubleWhat(o) || "—", target: workTarget(o),
      text: [o.rq ? spoken(o.rq) : "", o.rq?.tag?.replace(/[ -]/g, "") || "", o.tg ? spoken(o.tg) : o.toName || "", o.tg?.tag?.replace(/[ -]/g, "") || "", o.err || ""],
      state: st, stateLabel: stateLabel(o, st), where: place(troubleLane(o), host), time: o.done && o.done <= T ? o.done : o.ts, troubleOrder: order.get(o) }; };
  asks.forEach((a, i) => { if (a.ts <= T) docs.push(workDoc(a, "ask:" + i)); });
  // scanTrouble already collapsed broadcast deliveries; use exactly its representatives and order.
  [...trouble.stuck, ...trouble.failed].filter(o => o.kind === "msg").forEach((o, i) => docs.push(workDoc(o, "delivery:" + i)));
  actors.filter(a => a.kind !== "person").forEach(a => {
    const work = (rosterAll.find(r => r.a === a)?.list || []).filter(o => o.ts <= T), latest = work[work.length - 1];
    docs.push({ id: "agent:" + a.id, kind: "AGENT", name: spoken(a), agent: a, target: { type: "agent", agent: a },
      text: [a.id, a.short, a.full, a.name || "", a.tag?.replace(/[ -]/g, "") || ""],
      where: place(laneFor(a), actorHost(a)), time: latest?.ts || T0 });
  });
  sessions.filter(se => se.t0 <= T).forEach(se => {
    const work = (askBySess.get(se.i) || []).filter(o => o.ts <= T), a = work.find(o => trouble.stuck.includes(o)) || work[work.length - 1], agent = a?.tg, st = a ? state(a) : null;
    docs.push({ id: "session:" + se.i, kind: "SESSION", name: [agent ? spoken(agent) : se.lane?.name, se.h, se.sid].filter(Boolean).join(" · "),
      target: { type: "session", s: se }, text: [se.h, se.lane?.name || "", se.title || "", agent?.tag?.replace(/[ -]/g, "") || ""], state: st, stateLabel: st ? stateLabel(a, st) : "",
      where: place(se.lane, sessHostOf(se.i)), time: Math.min(T, se.t1) });
  });
  lanes.forEach(lane => docs.push({ id: "lane:" + lane.key, kind: "LANE", name: lane.name, target: { type: "lane", lane },
    text: [lane.key, ROOTS[lane.key]?.[1] || ""], where: [...(LANE_HOSTS.get(lane) || [])].map(hostLabel).join(", "), time: T0 }));
  WTS.filter(wt => wt.t0 <= T).forEach(wt => docs.push({ id: "worktree:" + wt.root, kind: "WORKTREE", name: wt.name, target: { type: "worktree", wt },
    text: [wt.branch, wt.root], where: place(wt.lane, pathHost(wt.root)), time: Math.min(T, wt.t1) }));
  PRS.filter(p => p.t0 <= T).forEach(p => docs.push({ id: "pr:" + p.repo + ":" + p.num, kind: "PR", name: "#" + p.num + " · " + p.title, target: { type: "pr", p },
    text: [String(p.num), p.title, p.branch], stateLabel: prState(p, T).toUpperCase(), where: place(p.wt?.lane || lanes.find(l => repoName(l.key) === repoName(p.repo)), p.wt && pathHost(p.wt.root)), time: p.tm && p.tm <= T ? p.tm : p.t0 }));
  recentFiles(EVT, upToT(), () => true).forEach(e => docs.push({ id: "file:" + e.file, kind: "FILE", name: e.file, path: e.file,
    target: { type: "event", e }, text: [e.file], where: place(e.lane, sessHostOf(e.sess)), time: e.t }));
  D.hosts.forEach(host => docs.push({ id: "host:" + (host.host || host.name), kind: "HOST", name: host.name || host.host, target: { type: "host", host },
    text: [host.host || "", host.platform || ""], where: host.host || "", time: T0 }));
  return buildFindIndex(docs);
}
function openFind(query = "") {
  if (!findMode) {
    findBefore = { cam: { ...cam }, goal: { ...camGoal }, level, follow, T, playing, selection, flight, ride, focus, rosterSel, laneSel, stallSel, slicing, at: performance.now() };
    if (playing) setPlaying(false, false);
    setSlicing(false, false);
    findIndex = findSnapshot();
  }
  findMode = true; palPrev = null; palGroup = null; palMoved = false; palSel = 0;
  $("status").classList.add("cmding"); $("mode").textContent = "FIND"; $("mode").classList.add("cmd");
  $("cmd").previousElementSibling.textContent = "/"; $("cmd").setAttribute("aria-label", "Find in Overview");
  $("cmd").setAttribute("role", "combobox"); $("cmd").setAttribute("aria-controls", "pal"); $("cmd").setAttribute("aria-expanded", "true"); pal.setAttribute("role", "listbox");
  $("cmd").value = query; $("cmd").focus(); paintFind(true);
}
function previewFind() {
  const row = findRows[palSel]; if (!row) return;
  select(row.target); frameTarget(row.target);
}
function paintFind(requery = false) {
  if (requery) { findRows = findResults(findIndex, $("cmd").value); palSel = 0; }
  palSel = clamp(palSel, 0, Math.max(0, findRows.length - 1));
  const start = Math.floor(palSel / 50) * 50, end = Math.min(start + 50, findRows.length);
  // Only the visible page owns DOM. Moving within it updates row states, not the entire result set.
  if (requery || findRenderedRows !== findRows || findPageStart !== start) {
    findRenderedRows = findRows; findPageStart = start;
    pal.innerHTML = `<div class="ph"><span>FIND · ${findRows.length} · ↑↓ PREVIEW · ↵ SELECT</span><span>${findRows.length ? `${start + 1}–${end} · ` : ""}<button class="chip" data-find-page="-1"${start === 0 ? " disabled" : ""}>PREV</button> <button class="chip" data-find-page="1"${end >= findRows.length ? " disabled" : ""}>NEXT</button> · ESC RETURNS</span></div>`
      + findRows.slice(start, end).map((r, k) => { const i = start + k; return `<div class="pr${i === palSel ? " sel" : ""}" data-pi="${i}" id="wm-find-${i}" role="option" aria-selected="${i === palSel}"><span class="pl"><em>${esc(r.kind)}</em> ${esc(r.name)}</span><span class="pd">${esc([r.stateLabel, r.where].filter(Boolean).join(" · "))}</span><span class="pk"></span></div>`; }).join("")
      + (findRows.length ? "" : '<div class="pr hint">No matches</div>');
  } else {
    pal.querySelectorAll("[data-pi]").forEach(el => { const selected = +el.dataset.pi === palSel; el.classList.toggle("sel", selected); el.setAttribute("aria-selected", String(selected)); });
  }
  $("cmd").setAttribute("aria-activedescendant", findRows.length ? `wm-find-${palSel}` : "");
  pal.hidden = false; pal.querySelector(".pr.sel")?.scrollIntoView({ block: "nearest" }); previewFind();
}
function commitFind() {
  const row = findRows[palSel]; if (!row) return;
  lastFind = findRows.slice(); lastFindPos = palSel; findBefore = null;
  closeCmd(); activateTarget(row.target);
}
function cancelFind() {
  const before = findBefore; findBefore = null; closeCmd(); if (!before) return;
  setSlicing(before.slicing, false); setT(before.T); select(before.selection); level = before.level; follow = before.follow; ride = before.ride;
  Object.assign(camGoal, before.goal); Object.assign(cam, before.cam); flight = before.flight; if (flight) flight.t0 += performance.now() - before.at;
  rosterSel = before.rosterSel; laneSel = before.laneSel; stallSel = before.stallSel; applyCam();
  setFocus(before.focus); renderZoomRail(); renderViews(); if (before.playing) setPlaying(true, false);
}
function stepFind(dir) {
  if (!lastFind?.length) return "FIND · NO RESULTS";
  lastFindPos = (lastFindPos + dir + lastFind.length) % lastFind.length;
  const row = lastFind[lastFindPos]; activateTarget(row.target);
  return `FIND · ${lastFindPos + 1}/${lastFind.length} · ${row.kind} · ${row.name}`;
}
function findMenu(e) {
  const el = e.target.closest("[data-pi]"), row = el && findRows[+el.dataset.pi]; if (!row) return;
  const target = row.target; e.preventDefault();
  if (target.type === "ask") askMenu(e.clientX, e.clientY, target.a);
  else if (target.type === "event") { const f = dotFile(target.e); if (f) openMenu(e.clientX, e.clientY, fileHead(f), fileItems(f, askOfEvent(target.e) ? ctxOf(askOfEvent(target.e)) : null)); else eventMenu(e.clientX, e.clientY, target.e); }
  // Other kinds have no View context menu yet. Do not invent actions here.
}

/* the palette: fuzzy verbs with their description and key, argument hints, recent lines first, groups when empty */
const RECENT_KEY = "world-modale.recent";
let recent = [];
try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); if (Array.isArray(r)) recent = r.filter(x => typeof x === "string" && CMD_LINE.test(x)).slice(0, 12); } catch {}
function remember(line) { recent = [line, ...recent.filter(x => x !== line)].slice(0, 12); try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {} }
let palRows = [], palSel = 0, palMoved = false, palGroup = null;
let palPrev = null;   // the view when the palette opened; a find preview moves off it, Esc goes back
function palPreview() {
  const m = $("cmd").value.trim().match(/^(?:find|f)\s+(\S.*)$/i); if (!m || !palPrev) return;
  const q = m[1].trim().toLowerCase(), hit = rosterAll.find(r => nameHit(r.a, q));
  if (!hit || palPrev.who === hit.a) return;
  if (!palPrev.who && playing) setPlaying(false);
  palPrev.who = hit.a; flyToAgent(hit.a, hit.list.filter(a => a.ts <= palPrev.T).pop() || hit.list[hit.list.length - 1]);
  flash("FIND · " + hit.a.short.toUpperCase() + " · ↵ STAYS · ESC FLIES BACK");
}
function palRestore() {
  const b = palPrev; palPrev = null; if (!b || !b.who) return;
  Object.assign(camGoal, b.cam); level = b.level; follow = b.follow; setT(b.T); if (b.playing) setPlaying(true);
  renderZoomRail(); renderViews(); flash("FIND · BACK WHERE YOU WERE");
}
const pal = $("pal");
function paintPal() {
  if (findMode) { paintFind(true); return; }
  const v = $("cmd").value;
  palRows = paletteRows(v, { recent, group: palGroup });
  if (!palMoved) palSel = palRows.length && palRows[0].kind !== "hint" ? 0 : -1;
  palSel = Math.min(palSel, palRows.length - 1);
  const words = v.trim() && !palRows.length;
  const head = palGroup ? `${palGroup.toUpperCase()} · ⌫ ALL GROUPS` : words ? "WORDS · ↵ ASKS THE RESOLVER" : !v.trim() ? (recent.length ? "RECENT · GROUPS" : "GROUPS") : "↑↓ PICK · TAB COMPLETE · ↵ RUN";
  pal.innerHTML = `<div class="ph"><span>${esc(head)}</span><span>ESC CLOSE · ? ALL KEYS</span></div>` + palRows.map((r, i) =>
    `<div class="pr ${r.kind}${i === palSel ? " sel" : ""}" data-pi="${i}"><span class="pl">${esc(r.label)}</span><span class="pd">${esc(r.desc)}</span><span class="pk">${esc(r.keys)}</span></div>`).join("");
  pal.hidden = false;
  const sel = pal.querySelector(".pr.sel"); if (sel) sel.scrollIntoView({ block: "nearest" });
  palPreview();
}
// a palette row → the input: a verb gets its space (and its argument hints), an argument row its whole line
function complete(r) {
  if (!r) return;
  if (r.kind === "group") { palGroup = r.group; $("cmd").value = ""; }
  else if (r.kind === "cmd") { const c = commandFor(r.line); $("cmd").value = r.line + (c && c.tail ? " " : ""); }
  else if (r.line) $("cmd").value = r.line;
  palMoved = false; paintPal();
}
function runLine(line) {
  closeCmd();
  if (!line) return;
  // words that aren't a verb go to whoever mounted us (the app resolves them to verbs), when someone listens
  if (opts.onFreeText && !CMD_LINE.test(line)) { opts.onFreeText(line); return; }
  const out = runCmd(line);
  if (CMD_LINE.test(line) && !/^(UNKNOWN|NO HANDLER)/.test(out)) remember(line);
  // a find/lane whose name matched nothing literally goes to the app too (it fuzzy-matches: "find devin" → devon)
  if (opts.onFreeText && /^NO (AGENT|LANE) MATCHES/.test(out)) opts.onFreeText(line); else flash(out);
}
function palEnter() {
  if (findMode) { commitFind(); return; }
  const v = $("cmd").value.trim(), r = palRows[palSel];
  if (r && r.kind === "group") { complete(r); return; }
  const take = r && r.line && r.kind !== "hint" && (palMoved || (!CMD_LINE.test(v) && (r.strong || r.kind === "recent")));
  if (take) { const l = r.line.trim(); if (CMD_LINE.test(l)) runLine(l); else complete(r); return; }
  runLine(v);
}
function openCmd() { findMode = false; $("cmd").previousElementSibling.textContent = ":"; $("cmd").setAttribute("aria-label", "Command"); palPrev = { cam: { ...camGoal }, level, follow, T, playing, who: null }; $("status").classList.add("cmding"); $("mode").textContent = "COMMAND"; $("mode").classList.add("cmd"); $("cmd").value = ""; palGroup = null; palMoved = false; $("cmd").focus(); paintPal(); }
function closeCmd() { findMode = false; for (const a of ["role", "aria-controls", "aria-expanded", "aria-activedescendant"]) $("cmd").removeAttribute(a); pal.removeAttribute("role"); $("status").classList.remove("cmding"); $("mode").classList.remove("cmd"); pal.hidden = true; $("cmd").blur(); setFocus(focus); }
$("cmd").addEventListener("input", () => { palMoved = false; paintPal(); });
$("cmd").addEventListener("keydown", e => {
  const k = e.key;
  if (findMode) {
    if (k === "Escape") { e.preventDefault(); cancelFind(); return; }
    const delta = k === "ArrowDown" || (e.ctrlKey && k.toLowerCase() === "n") ? 1 : k === "ArrowUp" || (e.ctrlKey && k.toLowerCase() === "p") ? -1 : 0;
    if (delta) { e.preventDefault(); if (findRows.length) { palSel = (palSel + delta + findRows.length) % findRows.length; paintFind(); } return; }
    if (k === "Enter") { e.preventDefault(); commitFind(); return; }
    if (k === "Tab") { e.preventDefault(); return; }
    return;
  }
  if (k === "Escape") { if (palGroup) { palGroup = null; paintPal(); } else { closeCmd(); palRestore(); } e.preventDefault(); return; }
  if (k === "ArrowDown" || k === "ArrowUp") { if (palRows.length) { palSel = (Math.max(palSel, k === "ArrowUp" ? 0 : -1) + (k === "ArrowDown" ? 1 : -1) + palRows.length) % palRows.length; palMoved = true; paintPal(); } e.preventDefault(); return; }
  if (k === "Tab") { complete(palRows[Math.max(0, palSel)]); e.preventDefault(); return; }
  if (k === "Backspace" && !$("cmd").value && palGroup) { palGroup = null; paintPal(); e.preventDefault(); return; }
  if (k === "Enter") { e.preventDefault(); palEnter(); }
});
pal.addEventListener("pointerdown", e => e.preventDefault());   // keep the input focused
pal.addEventListener("click", e => {
  const page = findMode && e.target.closest("[data-find-page]");
  if (page) { if (!page.disabled && findRows.length) { palSel = clamp((Math.floor(palSel / 50) + +page.dataset.findPage) * 50, 0, findRows.length - 1); paintFind(); } return; }
  const row = e.target.closest("[data-pi]"); if (!row) return; palSel = +row.dataset.pi; palMoved = true; palEnter(); });
pal.addEventListener("contextmenu", e => { if (findMode) findMenu(e); });
on(window, "blur", () => { if (!pal.hidden && document.activeElement !== $("cmd")) { if (findMode) cancelFind(); else closeCmd(); } });

/* ================= boot ================= */
(function grain() { const c = document.createElement("canvas"), g = c.getContext("2d"); c.width = 160; c.height = 160; const im = g.createImageData(160, 160); for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); $("grain").style.backgroundImage = `url(${c.toDataURL()})`; })();
function tickClock() { const d = new Date(); $("clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; $("date").textContent = d.toISOString().slice(0, 10) + " · LOCAL"; }
const clockTimer = setInterval(tickClock, 1000); disposers.push(() => clearInterval(clockTimer)); tickClock();

// roster codes: read once at mount; live, again each minute and soon after an agent arrives without one (the runtime
// numbers an agent when it first sees it active). One read at a time; a failed read (a page off the host is refused)
// keeps the names it has.
const ROSTER_URL = opts.rosterUrl || "/api/roster";
let rosterBusy = false, rosterGone = false, rosterNext = null;
function readRoster() {
  if (rosterBusy || rosterGone) return; rosterBusy = true;
  fetch(ROSTER_URL).then(r => r.ok ? r.json() : null).then(list => {
    if (rosterGone || !list) return;
    ROSTER = rosterLabels(list); actors.forEach(named); paintRoster(); paintStalls();
  }).catch(() => {}).finally(() => { rosterBusy = false; });
}
function rosterSoon() { if (LIVE && !rosterNext && !rosterGone) rosterNext = setTimeout(() => { rosterNext = null; readRoster(); }, 5000); }
readRoster();
const rosterTimer = LIVE ? setInterval(readRoster, 60_000) : null;
disposers.push(() => { rosterGone = true; if (rosterTimer) clearInterval(rosterTimer); if (rosterNext) clearTimeout(rosterNext); });

let lastFrame = performance.now(), fps = 60, slow = 0;
/* ================= recap: highlights · lowlights =================
 * recap.ts picks them from the week's own rows (one plain rule per category, captions say what was measured).
 * :recap shows / hides the card · :recap <n> flies to pick n (1–5 highlights, 6–10 lowlights) · :recap play runs the
 * recap tour (a recap.tour in the tours dir wins; otherwise the same tour, built here from these picks). */
let recapData = null, recapOn = false, recapSel = -1, recapErrors = false;
const recapPicks = () => { if (!recapData) recapData = pickRecap(D, 5, { stuckMs, staleMs }); return [...recapData.hi, ...recapData.lo]; };
const attr = s => esc(s).replace(/"/g, "&quot;");
function paintRecap() {
  const el = $("recap"); el.hidden = !recapOn; if (!recapOn) return;
  const r = recapData, list = recapPicks(), cur = list[recapSel];
  const row = (p, k) => `<button class="rr ${p.side}${k === recapSel ? " on" : ""}" data-ri="${k}" title="${attr(p.caption)}"><i>${p.side === "hi" ? "H" + (k + 1) : "L" + (k - r.hi.length + 1)}</i><span class="rc">${CAT_LABEL[p.cat]}</span><b>${esc(p.title)}</b></button>`;
  el.innerHTML = `<div class="rh"><span>RECAP · THE WEEK</span><button data-ri="play" title=":recap play">PLAY</button><button data-ri="hide" title=":recap hide">HIDE</button></div>` +
    `<div class="rs">HIGHLIGHTS</div>` + (r.hi.length ? r.hi.map((p, k) => row(p, k)).join("") : `<div class="none">NOTHING TO PICK IN THIS DATA</div>`) +
    `<div class="rs">LOWLIGHTS</div>` + (r.lo.length ? r.lo.map((p, k) => row(p, r.hi.length + k)).join("") : `<div class="none">NOTHING FAILED OR STUCK</div>`) +
    `<div class="rcap">${cur ? `<small>${cur.side === "hi" ? "HIGHLIGHT" : "LOWLIGHT"} · ${CAT_LABEL[cur.cat]}</small>${esc(cur.caption)}` : `<small>PICK ONE</small>Click a row to fly there · :recap 1–${list.length} · :recap play`}</div>`;
}
$("recap").addEventListener("click", e => {
  const b = e.target.closest("[data-ri]"); if (!b) return;
  const k = b.dataset.ri; flash(runRecap(k === "play" || k === "hide" ? k : String(+k + 1)));
});
function flyToPick(p) {
  setPlaying(false);
  const a = p.ask != null ? asks[p.ask] : null, d = p.dlv != null ? DLV[p.dlv] : null;
  const se = p.sess != null ? sessions[p.sess] : a && a.work ? sessions[a.work.s] : null;
  // lowlights read under :errors; a highlight takes the veil off again only if the recap put it there
  if (p.side === "lo" && !errorsOn) { setErrors(true); recapErrors = true; }
  else if (p.side === "hi" && errorsOn && recapErrors) { setErrors(false); recapErrors = false; }
  setSoloHost(p.cat === "busiest" ? p.host : null);
  setT(p.t);
  const o = a || d, inTrouble = o && (trouble.stuck.includes(o) || trouble.failed.includes(o));
  if (p.side === "lo" && inTrouble) flyToTrouble(o);
  else {
    const lane = (se && se.lane) || (a && (laneFor(a.tg) || laneFor(a.rq))) || (d && (laneFor(d.tg) || laneFor(d.rq))) || null;
    follow = false; flight = null; camGoal.tx = xOf(p.t); if (lane) camGoal.tz = lane.z; level = 2; camGoal.r = LEVELS[2].r; renderZoomRail(); renderViews();
  }
  if (a && p.side === "hi") pick({ type: "ask", a });
}
function runRecap(arg) {
  const list = recapPicks();
  if (!arg) arg = recapOn ? "hide" : "show";
  if (arg === "show") { recapOn = true; paintRecap(); return `RECAP · ${recapData.hi.length} HIGHLIGHTS · ${recapData.lo.length} LOWLIGHTS · :recap 1–${list.length}`; }
  if (arg === "hide") { recapOn = false; recapSel = -1; paintRecap(); if (recapErrors && errorsOn) setErrors(false); recapErrors = false; return "RECAP · HIDDEN"; }
  if (arg === "play") { recapOn = true; paintRecap(); return loadTour("recap"); }
  const n = Number(arg); if (!Number.isInteger(n) || n < 1 || n > list.length) return `RECAP · PICKS RUN 1–${list.length}`;
  recapOn = true; recapSel = n - 1; const p = list[recapSel];
  flyToPick(p); paintRecap();
  return `${p.side === "hi" ? "H" + n : "L" + (n - recapData.hi.length)} · ${CAT_LABEL[p.cat]} · ${p.title.toUpperCase()}`;
}
/* tours: a timed list of ":" lines (tour.ts has the format), fetched by name and played on the frame clock */
function startTour(name, text) {
  const t = parseTour(text, name); if (!t.steps.length) return "TOUR · " + name.toUpperCase() + " HAS NO LINES";
  tour = { ...t, i: 0, t0: performance.now() }; flight = null;
  if (t.quiet) { clearTimeout(flashTimer); flashFull = ""; $("msg").textContent = ""; }   // a quiet tour starts on a clean status line
  renderViews(); tickTour(tour.t0);
  return `TOUR · ${t.name.toUpperCase()} · ${t.steps.length} LINES · ${Math.round(t.length)}S`;
}
function stopTour() { if (!tour) return "TOUR · NONE PLAYING"; const n = tour.name; tour = null; renderViews(); return "TOUR · " + n.toUpperCase() + " · STOPPED"; }
function tickTour(now) {
  const el = tour ? (now - tour.t0) / 1000 : 0;
  while (tour && tour.i < tour.steps.length && tour.steps[tour.i].t <= el) {
    const st = tour.steps[tour.i++], q = tour.quiet;
    tourQuiet = q; let out = "";
    try { out = runCmd(st.line); } catch (err) { console.error("world-modale · tour line " + st.at, err); } finally { tourQuiet = false; }
    if (!q && out) flash(out);
  }
  if (tour && tour.i >= tour.steps.length) { tour = null; renderViews(); }
}
function loadTour(name) {
  if (!/^[\w.-]{1,64}$/.test(name)) return "TOUR · NAMES ARE LETTERS, DIGITS, - _ .";
  fetch(`${API}/world-tour?name=` + encodeURIComponent(name)).then(r => r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? "NOT FOUND" : "HTTP " + r.status)))
    .then(text => { if (!alive) return; const out = startTour(name, text); if (!tour || !tour.quiet) flash(out); })
    .catch(err => {
      if (!alive) return;
      // no recap.tour on disk: play the same tour built from this week's picks (recap.ts writes both)
      if (name === "recap" && String(err.message || err) === "NOT FOUND") { recapPicks(); recapOn = true; paintRecap(); const out = startTour(name, recapTour(recapData)); if (!tour || !tour.quiet) flash(out); return; }
      flash("TOUR · " + name.toUpperCase() + " · " + String(err.message || err).toUpperCase());
    });
  return "TOUR · LOADING " + name.toUpperCase();
}
/* live lanes: whoever is busiest around T takes the centre row; the rest fan out by activity and glide there.
 * A lane already ranked high keeps a 20% edge, so near-ties don't flicker. LIVE ORDER off = the week's fixed order. */
function laneTargets() {
  const h = (T - T0) / 36e5, n = lanes.length;
  const sc = lanes.map(l => {
    let v = 0;
    // with a window open the busiest lane inside the window takes the centre (short windows: the hours around it)
    if (liveOrder && win && win.b - win.a > 2 * 36e5) { for (let hh = Math.floor((win.a - T0) / 36e5); hh <= Math.floor((win.b - T0) / 36e5); hh++) if (hh >= 0 && hh < HOURS) v += l.smooth[hh]; }
    else if (liveOrder) { const hc = win ? ((win.a + win.b) / 2 - T0) / 36e5 : h; for (let k = -5; k <= 5; k++) { const hh = Math.floor(hc) + k; if (hh >= 0 && hh < HOURS) v += l.smooth[hh] * Math.exp(-Math.abs(hh + 0.5 - hc) / 1.6); } }
    return { l, v: v * (1 + 0.2 * (1 - l.rank / n)) };
  });
  sc.sort((a, b) => b.v - a.v || a.l.idx - b.l.idx);
  sc.forEach((x, i) => { x.l.rank = i; x.l.zt = SLOTS[i]; });
}
function restack(dt, now) {
  if (now > restackAt) { restackAt = now + 300; laneTargets(); }
  const k = reduced ? 1 : 1 - Math.pow(0.04, dt / 1000);
  lanes.forEach(l => { l.z += (l.zt - l.z) * k; if (Math.abs(l.zt - l.z) < 0.01) l.z = l.zt; uniforms.uLaneDZ.value[l.idx] = l.z - l.z0; });
}
// lane identity, so a moving lane stays trackable — a study: PLAIN · MARKS · LINES · TINT
const DASHES = [[], [7, 3], [2, 3], [9, 3, 2, 3], [1, 2.5], [14, 4], [4, 4], [2, 2, 7, 2]];
let TINTS = theme.tints.map(t => [t[0], t[1], t[2]]);
let tintMul = theme.tintMul;
function tintCss(i) { const [r, g, b] = TINTS[i % 8]; return `rgb(${Math.round(r * tintMul[0])},${Math.round(g * tintMul[1])},${Math.round(b * tintMul[2])})`; }
function syncTints() {
  TINTS = theme.tints.map(t => [t[0], t[1], t[2]]); tintMul = theme.tintMul;
  TINTS.forEach((t, i) => { if (uniforms.uTint.value[i]) uniforms.uTint.value[i].set(t[0], t[1], t[2]); });
}
syncTints();
function glyph(g, i, x, y, r, col) {
  const k = i % 8, hollow = k >= 4; g.beginPath();
  if (k % 4 === 0) { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
  else if (k % 4 === 1) g.arc(x, y, r * 0.85, 0, Math.PI * 2);
  else if (k % 4 === 2) { g.moveTo(x, y - r); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }
  else g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
  if (hollow) { g.strokeStyle = col; g.lineWidth = HAIR; g.stroke(); } else { g.fillStyle = col; g.fill(); }
}
function applyLaneStyle(name) {
  laneStyle = name; uniforms.uTintOn.value = name === "tint" ? 1 : 0;
  try { localStorage.setItem("world-modale.lanes", name); } catch {}
  renderViews();
}
// drawn on the overlay after the lanes' own labels
function drawLaneIdentity(g, w, h, xc) {
  if (laneStyle === "plain" || laneStyle === "tint") return;
  lanes.forEach(l => {
    if (l.off) return;
    const col = l.solo ? ACC : FG;
    if (laneStyle === "marks") {
      // the lane's mark rides the playhead, so you can watch it change rows
      const p = P(xc, 0, l.z + LANE_MID, w, h); if (!p.vis) return;
      glyph(g, l.idx, p.x, p.y, 4, col);
    } else if (laneStyle === "lines") {
      const a = P(X0, 0, l.z + BAND0 - 0.4, w, h), b = P(xc, 0, l.z + BAND0 - 0.4, w, h); if (!a.vis && !b.vis) return;
      g.save(); g.strokeStyle = col; g.globalAlpha = 0.6; g.lineWidth = HAIR; g.setLineDash(DASHES[l.idx % 8]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.restore();
    }
  });
}
// the mark or line beside each lane's name
function laneLabelMark(g, l, x, y, align, labelW) {
  if (laneStyle === "marks") glyph(g, l.idx, align === "right" ? x - labelW - 9 : x - 9, y, 3, l.solo ? ACC : DIM);
  else if (laneStyle === "lines") { const x0 = align === "right" ? x - labelW : x; g.save(); g.strokeStyle = DIM; g.setLineDash(DASHES[l.idx % 8]); g.beginPath(); g.moveTo(x0, y + 6); g.lineTo(x0 + labelW, y + 6); g.stroke(); g.restore(); }
}

const ART_N = { files: events.filter(e => e.file).length, art: events.filter(e => e.file && ARTIFACT.test(e.file)).length };
function cycleSpread() {
  spread = (spread + 1) % SPREADS.length;
  if (!lift && !floors) { lift = true; }                 // clusters only exist once files leave the ground
  renderViews(); flash(`CLUSTER · ${SPREADS[spread].k.toUpperCase()} · FILES GROUPED BY TYPE`);
}
function setLens(l) {
  lens = l; renderViews();
  flash(l === "all" ? "LENS · EVERYTHING" : l === "sessions" ? "LENS · SESSIONS · NATIVE WORK, NO ASKS" : l === "scout" ? "LENS · SCOUT · ASKS AND THE SESSIONS THAT TOOK THEM" : `LENS · WORKTREES · ${WTS.length} CUT THIS WEEK`);
}
function toggleLift() {
  lift = !lift; if (lift && !show.files) { show.files = true; saveShow(); }
  renderViews(); flash(lift ? `ARTIFACTS UP · ${ART_N.files} FILES OVER THE SESSIONS · U TO DROP` : "ARTIFACTS DOWN");
}
function easeFilters(dt) {
  const k = reduced ? 1 : 1 - Math.pow(0.02, dt / 1000), u = uniforms;
  u.uFloors.value += ((floors ? 1 : 0) - u.uFloors.value) * k;
  u.uLift.value += ((lift ? 1 : 0) - u.uLift.value) * k;
  u.uSpread.value += (SPREADS[spread].v - u.uSpread.value) * k;
  u.uNatDim.value += ((lens === "scout" ? 1 : 0) - u.uNatDim.value) * k;
  u.uScoutDim.value += ((lens === "sessions" ? 1 : 0) - u.uScoutDim.value) * k;
  u.uWtLens.value += ((lens === "worktrees" ? 1 : 0) - u.uWtLens.value) * k;
  u.uShowF.value += ((show.files ? 1 : 0) - u.uShowF.value) * k;
  u.uShowT.value += ((show.tools ? 1 : 0) - u.uShowT.value) * k;
  // the window's fold glides between rungs (World → lanes → Mesh), never a page swap
  const fk = reduced ? 1 : 1 - Math.pow(0.03, dt / 1000), ft = win ? win.R.fold : 0;
  u.uFold.value += (ft - u.uFold.value) * fk; if (Math.abs(ft - u.uFold.value) < 0.002) u.uFold.value = ft;
  u.uWinOn.value = win ? 1 : 0; u.uWinGlow.value = win && win.R.ms != null && win.R.ms <= 30 * 60e3 ? 0.32 : 0;
  if (win) { u.uWinA.value = win.xa; u.uWinB.value = win.xb; }
}
function heldMove(dt) {
  if (!held.size) return;
  flight = null;
  const f = (heldFast ? 3 : 1) * dt / 1000;
  if (held.has("z")) camGoal.az += 0.9 * f; if (held.has("x")) camGoal.az -= 0.9 * f;
  if (held.has("c")) zoomBy(Math.exp(1.2 * f), null); if (held.has("v")) zoomBy(Math.exp(-1.2 * f), null);
  poke();
}
on(window, "keyup", e => { held.delete(e.key.toLowerCase()); heldFast = e.shiftKey; });
on(window, "blur", () => held.clear());

// each painter runs guarded: a throw in one panel logs once and the loop keeps going (it used to stop the world dead)
const failed = new Set();
function safe(name, fn) { if (PERF && PERF.skip.includes(name)) return; const s0 = PERF ? performance.now() : 0; try { fn(); } catch (err) { if (!failed.has(name)) { failed.add(name); console.error(`world-modale · ${name} failed`, err); } } if (PERF) PERF.sec[name] = (PERF.sec[name] || 0) + performance.now() - s0; }
function frame(now) {
  if (alive) rafId = requestAnimationFrame(frame);
  const pf0 = PERF ? performance.now() : 0; if (PERF) { PERF.gap.push(now - lastFrame); perfMouse(now); }
  const dt = Math.min(100, now - lastFrame); lastFrame = now; fps = fps * 0.95 + (1000 / Math.max(1, dt)) * 0.05;
  if (tour) safe("tour", () => tickTour(now));
  if (scrubPointer !== null && scrubX !== null) {
    applyScrub(); drawScrub(); paintReplay(); renderTransport();
  }
  if (playing && !frozen && scrubPointer === null) { if (LIVE) T = Math.min(T1, Date.now()); else {
    T += SPAN * (dt / LOOP_MS) * speed * dirn; const sp = loopSpan();
    if (sp) { if (T > sp[1]) T = sp[0]; else if (T < sp[0]) T = sp[1]; }
    else if (T > T1) T = T0; else if (T < T0) { T = T0; setPlaying(false); }
  } }
  if (LIVE) { liveSlow += dt; if (liveSlow > 1000) { liveSlow = 0; renderLivebar(); if (!reseedAsked && Date.now() > T1 - 10 * 60e3 && opts.live && opts.live.reseed) { reseedAsked = true; opts.live.reseed(); } } }
  uniforms.uCursor.value = xOf(slicing ? sliceStart() + BIN / 2 : T);
  if (rung >= 0) { const pk = win ? win.a + ":" + win.b + win.at : ""; win = winNow(); if (pk !== win.a + ":" + win.b + win.at) renderWinbar(); }
  safe("lanes", () => restack(dt, now)); safe("filters", () => easeFilters(dt)); safe("keys", () => heldMove(dt));
  safe("camera", () => { placeCamera(dt); renderer.render(scene, camera); });
  // Keep the 3D cursor and clock at display cadence. During a drag the
  // historical labels and secondary mesh can sample the moving playhead.
  if (scrubPointer === null || now >= nextScrubDetails) {
    safe("overlay", drawWorldOverlay); safe("mesh", () => drawMesh(dt)); safe("log", () => tickLogStreams(now));
    nextScrubDetails = now + 100;
  }
  safe("flash", tickFlash);
  slow += dt; if (slow > 140) { slow = 0; if (playing && scrubPointer === null) safe("panels", paintSlow); }
  later($("scan"), `${dayTag(T)} ${hhmm(T)}<br>PTS ${totalPts.toLocaleString("en-US").replace(/,/g, " ")}&nbsp;&nbsp; ${Math.round(fps)} FPS`);
  flushLater(now);
  if (PERF) perfTick(performance.now() - pf0);
}
function perfMouse(now) {
  if (!PERF || !PERF.mouse) return; const r = gl.getBoundingClientRect(), a = now / 900;
  gl.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + r.width * (0.5 + 0.32 * Math.cos(a)), clientY: r.top + r.height * (0.55 + 0.25 * Math.sin(a * 1.3)), bubbles: true }));
}
function perfTick(ms) {
  PERF.f.push(ms); const now = performance.now(); if (!PERF.t0) PERF.t0 = now; if (now - PERF.t0 < 10000) return;
  const q = (arr, p) => { const v = [...arr].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(v.length * p))] || 0; };
  const avg = arr => arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length), secs = (now - PERF.t0) / 1000;
  const out = { mode: playing ? "playing" : "paused", mouse: PERF.mouse, frames: PERF.f.length, fps: +(PERF.f.length / secs).toFixed(1),
    drawAvg: +avg(PERF.f).toFixed(2), drawP95: +q(PERF.f, 0.95).toFixed(2), gapP95: +q(PERF.gap, 0.95).toFixed(1), gapMax: +Math.max(0, ...PERF.gap).toFixed(1),
    longTasks: PERF.lt, paintSlowPerS: +(PERF.ps / secs).toFixed(1), roPerS: +(PERF.ro / secs).toFixed(1), $missPerS: +(PERF.miss / secs).toFixed(1),
    dpr: devicePixelRatio, gl: `${gl.width}x${gl.height}`, ov: `${ov.width}x${ov.height}`, view: `${innerWidth}x${innerHeight}`, ms: Object.fromEntries(Object.entries(PERF.sec).map(([k, v]) => [k, +(v / Math.max(1, PERF.f.length)).toFixed(2)])) };
  PERF.log.push(out); (window as any).__wmperf = PERF.log;
  let el = document.getElementById("wmperf"); if (!el) { el = document.createElement("pre"); el.id = "wmperf"; el.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999;margin:0;padding:6px 8px;font:10px/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre-wrap;word-break:break-all;max-width:760px"; document.body.appendChild(el); paintPerfChrome(); disposers.push(() => el.remove()); }
  el.textContent = PERF.log.slice(-2).map(o => JSON.stringify(o)).join("\n");
  Object.assign(PERF, { f: [], gap: [], lt: 0, ps: 0, ro: 0, miss: 0, t0: now, sec: {} });
}
if (PERF && typeof PerformanceObserver !== "undefined") { try { const po = new PerformanceObserver(l => { PERF.lt += l.getEntries().length; }); po.observe({ type: "longtask", buffered: false } as any); disposers.push(() => po.disconnect()); } catch {} }
function relayout() { rowsMeasured.clear(); resizeWorld(); paintSlow(); if (!pv.hidden) placePv(); }
// the shell's sidebars resize, collapse and come back: whatever the columns' size, repaint their canvases to it
if (SLOTTED) {
  let slotRaf = 0;
  const slotRO = new ResizeObserver(() => { cancelAnimationFrame(slotRaf); slotRaf = requestAnimationFrame(() => { if (alive) { paintSlow(); if (pvBig && !pv.hidden) placePv(); } }); });
  SLOT_WRAPS.forEach(w => slotRO.observe(w)); disposers.push(() => { slotRO.disconnect(); cancelAnimationFrame(slotRaf); });
  SLOT_WRAPS.forEach((w, i) => opts.slots.attach(i ? "right" : "left", w));
  disposers.push(() => SLOT_WRAPS.forEach((w, i) => { opts.slots.attach(i ? "right" : "left", null); w.remove(); }));
}
on(window, "resize", relayout);
// inside the app the HUD sits in shell content: a sidebar collapsing resizes it without a window resize
{ let rootRaf = 0, first = true; const rootRO = new ResizeObserver(() => { if (first) { first = false; return; } cancelAnimationFrame(rootRaf); rootRaf = requestAnimationFrame(() => { if (alive) relayout(); }); });
  rootRO.observe(root); disposers.push(() => { rootRO.disconnect(); cancelAnimationFrame(rootRaf); }); }
(document.fonts?.ready || Promise.resolve()).then(() => { if (alive) relayout(); });
applyTheme(themeId, false); applyStyle(styleId, false); renderStash(); applyLaneStyle(laneStyle); applyFold();
// the app turned light or dark: the HUD follows to that mode's treatment (its kept pick, else Paper or Scout); ?theme= still wins
{ let mode = appMode(); const modeMO = new MutationObserver(() => { const next = appMode(); if (!alive || next === mode) return; mode = next; const id = resolveThemeId(next); if (id !== themeId) applyTheme(id, false); });
  modeMO.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scout-theme-mode"] }); disposers.push(() => modeMO.disconnect()); }
setFocus(null); applyMask(); relayout(); if (!playing && opts.restore?.playhead == null) { playing = true; setPlaying(false); } renderTransport();
if (opts.restore) {
  const r = opts.restore;
  if (r.view && VIEWS[r.view]) viewName = r.view;
  if (r.playhead != null) {
    T = clamp(r.playhead, T0, T1);
    if (r.playing !== undefined) {
      setPlaying(r.playing, false);
      setSlicing(r.slicing ?? !r.playing, false);
      if (r.sliceInspector) openInspector({ type: "slice" });
    }
  }
  if (typeof r.rung === "number" && r.rung >= 0 && r.rung < RUNGS.length) setRung(r.rung, true);
  if (r.cam) { flight = null; const c = { az: r.cam.az, el: r.cam.el, r: r.cam.r, tz: r.cam.tz, tx: xOf(clamp(r.cam.t, T0, T1)) }; Object.assign(cam, c); Object.assign(camGoal, c); level = nearestLevel(cam.r); renderZoomRail(); }
  if (r.follow !== undefined) follow = r.follow;
  else if (LIVE) follow = true;
  if (r.direction !== undefined) dirn = r.direction;
  if (r.speed !== undefined) { speed = r.rate !== undefined ? r.rate * LOOP_MS / SPAN : r.speed; $("speed").firstChild.textContent = speedLabel(speed); }
  renderViews();
  if (r.playhead != null) paintSlow();
}
renderLivebar(); rafId = requestAnimationFrame(frame);
// Apply the start link once. Back and range changes resume the current playback.
if (opts.restore?.playhead == null) {
  if (PQ.get("wmgoto")) runCmd("goto " + PQ.get("wmgoto"));
  if (PQ.get("wmplay")) setPlaying(PQ.get("wmplay") === "1");
  if (PQ.get("wmtour")) flash(loadTour(PQ.get("wmtour")));
  if (PQ.get("wmrun")) setTimeout(() => { if (alive) for (const line of String(PQ.get("wmrun")).split(";")) { const out = runCmd(line); if (out) flash(out); } }, 600);
}

/* ================= live: rows as they happen ================= */
// a delta (world-live.ts) is indexed against what this page holds; a gap means a missed message and the page re-seeds
function renderLivebar() {
  const el = $("livebar"); if (!el) return;
  // a film take (?wmtour= on the snapshot week) keeps its frame exactly as recorded: no source control over it
  if (!LIVE && PQ.get("wmtour")) { el.hidden = true; const te = $("tally"); if (te) te.hidden = true; return; }
  const seg = SOURCES.map(s => `<button class="${s === SRC ? "on" : ""}" data-src="${s}"${s === "otlp" ? ' title="Real time, only what OTLP exporters send"' : ""}>${SOURCE_LABEL[s]}</button>`).join("");
  const ago = ms => ms < 1500 ? "NOW" : dur(ms).toUpperCase() + " AGO";
  let state2 = "", hosts = "", line2 = "";
  if (!LIVE) state2 = `<span class="faint">${dayTag(T0)} → ${dayTag(T1)} ${hhmm(T1)}</span>`;
  else {
    const now = Date.now(), behind = now - T;
    // playing IS real time: the playhead is the wall clock every frame (a throttled background tab only lags the paint)
    state2 = playing ? `<b class="on">NOW</b>` : `<b>${dur(behind).toUpperCase()} BACK</b> · <span class="faint">END GOES BACK TO NOW</span>`;
    hosts = LIVE_HOSTS.map(h => {
      const who = esc((h.persona || h.host).toUpperCase());
      if (SRC === "otlp") return `<span>${who} · ${h.lastCall ? "LAST CALL " + ago(now - h.lastCall) : "—"}</span>`;
      if (h.stale) return `<span class="stale" title="${esc(h.error || "")}">${who} · STALE${h.at ? " · " + ago(now - h.at) : h.error ? " · UNREACHABLE" : ""}</span>`;
      return `<span>${who} · ${h.at ? ago(now - h.at) : "…"}</span>`;
    }).join("");
    if (SRC === "otlp" && !EVT.length && !asks.length) line2 = `NOTHING HAS ARRIVED · SEND OTLP/HTTP (JSON OR PROTOBUF) TO <b>${esc(OTLP_URL)}</b>/v1/traces · /v1/logs`;
    else if (SRC === "otlp") line2 = `<span class="faint">ONLY WHAT ARRIVES AT ${esc(OTLP_URL)}</span>`;
  }
  const tally = tallyHTML ? (tallyMode === "foot" ? `<div class="lt${tallyHot ? " hot" : ""}">${tallyHTML}</div>` : `<span class="lt in${tallyHot ? " hot" : ""}">${tallyHTML}</span>`) : "";
  // the foot tally lives in its own corner (top-right of the world); inline stays beside the source control
  const te = $("tally"); if (te) { te.hidden = tallyMode !== "foot" || !tallyHTML; later(te, tallyMode === "foot" ? tally : ""); }
  later(el, `<div class="lr"><span class="seg">${seg}</span>${tallyMode === "inline" ? tally : ""}<span class="ls">${state2}</span><span class="lh">${hosts}</span></div>${line2 ? `<div class="la">${line2}</div>` : ""}`);
}
for (const id of ["livebar", "tally"]) $(id)?.addEventListener("click", e => { const b = e.target.closest("[data-src]"); if (b) flash(runCmd("source " + b.dataset.src));
  // a tally number: :errors on, and N then starts from the top (the oldest stuck, else the newest failure) — nothing flies yet
  const t = e.target.closest("[data-tally]"); if (t) { select(null); flash(setErrors(true) + (t.dataset.tally === "stuck" && trouble.stuck.length ? " · N → THE OLDEST" : "")); } });
function liveStatus(st) { if (!LIVE || !st || !Array.isArray(st.hosts)) return; LIVE_HOSTS = st.hosts; renderLivebar(); }
function growEvArrays(n) {
  if (n * 3 <= evPos.length) return;
  let cap = Math.max(1024, evPos.length / 3); while (cap < n) cap *= 2;
  const g3 = a => { const t = new Float32Array(cap * 3); t.set(a); return t; };
  evPos = g3(evPos); evPos2 = g3(evPos2); evCtr = g3(evCtr); evPos3 = g3(evPos3);
  const et = new Float32Array(cap); et.set(evEt); evEt = et;
  const hk = new Int16Array(cap).fill(-1); hk.set(evHostK); evHostK = hk;
}
// the GPU side doubles too: a new geometry with the old attributes copied in, swapped under the same Points
function growEvGeo(need) {
  if (need <= evCap) return;
  let cap = Math.max(evCap, 1024); while (cap < need) cap *= 2;
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(evGeo.attributes)) { const a = evGeo.getAttribute(name), t = new Float32Array(cap * a.itemSize); t.set(a.array); g.setAttribute(name, new THREE.Float32BufferAttribute(t, a.itemSize)); }
  g.setDrawRange(0, evCount); const old = evGeo; evGeo = g; evPoints.geometry = g; old.dispose(); evCap = cap;
}
function appendLive(d) {
  if (!LIVE || !d) return false;
  // a machine the seed didn't know needs its own band: that takes a fresh layout, so the page re-seeds
  if (d.teamHosts && d.teamHosts.length) return "reseed";
  if (d.strBase !== STR.length || d.actorBase !== actors.length || d.sessBase !== sessions.length || d.askBase !== asks.length) return "reseed";
  if (d.dlvBase != null && d.dlvBase !== DLV.length) return "reseed";
  const now = Date.now();
  for (const x of d.strs) STR.push(x);
  for (const a of d.actors) { const n = named({ ...a }); actors.push(n); if (!n.tag && n.kind !== "person") rosterSoon(); }
  d.sessions.forEach(([sid, h, root], k) => {
    const i = sessions.length;
    sessions.push({ i, sid, h, root, turns: [], cum: new Float64Array((HOURS + 1) * 4), colds: [], lane: null, n: 0, native: true, t0: Infinity, t1: -Infinity, title: "—", edits: 0, track: 0 });
    if (D.team && D.team.sessionHost) D.team.sessionHost[i] = d.sessionHost[k];
  });
  for (const [si, sec, ti] of d.turns) { const se = sessions[si]; if (!se) continue; const t = T0 + sec * 1000; se.turns.push({ t, text: STR[ti] }); se.t0 = Math.min(se.t0, t); se.t1 = Math.max(se.t1, t); if (se.title === "—") se.title = STR[ti]; }
  if (d.events.length) {
    growEvArrays(events.length + d.events.length); growEvGeo(evCount + d.events.length);
    const A = n => evGeo.getAttribute(n).array, P = A("position"), P2 = A("pos2"), FL = A("fl"), CT = A("ctr"), NA = A("nat"), WT = A("wt"), CO = A("color"), PS = A("psize"), LA = A("lane"), EI = A("eid"), HS = A("hs"), P3 = A("pos3"), ET = A("et");
    const PZ = (HB_SUB - 0.5) / R3;
    for (const [sec, root, k, sess, name, tgt, file, add, rem] of d.events) {
      const fi = file != null && file >= 0 ? file : -1;
      D.events.push([sec, root, k, sess, name, tgt, fi, add, rem]);   // the raw rows too: slots and recap read D
      const e = { i: events.length, t: T0 + sec * 1000, root: STR[root], k, sess, name: STR[name], tgt: STR[tgt], file: fi >= 0 ? STR[fi] : null, add: add || 0, rem: rem || 0, dl: add != null };
      if (e.file) e.group = groupOf(e.file);
      events.push(e);
      if (ROOTS[e.root]) e.wt = e.root;
      e.lane = laneByKey(normRoot(e.root) || "~");
      if (!e.lane || !KIND[e.k]) continue;
      // the same cells the mount fills: lane → kind band → 20-minute column → stacked cell, and its Mesh twin
      const li = e.lane.idx, bin = clamp(Math.floor((e.t - T0) / BIN), 0, NBIN - 1), band = KIND[e.k].band, j = e.i * 3;
      let key = li * 1e6 + bin * 10 + band, n = cellCount.get(key) || 0; cellCount.set(key, n + 1);
      let layer = Math.floor(n / (COLS * ROWS)), slot = n % (COLS * ROWS);
      e.bin = bin; e.layer = layer;
      evPos[j] = X0 + bin * BIN_W + (slot % COLS + 0.5) * PITCH_X; evPos[j + 1] = 0.3 + layer; evPos[j + 2] = e.lane.z0 + BAND0 + band * BAND_W + 0.3 + (Math.floor(slot / COLS) + 0.5) * PITCH_Z;
      colTop[li][bin] = Math.max(colTop[li][bin], layer + 1); binCount[li][bin]++;
      // FLOORS: a file sits in its file group's band, as the mount places it
      const band2 = e.file ? GROUP_BAND[e.group] : band;
      if (e.file) (GROUP_N[li] ||= FILE_GROUPS.map(() => 0))[e.group]++;
      key = (li * 1e6 + bin * 10 + Math.round(band2 * 1.5)) * 2 + (e.file ? 1 : 0); n = cell2.get(key) || 0; cell2.set(key, n + 1);
      layer = Math.floor(n / (COLS * ROWS)); slot = n % (COLS * ROWS);
      evPos2[j] = X0 + bin * BIN_W + (slot % COLS + 0.5) * PITCH_X; evPos2[j + 1] = 0.3 + layer; evPos2[j + 2] = e.lane.z0 + BAND0 + band2 * BAND_W + 0.3 + (Math.floor(slot / COLS) + 0.5) * PITCH_Z;
      evCtr[j] = X0 + bin * BIN_W + COLS * PITCH_X / 2; evCtr[j + 2] = e.lane.z0 + BAND0 + band2 * BAND_W + 0.3 + ROWS * PITCH_Z / 2;
      const host = sessHostOf(e.sess), m = (host && MESH_BY.get(host)) || MESH_HOSTS.find(x => !x.host) || MESH_HOSTS[0];
      if (m) {
        evHostK[e.i] = m.k; m.n++;
        const k3 = (m.k * 64 + li) * NBIN + bin, n3 = cell3.get(k3) || 0; cell3.set(k3, n3 + 1);
        const l3 = Math.floor(n3 / (COLS * R3)), s3 = n3 % (COLS * R3);
        evPos3[j] = X0 + bin * BIN_W + (s3 % COLS + 0.5) * PITCH_X; evPos3[j + 1] = 0.3 + l3; evPos3[j + 2] = m.z0 + li * HB_SUB + 0.25 + (Math.floor(s3 / COLS) + 0.5) * PZ;
      } else { evPos3[j] = evPos[j]; evPos3[j + 1] = evPos[j + 1]; evPos3[j + 2] = evPos[j + 2]; }
      evEt[e.i] = xOf(e.t);
      // its slot on the GPU
      const g = evCount++, top = colTop[li][bin], lift = top > 1 ? 0.75 + 0.25 * (e.layer / top) : 1;
      e.gi = g;
      P.set(evPos.subarray(j, j + 3), g * 3); P2.set(evPos2.subarray(j, j + 3), g * 3); P3.set(evPos3.subarray(j, j + 3), g * 3);
      CT[g * 3] = evCtr[j]; CT[g * 3 + 1] = 0; CT[g * 3 + 2] = evCtr[j + 2];
      FL[g] = e.file ? (ARTIFACT.test(e.file) ? 3 : 1) : 0; NA[g] = sessions[e.sess] && !sessions[e.sess].native ? 0 : 1; WT[g] = e.wt ? 1 : 0;
      CO[g] = KIND[e.k].b * lift; PS[g] = KIND[e.k].s; LA[g] = li; EI[g] = e.i; HS[g] = soloHost && host === soloHost ? 1 : 0; ET[g] = evEt[e.i];
      // every index the panels read
      const hr = Math.floor((e.t - T0) / 36e5); if (hr >= 0 && hr < HOURS) e.lane.smooth[hr]++; e.lane.events++;
      if (!sessEvents.has(e.sess)) sessEvents.set(e.sess, []); sessEvents.get(e.sess).push(e);
      if ((e.k === "e" || e.k === "r") && e.tgt && /[./]/.test(e.tgt) && !/\s/.test(e.tgt)) { if (!fileEvents.has(e.tgt)) fileEvents.set(e.tgt, []); fileEvents.get(e.tgt).push(e); }
      const se = sessions[e.sess];
      if (se) { se.n++; se.t0 = Math.min(se.t0, e.t); se.t1 = Math.max(se.t1, e.t); if (!se.lane) se.lane = e.lane; if (e.k === "e") se.edits++; if (se.title === "—") se.title = `${e.name} ${e.tgt || ""}`; }
      const at = EVT_T.length && e.t < EVT_T[EVT_T.length - 1] ? lowerBound(EVT_T, e.t + 1) : EVT_T.length;
      EVT.splice(at, 0, e); EVT_T.splice(at, 0, e.t);
      if (e.t > LAST_EVENT) LAST_EVENT = Math.min(T1, e.t);
      if (LIVE.wall && e.t >= LIVE.wall - 1000) { const hk = host || "?", l = liveLat.get(hk) || []; l.push(now - e.t); if (l.length > 200) l.shift(); liveLat.set(hk, l); }
    }
    for (const name of Object.keys(evGeo.attributes)) evGeo.getAttribute(name).needsUpdate = true;
    evGeo.setDrawRange(0, evCount); totalPts = events.length + scaffoldCount;
  }
  // asks: new ones arrive in order; their arcs, the log and the roster read them from here on
  for (const wire of d.asks) {
    const i = asks.length, a = askOf(wire, i), ts = a.ts;
    if (!a.tg) continue;
    asks.push(a); ASK_T.push(Math.max(ts, ASK_T.length ? ASK_T[ASK_T.length - 1] : ts));
    const w = d.work && d.work[i]; if (w) { a.work = w; WORK[i] = w; linked.push(a); viaScout.add(w.s); if (sessions[w.s]) sessions[w.s].native = false; const l = askBySess.get(w.s) || []; l.push(a); askBySess.set(w.s, l); }
    const r = rosterAll.find(x => x.a === a.tg); if (r) r.list.push(a); else rosterAll.push({ a: a.tg, list: [a] });
    const lt = laneFor(a.tg); if (lt) lt.asks++;
    const hn = hostOf(a.tg); hostAsks.set(hn, (hostAsks.get(hn) || 0) + 1);
    logEvents.push({ ts: a.ts, k: "open", a }); if (a.done) logEvents.push({ ts: a.done, k: a.st === "f" ? "fail" : "done", a });
    if (a.done || a.ts) LAST_EVENT = Math.min(T1, Math.max(LAST_EVENT, a.done || a.ts));
  }
  for (const [i, done, st] of d.askUpdates) {
    const a = asks[i]; if (!a || a.done) continue;
    a.done = done || now; a.st = st; if (a.work) a.work.t1 = a.done;
    logEvents.push({ ts: a.done, k: st === "f" ? "fail" : "done", a });
  }
  // trouble: failed tool calls (kept in time order), undelivered messages, and the ones that finished since
  for (const r of d.errs || []) { const n0 = ERRS.length; addErr(r); const e = ERRS[n0]; if (n0 && e.t < ERRS[n0 - 1].t) ERRS.sort((x, y) => x.t - y.t); }
  for (const r of d.dlv || []) { addDlv(r); const x = DLV[DLV.length - 1]; if (x.st === "f" && x.done) logEvents.push({ ts: x.done, k: "fail", a: x }); }
  for (const [i, done, st] of d.dlvUpdates || []) { const x = DLV[i]; if (!x || x.done != null) continue; x.done = done || now; x.st = st; if (st === "f") logEvents.push({ ts: x.done, k: "fail", a: x }); }
  if ((d.dlv && d.dlv.length) || (d.dlvUpdates && d.dlvUpdates.length)) { logEvents.sort((x, y) => x.ts - y.ts); logLaneKey = "\u0000"; logCount = -1; }
  if (d.asks.length || d.askUpdates.length) { logEvents.sort((x, y) => x.ts - y.ts); rosterAll.sort((x, y) => y.list.length - x.list.length); logLaneKey = "\u0000"; logCount = -1; }
  sliceCache.key = -1; winCountsKey = ""; paintTicker();
  if (!playing) paintSlow();
  return true;
}
(window as any).__worldLive = { lat: liveLat, get count() { return events.length; } };

  const dispose = () => {
    alive = false; cancelAnimationFrame(rafId);
    disposers.forEach(d => d());
    scene.traverse(o => { o.geometry?.dispose?.(); });
    mat.dispose(); renderer.dispose();
  };
  // the ":" command line, callable from outside (voice, the shell): same verbs, returns what the status line flashed
  const runCommand = (text: string) => { const out = runCmd(String(text || "").trim()); if (out) flash(out); return out; };
  // what the HUD knows right now, for whoever turns words into verbs (the app's voice + natural-language line)
  const state = () => ({
    t: T, from: T0, to: T1, playing, speed, rate: SPEEDS.includes(speed) ? undefined : speed * SPAN / LOOP_MS, direction: dirn, view: viewName,
    slicing, sliceInspector: !insp.hidden && inspStack.at(-1)?.type === "slice",
    roster: rosterAll.map(r => spoken(r.a)), lanes: lanes.map(l => l.name),
    open: focusWork ? "work" : !pv.hidden ? "preview" : !insp.hidden ? "inspector" : null,
    tzOffset: new Date(T).getTimezoneOffset(),
    soloHost, window: rung >= 0 ? RUNGS[rung].k : null, rung, follow, source: SRC,
    theme: themeId, accent: accentChoice.id, errors: errorsOn, stuckMs, trouble: { stuck: trouble.stuck.length, failed: trouble.nFail, ask: trouble.kinds.ask, msg: trouble.kinds.msg, reconciled: trouble.quiet.reconciled, tool: trouble.quiet.tool, stale: trouble.quiet.stale, undeliverable: trouble.quiet.undeliverable, staleMs, oldestMs: trouble.stuck.length ? trouble.t - trouble.stuck[0].ts : null },
    cam: { az: camGoal.az, el: camGoal.el, r: camGoal.r, tz: camGoal.tz, t: tOf(camGoal.tx) }, tour: tour ? { name: tour.name, t: (performance.now() - tour.t0) / 1000, length: tour.length } : null,
  });
  // the brief: what is on screen and around the playhead, in words a model can answer from (world-ask.ts)
  // slots: the week in 10-minute buckets per lane (slots.ts), rebuilt only when the payload has grown
  let slotCache = [], slotKey = "";
  const slotsNow = () => { const k = `${D.events.length}:${(D.errs || []).length}:${D.asks.length}:${(D.colds || []).length}`; if (k !== slotKey) { slotCache = buildSlots(D); slotKey = k; } return slotCache; };
  const brief = () => {
    const at = T, H = 36e5, when = t => `${dayTag(t)} ${hhmm(t)}`, clip = (x, n) => { const v = String(x || "").replace(/\s+/g, " ").trim(); return v.length > n ? v.slice(0, n - 1) + "…" : v; };
    const who = a => a ? spoken(a) : "—";
    const sess = se => {
      const evs = (sessEvents.get(se.i) || []).filter(e => e.t <= at && e.t >= at - 30 * 60e3), kinds = {};
      evs.forEach(e => { const k = (KIND[e.k] || { label: e.k }).label; kinds[k] = (kinds[k] || 0) + 1; });
      const last = [...se.turns].reverse().find(u => u.t <= at);
      return { lane: se.lane ? se.lane.name : null, harness: se.h || null, started: when(se.t0), lastActive: when(Math.min(se.t1, at)), quietFor: dur(Math.max(0, at - Math.min(se.t1, at))),
        callsLast30m: evs.length, kinds, edits: se.edits, viaScoutAsk: !se.native, firstPrompt: clip(se.title, 140), lastPrompt: last ? clip(last.text, 160) : null };
    };
    const tg = psSel || psPoint;
    return {
      now: when(at), week: { from: when(T0), to: when(T1) }, live: SRC !== "week", playing, window: rung >= 0 ? RUNGS[rung].k : "whole week", view: viewName,
      pointedAt: tg && tg.se ? sess(tg.se) : null,
      asksInFlight: asks.filter(a => a.ts <= at && (!a.done || a.done > at)).slice(-10).map(a => ({ from: who(a.rq), to: who(a.tg), task: clip(a.task, 140), openFor: dur(at - a.ts) })),
      asksFinishedLast6h: asks.filter(a => a.done && a.done <= at && a.done >= at - 6 * H).slice(-12).map(a => ({ from: who(a.rq), to: who(a.tg), task: clip(a.task, 120), outcome: a.st === "f" ? "failed" : "done", took: dur(a.done - a.ts), ended: when(a.done) })),
      stuck: trouble.stuck.slice(0, 6).map(o => ({ who: troubleWho(o), what: clip(troubleWhat(o), 120) })),
      failedCount: trouble.nFail,
      sessionsLast2h: sessions.filter(se => se.lane && Number.isFinite(se.t0) && se.t0 <= at && se.t1 >= at - 2 * H).sort((a, b) => b.t1 - a.t1).slice(0, 12).map(sess),
      lanes: lanes.map(l => ({ name: l.name, sessionsLast24h: sessions.filter(se => se.lane === l && se.t0 <= at && se.t1 >= at - 24 * H).length })).filter(l => l.sessionsLast24h),
      agents: rosterAll.slice(0, 16).map(r => spoken(r.a)),
      ...(() => {
        // the strongest moments and the most waste up to the playhead, by rule (slots.ts), for "what stood out" and "where did it burn"
        const seen = slotsNow().filter(x => x.t1 <= at + 6e5), m = x => ({ when: when(x.t0), lane: laneName(normRoot(x.lane)), tier: x.tier, calls: x.calls, edits: x.edits, linesChanged: x.lines, files: x.files, sessions: x.sessions.length, toolErrors: x.errors, asksDone: x.asksDone.length, asksFailed: x.asksFailed.length });
        const waste = seen.filter(x => x.coldTokens || x.repeats >= 3 || x.rereads >= 3).sort((a, b) => (b.coldTokens / 2e4 + b.repeats + b.rereads) - (a.coldTokens / 2e4 + a.repeats + a.rereads)).slice(0, 5);
        return { moments: topSlots(seen, 8).map(m), waste: waste.map(x => ({ when: when(x.t0), lane: laneName(normRoot(x.lane)), coldCacheTokens: x.coldTokens, coldRebuilds: x.colds, repeatedCommands: x.repeats, rereadFiles: x.rereads, calls: x.calls })) };
      })(),
    };
  };
  // voice: while ⌥ is held the host hands what it heard straight to the selection (or the frozen frame)
  const psListening = () => psStage === "speak" || !!(frozen && frozen.listening);
  const psHeard = (text) => { const t = String(text || "").trim(); if (!t) return; if (psStage === "speak") { const v = inferVerb(t); psVerb = v.verb; psText = v.text; paintPs(); } else flash(psHear(t)); };
  return Object.assign(dispose, { select, runCommand, state, appendLive, liveStatus, psHeard, psListening, brief, relayout: () => { if (alive) relayout(); } });
}
