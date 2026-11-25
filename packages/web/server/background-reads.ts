/** Expensive page-shell reads must never run SQLite or scan files on the HTTP loop. */
import { resolveDbPath } from "./db/internal/db.ts";
import type { queryFleet, queryRuns, querySessions, queryAgents, queryBrokerAttentionHints, queryFlights, queryWorkItems } from "./db-queries.ts";
import type { loadAgentObserveSummaries } from "./core/observe/service.ts";
import type { loadServiceBudgets } from "./service-budgets.ts";

import type { queryAgentIdsByEndpointSessionId } from "./db/agents.ts";
import type { queryOperatorAttentionRows } from "./db/fleet.ts";

import type { getScoutConversations } from "./core/conversations/service.ts";

import type { queryFeedWork, FeedRead } from "./db/feed.ts";

type Reads = {
  feedWork: (read: FeedRead) => ReturnType<typeof queryFeedWork>;
  conversations: typeof getScoutConversations;
  agents: typeof queryAgents;
  attentionHints: typeof queryBrokerAttentionHints;
  endpointAgentIds: typeof queryAgentIdsByEndpointSessionId;
  attentionRows: typeof queryOperatorAttentionRows;
  fleet: typeof queryFleet;
  runs: typeof queryRuns;
  flights: typeof queryFlights;
  workItems: typeof queryWorkItems;
  sessions: typeof querySessions;
  observe: typeof loadAgentObserveSummaries;
  budgets: typeof loadServiceBudgets;
};
type BackgroundWorker = Worker & { ref(): void; unref(): void };
export function createBackgroundReads(options: { dbPath?: string; workerUrl?: URL } = {}) {
  let worker: BackgroundWorker | undefined;
  let sequence = 0;
  let contextSequence = 0;
  const contextIds = new WeakMap<object, number>();
  const inflight = new Map<string, Promise<any>>();
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  function fail(error: Error) {
    const old = worker; worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear(); inflight.clear(); old?.terminate();
  }
  function read<K extends keyof Reads>(method: K, ...args: Parameters<Reads[K]>): Promise<Awaited<ReturnType<Reads[K]>>> {
    // Do not stringify a broker snapshot on the HTTP loop just to deduplicate it.
    let key: string;
    const context = (args as unknown[])[1];
    if (method === "conversations" && context && typeof context === "object") {
      let id = contextIds.get(context);
      if (id === undefined) { id = ++contextSequence; contextIds.set(context, id); }
      key = JSON.stringify([method, args[0], id]);
    } else key = JSON.stringify([method, args]);
    const shared = inflight.get(key); if (shared) return shared;
    if (!worker) {
      const url = options.workerUrl ?? new URL(import.meta.path.endsWith(".ts")
        ? "./background-reads-worker.ts" : "./background-reads-worker.mjs", import.meta.url);
      worker = new Worker(url, { type: "module" }) as BackgroundWorker;
      const created = worker;
      worker.onerror = event => { if (worker === created) fail(new Error(event.message || "Background read worker failed")); };
      worker.addEventListener("close", () => { if (worker === created) fail(new Error("Background read worker closed")); });
      worker.onmessage = event => {
        const { id, result, error, fatal } = event.data;
        if (fatal) { if (worker === created) fail(new Error(fatal)); return; }
        const request = pending.get(id); if (!request) return;
        pending.delete(id);
        if (!pending.size) created.unref();
        if (error) request.reject(new Error(error)); else request.resolve(result);
      };
      // Resolve before crossing the worker boundary; Bun can reload ambient .env in a worker.
      worker.postMessage({ dbPath: options.dbPath ?? resolveDbPath() });
    }
    worker.ref();
    const request = new Promise<any>((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject });
      try { worker!.postMessage({ id, method, args }); }
      catch (error) { pending.delete(id); if (!pending.size) worker?.unref(); reject(error); }
    }).finally(() => { if (inflight.get(key) === request) inflight.delete(key); });
    inflight.set(key, request);
    return request;
  }
  return {
    feedWork: (arg: FeedRead) => read("feedWork", arg),
    conversations: (...args: Parameters<Reads["conversations"]>) => read("conversations", ...args),
    agents: (...args: Parameters<Reads["agents"]>) => read("agents", ...args),
    attentionHints: (...args: Parameters<Reads["attentionHints"]>) => read("attentionHints", ...args),
    endpointAgentIds: () => read("endpointAgentIds"),
    attentionRows: (...args: Parameters<Reads["attentionRows"]>) => read("attentionRows", ...args),
    fleet: (...args: Parameters<Reads["fleet"]>) => read("fleet", ...args),
    runs: (...args: Parameters<Reads["runs"]>) => read("runs", ...args),
    flights: (...args: Parameters<Reads["flights"]>) => read("flights", ...args),
    workItems: (...args: Parameters<Reads["workItems"]>) => read("workItems", ...args),
    sessions: (...args: Parameters<Reads["sessions"]>) => read("sessions", ...args),
    observe: (...args: Parameters<Reads["observe"]>) => read("observe", ...args),
    budgets: (...args: Parameters<Reads["budgets"]>) => read("budgets", ...args),
    close: () => fail(new Error("Background reads closed")),
  };
}
export const backgroundReads = createBackgroundReads();
