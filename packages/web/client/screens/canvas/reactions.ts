/*
 * Canvas reactions: the operator's answer to something an agent made, sent to the session that made it.
 *
 * A reaction is a message, not a record: it goes to the session by its id through POST /api/sessions/reply, which
 * types it in where the session is open or resumes the session with it. The session's next read shows it as the
 * operator's latest prompt, so the canvas needs no store of its own. This browser only remembers what it sent, to
 * mark the artifact and to show the preview's feedback thread.
 */
import { parseSessionRouteRef } from "../../../shared/session-route-ref.ts";

export type ReactionKind = "more" | "narrower" | "wrong" | "ship";

/** The four reactions, in the order they are offered: the label, and what it tells the agent to do. */
export const REACTIONS: readonly { kind: ReactionKind; label: string; means: string }[] = [
  { kind: "more", label: "More like this", means: "Keep going in this direction and do more of what this does." },
  { kind: "narrower", label: "Narrower", means: "The direction is right but this is too broad. Cut it down to its core and show me that." },
  { kind: "wrong", label: "Wrong question", means: "This answers the wrong question. Stop, and tell me in a sentence what you think I am asking before you go on." },
  { kind: "ship", label: "Ship it", means: "This is good. Finish it and get it ready to merge." },
];

export const reactionLabel = (kind: ReactionKind) => REACTIONS.find((r) => r.kind === kind)?.label ?? kind;

/** What the reaction is on, as the agent knows it: a path, and what the artifact is. */
export type ReactionTarget = { path: string; what: string };

/**
 * The message the session receives: what it is on, the reaction and its meaning, then the operator's own sentence.
 * `where` names the page it was sent from.
 */
export function reactionMessage(kind: ReactionKind, target: ReactionTarget, note: string, where = "the Canvas"): string {
  const r = REACTIONS.find((x) => x.kind === kind);
  if (!r) throw new Error(`Unknown reaction: ${kind}`);
  const said = note.replace(/\s+/g, " ").trim();
  return [
    `Reaction from the operator, sent from ${where}, on ${target.what} ${target.path}`,
    `${r.label}. ${r.means}`,
    ...(said ? [`In their words: ${said}`] : []),
  ].join("\n\n");
}

/**
 * Feedback in the operator's own words, with or without a reaction: a reaction keeps its own message; words alone
 * say what they are on, then the words, line breaks kept.
 */
export function feedbackMessage(kind: ReactionKind | null, target: ReactionTarget, note: string, where = "the Canvas"): string {
  if (kind) return reactionMessage(kind, target, note, where);
  const said = note.trim();
  if (!said) throw new Error("Feedback needs a reaction or a note.");
  return [`Feedback from the operator, sent from ${where}, on ${target.what} ${target.path}`, said].join("\n\n");
}

/** The session a reaction goes to, from the area's route ref ("session:<harness>:<id>"); null when it has none. */
export function reactionSession(ref: string | null, harness: string): { sessionId: string; harness: string } | null {
  const parsed = parseSessionRouteRef(ref);
  if (!parsed?.refId) return null;
  return { sessionId: parsed.refId, harness: parsed.harness ?? harness };
}

/* ── what this browser sent ──────────────────────────────────────────────── */

/** One piece of feedback sent from this browser: a reaction, the operator's words, or both, and where it landed. */
export type SentFeedback = { kind: ReactionKind | null; note: string; at: number; landed: string };
/** Feedback sent about one artifact, oldest first. */
export type SentThread = readonly SentFeedback[];

const KEY = "scout-canvas:reactions";
const KEEP_MS = 7 * 24 * 3_600_000;
/** the most notes kept per artifact */
const KEEP_EACH = 20;

/** What an artifact's mark says about the last feedback sent: the reaction, else "Feedback". */
export const sentLabel = (f: SentFeedback) => (f.kind ? reactionLabel(f.kind) : "Feedback");

function readOne(v: unknown, now: number): SentFeedback | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = REACTIONS.some((r) => r.kind === o.kind) ? (o.kind as ReactionKind) : null;
  const note = typeof o.note === "string" ? o.note : "";
  const at = Number(o.at);
  if (!Number.isFinite(at) || now - at > KEEP_MS || (!kind && !note.trim())) return null;
  return { kind, note, at, landed: typeof o.landed === "string" ? o.landed : "" };
}

/**
 * Feedback sent from this browser, by artifact key; notes older than a week are dropped. Reads the older shape, one
 * reaction per artifact, as a thread of one.
 */
export function readSent(now: number, text: string | null): Map<string, SentThread> {
  const out = new Map<string, SentThread>();
  try {
    for (const [k, v] of Object.entries(JSON.parse(text ?? "{}") as Record<string, unknown>)) {
      const thread = (Array.isArray(v) ? v : [v]).map((x) => readOne(x, now)).filter((x): x is SentFeedback => !!x).slice(-KEEP_EACH);
      if (thread.length) out.set(k, thread);
    }
  } catch { /* nothing kept */ }
  return out;
}

/** The thread with one more note at its end, keeping the newest. */
export const withSent = (thread: SentThread | undefined, f: SentFeedback): SentThread => [...(thread ?? []), f].slice(-KEEP_EACH);

export function loadSent(now: number): Map<string, SentThread> {
  try { return readSent(now, localStorage.getItem(KEY)); } catch { return new Map(); }
}

export function saveSent(sent: ReadonlyMap<string, SentThread>) {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(sent))); } catch { /* a convenience only */ }
}
