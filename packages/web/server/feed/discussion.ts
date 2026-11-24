import type { DiscussionMessage } from "../../shared/api/feed-discussion.ts";
import { LocalRuntime, ReadError } from "./local-runtime.ts";
import type { FeedTable } from "./table.ts";

type CoreMessage = Pick<DiscussionMessage, "id" | "conversationId" | "actorId" | "body" | "createdAt" | "class"> &
  Partial<Pick<DiscussionMessage, "replyToMessageId" | "threadConversationId">>;

function served(m: CoreMessage): DiscussionMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    cId: m.conversationId,
    chatId: m.conversationId,
    actorId: m.actorId,
    actorName: m.actorId,
    body: m.body,
    createdAt: m.createdAt,
    class: m.class,
    replyToMessageId: m.replyToMessageId ?? null,
    threadConversationId: m.threadConversationId ?? null,
  };
}

export async function readDiscussion(core: LocalRuntime, table: FeedTable, params: URLSearchParams) {
  const conversationId = params.get("conversationId") || params.get("chatId") || params.get("cId");
  if (!conversationId) throw new ReadError(400, "A source conversationId is required");
  if (!table.hasConversation(conversationId)) throw new ReadError(404, "No such Feed discussion");
  // A Feed link can optionally open the recorded exchange rather than the newest
  // page of a busy chat. Use Core's exact message read even when both have aged
  // out of the live window; never infer an ask or reply from a display title.
  const workId = params.get("workId");
  if (workId) {
    const turn = table.sourceTurn(workId, conversationId);
    if (!turn?.replyId) throw new ReadError(404, "No recorded reply for that work in this discussion");
    const exact = async (id: string) => {
      const { message } = await core.json<{ message: CoreMessage }>(`/v1/messages/${encodeURIComponent(id)}`);
      if (message?.id !== id || message.conversationId !== conversationId)
        throw new ReadError(404, "No such discussion message");
      return message;
    };
    const reply = await exact(turn.replyId);
    if (reply.actorId !== turn.ownerId) throw new ReadError(409, "Reply owner mismatch");
    return [...(reply.replyToMessageId ? [await exact(reply.replyToMessageId)] : []), reply].map(served);
  }
  const limit = Math.min(500, Math.max(1, Math.trunc(Number(params.get("limit")) || 80)));
  const before = params.get("beforeMessageId");
  if (before?.includes("|") && !/^(\d{1,15})\|(.+)$/u.test(before)) throw new ReadError(400, "Invalid message cursor");
  const query = new URLSearchParams({ conversationId, limit: String(before ? 500 : limit) });
  const rows = await core.json<CoreMessage[]>(`/v1/messages?${query}`);
  if (!Array.isArray(rows)) throw new ReadError(503, "Invalid Scout discussion");
  // Core can expand a conversation natural key. Never relabel messages from a
  // similarly named room as this post's source. Do not pass through raw metadata.
  const ordered = rows
    .filter((r) => r.conversationId === conversationId)
    .sort((a, b) => a.createdAt - b.createdAt || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  let page = ordered;
  if (before) {
    const composite = /^(\d{1,15})\|(.+)$/u.exec(before);
    const key = composite
      ? { createdAt: Number(composite[1]), id: composite[2]! }
      : ordered.find((r) => r.id === before);
    if (!key) throw new ReadError(400, "Unknown message cursor in this discussion");
    page = ordered.filter(
      (r) =>
        r.createdAt < key.createdAt ||
        (r.createdAt === key.createdAt && Buffer.compare(Buffer.from(r.id), Buffer.from(key.id)) < 0),
    );
    if (page.length < limit && rows.length >= 500)
      throw new ReadError(503, "Older messages are outside the local runtime's message window");
  }
  return page.slice(-limit).map(served);
}

const aliases: Record<string, string> = {
  "claude-code": "claude",
  "claude-stream-json": "claude",
  "codex-exec": "codex",
  "codex-app-server": "codex",
  "pi-rpc": "pi",
};
function harnessOf(v: string) {
  const h = v.toLowerCase().replaceAll("_", "-");
  return Object.hasOwn(aliases, h) ? aliases[h] : h;
}
type TailEvent = {
  id: string;
  ts: number;
  source: string;
  sessionId: string;
  kind: string;
  summary: string;
  prompt?: { harnessOnly?: boolean };
};

export async function readSession(core: LocalRuntime, table: FeedTable, ref: string) {
  const parts = /^session:([^:]+):(.+)$/u.exec(ref);
  const id = parts?.[2] ?? ref;
  const owners = table.sessionOwners(id);
  const harnesses = new Set(owners.flatMap((o) => (o.harness ? [harnessOf(o.harness)] : [])));
  if (!parts && harnesses.size > 1) throw new ReadError(409, "Qualify this session with its harness");
  const harness = parts ? harnessOf(parts[1]!) : [...harnesses][0];
  if (!harness || !harnesses.has(harness)) throw new ReadError(404, "No such Feed session");

  const matching = owners.filter((o) => o.harness && harnessOf(o.harness) === harness);
  if (matching.length !== 1 || !matching[0]?.agentId)
    throw new ReadError(409, "Cannot identify one owner for this Feed session");
  const agentId = matching[0].agentId;
  const tuple = new URLSearchParams({ nodeId: table.originHost, nativeSessionId: id, harness });
  const { session } = await core.json<{
    session: {
      identity: { nodeId: string; harness: string; nativeSessionId: string };
      identityConflict: boolean;
      availability: string;
      cwd: string | null;
    };
  }>(`/v1/observed-sessions/resolve?${tuple}`);
  if (
    session.identityConflict ||
    session.identity.nativeSessionId !== id ||
    session.identity.nodeId !== table.originHost ||
    session.identity.harness !== harness
  )
    throw new ReadError(409, "Session identity mismatch");
  if (session.availability !== "available") throw new ReadError(503, "Session is not available");
  const query = new URLSearchParams({ sessionId: id, sources: harness, limit: "200" });
  const tail = await core.json<{ events: TailEvent[]; generatedAt: number }>(`/v1/tail/recent?${query}`);
  if (!Array.isArray(tail.events)) throw new ReadError(503, "Session tail unavailable");
  const scoped = tail.events
    .filter((e) => e.sessionId === id && harnessOf(e.source) === harness)
    .sort((a, b) => a.ts - b.ts);
  if (!scoped.length) throw new ReadError(404, "No observed lines for this exact session");
  const start = scoped[0]!.ts;
  const events = scoped.map((e) => ({
    id: e.id,
    at: e.ts,
    t: Math.max(0, Math.round((e.ts - start) / 1000)),
    text: e.summary,
    kind:
      e.kind === "assistant"
        ? "message"
        : e.kind === "user"
          ? e.prompt?.harnessOnly
            ? "system"
            : "ask"
          : e.kind === "tool" || e.kind === "tool-result"
            ? "tool"
            : e.kind === "system"
              ? "system"
              : "note",
  }));
  // Observation cannot grant write access or substitute the owner's current session.
  return {
    kind: "observe",
    refId: ref,
    session: null,
    observe: {
      kind: "broker",
      refId: id,
      sessionId: id,
      agentId,
      source: "tail",
      fidelity: "synthetic",
      historyPath: null,
      updatedAt: tail.generatedAt,
      data: {
        events,
        files: [],
        metadata: { session: { adapterType: harness, externalSessionId: id, cwd: session.cwd, sessionStart: start } },
      },
    },
  };
}
