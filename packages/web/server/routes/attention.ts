import type { Hono } from "hono";
import { createPollingReadCache, pollingReadFailureResponse } from "../polling-read-cache.ts";
import { decideScoutWebPairingApproval } from "../pairing.ts";
import { queryFlightRecordById } from "../db-queries.ts";
import { decideScoutPermission, decideScoutRemoteApproval, decideScoutTaskReady, dismissScoutOperatorRequest, setScoutTaskNotify, invalidateScoutBrokerContextCache, loadScoutBrokerContext, resolveScoutBrokerUrl, upsertScoutConversation, upsertScoutFlight } from "../core/broker/service.ts";
import type { OpenScoutWebShellState } from "../runtime-summary.ts";
import { defaultCaptureTmuxPane } from "../tmux-pane-capture.ts";
import { dismissCollaborationAttention, findTmuxPromptPane, invalidateAgentAttentionSnapshot, buildOperatorAttentionState, parseRemoteApprovalSessionId } from "../core/attention/operator-attention-state.ts";
import { answerTmuxPanePrompt } from "../core/attention/tmux-pane-answer.ts";
import { answerHerdrPermission } from "../core/attention/herdr-permission-answer.ts";
import type { CreateOpenScoutWebServerOptions } from "../web-server-options.ts";
import type { CachedSnapshot } from "../server-core.ts";
import { panePromptAnswerBody, permissionDecisionBody, permissionRevealBody, approvalDecisionBody, requestDismissBody, taskNotifyBody, taskReadyDecisionBody } from "../../shared/api/attention.ts";
import { readClaudeSessionRecords } from "@openscout/runtime";
import { readScoutBrokerHealth } from "../core/broker/service.ts";
import { newPopOutToken, openLocalTerminalAttach } from "../local-terminal-open.ts";
import { createSessionSteering } from "../session-steering.ts";
import { findSessionPane, revealSession } from "../session-reveal.ts";
import { tmuxPaneOf, tmuxSessionNamed } from "../tmux-pane.ts";
import { readJsonBody } from "../request-body.ts";

async function dismissFlightAttention(input: {
  flightId: string;
  itemUpdatedAt: number;
}): Promise<void> {
  let flight = null;
  try {
    flight = queryFlightRecordById(input.flightId);
  } catch {
    // The live broker can be ahead of the read-only SQLite projection. Fall
    // through to the canonical broker snapshot instead of making a freshly
    // failed flight impossible to acknowledge.
  }
  if (!flight) {
    const broker = await loadScoutBrokerContext().catch(() => null);
    flight = broker?.snapshot.flights?.[input.flightId] ?? null;
  }
  if (!flight) {
    throw new Error("flight not found");
  }
  await upsertScoutFlight({
    ...flight,
    metadata: {
      ...(flight.metadata ?? {}),
      operatorAttentionDismissedAt: Date.now(),
      operatorAttentionItemUpdatedAt: input.itemUpdatedAt,
      operatorAttentionDismissedBy: "operator",
    },
  });
}

async function dismissConversationFailureAttention(input: {
  conversationId: string;
  messageId: string;
  itemUpdatedAt: number;
}): Promise<void> {
  const broker = await loadScoutBrokerContext().catch(() => null);
  const conversation = broker?.snapshot.conversations?.[input.conversationId];
  if (!conversation) {
    throw new Error("conversation not found");
  }
  await upsertScoutConversation({
    ...conversation,
    metadata: {
      ...(conversation.metadata ?? {}),
      operatorAttentionDismissedMessageId: input.messageId,
      operatorAttentionDismissedAt: Date.now(),
      operatorAttentionItemUpdatedAt: input.itemUpdatedAt,
      operatorAttentionDismissedBy: "operator",
    },
  });
}

const FRESH_READ_FLOOR_MS = 1_000;

export type AttentionRouteDeps = {
  options: Pick<CreateOpenScoutWebServerOptions, "captureTmuxPane" | "openLocalTerminal" | "answerHerdrPanePrompt">;
  currentDirectory: string;
  shellStateCache: CachedSnapshot<OpenScoutWebShellState>;
};

export function mountAttentionRoutes(app: Hono, deps: AttentionRouteDeps) {
  const { currentDirectory, options, shellStateCache } = deps;

  const attentionReads = createPollingReadCache<Awaited<ReturnType<typeof buildOperatorAttentionState>>>({
    ttlMs: 2_000, maxEntries: 1, maxConcurrent: 1,
  });
  const readAttention = () => attentionReads.get("attention", () => buildOperatorAttentionState(
    currentDirectory, options.captureTmuxPane ?? defaultCaptureTmuxPane,
  ));
  // A client asks for `?fresh=1` after a runtime event raised or settled a
  // request: a decision from a phone or in the terminal never passes through
  // this server, so its caches cannot know. Fresh reads share one build and
  // start at most once a second, so a burst of events, or several surfaces on
  // screen, cost one read.
  let freshRead: ReturnType<typeof buildOperatorAttentionState> | null = null;
  let freshStartedAt = 0;
  const readFreshAttention = () => {
    if (freshRead) return freshRead;
    if (Date.now() - freshStartedAt < FRESH_READ_FLOOR_MS) return readAttention();
    freshStartedAt = Date.now();
    invalidateScoutBrokerContextCache(resolveScoutBrokerUrl());
    invalidateAgentAttentionSnapshot();
    attentionReads.invalidate("attention");
    freshRead = buildOperatorAttentionState(currentDirectory, options.captureTmuxPane ?? defaultCaptureTmuxPane)
      .finally(() => { freshRead = null; });
    return freshRead;
  };
  app.get("/api/operator-attention", async (c) => {
    try {
      if (c.req.query("fresh") === "1") {
        c.header("cache-control", "no-store");
        return c.json(await readFreshAttention().catch(() => readAttention()));
      }
      return c.json(await readAttention());
    } catch (error) {
      return pollingReadFailureResponse(error);
    }
  });
  app.post("/api/operator-attention/permissions/decide", async (c) => {
    const parsed = await readJsonBody(c, permissionDecisionBody);
    if (!parsed.ok) return parsed.response;
    try { await decideScoutPermission(parsed.body); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = error as { status?: number; sessionOpen?: boolean };
      if (failure?.status !== 410) return c.json({ error: message }, failure?.status === 409 ? 409 : 502);
      // Nothing can answer it any more; the runtime has settled the record.
      invalidateAgentAttentionSnapshot();
      shellStateCache.invalidate();
      attentionReads.invalidate("attention");
      return c.json({ error: message, outcome: "ended", sessionOpen: failure.sessionOpen === true }, 410);
    }
    invalidateAgentAttentionSnapshot();
    shellStateCache.invalidate();
    attentionReads.invalidate("attention");
    // The answer is the runtime's acceptance, not a rebuilt list: the rebuild (a 24-hour snapshot and a pane
    // rescan) held every decision for seconds. The runtime's settle event drops the row, and the client reads
    // the list again on its own (use-request-actions.ts).
    return c.json({ ok: true });
  });
  // The runtime ends a permission request or an agent's question; one a session still waits on is refused (409).
  app.post("/api/operator-attention/pane-prompts/answer", async (c) => {
    const parsed = await readJsonBody(c, panePromptAnswerBody);
    if (!parsed.ok) return parsed.response;
    const capture = options.captureTmuxPane ?? defaultCaptureTmuxPane;
    // A Herdr pane's prompt goes through the same checked answer as the phone's: the pane is read again, and keys
    // go out only while the dialog the operator saw is still up.
    const answer = parsed.body.itemId.startsWith("herdr-continuation:")
      ? await (options.answerHerdrPanePrompt ?? answerHerdrPermission)({ ...parsed.body, from: "companion" })
      : await answerTmuxPanePrompt(parsed.body, {
        findPane: (itemId) => findTmuxPromptPane(itemId, capture),
        capture: async (pane) => (await capture({
          agentId: pane.agentId, sessionId: pane.sessionName, paneTarget: pane.paneTarget, cwd: null, lines: 80, columns: 240,
        }))?.body ?? null,
      });
    // Whatever happened, the next read captures the pane again.
    invalidateAgentAttentionSnapshot();
    attentionReads.invalidate("attention");
    if (!answer.ok) {
      const status = answer.code === "not_found" ? 404 : answer.code === "send_failed" ? 502 : 409;
      return c.json({ error: answer.message, code: answer.code }, status);
    }
    shellStateCache.invalidate();
    return c.json(await buildOperatorAttentionState(currentDirectory, capture));
  });
  app.post("/api/operator-attention/requests/dismiss", async (c) => {
    const parsed = await readJsonBody(c, requestDismissBody);
    if (!parsed.ok) return parsed.response;
    try { await dismissScoutOperatorRequest(parsed.body.requestId); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, (error as { status?: number })?.status === 409 ? 409 : 502);
    }
    invalidateAgentAttentionSnapshot();
    shellStateCache.invalidate();
    attentionReads.invalidate("attention");
    // Like a decision: the runtime's acceptance is the answer, and the client reads the list again.
    return c.json({ ok: true });
  });
  // Ready: Continue or Hold, through the runtime (operator-only, machine-local there). 409: not Ready any more.
  app.post("/api/operator-attention/ready/decide", async (c) => {
    const parsed = await readJsonBody(c, taskReadyDecisionBody);
    if (!parsed.ok) return parsed.response;
    try { await decideScoutTaskReady(parsed.body); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { status?: number })?.status;
      return c.json({ error: message }, status === 409 || status === 403 || status === 404 ? status : 502);
    }
    invalidateAgentAttentionSnapshot();
    shellStateCache.invalidate();
    attentionReads.invalidate("attention");
    return c.json(await buildOperatorAttentionState(currentDirectory, options.captureTmuxPane ?? defaultCaptureTmuxPane));
  });
  // Hear, or stop hearing, when a running task is done. 409: it already finished.
  app.post("/api/tasks/notify", async (c) => {
    const parsed = await readJsonBody(c, taskNotifyBody);
    if (!parsed.ok) return parsed.response;
    try { return c.json(await setScoutTaskNotify(parsed.body)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as { status?: number })?.status;
      return c.json({ error: message }, status === 409 || status === 403 || status === 404 ? status : 502);
    }
  });
  // "Go to session": the request names itself; the session it came from is
  // read off the server's own attention state, never taken from the client.
  const steering = createSessionSteering();
  const tmuxSession = tmuxSessionNamed;
  /** The open permission a request id names, read off the server's own attention state. */
  const openPermission = async (requestId: string) => {
    const state = await readAttention();
    return state.items.find((item) => item.permission?.requestId === requestId) ?? null;
  };
  app.post("/api/operator-attention/permissions/reveal", async (c) => {
    c.header("cache-control", "no-store");
    const parsed = await readJsonBody(c, permissionRevealBody);
    if (!parsed.ok) return parsed.response;
    let sessionId: string | null = null;
    try {
      sessionId = (await openPermission(parsed.body.requestId))?.permission?.sessionId ?? null;
    } catch (error) {
      return pollingReadFailureResponse(error);
    }
    if (!sessionId) return c.json({ ok: false, code: "not_found", reason: "This request is no longer open." }, 404);
    const result = await revealSession(sessionId, {
      records: readClaudeSessionRecords,
      machine: async () => (await readScoutBrokerHealth()).nodeId,
      focus: (ref, machine) => steering.focus(ref, machine),
      tmuxSession,
      open: async (argv, cwd, popOut) => await (options.openLocalTerminal ?? openLocalTerminalAttach)(argv, { cwd, ...(popOut ? { popOut } : {}) }),
      popOutToken: newPopOutToken,
      openAttached: (ref, machine) => steering.openTerminal(ref, machine),
    });
    return c.json(result, result.ok ? 200 : 409);
  });
  // The companion's terminal pop-up: which tmux session to show for a request,
  // with the request's own context. Nothing is opened or focused here.
  app.post("/api/operator-attention/permissions/pane", async (c) => {
    c.header("cache-control", "no-store");
    const parsed = await readJsonBody(c, permissionRevealBody);
    if (!parsed.ok) return parsed.response;
    let item: Awaited<ReturnType<typeof openPermission>> = null;
    try {
      item = await openPermission(parsed.body.requestId);
    } catch (error) {
      return pollingReadFailureResponse(error);
    }
    const sessionId = item?.permission?.sessionId ?? null;
    if (!item || !sessionId) return c.json({ ok: false, code: "not_found", reason: "This request is no longer open." }, 404);
    const result = await findSessionPane(sessionId, {
      records: readClaudeSessionRecords,
      machine: async () => (await readScoutBrokerHealth()).nodeId,
      inspect: (ref, machine) => steering.inspect(ref, machine),
      paneOf: tmuxPaneOf,
      tmuxSession,
    });
    if (!result.ok) return c.json(result, 409);
    return c.json({ ...result, request: { title: item.title, agent: item.agentName ?? item.agentId ?? null, at: item.updatedAt } });
  });
  app.post("/api/operator-attention/approvals/decide", async (c) => {
    const parsed = await readJsonBody(c, approvalDecisionBody);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.sessionId || !body.turnId || !body.blockId || typeof body.version !== "number") {
      return c.json({ error: "sessionId, turnId, blockId, and version are required" }, 400);
    }
    const decision = body.decision === "approve" || body.decision === "deny" ? body.decision : null;
    if (!decision) {
      return c.json({ error: "decision must be approve or deny" }, 400);
    }
    // An approval from another machine carries its origin in the sessionId and
    // is answered there, through the broker.
    const remote = parseRemoteApprovalSessionId(body.sessionId);
    if (remote) {
      const result = await decideScoutRemoteApproval({
        nodeId: remote.nodeId,
        sessionId: remote.sessionId,
        turnId: body.turnId,
        blockId: body.blockId,
        version: body.version,
        decision,
        reason: body.reason ?? null,
      });
      if (!result.ok) {
        return c.json({ error: remoteDecideMessage(result.error) }, 409);
      }
      attentionReads.invalidate("attention");
      shellStateCache.invalidate();
      return c.json(await buildOperatorAttentionState(
        currentDirectory,
        options.captureTmuxPane ?? defaultCaptureTmuxPane,
      ));
    }
    await decideScoutWebPairingApproval(
      {
        sessionId: body.sessionId,
        turnId: body.turnId,
        blockId: body.blockId,
        version: body.version,
        decision,
        reason: body.reason ?? null,
      },
      currentDirectory,
    );
    attentionReads.invalidate("attention");
    shellStateCache.invalidate();
    return c.json(await buildOperatorAttentionState(
      currentDirectory,
      options.captureTmuxPane ?? defaultCaptureTmuxPane,
    ));
  });
  app.post("/api/operator-attention/dismiss", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      recordKind?: unknown;
      recordId?: unknown;
      flightId?: unknown;
      conversationId?: unknown;
      messageId?: unknown;
      itemUpdatedAt?: unknown;
    };
    const recordKind = body.recordKind === "work_item" || body.recordKind === "question"
      ? body.recordKind
      : null;
    const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
    const flightId = typeof body.flightId === "string" ? body.flightId.trim() : "";
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
    const itemUpdatedAt = typeof body.itemUpdatedAt === "number" && Number.isFinite(body.itemUpdatedAt)
      ? body.itemUpdatedAt
      : 0;
    if (
      itemUpdatedAt <= 0
      || (!flightId && (!recordKind || !recordId) && (!conversationId || !messageId))
    ) {
      return c.json({
        error: "recordKind and recordId, flightId, or conversationId and messageId, plus itemUpdatedAt are required",
      }, 400);
    }
    if (flightId) {
      await dismissFlightAttention({ flightId, itemUpdatedAt });
    }
    if (conversationId && messageId) {
      await dismissConversationFailureAttention({ conversationId, messageId, itemUpdatedAt });
    } else if (!flightId && recordKind && recordId) {
      await dismissCollaborationAttention({ recordKind, recordId, itemUpdatedAt });
    }
    attentionReads.invalidate("attention");
    return c.json(await buildOperatorAttentionState(
      currentDirectory,
      options.captureTmuxPane ?? defaultCaptureTmuxPane,
    ));
  });
}

function remoteDecideMessage(error: string): string {
  switch (error) {
    case "stale_version":
    case "not_pending":
    case "already_decided":
      return "That request changed on its machine; it was already answered or moved on.";
    case "not_live":
      return "Lost the link to that machine; reconnecting. Try again in a moment.";
    case "approvals_not_shared":
      return "That machine stopped sharing approvals with this one.";
    default:
      return "Couldn't reach that machine to answer.";
  }
}
