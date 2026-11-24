/**
 * Opt-in compatibility check. Pass a dependency-installed public Scout source
 * checkout. Exercise its SQLite writer, Feed HTTP handler and message reader;
 * do not use the user's broker, harness history or a captured snapshot.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createFeedApi } from "../routes/feed.ts";
import type { FeedResponse, FeedPostDetail } from "../../shared/api/feed.ts";
import type { DiscussionMessage } from "../../shared/api/feed-discussion.ts";

if (!process.argv[2]) throw new Error("Pass the path of a public Scout source checkout");
const source = resolve(process.argv[2], "packages/runtime/src");
const load = (file: string) => import(pathToFileURL(join(source, file + ".ts")).href);
const root = await mkdtemp(join(tmpdir(), "feed-core-check-"));
const clean: (() => unknown)[] = [];
try {
  process.env.OPENSCOUT_CONTROL_HOME = root;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = root;
  const { SQLiteControlPlaneStore } = await load("sqlite-store");
  const { openControlPlaneSqliteDatabase } = await load("sqlite-adapter");
  const { queryFeedWork } = await load("feed-work");
  const { handleFeedWorkRoute } = await load("broker-feed-work-http");
  const { listBrokerMessagesAsync } = await load("broker-core-message-read-model");
  const file = join(root, "control-plane.sqlite");
  const store = new SQLiteControlPlaneStore(file);
  clean.push(() => store.close());
  const db = openControlPlaneSqliteDatabase(file, { readonly: true, create: false });
  clean.push(() => db.close());
  const at = Date.now(),
    nodeId = "test-node",
    actorId = "example-agent",
    conversationId = "chn-example";
  store.upsertNode({
    id: nodeId,
    meshId: "test",
    name: "Test node",
    advertiseScope: "local",
    registeredAt: at - 10_000,
  });
  store.upsertActor({ id: "operator", kind: "person", displayName: "Operator" });
  store.upsertActor({ id: actorId, kind: "agent", displayName: "Example" });
  store.upsertAgent({
    id: actorId,
    kind: "agent",
    definitionId: actorId,
    displayName: "Example",
    agentClass: "general",
    capabilities: ["chat"],
    wakePolicy: "on_demand",
    homeNodeId: nodeId,
    authorityNodeId: nodeId,
    advertiseScope: "local",
  });
  store.upsertEndpoint({
    id: "ep",
    agentId: actorId,
    nodeId,
    harness: "codex",
    transport: "codex_exec",
    state: "active",
    sessionId: "other-current-session",
  });
  store.upsertConversation({
    id: conversationId,
    kind: "direct",
    title: "Navigation",
    visibility: "private",
    shareMode: "local",
    authorityNodeId: nodeId,
    participantIds: ["operator", actorId],
  });
  const query = (url: URL) =>
    listBrokerMessagesAsync(
      { snapshot: () => store.loadSnapshot() },
      {
        conversationId: url.searchParams.get("conversationId"),
        limit: Number(url.searchParams.get("limit")),
      },
    );
  // Only the public readers under test are mounted. No daemon discovery, agent
  // invocation, listening outside loopback, or production control-plane writes.
  const runtime = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "GET") return new Response(null, { status: 405 });
      if (url.pathname === "/v1/node") return Response.json({ id: nodeId });
      if (url.pathname === "/v1/posts") return Response.json({ posts: [] });
      if (url.pathname.startsWith("/v1/messages/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/messages/".length));
        const message = store.readMessages([id]).get(id);
        return Response.json(message ? { message } : { error: "not found" }, { status: message ? 200 : 404 });
      }
      if (url.pathname === "/v1/messages") return Response.json(await query(url));
      let status = 0,
        text = "";
      const response = {
        writeHead(code: number) {
          status = code;
          return this;
        },
        end(body: string) {
          text = body;
        },
      };
      const handled = handleFeedWorkRoute({ method: "GET", transportContext: { transport: "local" } }, response, url, {
        read: (read: unknown) => queryFeedWork(db, read, ["operator"]),
      });
      return new Response(text, { status: handled ? status : 404, headers: { "content-type": "application/json" } });
    },
  });
  clean.push(() => runtime.stop(true));
  const api = createFeedApi({ brokerUrl: runtime.url.origin, refreshMs: 0, now: () => at });
  clean.push(() => api.close());
  const read = async <T>(path: string): Promise<T> => {
    const r = await api.handle(new Request("http://localhost" + path));
    assert.equal(r?.status, 200);
    return (await r!.json()) as T;
  };
  assert.equal((await read<FeedResponse>("/api/feed")).size.posts, 0);
  const message = (id: string, author: string, body: string, createdAt: number, replyToMessageId?: string) =>
    store.recordMessage({
      id,
      conversationId,
      actorId: author,
      body,
      createdAt,
      originNodeId: nodeId,
      class: "agent",
      visibility: "private",
      policy: "durable",
      ...(replyToMessageId ? { replyToMessageId } : {}),
    });
  message("request", "operator", "Check the navigation.", at - 3000);
  store.recordCollaborationRecord({
    id: "work-example",
    kind: "work_item",
    title: "Check the navigation.",
    state: "done",
    acceptanceState: "none",
    createdById: "operator",
    ownerId: actorId,
    nextMoveOwnerId: "operator",
    requestedById: "operator",
    conversationId,
    createdAt: at - 3000,
    updatedAt: at - 1000,
    metadata: { lastInvocationId: "inv-example" },
  });
  store.recordInvocation({
    id: "inv-example",
    requesterId: "operator",
    requesterNodeId: nodeId,
    targetAgentId: actorId,
    action: "consult",
    task: "Check the navigation.",
    collaborationRecordId: "work-example",
    messageId: "request",
    ensureAwake: true,
    stream: false,
    createdAt: at - 3000,
  });
  store.recordFlight({
    id: "flight-example",
    invocationId: "inv-example",
    requesterId: "operator",
    targetAgentId: actorId,
    state: "completed",
    metadata: {
      sessionTrace: [
        { sessionId: "original-session", endpointId: "ep", startedAt: at - 3000, lastAcknowledgedAt: at - 1000 },
      ],
    },
  });
  message("answer", actorId, "Opened the exact discussion.", at - 1000, "request");
  const page = await read<FeedResponse>("/api/feed?view=all");
  assert.equal(page.size.posts, 1);
  const head = page.posts[0]!;
  assert.equal(head.id, "test-node:thread:original-session");
  assert.equal(head.owner.sessionId, "original-session");
  assert.equal(head.workId, "work-example");
  assert.equal(head.conversationId, conversationId);
  const detail = await read<FeedPostDetail>("/api/feed/post/" + encodeURIComponent(head.id));
  assert.match(detail.body.landed, /exact discussion/);
  assert.equal(detail.body.open, null); // "Opened" is an outcome, not an Open section.
  const messages = await read<DiscussionMessage[]>(
    "/api/messages?conversationId=" + encodeURIComponent(head.conversationId!),
  );
  assert.deepEqual(
    messages.map((m) => m.id),
    ["request", "answer"],
  );
  assert.equal(messages[1]!.replyToMessageId, messages[0]!.id);
  const exact = await read<DiscussionMessage[]>(
    "/api/messages?" + new URLSearchParams({ conversationId, workId: head.workId }),
  );
  assert.deepEqual(
    exact.map((m) => m.id),
    messages.map((m) => m.id),
  );
  console.log("PASS public SQLite work → public Feed work HTTP → ranked post → exact discussion and reply");
} finally {
  try {
    for (const close of clean.reverse()) await close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
