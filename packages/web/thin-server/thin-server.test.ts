import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  createScoutThinHttpHandler,
  discoverLocalTranscripts,
  readTranscriptContextWindow,
  stripPromptEnvelope,
} from "./index.ts";

async function invokeHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  method: string,
  url: string,
  headers: Record<string, string> = {},
) {
  const req = Object.assign(new EventEmitter(), {
    method,
    url,
    headers: { host: "127.0.0.1:4803", ...headers },
    [Symbol.asyncIterator]: async function* () {},
  }) as unknown as IncomingMessage;

  let status = 200;
  let body = "";
  const res = {
    destroyed: false,
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
      return this;
    },
  } as unknown as ServerResponse;

  const handled = await handler(req, res);
  return { handled, status, json: body ? JSON.parse(body) : null };
}

test("stripPromptEnvelope extracts human prompt from XML harness wrappers", () => {
  const raw = `<CONTEXT_SUMMARY>old context</CONTEXT_SUMMARY>\n<USER_REQUEST>\nwe should make this page look amazing btw\n</USER_REQUEST>\n<ADDITIONAL_METADATA>time</ADDITIONAL_METADATA>`;
  expect(stripPromptEnvelope(raw)).toBe("we should make this page look amazing btw");
});

test("thin-server discovers Antigravity workspace and human title, and serves full session-ref and context window", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "scout-thin-kit-test-"));
  const agyUuid = "3a102f26-6237-46c4-ae20-6152148eecaa";
  const agyLogs = path.join(tempHome, ".gemini", "antigravity-cli", "brain", agyUuid, ".system_generated", "logs");
  fs.mkdirSync(agyLogs, { recursive: true });
  fs.writeFileSync(
    path.join(agyLogs, "transcript.jsonl"),
    [
      JSON.stringify({
        step_index: 0,
        type: "SYSTEM_MESSAGE",
        content: "Active Workspaces:\n- /tmp/openscout\nCommand Working Directory: /tmp/openscout",
      }),
      JSON.stringify({
        step_index: 1,
        type: "USER_INPUT",
        content: "<USER_REQUEST>\nMake Scout Search look amazing\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 2,
        type: "PLANNER_RESPONSE",
        content: "Updated the search layout and session drill-down.",
      }),
    ].join("\n") + "\n",
  );

  const prevHome = process.env.SCOUT_SESSIONS_HOME;
  const prevRt = process.env.SCOUT_RUNTIME_URL;
  process.env.SCOUT_SESSIONS_HOME = tempHome;
  process.env.SCOUT_RUNTIME_URL = "http://127.0.0.1:1";

  const handler = createScoutThinHttpHandler({
    packageName: "@openscout/search",
    product: "Search",
  });

  try {
    const discovered = discoverLocalTranscripts();
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.project).toBe("openscout");
    expect(discovered[0]?.title).toBe("Make Scout Search look amazing");

    const context = readTranscriptContextWindow({ sessionId: agyUuid, centerRecord: 2, radius: 1 });
    expect(context?.project).toBe("openscout");
    expect(context?.turns.length).toBe(2);
    expect(context?.turns.some((t) => t.matched && t.text.includes("Updated the search layout"))).toBe(true);

    const refRes = await invokeHandler(handler, "GET", `/api/session-ref/${agyUuid}`);
    expect(refRes.handled).toBe(true);
    expect(refRes.status).toBe(200);
    expect(refRes.json.observe.project).toBe("openscout");
    expect(refRes.json.observe.data.events).toHaveLength(2);

    const recentRes = await invokeHandler(handler, "GET", "/api/recent-sessions?limit=5");
    expect(recentRes.status).toBe(200);
    expect(recentRes.json.sessions[0]?.title).toBe("Make Scout Search look amazing");

    const crossOrigin = await invokeHandler(handler, "GET", "/api/status", { origin: "https://evil.example" });
    expect(crossOrigin.status).toBe(403);
  } finally {
    if (prevHome === undefined) delete process.env.SCOUT_SESSIONS_HOME;
    else process.env.SCOUT_SESSIONS_HOME = prevHome;
    if (prevRt === undefined) delete process.env.SCOUT_RUNTIME_URL;
    else process.env.SCOUT_RUNTIME_URL = prevRt;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
