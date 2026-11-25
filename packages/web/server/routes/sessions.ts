import type { Hono } from "hono";
import { isOpaqueChannelId } from "@openscout/protocol";
import { querySessions, querySessionById } from "../db-queries.ts";
import { loadScoutBrokerContext } from "../core/broker/service.ts";
import { getScoutConversationById, getScoutConversations } from "../core/conversations/service.ts";
import { loadSessionRefObservePayload } from "../core/observe/service.ts";
import { sessionTouchedResponse } from "../observe-payload.ts";
import { SCOUTBOT_DEFAULT_THREAD_ID } from "../scoutbot/role.ts";
import { parseSessionRouteRef, sessionHarnessMatches } from "../../shared/session-route-ref.ts";
import { parseRenamePolicy } from "../../shared/session-rename.ts";
import { sessionNameStore } from "../db/session-names.ts";
import type { ScoutbotWebServices } from "./scoutbot.ts";
import { mountSessionSteerRoutes } from "./session-steer.ts";
import { completeViaSubscription, type HarnessCompletionProvider } from "../harness-completion.ts";
import { loadServiceBudgets } from "../service-budgets.ts";
import { createSessionTitles, TITLE_TURNS } from "../session-titles.ts";

/** Session names by Haiku or Luna, one cache for every board that asks (session-titles.ts). */
const sessionTitles = createSessionTitles({
  read: async (ref) => {
    const payload = await loadSessionRefObservePayload(ref, { summary: true, turns: TITLE_TURNS });
    const summary = payload?.data.summary;
    return summary ? { title: summary.title, turns: summary.turns } : null;
  },
  complete: (input, prefer) => completeViaSubscription(input, { loadGauges: async () => (await loadServiceBudgets()).gauges, prefer }),
  store: sessionNameStore(),
});

const LEGACY_SCOUTBOT_CONVERSATION_IDS = new Set([
  "dm.operator.scoutbot",
  "dm.operator.scoutbot.default",
]);

function isLegacyScoutbotConversationId(value: string): boolean {
  return LEGACY_SCOUTBOT_CONVERSATION_IDS.has(value.trim());
}

export type SessionRouteDeps = {
  scoutbot: ScoutbotWebServices;
};

export function mountSessionRoutes(app: Hono, deps: SessionRouteDeps) {
  // ?refs=a,b (session refs) &states=working,asking &activity=ms,ms (each ref's, in order)
  // &by=claude|codex (else each session's own family) &rename=never|turns:N|minutes:N (else never):
  // the kept names now; an unnamed session, or one the rename policy makes due, is asked for in the
  // background. Each line's code is the runtime's roster (routes/roster.ts), not this.
  app.get("/api/session-titles", (c) => {
    const list = (key: string) => (c.req.query(key) ?? "").split(",").map((r) => r.trim());
    const refs = list("refs").slice(0, 24);
    const states = list("states");
    const activity = list("activity").map(Number);
    const by = c.req.query("by");
    const prefer: HarnessCompletionProvider | null = by === "claude" || by === "codex" ? by : null;
    const shown = refs.flatMap((ref, i) => (ref ? [{ ref, state: states[i] || undefined, activity: activity[i] || undefined }] : []));
    const policy = parseRenamePolicy(c.req.query("rename"));
    const titles = sessionTitles.titles(
      shown.map((s) => s.ref),
      prefer,
      Object.fromEntries(shown.map((s) => [s.ref, { state: s.state, activity: s.activity }])),
      policy,
    );
    c.header("Cache-Control", "no-store");
    return c.json({ titles });
  });
  const { scoutbot } = deps;
  mountSessionSteerRoutes(app);

  const resolveSessionRequestConversationId = async (conversationId: string): Promise<string | null> => {
    if (isOpaqueChannelId(conversationId)) return conversationId;
    const scoutbotRunner = scoutbot.runner ?? await scoutbot.waitForRunner();
    if (!isLegacyScoutbotConversationId(conversationId) || !scoutbotRunner) return null;
    try {
      const threadList = await scoutbotRunner.getThreads();
      const thread = threadList.threads.find((candidate) => candidate.threadId === threadList.defaultThreadId)
        ?? threadList.threads.find((candidate) => candidate.threadId === SCOUTBOT_DEFAULT_THREAD_ID)
        ?? threadList.threads[0];
      const canonicalConversationId = thread?.conversationId?.trim();
      return isOpaqueChannelId(canonicalConversationId) ? canonicalConversationId : null;
    } catch {
      return null;
    }
  };

  app.get("/api/sessions", (c) => c.json(querySessions()));
  app.get("/api/session-ref/:id", async (c) => {
    const refId = c.req.param("id");
    const conversation = isOpaqueChannelId(refId) ? querySessionById(refId) : null;
    if (conversation) {
      return c.json({
        kind: "conversation",
        refId,
        conversationId: conversation.id,
        session: conversation,
      });
    }

    const summary = c.req.query("view") === "summary";
    if (summary) c.header("Cache-Control", "no-store");
    const turnsParam = c.req.query("turns");
    const turns = turnsParam === undefined ? 3 : Number(turnsParam);
    if (summary && (!Number.isInteger(turns) || turns < 0 || turns > 10)) {
      return c.json({ error: "turns must be an integer from 0 to 10" }, 400);
    }
    const payload = await loadSessionRefObservePayload(refId, summary ? { summary: true, turns } : undefined);
    if (payload) {
      // A raw observed transcript has no writable Scout owner. Avoid building
      // the full session list for this common read-only path; on large pilot
      // databases that projection can dominate the time to open a tiny file.
      const parsedRef = payload.agentId ? parseSessionRouteRef(refId) : null;
      const harnessSession = parsedRef
        ? querySessions(200).find((session) =>
            sessionHarnessMatches(parsedRef.harness, session.harness)
            && parseSessionRouteRef(session.harnessSessionId)?.refId === parsedRef.refId
          )
        : null;
      return c.json({
        kind: "observe",
        refId,
        // A provider id can collide with an explicit broker actor/handle ref.
        // Only expose a writable Scout conversation when both projections
        // resolve to the same owner; observe-only remains safe otherwise.
        session: harnessSession?.agentId === payload.agentId ? harnessSession : null,
        observe: payload,
      });
    }
    return c.json({ error: "not found" }, 404);
  });
  app.get("/api/session-ref/:id/touched", async (c) => {
    const refId = c.req.param("id");
    const payload = await loadSessionRefObservePayload(refId);
    if (!payload) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(sessionTouchedResponse(payload, refId));
  });
  app.get("/api/session/:id", async (c) => {
    const chatId = c.req.param("id");
    const resolvedChatId = await resolveSessionRequestConversationId(chatId);
    if (!resolvedChatId) {
      return c.json({ error: "chatId must be an opaque chat id" }, 400);
    }
    const session = querySessionById(resolvedChatId);
    const broker = session
      ? await loadScoutBrokerContext(undefined, {
          scope: "conversations",
          waitForInitial: false,
          initialRefreshDelayMs: 750,
        }).catch(() => null)
      : undefined;
    const conversation = broker === null
      ? null
      : broker
        ? (await getScoutConversations(
            { conversationId: resolvedChatId, limit: 1 },
            broker,
          ))[0] ?? null
        : await getScoutConversationById(resolvedChatId);
    if (session && conversation) {
      // SQLite contributes harness-local fields, but the broker owns Chat
      // identity, transcript recency, equivalent ids, and turn lifecycle.
      return c.json({ ...session, ...conversation });
    }
    if (session) {
      return c.json(session);
    }
    return conversation ? c.json(conversation) : c.json({ error: "not found" }, 404);
  });
}
