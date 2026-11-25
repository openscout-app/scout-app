import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { ScoutBrokerContext } from "../broker/service.ts";
import type { WebMessage } from "../../../shared/api/web.ts";

// The broker snapshot is a rolling window. These pin that the phone's thread
// read fills a short or empty window from the durable projection instead of
// opening blank on a chat older than the window.

const conversationId = "dm.durable-fallback";
let snapshotMessages: Record<string, unknown> = {};
let durableRows: WebMessage[] = [];
const durableCalls: { limit: number; opts: Record<string, unknown> | undefined }[] = [];

function brokerMessage(id: string, createdAt: number, body: string) {
  return { id, conversationId, actorId: "agent.openscout-2", body, createdAt, class: "agent", metadata: {} };
}

function storedMessage(id: string, createdAt: number, body: string): WebMessage {
  return {
    id, conversationId, actorId: "agent.gone", actorName: "Openscout Agent 2", body, createdAt,
    class: "agent", metadata: null, replyToMessageId: null, threadConversationId: null,
  };
}

const brokerModule = await import("../broker/service.ts");
mock.module(import.meta.resolve("../broker/service.ts"), () => ({
  ...brokerModule,
  loadScoutBrokerContext: async () => ({
    baseUrl: "http://127.0.0.1:1",
    node: { id: "node.test" },
    snapshot: {
      conversations: { [conversationId]: { id: conversationId, kind: "direct", participantIds: ["operator", "agent.openscout-2"] } },
      messages: snapshotMessages,
      actors: {},
      agents: { "agent.openscout-2": { id: "agent.openscout-2", displayName: "Openscout Agent 2" } },
      endpoints: {},
    },
  }) as unknown as ScoutBrokerContext,
}));
const dbModule = await import("../../db-queries.ts");
mock.module(import.meta.resolve("../../db-queries.ts"), () => ({
  ...dbModule,
  queryRecentMessages: (limit: number, opts?: Record<string, unknown>) => {
    durableCalls.push({ limit, opts });
    // The projection answers newest first.
    return [...durableRows].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
}));

const { getScoutMobileConversationMessages } = await import("./service.ts");

beforeEach(() => {
  snapshotMessages = {};
  durableRows = [];
  durableCalls.length = 0;
});
afterAll(() => mock.restore());

test("a chat older than the window opens on the durable tail, oldest first", async () => {
  durableRows = [storedMessage("m1", 1_000, "first"), storedMessage("m2", 2_000, "second"), storedMessage("m3", 3_000, "third")];

  const messages = await getScoutMobileConversationMessages(conversationId, 2);

  expect(messages.map((message) => message.id)).toEqual(["m2", "m3"]);
  expect(messages[0]?.authorLabel).toBe("Openscout Agent 2");
  expect(durableCalls).toEqual([{ limit: 2, opts: { conversationId } }]);
});

test("a short window is extended below its oldest message", async () => {
  snapshotMessages = { m3: brokerMessage("m3", 3_000, "live") };
  durableRows = [storedMessage("m1", 1_000, "first"), storedMessage("m2", 2_000, "second")];

  const messages = await getScoutMobileConversationMessages(conversationId, 3);

  expect(messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
  expect(durableCalls).toHaveLength(1);
  expect(durableCalls[0]?.limit).toBe(2);
  expect(typeof durableCalls[0]?.opts?.beforeMessageId).toBe("string");
});

test("a full window never reads the durable projection", async () => {
  snapshotMessages = {
    m1: brokerMessage("m1", 1_000, "one"),
    m2: brokerMessage("m2", 2_000, "two"),
  };

  const messages = await getScoutMobileConversationMessages(conversationId, 2);

  expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  expect(durableCalls).toHaveLength(0);
});
