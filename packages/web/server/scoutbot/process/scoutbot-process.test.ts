import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InboxItem } from "@openscout/protocol";

import type { ScoutbotBrain } from "../../scoutbot-brain.ts";
import { ScoutbotThreadMapStore } from "../thread-map.ts";
import { createScoutbotBrokerLink, type ScoutbotBrokerLink } from "./broker-link.ts";
import { startFakeRuntime, type FakeRuntime } from "./fixtures/fake-runtime.ts";
import { createScoutbotHandouts } from "./handouts.ts";
import {
  createScoutbotBrainConversationMap,
  createScoutbotProcess,
  renderScoutbotState,
  replyMessageId,
  SCOUTBOT_LEASE_OWNER,
} from "./scoutbot-process.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "scoutbot-process-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const quiet = { info: () => undefined, warn: () => undefined };
type Reply = string | Error | ((input: Parameters<ScoutbotBrain["reply"]>[0]) => string);

function fakeBrain(answers: Reply[]) {
  const calls: Array<{ conversationId: number | null; body: string; state?: string; requestId?: string }> = [];
  const brain: ScoutbotBrain = {
    reply: async (input) => {
      calls.push({ conversationId: input.conversationId, body: input.body, state: input.state, requestId: input.requestId });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      const text = typeof next === "function" ? next(input) : next ?? "";
      return { conversationId: input.conversationId ?? 7, text, usage: null };
    },
    close: async () => undefined,
  };
  return { brain, calls };
}

async function setup(answers: Reply[], options: { now?: () => number; threads?: (directory: string) => ScoutbotThreadMapStore } = {}) {
  const runtime = startFakeRuntime();
  cleanups.push(() => runtime.stop());
  const directory = tempDirectory();
  const threads = options.threads?.(directory) ?? new ScoutbotThreadMapStore(join(directory, "threads.json"));
  const thread = await threads.ensureDefaultThread({ transport: "local_socket" });
  const { brain, calls } = fakeBrain(answers);
  const now = options.now ?? Date.now;
  const make = () => createScoutbotProcess({
    broker: createScoutbotBrokerLink({ socketPath: runtime.socketPath }),
    brain,
    currentDirectory: directory,
    threads,
    conversations: createScoutbotBrainConversationMap(join(directory, "conversations.json")),
    handouts: createScoutbotHandouts(join(directory, "handouts.json")),
    log: quiet,
    now,
  });
  const scoutbot = make();
  const ask = (id: string, body: string, fields: Record<string, unknown> = {}) => {
    runtime.postMessage({
      id, conversationId: thread.conversationId, actorId: "operator", body, createdAt: now(),
      audience: { notify: ["scoutbot"] }, ...fields,
    });
    return itemFor(runtime, id);
  };
  const replies = () => [...runtime.messages.values()].filter((message) => message.actorId === "scoutbot");
  return { runtime, directory, threads, thread, calls, scoutbot, make, ask, replies };
}

function itemFor(runtime: FakeRuntime, messageId: string): InboxItem {
  const item = [...runtime.items.values()].find((candidate) => candidate.messageId === messageId);
  if (!item) throw new Error(`no inbox item for ${messageId}`);
  return structuredClone(item) as unknown as InboxItem;
}

async function waitFor(check: () => boolean, label: string, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("Scoutbot process", () => {
  test("bootstrap registers the operator before the thread's conversation and retires the Codex endpoint", async () => {
    const posts: Array<{ path: string; body: any }> = [];
    const snapshot = {
      actors: {}, agents: {}, conversations: {}, messages: {},
      endpoints: {
        "endpoint.scoutbot.codex_app_server.node-1": {
          id: "endpoint.scoutbot.codex_app_server.node-1", agentId: "scoutbot", nodeId: "node-1", transport: "codex_app_server", state: "waiting",
        },
      },
    };
    const link: ScoutbotBrokerLink = {
      socketPath: "/tmp/broker.sock",
      getJson: async <T,>(path: string) => (path === "/v1/node" ? { id: "node-1" } : structuredClone(snapshot)) as T,
      postJson: async <T,>(path: string, body: unknown) => { posts.push({ path, body }); return { ok: true } as T; },
      stream: async () => undefined,
    };
    const directory = tempDirectory();
    const scoutbot = createScoutbotProcess({
      broker: link, brain: fakeBrain([]).brain, currentDirectory: directory,
      threads: new ScoutbotThreadMapStore(join(directory, "threads.json")),
      conversations: createScoutbotBrainConversationMap(join(directory, "conversations.json")),
      handouts: createScoutbotHandouts(join(directory, "handouts.json")), log: quiet,
    });
    await scoutbot.bootstrap();
    const operatorAt = posts.findIndex((post) => post.path === "/v1/actors" && post.body.id === "operator");
    const conversationAt = posts.findIndex((post) => post.path === "/v1/conversations");
    expect(operatorAt).toBeGreaterThanOrEqual(0);
    expect(operatorAt).toBeLessThan(conversationAt);
    const endpoints = posts.filter((post) => post.path === "/v1/endpoints").map((post) => post.body);
    expect(endpoints[0]).toMatchObject({ agentId: "scoutbot", transport: "local_socket", state: "idle" });
    expect(endpoints[1]).toMatchObject({ id: "endpoint.scoutbot.codex_app_server.node-1", state: "offline" });
    expect(posts.find((post) => post.path === "/v1/conversations")!.body.participantIds).toEqual(["operator", "scoutbot"]);
  });

  test("answers an inbox item once, in one Pi conversation per thread, and acks it with its reply", async () => {
    const { runtime, calls, scoutbot, ask, replies } = await setup(["First answer.", "Second answer."]);
    await scoutbot.handleItem(ask("msg-1", "@scoutbot what is going on?"));
    await scoutbot.handleItem(ask("msg-2", "and now?"));

    expect(calls.map((call) => [call.conversationId, call.requestId])).toEqual([[null, "msg-1"], [7, "msg-2"]]);
    expect(calls[0]!.body).toBe("what is going on?");
    expect(replies().map((reply) => [reply.id, reply.replyToMessageId, reply.body])).toEqual([
      [replyMessageId("msg-1"), "msg-1", "First answer."],
      [replyMessageId("msg-2"), "msg-2", "Second answer."],
    ]);
    expect(replies()[0]!.audience).toEqual({ notify: ["operator"], reason: "reply" });
    const first = runtime.items.get(itemFor(runtime, "msg-1").id)!;
    expect(first.status).toBe("acknowledged");
    expect(first.delivery.metadata).toMatchObject({ outcome: "answered", replyMessageId: replyMessageId("msg-1") });
  });

  test("an item a dead generation still leases is taken back, and an answer it already posted is not posted again", async () => {
    const { runtime, calls, scoutbot, ask, thread } = await setup([]);
    const item = ask("msg-1", "hello");
    // The previous generation claimed it, posted its answer, and died before the ack.
    const live = runtime.items.get(item.id)!;
    Object.assign(live, { status: "leased", leaseOwner: SCOUTBOT_LEASE_OWNER, leaseExpiresAt: Date.now() + 60_000, leaseGeneration: 1 });
    runtime.postMessage({ id: replyMessageId("msg-1"), conversationId: thread.conversationId, actorId: "scoutbot", body: "Hi.", createdAt: Date.now() });

    await scoutbot.handleItem(itemFor(runtime, "msg-1"));

    expect(calls).toHaveLength(0);
    expect(runtime.writes.filter((write) => write.path.startsWith("/v1/inbox/")).map((write) => write.path))
      .toEqual(["/v1/inbox/nack", "/v1/inbox/claim", "/v1/inbox/ack"]);
    expect(runtime.writes.find((write) => write.path === "/v1/inbox/ack")!.body.leaseGeneration).toBe(2);
    expect(runtime.items.get(item.id)!.status).toBe("acknowledged");
  });

  test("an item another owner leases is left alone until its lease runs out", async () => {
    const { runtime, calls, scoutbot, ask } = await setup(["Answer."]);
    const item = ask("msg-1", "hello");
    Object.assign(runtime.items.get(item.id)!, { status: "leased", leaseOwner: "someone-else", leaseExpiresAt: Date.now() + 60_000, leaseGeneration: 1 });
    await scoutbot.handleItem(itemFor(runtime, "msg-1"));
    expect(calls).toHaveLength(0);
    expect(runtime.items.get(item.id)!.leaseOwner).toBe("someone-else");
  });

  test("old, own and unrouted messages are closed without an answer, and seen-only items are not touched", async () => {
    const { runtime, calls, scoutbot, ask, thread } = await setup([]);
    const stale = ask("msg-old", "yesterday's question", { createdAt: Date.now() - 25 * 60 * 60_000 });
    const own = runtime.addItem({ id: "msg-own", conversationId: thread.conversationId, actorId: "scoutbot", body: "echo", createdAt: Date.now() });
    const elsewhere = runtime.addItem({ id: "msg-dm", conversationId: "dm.someone.scoutbot", actorId: "someone", body: "hi", createdAt: Date.now() });
    const seen = runtime.addItem({ id: "msg-seen", conversationId: thread.conversationId, actorId: "operator", body: "aside", createdAt: Date.now() },
      { reason: "conversation_visibility" });
    for (const item of [stale, own, elsewhere, seen]) await scoutbot.handleItem(structuredClone(item) as unknown as InboxItem);

    expect(calls).toHaveLength(0);
    const outcome = (id: string) => runtime.items.get(id)!.delivery.metadata.outcome;
    expect([outcome(stale.id), outcome(own.id), outcome(elsewhere.id)]).toEqual(["stale", "own_message", "unrouted"]);
    expect(runtime.items.get(seen.id)!.status).toBe("pending");
    for (const id of ["msg-old", "msg-own", "msg-dm", "msg-seen"]) expect(runtime.messages.has(replyMessageId(id))).toBe(false);
  });

  test("a failed brain turn still answers, so the thread is not left pending", async () => {
    const { scoutbot, ask, replies } = await setup([new Error("no OpenAI key")]);
    await scoutbot.handleItem(ask("msg-1", "hello"));
    const reply = replies()[0]!;
    expect(reply.body).toContain("no OpenAI key");
    expect(reply.metadata).toMatchObject({ error: true, sourcePath: "scoutbot-brain" });
    expect(reply.replyToMessageId).toBe("msg-1");
  });

  test("when the runtime refuses the answer, the item goes back to the inbox instead of being acked", async () => {
    const { runtime, scoutbot, ask, replies } = await setup(["Answer."]);
    runtime.refuse((path) => (path === "/v1/messages" ? 503 : undefined));
    const item = ask("msg-1", "hello");
    await scoutbot.handleItem(item);
    const live = runtime.items.get(item.id)!;
    expect(live.status).toBe("deferred");
    expect(typeof live.delivery.metadata.nextAttemptAt).toBe("number");
    expect(replies()).toHaveLength(0);
  });

  test("a hand-out's result is answered in the thread it came from, as a reply to the operator's message", async () => {
    let scoutbotRef: ReturnType<typeof createScoutbotProcess> | undefined;
    let turnDuringAsk: string | undefined;
    const { runtime, calls, scoutbot, ask, replies, thread } = await setup([
      "Warm.",
      () => {
        // What the ask tool does when the runtime accepts the ask.
        turnDuringAsk = scoutbotRef!.turnOf(7);
        scoutbotRef!.recordHandout("flt-1", 7);
        return "Asked einstein-13 to run typecheck.";
      },
      "einstein-13 says typecheck passes.",
    ]);
    scoutbotRef = scoutbot;
    // The thread already has its Pi conversation, as after its first turn.
    await scoutbot.handleItem(ask("msg-0", "warm up"));

    await scoutbot.handleItem(ask("msg-1", "have the einstein one run typecheck"));
    expect(turnDuringAsk).toBe("msg-1");

    runtime.postMessage({
      id: "msg-result", conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body: "Typecheck passes.",
      createdAt: Date.now(), audience: { notify: ["scoutbot"] }, metadata: { flightId: "flt-1", invocationId: "inv-1" },
    });
    await scoutbot.handleItem(itemFor(runtime, "msg-result"));

    expect(calls.at(-1)!.body).toContain("einstein-13 answered the ask you made for the operator (flight flt-1)");
    expect(calls.at(-1)!.body).toContain("Typecheck passes.");
    const relay = replies().find((reply) => reply.id === replyMessageId("msg-result"))!;
    expect(relay).toMatchObject({ conversationId: thread.conversationId, replyToMessageId: "msg-1", body: "einstein-13 says typecheck passes." });
    expect(relay.audience).toEqual({ notify: ["operator"], reason: "reply" });
    expect(relay.metadata).toMatchObject({ flightId: "flt-1", resultMessageId: "msg-result", sourcePath: "scoutbot-handout" });
    expect(runtime.items.get(itemFor(runtime, "msg-result").id)!.status).toBe("acknowledged");
  });

  test("a result that arrives before its ask is recorded waits for it instead of being dropped", async () => {
    const { runtime, calls, scoutbot, ask } = await setup(["Hi.", "Relayed."]);
    await scoutbot.handleItem(ask("msg-1", "hello"));
    runtime.postMessage({
      id: "msg-result", conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body: "Done.",
      createdAt: Date.now(), audience: { notify: ["scoutbot"] }, metadata: { flightId: "flt-early" },
    });
    await scoutbot.handleItem(itemFor(runtime, "msg-result"));
    expect(runtime.items.get(itemFor(runtime, "msg-result").id)!.status).toBe("pending");

    scoutbot.recordHandout("flt-early", 7);
    await scoutbot.handleItem(itemFor(runtime, "msg-result"));
    expect(calls).toHaveLength(2);
    expect(runtime.items.get(itemFor(runtime, "msg-result").id)!.status).toBe("acknowledged");
  });

  test("an agent's own `scout reply --ref` answer is relayed to the thread, and its progress notes are not", async () => {
    let scoutbotRef: ReturnType<typeof createScoutbotProcess> | undefined;
    const { runtime, calls, scoutbot, ask, replies, thread } = await setup([
      "Warm.",
      () => { scoutbotRef!.recordHandout("flt-1", 7); return "Asked einstein-13."; },
      "einstein-13 says typecheck passes.",
    ]);
    scoutbotRef = scoutbot;
    await scoutbot.handleItem(ask("msg-0", "warm up"));
    await scoutbot.handleItem(ask("msg-1", "have einstein run typecheck"));
    // What the runtime posts for `scout reply --ref` (broker-tasks.ts): no top-level flightId.
    const agentReply = (id: string, kind: "progress" | "final", body: string) => {
      runtime.addItem({
        id, conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body, createdAt: Date.now(), class: "agent",
        audience: { notify: ["scoutbot"], reason: "thread_reply" },
        metadata: { source: "scout-reply", clientMessageId: id, completionReply: { invocationId: "inv-1", flightId: "flt-1", revision: 0, kind } },
      } as never, { reason: "thread_reply" });
      return itemFor(runtime, id);
    };
    await scoutbot.handleItem(agentReply("msg.task.progress", "progress", "Running typecheck."));
    await scoutbot.handleItem(agentReply("msg.task.final", "final", "Typecheck passes."));

    const outcome = (messageId: string) => runtime.items.get(itemFor(runtime, messageId).id)!.delivery.metadata.outcome;
    expect(outcome("msg.task.progress")).toBe("progress");
    expect(outcome("msg.task.final")).toBe("answered");
    expect(calls).toHaveLength(3);
    expect(calls.at(-1)!.body).toContain("Typecheck passes.");
    expect(replies().find((reply) => reply.id === replyMessageId("msg.task.progress"))).toBeUndefined();
    expect(replies().find((reply) => reply.id === replyMessageId("msg.task.final"))).toMatchObject({
      conversationId: thread.conversationId, replyToMessageId: "msg-1", body: "einstein-13 says typecheck passes.",
    });
  });

  test("a failed hand-out is answered once, though the agent and the runtime both report it", async () => {
    let scoutbotRef: ReturnType<typeof createScoutbotProcess> | undefined;
    const { runtime, calls, scoutbot, ask, replies } = await setup([
      "Warm.",
      () => { scoutbotRef!.recordHandout("flt-1", 7); return "Asked einstein-13."; },
      "einstein-13 could not run it.",
    ]);
    scoutbotRef = scoutbot;
    await scoutbot.handleItem(ask("msg-0", "warm up"));
    await scoutbot.handleItem(ask("msg-1", "have einstein run typecheck"));
    // `scout reply --ref --failed`: the agent's own words.
    runtime.addItem({
      id: "msg.task.failed", conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body: "The repo does not build.",
      createdAt: Date.now(), class: "agent", audience: { notify: ["scoutbot"], reason: "thread_reply" },
      metadata: { source: "scout-reply", completionReply: { invocationId: "inv-1", flightId: "flt-1", revision: 0, kind: "final", outcome: "failed" } },
    } as never, { reason: "thread_reply" });
    await scoutbot.handleItem(itemFor(runtime, "msg.task.failed"));
    // Pi replays the ask after a restart; the hand-out keeps its answer.
    scoutbot.recordHandout("flt-1", 7);
    // The runtime's failure report for the same flight.
    runtime.postMessage({
      id: "flight-report-1", conversationId: "dm.einstein-13.scoutbot", actorId: "system", body: "einstein-13 failed to respond.",
      createdAt: Date.now(), class: "status", audience: { notify: ["scoutbot"] }, metadata: { source: "broker", flightId: "flt-1", outcome: "failed" },
    });
    await scoutbot.handleItem(itemFor(runtime, "flight-report-1"));

    const outcome = (messageId: string) => runtime.items.get(itemFor(runtime, messageId).id)!.delivery.metadata.outcome;
    expect(outcome("msg.task.failed")).toBe("answered");
    expect(outcome("flight-report-1")).toBe("duplicate_result");
    expect(calls).toHaveLength(3);
    expect(replies().filter((reply) => reply.metadata?.flightId === "flt-1")).toHaveLength(1);
  });

  test("a message item whose message is gone is closed, so it does not hold a place in the inbox", async () => {
    const { runtime, scoutbot, thread } = await setup([]);
    const item = runtime.addItem(
      { id: "msg-gone", conversationId: thread.conversationId, actorId: "operator", body: "", createdAt: Date.now(), audience: { notify: ["scoutbot"] } },
      { message: undefined } as never,
    );
    await scoutbot.handleItem(structuredClone(runtime.items.get(item.id)!) as unknown as InboxItem);
    expect(runtime.items.get(item.id)!.status).toBe("acknowledged");
    expect(runtime.items.get(item.id)!.delivery.metadata.outcome).toBe("missing_message");
  });

  test("a full page of results still waiting for their asks is not read again every second", async () => {
    const { runtime, scoutbot } = await setup([]);
    for (let index = 0; index < 500; index += 1) {
      runtime.addItem({ id: `msg-result-${index}`, conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body: "Done.",
        createdAt: Date.now(), audience: { notify: ["scoutbot"] }, metadata: { flightId: `flt-${index}` } });
    }
    const controller = new AbortController();
    const running = scoutbot.run(controller.signal);
    try {
      await waitFor(() => runtime.inboxReads.stream === 1, "the stream");
      await Bun.sleep(2_500);
      // Nothing closed, so only the 30 s fallback would read again.
      expect(runtime.inboxReads.list).toBe(0);
      expect([...runtime.items.values()].every((item) => item.status === "pending")).toBe(true);
    } finally {
      controller.abort();
      await running;
    }
  }, 10_000);

  test("a result older than the grace still waits when this generation has just started, and is answered once its ask is recorded", async () => {
    let clock = Date.now();
    const { runtime, scoutbot: first, make, ask, replies } = await setup(["Hi.", "Relayed."], { now: () => clock });
    await first.handleItem(ask("msg-1", "hello"));
    // Generation 1 died after the runtime took its ask but before recording it; the agent answered at once.
    runtime.postMessage({
      id: "msg-result", conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body: "Done.",
      createdAt: clock, audience: { notify: ["scoutbot"] }, metadata: { flightId: "flt-late" },
    });
    // Generation 2 starts after the claim runs out and the restart.
    clock += 61_000;
    const second = make();
    await second.handleItem(itemFor(runtime, "msg-result"));
    expect(runtime.items.get(itemFor(runtime, "msg-result").id)!.status).toBe("pending");

    // Pi's replayed ask records the hand-out; the waiting result is read again at once.
    second.recordHandout("flt-late", 7);
    await waitFor(() => replies().some((reply) => reply.id === replyMessageId("msg-result")), "the late result's answer");
    await waitFor(() => runtime.items.get(itemFor(runtime, "msg-result").id)!.status === "acknowledged", "the late result's ack");
  });

  test("turns in one thread reach Pi in the order they were sent, even when routing reads finish out of order", async () => {
    class SlowFirstLookup extends ScoutbotThreadMapStore {
      lookups = 0;
      override async getThreadByConversationId(conversationId: string) {
        const mine = this.lookups++;
        const found = await super.getThreadByConversationId(conversationId);
        if (mine === 0) await Bun.sleep(30);
        return found;
      }
    }
    const { scoutbot, ask, calls } = await setup(["A1", "A2"], { threads: (directory) => new SlowFirstLookup(join(directory, "threads.json")) });
    const first = ask("msg-1", "first", { createdAt: Date.now() - 10 });
    const second = ask("msg-2", "second");
    await Promise.all([scoutbot.handleItem(first), scoutbot.handleItem(second)]);
    expect(calls.map((call) => call.requestId)).toEqual(["msg-1", "msg-2"]);
  });

  test("an inbox backlog larger than one read is worked through, oldest first", async () => {
    const { runtime, scoutbot, thread, replies } = await setup(["Newest."]);
    // The runtime returns at most 500 open items, oldest first.
    const old = Date.now() - 25 * 60 * 60_000;
    for (let index = 0; index < 500; index += 1) {
      runtime.addItem({ id: `msg-old-${index}`, conversationId: thread.conversationId, actorId: "operator", body: "old", createdAt: old + index, audience: { notify: ["scoutbot"] } });
    }
    runtime.addItem({ id: "msg-new", conversationId: thread.conversationId, actorId: "operator", body: "still there?", createdAt: Date.now(), audience: { notify: ["scoutbot"] } });
    const controller = new AbortController();
    const running = scoutbot.run(controller.signal);
    try {
      await waitFor(() => replies().some((reply) => reply.replyToMessageId === "msg-new"), "the item behind the first read", 1_200);
      // The ack follows the reply.
      await waitFor(() => [...runtime.items.values()].every((item) => item.status === "acknowledged"), "every item acked");
      // Read again as the first page closed, not by waiting for a reconnect.
      expect(runtime.inboxReads.stream).toBe(1);
    } finally {
      controller.abort();
      await running;
    }
  }, 15_000);

  test("follows the inbox stream from its snapshot, and catches up after the stream drops", async () => {
    const { runtime, scoutbot, ask, replies } = await setup(["One.", "Two.", "Three."]);
    ask("msg-1", "waiting before start");
    const controller = new AbortController();
    const running = scoutbot.run(controller.signal);
    try {
      await waitFor(() => replies().length === 1, "the waiting message");
      ask("msg-2", "while connected");
      await waitFor(() => replies().length === 2, "the live message");
      runtime.dropStreams();
      ask("msg-3", "while disconnected");
      await waitFor(() => replies().length === 3, "the message from the gap");
      expect(replies().map((reply) => reply.replyToMessageId)).toEqual(["msg-1", "msg-2", "msg-3"]);
    } finally {
      controller.abort();
      await running;
    }
  });

  test("an item deferred before this generation started is answered when it comes due", async () => {
    const { runtime, scoutbot, thread, replies } = await setup(["Later."]);
    const deferred = runtime.addItem(
      { id: "msg-later", conversationId: thread.conversationId, actorId: "operator", body: "try again", createdAt: Date.now(), audience: { notify: ["scoutbot"] } },
      { status: "deferred", delivery: { id: "item-later", metadata: { nextAttemptAt: Date.now() + 1_200 } } },
    );
    const controller = new AbortController();
    const running = scoutbot.run(controller.signal);
    try {
      await Bun.sleep(300);
      expect(replies()).toHaveLength(0);
      await waitFor(() => replies().length === 1, "the deferred message");
      // The ack follows the answer.
      await waitFor(() => runtime.items.get(deferred.id)!.status === "acknowledged", "the deferred message's ack");
    } finally {
      controller.abort();
      await running;
    }
  });

  test("the thread's Pi conversation survives a restart", async () => {
    const first = await setup(["One."]);
    await first.scoutbot.handleItem(first.ask("msg-1", "remember heron"));
    const again = createScoutbotBrainConversationMap(join(first.directory, "conversations.json"));
    expect(again.get(first.thread.threadId)).toBe(7);
    expect(again.threadOf(7)).toBe(first.thread.threadId);
  });

  test("the page the operator has open reaches the model", async () => {
    const { calls, scoutbot, ask } = await setup(["Answer."]);
    await scoutbot.handleItem(ask("msg-1", "what is this?", { metadata: { scoutbotPage: { name: "Sessions", open: ["einstein-13"] } } }));
    expect(JSON.parse(calls[0]!.state!).page).toEqual({ name: "Sessions", open: ["einstein-13"] });
  });
});

describe("renderScoutbotState", () => {
  test("lists live agents first with their project, and work in flight", () => {
    const state = JSON.parse(renderScoutbotState({
      actors: {},
      conversations: {},
      agents: {
        a: { id: "a", handle: "quiet", displayName: "Quiet" },
        b: { id: "b", handle: "busy", displayName: "Busy" },
        scoutbot: { id: "scoutbot", handle: "scoutbot", displayName: "Scout" },
      },
      endpoints: {
        ea: { id: "ea", agentId: "a", state: "offline", cwd: "/x/alpha" },
        eb: { id: "eb", agentId: "b", state: "working", harness: "codex", projectRoot: "/x/openscout" },
      },
      flights: {
        f: { id: "f", targetAgentId: "b", state: "running", startedAt: 0, summary: "typecheck" },
        g: { id: "g", targetAgentId: "a", state: "completed" },
      },
    } as any, 5 * 60_000));
    expect(state.agents.map((agent: { handle: string }) => agent.handle)).toEqual(["busy", "quiet"]);
    expect(state.agents[0]).toMatchObject({ state: "working", harness: "codex", project: "openscout" });
    expect(state.workInFlight).toEqual([{ agent: "b", state: "running", minutes: 5, summary: "typecheck" }]);
    expect(state.page).toBeUndefined();
  });
});
