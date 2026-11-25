import { db, closeDb } from "./db/internal/db.ts";
import { queryFleet, queryRuns, querySessions, queryAgents, queryBrokerAttentionHints, queryFlights, queryWorkItems } from "./db-queries.ts";
import { loadAgentObserveSummaries } from "./core/observe/service.ts";
import { loadServiceBudgets } from "./service-budgets.ts";

declare const self: Worker;
import { queryAgentIdsByEndpointSessionId } from "./db/agents.ts";
import { queryOperatorAttentionRows } from "./db/fleet.ts";
import { getScoutConversations } from "./core/conversations/service.ts";
import { queryFeedWork } from "./db/feed.ts";
const reads = { feedWork: queryFeedWork, conversations: getScoutConversations, agents: queryAgents, attentionHints: queryBrokerAttentionHints,
  endpointAgentIds: queryAgentIdsByEndpointSessionId, attentionRows: queryOperatorAttentionRows, fleet: queryFleet, runs: queryRuns, flights: queryFlights, workItems: queryWorkItems, sessions: querySessions,
  observe: loadAgentObserveSummaries, budgets: loadServiceBudgets };
self.onmessage = async event => {
  const { dbPath, id, method, args } = event.data;
  if (dbPath) {
    try { closeDb(); db(dbPath); }
    catch (error) { self.postMessage({ fatal: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  try {
    if (!Object.hasOwn(reads, method)) throw new Error("Unknown background read");
    const result = await (reads[method as keyof typeof reads] as (...args: any[]) => unknown)(...args);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
