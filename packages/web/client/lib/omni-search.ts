/**
 * Omni search: one field that takes whatever the operator pastes or types.
 * An ID is recognised by its shape (prefix, length, UUID form, a pasted Scout
 * link); a name is matched against agents, hosts and chats. Nothing needs a
 * flag or a special syntax.
 */
import type { MachineRecord } from "@openscout/protocol";
import { EMPTY_SEARCH_FILTERS } from "./knowledge-search.ts";
import type { Agent, Route, SessionEntry } from "./types.ts";
import { conversationDisplayTitle } from "./conversations.ts";

export type OmniIdKind = "flight" | "invocation" | "work" | "session" | "chat" | "agent" | "host";

export type OmniIdCandidate = { kind: OmniIdKind; id: string };

export type OmniResult = {
  key: string;
  kind: OmniIdKind | "transcripts";
  /** The kind as a short word for the row's label column. */
  label: string;
  title: string;
  detail?: string;
  route: Route | null;
  /** Shown when an ID-shaped query resolved to nothing on this host. */
  missing?: boolean;
  /** An ID that still waits on the runtime's answer. */
  pending?: boolean;
};

export const OMNI_KIND_LABEL: Record<OmniResult["kind"], string> = {
  flight: "Flight",
  invocation: "Invocation",
  work: "Work",
  session: "Session",
  chat: "Chat",
  agent: "Agent",
  host: "Host",
  transcripts: "Search",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Runtime ids end in two base36 parts: `mwa5fq78-ijpdng`. */
const RUNTIME_TAIL = /^[a-z0-9]{8}-[a-z0-9]{6}$/;
const HEX64 = /^[0-9a-f]{64}$/i;
const MAC_LIKE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

const PREFIXES: Array<[RegExp, OmniIdKind]> = [
  [/^flt-[a-z0-9-]+$/i, "flight"],
  [/^inv-[a-z0-9-]+$/i, "invocation"],
  [/^work-[a-z0-9-]+$/i, "work"],
  [/^chn-[a-z0-9-]+$/i, "chat"],
  [/^(dm|channel)\.[\w.:@-]+$/i, "chat"],
  [/^mach-[a-z0-9]+$/i, "host"],
  [/^session-[a-z0-9]+-[a-z0-9]+$/i, "agent"],
  [/^sess\.[a-z0-9]+(@[\w.-]+)?$/i, "session"],
];

/** IDs carried by a pasted Scout link: query parameters and path segments. */
function idsFromLink(text: string): string[] {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const key of ["flightId", "invocationId", "workId", "sessionId", "conversationId", "targetAgentId"]) {
    const value = url.searchParams.get(key);
    if (value) ids.push(value);
  }
  for (const segment of url.pathname.split("/")) {
    if (segment) ids.push(decodeURIComponent(segment));
  }
  return ids;
}

/** Every ID the text could be. A bare runtime tail could be any of three. */
export function classifyOmniQuery(raw: string): OmniIdCandidate[] {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return [];
  const tokens = /^https?:\/\//i.test(text) ? idsFromLink(text) : [text];
  const out: OmniIdCandidate[] = [];
  const seen = new Set<string>();
  const add = (kind: OmniIdKind, id: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, id });
  };
  for (const token of tokens) {
    const prefixed = PREFIXES.find(([pattern]) => pattern.test(token));
    if (prefixed) {
      add(prefixed[1], token);
    } else if (UUID.test(token)) {
      add("session", token.toLowerCase());
    } else if (HEX64.test(token)) {
      add("invocation", `inv-request-${token.toLowerCase()}`);
    } else if (RUNTIME_TAIL.test(token)) {
      add("flight", `flt-${token}`);
      add("work", `work-${token}`);
      add("agent", `session-${token}`);
    }
  }
  return out;
}

export function routeForId(candidate: OmniIdCandidate): Route {
  switch (candidate.kind) {
    case "flight": return { view: "follow", flightId: candidate.id };
    case "invocation": return { view: "follow", invocationId: candidate.id };
    case "work": return { view: "work", workId: candidate.id };
    case "session": return { view: "sessions", sessionId: candidate.id };
    case "chat": return { view: "messages", conversationId: candidate.id };
    case "agent": return { view: "agents-v2", agentId: candidate.id };
    case "host": return { view: "mesh", machineId: candidate.id };
  }
}

export function transcriptsResult(query: string): OmniResult {
  const text = query.trim();
  return {
    key: "transcripts",
    kind: "transcripts",
    label: OMNI_KIND_LABEL.transcripts,
    title: `Search transcripts for “${text}”`,
    route: { view: "search", filters: { ...EMPTY_SEARCH_FILTERS, query: text } },
  };
}

/** 0 is no match; higher is better. Exact, then prefix, then word start, then anywhere. */
export function matchScore(query: string, ...fields: Array<string | null | undefined>): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let best = 0;
  for (const field of fields) {
    const value = field?.trim().toLowerCase();
    if (!value) continue;
    if (value === q) return 4;
    if (value.startsWith(q)) best = Math.max(best, 3);
    else if (value.split(/[\s._/@:-]+/).some((word) => word.startsWith(q))) best = Math.max(best, 2);
    else if (q.length >= 3 && value.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

function top<T>(items: T[], score: (item: T) => number, limit: number): T[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function nameResults(
  query: string,
  sources: { agents: Agent[]; machines: MachineRecord[]; chats: SessionEntry[] },
): OmniResult[] {
  const q = query.trim();
  if (q.length < 2) return [];
  // An agent id carries its project and host, so it counts only from its start.
  const idStart = (id: string) => (id.toLowerCase().startsWith(q.toLowerCase()) ? 3 : 0);
  const agents = top(sources.agents, (a) => Math.max(matchScore(q, a.name, a.handle), idStart(a.id)), 5)
    .map((agent): OmniResult => ({
      key: `agent:${agent.id}`,
      kind: "agent",
      label: OMNI_KIND_LABEL.agent,
      title: agent.name,
      detail: [agent.harness, agent.project].filter(Boolean).join(", ") || agent.id,
      route: { view: "agents-v2", agentId: agent.id },
    }));
  const hosts = top(
    sources.machines.filter((m) => q.includes(":") || !MAC_LIKE.test(m.name)),
    (m) => matchScore(q, m.displayName, m.name, m.id, m.scoutNodeId),
    3,
  ).map((machine): OmniResult => ({
    key: `host:${machine.id}`,
    kind: "host",
    label: OMNI_KIND_LABEL.host,
    title: machine.displayName?.trim() || machine.name,
    detail: machine.isSelf ? "This host" : machine.scoutNodeId ?? machine.id,
    route: { view: "mesh", machineId: machine.id },
  }));
  const chats = top(sources.chats, (s) => matchScore(q, conversationDisplayTitle(s), s.agentName, s.id), 5)
    .map((chat): OmniResult => ({
      key: `chat:${chat.id}`,
      kind: "chat",
      label: OMNI_KIND_LABEL.chat,
      title: conversationDisplayTitle(chat),
      detail: chat.remoteMachineName ? `On ${chat.remoteMachineName}` : chat.agentName ?? undefined,
      route: { view: "messages", conversationId: chat.id },
    }));
  return [...agents, ...hosts, ...chats];
}
