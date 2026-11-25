/*
 * Goals for /swarm: the lanes one goal runs in, so the page can show only the
 * asks that serve it. Since 2026-10-21 asks carry labels ("goal:core-split",
 * "lane:c"), and an agent's latest labeled ask decides its lane. Older asks
 * carry none, so a lane also claims agents by where they work (the place in
 * the session name: core-split-a-lavoisier-3 works in core-split-a) and, for
 * agents that work from elsewhere, such as the reviewer, by agent id.
 */

import { splitAgentName, type SwarmLane } from "./swarm-model.ts";

export type SwarmGoalLane = SwarmLane & {
  /** `lane:` labels that claim this lane besides its id ("fable" for the review lane). */
  labels?: readonly string[];
  /**
   * Bare labels naming the kind of work this lane does ("review"). They claim
   * an agent no lane claims by id or place, and a `lane:` label beside them
   * names whose work it is, not who does it.
   */
  kinds?: readonly string[];
  /** Places whose agents work this lane. */
  places?: readonly string[];
  /** Agents that work this lane from a place it does not claim. */
  agentIds?: readonly string[];
};

export type SwarmGoal = {
  id: string;
  title: string;
  /** One sentence: what done looks like. */
  summary: string;
  lanes: readonly SwarmGoalLane[];
};

/** The open-core split, run from plans/core-split-ledger.md. */
export const CORE_SPLIT: SwarmGoal = {
  id: "core-split",
  title: "Core split",
  summary: "The protocol, runtime, session adapters and CLI move to openscout-app/scout, and the private repo consumes them.",
  lanes: [
    { id: "a", name: "Lane A", mark: "A", about: "public core", places: ["core-split-a"] },
    { id: "b", name: "Lane B", mark: "B", about: "measure", places: ["core-split-b", "core-split-measure"] },
    { id: "c", name: "Lane C", mark: "C", about: "wiring and cutover", places: ["core-split-c", "core-split-c-cli"] },
    // schubert-7 made E1's first read-only survey from the main checkout.
    { id: "e1", name: "Lane E1", mark: "E1", about: "mesh extension", places: ["core-split-e1"], agentIds: ["session-mvgwzooc-bhv48q"] },
    { id: "t", name: "Lane T", mark: "T", about: "direct Tailscale", places: ["core-split-t"] },
    // From 10-24 the work runs in lanes named for what they do, from clones lanes C and E1 left;
    // only their labels claim them, so the clone's older asks stay with C and E1.
    { id: "core", name: "Core", mark: "Co", about: "core stands alone", labels: ["core-stands-alone"] },
    { id: "apps", name: "Apps", mark: "Ap", about: "apps on the core", labels: ["apps-on-core"] },
    { id: "bun14", name: "Bun 1.4", mark: "Bu", about: "Bun floor", labels: ["bun14-lean-runtimes"] },
    { id: "readme", name: "README", mark: "R", about: "core README" },
    // kafka-10 took #139's rebase and #135's lost tests from its own clone, borrowing other lanes' labels at first.
    { id: "fast", name: "Fast lane", mark: "Fa", about: "stack fixes", places: ["core-split-139"] },
    // Astra (gpt-6-astra, low effort) takes small fixes in clones other lanes left idle, so only its label claims it.
    { id: "astra", name: "Lane Astra", mark: "As", about: "fast fixes" },
    // Fable reviews each lane's work before it merges; cobalt-5 was its first session.
    { id: "review", name: "Fable", mark: "F", about: "review", labels: ["fable"], kinds: ["review"], agentIds: ["session-mvgvztqy-j8lgq4", "session-mvgsnye8-x2nzh5"] },
    // The study of how to draw this work. Its blind control carries only the goal label.
    { id: "view", name: "Swarm view", mark: "V", about: "visual study", labels: ["swarm-view"], agentIds: ["session-mvhmzq9e-5wspli"] },
  ],
};

/** Which lane of the goal an agent works in, or null when it works on something else. */
export function goalLaneOf(goal: SwarmGoal): (agentId: string, agentName: string | null, labels?: readonly string[]) => SwarmLane | null {
  const byKind = new Map<string, SwarmLane>();
  const byLabel = new Map<string, SwarmLane>();
  const byAgent = new Map<string, SwarmLane>();
  const byPlace = new Map<string, SwarmLane>();
  goal.lanes.forEach(({ labels, kinds, places, agentIds, ...fields }, order) => {
    const lane = { ...fields, order };
    for (const kind of kinds ?? []) byKind.set(kind, lane);
    for (const label of [fields.id, ...(labels ?? [])]) byLabel.set(label, lane);
    for (const id of agentIds ?? []) byAgent.set(id, lane);
    for (const place of places ?? []) byPlace.set(place, lane);
  });
  const goalLabel = `goal:${goal.id}`;
  return (agentId, agentName, labels = []) => {
    // A goal label is said outright, so it beats where the agent works.
    const goals = labels.filter((label) => label.startsWith("goal:"));
    if (goals.length > 0 && !goals.includes(goalLabel)) return null;
    const { place } = splitAgentName(agentName ?? agentId);
    const own = byAgent.get(agentId) ?? (place ? byPlace.get(place) : undefined) ?? null;
    if (goals.length > 0) {
      // A review of lane E1's work ("lane:e1", "review") is the reviewer's work. A lane's
      // own agent reviews from its lane; anyone else is drawn in the review lane.
      const kind = labels.map((label) => byKind.get(label)).find(Boolean);
      if (kind) return own ?? kind;
      for (const label of labels) {
        const named = label.startsWith("lane:") ? byLabel.get(label.slice("lane:".length)) : undefined;
        if (named) return named;
      }
    }
    return own;
  };
}

/**
 * Which lane of the goal works in a place, for an ask known only by where it
 * was sent from. Only places a lane claims count: the point and the reviewer
 * share a checkout, so an agent's own place says nothing about who sent an ask.
 */
export function goalPlaceLaneOf(goal: SwarmGoal): (place: string) => SwarmLane | null {
  const byPlace = new Map<string, SwarmLane>();
  goal.lanes.forEach(({ labels, kinds, places, agentIds, ...fields }, order) => {
    for (const place of places ?? []) byPlace.set(place, { ...fields, order });
  });
  return (place) => byPlace.get(place) ?? null;
}
