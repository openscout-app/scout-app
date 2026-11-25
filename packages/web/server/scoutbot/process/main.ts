/**
 * Entry for the Scoutbot process the broker supervises (argv0 `scout-bot`).
 * The broker passes its socket in OPENSCOUT_BROKER_SOCKET_PATH.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveBrokerServiceConfig } from "@openscout/runtime/broker-process-manager";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import { createScoutbotBrain, openBunSqliteStorage } from "../../scoutbot-brain.ts";
import { createScoutbotCredentialStore } from "../../scoutbot-credentials.ts";
import { createScoutbotFileLookup } from "../../scoutbot-file-lookup.ts";
import { startScoutbotAnswerer } from "./answerer.ts";
import { createScoutbotHandouts } from "./handouts.ts";
import { createScoutbotBrainConversationMap, createScoutbotProcess, SCOUTBOT_PROCESS_SYSTEM_PROMPT } from "./scoutbot-process.ts";
import { createScoutbotMcp } from "./scout-mcp.ts";

const socketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH?.trim()
  || resolveBrokerServiceConfig().brokerSocketPath;
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
const supportDirectory = resolveOpenScoutSupportPaths().supportDirectory;
const credentials = createScoutbotCredentialStore();
const model = process.env.OPENSCOUT_SCOUTBOT_MODEL?.trim() || undefined;

const resolveOpenAIApiKey = async (): Promise<string | undefined> => {
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const config = await readFile(join(resolveOpenScoutSupportPaths().relayHubDirectory, "config.json"), "utf8")
    .then((raw) => JSON.parse(raw) as { openaiApiKey?: string })
    .catch(() => null);
  return config?.openaiApiKey?.trim() || credentials.getOpenAIKey()?.trim() || undefined;
};

// What Scoutbot keeps between generations: which Pi conversation holds each
// thread, and which thread each hand-out came from. The runtime keeps the rest.
const conversations = createScoutbotBrainConversationMap();
const handouts = createScoutbotHandouts();

const answerer = startScoutbotAnswerer({
  socketPath,
  build: ({ broker, childSocketPath }) => {
    let scoutbot: ReturnType<typeof createScoutbotProcess> | undefined;
    const mcp = createScoutbotMcp({ socketPath: childSocketPath, currentDirectory,
      turnOf: (conversationId) => scoutbot?.turnOf(conversationId),
      onAsked: (flightId, conversationId) => scoutbot?.recordHandout(flightId, conversationId),
    });
    const brain = createScoutbotBrain({
      currentDirectory, resolveApiKey: resolveOpenAIApiKey,
      initialSystemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT,
      findFiles: createScoutbotFileLookup(currentDirectory),
      tools: () => mcp.tools(),
      openStorage: () => openBunSqliteStorage(join(supportDirectory, "scoutbot", "process-brain.sqlite")),
    });
    scoutbot = createScoutbotProcess({ broker, brain, currentDirectory, model, conversations, handouts });
    return {
      scoutbot,
      close: async () => {
        await brain.close().catch((error) => console.warn("[scoutbot] brain close failed:", error));
        await mcp.close();
      },
    };
  },
});

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[scoutbot] ${signal}: stopping`);
  // Stops the generation, closes its brain and MCP child, then releases the claim.
  await answerer.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
