import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { defineTool } from "@earendil-works/pi-durable";
import { StdioTransport } from "@earendil-works/pi-mcp";
import { afterEach, describe, expect, test } from "bun:test";

import { createScoutbotBrain, openBunSqliteStorage } from "../../scoutbot-brain.ts";
import { ScoutbotThreadMapStore } from "../thread-map.ts";
import { createScoutbotBrokerLink } from "./broker-link.ts";
import { startFakeRuntime } from "./fixtures/fake-runtime.ts";
import { acceptedAsk, memoryMcp, SCOUT_MCP_TOOL_NAMES } from "./fixtures/memory-mcp.ts";
import { createScoutbotHandouts } from "./handouts.ts";
import { createScoutbotMcp, scoutbotRequestId } from "./scout-mcp.ts";
import {
  createScoutbotBrainConversationMap,
  createScoutbotProcess,
  replyMessageId,
  SCOUTBOT_LEASE_OWNER,
  SCOUTBOT_PROCESS_SYSTEM_PROMPT,
} from "./scoutbot-process.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function child(fixture: string, args: string[]): { process: ChildProcess; stderr: () => string } {
  const spawned = spawn(process.execPath, [fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)), ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  spawned.stderr!.on("data", (chunk) => { stderr += chunk; });
  cleanups.push(() => { spawned.kill("SIGKILL"); });
  return { process: spawned, stderr: () => stderr };
}

async function until(condition: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

async function kill(spawned: ChildProcess) {
  const exited = new Promise((resolve) => spawned.once("exit", resolve));
  spawned.kill("SIGKILL");
  await exited;
}

const readLines = (filePath: string) => existsSync(filePath)
  ? readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const context = () => ({ abortSignal: new AbortController().signal }) as any;
const askArgs = { projectPath: "/repo", harness: "codex", body: "Run the typecheck" };

describe("Scoutbot turn durability", () => {
  test("SIGKILL during a replay-safe Pi tool keeps its call id and its request id", async () => {
    const directory = tempDirectory("scoutbot-pi-replay-");
    const replay = child("replay-child.ts", [directory]);
    await until(() => existsSync(join(directory, "in-flight")), `the child's tool call (${replay.stderr()})`);
    await kill(replay.process);
    const conversationId = Number(readFileSync(join(directory, "conversation"), "utf8"));
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([fauxAssistantMessage("Recovered.")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const brain = createScoutbotBrain({
      currentDirectory: directory, models, provider: "faux",
      openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")),
      tools: async () => [defineTool({
        name: "ask", description: "test", parameters: Type.Object({ body: Type.String() }), replay: "safe",
        execute: async (_args, api) => {
          appendFileSync(join(directory, "call-ids"), `${api.callId}\n`);
          return { content: [{ type: "text", text: "original receipt" }] };
        },
      })],
    });
    cleanups.push(() => brain.close());
    const reply = await brain.reply({ conversationId, requestId: "source-1", body: "build", model: "faux-1", systemPrompt: "test" });
    expect(reply.text).toBe("Recovered.");
    expect(readFileSync(join(directory, "call-ids"), "utf8").trim().split("\n")).toEqual(["stable-pi-call", "stable-pi-call"]);
    expect(faux.state.callCount).toBe(1);
  }, 10_000);

  test("a Scoutbot killed mid-ask comes back to the same turn: one ask, one answer, and the result reaches the thread", async () => {
    const directory = tempDirectory("scoutbot-turn-kill-");
    const runtime = startFakeRuntime();
    cleanups.push(() => runtime.stop());
    const threads = new ScoutbotThreadMapStore(join(directory, "threads.json"));
    const thread = await threads.ensureDefaultThread({ transport: "local_socket" });

    // Generation 1 takes the operator's message and is killed while its ask is in the runtime's hands.
    const first = child("turn-child.ts", [directory, runtime.socketPath]);
    await until(() => existsSync(join(directory, "ready")), `generation 1 to start (${first.stderr()})`);
    runtime.postMessage({ id: "msg-1", conversationId: thread.conversationId, actorId: "operator", body: "Get einstein to run the typecheck", createdAt: Date.now(), audience: { notify: ["scoutbot"] } });
    await until(() => readLines(join(directory, "asks.jsonl")).length > 0, `generation 1's ask (${first.stderr()})`);
    await kill(first.process);
    const item = [...runtime.items.values()].find((candidate) => candidate.messageId === "msg-1")!;
    expect(item).toMatchObject({ status: "leased", leaseOwner: SCOUTBOT_LEASE_OWNER, leaseGeneration: 1 });

    // Generation 2.
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([fauxAssistantMessage("I asked einstein-13 to run the typecheck."), fauxAssistantMessage("einstein-13 ran it: the typecheck passes.")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const asks: Array<Record<string, unknown>> = [];
    const conversations = createScoutbotBrainConversationMap(join(directory, "conversations.json"));
    let scoutbot: ReturnType<typeof createScoutbotProcess> | undefined;
    const mcp = createScoutbotMcp({
      socketPath: runtime.socketPath, currentDirectory: directory, log: () => undefined,
      turnOf: (conversationId) => scoutbot?.turnOf(conversationId),
      onAsked: (flightId, conversationId) => scoutbot?.recordHandout(flightId, conversationId),
      transport: memoryMcp(async (name, args) => {
        if (name !== "ask") return { content: [] };
        asks.push(args);
        return acceptedAsk("flt-1");
      }),
    });
    cleanups.push(() => mcp.close());
    const brain = createScoutbotBrain({
      currentDirectory: directory, models, provider: "faux",
      openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")),
      tools: () => mcp.tools(),
    });
    cleanups.push(() => brain.close());
    scoutbot = createScoutbotProcess({
      broker: createScoutbotBrokerLink({ socketPath: runtime.socketPath }),
      brain, currentDirectory: directory, model: "faux-1", threads, conversations,
      handouts: createScoutbotHandouts(join(directory, "handouts.json")),
      log: { info: () => undefined, warn: () => undefined },
    });

    // Pi resumes the unfinished turn as soon as it opens, before this
    // generation has read its inbox. The replayed ask still knows its turn.
    const known = conversations.get(thread.threadId);
    expect(known).not.toBeNull();
    await brain.ensureConversation!({ conversationId: known, model: "faux-1", systemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT });
    await until(() => asks.length > 0, "the replayed ask");

    const stop = new AbortController();
    const running = scoutbot.run(stop.signal);
    cleanups.push(async () => { stop.abort(); await running; });
    await until(() => runtime.messages.has(replyMessageId("msg-1")), "the answer to msg-1");

    const firstAsk = readLines(join(directory, "asks.jsonl"));
    const expectedRequestId = scoutbotRequestId("msg-1", "ask", askArgs);
    expect(firstAsk.map((args) => args.requestId)).toEqual([expectedRequestId]);
    expect(asks.map((args) => args.requestId)).toEqual([expectedRequestId]);
    expect(asks[0]).toMatchObject({ ...askArgs, senderId: "scoutbot" });
    // Placement and reply mode are the runtime's defaults, so an ask to a live session reaches it.
    expect(asks[0]!.replyMode).toBeUndefined();
    expect(asks[0]!.placement).toBeUndefined();

    const answers = [...runtime.messages.values()].filter((message) => message.actorId === "scoutbot");
    expect(answers.map((message) => [message.id, message.replyToMessageId, message.body]))
      .toEqual([[replyMessageId("msg-1"), "msg-1", "I asked einstein-13 to run the typecheck."]]);
    expect(runtime.writes.filter((write) => write.path.startsWith("/v1/inbox/") && write.body.itemId === item.id).map((write) => [write.path, write.body.leaseGeneration ?? null]))
      .toEqual([["/v1/inbox/claim", null], ["/v1/inbox/nack", 1], ["/v1/inbox/claim", null], ["/v1/inbox/ack", 2]]);
    await until(() => runtime.items.get(item.id)!.status === "acknowledged", "the ack");
    expect(JSON.parse(readFileSync(join(directory, "handouts.json"), "utf8")).flights["flt-1"])
      .toMatchObject({ threadId: thread.threadId, sourceMessageId: "msg-1", actorId: "operator" });

    // The runtime finishes the ask and notifies Scoutbot in the conversation it made with einstein-13.
    runtime.postMessage({
      id: "msg-result", conversationId: "dm.einstein-13.scoutbot", actorId: "einstein-13", body: "Typecheck passes.", createdAt: Date.now(),
      audience: { notify: ["scoutbot"] }, replyToMessageId: "msg-ask", metadata: { flightId: "flt-1", invocationId: "inv-1" },
    });
    await until(() => runtime.messages.has(replyMessageId("msg-result")), "the result in the thread");
    expect(runtime.messages.get(replyMessageId("msg-result"))).toMatchObject({
      conversationId: thread.conversationId, replyToMessageId: "msg-1", body: "einstein-13 ran it: the typecheck passes.",
      metadata: expect.objectContaining({ flightId: "flt-1", resultMessageId: "msg-result" }),
    });
    expect(asks).toHaveLength(1);
    expect(faux.state.callCount).toBe(2);
  }, 20_000);
});

describe("Scoutbot's Scout MCP", () => {
  test("tools hide host-owned fields; asks run in the background under the turn's request id", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const asked: Array<[string, number]> = [];
    const logged: string[] = [];
    const turns = new Map([[1, "msg-1"]]);
    const mcp = createScoutbotMcp({
      socketPath: "/unused", currentDirectory: "/work", log: (line) => logged.push(line),
      turnOf: (conversationId) => turns.get(conversationId),
      onAsked: (flightId, conversationId) => asked.push([flightId, conversationId]),
      transport: memoryMcp(async (name, args) => {
        calls.push({ name, args });
        return name === "ask" ? acceptedAsk("flt-1") : { content: [{ type: "text", text: "ok" }] };
      }, SCOUT_MCP_TOOL_NAMES.filter((name) => name !== "herdr_workspaces")),
    });
    cleanups.push(() => mcp.close());
    const tools = await mcp.tools();
    expect(tools.map((tool) => tool.name)).toEqual([...SCOUT_MCP_TOOL_NAMES.filter((name) => name !== "herdr_workspaces"), "scoutbot_guide"]);
    expect(logged).toEqual(["Scout MCP has no herdr_workspaces; Scoutbot goes without it"]);
    const ask = tools.find((tool) => tool.name === "ask")!;
    for (const field of ["profile", "senderId", "replyMode", "requestId", "placement", "wait"]) expect(ask.parameters.properties).not.toHaveProperty(field);
    expect(Object.keys(tools.find((tool) => tool.name === "messages_send")!.parameters.properties).sort())
      .toEqual(["body", "channel", "shouldSpeak", "targetLabel"]);

    // The model sends a host-owned field anyway, then asks again after a retry: one request id.
    await ask.execute({ ...askArgs, replyMode: "none", profile: "max" }, { conversationId: 1, callId: "call-a" } as any, context());
    await ask.execute(askArgs, { conversationId: 1, callId: "call-b" } as any, context());
    const sent = calls.filter((call) => call.name === "ask").map((call) => call.args);
    const requestId = scoutbotRequestId("msg-1", "ask", askArgs);
    expect(sent.map((args) => args.requestId)).toEqual([requestId, requestId]);
    expect(sent[0]).toEqual({ ...askArgs, requestId, senderId: "scoutbot", currentDirectory: "/work" });
    expect(asked).toEqual([["flt-1", 1], ["flt-1", 1]]);

    // A call with no known turn is keyed by its Pi call id.
    await ask.execute(askArgs, { conversationId: 2, callId: "call-c" } as any, context());
    expect(calls.at(-1)!.args.requestId).toBe(scoutbotRequestId("call:call-c", "ask", askArgs));

    const where = tools.find((tool) => tool.name === "where")!;
    await where.execute({ query: "einstein" }, { conversationId: 1, callId: "call-d" } as any, context());
    expect(calls.at(-1)).toEqual({ name: "where", args: { query: "einstein", senderId: "scoutbot", currentDirectory: "/work" } });

    const guide = tools.find((tool) => tool.name === "scoutbot_guide")!;
    const app = await guide.execute({ topic: "app" }, { conversationId: 1, callId: "call-e" } as any, context());
    expect(app.content[0]?.text).toContain("OpenScout Agent Context");
    expect(calls.at(-1)?.name).toBe("where");
  });

  test("Scout MCP without ask is refused", async () => {
    const mcp = createScoutbotMcp({
      socketPath: "/unused", currentDirectory: "/work", log: () => undefined,
      transport: memoryMcp(async () => ({ content: [] }), ["where"]),
    });
    cleanups.push(() => mcp.close());
    await expect(mcp.tools()).rejects.toThrow("Scout MCP is missing ask");
  });

  test("the MCP child dies after the runtime took the ask: the model is told a retry is safe, and the retry sends the same request id", async () => {
    const directory = tempDirectory("scoutbot-stdio-loss-");
    let transport: StdioTransport | undefined;
    const asked: string[] = [];
    const mcp = createScoutbotMcp({
      socketPath: "/unused", currentDirectory: directory, log: () => undefined,
      turnOf: () => "msg-1",
      onAsked: (flightId) => asked.push(flightId),
      transport: () => transport = new StdioTransport({ command: process.execPath, args: [fileURLToPath(new URL("./fixtures/mcp-child.ts", import.meta.url)), directory] }),
    });
    cleanups.push(() => mcp.close());
    const ask = (await mcp.tools()).find((tool) => tool.name === "ask")!;
    const pending = ask.execute(askArgs, { conversationId: 1, callId: "first" } as any, context());
    await until(() => readLines(join(directory, "calls.jsonl")).length > 0, "the ask to reach the MCP child");
    process.kill(transport!.pid!, "SIGKILL");
    const lost = await pending;
    expect(lost.isError).toBe(true);
    expect(JSON.stringify(lost.content)).toContain("Repeating the same ask is safe");
    expect(asked).toEqual([]);

    writeFileSync(join(directory, "answer"), "1");
    const retried = await ask.execute(askArgs, { conversationId: 1, callId: "model-retry" } as any, context());
    expect(retried.isError).toBeFalsy();
    const calls = readLines(join(directory, "calls.jsonl"));
    expect(calls).toHaveLength(2);
    expect(calls[0].arguments.requestId).toBe(calls[1].arguments.requestId);
    expect(asked).toEqual(["flt-1"]);
  }, 10_000);
});
