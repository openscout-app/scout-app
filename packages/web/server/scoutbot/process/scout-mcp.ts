import { resolveBrokerServiceConfig } from "@openscout/runtime/broker-process-manager";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { McpClient, StdioTransport, toLlmContent, type McpTransport, type CallToolResult } from "@earendil-works/pi-mcp";
import { readScoutbotGuide, SCOUTBOT_GUIDE_TOPICS, type ScoutbotGuideTopic } from "./scoutbot-guide.ts";

/**
 * The runtime calls Scoutbot may make: reads for finding what the operator
 * means, and two writes. Scoutbot is the loose layer: it searches and
 * resolves so the operator need not be precise. The runtime is the exact
 * layer underneath: it runs, retries and reports the work.
 */
export const SCOUTBOT_READ_TOOLS = [
  "route_context", "where", "check",
  "agents_search", "agents_resolve", "aliases_resolve", "aliases_list",
  "hosts_list", "sessions_inventory", "sessions_search", "herdr_workspaces",
  "broker_feed", "invocations_get", "labels_brief", "whoami",
];
const WRITE_TOOLS = ["ask", "messages_send"] as const;
type WriteTool = (typeof WRITE_TOOLS)[number];

/** Fields the host owns. The model never sets identity, waiting, lifecycle or permissions. */
const HOST_OWNED_FIELDS = ["senderId", "requesterId", "currentDirectory", "requestId", "profile", "permission", "permissionProfile",
  "replyMode", "replyToSessionId", "wait", "timeoutSeconds", "placement", "wake", "interaction", "workItem"];

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * The runtime's idempotency key for one write. The same write in the same
 * turn is the same request, so a model retry after a dropped connection gets
 * the original receipt from the runtime instead of a second ask.
 */
export const scoutbotRequestId = (turn: string, tool: string, args: unknown) =>
  `scoutbot:${createHash("sha256").update(stableJson([turn, tool, args])).digest("hex")}`;

export type ScoutbotMcp = ReturnType<typeof createScoutbotMcp>;

export function createScoutbotMcp(options: {
  /** The child's runtime socket: the claim proxy, so its writes carry the answerer claim. */
  socketPath: string;
  currentDirectory: string;
  transport?: () => McpTransport;
  /** The turn a Pi conversation is answering: the source message id. */
  turnOf?: (conversationId: number) => string | undefined;
  /** An ask was accepted and has a flight; its result will come back as a message. */
  onAsked?: (flightId: string, conversationId: number) => void;
  log?: (message: string) => void;
}) {
  const log = options.log ?? ((message: string) => console.warn("[scoutbot mcp]", message));
  let client: McpClient | undefined;
  let connecting: Promise<McpClient> | undefined;
  let stopped = false;
  const connect = async () => {
    if (stopped) throw new Error("Scout MCP is stopped");
    if (client?.connectionState === "connected") return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const candidate = new McpClient({ name: "scout-bot", version: "1", requestTimeoutMs: 45_000 });
      // Source CLI avoids a stale dist bundle. mcp is excluded from CLI freshness/restart maintenance.
      const entry = fileURLToPath(import.meta.resolve("@openscout/scout/bin/scout.mjs"));
      const transport = options.transport?.() ?? new StdioTransport({
        command: process.execPath, args: [entry, "mcp", "--context-root", options.currentDirectory],
        cwd: options.currentDirectory,
        env: { OPENSCOUT_AGENT: "scoutbot", OPENSCOUT_BROKER_SOCKET_ONLY: "1", OPENSCOUT_BROKER_SOCKET_PATH: options.socketPath,
          OPENSCOUT_BROKER_URL: process.env.OPENSCOUT_BROKER_URL || resolveBrokerServiceConfig().brokerUrl,
          CODEX_THREAD_ID: "", OPENSCOUT_CODEX_THREAD_ID: "", OPENSCOUT_SESSION_ID: "", OPENSCOUT_REPLY_CONTEXT: "", OPENSCOUT_REPLY_CONTEXT_FILE: "", SCOUT_REPLY_CONTEXT: "" },
        onStderr: chunk => console.warn("[scoutbot mcp]", chunk.trim()),
      });
      await candidate.connect(transport).catch(async error => { await candidate.close(); throw error; });
      client = candidate;
      candidate.onClose(() => {
        if (client === candidate) client = undefined;
        if (!stopped) setTimeout(() => void connect().catch(error => log(`reconnect: ${String(error)}`)), 1000).unref();
      });
      return candidate;
    })();
    try { return await connecting; } finally { connecting = undefined; }
  };
  const call = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    (await connect()).callTool(name, { ...args, senderId: "scoutbot", currentDirectory: options.currentDirectory }, { signal });

  const write = async (tool: WriteTool, args: Record<string, unknown>, conversationId: number, callId: string, signal?: AbortSignal): Promise<CallToolResult> => {
    // The turn does not wait for a hand-out: the runtime notifies Scoutbot
    // when the work finishes. Placement is left to the runtime, so an ask to a
    // live session reaches that session rather than a new one.
    const requestId = scoutbotRequestId(options.turnOf?.(conversationId) ?? `call:${callId}`, tool, args);
    let receipt: CallToolResult;
    try {
      receipt = await call(tool, { ...args, requestId }, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return { isError: true, content: [{ type: "text", text: `The Scout connection dropped during ${tool}; it may have been sent. Repeating the same ${tool} is safe: the runtime keeps one request per key. (${String(error)})` }] };
    }
    const structured = receipt.structuredContent as { ids?: { flightId?: unknown }; flightId?: unknown } | undefined;
    const flightId = structured?.ids?.flightId ?? structured?.flightId;
    if (tool === "ask" && !receipt.isError && typeof flightId === "string") {
      try { options.onAsked?.(flightId, conversationId); } catch (error) { log(`could not record hand-out ${flightId}: ${String(error)}`); }
    }
    return receipt;
  };

  return {
    connect,
    call,
    tools: async (): Promise<ToolRegistration[]> => {
      const available = await (await connect()).listTools();
      const registrations: ToolRegistration[] = [];
      for (const name of [...SCOUTBOT_READ_TOOLS, ...WRITE_TOOLS]) {
        const source = available.find(tool => tool.name === name);
        if (!source) {
          if (name === "ask") throw new Error("Scout MCP is missing ask");
          log(`Scout MCP has no ${name}; Scoutbot goes without it`);
          continue;
        }
        const schema = structuredClone(source.inputSchema);
        const properties = (schema.properties ?? {}) as Record<string, unknown>;
        for (const field of HOST_OWNED_FIELDS) delete properties[field];
        if (name === "messages_send") {
          for (const field of Object.keys(properties)) if (!["body", "targetLabel", "channel", "shouldSpeak"].includes(field)) delete properties[field];
          schema.required = ["body", "targetLabel"];
        } else schema.required = (Array.isArray(schema.required) ? schema.required as string[] : []).filter(field => field in properties);
        schema.properties = properties;
        schema.additionalProperties = false;
        const writeTool = (WRITE_TOOLS as readonly string[]).includes(name) ? name as WriteTool : undefined;
        registrations.push(defineTool({
          name, description: source.description ?? name, parameters: Type.Unsafe<Record<string, unknown>>(schema), replay: "safe", executionMode: "sequential",
          execute: async (input, api, context) => {
            // The schema hides these fields; a model that sends them anyway is ignored.
            const args = Object.fromEntries(Object.entries(input).filter(([field]) => !HOST_OWNED_FIELDS.includes(field)));
            const result = writeTool
              ? await write(writeTool, args, api.conversationId as number, api.callId, context.abortSignal)
              : await call(name, args, context.abortSignal);
            return { content: toLlmContent(result), isError: result.isError };
          },
        }));
      }
      registrations.push(defineTool({
        name: "scoutbot_guide",
        description: "Read Scout's maintained app and protocol guidance on demand. Use for questions about the Scout app, UI, native app, runtime/protocol, routing, or operator attention. Choose one topic; this reads docs only when called.",
        parameters: Type.Object({ topic: Type.Union(Object.keys(SCOUTBOT_GUIDE_TOPICS).map((topic) => Type.Literal(topic))) }),
        replay: "safe", executionMode: "sequential",
        execute: async (input) => ({ content: [{ type: "text", text: await readScoutbotGuide(input.topic as ScoutbotGuideTopic) }] }),
      }));
      return registrations;
    },
    close: async () => { stopped = true; const current = client ?? await connecting?.catch(() => undefined); client = undefined; await current?.close(); },
  };
}
