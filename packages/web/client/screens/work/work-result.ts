import type { WorkDetail } from "../../lib/types.ts";
import { parseWorkResult, type ResultLink } from "../../../shared/work-result-text.ts";

export { parseWorkResult, type ResultLink };

/**
 * The agent's hand-back, read out of its final reply: where the work is
 * (links), what it checked, and what it left for you to try. The reply text
 * stays the source; this only lifts out what the operator acts on.
 */

export type WorkResult = {
  text: string;
  at: number;
  actorName: string | null;
  links: ResultLink[];
  /** What the agent left unchecked, or asks you to try. */
  toTry: string[];
  /** Tests and checks the agent says it ran. */
  checks: string[];
};

/** The owner's newest message on the work item: its final reply when the run is done. */
export function finalReply(detail: WorkDetail): { text: string; at: number; actorName: string | null } | null {
  const owner = detail.ownerId;
  if (!owner) return null;
  let best: { text: string; at: number; actorName: string | null } | null = null;
  for (const item of detail.timeline) {
    if (item.kind !== "message" || item.actorId !== owner) continue;
    const text = item.summary?.trim();
    if (!text) continue;
    if (!best || item.at > best.at) best = { text, at: item.at, actorName: item.actorName };
  }
  return best;
}

export function workResult(detail: WorkDetail): WorkResult | null {
  const reply = finalReply(detail);
  if (!reply) return null;
  return { ...reply, ...parseWorkResult(reply.text) };
}

