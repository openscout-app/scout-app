/**
 * What the rail shows under and beside a machine.
 *
 * Pure on purpose: this is where the Network page decides whose agents belong
 * to which machine, and that decision is the one #906 got wrong. It is testable
 * without a DOM.
 */

import { isAgentBusy, normalizeAgentState } from "../../lib/agent-state.ts";
import { agentSeenRecently, rosterPresentation } from "../../lib/network-reading.ts";
import { timeAgoWithSuffix } from "../../lib/time.ts";
import type { AgentStateToken } from "../../lib/mesh-view-store.ts";
import { bucketAgentsByMachine, type MachineBucket } from "../../lib/mesh-buckets.ts";
import {
  summarizeNodeReach,
  type MeshNodeStateView,
} from "../../lib/mesh-node-state.ts";
import type { Agent, MeshStatus } from "../../lib/types.ts";

export type MachineChild = {
  key: string;
  name: string;
  meta?: string;
  tone: AgentStateToken | "neutral";
  title: string;
  /** Only local agents can be opened; a remote roster row is a reading, not a handle. */
  agent: Agent | null;
  selectId: string | null;
};

function recencyKey(a: Agent): number {
  return a.updatedAt ?? a.createdAt ?? 0;
}

/**
 * What the rail lists under a machine.
 *
 * For this host the shared agent roster is the truth. For every other machine
 * it is not: those rows come from the local `/api/agents` response, which is
 * capped, filtered, and shared with other screens — that is what made a remote
 * card appear and then vanish. Remote children come from what the node itself
 * reported, and stay absent until it reports.
 */
export function machineChildren(
  bucket: MachineBucket,
  view: MeshNodeStateView | null,
  now = Date.now(),
): MachineChild[] {
  if (bucket.kind === "this") {
    return [...bucket.agents]
      .sort((x, y) => recencyKey(y) - recencyKey(x))
      .map((a) => {
        const seen = a.updatedAt ?? a.createdAt ?? null;
        const live = agentSeenRecently(typeof seen === "number" ? seen : null, now);
        const age = seen ? timeAgoWithSuffix(seen, now) : "";
        return {
          key: a.id,
          name: a.name,
          meta: live ? undefined : (age || "not seen"),
          tone: live ? normalizeAgentState(a.state) : "neutral",
          title: live ? a.name : `${a.name} — ${age || "not seen"}`,
          agent: a,
          selectId: a.id,
        };
      });
  }
  if (!view || view.roster.length === 0) return [];
  return view.roster.map((a) => {
    const presented = rosterPresentation(a, now);
    return {
      key: a.id,
      name: a.title,
      meta: presented.meta,
      tone: presented.tone,
      title: a.projectRoot ? `${a.title} — ${a.projectRoot}` : a.title,
      agent: null,
      selectId: null,
    };
  });
}

/**
 * The number beside a machine.
 *
 * Counts appear only once that machine has reported them. Before then the row
 * says what we actually know — "not checked" — because a dash next to an
 * online machine reads as "nothing here", which is a claim no one has made.
 */
export function machineRowMeta(
  bucket: MachineBucket,
  view: MeshNodeStateView | null,
  loading: boolean,
): string {
  const workload = view?.workload ?? null;
  if (workload) {
    const counts = workload.working === null
      ? `${workload.total}`
      : `${workload.working}/${workload.total}`;
    return view?.stale ? `${counts} · last known` : counts;
  }
  if (loading) return "checking…";
  if (bucket.kind === "this" && bucket.agents.length > 0) {
    return `${bucket.agents.filter((a) => isAgentBusy(a.state)).length}/${bucket.agents.length}`;
  }
  return summarizeNodeReach(view).label.toLowerCase();
}

/**
 * The panel's sentence when the names under a machine are a slice of a
 * larger census. A complete report says nothing here.
 */
/**
 * Recent work on a machine, as the machine reported it.
 *
 * The sentence is the work summary. A row with no summary is only an agent
 * name, and the agent list already carries those.
 */
export function machineRuns(view: MeshNodeStateView | null): MachineChild[] {
  const items = view?.work?.items ?? [];
  const rows: MachineChild[] = [];
  for (const item of items) {
    const summary = item.summary?.trim();
    if (!summary) continue;
    rows.push({
      key: item.id,
      name: summary,
      meta: item.state,
      tone: item.state === "running" || item.state === "working" ? "in_turn" : "neutral",
      title: summary,
      agent: null,
      selectId: null,
    });
  }
  return rows;
}

export function machineRunLimitNote(view: MeshNodeStateView | null): string | null {
  const work = view?.work;
  if (!work?.truncated) return null;
  const shown = work.items.filter((item) => item.summary?.trim()).length;
  if (shown <= 0 || shown >= work.total) return null;
  return `Showing the first ${shown} of ${work.total}.`;
}

export type MachineOpenList = {
  rows: MachineChild[];
  limitNote: string | null;
  /** Runs are recent work. Agents are who is registered. */
  kind: "runs" | "agents";
};

/**
 * What an opened remote machine lists.
 *
 * Recent work comes first, because the roster is names. This host keeps its
 * own agents: those rows open, and its work is the same list the panel shows.
 */
export function machineOpenRows(
  bucket: MachineBucket,
  view: MeshNodeStateView | null,
  now = Date.now(),
): MachineOpenList {
  if (bucket.kind !== "this") {
    const runs = machineRuns(view);
    if (runs.length > 0) return { rows: runs, limitNote: machineRunLimitNote(view), kind: "runs" };
  }
  return {
    rows: machineChildren(bucket, view, now),
    limitNote: bucket.kind === "this" ? null : machineRosterLimitNote(view),
    kind: "agents",
  };
}

export function machineRosterLimitNote(view: MeshNodeStateView | null): string | null {
  const workload = view?.workload;
  if (!view || !workload?.truncated) return null;
  const shown = view.roster.length;
  if (shown <= 0 || shown >= workload.total) return null;
  return `Showing the first ${shown} of ${workload.total}.`;
}

/**
 * One line for an opened host: what the machine attested, not a link to it.
 * A source that cannot attest liveness says nothing here.
 */
export function machineCensusLine(view: MeshNodeStateView | null): string | null {
  const workload = view?.workload;
  if (!view || !workload || workload.working === null) return null;
  const ready = workload.available ?? 0;
  const offline = workload.offline ?? 0;
  const stale = view.stale ? " · last known" : "";
  return `${workload.working} working · ${ready} ready · ${offline} offline${stale}`;
}

/**
 * The line under a machine that has no rows to show yet.
 * This host's roster is already known. Every other machine says it is still
 * being read until that machine has reported.
 */
export function machineContentsNote(
  kind: MachineBucket["kind"],
  reported: boolean,
  loading: boolean,
  failed: boolean,
): string {
  if (kind === "this") return "No agents on this machine";
  if (failed) return "Couldn't read what is running";
  if (loading || !reported) return "Checking what is running…";
  return "Nothing running here";
}


/** Remote map cards are inventory, never the shared cross-screen agent roster.
 * Their reading and detail action are rendered by the card itself. */
export function canvasMachineBuckets(agents: Agent[], mesh: MeshStatus): MachineBucket[] {
  return bucketAgentsByMachine(agents, mesh).map((bucket) =>
    bucket.kind === "this" ? bucket : { ...bucket, agents: [] });
}
