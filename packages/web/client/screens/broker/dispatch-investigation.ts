import { api } from "../../lib/api.ts";
import type { BrokerRouteAttempt } from "../../lib/types.ts";
import { brokerAttemptContextText, brokerAttemptIsFailure } from "./broker-display.ts";

/** Scout is the built-in assistant, not a harness agent for `/api/ask`. */
export async function investigateDispatch(
  attempt: BrokerRouteAttempt,
  request: typeof api = api,
): Promise<{ conversationId: string }> {
  const prompt = brokerAttemptIsFailure(attempt)
    ? "Investigate why this dispatch failed. Say what stopped it, whether anything was received, and propose a recovery: who should take it and what should happen next."
    : "Summarize this dispatch and what happened next. Flag anything that needs the operator.";
  const result = await request<{ conversationId?: string }>("/api/scoutbot/messages", {
    method: "POST",
    body: JSON.stringify({
      body: `${prompt}\n\nAttached dispatch context:\n${brokerAttemptContextText(attempt)}`,
      page: {
        source: "scout-dispatch-investigate",
        originalDispatchId: attempt.id,
        ...(attempt.messageId ? { originalMessageId: attempt.messageId } : {}),
        ...(attempt.conversationId ? { originalConversationId: attempt.conversationId } : {}),
      },
    }),
  });
  if (!result.conversationId) {
    throw new Error("Scout did not return an investigation conversation.");
  }
  return { conversationId: result.conversationId };
}
