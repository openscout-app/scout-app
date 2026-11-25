import { describe, expect, test } from "bun:test";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import {
  isLanesRoute,
  laneForSelection,
  laneHarnessValues,
  lanePanelContent,
  lanePanelState,
  laneProjectOptions,
  latestLane,
  laneRoute,
  panelLane,
  pickTarget,
  routeLane,
  showsPicks,
  urlHoldsLane,
} from "./lanes-panel-model.ts";

const lane = (id: string, agent: Record<string, unknown> = {}, facts?: Record<string, unknown>) =>
  ({ id, agent: { id, ...agent }, source: "scout", observe: null, lastActiveAt: 0, current: true, ...(facts ? { facts } : {}) }) as unknown as AgentLane;

describe("the deck's own route", () => {
  test("Ops › Lanes only: the floor, the world and the other Ops pages keep their own", () => {
    expect(isLanesRoute({ view: "ops", mode: "lanes" })).toBe(true);
    expect(isLanesRoute({ view: "ops", mode: "world" })).toBe(false);
    expect(isLanesRoute({ view: "ops", mode: "week" })).toBe(false);
    expect(isLanesRoute({ view: "ops" })).toBe(false);
    expect(isLanesRoute({ view: "inbox" })).toBe(false);
  });
});

describe("the pick in the URL", () => {
  test("reads ?sessionId=, then ?targetAgentId=, on Ops › Lanes only", () => {
    expect(routeLane({ view: "ops", mode: "lanes", sessionId: " native:codex:abc " })).toBe("native:codex:abc");
    expect(routeLane({ view: "ops", mode: "lanes", targetAgentId: "scout.ada" })).toBe("scout.ada");
    expect(routeLane({ view: "ops", mode: "lanes", sessionId: "s1", targetAgentId: "scout.ada" })).toBe("s1");
    expect(routeLane({ view: "ops", mode: "lanes", sessionId: "  " })).toBeNull();
    expect(routeLane({ view: "ops", mode: "lanes" })).toBeNull();
    expect(routeLane({ view: "ops", mode: "mission", sessionId: "s1" })).toBeNull();
  });

  test("writes Ops › Lanes with the pick, or without one", () => {
    expect(laneRoute("native:codex:abc")).toEqual({ view: "ops", mode: "lanes", sessionId: "native:codex:abc" });
    expect(laneRoute(null)).toEqual({ view: "ops", mode: "lanes" });
    expect(laneRoute(" ")).toEqual({ view: "ops", mode: "lanes" });
    expect(routeLane(laneRoute("abc"))).toBe("abc");
  });

  test("the dock carries the pick until the router writes sessionId on /ops/lanes", () => {
    expect(urlHoldsLane(() => "/ops/lanes")).toBe(false);
    expect(urlHoldsLane(() => "/ops/lanes?sessionId=probe")).toBe(true);
  });
});

describe("the lane an id names", () => {
  const lanes = [
    lane("scout.ada", { harnessSessionId: "h-1" }),
    lane("native:codex:019a-77", {}),
    lane("native:claude:path:9f2e", { harnessSessionId: "h-2" }),
  ];

  test("a lane id first", () => {
    expect(laneForSelection(lanes, "scout.ada")?.id).toBe("scout.ada");
    expect(laneForSelection(lanes, "native:codex:019a-77")?.id).toBe("native:codex:019a-77");
  });

  test("then the harness session it runs, then a native lane's session", () => {
    expect(laneForSelection(lanes, "h-2")?.id).toBe("native:claude:path:9f2e");
    expect(laneForSelection(lanes, "019a-77")?.id).toBe("native:codex:019a-77");
  });

  test("nothing for an empty id or one no lane carries", () => {
    expect(laneForSelection(lanes, null)).toBeNull();
    expect(laneForSelection(lanes, " ")).toBeNull();
    expect(laneForSelection(lanes, "gone")).toBeNull();
  });
});

describe("which lane a Lane panel shows", () => {
  const own = { view: "ops", mode: "lanes", sessionId: "s1" } as const;
  const elsewhere = { view: "views", viewId: "mine" } as never;

  test("pinned to one lane, that lane wherever it sits", () => {
    expect(panelLane(own, "s9", "s2", true)).toEqual({ id: "s9", source: "pinned" });
    expect(panelLane(elsewhere, "s9", "s2", true)).toEqual({ id: "s9", source: "pinned" });
  });

  test("following the page on Ops › Lanes, the URL's lane once the router keeps it", () => {
    expect(panelLane(own, FOLLOW_PAGE, "s2", true)).toEqual({ id: "s1", source: "page" });
    expect(panelLane({ view: "ops", mode: "lanes" }, FOLLOW_PAGE, "s2", true)).toEqual({ id: null, source: "page" });
  });

  test("before then, and off the page, the deck's pick", () => {
    expect(panelLane(own, FOLLOW_PAGE, "s2", false)).toEqual({ id: "s2", source: "pick" });
    expect(panelLane(elsewhere, FOLLOW_PAGE, "s2", true)).toEqual({ id: "s2", source: "pick" });
    expect(panelLane(elsewhere, "", null, true)).toEqual({ id: null, source: "pick" });
    expect(panelLane(own, undefined, "s2", true)).toEqual({ id: "s2", source: "pick" });
  });

  test("only a panel that shows picks counts itself in", () => {
    expect(showsPicks("page")).toBe(true);
    expect(showsPicks("pick")).toBe(true);
    expect(showsPicks("pinned")).toBe(false);
  });
});

describe("where the deck's pick goes", () => {
  test("its own sheet with no Lane panel showing picks, or in full view", () => {
    expect(pickTarget({ followers: 0 }, false, true, true)).toBe("sheet");
    expect(pickTarget({ followers: 1 }, true, true, true)).toBe("sheet");
  });

  test("the URL on its own page once the router keeps it, else the dock", () => {
    expect(pickTarget({ followers: 1 }, false, true, true)).toBe("url");
    expect(pickTarget({ followers: 1 }, false, true, false)).toBe("dock");
    expect(pickTarget({ followers: 2 }, false, false, true)).toBe("dock");
  });
});

describe("what a Lane panel draws", () => {
  const lanes = [lane("s1")];
  const reading = { lanes, horizonLabel: "1h", navigationEnabled: true, pinProject: () => {}, projectPinned: () => false };

  test("says when there is no deck, before anything else", () => {
    expect(lanePanelState({ decks: 0, reading }, { id: "s1", source: "pick" }).kind).toBe("no-deck");
    expect(lanePanelState({ decks: 1, reading: null }, { id: "s1", source: "pick" }).kind).toBe("no-deck");
  });

  test("with nothing picked, reads the lane that wrote last instead of standing empty", () => {
    const state = lanePanelState({ decks: 1, reading }, { id: null, source: "page" });
    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" ? state.latest : null).toBe(true);
  });

  test("waits for a pick only when the deck has no lanes", () => {
    expect(lanePanelState({ decks: 1, reading: { ...reading, lanes: [] } }, { id: null, source: "page" })).toEqual({ kind: "no-pick", source: "page" });
  });

  test("the lane that wrote last: a running lane ahead of one that ended", () => {
    const at = (id: string, lastActiveAt: number, current = true) => ({ ...lane(id), lastActiveAt, current }) as AgentLane;
    expect(latestLane([at("a", 10), at("b", 30), at("c", 20)])?.id).toBe("b");
    expect(latestLane([at("a", 10), at("ended", 99, false)])?.id).toBe("a");
    expect(latestLane([])).toBeNull();
  });

  test("names a lane the deck has not built in its window", () => {
    expect(lanePanelState({ decks: 1, reading }, { id: "s9", source: "page" })).toEqual({ kind: "not-live", id: "s9", horizonLabel: "1h" });
  });

  test("draws the lane", () => {
    const state = lanePanelState({ decks: 1, reading }, { id: "s1", source: "pick" });
    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" ? state.lane.id : null).toBe("s1");
  });

  test("folds while it has no lane to read, and names the lane once it has one", () => {
    expect(lanePanelContent({ kind: "no-deck" })).toEqual({ empty: true, state: "no deck" });
    expect(lanePanelContent({ kind: "no-pick", source: "pick" })).toEqual({ empty: true, state: "none picked" });
    expect(lanePanelContent({ kind: "not-live", id: "s9", horizonLabel: "1h" })).toEqual({ empty: true, state: "not in window" });
    expect(lanePanelContent({ kind: "ready", lane: lane("s1") }, (l) => `agent ${l.id}`)).toEqual({ empty: false, state: "agent s1", mark: "s1@0" });
  });
});

describe("the deck's pickers", () => {
  const lanes = [
    lane("a", { harness: "Codex", projectRoot: "/work/openscout/" }),
    lane("b", { harness: "claude", cwd: "/work/talkie" }),
    lane("c", { harness: "codex" }, { cwd: "/work/Pomo" }),
    lane("d", { project: "openscout" }),
  ];

  test("harnesses, once each, as the filter matches them", () => {
    expect(laneHarnessValues(lanes)).toEqual(["claude", "codex"]);
  });

  test("projects by folder name: the root first, then the working directory", () => {
    expect(laneProjectOptions(lanes)).toEqual([
      { value: "openscout", label: "openscout" },
      { value: "Pomo", label: "Pomo" },
      { value: "talkie", label: "talkie" },
    ]);
  });
});
