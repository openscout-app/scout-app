import type { OperatorAttentionItem, WorkDetail } from "../../lib/types.ts";

/**
 * The open requests that belong to one work item: a permission request,
 * approval, pane prompt or question raised by the run it started, a session
 * that run used, or a subagent it handed work to. The work page answers them
 * in place, so the operator never has to leave the item to unblock it.
 */
export type WorkRequestKeys = {
  flightIds: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
  conversationIds: ReadonlySet<string>;
  agentIds: ReadonlySet<string>;
};

// A work item's own record, a configuration gap or a plain ask is not a decision the run waits on.
const NOT_A_REQUEST = new Set<OperatorAttentionItem["kind"]>(["work_item", "configuration", "ask"]);

function add(set: Set<string>, value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) set.add(trimmed);
}

export function workRequestKeys(detail: WorkDetail): WorkRequestKeys {
  const flightIds = new Set<string>();
  const sessionIds = new Set<string>();
  const conversationIds = new Set<string>();
  const agentIds = new Set<string>();
  add(conversationIds, detail.conversationId);
  const ask = detail.primaryInvocation;
  if (ask) {
    add(flightIds, ask.flightId);
    add(sessionIds, ask.resolvedSessionId);
    add(sessionIds, ask.targetSessionId);
    add(agentIds, ask.targetAgentId);
  }
  for (const flight of [...detail.allFlights, ...detail.activeFlights]) {
    add(flightIds, flight.id);
    add(agentIds, flight.agentId);
    add(conversationIds, flight.conversationId);
    for (const session of flight.sessions ?? []) add(sessionIds, session.sessionId);
  }
  // Subagents: work this item handed out runs under its own conversation and owner.
  for (const child of detail.childWork) {
    add(conversationIds, child.conversationId);
    add(agentIds, child.ownerId);
  }
  return { flightIds, sessionIds, conversationIds, agentIds };
}

export function isWorkRequest(item: OperatorAttentionItem, keys: WorkRequestKeys): boolean {
  if (NOT_A_REQUEST.has(item.kind)) return false;
  // A request that names its flight belongs to that flight's work and no other.
  const flightId = item.permission?.flightId;
  if (flightId) return keys.flightIds.has(flightId);
  const sessionId = item.permission?.sessionId ?? item.approval?.sessionId;
  if (sessionId && keys.sessionIds.has(sessionId)) return true;
  if (item.conversationId && keys.conversationIds.has(item.conversationId)) return true;
  return Boolean(item.agentId && keys.agentIds.has(item.agentId));
}

export function selectWorkRequests(items: readonly OperatorAttentionItem[], detail: WorkDetail): OperatorAttentionItem[] {
  const keys = workRequestKeys(detail);
  return items.filter((item) => isWorkRequest(item, keys));
}
