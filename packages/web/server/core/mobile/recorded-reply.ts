// A keyed web reply (including Feed reactions and Home answers) needs both
// delivery and a runtime message. Never type locally and try to log it later.
import {
  deliverScoutRequest,
  prepareScoutDelivery,
  prepareScoutSessionReply,
  type ScoutDeliveryBroker,
} from "@openscout/runtime/delivery-client";
import { coerceAgentHarness } from "../../request-values.ts";
import { mobileAskSessionRefusal, type MobileAskSessionInput, type MobileAskSessionResult } from "./ask-session.ts";

export async function recordedWebReply(
  input: MobileAskSessionInput,
  sender: string,
  source: string,
  runtime: ScoutDeliveryBroker,
  deliver = deliverScoutRequest,
): Promise<MobileAskSessionResult> {
  const sessionId = input.sessionId.trim();
  const body = input.body.trim();
  const clientMessageId = input.clientMessageId?.trim();
  if (!sessionId) return mobileAskSessionRefusal("session_unknown");
  if (!body) return mobileAskSessionRefusal("empty_body");
  if (!clientMessageId) return mobileAskSessionRefusal("request_id_required");
  const harness = coerceAgentHarness(input.harness);
  if (input.harness?.trim() && !harness) return mobileAskSessionRefusal("session_not_resumable");

  const requester = { requesterId: sender, requesterNodeId: runtime.expectedNodeId };
  // Other harnesses use an exact-session runtime ask, not an unrecorded
  // terminal write. No capability fallback after a possibly submitted command.
  const command =
    harness === "claude" || harness === "codex"
      ? prepareScoutSessionReply({ ...requester, clientMessageId, sessionId, harness, body, source })
      : prepareScoutDelivery({
          clientMessageId,
          command: {
            ...requester,
            intent: "consult",
            target: { kind: "session_id", sessionId, ...(harness ? { harness } : {}) },
            body,
            execution: { session: "existing" },
            ensureAwake: true,
            messageMetadata: { source, clientMessageId },
            invocationMetadata: { source },
          },
        });
  try {
    const result = await deliver(runtime, command);
    if (result.kind !== "delivery") {
      const reason = result.kind === "rejected" ? result.rejection : result.question;
      return mobileAskSessionRefusal(
        reason.kind === "unknown" ? (reason.sessionWakeReason ?? "session_unknown") : "delivery_failed",
      );
    }
    const messageId = result.message?.id;
    const conversationId = result.conversation?.id;
    if (!messageId || !conversationId || (!result.receipt?.inputSubmitted && !result.flight?.id)) {
      return mobileAskSessionRefusal("delivery_unconfirmed");
    }
    const receipt = result.receipt.inputSubmitted;
    const delivered = result.targetSessionId ?? sessionId;
    return {
      ok: true,
      mode: delivered === sessionId ? "resumed" : "forked",
      delivery: receipt ? "in_place" : "resumed",
      sessionId: delivered,
      sourceSessionId: sessionId,
      conversationId,
      messageId,
      ...(receipt ? { via: receipt.via, location: receipt.location } : {}),
      ...(result.flight ? { flightId: result.flight.id } : {}),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return mobileAskSessionRefusal(
      detail.includes("session_input_unsupported") ? "session_input_unsupported" : "delivery_unconfirmed",
    );
  }
}
