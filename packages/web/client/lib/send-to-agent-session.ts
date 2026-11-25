import { api } from "./api.ts";
import { ensureAgentChat } from "./agent-chat.ts";
import { replyToSession } from "./session-start.ts";
import type { Agent } from "./types.ts";
/** Native sessions are continued by session id: they have no conversation to
 *  open, so callers offering a way back must route to the session instead. */
export function isNativeSessionAgent(agent: Agent) { return agent.agentClass === "native-session" || agent.id.startsWith("native:"); }
/**
 * Where a sent message landed, so the caller can offer a way back to it.
 * `conversationId` is null when the message went to a session by its id and
 * the runtime named no conversation; the caller opens the session instead.
 */
export type AgentSendDestination = { conversationId: string | null; sentAt: number };

export async function sendToFocusedAgentSession(
  agent: Agent,
  body: string,
): Promise<AgentSendDestination> {
  if (isNativeSessionAgent(agent)) {
    const sessionId = agent.harnessSessionId?.trim();
    if (!sessionId) throw new Error("This session has no id to send to.");
    const sentAt = Date.now();
    // By session id, so the runtime types it where the session runs or
    // resumes it. A project path would ask for a new session instead.
    const result = await replyToSession({
      sessionId,
      harness: agent.harness,
      cwd: agent.cwd?.trim() || agent.projectRoot?.trim() || null,
      body,
    });
    return { conversationId: result.conversationId ?? null, sentAt };
  }

  const conversationId = await ensureAgentChat(agent);
  // Capture before dispatch: the reply can arrive before the POST resolves.
  const sentAt = Date.now();
  // The card's harness and model describe the agent; they are not a runtime
  // the user chose for this message. Sent as `execution`, the broker reads an
  // ordinary follow-up as an exact-runtime request and refuses the agent's
  // live session for lacking observed evidence of that runtime.
  await api<unknown>("/api/send", {
    method: "POST",
    body: JSON.stringify({
      body,
      chatId: conversationId,
    }),
  });
  return { conversationId, sentAt };
}
