import { describe, expect, test } from "bun:test";

import { mergePullStates, pullStateQuery, pullStateSentence, type SwarmPullState } from "./swarm-pull-state.ts";

function pull(key: string, last: number) {
  const [repo, number] = key.split("#");
  return { pr: { key, repo: repo!, number: Number(number), url: `https://github.com/${repo}/pull/${number}` }, last };
}

function state(key: string, value: SwarmPullState["state"], mergedAt: string | null = null): SwarmPullState {
  const [repo, number] = key.split("#");
  return { key, repo: repo!, number: Number(number), state: value, title: key, url: `https://github.com/${repo}/pull/${number}`, mergedAt, closedAt: mergedAt, updatedAt: null };
}

describe("swarm pull request state", () => {
  test("asks for each pull request once, in a stable order", () => {
    const query = pullStateQuery([pull("openscout-app/scout#131", 3), pull("arach/scout#53", 5), pull("arach/scout#41", 1), pull("arach/scout#53", 2)]);
    expect(query).toBe("pull=arach%2Fscout%2341&pull=arach%2Fscout%2353&pull=openscout-app%2Fscout%23131");
    expect(new URLSearchParams(query!).getAll("pull")).toEqual(["arach/scout#41", "arach/scout#53", "openscout-app/scout#131"]);
    expect(pullStateQuery([])).toBeNull();
  });

  test("keeps the most recently moved pull requests within the route's bounds", () => {
    const many = Array.from({ length: 320 }, (_, index) => pull(`arach/scout#${index + 1}`, index));
    const kept = new URLSearchParams(pullStateQuery(many)!).getAll("pull");
    expect(kept).toHaveLength(300);
    expect(kept).not.toContain("arach/scout#1");
    expect(kept).toContain("arach/scout#320");
    const repos = Array.from({ length: 10 }, (_, index) => pull(`owner/repo${index}#1`, index));
    const nine = new URLSearchParams(pullStateQuery(repos)!).getAll("pull");
    expect(nine).toHaveLength(8);
    expect(nine).not.toContain("owner/repo0#1");
    expect(nine).not.toContain("owner/repo1#1");
  });

  test("says what became of a pull request", () => {
    const now = Date.parse("2026-10-21T16:20:00Z");
    expect(pullStateSentence(state("arach/scout#41", "merged", "2026-10-21T16:06:00Z"), now)).toBe("Merged 14 min ago.");
    expect(pullStateSentence(state("arach/scout#41", "merged"), now)).toBe("Merged.");
    expect(pullStateSentence(state("arach/scout#42", "closed"), now)).toBe("Closed without merging.");
    expect(pullStateSentence(state("arach/scout#55", "draft"), now)).toBe("Still a draft.");
    expect(pullStateSentence(state("arach/scout#36", "open"), now)).toBe("Still open.");
    expect(pullStateSentence(undefined, now)).toBeNull();
    expect(pullStateSentence({ ...state("arach/scout#142", "draft"), stackedOn: 137 }, now)).toBe("Still a draft, stacked on #137.");
    expect(pullStateSentence({ ...state("arach/scout#137", "open"), stackedOn: 135 }, now)).toBe("Still open, stacked on #135.");
    expect(pullStateSentence({ ...state("arach/scout#135", "open"), stackedOn: null }, now)).toBe("Still open.");
  });

  test("a new read replaces what it covers and keeps the rest", () => {
    const held = mergePullStates(new Map(), [state("arach/scout#41", "draft"), state("arach/scout#36", "open")]);
    const next = mergePullStates(held, [state("arach/scout#41", "merged", "2026-10-21T16:06:00Z")]);
    expect([...next.values()].map((entry) => `${entry.key} ${entry.state}`)).toEqual(["arach/scout#41 merged", "arach/scout#36 open"]);
    expect(held.get("arach/scout#41")?.state).toBe("draft");
  });
});
