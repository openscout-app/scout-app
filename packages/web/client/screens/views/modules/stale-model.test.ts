import { describe, expect, test } from "bun:test";
import type { SessionEntry, TailDiscoverySnapshot } from "../../../lib/types.ts";
import { unattendedItems, type UnattendedItem } from "../../ops/host-advisor-model.ts";
import { STALE_AFTER_SECONDS, staleRows } from "./stale-model.ts";

const NOW = 1_800_000_000_000;
type Process = TailDiscoverySnapshot["processes"][number];

const relayProc = (pid: number, etime: string, cwd = "/dev/openscout"): Process =>
  ({ pid, ppid: 1, command: `claude --append-system-prompt session-${pid}`, etime, cwd, harness: "claude", parentChain: [], source: "claude" }) as unknown as Process;

const session = (id: string, quietMs: number, root = "/dev/lattices"): SessionEntry =>
  ({ id, title: id, kind: "direct", participantIds: [], agentId: null, agentName: null, harness: "codex", harnessSessionId: null, harnessLogPath: null, currentBranch: null, preview: null, messageCount: 3, lastMessageAt: NOW - quietMs, workspaceRoot: root }) as SessionEntry;

describe("what is stale", () => {
  const items = unattendedItems(
    [relayProc(91187, "3-20:00:00"), relayProc(12848, "03:11:00"), relayProc(5000, "01:59:00"), { ...relayProc(6000, "05:00:00"), command: "claude" }],
    { gitBranch: "ui-dev" },
    [session("lattices-descartes", 4.8 * 3_600_000), session("openscout-locke-9", 2.9 * 3_600_000, "/dev/openscout"), session("fresh", 1.5 * 3_600_000)],
    NOW,
  );

  test("quiet past two hours and still holding a process or a thread; the branch holds nothing", () => {
    expect(staleRows(items).map((r) => r.name)).toEqual(["session-91187", "lattices-descartes", "session-12848", "openscout-locke-9"]);
  });

  test("oldest first", () => {
    const ages = staleRows(items).map((r) => r.ageSeconds);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
  });

  test("a session holds its pid and opens in Tail; a relay holds a thread and opens its chat", () => {
    const [proc, relay] = staleRows(items);
    expect(proc).toMatchObject({ kind: "session", where: "claude · openscout", holds: "holds pid 91187", action: { label: "Open in Tail", route: { view: "ops", mode: "mission" } } });
    expect(relay).toMatchObject({ kind: "relay", where: "relay · lattices", holds: "holds a thread", action: { label: "Open chat", route: { view: "conversation", conversationId: "lattices-descartes" } } });
  });

  test("the threshold is two hours, inclusive", () => {
    const at = (ageSeconds: number | undefined): UnattendedItem => ({
      id: `x-${ageSeconds}`,
      kind: "unresumed_session",
      title: "t",
      subtitle: "",
      ageLabel: "",
      ageSeconds,
      conversationId: "c",
      severity: "info",
      actionLabel: "Open Chat",
      actionRoute: { view: "conversation", conversationId: "c" },
    });
    expect(staleRows([at(STALE_AFTER_SECONDS - 1)])).toEqual([]);
    expect(staleRows([at(STALE_AFTER_SECONDS)])).toHaveLength(1);
    // no age read: not counted
    expect(staleRows([at(undefined)])).toEqual([]);
  });
});
