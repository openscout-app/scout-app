import { expect, test } from "bun:test";
import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { observedSessionTurns, observedSessionWorking, observedStepCount, observedTurnDuration, sessionWorkLabel, observedFileEdits, splitObservedTurn, quietSince, QUIET_AFTER_MS } from "./session-turns.ts";
const event = (id: string, t: number, kind: ObserveEvent["kind"], extra = {}): ObserveEvent => ({ id, t, kind, text: id, ...extra });
test("observed requests delimit turn summaries and retain tool blocks with diffs", () => {
  const diff = { add: 1, del: 1, preview: "-old\n+new" };
  const data: ObserveData = { files: [], events: [event("ask1", 0, "ask"), event("edit", 12, "tool", { tool: "edit", arg: "src/main.ts", diff }), event("done", 360, "message"), event("ask2", 361, "ask"), event("think", 362, "think")] };
  const turns = observedSessionTurns(data, true);
  expect(turns).toHaveLength(2); expect(turns.map((t) => t.working)).toEqual([false, true]);
  expect(turns[0].steps[0].diff).toEqual(diff); expect(turns[0].messages[0].id).toBe("done");
  expect(observedStepCount(turns[0])).toBe(1); expect(turns[0].fileCount).toBe(1);
  expect(observedTurnDuration(turns[0])).toBe("6m 0s");
});
test.each([
  ["bash", "bun test", "Ran bun test"], ["read", "src/a.ts", "Read src/a.ts"],
  ["edit", "src/a.ts", "Edited src/a.ts"], ["grep", "needle", "Searched needle"],
])("Codex work rows use the actual %s argument", (tool, arg, label) => {
  expect(sessionWorkLabel(event("x", 0, "tool", { tool, arg }))).toBe(label);
});
test("file counts are observed diff evidence, never made-up zeros", () => {
  const counts = observedFileEdits([event("a", 1, "tool", { tool: "edit", arg: "src/a.ts", diff: { add: 3, del: 2, preview: "" } }),
    event("b", 2, "tool", { tool: "edit", arg: "src/a.ts", diff: { add: 1, del: 0, preview: "" } }),
    event("c", 3, "tool", { tool: "write", arg: "src/c.ts" })]);
  expect(counts.get("src/a.ts")).toEqual({ add: 4, del: 2 });
  expect(counts.has("src/c.ts")).toBe(false);
});
test("incomplete leading context is not given an invented prompt", () => {
  const turns = observedSessionTurns({ files: [], events: [event("tool", 0, "tool"), event("result", 1, "tool", { tool: "res" })] }, false);
  expect(turns[0].prompt).toEqual([]); expect(observedStepCount(turns[0])).toBe(1);
  expect(observedSessionTurns({ files: [], events: [] }, false)).toEqual([]);
});
test("agent questions are not requester prompts or turn boundaries", () => {
  const turns = observedSessionTurns({ files: [], events: [event("tool", 0, "tool"), event("question", 60, "ask", { to: "human" }), event("done", 70, "message")] }, false);
  expect(turns).toHaveLength(1); expect(turns[0].boundary).toBe("window");
  expect(turns[0].prompt).toEqual([]); expect(turns[0].messages.map((e) => e.id)).toEqual(["question", "done"]);
});
test("shell command prose is not a file inventory", () => {
  const turns = observedSessionTurns({ files: [], events: [event("command", 0, "tool", { tool: "exec_command", arg: "printf 'many words about a workflow'", detail: "this is not a file path" })] }, false);
  expect(turns[0].fileCount).toBe(0);
});
test("a finished turn's trailing messages are its answer; narration stays in the trace", () => {
  const data: ObserveData = { files: [], events: [event("ask1", 0, "ask"), event("say", 1, "message"), event("run", 2, "tool", { tool: "exec_command" }), event("answer", 3, "message"), event("ask2", 4, "ask"), event("think", 5, "think"), event("now", 6, "message")] };
  const [done, live] = observedSessionTurns(data, true);
  expect(done.work.map((e) => e.id)).toEqual(["say", "run", "answer"]);
  const split = splitObservedTurn(done);
  expect(split.trace.map((e) => e.id)).toEqual(["say", "run"]);
  expect(split.answer.map((e) => e.id)).toEqual(["answer"]);
  expect(splitObservedTurn(live)).toEqual({ trace: live.work, answer: [] });
});
test("a turn cut off mid-call still answers with the last thing the agent said", () => {
  const data: ObserveData = { files: [], events: [event("ask", 0, "ask"), event("say", 1, "message"), event("run", 2, "tool", { tool: "exec_command" }),
    event("report", 3, "message"), event("after", 4, "tool", { tool: "exec_command" })] };
  const [cut] = observedSessionTurns(data, false);
  const split = splitObservedTurn(cut);
  expect(split.answer.map((e) => e.id)).toEqual(["report"]);
  expect(split.trace.map((e) => e.id)).toEqual(["say", "run", "after"]);
  // nothing said: every call stays in the trace
  const [quiet] = observedSessionTurns({ files: [], events: [event("ask", 0, "ask"), event("run", 1, "tool", { tool: "exec_command" })] }, false);
  expect(splitObservedTurn(quiet)).toEqual({ trace: quiet.work, answer: [] });
});
test("a call that never returned is not work once the board has the session quiet", () => {
  const open: ObserveData = { files: [], events: [event("ask", 0, "ask"), event("run", 1, "tool", { tool: "bash", arg: "bun test", live: true })] };
  // ended mid-call: the transcript keeps the call open, the board says the session went quiet
  expect(observedSessionWorking({ agentTurn: null, data: open, rowWorking: false })).toBe(false);
  expect(observedSessionWorking({ agentTurn: null, data: open, rowWorking: true })).toBe(true);
  // no board row to ask: the open call is the only evidence
  expect(observedSessionWorking({ agentTurn: null, data: open })).toBe(true);
  // a live source is working whatever the board read last
  expect(observedSessionWorking({ agentTurn: null, data: { ...open, live: true }, source: "live", rowWorking: false })).toBe(true);
  // a recorded trace whose last turn never closed reads as live; the board's quiet row wins
  const ended: ObserveData = { ...open, events: open.events.map((e) => ({ ...e, live: false })), live: true };
  expect(observedSessionWorking({ agentTurn: null, data: ended, source: "history", rowWorking: false })).toBe(false);
  expect(observedSessionWorking({ agentTurn: null, data: ended, source: "history", rowWorking: true })).toBe(true);
  expect(observedSessionWorking({ agentTurn: null, data: ended, source: "history" })).toBe(true);
  // the agent holding the session decides
  expect(observedSessionWorking({ agentTurn: false, data: { ...open, live: true }, rowWorking: true })).toBe(false);
  expect(observedSessionWorking({ agentTurn: null, data: null, rowWorking: true })).toBe(true);
  // Discovery may be ahead of a history snapshot with no live flags at all.
  expect(observedSessionWorking({ agentTurn: null, data: { ...open, live: false, events: [] }, source: "history", rowWorking: true })).toBe(true);
  expect(observedSessionWorking({ agentTurn: null, data: { ...open, live: false, events: [] }, source: "history", rowWorking: false })).toBe(false);
});

test("a turn that has written nothing for a while is quiet since its last event", () => {
  const now = 1_000_000_000;
  const events = [{ at: now - QUIET_AFTER_MS - 60_000 }, { at: now - QUIET_AFTER_MS - 5_000 }, {}];
  expect(quietSince(events, true, now)).toBe(now - QUIET_AFTER_MS - 5_000);
  // recent work, a session not in a turn, or no times at all: not quiet
  expect(quietSince([...events, { at: now - 1_000 }], true, now)).toBeNull();
  expect(quietSince(events, false, now)).toBeNull();
  expect(quietSince([{}], true, now)).toBeNull();
});

test("the transcript's turn ids split turns its prompts are missing from", () => {
  const data = { files: [], events: [
    event("b", 0, "boot"),
    event("r1", 1, "tool", { turn: "t1", tool: "Read" }),
    event("report", 5, "message", { turn: "t1", to: "human" }),
    event("r2", 9, "tool", { turn: "t2", tool: "exec" }),
    event("r3", 12, "tool", { turn: "t2", tool: "exec" }),
  ] } as unknown as ObserveData;
  const turns = observedSessionTurns({ ...data, events: data.events.filter((e) => e.kind !== "boot") }, false);
  expect(turns.map((t) => [t.boundary, t.turnId, t.work.map((e) => e.id)])).toEqual([
    ["turn", "t1", ["r1", "report"]],
    ["turn", "t2", ["r2", "r3"]],
  ]);
  // the first turn's closing message is its answer, not part of the next turn's work
  expect(splitObservedTurn(turns[0]!).answer.map((e) => e.id)).toEqual(["report"]);
  // a prompt still opens its turn, and its events' turn id carries on in it
  const prompted = observedSessionTurns({ files: [], events: [event("p", 0, "ask"), event("x", 1, "tool", { turn: "t9" }), event("y", 2, "tool", { turn: "t9" })] } as unknown as ObserveData, false);
  expect(prompted.map((t) => [t.boundary, t.work.length])).toEqual([["prompt", 2]]);
});
