/** Pure selection for days and Home. The selector does not receive pull requests. */
import type { FeedRank, FeedRankKind } from "../../shared/api/feed.ts";

export const DAY_TOP = 3;
const RECENT = 4;
const HALF_LIFE = 12 * 3_600_000;
const round = (n: number) => Math.round(n * 100) / 100;

export type Outcome = Exclude<FeedRankKind, "steering" | "answer">;
export type ScoreSignals = {
  outcome: Outcome; replied: boolean; answered: boolean; steering: boolean;
  operatorAsked: boolean; reviewed: boolean; routine: boolean;
  /** The agent marked its post a milestone. */
  milestone?: boolean;
};

const points = { replied: 1, answered: 3, artifact: 3, steering: 5, operatorAsked: 1, reviewed: 2, routine: -3, milestone: 2 };
/** An agent's own posts in one day's shortlist, beyond which the rest fold unless one is a milestone. */
export const AGENT_POSTS_PER_DAY = 2;

/** Only a question in the ask counts, not a question the agent left in its reply. */
export function directQuestion(ask: string): boolean {
  const question = ask.trim().replace(/^question:\s*/i, "");
  if (/^(?:can|could|would) you (?:please |build|implement|fix|update|add|run|write|create|make|check)\b/i.test(question)) return false;
  return /^(?:what|which|where|when|why|who|how|is|are|was|were|can|could|would|should|do|does|did)\b[^.!?\n]{0,240}\?/i.test(question);
}

export function selectionScore(s: ScoreSignals) {
  const artifact = s.outcome !== "diff" && s.outcome !== "result";
  const kind: FeedRankKind = s.steering ? "steering" : artifact ? s.outcome : s.answered ? "answer" : s.outcome;
  const terms: string[] = [];
  let base = 0;
  const add = (yes: boolean, weight: keyof typeof points, label: string) => {
    if (!yes) return;
    const n = points[weight];
    base += n;
    terms.push(`${label} ${n > 0 ? "+" : ""}${n}`);
  };
  add(s.replied, "replied", "final reply");
  add(artifact, "artifact", s.outcome);
  add(s.answered, "answered", "answered question");
  add(s.steering, "steering", "awaiting steering");
  add(s.operatorAsked, "operatorAsked", "operator asked");
  add(s.reviewed, "reviewed", "operator replied");
  add(s.routine, "routine", "unsolicited review");
  add(Boolean(s.milestone), "milestone", "milestone");
  return { kind, base, reasons: terms.join(", ") || "finished work" };
}

export type Candidate = ReturnType<typeof selectionScore> & {
  id: string; at: number; project: string | null; agent: string | null; session: string | null; routine: boolean;
  /** The agent wrote this post on its own (`scout post`), not on a task's turn. */
  agentPost?: { milestone: boolean } | null;
};

const axes = { kind: 2, project: 1, agent: 1, session: 2 } as const;
type Axis = keyof typeof axes;
const dimensions = Object.keys(axes) as Axis[];

export type Ranked = FeedRank & { id: string };
export type Selection = { shown: Ranked[]; folded: Ranked[] };

/**
 * Greedy, with a short memory: a large project can return after a few other
 * picks. The hard limits affect the shortlist only; nothing disappears.
 */
export function selectPosts(posts: readonly Candidate[], top = DAY_TOP, includeFold = true): Selection {
  const shown: Ranked[] = [], folded: Ranked[] = [];
  const anchor = posts.reduce((max, post) => Math.max(max, post.at), -Infinity);
  const remaining = new Map(posts.map(p => [p.id, { p, fresh: round(2 * 2 ** (-(anchor - p.at) / HALF_LIFE)) }]));
  const recent: Candidate[] = [];
  const sessions = new Set<string>();
  const agentPosts = new Map<string, number>();
  let diffShown = false;
  const foldReason = (p: Candidate) => p.routine ? "unsolicited review"
    : p.agentPost && !p.agentPost.milestone && p.agent && (agentPosts.get(p.agent) ?? 0) >= AGENT_POSTS_PER_DAY ? "agent posted enough today"
    : p.session && sessions.has(p.session) ? "session already shown"
    : p.kind === "diff" && diffShown ? "diff already shown" : null;
  let selecting = true;
  while (remaining.size) {
    selecting &&= shown.length < top;
    if (!selecting && !includeFold) break;
    const counts = { kind: new Map(), project: new Map(), agent: new Map(), session: new Map() } as Record<Axis, Map<string, number>>;
    for (const p of recent) for (const k of dimensions) {
      const key = p[k];
      if (key) counts[k].set(key, 1 + (counts[k].get(key) ?? 0));
    }
    const cost = (p: Candidate, k: Axis) => axes[k] * (counts[k].get(p[k] ?? "") ?? 0);
    let best: Candidate | null = null, score = -Infinity;
    for (const { p, fresh } of remaining.values()) {
      if (selecting && foldReason(p)) continue;
      const adjusted = round(p.base + fresh - dimensions.reduce((n, k) => n + cost(p, k), 0));
      if (!best || adjusted > score || (adjusted === score && (p.at > best.at || (p.at === best.at && p.id < best.id)))) {
        best = p; score = adjusted;
      }
    }
    if (!best) { selecting = false; continue; }
    const p = best;
    const why = [p.reasons, `recency +${remaining.get(p.id)!.fresh}`];
    for (const k of dimensions) if (cost(p, k)) why.push(`repeat ${k} -${cost(p, k)}`);
    if (selecting) {
      if (p.session) sessions.add(p.session);
      if (p.kind === "diff") diffShown = true;
      if (p.agentPost && p.agent) agentPosts.set(p.agent, (agentPosts.get(p.agent) ?? 0) + 1);
    } else why.push(`folded: ${foldReason(p) ?? "below cutoff"}`);
    (selecting ? shown : folded).push({ id: p.id, kind: p.kind, score, why: why.join("; ") });
    recent.push(p);
    if (recent.length > RECENT) recent.shift();
    remaining.delete(p.id);
  }
  return { shown, folded };
}
