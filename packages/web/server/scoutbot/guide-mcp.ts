import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { readScoutbotGuide, SCOUTBOT_GUIDE_TOPICS, type ScoutbotGuideTopic } from "./process/scoutbot-guide.ts";

const server = new Server({ name: "scoutbot-guide", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
  name: "scoutbot_guide",
  description: "Read maintained Scout app and protocol guidance only when an operator asks about Scout itself. Choose the narrowest topic, then cite the source path in the answer.",
  inputSchema: { type: "object", properties: { topic: { type: "string", enum: Object.keys(SCOUTBOT_GUIDE_TOPICS) } }, required: ["topic"], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const topic = request.params.arguments?.topic;
  if (request.params.name !== "scoutbot_guide" || typeof topic !== "string" || !(topic in SCOUTBOT_GUIDE_TOPICS)) {
    return { isError: true, content: [{ type: "text", text: "Choose one Scoutbot guide topic from the tool schema." }] };
  }
  return { content: [{ type: "text", text: await readScoutbotGuide(topic as ScoutbotGuideTopic) }] };
});

await server.connect(new StdioServerTransport());
