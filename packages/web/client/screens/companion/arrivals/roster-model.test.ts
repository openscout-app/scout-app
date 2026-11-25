import { describe, expect, test } from "bun:test";

import type { AgentRosterEntry, AgentRosterListResult, RosterProjectRecord } from "../../../../shared/api/roster.ts";
import { demoRosterTag } from "./arrivals-demo.ts";
import {
  draftProjectCode,
  EMPTY_ROSTER_INDEX,
  indexRoster,
  nextPinAgents,
  parsePinAgents,
  projectDefaultCode,
  rosterProjectsOf,
  rosterTagFor,
} from "./roster-model.ts";

const entry = (agentId: string, number: number, project: string | null, projectCode: string | null, goneAt?: number): AgentRosterEntry => {
  const numberText = String(number).padStart(3, "0");
  return {
    agentId,
    number,
    numberText,
    projectKey: project?.toLowerCase() ?? null,
    project,
    projectCode,
    code: projectCode ? `${projectCode}-${numberText}` : numberText,
    label: projectCode ? `${projectCode} ${numberText}` : numberText,
    source: "auto",
    assignedAt: 1,
    ...(goneAt ? { goneAt } : {}),
  };
};

const project = (name: string, code: string | null, codeSource: RosterProjectRecord["codeSource"] = "default"): RosterProjectRecord => ({
  projectKey: name.toLowerCase(),
  name,
  code,
  codeSource,
  defaultCode: code ?? "",
  createdAt: 1,
  updatedAt: 1,
});

const list: AgentRosterListResult = {
  agents: [entry("ada", 1, "openscout", "OS"), entry("hume", 4, "Scout Media", "SM"), entry("plato", 2, null, null), entry("gone", 3, "openscout", "OS", 99)],
  projects: [project("openscout", "OS"), project("Scout Media", "SM", "operator")],
  capacity: { max: 999, held: 4 },
};

describe("the runtime's roster on the board", () => {
  const index = indexRoster(list);

  test("an agent's tag is the runtime's: its code and its label", () => {
    expect(rosterTagFor("ada", index)).toEqual({ number: 1, numberText: "001", projectCode: "OS", code: "OS-001", label: "OS 001" });
    expect(rosterTagFor(" plato ", index)?.label).toBe("002");
  });

  test("a gone agent, or one the runtime has not numbered, has no tag", () => {
    expect(rosterTagFor("gone", index)).toBeNull();
    expect(rosterTagFor("nobody", index)).toBeNull();
    expect(rosterTagFor(null, index)).toBeNull();
    expect(rosterTagFor("ada", EMPTY_ROSTER_INDEX)).toBeNull();
  });

  test("before the roster reads, the tag the agent record carries", () => {
    const tag = { number: 9, numberText: "009", projectCode: "OS", code: "OS-009", label: "OS 009" };
    expect(rosterTagFor("newcomer", index, new Map([["newcomer", { roster: tag }]]))).toEqual(tag);
    // The roster's read wins over the agent record.
    expect(rosterTagFor("ada", index, new Map([["ada", { roster: tag }]]))?.label).toBe("OS 001");
  });

  test("the projects of the agents shown, by the runtime's names, once each", () => {
    expect(rosterProjectsOf(["hume", "ada", "ada", "plato", "nobody", null], index).map((p) => p.name)).toEqual(["openscout", "Scout Media"]);
    expect(rosterProjectsOf(["ada", "hume"], index, 1).map((p) => p.name)).toEqual(["openscout"]);
  });

  test("no roster, no index", () => {
    expect(indexRoster(null)).toBe(EMPTY_ROSTER_INDEX);
  });
});

describe("which agent each figure is", () => {
  test("learns a pin's agent as the board sees it; the same object when nothing changes", () => {
    const one = nextPinAgents({}, [["w1", "ada"]], null);
    expect(one).toEqual({ w1: "ada" });
    expect(nextPinAgents(one, [["w1", "ada"]], null)).toBe(one);
    expect(nextPinAgents(one, [], ["w1"])).toBe(one);
  });

  test("forgets a pin that left the desk only once the host says which pins are out", () => {
    const one = { w1: "ada", w2: "hume" };
    expect(nextPinAgents(one, [], null)).toBe(one);
    expect(nextPinAgents(one, [], ["w2"])).toEqual({ w2: "hume" });
  });

  test("a stored map: anything unreadable is dropped", () => {
    expect(parsePinAgents(JSON.stringify({ w1: "ada", w2: 3, w3: " " }))).toEqual({ w1: "ada" });
    expect(parsePinAgents("nope")).toEqual({});
    expect(parsePinAgents(null)).toEqual({});
  });
});

describe("a project code as the operator types it", () => {
  test("letters only, in capitals, at most three", () => {
    expect(draftProjectCode("os")).toBe("OS");
    expect(draftProjectCode("o1s-x9y")).toBe("OSX");
    expect(draftProjectCode("")).toBe("");
  });

  test("an empty field shows the project's default", () => {
    expect(projectDefaultCode({ defaultCode: "SM", name: "Scout Media" })).toBe("SM");
    expect(projectDefaultCode({ defaultCode: "", name: "openscout" })).toBe("OS");
  });
});

describe("the demo board", () => {
  test("gives its five agents fixed codes in the runtime's shape", () => {
    expect(["demo-ada", "demo-descartes", "demo-seneca", "demo-hume", "demo-chopin"].map((id) => demoRosterTag(id)?.numberText)).toEqual(["001", "002", "003", "004", "005"]);
    expect(demoRosterTag("demo-nobody")).toBeNull();
  });
});
