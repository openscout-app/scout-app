/**
 * What the Network page says about a host, apart from its name.
 *
 * Two clocks, on purpose. Activity is the latest an agent on that host
 * reported, whether or not we asked it. Contact is the latest work we have
 * with it. A ping is neither: it only says whether the host answers right
 * now, which is the useful question for a cloud machine that may already
 * be gone. The mesh heartbeat is not activity.
 */

import type { MachineBucket } from "./mesh-buckets.ts";
import type { MeshNodeStateAgentView, MeshNodeStateView } from "./mesh-node-state.ts";
import { normalizeTimestampMs, timeAgoWithSuffix } from "./time.ts";

/** Past this, a reported "available" agent is a stale record, not someone
 * you can call. A day keeps a quiet afternoon. It does not keep last month. */
export const LIVE_AGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PingState = "reachable" | "unreachable" | "unknown" | "checking";

export type HostReading = {
  activeAt: number | null;
  contactAt: number | null;
  ping: PingState;
  activeLabel: string;
  contactLabel: string;
  pingLabel: string;
};

export function agentSeenRecently(lastSeenAt: number | null, now: number): boolean {
  const seen = normalizeTimestampMs(lastSeenAt);
  if (seen === null) return false;
  const age = now - seen;
  return age >= -60_000 && age <= LIVE_AGENT_WINDOW_MS;
}

function latest(values: Array<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const value of values) {
    const ms = normalizeTimestampMs(value ?? null);
    if (ms === null) continue;
    if (best === null || ms > best) best = ms;
  }
  return best;
}

function pingLabel(ping: PingState): string {
  if (ping === "checking") return "pinging";
  if (ping === "reachable") return "reachable";
  if (ping === "unreachable") return "no answer";
  return "not pinged";
}

/**
 * Activity, our last real contact, and whether a ping currently lands.
 * `loading` is a ping we have already sent.
 */
export function hostReading(
  bucket: MachineBucket,
  view: MeshNodeStateView | null,
  loading: boolean,
  now = Date.now(),
): HostReading {
  // A node's lastSeenAt is the mesh heartbeat, so it says "present", which the
  // ping line already covers. Activity is the newest thing an agent on that
  // host reported, whether or not we were the ones who asked.
  const activeAt = latest([
    ...bucket.agents.map((agent) => agent.updatedAt ?? agent.createdAt ?? null),
    ...(view?.roster ?? []).map((agent) => agent.lastSeenAt),
  ]);
  const contactAt = latest(
    (view?.work?.items ?? []).flatMap((item) => [item.startedAt, item.completedAt]),
  );
  let ping: PingState = "unknown";
  if (loading || view?.checking) ping = "checking";
  else if (bucket.kind === "this" || view?.network === "reachable") ping = "reachable";
  else if (view?.network === "unreachable") ping = "unreachable";
  return {
    activeAt,
    contactAt,
    ping,
    activeLabel: activeAt === null ? "no activity" : timeAgoWithSuffix(activeAt, now),
    contactLabel: contactAt === null ? "no contact" : timeAgoWithSuffix(contactAt, now),
    pingLabel: pingLabel(ping),
  };
}

export type RosterTone = "in_turn" | "neutral";

/**
 * How one reported agent should read on the Network page.
 *
 * A working agent we saw today stays "in a turn". A timestamp older than the
 * live window, including a record that still says available, is just an age.
 * No timestamp is not an age: the peer named a status and did not say when,
 * which is what a reachable endpoint with no start or stop clock looks like.
 * A row with neither a clock nor a status was never attested.
 */
export function rosterPresentation(
  agent: Pick<MeshNodeStateAgentView, "state" | "statusLabel" | "lastSeenAt">,
  now: number,
): { tone: RosterTone; meta: string } {
  const live = agentSeenRecently(agent.lastSeenAt, now);
  if (agent.lastSeenAt !== null && !live) {
    const age = timeAgoWithSuffix(agent.lastSeenAt, now);
    return { tone: "neutral", meta: age || "not seen" };
  }
  const reported = agent.statusLabel?.trim() || "";
  if (agent.state === "working") {
    return { tone: "in_turn", meta: reported || "in a turn" };
  }
  if (live) return { tone: "neutral", meta: reported || "seen" };
  if (reported) return { tone: "neutral", meta: reported };
  if (agent.state) return { tone: "neutral", meta: agent.state };
  return { tone: "neutral", meta: "not seen" };
}
