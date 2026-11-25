import type { Hono } from "hono";
import { isOpaqueChannelId, type VercelBoardHandoffsResponse, type VercelBoardMessagesResponse } from "@openscout/protocol";
import { requestScoutBrokerJson, ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import { resolveBrokerSocketPathForBaseUrl } from "@openscout/runtime/broker-process-manager";
import { resolveScoutBrokerUrl } from "../core/broker/service.ts";
import {
  vercelBoardSource,
  type VercelBoardConnectionStatus,
  type VercelBoardRoomData,
} from "../../shared/vercel-board-jobs.ts";

/**
 * Vercel Board rooms. Each followed Board channel is a Scout room whose
 * content lives in the runtime's copy of the channel, not in Scout's message
 * log. This route gives a room its Board tasks as job rows, in one read: the
 * runtime's status (to find the room's channel), its copy of the channel, and
 * the channel's hand-offs, raw: the client folds them and applies streamed
 * hand-offs on top. None of these calls reaches the board.
 */

const READ_TIMEOUT_MS = 4_000;
const HANDOFF_LIMIT = 500;

async function runtimeGet<T>(path: string): Promise<T | null> {
  // Through the runtime's own client, so a host that reaches its runtime by
  // socket reads the same runtime the rest of the web server reads.
  const baseUrl = resolveScoutBrokerUrl();
  try {
    return await requestScoutBrokerJson<T>(baseUrl, path, {
      socketPath: resolveBrokerSocketPathForBaseUrl(baseUrl),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (error) {
    // A runtime without the Board adapter has no such route: no Board rooms.
    if (error instanceof ScoutBrokerHttpError && error.status === 404) return null;
    throw error;
  }
}

async function boardConnections(): Promise<VercelBoardConnectionStatus[]> {
  const body = await runtimeGet<{ connections?: VercelBoardConnectionStatus[] }>("/v1/integrations/vercel-board/status");
  return body?.connections ?? [];
}

/** Scout agent ID → harness, from the runtime's agent endpoints. Held briefly: lanes ask often while a run streams. */
let harnessCache: { at: number; value: Record<string, string> } | null = null;
async function agentHarnesses(): Promise<Record<string, string>> {
  if (harnessCache && Date.now() - harnessCache.at < 30_000) return harnessCache.value;
  const body = await runtimeGet<{ endpoints?: Record<string, { agentId?: string; harness?: string; state?: string }> | { agentId?: string; harness?: string; state?: string }[] }>("/v1/endpoints");
  const value: Record<string, string> = {};
  for (const endpoint of Object.values(body?.endpoints ?? {})) {
    const { agentId, harness, state } = endpoint;
    if (agentId && harness && (!value[agentId] || state === "active")) value[agentId] = harness;
  }
  if (body) harnessCache = { at: Date.now(), value };
  return value;
}

export async function loadVercelBoardRoom(conversationId: string): Promise<VercelBoardRoomData | null> {
  const connections = await boardConnections();
  for (const connection of connections) {
    const mirror = connection.mirror?.find(entry => entry.conversationId === conversationId);
    if (!mirror) continue;
    const query = (extra: Record<string, string>) => new URLSearchParams({ connection: connection.id, ...extra }).toString();
    const [messages, handoffs, harnesses] = await Promise.all([
      runtimeGet<VercelBoardMessagesResponse>(`/v1/integrations/vercel-board/messages?${query({ channel: mirror.channel, limit: "500" })}`),
      runtimeGet<VercelBoardHandoffsResponse>(`/v1/integrations/vercel-board/handoffs?${query({ limit: String(HANDOFF_LIMIT) })}`),
      agentHarnesses().catch(() => ({})),
    ]);
    return {
      connectionId: connection.id,
      channel: mirror.channel,
      conversationId,
      board: { ...vercelBoardSource(connection.url), url: connection.url },
      mirror: mirror.state,
      lastDeltaAt: mirror.lastDeltaAt ?? null,
      lastGoodReadAt: connection.lastGoodReadAt ?? null,
      connectionState: connection.state,
      operatorPrincipal: connection.principal,
      messages: messages?.messages ?? [],
      handoffs: (handoffs?.handoffs ?? []).filter(handoff => handoff.channel === mirror.channel),
      harnesses,
    };
  }
  return null;
}

export function mountVercelBoardRoutes(app: Hono) {
  /** The Board rooms this runtime holds, so the client knows which rooms to draw as task tables. */
  app.get("/api/vercel-board/rooms", async (c) => {
    try {
      const rooms = (await boardConnections()).flatMap(connection => (connection.mirror ?? []).map(entry => ({
        conversationId: entry.conversationId, connectionId: connection.id, channel: entry.channel, mirror: entry.state,
        board: { ...vercelBoardSource(connection.url), url: connection.url }, connectionState: connection.state,
      })));
      return c.json({ rooms });
    } catch (error) {
      // Not an empty list: a client told "no Board rooms" draws each Board room
      // as an empty Scout room, intro and all, until it reads the list again.
      return c.json({ error: error instanceof Error ? error.message : "unavailable" }, 503);
    }
  });

  app.get("/api/vercel-board/room", async (c) => {
    const conversationId = c.req.query("conversationId") ?? "";
    if (!isOpaqueChannelId(conversationId)) return c.json({ error: "conversationId must be an opaque chat id" }, 400);
    try {
      const room = await loadVercelBoardRoom(conversationId);
      if (!room) return c.json({ error: "not_a_board_room" }, 404);
      return c.json(room);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[vercel-board] room ${conversationId} read failed: ${detail}`);
      // The runtime answered, but another node holds the board connection: not
      // a fault a retry fixes, so the client says so instead of retrying.
      if (error instanceof ScoutBrokerHttpError && error.code === "not_custodian") {
        return c.json({ error: "not_custodian", detail }, 409);
      }
      return c.json({ error: "runtime_unavailable", detail }, 502);
    }
  });
}
