import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import type { CallToolResult, McpTransport } from "@earendil-works/pi-mcp";

import { SCOUTBOT_READ_TOOLS } from "../scout-mcp.ts";

export const SCOUT_MCP_TOOL_NAMES = [...SCOUTBOT_READ_TOOLS, "ask", "messages_send"];

/** The fields a Scout MCP tool takes in these tests, host-owned ones included. */
const PROPERTIES = Object.fromEntries(
  ["body", "projectPath", "harness", "targetLabel", "channel", "shouldSpeak", "profile", "senderId", "replyMode", "requestId", "placement", "wait"]
    .map((field) => [field, { type: "string" }]),
);

/** An in-memory Scout MCP server that answers tool calls with `handle`. */
export function memoryMcp(
  handle: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
  names: string[] = SCOUT_MCP_TOOL_NAMES,
): () => McpTransport {
  return () => {
    const pair = createInMemoryTransportPair();
    void pair.server.start();
    pair.server.onMessage((message) => {
      if (!("id" in message) || !("method" in message)) return;
      void (async () => {
        let result: unknown = {};
        if (message.method === "initialize") {
          result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "test-scout", version: "1" } };
        } else if (message.method === "tools/list") {
          result = { tools: names.map((name) => ({ name, description: name, inputSchema: { type: "object", properties: PROPERTIES } })) };
        } else if (message.method === "tools/call") {
          const params = message.params as { name: string; arguments: Record<string, unknown> };
          result = await handle(params.name, params.arguments);
        }
        await pair.server.send({ jsonrpc: "2.0", id: message.id, result });
      })().catch(() => undefined);
    });
    return pair.client;
  };
}

/** What the runtime's MCP returns for an accepted background ask. */
export const acceptedAsk = (flightId = "flt-1"): CallToolResult => ({
  content: [{ type: "text", text: `Asked. Flight ${flightId}.` }],
  structuredContent: { ok: true, ids: { flightId, invocationId: "inv-1" } },
});
