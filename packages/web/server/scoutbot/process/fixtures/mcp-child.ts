import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { SCOUTBOT_READ_TOOLS } from "../scout-mcp.ts";

/**
 * A stdio Scout MCP server. It records each tool call in calls.jsonl, then
 * answers it only once the test has written an `answer` file, so the test
 * can kill it after the runtime would have accepted the call.
 */
const directory = process.argv[2]!;
const tools = [...SCOUTBOT_READ_TOOLS, "ask", "messages_send"];
const properties = { body: { type: "string" }, projectPath: { type: "string" }, harness: { type: "string" } };
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result: unknown = {};
  if (request.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "recorded-scout", version: "1" } };
  else if (request.method === "tools/list") result = { tools: tools.map((name) => ({ name, inputSchema: { type: "object", properties } })) };
  else if (request.method === "tools/call") {
    appendFileSync(join(directory, "calls.jsonl"), `${JSON.stringify(request.params)}\n`);
    if (!existsSync(join(directory, "answer"))) return;
    result = { content: [{ type: "text", text: "Asked." }], structuredContent: { ok: true, ids: { flightId: "flt-1", invocationId: "inv-1" } } };
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
