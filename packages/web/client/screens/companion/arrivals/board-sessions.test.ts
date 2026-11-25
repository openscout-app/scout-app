import { describe, expect, test } from "bun:test";
import { classifyClaudeCodePrompt } from "@openscout/agent-sessions/adapters/claude-code/prompt-markup";
import { buildSessionBoardRows, type SessionBoardRow } from "../../sessions/session-board-model.ts";
import type { Agent, SessionEntry, WorkItem } from "../../../lib/types.ts";
import { boardEvents, isConversational, latestLines, mergeTailEvents, readRemark, sessionMachines, sessionPinId, sessionReads, sessionThreads, sessionTranscripts, withIdentity, type SessionRead } from "./board-sessions-model.ts";
import type { TailDiscoveredProcess, TailDiscoveredTranscript } from "../../../lib/types.ts";
import { QUIET_AFTER_MS } from "./board-motion.ts";
import { passActivity, plottedSession, stripWorthy } from "./board-strip.ts";
import { tailSessionOf, tapInTarget } from "./tap-in-model.ts";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import type { TailEvent } from "../../../lib/types.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { faceSeed, figureIdOf } from "../system-corner/system-corner-model.ts";

const NOW = 1_800_000_000_000;
const row = (over: Partial<SessionBoardRow>): SessionBoardRow => ({
  key: `local:claude:${over.sessionId ?? "s1"}`, sessionId: "s1", selection: { sessionRef: "claude:s1" }, title: "Fix tests",
  harness: "claude", project: "/example/workstation-user/dev/openscout", branch: "main", model: null, machine: null, machineName: null,
  working: true, asks: false, lastActiveAt: NOW - 60_000, preview: "running bun test", origin: { kind: "unknown", label: "" },
  conversation: null, lane: null, ...over,
});

describe("sessionThreads", () => {
  test("a working session and an unread session both stay in departures", () => {
    const threads = sessionThreads([row({ sessionId: "a" }), row({ sessionId: "b", working: false })], [], NOW);
    expect(threads.map((t) => [t.handle, t.state])).toEqual([["claude", "working"], ["claude", "working"]]);
    expect(threads[0]!.facts).toContainEqual(["Project", "openscout"]);
    expect(threads[0]!.facts).toContainEqual(["Started", "natively"]);
  });
  test("skips sessions already on the board as work or as a request, and stale idle ones", () => {
    const work = [{ conversationId: "c1", claudeSessionId: "pinned" } as unknown as WorkItem];
    const threads = sessionThreads([
      row({ sessionId: "pinned" }),
      row({ sessionId: "asking", asks: true }),
      row({ sessionId: "old", working: false, lastActiveAt: NOW - 5 * 60 * 60_000 }),
      row({ sessionId: "keep" }),
    ], work, NOW);
    expect(threads.map((t) => t.id)).toEqual(["session:local:claude:keep"]);
  });
  test("a session that wrote nothing for two hours leaves either section, unless it asks", () => {
    // Killed mid-turn: no end line, so without the age-out it would read QUIET for good.
    const killed = row({ sessionId: "killed", working: true, lastActiveAt: NOW - 3 * 60 * 60_000 });
    const asking = row({ sessionId: "waits", working: false, lastActiveAt: NOW - 3 * 60 * 60_000 });
    const reads = sessionReads({ events: [], transcripts: [transcript("waits", { status: "waiting", statusUpdatedAt: NOW - 3 * 60 * 60_000, lastEventAt: NOW - 3 * 60 * 60_000 })] });
    const threads = sessionThreads([killed, asking], [], NOW, new Map(), reads);
    expect(threads.map((t) => [t.id, t.remark])).toEqual([["session:local:claude:waits", "ASKING"]]);
  });
  test("each native session has a face of its own: seeded by the web app's name for it, never the harness handle they share", () => {
    const threads = sessionThreads([row({ sessionId: "0f10496b-aaaa", key: "local:claude:0f10496b-aaaa", harness: "claude" }), row({ sessionId: "d158a9ca-bbbb", key: "local:claude:d158a9ca-bbbb", harness: "claude" })], [], NOW);
    expect(threads.map((t) => t.handle)).toEqual(["claude", "claude"]);
    expect(threads.map((t) => t.faceName).sort()).toEqual(["Claude 0f10496b", "Claude d158a9ca"]);
    expect(threads.map((t) => t.identityId).sort()).toEqual(["native:claude:0f10496b-aaaa", "native:claude:d158a9ca-bbbb"]);
    expect(new Set(threads.map(faceSeed)).size).toBe(2);
  });
  test("a session with no work attaches by its session id", () => {
    const [t] = sessionThreads([row({ working: true })], [], NOW);
    expect(t!.workId).toBeNull();
    expect(figureIdOf(t!)).toBe("session:s1");
    expect(sessionPinId("has/slash")).toBeNull();
  });
  test("a subagent folds into its parent: no row of its own, its work keeps the parent working", () => {
    const child = row({ sessionId: "c1", key: "local:claude:c1", working: true, lastActiveAt: NOW - 1_000, lane: { facts: { parentSessionId: "s1" } } as unknown as AgentLane });
    const threads = sessionThreads([row({ working: false, lastActiveAt: NOW - 3 * 60 * 60_000 }), child], [], NOW);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.state).toBe("working");
    expect(threads[0]!.facts).toContainEqual(["Subagents", "1 · 1 working"]);
  });

  test("latest lines skip harness notices, and unread rows keep their last activity", () => {
    const ev = (kind: TailEvent["kind"], summary: string, ts: number) => ({ id: String(ts), ts, source: "claude", sessionId: "s1", kind, summary }) as TailEvent;
    const latest = latestLines([
      ev("assistant", "All tests pass.", 1),
      ev("tool", "mcp__codex-cu__js Drag the row", 2),
      ev("user", 'The session "X" you started (local_1) finished a turn. It reported: hi', 3),
    ]);
    expect(latest.get("s1")).toEqual({ last: "js · Drag the row", said: "All tests pass." });
    const [idle] = sessionThreads([row({ working: false })], [], NOW, latest);
    expect(idle!.remark).toBe("IDLE");
    expect(idle!.now).toBe("js · Drag the row");
    const [busy] = sessionThreads([row({ working: true })], [], NOW, latest);
    expect(busy!.now).toBe("js · Drag the row");
  });
  test("a Scout-routed session reads the joined native Claude turn", () => {
    const observed = transcript("native-session", { agentName: "scout-session-relay-agent" });
    const conversation: SessionEntry = {
      id: "c-routed", kind: "direct", title: "Fix tests", participantIds: ["kimi", "scout-session"],
      agentId: "scout-session", agentName: "Opus", harness: "claude", sessionId: "scout-session",
      harnessSessionId: null, harnessLogPath: null, currentBranch: null,
      preview: "running bun test", messageCount: 1, lastMessageAt: NOW - 60_000, workspaceRoot: observed.cwd,
    };
    const events = [
      claude("native-session", "user", NOW - 20_000, { summary: "Run the checks" }),
      claude("native-session", "tool", NOW - 10_000, { summary: "Run the tests" }),
    ];
    const project = (tail: TailEvent[]) => {
      const rows = buildSessionBoardRows({
        conversations: [conversation], transcripts: [observed], events: tail,
        agents: [], attention: [], now: NOW,
      });
      expect(rows).toHaveLength(1);
      return sessionThreads(rows, [], NOW, latestLines(tail), sessionReads({ events: tail }))[0]!;
    };
    const thread = project(events);
    expect(thread).toMatchObject({
      id: "session:local:claude:scout-session", remark: "WORKING", now: "Run the tests",
      sessionRef: "session:claude:native-session", pinId: "session:scout-session", conversationId: "c-routed",
    });
    const target = tapInTarget(thread);
    expect(target).toMatchObject({ kind: "native", sessionId: "native-session", conversationId: "c-routed" });
    expect(tailSessionOf(target, null)).toBe("native-session");
    const activitySession = plottedSession(thread.pinId, thread.sessionRef);
    expect(activitySession).toBe("native-session");
    expect(passActivity(events, NOW).get(activitySession!)?.reduce((sum, count) => sum + count, 0)).toBe(1);
    const done = claude("native-session", "assistant", NOW - 1_000, {
      summary: "Checks passed.",
      raw: { message: { stop_reason: "end_turn" } },
    });
    expect(project([...events, done])).toMatchObject({ remark: "DONE", since: NOW - 1_000 });
    const unread = project([]);
    expect(unread).toMatchObject({ remark: "IDLE", now: "running bun test" });
    expect(stripWorthy(unread!.remark!, unread!.state === "asking")).toBe(true);
  });
  test("a Claude turn reads from its transcript: a tool call after the reply is working, end_turn is done", () => {
    const ev = (sessionId: string, kind: TailEvent["kind"], ts: number, stop?: string) =>
      ({ id: `${sessionId}${ts}`, ts, source: "claude", sessionId, kind, summary: "x", raw: stop ? { message: { stop_reason: stop } } : {} }) as TailEvent;
    const reads = sessionReads({ events: [
      ev("busy", "assistant", NOW - 5_000, "tool_use"), ev("busy", "tool", NOW - 4_000), ev("busy", "system", NOW - 3_000),
      ev("idle", "user", NOW - 9_000), ev("idle", "assistant", NOW - 8_000, "end_turn"), ev("idle", "other", NOW - 1_000),
    ] });
    expect(reads.get("busy")!.phase).toBe("working");
    expect(reads.get("idle")!.phase).toBe("done");
    // The read wins over the lane: an idle-looking row with a running turn departs.
    const [t] = sessionThreads([row({ sessionId: "busy", working: false })], [], NOW, new Map(), reads);
    expect(t!.state).toBe("working");
    expect(t!.remark).toBe("WORKING");
  });
});

// ── the remark: observed activity and missing observations ─────────────────

/** A Claude tail event as the runtime emits it: a user line carries the
 *  parts Claude Code's adapter split it into. */
const claude = (sessionId: string, kind: TailEvent["kind"], ts: number, over: Partial<TailEvent> = {}) => {
  const event = { id: `${sessionId}:${ts}`, ts, source: "claude", sessionId, kind, summary: "x", raw: {}, ...over } as TailEvent;
  if (kind === "user" && !event.prompt) event.prompt = classifyClaudeCodePrompt(event.summary, { meta: (event.raw as { isMeta?: unknown })?.isMeta === true });
  return event;
};
const codex = (sessionId: string, ts: number, type: string, payload: Record<string, unknown> = {}, kind: TailEvent["kind"] = "system") =>
  ({ id: `${sessionId}:${ts}`, ts, source: "codex", sessionId, kind, summary: type, raw: { type: "event_msg", payload: { type, ...payload } } }) as TailEvent;
const transcript = (sessionId: string, over: Partial<TailDiscoveredTranscript> = {}): TailDiscoveredTranscript => ({
  source: "claude", transcriptPath: `/x/${sessionId}.jsonl`, sessionId, cwd: "/example/workstation-user/dev/openscout", project: "openscout",
  harness: "unattributed" as TailDiscoveredTranscript["harness"], lastEventAt: NOW - 1_000, mtimeMs: NOW - 1_000, size: 1, ...over,
});
const proc = (cwd: string, source = "claude") => ({ pid: 1, ppid: 0, command: source, etime: "1:00", cwd, harness: "unattributed", parentChain: [], source }) as unknown as TailDiscoveredProcess;
/** A Claude process started with these arguments. */
const run = (cwd: string, args: string) => ({ ...proc(cwd), command: `claude ${args}` }) as TailDiscoveredProcess;
const uuid = (n: number) => `c1eac66a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const remark = (read: SessionRead | undefined, at = NOW) => readRemark(read, { working: false, at: 0 }, { last: "Run the board tests", said: "All green." }, at);

describe("the remark", () => {
  test("WORKING from a prompt, then DONE with how long it took and what it said", () => {
    const reads = sessionReads({ events: [
      claude("s", "user", NOW - 407_000),
      claude("s", "tool", NOW - 300_000),
      claude("s", "assistant", NOW - 1_000, { summary: "Shipped the pass.", raw: { message: { stop_reason: "end_turn" } } }),
    ] });
    const working = sessionReads({ events: [claude("s", "user", NOW - 60_000), claude("s", "tool", NOW - 2_000)] });
    expect(remark(working.get("s"))).toEqual({ remark: "WORKING", since: NOW - 60_000, now: "Run the board tests" });
    expect(remark(reads.get("s"))).toEqual({ remark: "DONE", since: NOW - 1_000, now: "took 6m 46s · Shipped the pass." });
  });

  test("turn_duration gives the exact length", () => {
    const reads = sessionReads({ events: [
      claude("s", "user", NOW - 500_000),
      claude("s", "assistant", NOW - 2_000, { summary: "Done.", raw: { message: { stop_reason: "end_turn" } } }),
      claude("s", "system", NOW - 1_000, { raw: { subtype: "turn_duration", durationMs: 407_000 } }),
    ] });
    expect(remark(reads.get("s")).now).toBe("took 6m 47s · Done.");
  });

  test("QUIET once a working session has written nothing for five minutes, since its last write", () => {
    const reads = sessionReads({ events: [claude("s", "user", NOW - 600_000), claude("s", "tool", NOW - QUIET_AFTER_MS)] });
    expect(remark(reads.get("s"))).toMatchObject({ remark: "QUIET", since: NOW - QUIET_AFTER_MS });
    expect(remark(reads.get("s"), NOW - 1).remark).toBe("WORKING");
  });

  test("STOPPED from a Claude interrupt, which is not a name or a now line", () => {
    const events = [
      claude("s", "user", NOW - 90_000, { summary: "Fix the board" }),
      claude("s", "tool", NOW - 60_000),
      claude("s", "user", NOW - 30_000, { summary: "[Request interrupted by user]" }),
    ];
    expect(remark(sessionReads({ events }).get("s"))).toEqual({ remark: "STOPPED", since: NOW - 30_000, now: "stopped after 1m 00s" });
    expect(boardEvents(events).map((e) => e.summary)).not.toContain("[Request interrupted by user]");
    expect(latestLines(events).get("s")!.last).toBe("x");
  });

  test("STOPPED from a Codex turn_aborted; Codex DONE takes task_complete's length and last message", () => {
    const stopped = sessionReads({ events: [codex("c", NOW - 50_000, "task_started"), codex("c", NOW - 20_000, "turn_aborted")] });
    expect(remark(stopped.get("c"))).toMatchObject({ remark: "STOPPED", since: NOW - 20_000, now: "stopped after 30s" });
    const done = sessionReads({ events: [codex("c", NOW - 50_000, "task_started"), codex("c", NOW - 1_000, "task_complete", { duration_ms: 49_000, last_agent_message: "Merged." })] });
    expect(remark(done.get("c"))).toMatchObject({ remark: "DONE", now: "took 49s · Merged." });
  });

  test("COMPACT from compact_boundary or Codex compacted, until the turn carries on", () => {
    const claudeCompact = sessionReads({ events: [claude("s", "user", NOW - 90_000), claude("s", "system", NOW - 5_000, { raw: { subtype: "compact_boundary" } })] });
    expect(remark(claudeCompact.get("s"))).toMatchObject({ remark: "COMPACT", since: NOW - 5_000 });
    const codexCompact = sessionReads({ events: [codex("c", NOW - 90_000, "task_started"), { ...codex("c", NOW - 5_000, "x"), raw: { type: "compacted", payload: {} } } as TailEvent] });
    expect(remark(codexCompact.get("c")).remark).toBe("COMPACT");
    const resumed = sessionReads({ events: [claude("s", "user", NOW - 90_000), claude("s", "system", NOW - 5_000, { raw: { subtype: "compact_boundary" } }), claude("s", "tool", NOW - 1_000)] });
    expect(remark(resumed.get("s"))).toMatchObject({ remark: "WORKING", since: NOW - 90_000 });
  });

  test("ASKING from a waiting registry status or a herdr ask, with what it asks", () => {
    const reads = sessionReads({ events: [], transcripts: [
      transcript("w", { status: "waiting", statusUpdatedAt: NOW - 4_000, waitingFor: "Permission request: Bash" }),
      transcript("h", { status: "busy", statusUpdatedAt: NOW - 9_000, attention: { kind: "ask", source: "herdr", reason: "Which branch?", since: NOW - 3_000 } }),
    ] });
    expect(remark(reads.get("w"))).toEqual({ remark: "ASKING", since: NOW - 4_000, now: "Permission request: Bash" });
    expect(remark(reads.get("h"))).toEqual({ remark: "ASKING", since: NOW - 3_000, now: "Which branch?" });
  });

  test("ENDED when the session's process is gone, from discovery's processes", () => {
    const transcripts = [transcript("gone", { cwd: "/example/workstation-user/dev/other" }), transcript("here"), transcript("sub", { cwd: "/example/workstation-user/dev/openscout/packages/web" })];
    const reads = sessionReads({ events: [], transcripts, processes: [proc("/example/workstation-user/dev/openscout")] });
    expect(remark(reads.get("gone"))).toEqual({ remark: "ENDED", since: NOW - 1_000, now: "The process ended" });
    expect(reads.get("here")!.phase).not.toBe("ended");
    expect(reads.get("sub")!.phase).not.toBe("ended");
    // No process list, or none of that harness: no verdict.
    expect(sessionReads({ events: [], transcripts }).get("gone")!.phase).toBeNull();
    expect(sessionReads({ events: [], transcripts, processes: [proc("/elsewhere", "codex")] }).get("gone")!.phase).toBeNull();
  });

  test("the registry status is preferred over the events; a newer interrupt still wins", () => {
    const events = [claude("s", "user", NOW - 90_000), claude("s", "assistant", NOW - 80_000, { raw: { message: { stop_reason: "end_turn" } } })];
    const busy = sessionReads({ events, transcripts: [transcript("s", { status: "busy", statusUpdatedAt: NOW - 10_000 })] });
    expect(remark(busy.get("s"))).toMatchObject({ remark: "WORKING", since: NOW - 10_000 });
    const idle = sessionReads({ events: [claude("s", "user", NOW - 90_000), claude("s", "tool", NOW - 2_000)], transcripts: [transcript("s", { status: "idle", statusUpdatedAt: NOW - 1_000 })] });
    expect(remark(idle.get("s"))).toMatchObject({ remark: "DONE", since: NOW - 1_000 });
    const stopped = sessionReads({ events: [...events, claude("s", "user", NOW - 5_000, { summary: "[Request interrupted by user]" })], transcripts: [transcript("s", { status: "busy", statusUpdatedAt: NOW - 10_000 })] });
    expect(remark(stopped.get("s")).remark).toBe("STOPPED");
    expect(sessionReads({ events: [], transcripts: [transcript("s", { title: "Board rewrites" })] }).get("s")!.title).toBe("Board rewrites");
  });

  test("a parent whose subagents or workflow agents are writing stays WORKING, not DONE", () => {
    const events = [
      claude("p", "user", NOW - 120_000),
      claude("p", "assistant", NOW - 60_000, { raw: { message: { stop_reason: "end_turn" } } }),
      claude("p", "tool", NOW - 2_000, { raw: { isSidechain: true, agentId: "a1" }, summary: "Edit arrivals.css" }),
    ];
    const reads = sessionReads({ events });
    expect(remark(reads.get("p"))).toMatchObject({ remark: "WORKING", since: NOW - 120_000 });
    // The subagent's line is not the parent's now line.
    expect(latestLines(events).get("p")!.last).not.toBe("Edit arrivals.css");
    // A workflow agent known only from discovery keeps it working too.
    const viaDiscovery = sessionReads({ events: events.slice(0, 2), transcripts: [transcript("wf", { parentSessionId: "p", subagentId: "agent-wf", lastEventAt: NOW - 3_000 })] });
    expect(remark(viaDiscovery.get("p")).remark).toBe("WORKING");
    // Once the children are quiet for five minutes, the turn reads DONE.
    expect(remark(reads.get("p"), NOW + QUIET_AFTER_MS).remark).toBe("DONE");
  });

  test("a /compact the operator ran is between turns: the row stays DONE, never COMPACT", () => {
    const turn = [
      claude("s", "user", NOW - 120_000, { summary: "Fix the board" }),
      claude("s", "assistant", NOW - 90_000, { summary: "Done.", raw: { message: { stop_reason: "end_turn" } } }),
      claude("s", "user", NOW - 60_000, { summary: "<command-name>/compact</command-name>\n<command-message>compact</command-message>" }),
    ];
    const after = [
      claude("s", "user", NOW - 29_000, { summary: "This session is being continued from a previous conversation that ran out of context.", raw: { isCompactSummary: true } }),
      claude("s", "user", NOW - 29_000, { summary: "<local-command-stdout>Compacted</local-command-stdout>" }),
    ];
    const boundary = (trigger?: string) => claude("s", "system", NOW - 30_000, { raw: { subtype: "compact_boundary", ...(trigger ? { compactMetadata: { trigger } } : {}) } });
    for (const events of [[...turn, boundary("manual"), ...after], [...turn, boundary(), ...after]]) {
      const read = sessionReads({ events }).get("s");
      expect(remark(read)).toEqual({ remark: "DONE", since: NOW - 90_000, now: "took 30s · Done." });
      expect(remark(read, NOW + 3 * 60 * 60_000).remark).toBe("DONE");
    }
    // A window that opens at the /compact: DONE since the boundary.
    const cut = sessionReads({ events: [turn[2]!, boundary("manual")] }).get("s");
    expect(remark(cut)).toMatchObject({ remark: "DONE", since: NOW - 30_000 });
  });

  test("an automatic compaction nothing followed reads QUIET after five minutes, like any silent turn", () => {
    const boundaryAt = NOW - QUIET_AFTER_MS - 1_000;
    const read = sessionReads({ events: [
      claude("s", "user", NOW - 3 * QUIET_AFTER_MS),
      claude("s", "tool", NOW - 2 * QUIET_AFTER_MS),
      claude("s", "system", boundaryAt, { raw: { subtype: "compact_boundary", compactMetadata: { trigger: "auto" } } }),
    ] }).get("s");
    expect(remark(read, boundaryAt + 1_000)).toMatchObject({ remark: "COMPACT", since: boundaryAt });
    expect(remark(read)).toMatchObject({ remark: "QUIET", since: boundaryAt });
  });

  test("an interrupt stays STOPPED when the registry then reports idle", () => {
    const events = [
      claude("s", "user", NOW - 60_000, { summary: "Fix the board" }),
      claude("s", "tool", NOW - 40_000),
      claude("s", "user", NOW - 30_000, { summary: "[Request interrupted by user]" }),
    ];
    const reads = sessionReads({ events, transcripts: [transcript("s", { status: "idle", statusUpdatedAt: NOW - 29_990 })], discoveredAt: NOW - 1_000 });
    expect(remark(reads.get("s"))).toEqual({ remark: "STOPPED", since: NOW - 30_000, now: "stopped after 30s" });
  });

  test("the registry is as new as discovery's read: lines written after it decide", () => {
    // Busy when discovery ran; the turn ended after.
    const ended = sessionReads({
      events: [claude("s", "user", NOW - 90_000), claude("s", "assistant", NOW - 30_000, { summary: "finished", raw: { message: { stop_reason: "end_turn" } } })],
      transcripts: [transcript("s", { status: "busy", statusUpdatedAt: NOW - 100_000 })],
      discoveredAt: NOW - 60_000,
    });
    expect(remark(ended.get("s"))).toEqual({ remark: "DONE", since: NOW - 30_000, now: "took 1m 00s · finished" });
    // Idle when discovery ran; a new prompt came after.
    const prompted = sessionReads({
      events: [
        claude("s", "user", NOW - 90_000), claude("s", "assistant", NOW - 80_000, { raw: { message: { stop_reason: "end_turn" } } }),
        claude("s", "user", NOW - 20_000), claude("s", "tool", NOW - 10_000),
      ],
      transcripts: [transcript("s", { status: "idle", statusUpdatedAt: NOW - 80_000 })],
      discoveredAt: NOW - 30_000,
    });
    expect(remark(prompted.get("s"))).toMatchObject({ remark: "WORKING", since: NOW - 20_000 });
  });

  test("busy is WORKING since the turn's start, through an answered ask, or since the flip when its prompt is unread", () => {
    // The status flipped back to busy when an ask was answered, mid-turn.
    const answered = sessionReads({
      events: [claude("s", "user", NOW - 120_000), claude("s", "tool", NOW - 100_000)],
      transcripts: [transcript("s", { status: "busy", statusUpdatedAt: NOW - 30_000 })],
      discoveredAt: NOW - 5_000,
    });
    expect(remark(answered.get("s"))).toMatchObject({ remark: "WORKING", since: NOW - 120_000 });
    // A busy flip after the newest end: a new turn whose prompt is not in the window yet.
    const unread = sessionReads({
      events: [claude("s", "user", NOW - 200_000), claude("s", "assistant", NOW - 150_000, { raw: { message: { stop_reason: "end_turn" } } })],
      transcripts: [transcript("s", { status: "busy", statusUpdatedAt: NOW - 20_000 })],
      discoveredAt: NOW - 10_000,
    });
    expect(remark(unread.get("s"))).toMatchObject({ remark: "WORKING", since: NOW - 20_000 });
  });

  test("ENDED goes by the process a session was started for", () => {
    const [a, b, c] = [uuid(1), uuid(2), uuid(3)];
    const transcripts = [transcript(a), transcript(b), transcript(c)];
    const here = "/example/workstation-user/dev/openscout";
    // `--resume a` runs a, so it keeps neither b nor c alive.
    const named = sessionReads({ events: [], transcripts, processes: [run(here, `--resume ${a}`), run(here, `--session-id=${c}`)] });
    expect([named.get(a)!.phase, named.get(b)!.phase, named.get(c)!.phase]).toEqual([null, "ended", null]);
    // A fork runs a session of its own, so it could be any session in its folder.
    const forked = sessionReads({ events: [], transcripts, processes: [run(here, `--resume ${a} --fork-session`)] });
    expect([forked.get(a)!.phase, forked.get(b)!.phase]).toEqual([null, null]);
    // A line written after the scan is from a live process.
    const wrote = sessionReads({ events: [claude(b, "tool", NOW - 1_000)], transcripts, processes: [run(here, `--resume ${a}`)], discoveredAt: NOW - 5_000 });
    expect(wrote.get(b)!.phase).toBe("working");
  });

  test("a parent read only through its subagents stays WORKING while they write, since its own last write", () => {
    const reads = sessionReads({ events: [], transcripts: [
      transcript("p", { lastEventAt: NOW - 600_000, mtimeMs: NOW - 600_000 }),
      transcript("sub", { parentSessionId: "p", subagentId: "agent-a1", lastEventAt: NOW - 2_000 }),
    ] });
    expect(reads.get("p")!.phase).toBeNull();
    expect(readRemark(reads.get("p"), { working: false, at: 5 }, undefined, NOW)).toMatchObject({ remark: "WORKING", since: NOW - 600_000 });
    expect(readRemark(reads.get("p"), { working: false, at: 5 }, undefined, NOW + QUIET_AFTER_MS).remark).toBe("IDLE");
  });

  test("a shell-mode command and its output neither start a turn nor name the row", () => {
    const events = [
      claude("s", "user", NOW - 60_000, { summary: "Deploy the site" }),
      claude("s", "assistant", NOW - 30_000, { summary: "deployed", raw: { message: { stop_reason: "end_turn" } } }),
      claude("s", "user", NOW - 10_000, { summary: "<bash-input>git status</bash-input>" }),
      claude("s", "user", NOW - 9_000, { summary: "<bash-stdout>nothing to commit</bash-stdout><bash-stderr></bash-stderr>" }),
    ];
    expect(remark(sessionReads({ events }).get("s"))).toEqual({ remark: "DONE", since: NOW - 30_000, now: "took 30s · deployed" });
    expect(boardEvents(events).map((e) => e.summary)).toEqual(["Deploy the site", "deployed"]);
    expect(latestLines(events).get("s")).toEqual({ last: "deployed", said: "deployed" });
  });

  test("what a session said is the agent's line, never the operator's prompt after it", () => {
    const latest = latestLines([
      claude("s", "assistant", 1, { summary: "All tests pass." }),
      claude("s", "user", 2, { summary: "Now ship it" }),
    ]);
    expect(latest.get("s")).toEqual({ last: "Now ship it", said: "All tests pass." });
    expect(latestLines([claude("s", "user", 1, { summary: "Fix it" })]).get("s")!.said).toBeNull();
  });

  test("a missing turn read stays unknown until activity is observed", () => {
    expect(readRemark(undefined, { working: true, at: 5 }, undefined, NOW)).toEqual({ remark: "WORKING", since: 5, now: null });
    expect(readRemark(undefined, { working: false, at: 5 }, { last: "Read x", said: "Hi." }, NOW)).toEqual({ remark: "IDLE", since: 5, now: "Read x" });
  });
});

describe("live push", () => {
  const e = (id: string, ts: number, over: Partial<TailEvent> = {}) => ({ id, ts, source: "claude", sessionId: "s", kind: "tool", summary: id, ...over }) as TailEvent;

  test("one line once, however it arrived; a Claude line by its uuid, since ids collide across readers", () => {
    const pushed = [e("s:10", 10, { raw: { uuid: "u1" } }), e("s:11", 11)];
    const polled = [e("s:3", 10, { raw: { uuid: "u1" } }), e("s:11", 11)];
    expect(mergeTailEvents(pushed, polled, 10)).toHaveLength(2);
    // A subagent's line under its parent's id is not the parent's line.
    expect(mergeTailEvents([e("s:12", 12, { raw: { uuid: "u2" } })], [e("s:12", 13, { raw: { uuid: "u3" } })], 10)).toHaveLength(2);
  });

  test("a Codex line read by two readers is one line; a different line at the same time is not", () => {
    const line = codex("c", 10, "task_complete", { last_agent_message: "Merged." });
    const again = { ...line, id: "c:other-reader-7" } as TailEvent;
    expect(mergeTailEvents([line], [again], 10)).toHaveLength(1);
    expect(mergeTailEvents([line], [codex("c", 10, "token_count")], 10)).toHaveLength(2);
  });

  test("over the cap, subagent lines go first, so a busy subagent never pushes out its parent's turn", () => {
    const own = [e("prompt", 1, { kind: "user", summary: "Audit the routes" }), e("task", 2, { summary: "Task: audit routes" })];
    const flood = Array.from({ length: 20 }, (_, i) => e(`sub${i}`, 3 + i, { raw: { isSidechain: true, agentId: "a1" } }));
    const merged = mergeTailEvents(own, flood, 10);
    expect(merged).toHaveLength(10);
    expect(merged.slice(0, 2).map((x) => x.id)).toEqual(["prompt", "task"]);
    expect(merged.at(-1)!.id).toBe("sub19");
    expect(sessionReads({ events: merged }).get("s")!.phase).toBe("working");
    expect(latestLines(merged).get("s")!.last).toBe("Task: audit routes");
  });

  test("oldest first, the newest kept to the cap", () => {
    const merged = mergeTailEvents([e("a", 3), e("b", 1)], [e("c", 2), e("d", 4)], 3);
    expect(merged.map((x) => x.id)).toEqual(["c", "a", "d"]);
  });

  test("a poll merges: an older window does not clobber what was pushed since", () => {
    const pushed = mergeTailEvents([e("old", 1)], [e("new", 50)], 100);
    const afterPoll = mergeTailEvents(pushed, [e("old", 1), e("mid", 20)], 100);
    expect(afterPoll.map((x) => x.id)).toEqual(["old", "mid", "new"]);
  });

  test("only what a session said or did counts as read", () => {
    expect(isConversational(e("a", 1, { kind: "system" }))).toBe(false);
    expect(isConversational(e("a", 1, { kind: "assistant" }))).toBe(true);
    // A subagent's line carries its parent's id but is not the parent's own.
    expect(isConversational(e("a", 1, { kind: "assistant", raw: { isSidechain: true } }))).toBe(false);
  });

  test("a compaction's continuation summary never names a row", () => {
    const events = [
      claude("s", "user", 1, { summary: "This session is being continued from a previous conversation that ran out of context." }),
      claude("s", "user", 2, { summary: "Another Claude session sent a message:\n<agent-message from=\"a9c0\">\nhi\n</agent-message>" }),
      claude("s", "user", 3, { summary: "Ship it", raw: { isMeta: true } }),
    ];
    expect(boardEvents(events)).toHaveLength(0);
  });
});

describe("what Tap in reads off discovery", () => {
  test("each session's title, registry status, wait and ask, by session id", () => {
    const ask = { kind: "ask" as const, source: "registry" as const, reason: "Bash", since: NOW - 5_000 };
    const map = sessionTranscripts([
      transcript("s1", { title: "Port the rail", status: "waiting", waitingFor: "approve Bash", attention: ask }),
      transcript("s2"),
    ]);
    expect(map.get("s1")).toEqual({ title: "Port the rail", status: "waiting", waitingFor: "approve Bash", attention: ask });
    expect(map.get("s2")).toEqual({ title: null, status: null, waitingFor: null, attention: null });
  });
  test("a child worker's transcript is not its parent's; the newer of two under one id wins", () => {
    const map = sessionTranscripts([
      transcript("s1", { title: "Parent", lastEventAt: NOW - 60_000 }),
      transcript("s1", { title: "Worker", parentSessionId: "s1", subagentId: "agent-1", lastEventAt: NOW }),
      transcript("s1", { title: "Parent, renamed", lastEventAt: NOW - 1_000 }),
    ]);
    expect(map.get("s1")?.title).toBe("Parent, renamed");
    expect(map.size).toBe(1);
  });
  test("a transcript with no session id is read by its file name", () => {
    const map = sessionTranscripts([transcript("", { sessionId: null, transcriptPath: "/x/abc.jsonl", title: "Unnamed" })]);
    expect(map.get("abc")?.title).toBe("Unnamed");
  });
  test("the machine a row runs on, by board row id; this Mac's rows name none", () => {
    const rows = [
      row({ sessionId: "here", machine: "node-local", selection: { sessionRef: "claude:here", machineId: "node-local" } }),
      row({ sessionId: "there", machine: "node-mini", selection: { sessionRef: "claude:there", machineId: "node-mini" } }),
    ];
    const map = sessionMachines(rows, "node-local");
    expect([...map]).toEqual([["session:local:claude:there", "node-mini"]]);
    // The thread id the board gives the row is the key.
    expect(sessionThreads(rows, [], NOW).map((t) => t.id)).toContain("session:local:claude:there");
  });
  test("no machine is named until this Mac's node id is known", () => {
    expect(sessionMachines([row({ sessionId: "there", machine: "node-mini" })], null).size).toBe(0);
  });
});


describe("board identity enrichment", () => {
  const work = [{ id: "w1", ownerId: "session-owner", conversationId: "c1" }] as WorkItem[];
  const thread = { id: "w1", workId: "w1", conversationId: "c1", handle: "handel", request: null } as CornerThread;
  const conversation = { id: "c1", agentId: "session-owner", harness: "codex", workspaceRoot: "/example/workstation-user/dev/openscout", currentBranch: "main", participants: [] } as unknown as SessionEntry;

  test("a work owner missing from the bounded roster still has a real conversation identity", () => {
    expect(withIdentity([thread], work, [], [conversation])[0]).toMatchObject({ harness: "codex", project: "openscout", branch: "main" });
  });
  test("uses an exact participant, never the requester or another channel member", () => {
    const room = { ...conversation, agentId: "someone-else", harness: "claude", workspaceRoot: "/other/repo", participants: [
      { actorId: "operator", harness: "bridge", workspaceRoot: "/operator/repo" },
      { actorId: "session-owner", harness: "grok-acp", workspaceRoot: "/example/operator/dev/peal" },
    ] } as SessionEntry;
    expect(withIdentity([thread], work, [], [room])[0]).toMatchObject({ harness: "grok-acp", project: "peal", branch: null });
    expect(withIdentity([thread], work, [], [{ ...room, participants: room.participants!.slice(0, 1) }])[0]).toMatchObject({ harness: null, project: null });
  });
  test("fills null fields independently, including a roster cwd, without overwriting observed facts", () => {
    const agent = { id: "session-owner", harness: "codex", cwd: "/dev/arc", branch: "next" } as Agent;
    expect(withIdentity([{ ...thread, harness: "claude", project: null }], work, [agent])[0]).toMatchObject({ harness: "claude", project: "arc", branch: "next" });
    expect(withIdentity([{ ...thread, harness: "claude", project: "pinned-repo", branch: "topic" }], work, [agent], [conversation])[0]).toMatchObject({ harness: "claude", project: "pinned-repo", branch: "topic" });
  });
  test("matching names are not identity evidence", () => {
    expect(withIdentity([thread], work, [{ id: "other", name: "handel", harness: "claude", project: "wrong" } as Agent])[0]).toMatchObject({ harness: null, project: null });
  });
  test("session-backed rows can recover missing project from their exact conversation", () => {
    const session = { ...thread, workId: null, harness: "codex", pinId: "session:native-id" };
    expect(withIdentity([session], [], [], [{ ...conversation, harnessSessionId: "native-id" }])[0]).toMatchObject({ harness: "codex", project: "openscout" });
  });
  test("pinned harness takes precedence over its operator's harness", () => {
    expect(withIdentity([thread], [{ ...work[0]!, ownerId: "operator", claudeSessionId: "native-id" }], [{ id: "operator", harness: "bridge" } as Agent], [{ ...conversation, harness: "claude", harnessSessionId: "native-id" }])[0]).toMatchObject({ harness: "claude", project: "openscout" });
  });
});
