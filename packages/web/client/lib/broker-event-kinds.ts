import type { ControlEvent } from "@openscout/protocol";
import type { BrokerEvent } from "./sse.ts";

type ControlEventKind = ControlEvent["kind"];

// Which broker events change which payloads. Typed against the ControlEvent
// union, so a kind the broker never emits (there is no "agent.updated") fails
// to compile instead of silently never matching.
/** `/api/fleet`: asks, flights, activity, and each agent's live state. */
export const FLEET_EVENT_KINDS: readonly ControlEventKind[] = [
  "agent.registered",
  "agent.endpoint.upserted",
  "agent.endpoint.deleted",
  "message.posted",
  "invocation.requested",
  "flight.updated",
  "delivery.state.changed",
  "collaboration.upserted",
  "collaboration.event.appended",
  "scout.dispatched",
  // Agent working/idle transitions arrive only as presence.
  "presence.updated",
];

export function matchesKinds(
  ...groups: ReadonlyArray<readonly ControlEventKind[]>
): (event: BrokerEvent) => boolean {
  const kinds = new Set<string>(groups.flat());
  return (event) => kinds.has(event.kind);
}
