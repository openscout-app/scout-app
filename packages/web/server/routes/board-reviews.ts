import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { requestScoutBrokerJson, ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import { resolveBrokerSocketPathForBaseUrl } from "@openscout/runtime/broker-process-manager";
import { resolveScoutBrokerUrl } from "../core/broker/service.ts";
import { readJsonBody } from "../request-body.ts";
import {
  isAuthenticatedScoutRequest, isSameMacScoutRequest, resolveScoutRequestPeerAddress,
  type ScoutApiTrustOptions,
} from "../server-core.ts";

const field = z.string().min(1);
const room = z.object({ connectionId: field, channel: field });
const routine = room.extend({
  id: field, name: field, projectPath: field, harness: z.enum(["codex", "claude"]),
  enabled: z.boolean(), expectedVersion: z.number().int().nonnegative(),
}).strict();
const item = z.object({ routineId: field, itemId: field }).strict();
const run = item.extend({
  requestId: field, routineVersion: z.number().int().positive(), inputVersion: field, revision: field,
}).strict();

async function requestReview(path: string, body?: unknown): Promise<unknown> {
  const base = resolveScoutBrokerUrl();
  return requestScoutBrokerJson(base, path, {
    method: body === undefined ? "GET" : "POST", body,
    socketPath: resolveBrokerSocketPathForBaseUrl(base), signal: AbortSignal.timeout(30_000),
  });
}

/** Only the local operator UI may use the web process's runtime signature for reviews. */
export function mountBoardReviewRoutes(app: Hono, trust: ScoutApiTrustOptions, request = requestReview) {
  app.use("/api/manual-review/*", async (c, next) => {
    const peerAddress = (trust.resolvePeerAddress ?? resolveScoutRequestPeerAddress)(c);
    if (!isSameMacScoutRequest(c.req.raw, peerAddress) || c.req.raw.headers.has("x-openscout-forwarded-node-id")) {
      return c.json({ error: "Board reviews are available on the connected host." }, 403);
    }
    if (!isAuthenticatedScoutRequest(c.req.raw, trust.authToken, trust.sessions?.validate)) {
      return c.json({ error: "Sign in as the operator to manage Board reviews." }, 401);
    }
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/api/manual-review/*", bodyLimit({ maxSize: 16 * 1024 }));

  async function forward(c: Context, path: string, body?: unknown) {
    try {
      return c.json(await request(path, body));
    } catch (error) {
      if (error instanceof ScoutBrokerHttpError && error.status >= 400 && error.status <= 599) {
        // Keep version conflicts, disabled grants and indeterminate dispatch distinguishable to the caller.
        try {
          const payload = JSON.parse(error.body);
          if (typeof payload?.error === "string") {
            const message = typeof payload.detail === "string" && payload.detail.trim() ? payload.detail : payload.error;
            return c.json({ ...payload, code: payload.error, error: message }, error.status as ContentfulStatusCode);
          }
        } catch { /* A runtime can also return a plain-text error. */ }
        return c.json({ error: "The runtime could not complete the Board review request." }, error.status as ContentfulStatusCode);
      }
      return c.json({ error: "The Scout runtime did not answer the Board review request." }, 503);
    }
  }

  app.get("/api/manual-review/board-routines", async (c) => {
    const query = room.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Choose a Board connection and channel." }, 400);
    return forward(c, `/v1/manual-review/board-routines?${new URLSearchParams(query.data)}`);
  });

  app.get("/api/manual-review/occurrences", async c => {
    const query = z.object({ scope: z.string().regex(/^board-review:[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
      requestId: field.max(1024) }).strict().safeParse(c.req.query());
    if (!query.success) return c.json({ error: "Choose a Board reviewer and run." }, 400);
    return forward(c, `/v1/manual-review/occurrences?${new URLSearchParams(query.data)}`);
  });
  const validWorkId = /^work-manual-review-[0-9a-f]{32}$/;
  app.get("/api/manual-review/board-tickets/:workId", async c => {
    const workId = c.req.param("workId");
    if (!validWorkId.test(workId)) return c.json({ error: "Unknown Board review ticket." }, 404);
    return forward(c, `/v1/manual-review/board-ticket?${new URLSearchParams({ workId })}`);
  });
  app.post("/api/manual-review/board-tickets/:workId/accept", async c => {
    const workId = c.req.param("workId");
    if (!validWorkId.test(workId)) return c.json({ error: "Unknown Board review ticket." }, 404);
    return forward(c, "/v1/manual-review/board-accept", { workId });
  });

  for (const [endpoint, schema] of [
    ["board-routines", routine], ["board-preview", item], ["board-runs", run],
  ] as const) {
    app.post(`/api/manual-review/${endpoint}`, async (c) => {
      const parsed = await readJsonBody(c, schema);
      if (!parsed.ok) return parsed.response;
      return forward(c, `/v1/manual-review/${endpoint}`, parsed.body);
    });
  }
}
