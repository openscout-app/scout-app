/**
 * Automatic board frames: what the runtime already records for a scope,
 * projected into frames. Nothing here is stored; every read projects again.
 *
 * Pure module over the web API's own types, so the client can project what
 * it fetched and tests can project fixtures.
 */

import type { WebFlight, WebWorkDetailResponse, WebWorkItem, WebWorkTimelineItem } from "./api/web.ts";
import type { WorkMaterial } from "./api/work-materials.ts";
import { revisionOf, UNKNOWN_LAYER, type BoardFrame } from "./boards.ts";

/** Most frames one lane shows; the newest win. */
export const MAX_FRAMES_PER_SOURCE = 80;

const clip = (s: string | null | undefined, max = 280): string | null => {
  const t = s?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function workFrame(item: WebWorkItem): BoardFrame {
  const at = item.lastMeaningfulAt || item.updatedAt || item.createdAt;
  return {
    key: `work:${item.id}`,
    kind: "work",
    layer: item.ownerId || UNKNOWN_LAYER,
    title: clip(item.title, 120) ?? item.id,
    summary: clip(item.lastMeaningfulSummary ?? item.summary),
    at,
    state: item.state,
    ref: { workId: item.id, ...(item.conversationId ? { conversationId: item.conversationId } : {}) },
    revision: revisionOf(item.state, at),
  };
}

export function flightFrame(flight: WebFlight): BoardFrame {
  const at = flight.completedAt ?? flight.startedAt ?? 0;
  const who = flight.agentName || flight.agentId;
  return {
    key: `flight:${flight.id}`,
    kind: "flight",
    layer: flight.agentId || UNKNOWN_LAYER,
    title: clip(flight.summary?.split("\n")[0], 120) ?? `Ask to ${who}`,
    summary: clip(flight.summary),
    at,
    state: flight.state,
    ref: {
      flightId: flight.id,
      agentId: flight.agentId,
      ...(flight.conversationId ? { conversationId: flight.conversationId } : {}),
    },
    revision: revisionOf(flight.state, at),
  };
}

/** Messages only: a work timeline's flight entries duplicate its flights. */
export function messageFrame(item: WebWorkTimelineItem): BoardFrame | null {
  if (item.kind !== "message") return null;
  const body = clip(item.summary) ?? clip(item.title);
  if (!body) return null;
  const key = item.messageId ?? item.id;
  return {
    key: `message:${key}`,
    kind: "message",
    layer: item.actorId || UNKNOWN_LAYER,
    title: clip(item.title, 120) ?? clip(body.split("\n")[0], 120) ?? "Message",
    summary: body,
    at: item.at,
    state: item.detailKind,
    ref: {
      messageId: key,
      ...(item.conversationId ? { conversationId: item.conversationId } : {}),
      ...(item.actorId ? { agentId: item.actorId } : {}),
    },
    // A message does not change after it is sent.
    revision: `message@${item.at}`,
  };
}

/**
 * A file the work touched. Materials carry no time of their own, so they
 * sort with the work item; their revision is the file's status and diff.
 */
export function materialFrame(material: WorkMaterial, workId: string, at: number): BoardFrame {
  const diff = material.diffStat?.inflight ?? material.diffStat?.branch;
  const stat = diff ? `+${diff.additions} −${diff.deletions}` : null;
  const name = material.path.split("/").filter(Boolean).pop() ?? material.path;
  return {
    key: `material:${workId}:${material.path}`,
    kind: "material",
    layer: material.agentId || UNKNOWN_LAYER,
    title: name,
    summary: [material.path, stat].filter(Boolean).join(" · "),
    at,
    state: material.status,
    ref: { workId, path: material.path, ...(material.agentId ? { agentId: material.agentId } : {}) },
    revision: `${material.status}:${stat ?? "-"}`,
  };
}

function newest(frames: BoardFrame[], max = MAX_FRAMES_PER_SOURCE): BoardFrame[] {
  return [...frames].sort((a, b) => b.at - a.at).slice(0, max);
}

function dedupe(frames: BoardFrame[]): BoardFrame[] {
  const byKey = new Map<string, BoardFrame>();
  for (const f of frames) {
    const prev = byKey.get(f.key);
    if (!prev || f.at > prev.at) byKey.set(f.key, f);
  }
  return [...byKey.values()];
}

/** A work item's board: its child work, flights, messages and files. */
export function projectWork(detail: WebWorkDetailResponse): BoardFrame[] {
  const at = detail.lastMeaningfulAt || detail.updatedAt;
  const frames: BoardFrame[] = [
    ...detail.childWork.map(workFrame),
    ...newest(detail.allFlights.map(flightFrame)),
    ...newest(detail.timeline.map(messageFrame).filter((f): f is BoardFrame => f !== null)),
    ...(detail.inventory?.materials ?? []).slice(0, MAX_FRAMES_PER_SOURCE).map((m) => materialFrame(m, detail.id, at)),
  ];
  return dedupe(frames);
}

/** An agent's board: the work it owns and the asks it ran. */
export function projectAgent(agentId: string, work: readonly WebWorkItem[], flights: readonly WebFlight[]): BoardFrame[] {
  return dedupe([
    ...newest(work.map(workFrame)),
    ...newest(flights.filter((f) => f.agentId === agentId).map(flightFrame)),
  ]);
}

/** A project's board: the work and asks of the agents that live in it. */
export function projectProject(work: readonly WebWorkItem[], flights: readonly WebFlight[]): BoardFrame[] {
  return dedupe([...newest(work.map(workFrame)), ...newest(flights.map(flightFrame), MAX_FRAMES_PER_SOURCE * 2)]);
}

/**
 * The runtime writes a flight's summary with the agent's raw id first
 * ("session-mvpvfq5m-y3dwbj replied."). Lead with the layer's name instead,
 * so a frame reads the same as the lane it sits in.
 */
export function nameFrames(frames: readonly BoardFrame[], names: ReadonlyMap<string, string>): BoardFrame[] {
  return frames.map((frame) => {
    const name = names.get(frame.layer);
    if (!name || name === frame.layer) return frame;
    const lead = (s: string | null) => (s?.startsWith(frame.layer) ? name + s.slice(frame.layer.length) : s);
    const title = lead(frame.title) ?? frame.title;
    const summary = lead(frame.summary);
    return title === frame.title && summary === frame.summary ? frame : { ...frame, title, summary };
  });
}
