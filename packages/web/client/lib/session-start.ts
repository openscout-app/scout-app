import { api } from "./api.ts";

export type SessionReplyResult = {
  /** "in_place" when the words were typed into the running session. */
  delivery: "in_place" | "resumed";
  /** Where it was typed, in the operator's words: "Herdr scout · w1:p1". */
  location?: string;
  sessionId: string;
  conversationId?: string;
};

type SessionReplyResponse =
  | ({ ok: true; delivery?: "in_place" | "resumed" } & Omit<SessionReplyResult, "delivery">)
  | { ok: false; code: string; message: string };

/**
 * Send a message to one harness session by its id. The runtime picks the way
 * in: typed into the session where it runs, or the session resumed when
 * nothing holds it. Where it runs, and how the thread started, are not the
 * caller's concern. A refusal throws its message, and nothing was sent.
 */
export async function replyToSession(input: {
  sessionId: string;
  harness?: string | null;
  cwd?: string | null;
  body: string;
  clientMessageId?: string | null;
}): Promise<SessionReplyResult> {
  const sessionId = input.sessionId.trim();
  const harness = input.harness?.trim() || undefined;
  const cwd = input.cwd?.trim() || undefined;
  const clientMessageId = input.clientMessageId?.trim() || undefined;
  const result = await api<SessionReplyResponse>("/api/sessions/reply", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      ...(harness ? { harness } : {}),
      ...(cwd ? { cwd } : {}),
      body: input.body.trim(),
      ...(clientMessageId ? { clientMessageId } : {}),
      source: "scout-web",
    }),
  });
  if (!result.ok) throw new Error(result.message);
  return {
    delivery: result.delivery ?? "resumed",
    ...(result.location ? { location: result.location } : {}),
    sessionId: result.sessionId,
    ...(result.conversationId ? { conversationId: result.conversationId } : {}),
  };
}
