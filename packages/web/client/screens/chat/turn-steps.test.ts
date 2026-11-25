import { describe, expect, test } from "bun:test";
import {
  buildTurnStepScope,
  classifyTurnStepPhase,
  describeTurnLaunchPhase,
  deriveStepStatus,
  formatStepDuration,
  latestStepSummary,
  mergeTurnStepEvents,
  observeToolFailed,
  observeTurnSteps,
  summarizeTurnPhases,
  summarizeTurnSteps,
  summarizeTurnTrace,
  tailEventMatchesTurn,
  toTurnSteps,
  turnStepsToObserveEvents,
  turnTraceEvents,
} from "./turn-steps.ts";
import type { Agent, Flight, ObserveEvent, SessionEntry, TailEvent } from "../../lib/types.ts";

function tailEvent(overrides: Partial<TailEvent> & { id: string }): TailEvent {
  return {
    ts: 1_700_000_000_000,
    source: "claude",
    sessionId: "sess-abc",
    pid: 1,
    parentPid: null,
    project: "openscout",
    cwd: "/example/workstation-user/dev/openscout",
    harness: "claude",
    kind: "tool",
    summary: "Bash(bun test)",
    ...overrides,
  } as TailEvent;
}

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "flt-1",
    conversationId: "chn-1",
    agentId: "agent-1",
    agentName: "Kepler",
    invocationId: "inv-1",
    state: "running",
    summary: null,
    startedAt: 1_700_000_000_000,
    completedAt: null,
    sessions: [],
    ...overrides,
  } as Flight;
}

describe("turn step scope", () => {
  test("prefers the flight's session traces over the agent's current session", () => {
    const scope = buildTurnStepScope({
      flight: flight({
        sessions: [{ sessionId: "session-turn" }] as Flight["sessions"],
      }),
      agent: { harnessSessionId: "session-agent" } as Agent,
      sessionMeta: { harnessSessionId: "session-meta" } as SessionEntry,
    });
    expect(scope).toEqual(["session-turn", "session-agent", "session-meta"]);
  });

  test("puts the observe-resolved harness session first — Tail keys on it", () => {
    const scope = buildTurnStepScope({
      flight: flight({ sessions: [{ sessionId: "session-scout" }] as Flight["sessions"] }),
      agent: null,
      sessionMeta: null,
      observeSessionId: "0516e657-98ad-4d39-87a9-6ba3f2474859",
    });
    expect(scope).toEqual(["0516e657-98ad-4d39-87a9-6ba3f2474859", "session-scout"]);
  });

  test("is empty when nothing identifies the session", () => {
    expect(
      buildTurnStepScope({ flight: null, agent: null, sessionMeta: null }),
    ).toEqual([]);
  });

  test("matches tail events by session id in either direction, never by project", () => {
    const event = tailEvent({ id: "e1", sessionId: "abc123-full-harness-id" });
    expect(tailEventMatchesTurn(event, ["abc123"])).toBe(true);
    expect(tailEventMatchesTurn(event, ["abc123-full-harness-id-extra"])).toBe(true);
    // Same project, different session: another agent's work must not leak in.
    expect(tailEventMatchesTurn(event, ["session-other"])).toBe(false);
    expect(tailEventMatchesTurn(event, [])).toBe(false);
  });
});

describe("turn steps from tail", () => {
  test("orders oldest first, lifts tool fields, and collapses repeats", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "e3", ts: 3_000, kind: "tool", summary: "Read src/app.ts" }),
      tailEvent({ id: "e1", ts: 1_000, kind: "tool", summary: "Read src/app.ts" }),
      tailEvent({ id: "e2", ts: 2_000, kind: "tool", summary: "Read src/app.ts" }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.repeatCount).toBe(3);
    expect(steps[0]?.tool).toBe("Read");
    expect(steps[0]?.arg).toBe("src/app.ts");
    expect(steps[0]?.kind).toBe("tool");
  });

  test("keeps thinking lines as their own kind", () => {
    const steps = toTurnSteps([
      tailEvent({
        id: "e1",
        ts: 1_000,
        source: "kimi",
        kind: "system",
        summary: "[thinking] weighing the two fixes",
      }),
      tailEvent({ id: "e2", ts: 2_000, kind: "assistant", summary: "Fixed the spacer." }),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["think", "message"]);
    expect(steps[0]?.text).toBe("weighing the two fixes");
  });

  test("merge dedupes by id and keeps chronological order", () => {
    const merged = mergeTurnStepEvents(
      [tailEvent({ id: "e2", ts: 2_000 })],
      [tailEvent({ id: "e1", ts: 1_000 }), tailEvent({ id: "e2", ts: 2_000 })],
    );
    expect(merged.map((event) => event.id)).toEqual(["e1", "e2"]);
  });

  test("summarizes by kind over the whole turn", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "e1", ts: 1_000, kind: "tool", summary: "Read a.ts" }),
      tailEvent({ id: "e2", ts: 2_000, kind: "tool", summary: "Edit b.ts" }),
      tailEvent({
        id: "e3",
        ts: 3_000,
        source: "kimi",
        kind: "system",
        summary: "[thinking] hmm",
      }),
    ]);
    expect(summarizeTurnSteps(steps)).toBe("2 tools · 1 thinking");
    expect(summarizeTurnSteps([])).toBeNull();
  });
});

describe("turn steps from the observe fallback", () => {
  const observe = (events: Array<Record<string, unknown>>) =>
    ({ data: { events, live: true }, sessionId: "sess-abc" }) as never;

  test("scopes to the turn and keeps tool structure", () => {
    const steps = observeTurnSteps({
      observe: observe([
        { id: "old", t: 1, at: 1_699_999_000_000, kind: "tool", text: "stale" },
        {
          id: "new",
          t: 2,
          at: 1_700_000_001_000,
          kind: "tool",
          text: "Bash",
          tool: "Bash",
          arg: "bun test",
          result: { outcome: "ok" },
        },
      ]),
      flight: flight(),
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.tool).toBe("Bash");
    expect(steps[0]?.arg).toBe("bun test");
    expect(steps[0]?.outcome).toBe("ok");
  });

  test("a finished turn stops at completion and leaves the session's later turns out", () => {
    const steps = observeTurnSteps({
      observe: observe([
        { id: "mine", t: 1, at: 1_700_000_001_000, kind: "tool", text: "Read", tool: "Read" },
        { id: "late-write", t: 2, at: 1_700_000_062_000, kind: "tool", text: "Edit", tool: "Edit" },
        { id: "next-turn", t: 3, at: 1_700_000_600_000, kind: "tool", text: "Bash", tool: "Bash" },
      ]),
      flight: flight({ state: "completed", completedAt: 1_700_000_060_000 }),
    });
    expect(steps.map((step) => step.tool)).toEqual(["Read", "Edit"]);
  });

  test("starts empty when the flight has no turn boundary", () => {
    const steps = observeTurnSteps({
      observe: observe([
        { id: "a", t: 1, at: 1_699_999_000_000, kind: "tool", text: "Read", tool: "Read" },
      ]),
      flight: flight({ startedAt: null }),
    });
    expect(steps).toEqual([]);
  });

  test("returns nothing without a flight to scope against", () => {
    expect(
      observeTurnSteps({
        observe: observe([{ id: "a", t: 1, at: 1_700_000_001_000, kind: "tool", text: "x" }]),
        flight: null,
      }),
    ).toEqual([]);
  });
});

describe("turn launch phase", () => {
  test("names the stage the flight is actually in", () => {
    expect(
      describeTurnLaunchPhase({
        flight: flight({ state: "queued" }),
        hasSessionScope: false,
        awaitingResponse: true,
      })?.label,
    ).toBe("Queued");
    expect(
      describeTurnLaunchPhase({
        flight: flight({ state: "waking" }),
        hasSessionScope: false,
        awaitingResponse: true,
      })?.label,
    ).toBe("Waking");
    expect(
      describeTurnLaunchPhase({
        flight: flight({ state: "running" }),
        hasSessionScope: true,
        awaitingResponse: true,
      })?.detail,
    ).toBe("waiting for the first trace line");
  });

  test("admits when no trace stream is reachable for a live session", () => {
    expect(
      describeTurnLaunchPhase({
        flight: flight({ state: "running" }),
        hasSessionScope: false,
        awaitingResponse: true,
      })?.detail,
    ).toBe("no trace stream for this session yet");
  });

  test("stays silent when there is no flight and nothing is pending", () => {
    expect(
      describeTurnLaunchPhase({
        flight: null,
        hasSessionScope: false,
        awaitingResponse: false,
      }),
    ).toBeNull();
  });
});

describe("step row hygiene", () => {
  test("folds a tool result into the call above it", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "call", ts: 1_000, kind: "tool", summary: "Bash bun test" }),
      tailEvent({ id: "res", ts: 2_000, kind: "tool-result", summary: "res: 39 pass" }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.tool).toBe("Bash");
    expect(steps[0]?.outcome).toBeDefined();
    expect(steps[0]?.ts).toBe(2_000);
  });

  test("reads a bare thinking marker as a thinking step with no body", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "t", ts: 1_000, kind: "assistant", summary: "[thinking]" }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe("think");
    expect(steps[0]?.text).toBe("");
  });

  test("drops transport lines and truncates log dumps", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "a", ts: 1_000, kind: "other", summary: "[attachment]" }),
      tailEvent({ id: "b", ts: 2_000, kind: "assistant", summary: "x".repeat(400) }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.text.length).toBeLessThanOrEqual(160);
    expect(steps[0]?.text.endsWith("…")).toBe(true);
  });

  test("latest line prefers the newest step's tool and argument", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "a", ts: 1_000, kind: "assistant", summary: "starting" }),
      tailEvent({ id: "b", ts: 2_000, kind: "tool", summary: "Read src/app.ts" }),
    ]);
    expect(latestStepSummary(steps)).toBe("Read · src/app.ts");
    expect(latestStepSummary([])).toBeNull();
  });
});

describe("turn execution phase classification and telemetry", () => {
  test("classifies tool operations into structured phases", () => {
    expect(classifyTurnStepPhase({ kind: "think", text: "Analyzing options" })).toBe("planning");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "Read", arg: "src/main.ts" })).toBe("inspection");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "Grep", arg: "pattern" })).toBe("inspection");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "Write", arg: "src/app.tsx" })).toBe("mutation");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "StrReplace", arg: "index.html" })).toBe("mutation");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "Bash", arg: "bun test" })).toBe("verification");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "Bash", arg: "cargo check" })).toBe("verification");
    expect(classifyTurnStepPhase({ kind: "tool", tool: "Bash", arg: "git push origin main" })).toBe("execution");
    expect(classifyTurnStepPhase({ kind: "ask", text: "Need your input" })).toBe("coordination");
  });

  test("derives status and durations", () => {
    expect(deriveStepStatus({ outcome: "ok" })).toBe("success");
    expect(deriveStepStatus({ outcome: "exit 1: command failed" })).toBe("error");
    expect(deriveStepStatus({ outcome: "warn: 2 skipped" })).toBe("warning");
    expect(deriveStepStatus({ isActive: true, isLatest: true })).toBe("working");

    expect(formatStepDuration(350)).toBe("350ms");
    expect(formatStepDuration(2400)).toBe("2.4s");
    expect(formatStepDuration(65000)).toBe("1m 5s");
  });

  test("summarizes phases across turn steps", () => {
    const steps = toTurnSteps([
      tailEvent({ id: "e1", ts: 1_000, source: "kimi", kind: "system", summary: "[thinking] analyzing problem" }),
      tailEvent({ id: "e2", ts: 2_000, kind: "tool", summary: "Read src/app.ts" }),
      tailEvent({ id: "e3", ts: 3_000, kind: "tool", summary: "Write src/app.ts" }),
      tailEvent({ id: "e4", ts: 4_000, kind: "tool", summary: "Bash bun test" }),
    ]);

    const phases = summarizeTurnPhases(steps);
    expect(phases).toHaveLength(4);
    expect(phases.map((p) => p.phase)).toEqual(["planning", "inspection", "mutation", "verification"]);
    expect(phases.find((p) => p.phase === "verification")?.active).toBe(true);
  });
});

describe("turn trace", () => {
  const at = (seconds: number) => 1_700_000_000_000 + seconds * 1000;
  const ev = (id: string, seconds: number, kind: ObserveEvent["kind"], extra: Partial<ObserveEvent> = {}): ObserveEvent =>
    ({ id, t: seconds, at: at(seconds), kind, text: id, ...extra });

  test("keeps only the turn's own events, without the prompt or untimed rows", () => {
    const events = [
      ev("before", 1, "tool", { tool: "Bash" }),
      ev("prompt", 10, "ask"),
      ev("say", 11, "message"),
      { id: "untimed", t: 12, kind: "tool", text: "untimed" } as ObserveEvent,
      ev("question", 13, "ask", { to: "operator" }),
      ev("run", 14, "tool", { tool: "Bash" }),
      ev("after", 99, "tool", { tool: "Bash" }),
    ];
    const ids = turnTraceEvents(events, { startedAt: at(10), endedAt: at(50), finished: false }).map((event) => event.id);
    expect(ids).toEqual(["say", "question", "run"]);
    expect(turnTraceEvents(events, { startedAt: null, finished: false })).toEqual([]);
  });

  test("a finished turn leaves its answer to the thread", () => {
    const events = [ev("say", 11, "message"), ev("run", 14, "tool", { tool: "Bash" }), ev("answer", 20, "message")];
    expect(turnTraceEvents(events, { startedAt: at(10), endedAt: at(30), finished: true }).map((event) => event.id)).toEqual(["say", "run"]);
    expect(turnTraceEvents(events, { startedAt: at(10), finished: false }).map((event) => event.id)).toEqual(["say", "run", "answer"]);
  });

  test("a call fails on any outcome but success, as lane rows mark it", () => {
    expect(observeToolFailed(ev("ok", 1, "tool", { tool: "Bash", result: { outcome: "success" } }))).toBe(false);
    expect(observeToolFailed(ev("open", 1, "tool", { tool: "Bash" }))).toBe(false);
    expect(observeToolFailed(ev("bad", 1, "tool", { tool: "Bash", result: { outcome: "exit 1" } }))).toBe(true);
    expect(observeToolFailed(ev("out", 1, "tool", { tool: "res", result: { outcome: "error" } }))).toBe(false);
    expect(observeToolFailed(ev("say", 1, "message", { result: { outcome: "error" } }))).toBe(false);
  });

  test("the bar counts calls and failures from the events the trace draws", () => {
    const summary = summarizeTurnTrace([
      ev("think", 1, "think"),
      ev("read", 2, "tool", { tool: "Read", arg: "a.ts", result: { outcome: "success" } }),
      ev("output", 3, "tool", { tool: "res" }),
      ev("test", 4, "tool", { tool: "Bash", arg: "bun test", result: { outcome: "error" } }),
      ev("say", 5, "message"),
    ]);
    expect(summary.calls).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.lastCall?.id).toBe("test");
    expect(summary.phases.map((phase) => phase.phase)).toEqual(["planning", "inspection", "verification"]);
    expect(summary.phases.find((phase) => phase.active)?.phase).toBe("verification");
  });

  test("tail steps become lane events with a status-based result", () => {
    const [run, placeholder] = turnStepsToObserveEvents([
      { id: "a", ts: at(12), kind: "tool", text: "", tool: "Shell", arg: '{"cmd":"bun test"}', outcome: "error", repeatCount: 1, phase: "verification", status: "error" },
      { id: "b", ts: at(14), kind: "tool", text: "", tool: "Shell", arg: "ls", outcome: "done", repeatCount: 1, phase: "inspection", status: "success" },
    ], at(10));
    expect(run).toMatchObject({ id: "a", t: 2, at: at(12), arg: '{"cmd":"bun test"}', result: { outcome: "error" } });
    expect(placeholder?.result).toEqual({ outcome: "success" });
  });
});
