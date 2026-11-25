import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";

import { resetChatBlobStoreForTests } from "../image-blob-store.ts";
import { mountBlobRoutes } from "./blobs.ts";

let dir = "";
const before = process.env.OPENSCOUT_CHAT_BLOB_DIR;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "blob-route-"));
  process.env.OPENSCOUT_CHAT_BLOB_DIR = dir;
  resetChatBlobStoreForTests();
});
afterEach(async () => {
  if (before === undefined) delete process.env.OPENSCOUT_CHAT_BLOB_DIR;
  else process.env.OPENSCOUT_CHAT_BLOB_DIR = before;
  resetChatBlobStoreForTests();
  await rm(dir, { recursive: true, force: true });
});

const upload = (app: Hono, headers: Record<string, string> = {}) => app.request("http://localhost/api/blobs", {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ data: Buffer.from("png bytes").toString("base64"), mediaType: "image/png", fileName: "Screenshot 10.12.png" }),
});

test("the operator's upload says where the file sits on this host, under its own name", async () => {
  const app = new Hono();
  mountBlobRoutes(app, { options: {}, isMember: () => false });
  const body = await (await upload(app)).json() as { id: string; localPath?: string };
  expect(body.localPath).toBe(join(dir, "named", body.id, "Screenshot 10.12.png"));
  expect((await stat(body.localPath!)).size).toBe(9);
});

test("a channel member's upload never learns a path on this host", async () => {
  const app = new Hono();
  mountBlobRoutes(app, { options: {}, isMember: (request) => request.headers.has("x-member") });
  const body = await (await upload(app, { "x-member": "1" })).json() as { id: string; localPath?: string };
  expect(body.id).toBeTruthy();
  expect(body).not.toHaveProperty("localPath");
});
