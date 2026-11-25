import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A runtime stand-in on a Unix socket, for Scoutbot's tests. Its inbox keeps
 * the runtime's lease rules (broker-delivery-store, broker-delivery-http-service):
 * a claim takes a claimable item and bumps its lease generation; ack and nack
 * need the live lease, its owner and its generation, or get 409; nack with a
 * delay defers the item. A message reposted under its id is accepted only
 * with the same body.
 */

type Message = { id: string; conversationId: string; actorId: string; body: string; createdAt: number; audience?: { notify?: string[] }; [key: string]: unknown };
type Item = {
  id: string; kind: "message"; targetId: string; messageId: string; conversationId: string; reason: string;
  status: string; leaseOwner?: string; leaseExpiresAt?: number; leaseGeneration?: number;
  delivery: { id: string; metadata: Record<string, unknown> }; message: Message;
};

export type FakeRuntime = ReturnType<typeof startFakeRuntime>;

export function startFakeRuntime(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const directory = mkdtempSync(join(tmpdir(), "scoutbot-runtime-"));
  const socketPath = join(directory, "runtime.sock");
  const messages = new Map<string, Message>();
  const items = new Map<string, Item>();
  const writes: Array<{ path: string; body: any }> = [];
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  /** How often the inbox was read, by list and by stream connect. */
  const inboxReads = { list: 0, stream: 0 };
  const encoder = new TextEncoder();
  let itemSeq = 0;
  let refusal: ((path: string, body: any) => number | undefined) | undefined;

  const send = (event: string, data: unknown) => {
    const frame = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const controller of streams) controller.enqueue(frame);
  };
  const view = (item: Item) => structuredClone(item);
  const claimable = (item: Item) => {
    if (item.status === "pending" || item.status === "accepted") return true;
    if (item.status === "deferred") {
      const due = item.delivery.metadata.nextAttemptAt;
      return typeof due !== "number" || due <= now();
    }
    return item.status === "leased" && (item.leaseExpiresAt ?? 0) <= now();
  };
  const leaseHeld = (item: Item, owner: string, generation: unknown) =>
    item.status === "leased" && item.leaseOwner === owner && (item.leaseExpiresAt ?? 0) > now() && item.leaseGeneration === generation;

  const postMessage = (message: Message) => {
    const existing = messages.get(message.id);
    if (existing) return existing.body === message.body ? 200 : 409;
    messages.set(message.id, message);
    if (message.audience?.notify?.includes("scoutbot") && message.actorId !== "scoutbot") {
      const item: Item = {
        id: `item-${++itemSeq}`, kind: "message", targetId: "scoutbot", messageId: message.id, conversationId: message.conversationId,
        reason: "direct_message", status: "pending", delivery: { id: `item-${itemSeq}`, metadata: {} }, message,
      };
      items.set(item.id, item);
      send("inbox.item", view(item));
    }
    return 200;
  };

  const server = Bun.serve({
    unix: socketPath,
    fetch: async (request, self) => {
      self.timeout(request, 0);
      const url = new URL(request.url);
      const path = url.pathname;
      const body = request.method === "POST" ? await request.json() : undefined;
      if (body !== undefined) writes.push({ path, body });
      const json = (value: unknown, status = 200) => Response.json(value, { status });
      const refused = body !== undefined ? refusal?.(path, body) : undefined;
      if (refused) return json({ error: "refused" }, refused);
      if (request.method === "GET") {
        if (path === "/v1/node") return json({ id: "node-1" });
        if (path === "/v1/snapshot") return json({ actors: {}, agents: { "einstein-13": { id: "einstein-13", handle: "einstein-13" } }, endpoints: {}, conversations: {}, flights: {} });
        if (path === "/v1/messages") {
          const conversationId = url.searchParams.get("conversationId");
          const since = Number(url.searchParams.get("since") ?? 0);
          return json([...messages.values()].filter((m) => (!conversationId || m.conversationId === conversationId) && m.createdAt >= since));
        }
        if (path === "/v1/inbox" || path === "/v1/inbox/stream") {
          inboxReads[path === "/v1/inbox" ? "list" : "stream"] += 1;
          const reasons = url.searchParams.get("reason")?.split(",");
          // Like the runtime: at most 500 open items, oldest first.
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 500);
          const open = [...items.values()].filter((item) => item.status !== "acknowledged" && (!reasons || reasons.includes(item.reason)))
            .slice(0, limit).map(view);
          if (path === "/v1/inbox") return json(open);
          let mine: ReadableStreamDefaultController<Uint8Array>;
          return new Response(new ReadableStream<Uint8Array>({
            start: (controller) => {
              mine = controller;
              streams.add(controller);
              controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ targetId: "scoutbot", items: open })}\n\n`));
            },
            cancel: () => { streams.delete(mine); },
          }), { headers: { "content-type": "text/event-stream" } });
        }
        return json({ error: `unexpected GET ${path}` }, 404);
      }
      if (path === "/v1/messages") return json({ ok: true }, postMessage(body));
      if (path === "/v1/inbox/claim") {
        const item = items.get(body.itemId);
        if (!item || item.targetId !== body.targetId || !claimable(item)) return json({ ok: true, claimed: null });
        item.status = "leased";
        item.leaseOwner = body.leaseOwner;
        item.leaseExpiresAt = now() + (body.leaseMs ?? 30_000);
        item.leaseGeneration = (item.leaseGeneration ?? 0) + 1;
        send("inbox.item.updated", view(item));
        return json({ ok: true, claimed: view(item) });
      }
      if (path === "/v1/inbox/ack" || path === "/v1/inbox/nack") {
        const item = items.get(body.itemId);
        if (!item || !leaseHeld(item, body.leaseOwner, body.leaseGeneration)) return json({ ok: false, error: "lease_conflict" }, 409);
        const deferred = path === "/v1/inbox/nack" && body.retryAfterMs > 0;
        item.status = path === "/v1/inbox/ack" ? "acknowledged" : deferred ? "deferred" : "pending";
        item.delivery.metadata = { ...item.delivery.metadata, ...(body.metadata ?? {}), ...(deferred ? { nextAttemptAt: now() + body.retryAfterMs } : {}) };
        delete item.leaseOwner;
        delete item.leaseExpiresAt;
        send("inbox.item.updated", view(item));
        return json({ ok: true, itemId: item.id, status: item.status });
      }
      return json({ ok: true });
    },
  });

  return {
    socketPath,
    messages,
    items,
    writes,
    inboxReads,
    postMessage,
    /** Makes the runtime answer matching writes with this status. */
    refuse: (rule: ((path: string, body: any) => number | undefined) | undefined) => { refusal = rule; },
    /** Adds an inbox item by hand, for cases the runtime makes elsewhere. */
    addItem: (message: Message, fields: Partial<Item> = {}) => {
      messages.set(message.id, message);
      const item: Item = {
        id: `item-${++itemSeq}`, kind: "message", targetId: "scoutbot", messageId: message.id, conversationId: message.conversationId,
        reason: "direct_message", status: "pending", delivery: { id: `item-${itemSeq}`, metadata: {} }, message, ...fields,
      };
      items.set(item.id, item);
      return item;
    },
    /** Ends every open inbox stream, as a runtime restart would. */
    dropStreams: () => { for (const controller of streams) controller.close(); streams.clear(); },
    stop: async () => {
      for (const controller of streams) { try { controller.close(); } catch { /* already closed */ } }
      streams.clear();
      await server.stop(true);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
