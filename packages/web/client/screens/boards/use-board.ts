import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WebAgent, WebFlight, WebWorkDetailResponse, WebWorkItem } from "../../../shared/api/web.ts";
import { nameFrames, projectAgent, projectProject, projectWork } from "../../../shared/board-projection.ts";
import {
  emptyBoardState,
  OPERATOR_LAYER,
  SHARED_LAYER,
  UNKNOWN_LAYER,
  type BoardEvent,
  type BoardEventInput,
  type BoardFrame,
  type BoardScope,
  type BoardState,
} from "../../../shared/boards.ts";
import { api } from "../../lib/api.ts";
import { canonicalProjectRoot, isTemporaryProjectRoot, readableProjectTitle } from "../agents/project-identity.ts";
import { isBrokerDataEvent, useBrokerEventsRefresh } from "../../lib/sse.ts";

/*
 * A board's two halves: frames projected from the scope's records (refetched
 * when the runtime reports a change) and the board's own events (polled by
 * sequence, folded locally).
 */

import { createBoardEventStream } from "./board-event-stream.ts";

const EVENTS_POLL_MS = 4000;
/** A project board reads this many of its most recently active agents. */
const PROJECT_AGENTS = 8;

export type AgentSummary = Pick<WebAgent, "id" | "definitionId" | "name" | "handle" | "sessionName" | "projectRoot" | "cwd" | "project" | "harness" | "updatedAt">;

export type BoardSources = {
  frames: BoardFrame[];
  /** Display name for each layer id the frames use. */
  names: Map<string, string>;
  /** What the scope is called, once its records are read. */
  scopeLabel: string | null;
};

type Load = { status: "loading" } | { status: "ready"; sources: BoardSources } | { status: "error"; message: string };

/** The project an agent works in, keyed the way the Projects screen keys it. */
export function agentProjectRoot(agent: AgentSummary): string | null {
  const root = canonicalProjectRoot(agent.projectRoot ?? agent.cwd);
  return root && !isTemporaryProjectRoot(root) ? root : null;
}

export function projectTitle(root: string): string {
  return readableProjectTitle(root.split("/").filter(Boolean).pop() ?? root);
}

export function listAgents(): Promise<AgentSummary[]> {
  return api<AgentSummary[]>("/api/agents?detail=summary");
}

/**
 * The agent's code name: its session's name ("demo-app-spinoza-7"), else its
 * handle. A session card's `name` is only its id title-cased.
 */
export function nameOf(agent: AgentSummary): string {
  return agent.sessionName || agent.handle || agent.name || agent.id;
}

/**
 * The id that work items and flights carry for an agent. The summary's `id`
 * is node-qualified (`name.project.host`); records use the definition id.
 */
export function recordIdOf(agent: AgentSummary): string {
  return agent.definitionId || agent.id;
}

function namesFrom(work: readonly WebWorkItem[], flights: readonly WebFlight[], agents: readonly AgentSummary[] = []) {
  const names = new Map<string, string>([
    [SHARED_LAYER, "Shared"],
    [OPERATOR_LAYER, "You"],
    [UNKNOWN_LAYER, "Unattributed"],
  ]);
  for (const a of agents) names.set(recordIdOf(a), nameOf(a));
  for (const f of flights) if (f.agentName && !names.has(f.agentId)) names.set(f.agentId, f.agentName);
  for (const w of work) if (w.ownerId && w.ownerName && !names.has(w.ownerId)) names.set(w.ownerId, w.ownerName);
  return names;
}

async function loadAgentRecords(agentId: string) {
  const id = encodeURIComponent(agentId);
  const [work, flights] = await Promise.all([
    api<WebWorkItem[]>(`/api/work?agentId=${id}&active=false&limit=60`).catch(() => [] as WebWorkItem[]),
    api<WebFlight[]>(`/api/flights?agentId=${id}&active=false`).catch(() => [] as WebFlight[]),
  ]);
  return { work, flights };
}

async function loadSources(scope: BoardScope): Promise<BoardSources> {
  switch (scope.kind) {
    case "work": {
      const detail = await api<WebWorkDetailResponse>(`/api/work/${encodeURIComponent(scope.id)}`);
      const names = namesFrom([detail, ...detail.childWork], detail.allFlights);
      for (const item of detail.timeline) {
        if (item.actorId && item.actorName && !names.has(item.actorId)) names.set(item.actorId, item.actorName);
      }
      for (const a of detail.inventory?.agents ?? []) if (a.name && !names.has(a.id)) names.set(a.id, a.name);
      return { frames: nameFrames(projectWork(detail), names), names, scopeLabel: detail.title };
    }
    case "agent": {
      const [{ work, flights }, agents] = await Promise.all([
        loadAgentRecords(scope.id),
        listAgents().catch(() => [] as AgentSummary[]),
      ]);
      const agent = agents.find((a) => recordIdOf(a) === scope.id);
      const names = namesFrom(work, flights, agents);
      return { frames: nameFrames(projectAgent(scope.id, work, flights), names), names, scopeLabel: agent ? nameOf(agent) : null };
    }
    case "project": {
      const agents = (await listAgents()).filter((a) => agentProjectRoot(a) === scope.id);
      const recent = [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, PROJECT_AGENTS);
      const loaded = await Promise.all(recent.map((a) => loadAgentRecords(recordIdOf(a))));
      const work = loaded.flatMap((l) => l.work);
      const flights = loaded.flatMap((l) => l.flights);
      const names = namesFrom(work, flights, agents);
      return { frames: nameFrames(projectProject(work, flights), names), names, scopeLabel: projectTitle(scope.id) };
    }
  }
}

/** The scope's records as frames, refetched when the runtime reports a change. */
export function useBoardSources(scope: BoardScope | null): Load & { reload: () => void } {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const key = scope ? `${scope.kind}:${scope.id}` : "";
  const generation = useRef(0);

  const reload = useCallback(() => {
    if (!scope) return;
    const mine = ++generation.current;
    loadSources(scope)
      .then((sources) => {
        if (mine === generation.current) setLoad({ status: "ready", sources });
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        // Keep the last good frames on a failed refresh; only a first load shows the error.
        setLoad((prev) =>
          prev.status === "ready" ? prev : { status: "error", message: err instanceof Error ? err.message : String(err) },
        );
      });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoad({ status: "loading" });
    reload();
  }, [reload]);

  useBrokerEventsRefresh(isBrokerDataEvent, reload, 2_000);

  return { ...load, reload };
}

export type BoardEvents = {
  state: BoardState;
  /** Writing, or the last write failed. */
  save: { kind: "saved" } | { kind: "saving" } | { kind: "error"; message: string };
  append: (events: BoardEventInput[]) => Promise<void>;
};

/** The board's own events, polled by sequence and folded. */
export function useBoardEvents(boardId: string): BoardEvents {
  const path = `/api/boards/${encodeURIComponent(boardId)}/events`;
  const stream = useMemo(() => createBoardEventStream({
    read: async (after) => (await api<{ events: BoardEvent[] }>(`${path}?after=${after}`, { signal: AbortSignal.timeout(8_000) })).events,
    write: async (events) => (await api<{ events: BoardEvent[] }>(path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }),
    })).events,
  }), [path]);
  const current = useRef(stream);
  current.current = stream;
  const [snapshot, setSnapshot] = useState({ stream, state: stream.state() });
  const [saving, setSaving] = useState<{ stream: typeof stream; value: BoardEvents["save"] }>({ stream, value: { kind: "saved" } });
  const pending = useRef(0);

  useEffect(() => {
    pending.current = 0;
    const unsubscribe = stream.subscribe((state) => {
      if (current.current === stream) setSnapshot({ stream, state });
    });
    const tick = async () => {
      if (document.hidden || pending.current > 0) return;
      try { await stream.refresh(); } catch { /* Next tick retries from the last contiguous cursor. */ }
    };
    void tick();
    const timer = window.setInterval(tick, EVENTS_POLL_MS);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [stream]);

  const append = useCallback(async (events: BoardEventInput[]) => {
    if (!events.length) return;
    pending.current += 1;
    setSaving({ stream, value: { kind: "saving" } });
    try {
      await stream.append(events);
      if (current.current === stream && pending.current === 1) setSaving({ stream, value: { kind: "saved" } });
    } catch (err) {
      if (current.current === stream) setSaving({ stream, value: { kind: "error", message: err instanceof Error ? err.message : String(err) } });
    } finally {
      if (current.current === stream) pending.current -= 1;
    }
  }, [stream]);

  return {
    state: snapshot.stream === stream ? snapshot.state : emptyBoardState(),
    save: saving.stream === stream ? saving.value : { kind: "saved" },
    append,
  };
}
