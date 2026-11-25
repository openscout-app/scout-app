import type { Context, Hono } from "hono";
import { z } from "zod";
import { ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import type {
  AgentRosterImportRequest,
  AgentRosterImportResult,
  AgentRosterListResult,
  RosterProjectCodeSetRequest,
  RosterProjectRecord,
} from "@openscout/protocol";

import { importScoutRoster, readScoutRoster, setScoutRosterProjectCode } from "../core/broker/service.ts";
import { readJsonBody } from "../request-body.ts";
import { isSameMacScoutRequest, resolveScoutRequestPeerAddress } from "../server-core.ts";
import type { CreateOpenScoutWebServerOptions } from "../web-server-options.ts";
import type { RosterRefusal } from "../../shared/api/roster.ts";

/*
 * The runtime's agent roster, for the pages on this host. The runtime is the
 * only writer: these routes read it and pass the operator's changes to it.
 * Its /v1/roster routes refuse remote, guest and scoped callers, and this
 * server reaches them as a local caller, so it applies the same rule itself:
 * only a page on this host reads or changes the roster.
 */

export type RosterBroker = {
  list(): Promise<AgentRosterListResult>;
  setProjectCode(body: RosterProjectCodeSetRequest): Promise<{ project: RosterProjectRecord }>;
  importEntries(body: AgentRosterImportRequest): Promise<AgentRosterImportResult>;
};

export type RosterRouteDeps = {
  options: Pick<CreateOpenScoutWebServerOptions, "resolvePeerAddress">;
  broker?: RosterBroker;
};

const runtimeBroker: RosterBroker = {
  list: () => readScoutRoster(),
  setProjectCode: (body) => setScoutRosterProjectCode(body),
  importEntries: (body) => importScoutRoster(body),
};

const projectCodeBody = z.object({
  project: z.string().trim().min(1, "a project name is required"),
  code: z.string().trim().nullable(),
});

/** The roster holds 999 numbers, so a longer import is not a roster. */
const IMPORT_MAX_ENTRIES = 999;

const importBody = z.object({
  entries: z.array(z.object({
    agentId: z.string().trim().min(1),
    number: z.union([z.number(), z.string()]),
    projectCode: z.string().nullable().optional(),
  })).max(IMPORT_MAX_ENTRIES),
  dryRun: z.boolean().optional(),
});

function refusal(c: Context, status: 400 | 403 | 404 | 409 | 502, body: RosterRefusal): Response {
  return c.json(body, status);
}

/** The runtime's refusal as it gave it (its sentence, its token, the holder); anything else as the runtime not answering. */
function relayRuntimeError(c: Context, error: unknown): Response {
  if (error instanceof ScoutBrokerHttpError && error.status >= 400 && error.status < 500) {
    let parsed: { error?: unknown; detail?: unknown; heldBy?: unknown } = {};
    try { parsed = JSON.parse(error.body) as typeof parsed; } catch { /* not JSON: keep the status alone */ }
    const code = typeof parsed.error === "string" ? parsed.error : error.code ?? "runtime_refused";
    const detail = typeof parsed.detail === "string" && parsed.detail.trim() ? parsed.detail : "The runtime refused the change.";
    const status = error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 400;
    return refusal(c, status, { error: detail, code, ...(typeof parsed.heldBy === "string" ? { heldBy: parsed.heldBy } : {}) });
  }
  return refusal(c, 502, { error: "The runtime did not answer. Nothing was changed.", code: "runtime_unavailable" });
}

export function mountRosterRoutes(app: Hono, deps: RosterRouteDeps) {
  const broker = deps.broker ?? runtimeBroker;
  const onHost = (c: Context) => isSameMacScoutRequest(
    c.req.raw,
    (deps.options.resolvePeerAddress ?? resolveScoutRequestPeerAddress)(c),
  );
  const elsewhere = (c: Context) => refusal(c, 403, {
    error: "The agent roster is kept on its host. Open this page on the host to read or change it.",
    code: "local_only",
  });

  app.get("/api/roster", async (c) => {
    if (!onHost(c)) return elsewhere(c);
    try {
      return c.json(await broker.list());
    } catch (error) {
      return relayRuntimeError(c, error);
    }
  });

  app.post("/api/roster/projects/code", async (c) => {
    if (!onHost(c)) return elsewhere(c);
    const read = await readJsonBody(c, projectCodeBody);
    if (!read.ok) return read.response;
    const code = read.body.code ? read.body.code.toUpperCase() : null;
    try {
      return c.json(await broker.setProjectCode({ project: read.body.project, code }));
    } catch (error) {
      return relayRuntimeError(c, error);
    }
  });

  app.post("/api/roster/import", async (c) => {
    if (!onHost(c)) return elsewhere(c);
    const read = await readJsonBody(c, importBody);
    if (!read.ok) return read.response;
    // A real import is asked for by name: anything short of dryRun false is a dry run.
    const dryRun = read.body.dryRun !== false;
    try {
      return c.json(await broker.importEntries({ entries: read.body.entries, dryRun }));
    } catch (error) {
      return relayRuntimeError(c, error);
    }
  });
}
