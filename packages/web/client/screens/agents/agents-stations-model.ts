import type { Agent, FleetAsk, FleetState, WorkDetail, WorkItem } from "../../lib/types.ts";
import { agentLookup, cleanText, projectLeaf } from "./agents-home-feed-model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Stations — work in progress, one card per piece of work.

   A station is a live work item with everyone working on it. Asks on a
   child work item join their parent's station, so a builder and a reviewer
   on the same change share one card. An ask with no work item is a station
   of one. What the card shows follows what the work touched:

     visual   images it made or changed
     code     code, tests or config
     writing  docs, specs or plans
     talk     nothing yet — the conversation is the work

   Stations keep the order they started in, so a card never moves while you
   read it; one leaves when its last ask ends, and what it made is a post.
   ────────────────────────────────────────────────────────────────────────── */

export type StationKind = "talk" | "code" | "writing" | "visual";

export type StationPlayer = {
  id: string;
  agentId: string;
  agent: string;
  harness: string | null;
  task: string;
  since: number;
  /** Running now: not queued and not held. */
  live: boolean;
  /** What holds the agent, e.g. "Waiting on permission"; null while it runs. */
  waiting: string | null;
  workId: string | null;
  conversationId: string | null;
};

export type Station = {
  id: string;
  /** The work item the card is named after: the parent when asks share one. */
  workId: string | null;
  /** The work item whose materials and talk fill the card: the latest ask's. */
  surfaceWorkId: string | null;
  title: string;
  project: string | null;
  since: number;
  players: StationPlayer[];
};

export type StationLine = { id: string; actor: string; actorId: string | null; text: string; at: number };
export type StationFile = {
  id: string;
  path: string;
  name: string;
  agentId: string | null;
  additions: number;
  deletions: number;
};
export type StationFrame = { id: string; name: string; src: string };

export type StationSurface = {
  kind: StationKind;
  files: StationFile[];
  frames: StationFrame[];
  /** The latest messages, oldest first. */
  lines: StationLine[];
};

const MAX_FILES = 5;
const MAX_FRAMES = 3;
const MAX_LINES = 3;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** The work item ids the active asks name, for one `/api/work?ids=` read. */
export function stationWorkIds(fleet: FleetState | null): string[] {
  const ids = new Set<string>();
  for (const ask of activeAsks(fleet)) if (ask.collaborationRecordId) ids.add(ask.collaborationRecordId);
  return [...ids].sort();
}

function activeAsks(fleet: FleetState | null) {
  return (fleet?.activeAsks ?? []).filter(
    (ask) => ask.status === "working" || ask.status === "queued" || ask.status === "needs_attention",
  );
}

/* A held ask can still read "working": the runtime records the question it
   stopped on (a permission prompt, a question for the operator) as an open
   attention item for the same agent. A question that names its conversation
   holds only the ask in that conversation, so one agent at two stations is
   held only where it asked. */
function heldBy(fleet: FleetState | null, ask: FleetAsk): string | null {
  const item = (fleet?.needsAttention ?? []).find(
    (a) =>
      a.kind === "question" &&
      a.state === "open" &&
      a.agentId === ask.agentId &&
      (!a.conversationId || a.conversationId === ask.conversationId),
  );
  if (!item && ask.status !== "needs_attention") return null;
  const said = `${item?.title ?? ""} ${ask.summary ?? ""}`;
  return /permission/i.test(said) ? "Waiting on permission" : "Waiting on an answer";
}

/**
 * The work items to group by: what the latest read returned, over what
 * earlier reads did, kept to the ids still asked about. `known` is the
 * caller's memory across reads; a new ids= path starts empty, and without
 * it grouped stations would split until that read lands.
 */
export function carryItems(known: Map<string, WorkItem>, read: WorkItem[] | null, ids: string[]): WorkItem[] {
  for (const item of read ?? []) known.set(item.id, item);
  const wanted = new Set(ids);
  for (const id of [...known.keys()]) if (!wanted.has(id)) known.delete(id);
  return [...known.values()];
}

/* The station a work item belongs to: its topmost known ancestor. An
   ancestor that was not read stops the climb at its id and title. */
function stationOf(item: WorkItem, items: Map<string, WorkItem>): { id: string; title: string | null } {
  let current = item;
  for (let depth = 0; depth < 8 && current.parentId; depth += 1) {
    const parent = items.get(current.parentId);
    if (!parent) return { id: current.parentId, title: current.parentTitle ?? null };
    current = parent;
  }
  return { id: current.id, title: current.title ?? null };
}

export function buildStations({
  fleet,
  agents,
  workItems = [],
  agentId = null,
  seen,
}: {
  fleet: FleetState | null;
  agents: Agent[];
  /** The work items the asks name (`/api/work?ids=…`), for parents and titles. */
  workItems?: WorkItem[];
  /** Only stations this agent works at. */
  agentId?: string | null;
  /**
   * When each station and player was first seen, kept by the caller across
   * refreshes: cards hold their place when the earliest ask ends, and a
   * queued ask does not move as it updates.
   */
  seen?: Map<string, number>;
}): Station[] {
  const lookup = agentLookup(agents);
  const items = new Map(workItems.map((item) => [item.id, item]));
  const stations = new Map<string, Station>();

  for (const ask of activeAsks(fleet)) {
    const item = ask.collaborationRecordId ? items.get(ask.collaborationRecordId) ?? null : null;
    const home = item ? stationOf(item, items) : null;
    const workId = home?.id ?? ask.collaborationRecordId ?? null;
    const key = workId ?? `ask:${ask.invocationId}`;
    const known = lookup(ask.agentId, ask.agentName);
    const title = cleanText(home?.title) || headline(ask.task) || "Untitled work";
    const waiting = heldBy(fleet, ask);
    const player: StationPlayer = {
      id: ask.invocationId,
      agentId: ask.agentId,
      agent: ask.agentName ?? known?.name ?? "agent",
      harness: ask.harness ?? known?.harness ?? null,
      task: proseText(ask.task, title),
      since: pinned(seen, `player:${ask.invocationId}`, ask.startedAt ?? ask.acknowledgedAt ?? ask.updatedAt),
      live: ask.status === "working" && !waiting,
      waiting,
      workId: ask.collaborationRecordId ?? null,
      conversationId: ask.conversationId,
    };
    const station = stations.get(key);
    if (station) {
      station.players.push(player);
      station.since = Math.min(station.since, player.since);
      continue;
    }
    stations.set(key, {
      id: key,
      workId,
      surfaceWorkId: null,
      title,
      project: known?.project ?? projectLeaf(known?.projectRoot) ?? null,
      since: player.since,
      players: [player],
    });
  }

  for (const station of stations.values()) station.since = pinned(seen, `station:${station.id}`, station.since);
  if (seen) {
    const live = new Set<string>();
    for (const station of stations.values()) {
      live.add(`station:${station.id}`);
      for (const p of station.players) live.add(`player:${p.id}`);
    }
    for (const key of [...seen.keys()]) if (!live.has(key)) seen.delete(key);
  }

  return [...stations.values()]
    .filter((station) => !agentId || station.players.some((p) => p.agentId === agentId))
    .map((station) => {
      const players = [...station.players].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
      const latest = [...players].reverse().find((p) => p.workId);
      return { ...station, players, surfaceWorkId: latest?.workId ?? station.workId };
    })
    .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
}

function pinned(seen: Map<string, number> | undefined, key: string, at: number): number {
  if (!seen) return at;
  const first = seen.get(key);
  if (first !== undefined) return first;
  seen.set(key, at);
  return at;
}

/** What the card shows, from what the work touched and said. */
export function stationSurface(
  detail: WorkDetail | null,
  workId: string | null,
  title?: string | null,
): StationSurface {
  const materials = detail?.inventory?.materials ?? [];
  const frames: StationFrame[] = workId
    ? materials
      .filter((m) => m.status !== "deleted" && IMAGE.test(m.path))
      .slice(0, MAX_FRAMES)
      .map((m) => ({
        id: m.id,
        name: fileName(m.path),
        src: `/api/work/${encodeURIComponent(workId)}/material/raw?materialId=${encodeURIComponent(m.id)}`,
      }))
    : [];
  const code = materials.filter((m) => m.kind === "code" || m.kind === "test" || m.kind === "config");
  const docs = materials.filter((m) => m.kind === "doc" || m.kind === "spec" || m.kind === "plan");
  const kind: StationKind = frames.length
    ? "visual"
    : code.length && code.length >= docs.length
      ? "code"
      : docs.length
        ? "writing"
        : "talk";
  const touched = kind === "code" ? code : kind === "writing" ? docs : [];
  const files = touched
    .map((m) => {
      const branch = m.diffStat?.branch;
      const inflight = m.diffStat?.inflight;
      return {
        id: m.id,
        path: m.path,
        name: fileName(m.path),
        agentId: m.agentId,
        additions: (branch?.additions ?? 0) + (inflight?.additions ?? 0),
        deletions: (branch?.deletions ?? 0) + (inflight?.deletions ?? 0),
      };
    })
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);
  const lines = (detail?.timeline ?? [])
    .filter((t) => t.kind === "message" && (t.summary || t.title))
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_LINES)
    .map((t) => ({
      id: t.id,
      actor: t.actorName ?? "agent",
      actorId: t.actorId,
      text: proseText(t.summary ?? t.title, title),
      at: t.at,
    }));
  return { kind, files, frames, lines };
}

/** A brief's heading or first sentence: what the work is called before it has a title. */
/* A brief reads as prose on a card: heading marks and code ticks go, and a
   heading that only repeats the station's title is dropped. */
export function proseText(raw: string | null | undefined, title?: string | null): string {
  const same = (line: string) => !!title && line.toLowerCase() === title.trim().toLowerCase();
  const lines = (raw ?? "")
    .split("\n")
    .map((l) => l.trim().replace(/^#+\s*/, "").replace(/`/g, ""))
    .filter(Boolean);
  const body = lines.filter((l) => !same(l));
  return cleanText((body.length ? body : lines).join(" "));
}

export function headline(raw: string | null | undefined): string {
  const line = (raw ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const text = cleanText(line.replace(/^#+\s*/, ""));
  return text.split(/(?<=[.!?])\s/)[0]!.trim();
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

const EXCERPT_MAX = 320;

/** A document's first prose, without front matter, headings or markup. */
export function opening(content: string): string {
  const body = content.replace(/\r\n?/g, "\n").replace(/^\uFEFF?---\n[\s\S]*?\n---\n/, "");
  const prose = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^(#|```|\||<|!\[|[-*] )/.test(block))
    .join(" ")
    .replace(/[*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return prose.length > EXCERPT_MAX ? `${prose.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : prose;
}
