import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import fixture from "../../../shared/test-fixtures/operator-notify-image.json";
import { canonicalImageId } from "../../../shared/canonical-attachments.ts";
import { readCanonicalImage } from "./attachment-images.ts";
import type { ScoutBrokerContext } from "./service.ts";
import type { Bridge } from "../pairing/runtime/bridge/bridge.ts";
const testRoot = mkdtempSync(join(tmpdir(), "notify-image-test-"));
const savedEnvironment = { ...process.env };
Object.assign(process.env, { NODE_ENV: "test", HOME: testRoot, OPENSCOUT_HOME: join(testRoot, "home"),
  OPENSCOUT_SUPPORT_DIRECTORY: join(testRoot, "support"), OPENSCOUT_CONTROL_HOME: join(testRoot, "control"),
  OPENSCOUT_CHAT_BLOB_DIR: join(testRoot, "images"), OPENSCOUT_RELAY_HUB: join(testRoot, "relay"),
  OPENSCOUT_BROKER_URL: "http://127.0.0.1:1", OPENSCOUT_PROBES_SOCKET: join(testRoot, "absent.sock") });
const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=";
const id = canonicalImageId(fixture, fixture.attachments[0])!;
const reads: Record<string, unknown>[] = [];
let status = 200;
let override = {};
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  expect(new URL(request.url).pathname).toBe("/v1/attachments/read");
  expect(request.method).toBe("POST");
  reads.push(await request.json() as Record<string, unknown>);
  return Response.json({ blobId: fixture.attachments[0].blob.sha256, messageId: fixture.id, mediaType: "image/png", byteSize: 68, mode: "image", data, fileName: "review.png", ...override }, { status });
} });
const broker = { baseUrl: server.url.origin, node: { id: fixture.originNodeId }, snapshot: {
  conversations: { [fixture.conversationId]: { id: fixture.conversationId, kind: "direct", participantIds: ["operator", fixture.actorId] } },
  messages: { [fixture.id]: fixture }, actors: {}, agents: {}, endpoints: {},
} } as unknown as ScoutBrokerContext;
const original = await import("./service.ts");
mock.module(import.meta.resolve("./service.ts"), () => ({ ...original, loadScoutBrokerContext: async () => broker }));
afterAll(() => { server.stop(true); mock.restore();
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
  rmSync(testRoot, { recursive: true, force: true }); });
test("authorized read carries viewer and message binding, not an arbitrary URL", async () => {
  expect(await readCanonicalImage(broker, "member-fixture", id)).toEqual({ id, data, mediaType: "image/png", size: 68, fileName: "review.png" });
  expect(reads.at(-1)).toEqual({ actorId: "member-fixture", conversationId: fixture.conversationId, messageId: fixture.id, blobId: fixture.attachments[0].blob.sha256, mode: "image" });
});
test("wrong origin, malformed handles, denied/oversize/mismatched bytes fail closed", async () => {
  const before = reads.length;
  expect(await readCanonicalImage({ ...broker, node: { ...broker.node, id: "another-node" } }, "operator", id)).toBeNull();
  expect(await readCanonicalImage(broker, "operator", "scout-image-v1.invalid")).toBeNull();
  expect(reads.length).toBe(before);
  for (const code of [403, 404, 413]) { status = code; expect(await readCanonicalImage(broker, "operator", id)).toBeNull(); }
  status = 200;
  for (const wrong of [{ messageId: "wrong" }, { blobId: "0".repeat(64) }, { mediaType: "image/svg+xml" }, { byteSize: 69 }, { data: Buffer.alloc(68).toString("base64") }, { data: "a".repeat(349529) }]) {
    override = wrong; expect(await readCanonicalImage(broker, "operator", id)).toBeNull();
  }
  override = {};
});
test("#97 web DM route returns PNG; channel guests cannot read operator DMs", async () => {
  const { mountChatRoutes } = await import("../../routes/chat.ts");
  let guest = false;
  const app = new Hono();
  mountChatRoutes(app, { options: {}, currentDirectory: "/tmp", readChannelMemberGrant: () => guest ? {} as never : null,
    channelMemberSessions: { validate: () => null } as never, chatSendLimiter: {} as never, chatPresence: {} as never });
  const url = `/api/channels/${fixture.conversationId}/attachments/${id}`;
  const response = await app.request(url + "?actorId=someone-else");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe(data);
  expect(reads.at(-1)?.actorId).toBe("operator");
  guest = true;
  const count = reads.length;
  expect((await app.request(url)).status).toBe(404);
  expect(reads.length).toBe(count);
  guest = false;
  expect((await app.request(`/api/channels/wrong/attachments/${id}`)).status).toBe(404);
});
test("web conversation projection retains a fetchable binding after origin metadata is omitted", async () => {
  const { getScoutConversationMessages } = await import("../conversations/service.ts");
  const messages = await getScoutConversationMessages(fixture.conversationId, 80, undefined, broker);
  expect(messages?.[0]?.attachments[0]?.id).toBe(id);
});
test("#97 mobile projection and both trusted bridge transports return bytes; legacy blobs still work", async () => {
  const { getScoutMobileConversationMessages } = await import("../mobile/service.ts");
  const { handleRPC } = await import("../pairing/runtime/bridge/server.ts");
  const { bridgeRouter } = await import("../pairing/runtime/bridge/router.ts");
  const { storePairingAttachmentBlob } = await import("../pairing/runtime/bridge/fileserver.ts");
  const messages = await getScoutMobileConversationMessages(fixture.conversationId);
  expect(messages[0]?.attachments?.[0]?.id).toBe(id);
  expect(messages[0]?.attachments?.[0]?.url).toBeUndefined();
  const trusted = { secureTransport: true, trustedPeer: true, deviceId: "fixture-phone" };
  const call = (attachmentId: string, context = trusted) => handleRPC({} as Bridge, { id: 1, method: "mobile/attachments/fetch", params: { id: attachmentId } }, context);
  const response = await call(id);
  expect(response).toEqual({ id: 1, result: { id, data, mediaType: "image/png", size: 68, fileName: "review.png" } });
  const caller = bridgeRouter.createCaller({ bridge: {} as Bridge, cwd: "/tmp", ...trusted });
  expect(await caller.mobile.attachmentFetch({ id })).toEqual(response.result);
  const count = reads.length;
  expect((await call(id, { ...trusted, trustedPeer: false })).error?.code).toBe(-32001);
  const untrusted = bridgeRouter.createCaller({ bridge: {} as Bridge, cwd: "/tmp", ...trusted, trustedPeer: false });
  await expect(untrusted.mobile.attachmentFetch({ id })).rejects.toThrow("trusted paired device");
  expect(reads.length).toBe(count);
  const old = storePairingAttachmentBlob({ data, mediaType: "image/png", fileName: "old.png" }, { origin: "http://127.0.0.1:1" });
  expect((await call(old.id)).result).toMatchObject({ id: old.id, data });
  expect(await caller.mobile.attachmentFetch({ id: old.id })).toMatchObject({ id: old.id, data });
});
