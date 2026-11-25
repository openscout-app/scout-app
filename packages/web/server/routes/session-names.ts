import type { Context, Hono } from "hono";
import { z } from "zod";
import { ScoutBrokerHttpError } from "@openscout/runtime/broker-api";

import { setScoutSessionName } from "../core/broker/service.ts";
import { readJsonBody } from "../request-body.ts";
import { isSameMacScoutRequest, resolveScoutRequestPeerAddress } from "../server-core.ts";
import type { CreateOpenScoutWebServerOptions } from "../web-server-options.ts";
import {
  SESSION_NAME_MAX_LENGTH,
  type SessionNameRefusal,
  type SessionNameSetBody,
  type SessionNameSetResult,
} from "../../shared/api/session-names.ts";

/*
 * Session names, for the pages on this host. The runtime keeps them and
 * resolves every session read as operator name, then current work, then the
 * harness title. Its /v1/session-names route refuses remote, guest and scoped
 * callers; this server reaches it as a local caller, so it applies the same
 * rule itself: only a page on this host names a session.
 */

export type SessionNameBroker = {
  set(body: SessionNameSetBody): Promise<SessionNameSetResult>;
};

export type SessionNameRouteDeps = {
  options: Pick<CreateOpenScoutWebServerOptions, "resolvePeerAddress">;
  broker?: SessionNameBroker;
};

const runtimeBroker: SessionNameBroker = { set: (body) => setScoutSessionName(body) };

const setBody = z.object({
  selector: z.string().trim().min(1, "name a session").max(1024),
  harness: z.string().trim().min(1).max(64).optional(),
  // The runtime trims, collapses whitespace and enforces the limit; this only bounds the request.
  name: z.string().max(SESSION_NAME_MAX_LENGTH * 4).nullable(),
});

function refusal(c: Context, status: 400 | 403 | 404 | 409 | 502, body: SessionNameRefusal): Response {
  return c.json(body, status);
}

function relayRuntimeError(c: Context, error: unknown): Response {
  if (error instanceof ScoutBrokerHttpError && error.status >= 400 && error.status < 500) {
    let parsed: { error?: unknown; detail?: unknown } = {};
    try { parsed = JSON.parse(error.body) as typeof parsed; } catch { /* not JSON: keep the status alone */ }
    const code = typeof parsed.error === "string" ? parsed.error : error.code ?? "runtime_refused";
    const detail = typeof parsed.detail === "string" && parsed.detail.trim() ? parsed.detail : "The runtime refused the name.";
    const status = error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 400;
    return refusal(c, status, { error: detail, code });
  }
  return refusal(c, 502, { error: "The runtime did not answer. The name was not changed.", code: "runtime_unavailable" });
}

export function mountSessionNameRoutes(app: Hono, deps: SessionNameRouteDeps) {
  const broker = deps.broker ?? runtimeBroker;
  const onHost = (c: Context) => isSameMacScoutRequest(
    c.req.raw,
    (deps.options.resolvePeerAddress ?? resolveScoutRequestPeerAddress)(c),
  );

  app.post("/api/session-names", async (c) => {
    c.header("cache-control", "no-store");
    if (!onHost(c)) {
      return refusal(c, 403, { error: "Session names are kept on their host. Open this page on the host to rename a session.", code: "local_only" });
    }
    const read = await readJsonBody(c, setBody);
    if (!read.ok) return read.response;
    const name = read.body.name?.trim() ? read.body.name : null;
    try {
      return c.json(await broker.set({ selector: read.body.selector, ...(read.body.harness ? { harness: read.body.harness } : {}), name }));
    } catch (error) {
      return relayRuntimeError(c, error);
    }
  });
}
