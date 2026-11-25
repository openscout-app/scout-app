import { describe, expect, test } from "bun:test";

import { CORE_SPLIT, goalLaneOf, goalPlaceLaneOf } from "./swarm-goal.ts";

describe("core split lanes", () => {
  const laneOf = goalLaneOf(CORE_SPLIT);
  const lane = (agentId: string, name: string | null, labels: readonly string[] = []) => laneOf(agentId, name, labels)?.id ?? null;

  test("a lane claims the agents that work in its places", () => {
    expect(lane("session-1", "core-split-a-lavoisier-3")).toBe("a");
    expect(lane("session-2", "core-split-measure-bohr-8")).toBe("b");
    expect(lane("session-3", "core-split-b-bohr-9")).toBe("b");
    expect(lane("session-4", "core-split-c-hudson-7")).toBe("c");
    expect(lane("session-5", "core-split-c-cli-descartes-4")).toBe("c");
    expect(lane("session-6", "core-split-e1-voltaire-10")).toBe("e1");
    expect(lane("session-7", "core-split-t-popper-5")).toBe("t");
  });

  test("lanes keep the goal's order", () => {
    expect(laneOf("session-1", "core-split-a-lavoisier-3")?.order).toBe(0);
    expect(laneOf("session-4", "core-split-c-hudson-7")?.order).toBe(2);
    expect(laneOf("session-mvgvztqy-j8lgq4", "openscout-hudson-6")?.order).toBe(CORE_SPLIT.lanes.findIndex((l) => l.id === "review"));
  });

  test("10-24's lanes claim their agents by label, out of the clones C and E1 left", () => {
    const goal = "goal:core-split";
    expect(lane("session-mvmlo55r-l83gcf", "core-split-c-cli-heisenberg-7", [goal, "lane:core-stands-alone"])).toBe("core");
    expect(lane("session-mvmlo55r-l83gcf", "core-split-c-cli-heisenberg-7", [goal, "lane:core"])).toBe("core");
    expect(lane("session-mvmlo6t7-qlo3qq", "core-split-c-maxwell-10", [goal, "lane:apps-on-core"])).toBe("apps");
    expect(lane("session-mvmlo6t7-qlo3qq", "core-split-c-maxwell-10", [goal, "lane:apps"])).toBe("apps");
    expect(lane("session-mvmnlk41-fk91dj", "core-split-e1-bohr-12", [goal, "lane:bun14"])).toBe("bun14");
    expect(lane("session-mvmnlk41-fk91dj", "core-split-e1-bohr-12", [goal, "lane:bun14-lean-runtimes"])).toBe("bun14");
    expect(lane("session-8", "core-split-e1-socrates-8", [goal, "lane:readme"])).toBe("readme");
    expect(lane("session-mvmsg1f6-3uorq0", "core-split-139-kafka-10", [goal, "lane:fast"])).toBe("fast");
    expect(lane("session-mvmsg1f6-3uorq0", "core-split-139-kafka-10")).toBe("fast");
    // Unlabeled, the clone still names its first lane.
    expect(lane("session-mvmlo6t7-qlo3qq", "core-split-c-maxwell-10")).toBe("c");
    expect(lane("session-mvmnlk41-fk91dj", "core-split-e1-bohr-12")).toBe("e1");
  });

  test("a goal label and a lane label claim the agent before its place does", () => {
    expect(lane("session-13", "openscout-galileo-5", ["goal:core-split", "lane:swarm-view"])).toBe("view");
    expect(lane("session-14", "openscout-hudson-6", ["goal:core-split", "lane:fable"])).toBe("review");
    expect(lane("session-15", "core-split-c-cli-descartes-4", ["goal:core-split", "lane:c"])).toBe("c");
    expect(lane("session-16", "core-split-a-lavoisier-3", ["lane:t", "goal:core-split"])).toBe("t");
  });

  test("a review label puts the reviewer in the review lane, whichever lane's work it reviews", () => {
    expect(lane("session-mvgvztqy-j8lgq4", "openscout-hudson-6", ["goal:core-split", "lane:e1", "review"])).toBe("review");
    expect(lane("session-22", "openscout-hudson-6", ["review", "lane:a", "goal:core-split"])).toBe("review");
    // Without the goal label it says nothing, like a lane label.
    expect(lane("session-23", "core-split-a-lavoisier-3", ["review"])).toBe("a");
  });

  test("a lane's own agent reviews from its lane, whoever's work it reviews", () => {
    expect(lane("session-mvhv8k8d-sdp28h", "core-split-a-beethoven-3", ["goal:core-split", "lane:a", "review"])).toBe("a");
    expect(lane("session-24", "core-split-a-beethoven-3", ["goal:core-split", "lane:t", "review"])).toBe("a");
    expect(lane("session-mvgwzooc-bhv48q", "openscout-schubert-7", ["review", "lane:c", "goal:core-split"])).toBe("e1");
  });

  test("a lane that borrows another lane's clone is claimed by its label, not the clone", () => {
    expect(lane("session-mvk17jhu-ywo51k", "core-split-b-einstein-7", ["goal:core-split", "lane:astra"])).toBe("astra");
    expect(lane("session-mvk0lnva-jyee3a", "core-split-c-ravel-5", ["goal:core-split", "lane:astra"])).toBe("astra");
    // Without its label it reads as the clone's lane, as any older ask does.
    expect(lane("session-mvk17jhu-ywo51k", "core-split-b-einstein-7")).toBe("b");
  });

  test("a goal label without a lane it knows falls back to agent id and place", () => {
    expect(lane("session-mvhmzq9e-5wspli", "swarm-study-fourier-5", ["goal:core-split"])).toBe("view");
    expect(lane("session-17", "core-split-a-lavoisier-3", ["goal:core-split", "lane:homepage"])).toBe("a");
    expect(lane("session-18", "openscout-dvorak-5", ["goal:core-split"])).toBeNull();
  });

  test("another goal's label takes the agent out, and a lane label alone says nothing", () => {
    expect(lane("session-19", "core-split-a-lavoisier-3", ["goal:homepage", "lane:a"])).toBeNull();
    expect(lane("session-20", "openscout-dvorak-5", ["lane:c"])).toBeNull();
    expect(lane("session-21", "core-split-b-bohr-9", ["lane:c"])).toBe("b");
  });

  test("the reviewer and E1's first survey are claimed by agent id", () => {
    expect(lane("session-mvgvztqy-j8lgq4", "openscout-hudson-6")).toBe("review");
    expect(lane("session-mvgsnye8-x2nzh5", "openscout-cobalt-5")).toBe("review");
    expect(lane("session-mvgwzooc-bhv48q", "openscout-schubert-7")).toBe("e1");
  });

  test("other work stays out", () => {
    expect(lane("session-8", "openscout-dvorak-5")).toBeNull();
    expect(lane("session-9", "peal-kepler")).toBeNull();
    expect(lane("session-10", "openscout-hudson-6")).toBeNull();
    expect(lane("session-11", null)).toBeNull();
    // A place that only starts like a lane's is not that lane's.
    expect(lane("session-12", "core-split-ab-euler-9")).toBeNull();
  });

  test("an ask sent from a lane's place names that lane, and the point's own checkout names none", () => {
    const placeLane = goalPlaceLaneOf(CORE_SPLIT);
    expect(placeLane("core-split-a")).toMatchObject({ id: "a", name: "Lane A", order: 0 });
    expect(placeLane("core-split-c-cli")?.id).toBe("c");
    expect(placeLane("core-split-measure")?.id).toBe("b");
    // The point and the reviewer both work in openscout, so it says nothing about who sent an ask.
    expect(placeLane("openscout")).toBeNull();
    expect(placeLane("core-split-ab")).toBeNull();
  });

  test("no label, place, agent, id or mark belongs to two lanes", () => {
    const labels = CORE_SPLIT.lanes.flatMap((l) => [l.id, ...(l.labels ?? [])]);
    const kinds = CORE_SPLIT.lanes.flatMap((l) => l.kinds ?? []);
    expect(new Set(kinds).size).toBe(kinds.length);
    const places = CORE_SPLIT.lanes.flatMap((l) => l.places ?? []);
    const agents = CORE_SPLIT.lanes.flatMap((l) => l.agentIds ?? []);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(places).size).toBe(places.length);
    expect(new Set(agents).size).toBe(agents.length);
    expect(new Set(CORE_SPLIT.lanes.map((l) => l.id)).size).toBe(CORE_SPLIT.lanes.length);
    expect(new Set(CORE_SPLIT.lanes.map((l) => l.mark)).size).toBe(CORE_SPLIT.lanes.length);
  });
});
