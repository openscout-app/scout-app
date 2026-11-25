import { describe, expect, test } from "bun:test";
import type { ActivityItem, Agent, FleetAsk } from "../../lib/types.ts";
import {
  agentOpsTotals,
  agentRosterCount,
  basename,
  compactNumber,
  countBy,
  DAY_MS,
  formatCost,
  formatLatency,
  machineLabel,
  makeThroughput,
  pickActiveTask,
  rowForAgent,
  searchAgentRows,
  teamLabel,
} from "./ops-agents-model.ts";

const NOW = 1_800_000_000_000;
const agent = (extra: Partial<Agent>) => ({ id: "a", name: "devon", state: "idle", ...extra }) as Agent;
const ask = (status: FleetAsk["status"], task: string, updatedAt = 0) => ({ agentId: "a", status, task, updatedAt }) as unknown as FleetAsk;

describe("labels", () => {
  test("machine: node name first, then transport, then the folder, then local", () => {
    expect(machineLabel(agent({ authorityNodeName: "mini", homeNodeName: "home" }))).toBe("mini");
    expect(machineLabel(agent({ cwd: "/w/openscout/" }))).toBe("openscout");
    expect(machineLabel(agent({}))).toBe("local");
  });

  test("team: project, role, class, else Unassigned", () => {
    expect(teamLabel(agent({ project: "openscout", role: "dev" }))).toBe("openscout");
    expect(teamLabel(agent({}))).toBe("Unassigned");
  });

  test("countBy: most first, capped", () => {
    const agents = [agent({ project: "a" }), agent({ project: "b" }), agent({ project: "b" }), agent({ project: "c" })];
    expect(countBy(agents, teamLabel)).toEqual([["b", 2], ["a", 1], ["c", 1]]);
    expect(countBy(agents, teamLabel, 1)).toEqual([["b", 2]]);
  });

  test("formats", () => {
    expect(basename("")).toBeNull();
    expect(basename("/a/b/")).toBe("b");
    expect(compactNumber(null)).toBe("—");
    expect(compactNumber(1_500)).toBe("1.5K");
    expect(compactNumber(12_000_000)).toBe("12M");
    expect(formatLatency(840)).toBe("840ms");
    expect(formatLatency(1_234)).toBe("1.23s");
    expect(formatCost(null)).toBe("$—");
    expect(formatCost(0.5)).toBe("$0.500");
    expect(formatCost(12)).toBe("$12.00");
  });
});

describe("rows", () => {
  test("pickActiveTask prefers work in flight, newest first", () => {
    expect(pickActiveTask([])).toBeNull();
    expect(pickActiveTask([ask("queued", "later", 9), ask("working", "now", 1), ask("working", "newer", 2)])).toBe("newer");
  });

  test("throughput: 24 hourly buckets over the last day", () => {
    const activity = [{ ts: NOW - 30 * 60_000 }, { ts: NOW - DAY_MS + 1 }, { ts: NOW - 2 * DAY_MS }] as ActivityItem[];
    const buckets = makeThroughput(activity, NOW);
    expect(buckets.length).toBe(24);
    expect(buckets[23]).toBe(1);
    expect(buckets[0]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test("a row counts its asks, errors and sessions; search and totals read rows", () => {
    const row = rowForAgent(
      agent({ state: "working", project: "openscout" }),
      [{ id: "s", agentId: "a", lastMessageAt: NOW - 1_000 }] as never,
      [],
      [ask("working", "Port the view"), ask("failed", "Old")],
      new Map(),
      NOW,
    );
    expect(row.state).toBe("in_turn");
    expect(row.activeFlights).toBe(2);
    expect(row.errors).toBe(1);
    expect(row.sessions24h).toBe(1);
    expect(row.activeTask).toBe("Port the view");

    const idle = rowForAgent(agent({ id: "b", name: "rook", state: "retired" }), [], [], [], new Map(), NOW);
    expect(searchAgentRows([row, idle], "port").map((r) => r.agent.name)).toEqual(["devon"]);
    expect(searchAgentRows([row, idle], "  ").length).toBe(2);

    const totals = agentOpsTotals([row, idle]);
    expect(totals.running).toBe(1);
    expect(totals.online).toBe(1);
    expect(totals.avgLatency).toBeNull();
  });
});

describe("agentRosterCount", () => {
  test("a count over a full roster reads N+, never a ratio against the limit", () => {
    expect(agentRosterCount(99, 100)).toBe("99+");
    expect(agentRosterCount(12, 40)).toBe("12");
    expect(agentRosterCount(3, 5, 5)).toBe("3+");
  });
});
