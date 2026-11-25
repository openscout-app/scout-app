import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

import { createScoutbotBrain, openBunSqliteStorage } from "../../../scoutbot-brain.ts";
import { ScoutbotThreadMapStore } from "../../thread-map.ts";
import { createScoutbotBrokerLink } from "../broker-link.ts";
import { createScoutbotHandouts } from "../handouts.ts";
import { createScoutbotMcp } from "../scout-mcp.ts";
import { createScoutbotBrainConversationMap, createScoutbotProcess } from "../scoutbot-process.ts";
import { memoryMcp } from "./memory-mcp.ts";

/**
 * One Scoutbot generation against the parent's runtime socket. Its model
 * hands the operator's message out with `ask`; the Scout MCP records the ask
 * as the runtime would accept it and never returns, so the parent can kill
 * this process mid-turn.
 */
const [directory, socketPath] = process.argv.slice(2) as [string, string];
const TURN_ASK = { projectPath: "/repo", harness: "codex", body: "Run the typecheck" };

const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
faux.setResponses([fauxAssistantMessage(fauxToolCall("ask", TURN_ASK, { id: "turn-call" }), { stopReason: "toolUse" })]);
const models = createModels();
models.setProvider(faux.provider);

let scoutbot: ReturnType<typeof createScoutbotProcess> | undefined;
const mcp = createScoutbotMcp({
  socketPath,
  currentDirectory: directory,
  turnOf: (conversationId) => scoutbot?.turnOf(conversationId),
  onAsked: (flightId, conversationId) => scoutbot?.recordHandout(flightId, conversationId),
  transport: memoryMcp(async (name, args) => {
    if (name === "ask") {
      appendFileSync(join(directory, "asks.jsonl"), `${JSON.stringify(args)}\n`);
      await new Promise(() => undefined);
    }
    return { content: [] };
  }),
  log: () => undefined,
});
const brain = createScoutbotBrain({
  currentDirectory: directory, models, provider: "faux",
  openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")),
  tools: () => mcp.tools(),
});
scoutbot = createScoutbotProcess({
  broker: createScoutbotBrokerLink({ socketPath }),
  brain,
  currentDirectory: directory,
  model: "faux-1",
  threads: new ScoutbotThreadMapStore(join(directory, "threads.json")),
  conversations: createScoutbotBrainConversationMap(join(directory, "conversations.json")),
  handouts: createScoutbotHandouts(join(directory, "handouts.json")),
  log: { info: () => undefined, warn: (message: string) => console.error(message) },
});
await scoutbot.bootstrap();
writeFileSync(join(directory, "ready"), "1");
await scoutbot.run(new AbortController().signal);
