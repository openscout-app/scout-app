import { describe, expect, test } from "bun:test";
import type { Agent, TailDiscoverySnapshot } from "../../lib/types.ts";
import {
  attentionBreakdown,
  attentionReading,
  EMPTY_HOST_ADVISOR_DATA,
  etimeSeconds,
  formatDuration,
  peakQuota,
  readHostAdvisor,
  readingsFor,
  subsystems,
  subsystemSummary,
  unattendedItems,
  unattendedReading,
  worktreeGroups,
} from "./host-advisor-model.ts";

const NOW = 1_800_000_000_000;
type Process = TailDiscoverySnapshot["processes"][number];

const agent = (id: string, projectRoot: string, branch?: string) => ({ id, name: id, projectRoot, branch }) as unknown as Agent;
const proc = (pid: number, cwd: string, command = "claude"): Process =>
  ({ pid, ppid: 1, command, etime: "1:02:03", cwd, harness: "scout-managed", parentChain: [], source: "claude" }) as Process;

describe("readingsFor", () => {
  test("one chosen reading, or the page's four", () => {
    expect(readingsFor("budgets")).toEqual(["budgets"]);
    expect(readingsFor("processes")).toEqual(["processes"]);
    expect(readingsFor(undefined)).toEqual(["attention", "unattended", "budgets", "subsystems"]);
    expect(readingsFor("nonsense")).toEqual(["attention", "unattended", "budgets", "subsystems"]);
  });
});

describe("attention", () => {
  test("roots weigh agents plus three per process; the verdict follows the top share", () => {
    const groups = worktreeGroups(
      [agent("a", "/w/one", "feat"), agent("b", "/w/one"), agent("c", "/w/two")],
      [proc(1, "/w/one/packages"), proc(2, "/elsewhere")],
    );
    expect(groups.map((g) => [g.name, g.agents.length, g.processes.length])).toEqual([["one", 2, 1], ["two", 1, 0]]);
    const breakdown = attentionBreakdown(groups, null);
    expect(breakdown.ranked.map((r) => [r.name, r.weight, r.percent, r.primaryBranch])).toEqual([
      ["one", 5, 83, "feat"],
      ["two", 1, 17, "main"],
    ]);
    expect(attentionReading(breakdown)?.verdict).toBe("Concentrated");
    expect(attentionReading(attentionBreakdown([], null))).toBeNull();
  });
});

describe("unattended", () => {
  test("prompted relays, a build off main, conversations quiet for over an hour", () => {
    const items = unattendedItems(
      [proc(9, "/w/one", "claude --append-system-prompt session-abc"), proc(10, "/w/one")],
      { gitBranch: "scout/x" } as never,
      [
        { id: "c1", title: "Old", lastMessageAt: NOW - 2 * 3_600_000, messageCount: 3, workspaceRoot: "/w/one" },
        { id: "c2", title: "Fresh", lastMessageAt: NOW - 60_000, messageCount: 1 },
      ] as never,
      NOW,
    );
    expect(items.map((i) => [i.kind, i.actionLabel])).toEqual([
      ["stalled_relay", "Tail Process"],
      ["uncommitted_branch", "Inspect Repos"],
      ["unresumed_session", "Open Chat"],
    ]);
    expect(items[0].title).toBe("session-abc");
    const reading = unattendedReading(items);
    expect(reading.verdict).toBe("3 unattended");
    expect(reading.oldestLabel).toBe("2h");
    expect(unattendedReading([]).verdict).toBe("Nothing unattended");
  });

  test("etime and durations", () => {
    expect(etimeSeconds("02:03")).toBe(123);
    expect(etimeSeconds("1:02:03")).toBe(3723);
    expect(etimeSeconds("2-00:00:00")).toBe(172800);
    expect(etimeSeconds("bad")).toBeUndefined();
    expect(formatDuration(3723)).toBe("1h02m");
    expect(formatDuration(90000)).toBe("1d1h");
  });
});

describe("budgets and subsystems", () => {
  test("peakQuota: the fullest window, none when nothing is read", () => {
    expect(peakQuota(null)).toBeNull();
    expect(peakQuota([])).toBeNull();
    expect(peakQuota([
      { id: "a", label: "A", kind: "quota", fill: 0.2 },
      { id: "b", label: "B", kind: "quota", fill: 0.7 },
      { id: "c", label: "C", kind: "status" },
    ])?.id).toBe("b");
  });

  test("subsystems read empty sources as empty, never as figures", () => {
    const empty = subsystems(EMPTY_HOST_ADVISOR_DATA);
    expect(empty.map((s) => [s.key, s.state])).toEqual([
      ["broker", "UNKNOWN"],
      ["pty", "IDLE"],
      ["knowledge", "EMPTY"],
      ["mesh", "UNPAIRED"],
    ]);
    expect(empty.find((s) => s.key === "knowledge")?.action?.route).toEqual({ view: "search" });
    expect(subsystemSummary(empty)).toEqual({ verdict: "1 needs attention", figures: "2 idle · 1 empty · 1 unknown" });

    const up = subsystems({
      hostInfo: { ports: { broker: 65535 } } as never,
      terminalSessions: [{ id: "t" }],
      knowledgeStatus: { indexedSessions: 2 },
      pairingState: { trustedPeerCount: 1 } as never,
    });
    expect(up.map((s) => s.state)).toEqual(["UP", "ACTIVE", "INDEXED", "PAIRED"]);
    expect(subsystemSummary(up)).toEqual({ verdict: "All nominal", figures: "4 up" });
  });

  test("readHostAdvisor reads everything from one snapshot", () => {
    const model = readHostAdvisor(EMPTY_HOST_ADVISOR_DATA, [], NOW);
    expect(model.processes).toEqual([]);
    expect(model.attention).toBeNull();
    expect(model.unattended).toEqual([]);
    expect(model.peak).toBeNull();
    expect(model.subsystems.length).toBe(4);
  });
});
