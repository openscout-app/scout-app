import type { Route } from "../../lib/types.ts";

/**
 * The Scout ids a follow link put on Ops › Tail (?flightId ?invocationId
 * ?conversationId ?workId ?sessionId ?targetAgentId), as the query GET
 * /api/follow takes. Empty off the Tail page: only Tail reads them. Pure, so
 * useFollowTailQuery and the Following panel share one reading of the URL.
 */
export function followTailParams(route: Route): URLSearchParams {
  const params = new URLSearchParams();
  if (route.view === "ops" && route.mode === "tail") {
    if (route.flightId) params.set("flightId", route.flightId);
    if (route.invocationId) params.set("invocationId", route.invocationId);
    if (route.conversationId) params.set("conversationId", route.conversationId);
    if (route.workId) params.set("workId", route.workId);
    if (route.sessionId) params.set("sessionId", route.sessionId);
    if (route.targetAgentId) params.set("targetAgentId", route.targetAgentId);
  }
  return params;
}
