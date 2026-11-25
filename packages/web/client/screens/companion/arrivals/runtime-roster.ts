import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../../lib/api.ts";
import { AGENT_ROSTER_EVENT_KINDS, matchesKinds } from "../../../lib/broker-event-kinds.ts";
import { useBrokerRefresh, type BrokerRefreshPolicy } from "../../../lib/broker-refresh.ts";
import type {
  AgentRosterImportEntry,
  AgentRosterImportResult,
  AgentRosterListResult,
  RosterProjectRecord,
} from "../../../../shared/api/roster.ts";
import { isRuntimeAgentKey, readLocalRoster } from "./local-roster.ts";
import { EMPTY_ROSTER_INDEX, indexRoster, nextPinAgents, parsePinAgents, type RosterIndex } from "./roster-model.ts";

/*
 * The runtime's roster for this page: read through the web server
 * (/api/roster), which passes it from the runtime and answers only a page on
 * the host. The runtime numbers an agent the first time it sees it active, so
 * the read follows agent events, with a slow poll behind them.
 */

const ROSTER_URL = "/api/roster";
const ROSTER_REFRESH_POLICY: BrokerRefreshPolicy = {
  matches: matchesKinds(AGENT_ROSTER_EVENT_KINDS),
  activeWhen: "visible",
  fallbackPollMs: 30_000,
  livePollMs: 60_000,
};

export type RuntimeRoster = RosterIndex & {
  /** False until the first read answers. */
  loaded: boolean;
  /** Why the roster could not be read, as a sentence; null once it reads. */
  unavailable: string | null;
  reload: () => Promise<void>;
};

/** A refusal or failure from the roster routes: the sentence to show, and the runtime's token. */
export class RosterRequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: string | null) {
    super(message);
    this.name = "RosterRequestError";
  }
}

function asRosterError(error: unknown): RosterRequestError {
  if (error instanceof RosterRequestError) return error;
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : null;
  const message = error instanceof Error && error.message ? error.message : "The runtime did not answer.";
  // api() puts the body's `error` sentence in the message; the token is not kept, so read it from the status.
  const code = status === 409 ? "project_code_held" : status === 403 ? "local_only" : status === 502 ? "runtime_unavailable" : null;
  return new RosterRequestError(message, status, code);
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Set a project's code (two or three letters), or give it back its default with null. Throws the runtime's refusal. */
export async function setRuntimeProjectCode(project: string, code: string | null): Promise<RosterProjectRecord> {
  try {
    const result = await api<{ project: RosterProjectRecord }>("/api/roster/projects/code", post({ project, code }));
    return result.project;
  } catch (error) {
    throw asRosterError(error);
  }
}

/** Ask the runtime what an import would do (dryRun), or do it. */
export async function importToRuntime(entries: readonly AgentRosterImportEntry[], dryRun: boolean): Promise<AgentRosterImportResult> {
  try {
    return await api<AgentRosterImportResult>("/api/roster/import", post({ entries, dryRun }));
  } catch (error) {
    throw asRosterError(error);
  }
}

const PIN_AGENTS_KEY = "scout:companion:pin-agents";

/** The stored pin-to-agent map; on first use, the figures' agents as the old roster kept them. */
function readPinAgents(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PIN_AGENTS_KEY);
    if (raw !== null) return parsePinAgents(raw);
    const old = readLocalRoster().roster.pins;
    return Object.fromEntries(Object.entries(old).filter(([, key]) => isRuntimeAgentKey(key)));
  } catch {
    return {};
  }
}

/**
 * Which agent each figure on the desk is, by pin (nextPinAgents), kept in
 * this page's storage so a figure whose row has left the board still wears
 * its agent's code. It holds agent ids only, never a number. `seen` is null
 * for the demo; `pinsNow` null while the host has not said who is out.
 */
export function usePinAgents(seen: ReadonlyArray<readonly [string, string]> | null, pinsNow: readonly string[] | null): Readonly<Record<string, string>> {
  const [stored, setStored] = useState<Readonly<Record<string, string>>>(() => (seen ? readPinAgents() : {}));
  const next = useMemo(() => (seen ? nextPinAgents(stored, seen, pinsNow) : stored), [stored, seen, pinsNow]);
  useEffect(() => {
    if (next === stored) return;
    setStored(next);
    try {
      window.localStorage.setItem(PIN_AGENTS_KEY, JSON.stringify(next));
    } catch { /* it still holds for this session */ }
  }, [next, stored]);
  return next;
}

/** The runtime's roster, read now and again as agents change; off (`enabled` false) for the demo. */
export function useRuntimeRoster(enabled = true): RuntimeRoster {
  const [list, setList] = useState<AgentRosterListResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const next = await api<AgentRosterListResult>(ROSTER_URL, { cache: "no-store" });
      setList((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setUnavailable(null);
    } catch (error) {
      // Keep the last roster: a runtime that does not answer for a moment does not take the labels away.
      setUnavailable(asRosterError(error).message);
    } finally {
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => { void reload(); }, [reload]);
  useBrokerRefresh(() => void reload(), ROSTER_REFRESH_POLICY);

  const index = useMemo(() => (enabled ? indexRoster(list) : EMPTY_ROSTER_INDEX), [enabled, list]);
  return useMemo(() => ({ ...index, loaded, unavailable, reload }), [index, loaded, unavailable, reload]);
}
