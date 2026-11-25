import { describe, expect, test } from "bun:test";
import type { TailDiscoveredTranscript, TailEvent } from "../../../lib/types.ts";
import { homeRecent, homeRunning, plainLine, RUN_TRACE_STEP_MS, runningFor, runningGroups, runningProgress, runningProject, runningStep, runningTitle, runningTraces, type HomeRunning } from "./front-page-running.ts";

const NOW = new Date(2026, 10, 16, 14, 0).getTime();

function event(ts: number, kind: TailEvent["kind"], summary: string, sessionId = "live-claude"): TailEvent {
  return {
    id: `evt:${sessionId}:${ts}:${summary}`, ts, source: "claude", sessionId, pid: 1, parentPid: null,
    project: "demo-app", cwd: "/example/op/dev/demo-app", harness: "unattributed", kind, summary,
  };
}

describe("Running steps", () => {
  test("keep the assistant's words and tool steps", () => {
    expect(runningStep({ kind: "assistant", summary: "Home reads the engine now. Next the checks." })).toBe("Home reads the engine now.");
    expect(runningStep({ kind: "tool", summary: "Find Mac app permission approval path" })).toBe("Find Mac app permission approval path");
  });

  test("leave out bracketed record kinds, thinking and tool output", () => {
    for (const summary of ["[attachment]", "[api-request]", "[system]", "[token_usage_record]", "[assistant]", "[thinking] I'm checking the route"]) {
      expect(runningStep({ kind: "other", summary })).toBeNull();
      expect(runningStep({ kind: "assistant", summary })).toBeNull();
    }
    expect(runningStep({ kind: "tool-result", summary: "res: server/routes/attention.ts:120" })).toBeNull();
    expect(runningStep({ kind: "user", summary: "Pasted content" })).toBeNull();
  });

  test("leave out timing, token and turn markers", () => {
    for (const summary of ["turn duration · 146476 ms", "task complete", "task started", "turn context · gpt-5 · high", "tokens · 120034", "file-history-snapshot · 82 file(s)", "away summary · stepped out"]) {
      expect(runningStep({ kind: "system", summary })).toBeNull();
      expect(runningStep({ kind: "tool", summary })).toBeNull();
    }
    expect(runningStep({ kind: "assistant", summary: "Done in 3400 ms" })).toBeNull();
  });

  test("a tool step reads as a verb and its target", () => {
    expect(runningStep({ kind: "tool", summary: "mcp__lattices__windows_search Scout" })).toBe("windows search Scout");
    expect(runningStep({ kind: "tool", summary: "cd /example/op/dev/demo-app && git status" })).toBe("git status");
    expect(runningStep({ kind: "tool", summary: "python3 - <<'PY' from pathlib import Path" })).toBe("Run a python3 script");
    expect(runningStep({ kind: "tool", summary: "request_user_input_async" })).toBe("request user input async");
    expect(runningStep({ kind: "assistant", summary: "Rex hit a **connection problem** at `5:18`." })).toBe("Rex hit a connection problem at 5:18.");
    expect(runningStep({ kind: "tool", summary: "ToolSearch select:mcp__lattices__browser_open" })).toBeNull();
    expect(runningStep({ kind: "tool", summary: "SubagentHandback ## Restart map" })).toBeNull();
    expect(runningStep({ kind: "tool", summary: `grep ${"x".repeat(300)}` })!.length).toBeLessThanOrEqual(140);
  });
});

describe("Running titles", () => {
  test("the work item's title leads, then the session's name, then who runs it", () => {
    expect(runningTitle({ work: "Ship Home", session: "Home study", name: "hawking-14" })).toBe("Ship Home");
    expect(runningTitle({ work: null, session: "Home study", name: "hawking-14" })).toBe("Home study");
    expect(runningTitle({ work: null, session: null, name: "hawking-14" })).toBe("hawking-14");
  });

  test("never a placeholder or a runtime id", () => {
    expect(runningTitle({ work: "Pasted content", session: "Home study", name: "hawking-14" })).toBe("Home study");
    expect(runningTitle({ work: "[Pasted text #1]", session: "Pasted content", name: "hawking-14" })).toBe("hawking-14");
    expect(runningTitle({ work: "Previous task inv-request-5627ab (completed)", session: null, name: "hawking-14" })).toBe("hawking-14");
    expect(runningTitle({ work: "Continue from where you left off. Note: this session was compacted", session: "Home study", name: "hawking-14" })).toBe("Home study");
  });

  test("a session id never titles it: the project does", () => {
    expect(runningTitle({ work: null, session: "session-mwk08za6-wf2ea5-relay-agent", project: "demo-app-home-pov-product", name: "Session Mwk08za6 Wf2ea5" }))
      .toBe("demo-app-home-pov-product");
  });

  test("a long work title reads as its first sentence", () => {
    expect(runningTitle({ work: "Good work. Two fixes on #1969 before the operator reviews.", session: null, name: "x" })).toBe("Good work.");
  });
});

describe("Running progress and time", () => {
  test("progress is a sentence, never a delivery receipt or an id", () => {
    expect(runningProgress("Session Mwjmvsub 5l4ad5 acknowledged via attach.")).toBeNull();
    expect(runningProgress("demo-app-dvorak-3 queued for local execution.")).toBeNull();
    expect(runningProgress("alias project-kierkegaard-5 → session-mwjthkcj-ziu5bx (scout, codex) acknowledged via steer.")).toBeNull();
    expect(runningProgress("Home reads the engine now. Next the checks.")).toBe("Home reads the engine now.");
    expect(runningProgress("1. Ship it")).toBeNull();
    expect(runningProgress("Kimi's ten sentences, exactly as written: 1. First")).toBe("Kimi's ten sentences, exactly as written");
  });

  test("how long work has been going", () => {
    expect(runningFor(NOW - 20_000, NOW)).toBe("under a minute");
    expect(runningFor(NOW - 4 * 60_000, NOW)).toBe("4m");
    expect(runningFor(NOW - 130 * 60_000, NOW)).toBe("2h 10m");
    expect(runningFor(NOW - 3 * 86_400_000, NOW)).toBe("3d");
  });
});

describe("Running items", () => {
  const transcript = {
    source: "claude", transcriptPath: "/tmp/live-claude.jsonl", sessionId: "live-claude",
    cwd: "/example/op/dev/demo-app-home-pov-product", project: "demo-app", harness: "unattributed", mtimeMs: NOW, size: 1200,
    title: "session-mwk08za6-wf2ea5-relay-agent",
  } as TailDiscoveredTranscript;

  test("no tool or command lines: the agent's newest words are its progress", () => {
    const tailEvents = [
      event(NOW - 60_000, "user", "n by your judgment, not a fixed dashboard. (3) Right pane: dynamic and contextual"),
      event(NOW - 50_000, "tool", "browser open http://127.0.0.1:43191/feed"),
      event(NOW - 30_000, "assistant", "The stream renders now. Next the light shot."),
      event(NOW - 20_000, "tool", "cd /example/op/dev/demo-app && git status"),
    ];
    const [item] = homeRunning({ agents: [], tailEvents, transcripts: [transcript], processes: [], nowMs: NOW });
    expect(item).toBeDefined();
    expect(item!.project).toBe("demo-app");
    expect(item!.title).toBe("Home pov product");
    expect(item!.title).not.toContain("session-");
    expect(item!.agent.name).not.toMatch(/mwk08za6/i);
    expect(item!.progress).toBe("The stream renders now.");
    expect(item!.since).toBeNull();
  });

  test("a session an open request names waits on you", () => {
    const tailEvents = [event(NOW - 20_000, "assistant", "Asking before I push the branch.")];
    const run = (requests: { agentId: string | null; permission?: { sessionId: string } }[]) =>
      homeRunning({ agents: [], tailEvents, transcripts: [transcript], processes: [], requests, nowMs: NOW })[0]!;
    expect(run([{ agentId: null, permission: { sessionId: "live-claude" } }]).state).toBe("waiting");
    expect(run([{ agentId: null, permission: { sessionId: "another-session" } }]).state).not.toBe("waiting");
  });

  test("a waiting session is waiting since its oldest open request", () => {
    const tailEvents = [event(NOW - 20_000, "assistant", "Asking before I push the branch.")];
    const [item] = homeRunning({
      agents: [], tailEvents, transcripts: [transcript], processes: [], nowMs: NOW,
      requests: [
        { agentId: null, permission: { sessionId: "live-claude" }, updatedAt: NOW - 90_000 },
        { agentId: null, permission: { sessionId: "live-claude" }, updatedAt: NOW - 30_000 },
      ],
    });
    expect(item!.state).toBe("waiting");
    expect(item!.stateSince).toBe(NOW - 90_000);
  });

  test("a working session is working since its newest prompt", () => {
    const tailEvents = [
      event(NOW - 600_000, "user", "Earlier ask"),
      event(NOW - 120_000, "user", "Ship the mark"),
      event(NOW - 5_000, "assistant", "Writing the card now."),
    ];
    const [item] = homeRunning({ agents: [], tailEvents, transcripts: [transcript], processes: [], nowMs: NOW });
    expect(item!.state).toBe("working");
    expect(item!.stateSince).toBe(NOW - 120_000);
  });

  test("its references come from what the client reads, and are null when nothing says", () => {
    const tailEvents = [event(NOW - 20_000, "assistant", "The stream renders now.")];
    const pr = { label: "#2030", state: "open" as const, url: "https://github.com/o/r/pull/2030" };
    const [item] = homeRunning({
      agents: [], tailEvents, transcripts: [transcript], processes: [], nowMs: NOW,
      sessionPrs: new Map([["live-claude", pr]]),
    });
    expect(item!.refs.pr).toEqual(pr);
    expect(item!.refs.worktree).toBe("/example/op/dev/demo-app-home-pov-product");
    // A session the runtime only observes has no recorded host and no terminal pane.
    expect(item!.refs.host).toBeNull();
    expect(item!.refs.terminal).toBeNull();
  });

  test("a cut-off prompt never titles it: the work item's title does", () => {
    const tailEvents = [event(NOW - 20_000, "user", "n by your judgment, not a fixed dashboard. (3)…")];
    const run = (workTitles?: Map<string, string>) => homeRunning({ agents: [], tailEvents, transcripts: [transcript], processes: [], workTitles, nowMs: NOW })[0]!;
    expect(run(new Map([["live-claude", "Make Home the Feed"]])).title).toBe("Make Home the Feed");
    expect(run().title).not.toContain("judgment");
  });
});

describe("Running reads organized", () => {
  test("a line is plain text: no markdown, no raw links", () => {
    expect(plainLine("Draft PR: [#1970](https://github.com/example-org/demo-app/pull/1970) is **ready**."))
      .toBe("Draft PR: #1970 is ready.");
    expect(plainLine("PR: https://github.com/hudsonkit/arc/pull/51 (base docs).")).toBe("PR: #51 (base docs).");
    expect(plainLine("See <https://openscout.app/docs/setup> and `bun run check`")).toBe("See openscout.app and bun run check");
    expect(plainLine("## Restart map\n- one\n- two")).toBe("Restart map one two");
    expect(plainLine("a *quiet* note")).toBe("a quiet note");
    expect(plainLine("Opened PR #1984: **#1984**.")).toBe("Opened PR #1984.");
    expect(plainLine("Opened PR #1984: example-org/demo-app#1984.")).toBe("Opened PR #1984.");
    expect(plainLine("Opened [PR #1984](https://github.com/o/r/pull/1984): https://github.com/o/r/pull/1984")).toBe("Opened PR #1984");
    expect(plainLine("Committed locally: b2e2e2aea6f51d3814f4f286967d593d7ced5ef3.")).toBe("Committed locally: b2e2e2a.");
  });

  test("a copy of a repository groups with the repository", () => {
    const known = ["scout", "demo-app", "arc"];
    expect(runningProject("demo-app-home-running", known)).toEqual({ project: "demo-app", rest: "home-running" });
    expect(runningProject("demo-app", known)).toEqual({ project: "demo-app", rest: null });
    expect(runningProject("scout-ios-push", known)).toEqual({ project: "scout", rest: "ios-push" });
    expect(runningProject("hudson", known)).toEqual({ project: "hudson", rest: null });
  });

  const row = (id: string, project: string, state: HomeRunning["state"], at: number): HomeRunning => ({
    id, project, state, at, title: id, agent: { name: "a", harness: "claude" }, since: null, stateSince: null, progress: null, trace: [], open: null,
    refs: { pr: null, branch: null, worktree: null, projectPath: null, host: null, harness: null, model: null, terminal: null },
  });

  test("grouped by project, what waits on you first, then working, then idle", () => {
    const rows = [
      row("idle-apps", "demo-app", "idle", NOW),
      row("work-core", "scout", "working", NOW - 5_000),
      row("ask-apps", "demo-app", "waiting", NOW - 60_000),
      row("work-apps", "demo-app", "working", NOW - 1_000),
    ];
    const { groups, total, more } = runningGroups(rows);
    expect(groups.map((g) => g.project)).toEqual(["demo-app", "scout"]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["ask-apps", "work-apps", "idle-apps"]);
    expect(total).toBe(4);
    expect(more).toBe(0);
  });

  test("a session writing a line never reshuffles the list", () => {
    const before = [row("b", "scout", "working", NOW - 9_000), row("a", "arc", "working", NOW - 5_000), row("c", "scout", "working", NOW - 1_000)];
    const after = before.map((r) => (r.id === "b" ? { ...r, at: NOW } : r));
    const order = (rows: HomeRunning[]) => runningGroups(rows).groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(order(after)).toEqual(order(before));
    expect(order(before)).toEqual(["a", "b", "c"]);
  });

  test("capped, with the rest counted for All sessions", () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`s${i}`, i % 2 ? "scout" : "arc", "working", NOW - i * 1_000));
    const { groups, more } = runningGroups(rows, 6);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(6);
    expect(more).toBe(3);
  });
});

describe("runningTraces", () => {
  test("a session's tail events land in two-minute columns, newest on the right, as lit dots", () => {
    const NOW = 10_000_000;
    const at = (ts: number, sessionId = "s1") => ({ id: `${sessionId}-${ts}`, ts, sessionId }) as TailEvent;
    const events = [
      at(NOW - 10), at(NOW - 20), at(NOW - 30), // three in the newest column
      ...Array.from({ length: 12 }, (_, i) => at(NOW - 3 * RUN_TRACE_STEP_MS + i + 1)), // twelve, three columns back
      at(NOW - 40 * 60_000), // before the trace
      at(NOW - 5, "s2"),
    ];
    const traces = runningTraces(events, NOW);
    const s1 = traces.get("s1")!;
    expect(s1).toHaveLength(16);
    expect(s1.at(-1)).toBe(2);
    expect(s1.at(-3)).toBe(4);
    expect(s1.filter(Boolean)).toHaveLength(2);
    expect(traces.get("s2")!.at(-1)).toBe(1);
    expect(traces.has("s3")).toBe(false);
  });
});

describe("Active lately", () => {
  const MIN = 60_000;
  function transcript(sessionId: string, agoMin: number, extra: Partial<TailDiscoveredTranscript> = {}): TailDiscoveredTranscript {
    return {
      source: "claude", transcriptPath: `/t/${sessionId}.jsonl`, sessionId, cwd: "/example/op/dev/demo-app-home-side",
      project: "demo-app-home-side", harness: "claude", lastEventAt: NOW - agoMin * MIN, mtimeMs: NOW - agoMin * MIN, size: 1,
      ...extra,
    } as TailDiscoveredTranscript;
  }

  test("lists the sessions whose transcript moved in the window, newest first, by the project they work in", () => {
    const rows = homeRecent({
      running: [],
      transcripts: [transcript("a", 200, { title: "Feed topic" }), transcript("b", 20, { title: "Side column" }), transcript("old", 300)],
      projects: ["demo-app"],
      nowMs: NOW,
    });
    expect(rows.map((row) => row.title)).toEqual(["Side column", "Feed topic"]);
    expect(rows[0]).toMatchObject({ project: "demo-app", state: "idle", at: NOW - 20 * MIN, open: { view: "sessions", sessionId: "b" } });
  });

  test("leaves out what is at work now and child workers, and keeps Running's idle rows", () => {
    const busy = { id: "lane-busy", state: "working", at: NOW, open: { view: "sessions", sessionId: "busy" } } as unknown as HomeRunning;
    const idle = { id: "lane-idle", state: "idle", at: NOW - 10 * MIN, project: "scout", open: { view: "sessions", sessionId: "idle" } } as unknown as HomeRunning;
    const rows = homeRecent({
      running: [busy, idle],
      transcripts: [transcript("busy", 1), transcript("idle", 10), transcript("child", 5, { parentSessionId: "busy" })],
      nowMs: NOW,
    });
    expect(rows.map((row) => row.id)).toEqual(["lane-idle"]);
  });
});
