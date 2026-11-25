/**
 * World · SLOTS — the week cut into fixed time buckets per lane, each with plain counts and a rule-based score, kept
 * pure like recap.ts so the HUD, the server and the tests all cut the same slots. A slot is the unit anything smarter
 * (a Jev re-rank, a spoken brief, a tour) works on: built once when the week loads, and in live mode one more slot per
 * lane each time a bucket closes. Nothing here is scored by a model; the score says how much happened, not whether it
 * mattered, and every number in it comes from the payload.
 *
 * SCORE (0–3, the same range a four-level Jev Score returns)
 *   activity  tool calls, log-scaled: 100 calls in a slot is the full 0.8
 *   code      lines changed (log, 1000 lines is the full 0.9) plus a little per distinct file edited
 *   outcome   asks that finished in the slot (+0.4 each, up to 0.8), a failed ask (+1), tool errors (up to 0.6)
 *   spread    three or more sessions at once (+0.3)
 * TIER  by rank in the window, with a floor: must-see top 2% (≥ 2), interesting next 8% (≥ 1.4), notable next 25%
 *        (≥ 0.75), the rest routine
 */

export const SLOT_MS = 10 * 60e3;
export const TIERS = ["routine", "notable", "interesting", "must-see"] as const;
export type SlotTier = typeof TIERS[number];

export type Slot = {
  id: string;          // lane + bucket start, stable across reloads so a grade can be cached against it
  lane: string;        // the workspace root, as the payload names it
  t0: number; t1: number;
  calls: number;
  kinds: Record<string, number>;   // event kind letter → count (e edit, r read, c command, m comms, b browser, w web, o other)
  edits: number; lines: number; files: number;
  sessions: number[];              // indices into D.sessions
  errors: number;
  /** waste, the chess "inaccuracies": cache rebuilt from cold (tokens, how many times), a file read again by the same
   *  session, the same command line run again by the same session (a third run of one line counts twice) */
  coldTokens: number; colds: number; rereads: number; repeats: number;
  asksDone: number[]; asksFailed: number[]; asksOpened: number[];   // indices into D.asks
  score: number; tier: SlotTier;
  /** a cache key over everything the score reads: when it changes, a grade made earlier is stale */
  sig: string;
};

export type SlotData = {
  from: number; now: number; strs: string[];
  events: any[]; asks: any[]; errs?: any[]; colds?: [number, number, number][];
  work?: Record<string, { s: number }>;
};

const log = (n: number, full: number) => Math.min(1, Math.log10(1 + n) / Math.log10(1 + full));

export function scoreSlot(s: Pick<Slot, "calls" | "lines" | "files" | "sessions" | "errors" | "asksDone" | "asksFailed">): number {
  const activity = 0.8 * log(s.calls, 100);
  const code = 0.9 * log(s.lines, 1000) + Math.min(0.3, 0.05 * s.files);
  const outcome = Math.min(0.8, 0.4 * s.asksDone.length) + (s.asksFailed.length ? 1 : 0) + 0.6 * Math.min(1, s.errors / 5);
  const spread = s.sessions.length >= 3 ? 0.3 : 0;
  return Math.round(Math.min(3, activity + code + outcome + spread) * 100) / 100;
}

/** `rank` is the slot's place in the window, 0 best → 1: must-see is the top 2%, interesting the next 8%, notable the
 *  next 25%, and each needs a floor score too, so a quiet week stays mostly routine. */
export function tierOf(score: number, rank = 0): SlotTier {
  if (rank < 0.02 && score >= 2) return "must-see";
  if (rank < 0.10 && score >= 1.4) return "interesting";
  if (rank < 0.35 && score >= 0.75) return "notable";
  return "routine";
}

/** Cut D into slots; `since` (ms) keeps only buckets that start at or after it, for an incremental live pass. */
export function buildSlots(D: SlotData, o: { slotMs?: number; since?: number } = {}): Slot[] {
  const W = o.slotMs || SLOT_MS, T0 = D.from, STR = D.strs || [];
  const by = new Map<string, Slot & { _sess: Set<number>; _files: Set<string>; _seen: Set<string> }>();
  const sessLane = new Map<number, string>();
  const slot = (lane: string, t: number) => {
    const b = Math.floor(t / W) * W, id = `${lane}@${b}`;
    let s = by.get(id);
    if (!s) by.set(id, s = { id, lane, t0: b, t1: b + W, calls: 0, kinds: {}, edits: 0, lines: 0, files: 0, sessions: [], errors: 0,
      coldTokens: 0, colds: 0, rereads: 0, repeats: 0, asksDone: [], asksFailed: [], asksOpened: [], score: 0, tier: "routine", sig: "", _sess: new Set(), _files: new Set(), _seen: new Set() });
    return s;
  };
  for (const [sec, root, k, sess, , tgt, file, add, rem] of D.events) {
    const lane = STR[root] || "?", t = T0 + sec * 1e3, s = slot(lane, t);
    if (!sessLane.has(sess)) sessLane.set(sess, lane);
    // the payload clips targets near 110 chars, so a long line (a cd into a deep path …) can't be told from its neighbours
    const said = tgt != null && tgt >= 0 ? STR[tgt] || "" : "", key = said && said.length < 100 && (k === "r" || k === "c" || k === "s") ? `${k}${sess}:${tgt}` : "";
    if (key) { if (s._seen.has(key)) k === "r" ? s.rereads++ : s.repeats++; else s._seen.add(key); }
    s.calls++; s.kinds[k] = (s.kinds[k] || 0) + 1; s._sess.add(sess);
    if (k === "e") { s.edits++; s.lines += (add || 0) + (rem || 0); const f = file != null && file >= 0 ? file : tgt; if (f != null && f >= 0) s._files.add(STR[f] || String(f)); }
  }
  for (const [sec, sess, n] of D.colds || []) { const lane = sessLane.get(sess); if (lane) { const s = slot(lane, T0 + sec * 1e3); s.colds++; s.coldTokens += n; } }
  for (const [sec, sess] of D.errs || []) { const lane = sessLane.get(sess); if (lane) slot(lane, T0 + sec * 1e3).errors++; }
  D.asks.forEach(([ts, done, st], i) => {
    const w = D.work?.[i], lane = w ? sessLane.get(w.s) : undefined;
    if (!lane) return;
    slot(lane, ts).asksOpened.push(i);
    const end = done || (st === "f" ? ts : null);
    if (end != null) (st === "f" ? slot(lane, end).asksFailed : slot(lane, end).asksDone).push(i);
  });
  const all: Slot[] = [];
  for (const s of by.values()) {
    const { _sess, _files, _seen, ...rest } = s;
    const slotOut: Slot = { ...rest, sessions: [..._sess].sort((a, b) => a - b), files: _files.size };
    slotOut.score = scoreSlot(slotOut);
    slotOut.sig = [slotOut.calls, slotOut.lines, slotOut.files, slotOut.errors, slotOut.sessions.length, slotOut.asksDone.length, slotOut.asksFailed.length, slotOut.asksOpened.length, slotOut.colds, slotOut.rereads, slotOut.repeats].join(".");
    all.push(slotOut);
  }
  // tiers rank against the rest of the window: a busy week shouldn't make everything must-see
  const ranked = [...all].sort((a, b) => b.score - a.score);
  ranked.forEach((s, i) => { s.tier = tierOf(s.score, i / Math.max(1, ranked.length)); });
  const out = o.since != null ? all.filter(s => s.t0 >= o.since!) : all;
  return out.sort((a, b) => a.t0 - b.t0 || a.lane.localeCompare(b.lane));
}

/** The best slots, at most one per lane per `gapMs` so a long burst doesn't fill the list with its own neighbours. */
export function topSlots(slots: Slot[], n = 8, gapMs = 60 * 60e3): Slot[] {
  const out: Slot[] = [];
  for (const s of [...slots].sort((a, b) => b.score - a.score || b.t0 - a.t0)) {
    if (out.some(p => p.lane === s.lane && Math.abs(p.t0 - s.t0) < gapMs)) continue;
    out.push(s); if (out.length >= n) break;
  }
  return out;
}
