import { mergeFollowTargets } from "../../../lib/follow-route.ts";
import type { FleetAsk, FleetState, FollowTarget, Route } from "../../../lib/types.ts";
import { followTailParams } from "../../ops/follow-tail-params.ts";

/*
 * What the Following panel says about Ops › Tail's follow link. Pure, so the
 * rules test without a DOM (tail-follow-model.test.ts).
 *
 * A follow link lands on /ops/tail with Scout ids in the URL; the Tail panel
 * filters on the harness session GET /api/follow resolves them to. This panel
 * names what is being followed (the ask, its agent, the session the stream is
 * narrowed to) and where else it can be opened.
 */

export type TailFollowState =
  /** Not on Ops › Tail: the page has nothing to follow. */
  | { kind: "off" }
  /** Ops › Tail with no filter: every session. */
  | { kind: "every" }
  /** A typed filter (?q=) and no follow ids. */
  | { kind: "query"; q: string }
  /** Follow ids: `key` is the /api/follow query, `ids` what the URL named. */
  | { kind: "follow"; key: string; ids: FollowTarget };

export function tailFollowState(route: Route): TailFollowState {
  if (route.view !== "ops" || route.mode !== "tail") return { kind: "off" };
  const key = followTailParams(route).toString();
  if (key) {
    return {
      kind: "follow",
      key,
      ids: {
        flightId: route.flightId ?? null,
        invocationId: route.invocationId ?? null,
        conversationId: route.conversationId ?? null,
        workId: route.workId ?? null,
        sessionId: route.sessionId ?? null,
        targetAgentId: route.targetAgentId ?? null,
      },
    };
  }
  return route.tailQuery ? { kind: "query", q: route.tailQuery } : { kind: "every" };
}

/** What the broker resolved (when it has answered), filled in from the URL's own ids. */
export function followTarget(ids: FollowTarget, resolved: FollowTarget | null): FollowTarget {
  return resolved ? mergeFollowTargets(resolved, ids) : ids;
}

/** The ask the link follows, from the fleet: by invocation, then flight, then work item. */
export function askForFollow(fleet: Pick<FleetState, "activeAsks" | "recentCompleted"> | null, target: FollowTarget): FleetAsk | null {
  if (!fleet) return null;
  const asks = [...(fleet.activeAsks ?? []), ...(fleet.recentCompleted ?? [])];
  const find = (match: (ask: FleetAsk) => boolean) => asks.find(match) ?? null;
  return (
    (target.invocationId ? find((a) => a.invocationId === target.invocationId) : null)
    ?? (target.flightId ? find((a) => a.flightId === target.flightId) : null)
    ?? (target.workId ? find((a) => a.collaborationRecordId === target.workId) : null)
  );
}

/** The line under the ask: which harness session the stream shows, or that it is not known yet. */
export function followSessionNote(target: FollowTarget): string {
  const harness = target.harnessSessionId?.trim();
  return harness
    ? `The tail shows session ${harness}.`
    : "Waiting for its session. Until then the tail matches these ids.";
}

export type FollowIdRow = { label: string; value: string };

/** The ids behind the link, in the order an operator reads them. */
export function followIdRows(target: FollowTarget): FollowIdRow[] {
  const rows: Array<[string, string | null | undefined]> = [
    ["Work", target.workId],
    ["Flight", target.flightId],
    ["Invocation", target.invocationId],
    ["Session", target.sessionId],
    ["Chat", target.conversationId],
    ["Agent", target.targetAgentId],
    ["Harness session", target.harnessSessionId],
  ];
  return rows.filter((row): row is [string, string] => !!row[1]?.trim()).map(([label, value]) => ({ label, value: value.trim() }));
}

export type FollowOpen = { label: string; route: Route };

/** Where the followed task can be opened, most durable first. */
export function followOpens(target: FollowTarget): FollowOpen[] {
  const opens: FollowOpen[] = [];
  if (target.workId) opens.push({ label: "Open work", route: { view: "work", workId: target.workId } });
  if (target.flightId || target.sessionId) {
    opens.push({
      label: "Open session",
      route: {
        view: "sessions",
        ...(target.flightId ? { flightId: target.flightId } : {}),
        ...(target.sessionId ? { sessionId: target.sessionId } : {}),
      },
    });
  }
  if (target.conversationId) opens.push({ label: "Open chat", route: { view: "conversation", conversationId: target.conversationId } });
  if (target.targetAgentId) opens.push({ label: "Agent", route: { view: "agents-v2", agentId: target.targetAgentId } });
  return opens;
}

/** Ops › Tail with no filter and no follow ids. */
export const EVERY_SESSION_ROUTE: Route = { view: "ops", mode: "tail" };
