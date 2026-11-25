/**
 * World · REMARKS — prepared remarks: a handful of moments from the week, each with a chess mark, one spoken line,
 * where it happened and the one or two things to do about it. Slots (slots.ts) say how much happened; a remark says
 * whether it mattered and what to take from it.
 *
 * Who decides what
 *   rules  shortlist the slots worth grading, keep failures deterministic (a failed ask is never graded up), write
 *          every line from counts. Jev never writes words and never sees a path, a prompt or a file name.
 *   Jev    grades each shortlisted slot with five fixed questions (JEV_QUESTIONS) over a count-only state
 *          (momentState). Without a key, ruleGrade() answers the same five questions from the same counts, so the HUD
 *          and the voice never care which one ran.
 *
 * The five questions
 *   mark   choice  chess annotation: !! brilliant · ! good · !? interesting · ?! dubious · ? mistake · ?? blunder · routine
 *   moment choice  what kind of ten minutes: shipping · exploring · debugging · coordinating · churning · idling
 *   usage  choice  the better-usage tip, if one fits: keep the cache warm · stop re-reading · script the repeats ·
 *                  close the ask · fewer hands · none
 *   track  score   lost → drifting → steady → locked in (momentum, judged against the lane's slots around it)
 *   worth  score   skip → glance → mention → lead with it (how much the operator wants to hear it; ranks the remarks)
 */

import type { Slot } from "./slots.ts";

export const JEV_MODEL = "jev-latest";
export const MARKS = ["brilliant", "good", "interesting", "dubious", "mistake", "blunder", "routine"] as const;
export type Mark = typeof MARKS[number];
export const GLYPH: Record<Mark, string> = { brilliant: "!!", good: "!", interesting: "!?", dubious: "?!", mistake: "?", blunder: "??", routine: "" };
export const MOMENTS = ["shipping", "exploring", "debugging", "coordinating", "churning", "idling"] as const;
export type Moment = typeof MOMENTS[number];
export const USAGES = ["none", "warm-cache", "stop-rereading", "script-repeats", "close-the-ask", "fewer-hands"] as const;
export type Usage = typeof USAGES[number];
/** below this, a choice answer falls back to the rule's own answer */
export const REMARK_CONFIDENCE_FLOOR = 0.5;

const choice = (instructions: string, criteria: Record<string, unknown>) => ({ type: "choice", instructions, criteria });
const score = (instructions: string, criteria: unknown[]) => ({ type: "score", instructions, criteria });

/** The fixed questions, the same for every slot; the state is the only thing that changes. */
export const JEV_QUESTIONS = {
  mark: choice("Annotate these ten minutes of one workspace the way a chess commentator annotates a move. Judge the result for the effort spent, not the effort alone.", {
    brilliant: { what: "An unusually strong stretch: a lot finished cleanly, little waste, an ask closed or many files moved with no errors.", examples: ["two asks finished, 600 lines changed, no errors, no cold rebuilds"] },
    good: { what: "Solid, efficient progress: real edits or finished asks, waste small next to the work.", examples: ["120 lines across 4 files, one ask done"] },
    interesting: { what: "Unusual rather than good or bad: a pattern worth a look, such as many sessions at once, a burst of coordination, a change of direction.", examples: ["five sessions in one lane, mostly messages"] },
    dubious: { what: "Busy but thin: many calls, little to show, some waste; not clearly a mistake.", examples: ["90 calls, 3 lines changed, the same file read four times"] },
    mistake: { what: "Clear waste or a setback: the cache rebuilt from cold, commands run again and again, an ask failed, errors piling up.", examples: ["three cold rebuilds and 400k tokens with no edits", "an ask failed after 40 calls"] },
    blunder: { what: "Heavy waste and a setback together: large cold rebuilds or long repeat loops alongside failures, with nothing finished.", examples: ["five cold rebuilds, 800k tokens, an ask failed, no edits"] },
    routine: { what: "Ordinary work with nothing to say about it.", examples: ["20 calls, a few reads, a small edit"] },
  }),
  moment: choice("What kind of ten minutes was this, judged from the mix of activity?", {
    shipping: "Changing code: edits and lines changed lead.",
    exploring: "Finding things out: reads, searches and web lead, few edits.",
    debugging: "Fixing something: commands and errors lead, edits are small and targeted.",
    coordinating: "Agents talking: asks opened or finished, messages lead.",
    churning: "Going in circles: the same commands or reads again and again, cold rebuilds, little progress.",
    idling: "Very little happened.",
  }),
  usage: choice("Is there one change in how the agents were used that would have saved tokens or time here? Pick the one the evidence supports most; none if nothing stands out.", {
    "none": "Nothing to change; the effort was well spent or there is too little to say.",
    "warm-cache": "The prompt cache was rebuilt from cold; keeping the session alive, or not restarting it, would have saved those tokens.",
    "stop-rereading": "The same files were read again by the same session; keep them in context or summarize them once.",
    "script-repeats": "The same command lines were run again and again; a script, a watch mode or a single check would do.",
    "close-the-ask": "An ask failed or stayed open; it needs an answer, a retry or a handoff.",
    "fewer-hands": "Several sessions worked the same workspace at once and got in each other's way; fewer at a time would do.",
  }),
  track: score("Compared with the slots just before it in the same workspace, how well is this work keeping its direction?", [
    { what: "Lost: activity without progress, repeating itself, errors or failures, no edits or finished asks.", examples: ["the same command eight times, two errors, nothing changed"] },
    { what: "Drifting: progress slowed against the slots before, more reading and retrying than doing.", examples: ["edits fell from 200 lines to 10, rereads rising"] },
    { what: "Steady: about the same pace and kind of work as before.", examples: ["similar calls and edits to the previous slots"] },
    { what: "Locked in: clear progress building on the slots before; edits, finished asks, little waste.", examples: ["third slot in a row of steady edits, an ask finished"] },
  ]),
  worth: score("The operator reviews the week in a few spoken remarks. How much would they want to hear about these ten minutes?", [
    { what: "Skip: routine, nothing to learn or act on.", examples: ["ordinary reads and small edits"] },
    { what: "Glance: mildly notable, fine as a one-liner in a long recap.", examples: ["a busy slot that went as expected"] },
    { what: "Mention: a real outcome or a real lesson: an ask finished, a big change, noticeable waste.", examples: ["two asks closed", "200k tokens rebuilt from cold"] },
    { what: "Lead with it: something to act on or remember: a failure, heavy waste, an unusually strong result.", examples: ["an ask failed after heavy cold rebuilds", "800 lines and three asks done with no errors"] },
  ]),
} as const;

/** a slot plus what the HUD knows that the slot doesn't: the lane's display name and its slots just before */
export type MomentInput = Pick<Slot, "id" | "sig" | "t0" | "t1" | "calls" | "kinds" | "edits" | "lines" | "files" | "errors" | "coldTokens" | "colds" | "rereads" | "repeats" | "score" | "tier"> & {
  laneName: string;
  sessions: number;
  asksOpened: number; asksDone: number; asksFailed: number;
  /** the same lane's previous slots, oldest first, at most three: calls, lines, errors */
  before?: { calls: number; lines: number; errors: number }[];
};

export function momentInput(s: Slot, laneName: string, before: Slot[] = []): MomentInput {
  return {
    id: s.id, sig: s.sig, t0: s.t0, t1: s.t1, calls: s.calls, kinds: s.kinds, edits: s.edits, lines: s.lines, files: s.files,
    errors: s.errors, coldTokens: s.coldTokens, colds: s.colds, rereads: s.rereads, repeats: s.repeats, score: s.score, tier: s.tier,
    laneName, sessions: s.sessions.length, asksOpened: s.asksOpened.length, asksDone: s.asksDone.length, asksFailed: s.asksFailed.length,
    before: before.slice(-3).map(b => ({ calls: b.calls, lines: b.lines, errors: b.errors })),
  };
}

const KIND_WORD: Record<string, string> = { e: "edits", r: "reads", c: "commands", m: "messages", b: "browser", w: "web", o: "other" };
const k = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

/**
 * Exactly what Jev sees for one slot: counts and a few plain-word readings of them (Jev doesn't do arithmetic, so
 * "most calls were reads" is said, not left to divide). No ids, paths, prompts, file names or agent names; the lane
 * is not sent either, since a workspace name is still a name.
 */
export function momentState(m: MomentInput) {
  const mix = Object.entries(m.kinds).sort((a, b) => b[1] - a[1]).map(([kk, n]) => `${KIND_WORD[kk] || kk} ${n}`).join(", ");
  const lead = Object.entries(m.kinds).sort((a, b) => b[1] - a[1])[0];
  const readings: string[] = [];
  if (lead && m.calls >= 10 && lead[1] / m.calls >= 0.5) readings.push(`most calls were ${KIND_WORD[lead[0]] || lead[0]}`);
  if (m.colds) readings.push(`the cache was rebuilt from cold ${m.colds} time${m.colds > 1 ? "s" : ""}, ${k(m.coldTokens)} tokens`);
  if (m.repeats >= 2) readings.push(`the same command lines were run again ${m.repeats} times`);
  if (m.rereads >= 2) readings.push(`files were read again ${m.rereads} times`);
  if (m.asksFailed) readings.push(`${m.asksFailed} ask${m.asksFailed > 1 ? "s" : ""} failed`);
  if (m.asksDone) readings.push(`${m.asksDone} ask${m.asksDone > 1 ? "s" : ""} finished`);
  if (m.calls >= 40 && m.lines < 10 && !m.asksDone) readings.push("many calls, almost nothing changed");
  const prev = m.before || [];
  if (prev.length) {
    const avg = (f: (b: { calls: number; lines: number; errors: number }) => number) => prev.reduce((a, b) => a + f(b), 0) / prev.length;
    const pl = avg(b => b.lines), pc = avg(b => b.calls);
    if (m.lines > 2 * pl + 20) readings.push("far more code changed than in the slots before");
    else if (pl > 2 * m.lines + 20) readings.push("much less code changed than in the slots before");
    if (m.calls > 2 * pc + 10) readings.push("much busier than the slots before");
    else if (pc > 2 * m.calls + 10) readings.push("much quieter than the slots before");
  } else readings.push("the first activity in this workspace for a while");
  return {
    schema: "openscout.world-moment.v1",
    minutes: Math.round((m.t1 - m.t0) / 6e4),
    toolCalls: m.calls, mix,
    edits: m.edits, linesChanged: m.lines, filesEdited: m.files,
    sessions: m.sessions, toolErrors: m.errors,
    asks: { opened: m.asksOpened, finished: m.asksDone, failed: m.asksFailed },
    waste: { coldCacheRebuilds: m.colds, coldCacheTokens: m.coldTokens, commandsRunAgain: m.repeats, filesReadAgain: m.rereads },
    before: prev,
    readings,
  };
}

export function jevMomentRequest(m: MomentInput) {
  return { model: JEV_MODEL, state: momentState(m), questions: JEV_QUESTIONS };
}

export type Grade = {
  mark: Mark; moment: Moment; usage: Usage;
  /** 0–3, fractional when Jev answered */
  track: number; worth: number;
  /** the lowest choice confidence Jev gave, 1 for rules */
  confidence: number;
  by: "jev" | "rules";
};

/** The same five answers from counts alone: the stand-in without a key, and the floor under a weak Jev answer. */
export function ruleGrade(m: MomentInput): Grade {
  const waste = m.coldTokens / 2e4 + m.repeats + m.rereads;
  const did = m.lines + 60 * m.asksDone;
  const lead = Object.entries(m.kinds).sort((a, b) => b[1] - a[1])[0]?.[0];
  const moment: Moment = m.calls < 8 ? "idling"
    : (m.repeats + m.rereads >= 6 || m.colds >= 2) && m.lines < 40 ? "churning"
    : m.asksDone + m.asksOpened + m.asksFailed >= 2 || lead === "m" ? "coordinating"
    : (m.errors >= 3 && m.lines < 300) || (lead === "c" && m.lines < 100) ? "debugging"
    : m.edits >= 3 && m.lines >= 30 ? "shipping" : "exploring";
  const usage: Usage = m.asksFailed ? "close-the-ask"
    : m.coldTokens >= 1e5 ? "warm-cache"
    : m.repeats >= 4 ? "script-repeats"
    : m.rereads >= 4 ? "stop-rereading"
    : m.sessions >= 4 && m.errors >= 2 ? "fewer-hands" : "none";
  let mark: Mark = m.asksFailed && waste >= 10 && !did ? "blunder"
    : m.asksFailed || (waste >= 8 && did < 40) || m.errors >= 10 ? "mistake"
    : waste >= 4 && did < 20 && m.calls >= 30 ? "dubious"
    : m.tier === "must-see" && waste < 3 && !m.errors ? "brilliant"
    : (m.tier === "must-see" || m.tier === "interesting") && waste < 5 ? "good"
    : m.sessions >= 4 ? "interesting" : "routine";
  // a tip means something was spent badly: the mark can't call it good, only "!?" when a lot still got done
  if (usage !== "none" && !BAD.includes(mark)) mark = did >= 200 ? "interesting" : "dubious";
  const prevLines = (m.before || []).reduce((a, b) => a + b.lines, 0) / Math.max(1, (m.before || []).length);
  const track = mark === "blunder" || moment === "churning" ? 0 : mark === "mistake" || (m.before?.length && m.lines < prevLines / 3) ? 1 : did >= 100 && waste < 3 ? 3 : 2;
  const worth = Math.min(3, m.tier === "must-see" ? 3 : m.tier === "interesting" ? 2 : m.tier === "notable" ? 1 : 0) + (mark === "mistake" || mark === "blunder" ? 1 : 0);
  return { mark, moment, usage, track, worth: Math.min(3, worth), confidence: 1, by: "rules" };
}

const pickChoice = <T extends string>(a: any, allowed: readonly T[]): { id: T; p: number } | null => {
  if (!a || typeof a !== "object") return null;
  const id = typeof a.choice === "string" && (allowed as readonly string[]).includes(a.choice) ? a.choice as T : null;
  if (!id) return null;
  const p = typeof a.confidence === "number" ? a.confidence : typeof a.probabilities?.[id] === "number" ? a.probabilities[id] : 0;
  return { id, p };
};
const pickScore = (a: any): number | null => a && typeof a.score === "number" && Number.isFinite(a.score) ? Math.max(0, Math.min(3, a.score)) : null;
const BAD: Mark[] = ["mistake", "blunder"];

/**
 * Jev's answers → a grade, each answer checked; a missing or low-confidence choice keeps the rule's. Failures stay the
 * rules' call: a slot with a failed ask is never marked better than "mistake", nor its usage moved off the ask.
 */
export function readJevGrade(answers: unknown, rules: Grade): Grade {
  const a = (answers && typeof answers === "object" ? answers : {}) as Record<string, unknown>;
  const mark = pickChoice(a.mark, MARKS), moment = pickChoice(a.moment, MOMENTS), usage = pickChoice(a.usage, USAGES);
  const ok = <T,>(c: { id: T; p: number } | null, fb: T) => c && c.p >= REMARK_CONFIDENCE_FLOOR ? c.id : fb;
  let g: Grade = {
    mark: ok(mark, rules.mark), moment: ok(moment, rules.moment), usage: ok(usage, rules.usage),
    track: pickScore(a.track) ?? rules.track, worth: pickScore(a.worth) ?? rules.worth,
    confidence: Math.min(...[mark, moment, usage].map(c => c ? c.p : 0)),
    by: "jev",
  };
  if (BAD.includes(rules.mark) && rules.usage === "close-the-ask") {
    g = { ...g, mark: BAD.includes(g.mark) ? g.mark : rules.mark, usage: "close-the-ask", worth: Math.max(g.worth, rules.worth) };
  }
  return g;
}

/* ---------------- the remark ---------------- */

export type RemarkAction =
  | { kind: "show"; label: string; commands: string[] }   // ":" lines the HUD runs: go there, frame the lane
  | { kind: "ask"; label: string; text: string }          // a question handed to ask-the-World (:tell)
  | { kind: "dismiss"; label: string };
export type Remark = {
  id: string;            // the slot id: one remark per slot
  sig: string;           // the slot sig it was graded at
  lane: string; t0: number; t1: number;
  mark: Mark; glyph: string;
  moment: Moment; usage: Usage;
  track: number; worth: number;
  line: string;          // one spoken sentence, written from counts
  tip: string | null;    // the better-usage sentence, when there is one
  actions: RemarkAction[];
  by: Grade["by"]; confidence: number;
};

const TIP: Record<Usage, string | null> = {
  "none": null,
  "warm-cache": "Keeping that session alive would have saved most of it.",
  "stop-rereading": "Those reads could have stayed in context.",
  "script-repeats": "One script or a watch would have done it.",
  "close-the-ask": "That ask still needs an answer.",
  "fewer-hands": "Fewer sessions at once would have stepped on each other less.",
};
const n = (x: number, one: string, many = one + "s") => `${x} ${x === 1 ? one : many}`;

/** The one line, led by whatever the grade says matters: the waste for a waste tip, the failure, the work otherwise. */
export function remarkLine(m: MomentInput, g: Grade): string {
  const L = m.laneName;
  if (g.usage === "warm-cache" && m.colds) return `${L} rebuilt its cache from cold ${m.colds === 1 ? "once" : `${m.colds} times`} in ten minutes: ${k(m.coldTokens)} tokens spent remembering.`;
  if (g.usage === "close-the-ask" && m.asksFailed) return `An ask in ${L} failed${m.calls ? ` after ${n(m.calls, "call")}` : ""}.`;
  if (g.usage === "script-repeats" && m.repeats) return `${L} ran the same commands again ${n(m.repeats, "time")} in ten minutes.`;
  if (g.usage === "stop-rereading" && m.rereads) return `${L} read the same files again ${n(m.rereads, "time")}.`;
  if (g.usage === "fewer-hands") return `${n(m.sessions, "session")} worked ${L} at once, with ${n(m.errors, "error")}.`;
  switch (g.moment) {
    case "shipping": return `${L} changed ${n(m.lines, "line")} across ${n(m.files, "file")}${m.asksDone ? ` and finished ${n(m.asksDone, "ask")}` : ""}.`;
    case "coordinating": return `${L} was mostly agents talking: ${n(m.asksOpened, "ask")} opened, ${m.asksDone} finished.`;
    case "debugging": return `${L} was chasing something: ${n(m.calls, "call")}, ${n(m.errors, "error")}, ${n(m.lines, "line")} changed.`;
    case "churning": return `${L} went in circles: ${n(m.calls, "call")} and ${n(m.lines, "line")} to show for it.`;
    case "exploring": return `${L} was reading up: ${n(m.calls, "call")}, ${m.kinds.r || 0} of them reads.`;
    default: return `${L} was quiet.`;
  }
}

/** ":goto @ms" lands the playhead mid-slot; ":lane" frames the workspace */
export function remarkActions(m: MomentInput, g: Grade): RemarkAction[] {
  const show: RemarkAction = { kind: "show", label: "Show me", commands: [`goto @${Math.round((m.t0 + m.t1) / 2)}`, `lane ${m.laneName}`] };
  const ask: RemarkAction | null = g.usage !== "none" || BAD.includes(g.mark)
    ? { kind: "ask", label: "Why?", text: `Why did ${m.laneName} ${g.usage === "warm-cache" ? "rebuild its cache from cold" : g.usage === "close-the-ask" ? "fail that ask" : g.usage === "script-repeats" ? "run the same commands again" : g.usage === "stop-rereading" ? "read the same files again" : "go the way it did"} around then?` }
    : g.mark === "brilliant" || g.mark === "good" ? { kind: "ask", label: "What went right?", text: `What did ${m.laneName} get done around then?` } : null;
  return [show, ...(ask ? [ask] : []), { kind: "dismiss", label: "Later" }];
}

export function composeRemark(m: MomentInput, g: Grade): Remark {
  return {
    id: m.id, sig: m.sig, lane: m.laneName, t0: m.t0, t1: m.t1,
    mark: g.mark, glyph: GLYPH[g.mark], moment: g.moment, usage: g.usage,
    track: Math.round(g.track * 100) / 100, worth: Math.round(g.worth * 100) / 100,
    line: remarkLine(m, g), tip: TIP[g.usage], actions: remarkActions(m, g),
    by: g.by, confidence: Math.round(g.confidence * 100) / 100,
  };
}

/** Which slots get graded: the strongest by rule, the most wasteful, every failed ask; one per lane-hour. */
export function shortlist(slots: Slot[], cap = 32): Slot[] {
  const waste = (s: Slot) => s.coldTokens / 2e4 + s.repeats + s.rereads;
  const out: Slot[] = [], seen = new Set<string>();
  const add = (s: Slot) => { if (out.length < cap && !seen.has(s.id) && !out.some(p => p.lane === s.lane && Math.abs(p.t0 - s.t0) < 36e5)) { seen.add(s.id); out.push(s); } };
  slots.filter(s => s.asksFailed.length).sort((a, b) => b.t0 - a.t0).forEach(add);
  [...slots].filter(s => waste(s) >= 4).sort((a, b) => waste(b) - waste(a)).slice(0, 10).forEach(add);
  [...slots].sort((a, b) => b.score - a.score || b.t0 - a.t0).forEach(add);
  return out;
}

/** The prepared remarks: by worth, routine dropped, at most `perKind` of one tip (or one moment, untipped) so the set
 *  reads as a week and not one lesson six times, at most `max`. */
export function rankRemarks(remarks: Remark[], max = 8, perKind = 2): Remark[] {
  const out: Remark[] = [], kinds = new Map<string, number>();
  for (const r of remarks.filter(r => r.mark !== "routine" || r.worth >= 2).sort((a, b) => b.worth - a.worth || b.t0 - a.t0)) {
    const kind = r.usage !== "none" ? r.usage : r.moment, used = kinds.get(kind) || 0;
    if (used >= perKind) continue;
    kinds.set(kind, used + 1); out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
