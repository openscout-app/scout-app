import { beforeEach, expect, mock, test } from "bun:test";
import type { Agent } from "../../lib/types.ts";
const calls: { path: string; body: Record<string, unknown> }[] = [];
let fail = false;
let answer: unknown = null;
// the real module underneath, so files sharing this process still find the rest of it
const realApi = await import("../../lib/api.ts");
mock.module("../../lib/api.ts", () => ({ ...realApi, api: async (path: string, init: RequestInit) => {
  calls.push({ path, body: JSON.parse(String(init.body)) });
  if (fail) throw new Error("Unavailable"); return answer ?? { ok: true, audit: { id: "audit-1" } };
} }));
const { replyToEndedSession, sendSessionDraft, sessionDeliveryAvailability, sessionInterruptAgent, sessionResumable, sessionTargetFromObserve } = await import("./session-delivery.ts");
beforeEach(() => { calls.length = 0; fail = false; answer = null; });
const target = { sessionId: "exact-old-session", sessionRef: "session:codex:exact-old-session", machineId: "here", agentId: "worker" };
const ready = { available: true, reason: "Ready", code: "ready", target: null };

test("steering stays disabled until the server verifies a live process", () => {
  expect(sessionDeliveryAvailability(target).available).toBe(false);
  expect(sessionDeliveryAvailability(target, ready).available).toBe(true);
  expect(sessionDeliveryAvailability(target, { ...ready, available: false, reason: "Ambiguous process" })).toMatchObject({ available: false, reason: "Ambiguous process" });
});
test("Steer posts verbatim text to the exact session and machine, never a broker ask", async () => {
  await sendSessionDraft(target, "  steer\nthis  ");
  expect(calls).toEqual([{ path: "/api/session-ref/session%3Acodex%3Aexact-old-session/steer?machine=here", body: { text: "  steer\nthis  " } }]);
});
test("failures never try start, resume, /send or /sessions/reply", async () => {
  fail = true; await expect(sendSessionDraft(target, "kept")).rejects.toThrow("Unavailable");
  expect(calls).toHaveLength(1);
});
test("unresolved and machine-unverified targets cannot send even with a stale ready response", async () => {
  for (const candidate of [{ ...target, sessionId: "" }, { ...target, sessionRef: null }, { ...target, machineId: null }]) {
    expect(sessionDeliveryAvailability(candidate, ready).available).toBe(false);
    await expect(sendSessionDraft(candidate, "hello")).rejects.toThrow();
  }
  expect(calls).toEqual([]);
});
test("interrupt is still only available for the exact working tmux session", () => {
  const agent = { id: "worker", harnessSessionId: "exact-old-session", state: "working", terminalSurface: { backend: "tmux" } } as Agent;
  expect(sessionInterruptAgent(target, agent)).toBe(agent);
  expect(sessionInterruptAgent(target, { ...agent, harnessSessionId: "new-session" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, state: "idle" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, state: "queued" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, terminalSurface: null, transport: "codex_app_server" })).toBeNull();
  expect(sessionInterruptAgent({ ...target, interruptLocal: false }, agent)).toBeNull();
});
test("unresolved conversation backing cannot steer while Observe is delayed or failed", async () => {
  const unresolved = sessionTargetFromObserve(null, { agentId: "worker", harnessSessionId: "raw", sessionId: "broker" } as never);
  expect(unresolved.sessionId).toBe(""); expect(sessionDeliveryAvailability(unresolved, ready).available).toBe(false);
  await expect(sendSessionDraft(unresolved, "no wrong-session delivery")).rejects.toThrow("resolved session identity");
  expect(calls).toEqual([]);
});
test("observed execution ids are raw; machine mismatches fail closed", async () => {
  const observe = { kind: "agent", agentId: "worker", sessionId: "session:codex:raw", data: { events: [], files: [], metadata: { session: { nodeId: "here", adapterType: "codex" } } } } as never;
  const exact = sessionTargetFromObserve(observe, null, "here", "here");
  expect(exact).toMatchObject({ sessionId: "raw", sessionRef: "session:codex:raw", machineId: "here" });
  expect(sessionDeliveryAvailability(exact, ready).available).toBe(true);
  const mismatch = sessionTargetFromObserve(observe, null, "peer", "here");
  expect(sessionDeliveryAvailability(mismatch, ready).available).toBe(false);
  await expect(sendSessionDraft(mismatch, "no")).rejects.toThrow("machine"); expect(calls).toEqual([]);
});
test("local Observe without node metadata uses its matched owner's machine", () => {
  const observe = { kind: "agent", agentId: "worker", sessionId: "raw", data: { events: [], files: [], metadata: { session: { adapterType: "codex" } } } } as never;
  const owner = { id: "worker", harnessSessionId: "raw", homeNodeId: "here" } as Agent;
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "here", "here", owner), ready).available).toBe(true);
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "here", "here", { ...owner, harnessSessionId: "new-session" }), ready).available).toBe(true);
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "peer", "here", owner), ready).available).toBe(false);
});

test("local Claude Observe can resolve a newer execution id than its registered owner", async () => {
  // Live dev-host evidence: the registered/ref id and observed Claude thread
  // differ, and Observe has no metadata.session.nodeId. The machine ids agree.
  const registered = "117003a7-b049-4112-93a7-2fb5035c3d83";
  const observed = "e1f1106d-9d79-45cd-b0b6-29d9ef366f59";
  const local = "dev-host-openscout";
  const observe = { kind: "agent", agentId: "project-woolf-37.main.dev-host", refId: registered, sessionId: observed,
    data: { events: [], files: [], metadata: { session: { adapterType: "claude-code" } } } } as never;
  const owner = { id: "project-woolf-37.main.dev-host", harnessSessionId: registered, homeNodeId: local } as Agent;
  const exact = sessionTargetFromObserve(observe, null, local, local, owner);
  expect(exact).toMatchObject({ sessionId: observed, sessionRef: `session:claude:${observed}`, machineId: local, blockedReason: null });
  expect(sessionDeliveryAvailability(exact).available).toBe(false); // still needs server capability verification
  expect(sessionDeliveryAvailability(exact, ready).available).toBe(true);
  await sendSessionDraft(exact, "continue");
  expect(calls).toEqual([{ path: `/api/session-ref/session%3Aclaude%3A${observed}/steer?machine=${local}`, body: { text: "continue" } }]);

  const remote = sessionTargetFromObserve(observe, null, "another-machine", local, owner);
  expect(sessionDeliveryAvailability(remote, ready).available).toBe(false);
  await expect(sendSessionDraft(remote, "never to a local lookalike")).rejects.toThrow("machine");
  expect(calls).toHaveLength(1);
  // Missing/mismatched owners and remote owners with a different execution id
  // cannot supply the relaxed local-machine evidence.
  for (const candidate of [undefined, { ...owner, id: "other-agent" }, { ...owner, homeNodeId: null }]) {
    expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, local, local, candidate), ready).available).toBe(false);
  }
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "another-machine", local,
    { ...owner, homeNodeId: "another-machine" }), ready).available).toBe(false);
  const explicitRemote = { ...observe as object, data: { metadata: { session: { nodeId: "another-machine", adapterType: "claude-code" } } } } as never;
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(explicitRemote, null, local, local, owner), ready).available).toBe(false);
});

test("capability reads never overlap or regress to an older ready response", async () => {
  const { sessionSteerPoll } = await import("./session-delivery.ts");
  let finish!: (value: string) => void, reads = 0;
  const received: string[] = [];
  const poll = sessionSteerPoll(() => { reads++; return new Promise<string>((resolve) => { finish = resolve; }); }, (v) => received.push(v), () => {});
  const first = poll.refresh(); await poll.refresh(); expect(reads).toBe(1);
  finish("ready"); await first;
  const second = poll.refresh(); finish("refused"); await second;
  expect(received).toEqual(["ready", "refused"]);
});
test("changing slots discards a late capability response for the previous target", async () => {
  const { sessionSteerPoll } = await import("./session-delivery.ts");
  let finish!: (value: string) => void;
  const received: string[] = [];
  const old = sessionSteerPoll(() => new Promise<string>((resolve) => { finish = resolve; }), (v) => received.push(v), () => received.push("error"));
  const read = old.refresh(); old.stop(); finish("old target ready"); await read;
  expect(received).toEqual([]);
  await old.refresh(); expect(received).toEqual([]);
});

const notLive = { available: false, code: "not_live", reason: "No birth-verified live process holds this session.", target: null };
test("only a session on this host that nothing holds is resumable; live, remote, blocked and retrying ones are not", () => {
  const here = { ...target, local: true };
  expect(sessionResumable(here, notLive)).toBe(true);
  expect(sessionResumable(target, notLive)).toBe(false);
  expect(sessionResumable({ ...here, blockedReason: "The selected machine is not verified." }, notLive)).toBe(false);
  expect(sessionResumable({ ...here, sessionId: "" }, notLive)).toBe(false);
  expect(sessionResumable(here, ready)).toBe(false);
  expect(sessionResumable(here, { ...notLive, code: "unavailable" })).toBe(false);
  expect(sessionResumable(here, null)).toBe(false);
});
test("the target says whether its session is on this host", () => {
  const observe = (nodeId?: string) => ({ kind: "agent", agentId: "worker", sessionId: "session:codex:raw", data: { events: [], files: [], metadata: { session: { nodeId, adapterType: "codex" } } } }) as never;
  expect(sessionTargetFromObserve(observe("here"), null, "here", "here").local).toBe(true);
  expect(sessionTargetFromObserve(observe("peer"), null, "peer", "here").local).toBe(false);
  expect(sessionTargetFromObserve(observe("peer"), null, undefined, "here").local).toBe(false);
});
test("a reply to an ended session is one POST to the reply route: the exact session, its harness and folder, the text verbatim", async () => {
  answer = { ok: true, delivery: "resumed", sessionId: "exact-old-session" };
  expect(await replyToEndedSession({ ...target, local: true, harness: "claude-code", projectPath: "/repo" }, "Go on /tmp/a.png", "m1"))
    .toEqual({ ok: true, inPlace: false, location: null });
  expect(calls).toEqual([{ path: "/api/sessions/reply", body: { sessionId: "exact-old-session", harness: "claude", cwd: "/repo", body: "Go on /tmp/a.png", clientMessageId: "m1", source: "scout-web" } }]);
  answer = { ok: true, delivery: "in_place", location: "tmux" };
  expect(await replyToEndedSession(target, "x", "m2")).toEqual({ ok: true, inPlace: true, location: "tmux" });
  // No harness on the target: the session ref names it.
  expect(calls.at(-1)!.body).toMatchObject({ harness: "codex", cwd: null });
  answer = { ok: false, code: "not_found", message: "That session is gone." };
  expect(await replyToEndedSession(target, "x", "m3")).toEqual({ ok: false, reason: "That session is gone." });
  fail = true;
  expect(await replyToEndedSession(target, "x", "m4")).toEqual({ ok: false, reason: "Unavailable" });
});
