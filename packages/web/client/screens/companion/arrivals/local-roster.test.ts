import { describe, expect, test } from "bun:test";

import type { AgentRosterImportResult } from "../../../../shared/api/roster.ts";
import {
  conflictText,
  displayCode,
  importEntriesOf,
  importPreview,
  isRuntimeAgentKey,
  localLabel,
  parseLocalProjectCodes,
  parseLocalRoster,
  parseLocalRosterImported,
} from "./local-roster.ts";

const NOW = 1_800_000_000_000;

const stored = JSON.stringify({
  agents: {
    "agent-ada": { n: 1, project: "openscout" },
    "agent-hume": { n: 6, project: "demo-app" },
    "agent-seneca": { n: 3, project: null },
    "native:codex:abc": { n: 4, project: "openscout" },
    "pin:w9": { n: 5, project: null, gone: NOW },
  },
  pins: { w1: "agent-ada", w2: "native:codex:abc", w3: "agent-nobody" },
});

describe("the numbers stored before the runtime kept the roster", () => {
  test("read sorted by number, with the project code the board drew", () => {
    const roster = parseLocalRoster(stored, JSON.stringify({ "Demo-app": "app" }));
    expect(roster.entries.map((e) => [e.key, e.number, e.projectCode])).toEqual([
      ["agent-ada", 1, "OS"],
      ["agent-seneca", 3, null],
      ["native:codex:abc", 4, "OS"],
      ["pin:w9", 5, null],
      ["agent-hume", 6, "APP"],
    ]);
    // A pin naming an agent the roster does not hold is dropped.
    expect(roster.pins).toEqual({ w1: "agent-ada", w2: "native:codex:abc" });
  });

  test("unreadable entries and a second holder of one number are dropped, never thrown", () => {
    const raw = JSON.stringify({ agents: { a: { n: 1, project: "openscout" }, b: { n: 1, project: null }, c: { n: 0, project: null }, d: { n: 1000, project: null }, e: { n: 2, project: 7 }, f: "x" } });
    expect(parseLocalRoster(raw).entries.map((e) => e.key)).toEqual(["a"]);
    expect(parseLocalRoster("not json")).toEqual({ entries: [], pins: {} });
    expect(parseLocalRoster(null)).toEqual({ entries: [], pins: {} });
    expect(parseLocalRoster("[1,2]")).toEqual({ entries: [], pins: {} });
  });

  test("the operator's codes: two or three letters or digits, keyed by project in lower case", () => {
    expect(parseLocalProjectCodes(JSON.stringify({ OpenScout: "os", hudson: "toolong", x: 4 }))).toEqual({ openscout: "OS" });
    expect(parseLocalProjectCodes("nope")).toEqual({});
  });

  test("whether they were imported", () => {
    expect(parseLocalRosterImported(JSON.stringify({ at: NOW, imported: 3 }))).toEqual({ at: NOW, imported: 3 });
    expect(parseLocalRosterImported(JSON.stringify({ at: "x" }))).toBeNull();
    expect(parseLocalRosterImported(null)).toBeNull();
  });
});

describe("the import file", () => {
  test("sends Scout agents only, in the scout roster import format", () => {
    const { entries, skipped } = importEntriesOf(parseLocalRoster(stored));
    expect(entries).toEqual([
      { agentId: "agent-ada", number: "001", projectCode: "OS" },
      { agentId: "agent-seneca", number: "003" },
      { agentId: "agent-hume", number: "006", projectCode: "DA" },
    ]);
    expect(skipped.map((e) => e.key)).toEqual(["native:codex:abc", "pin:w9"]);
  });

  test("a native session or a figure with no agent is not a runtime agent", () => {
    expect(isRuntimeAgentKey("agent-ada")).toBe(true);
    expect(isRuntimeAgentKey("native:claude:1")).toBe(false);
    expect(isRuntimeAgentKey("pin:w1")).toBe(false);
  });

  test("labels in the board's form", () => {
    expect(localLabel({ number: 6, projectCode: "OS" })).toBe("OS 006");
    expect(localLabel({ number: 12, projectCode: null })).toBe("012");
    expect(displayCode("OS-006")).toBe("OS 006");
    expect(displayCode("006")).toBe("006");
  });
});

describe("the runtime's answer to an import", () => {
  const roster = parseLocalRoster(stored);
  const result: AgentRosterImportResult = {
    dryRun: true,
    imported: [{ agentId: "agent-ada", number: 1, code: "OS-001" }, { agentId: "agent-hume", number: 6, code: "006" }],
    renumbered: [{ agentId: "agent-new", from: 1, to: 7 }],
    projectCodes: [{ projectKey: "openscout", code: "OS" }],
    conflicts: [
      { agentId: "agent-seneca", number: 3, reason: "number_held", detail: "003 is held", heldBy: "agent-plato" },
      { agentId: "agent-hume", projectCode: "SA", reason: "project_code_held", detail: "SA is held", heldBy: "sales" },
    ],
  };

  test("one row per number sent: what the runtime keeps, or why not", () => {
    const preview = importPreview(roster, result);
    expect(preview.rows.map((r) => [r.entry.key, r.code, r.numberRefused, r.codeRefused])).toEqual([
      ["agent-ada", "OS-001", null, null],
      ["agent-seneca", null, "An earlier import holds this number (agent-plato)", null],
      ["agent-hume", "006", null, "SA is held by another project (sales)"],
    ]);
    expect(preview.kept).toBe(2);
    expect(preview.refused).toBe(1);
    expect(preview.moved).toEqual([{ agentId: "agent-new", from: 1, to: 7 }]);
    expect(preview.projectCodes).toEqual([{ projectKey: "openscout", code: "OS" }]);
    expect(preview.skipped.map((e) => e.key)).toEqual(["native:codex:abc", "pin:w9"]);
  });

  test("a number neither kept nor refused by name still reads as not kept", () => {
    const preview = importPreview(roster, { ...result, imported: [], conflicts: [] });
    expect(preview.rows.every((r) => r.numberRefused === "Not kept")).toBe(true);
    expect(preview.kept).toBe(0);
  });

  test("each refusal reads in plain words", () => {
    expect(conflictText({ reason: "unknown_agent" })).toBe("The runtime has no such agent");
    expect(conflictText({ reason: "agent_already_imported" })).toBe("Already imported");
    expect(conflictText({ reason: "invalid_project_code", projectCode: "O1" })).toBe("O1 is not two or three letters");
    expect(conflictText({ reason: "project_code_differs", heldBy: "OS" })).toBe("The project already has another code (OS)");
  });
});
