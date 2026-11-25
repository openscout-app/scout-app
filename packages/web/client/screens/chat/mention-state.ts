import type { Flight, Message } from "../../lib/types.ts";

/**
 * What became of the @mentions in one post, read only from what the runtime
 * recorded: the targets it routed the post to (`metadata.relayTargetIds`) and
 * the flights it opened for the post (`flight.messageId`). Nothing here is
 * inferred from time or presence. A post the runtime has no routing record
 * for gets no line at all.
 */
export type MentionTone = "pending" | "active" | "done" | "problem";

export type MentionStateLine = {
  key: string;
  /** Who the line is about: an agent name, or the @handle that matched nobody. */
  who: string;
  label: string;
  tone: MentionTone;
};

const MENTION_PATTERN = /(^|[\s(])@([A-Za-z0-9][\w.-]*[\w])/g;

export function mentionHandles(body: string): string[] {
  const handles: string[] = [];
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = match[2];
    if (handle && !handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

function relayTargetIds(message: Pick<Message, "metadata">): string[] | null {
  const value = message.metadata?.["relayTargetIds"];
  if (!Array.isArray(value)) return null;
  return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

function flightLine(flight: Flight): MentionStateLine {
  const who = flight.agentName?.trim() || flight.agentId;
  const dispatch = flight.dispatchOutcome?.status ?? null;
  switch (flight.state) {
    case "completed":
      return { key: flight.id, who, label: "replied", tone: "done" };
    case "failed":
      return { key: flight.id, who, label: "did not finish", tone: "problem" };
    case "cancelled":
      return { key: flight.id, who, label: "cancelled", tone: "problem" };
    case "running":
      return { key: flight.id, who, label: "working", tone: "active" };
    default:
      return {
        key: flight.id,
        who,
        label: dispatch === "failed" ? "not delivered" : "delivered, not started",
        tone: dispatch === "failed" ? "problem" : "pending",
      };
  }
}

export function messageMentionStates(
  message: Pick<Message, "id" | "body" | "metadata">,
  flights: readonly Flight[],
): MentionStateLine[] {
  const handles = mentionHandles(message.body);
  if (handles.length === 0) return [];

  const forMessage = flights.filter((flight) => flight.messageId === message.id);
  if (forMessage.length > 0) return forMessage.map(flightLine);

  const targets = relayTargetIds(message);
  // No routing record: the runtime never said who this post went to, so say
  // nothing rather than guess.
  if (targets === null) return [];

  if (targets.length === 0) {
    return handles.map((handle) => ({
      key: `unresolved:${handle}`,
      who: `@${handle}`,
      label: "matched no agent; nobody was asked",
      tone: "problem" as const,
    }));
  }

  return [{
    key: "routed",
    who: targets.length === 1 ? targets[0]! : `${targets.length} agents`,
    label: "delivered, no turn yet",
    tone: "pending",
  }];
}

/**
 * The post that settles a thread. Councils and decision threads close with a
 * post that opens with its label ("council:", "decision:", "outcome:"), the
 * way the #scout council asks for it. The label is the author's own marker.
 */
const OUTCOME_PATTERN = /^\s*(council|decision|outcome)\s*:/i;

export function isOutcomePost(message: Pick<Message, "body">): boolean {
  return OUTCOME_PATTERN.test(message.body);
}
