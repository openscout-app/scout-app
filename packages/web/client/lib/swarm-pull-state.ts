/*
 * What became of the pull requests on /swarm: merged, closed, open or a
 * draft. The asks' words say which pull requests moved (swarm-code.ts); the
 * web server reads their state from GitHub (server/routes/swarm-pulls.ts).
 * Pure query building and words; screens/swarm/useSwarmPullStates.ts reads.
 */

import type { SwarmPull } from "./swarm-code.ts";
import { spanWords } from "./swarm-model.ts";

/** As server/routes/swarm-pulls.ts sends it. */
export type SwarmPullState = {
  /** "arach/scout#41", lowercase, the same key as the page's pull requests. */
  key: string;
  repo: string;
  number: number;
  state: "open" | "draft" | "merged" | "closed";
  title: string;
  url: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  /** The open pull request this one is stacked on. Absent from a server that predates it. */
  stackedOn?: number | null;
};

export type SwarmPullsSnapshot = {
  generatedAt: number;
  source: "gh";
  pulls: SwarmPullState[];
  missing: string[];
  warnings: string[];
};

// The route's bounds.
const MAX_PULLS = 300;
const MAX_REPOS = 8;

/**
 * The route's query for the pull requests on the page. Past the route's
 * bounds the most recently moved stay. Sorted, so that the same pull requests
 * always make the same query and a poll that found nothing new asks nothing new.
 */
export function pullStateQuery(pulls: readonly Pick<SwarmPull, "pr" | "last">[]): string | null {
  const repos = new Set<string>();
  const keys = new Set<string>();
  for (const pull of [...pulls].sort((a, b) => b.last - a.last)) {
    const repo = pull.pr.key.slice(0, pull.pr.key.lastIndexOf("#"));
    if (!repos.has(repo) && repos.size === MAX_REPOS) continue;
    repos.add(repo);
    keys.add(pull.pr.key);
    if (keys.size === MAX_PULLS) break;
  }
  if (keys.size === 0) return null;
  return new URLSearchParams([...keys].sort().map((key) => ["pull", key])).toString();
}

/** What became of the pull request, as a sentence: "Merged 14 min ago.", "Closed without merging.", "Still open.", "Still a draft, stacked on #137." */
export function pullStateSentence(state: SwarmPullState | undefined, now: number): string | null {
  if (!state) return null;
  if (state.state === "merged") {
    const at = state.mergedAt ? Date.parse(state.mergedAt) : Number.NaN;
    return Number.isFinite(at) ? `Merged ${spanWords(now - at)} ago.` : "Merged.";
  }
  if (state.state === "closed") return "Closed without merging.";
  const still = state.state === "draft" ? "Still a draft" : "Still open";
  return state.stackedOn ? `${still}, stacked on #${state.stackedOn}.` : `${still}.`;
}

/** The states held so far with a new read laid over them. */
export function mergePullStates(held: ReadonlyMap<string, SwarmPullState>, incoming: readonly SwarmPullState[]): Map<string, SwarmPullState> {
  const next = new Map(held);
  for (const pull of incoming) next.set(pull.key.toLowerCase(), pull);
  return next;
}
