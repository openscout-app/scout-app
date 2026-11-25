import { join } from "node:path";

import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import { readJsonFile, writeJsonFileDurably } from "./durable-json.ts";

/**
 * Where each hand-out came from. When Scoutbot asks another agent for the
 * operator, the runtime runs the ask and, when it finishes, notifies Scoutbot
 * in the conversation it made with that agent. This map is how Scoutbot finds
 * the operator's thread again: flight id to thread and the operator's message.
 *
 * It holds no dispatch state. The runtime owns the ask, its retries and its
 * result; losing an entry only means the answer goes unrouted.
 */
export type ScoutbotHandout = {
  threadId: string;
  /** The operator message the hand-out answers, when the turn was known. */
  sourceMessageId?: string;
  /** Who to notify with the result. */
  actorId: string;
  at: number;
  /**
   * The result message that was answered. A flight can report twice (an
   * agent's failed reply, then the runtime's failure report); the operator
   * hears one of them.
   */
  answeredBy?: string;
};

export type ScoutbotHandouts = {
  get: (flightId: string) => ScoutbotHandout | undefined;
  set: (flightId: string, handout: ScoutbotHandout) => void;
  /** True when `messageId` is the flight's answer: the first result to claim it, or the same one again after a restart. */
  claimAnswer: (flightId: string, messageId: string) => boolean;
};

const KEEP_MS = 30 * 24 * 60 * 60_000;

export function createScoutbotHandouts(
  filePath = join(resolveOpenScoutSupportPaths().supportDirectory, "scoutbot", "process-handouts.json"),
  now: () => number = Date.now,
): ScoutbotHandouts {
  const parsed = readJsonFile(filePath) as { flights?: Record<string, ScoutbotHandout> } | undefined;
  let flights: Record<string, ScoutbotHandout> = {};
  for (const [flightId, value] of Object.entries(parsed?.flights ?? {})) {
    if (value && typeof value.threadId === "string" && typeof value.actorId === "string" && typeof value.at === "number") {
      flights[flightId] = value;
    }
  }
  const write = (flightId: string, handout: ScoutbotHandout) => {
    const cutoff = now() - KEEP_MS;
    const next: Record<string, ScoutbotHandout> = { [flightId]: handout };
    for (const [id, value] of Object.entries(flights)) if (id !== flightId && value.at >= cutoff) next[id] = value;
    writeJsonFileDurably(filePath, { version: 1, flights: next });
    flights = next;
  };
  return {
    get: (flightId) => flights[flightId],
    // A replayed ask records the hand-out again; it keeps the answer it has.
    set: (flightId, handout) => {
      const answeredBy = flights[flightId]?.answeredBy;
      write(flightId, answeredBy ? { ...handout, answeredBy } : handout);
    },
    claimAnswer: (flightId, messageId) => {
      const handout = flights[flightId];
      if (!handout) return false;
      if (handout.answeredBy) return handout.answeredBy === messageId;
      write(flightId, { ...handout, answeredBy: messageId });
      return true;
    },
  };
}
