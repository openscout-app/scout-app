/*
 * How an agent on the desk is drawn (its look, its character, figure or
 * strip) can be set at three levels: this agent, by the id its figure is
 * pinned by (its work, else its session); its project, by the folder name
 * the board shows; and every figure. The most specific level that holds a
 * value wins. Operator chrome, so the values live in this page's storage.
 *
 * Pure functions only; each kind keeps its own store (figure-look.ts,
 * desk-character.ts, desk-form.ts).
 */

export type ScopeLevel = "agent" | "project" | "default";
export const SCOPE_LEVELS: readonly ScopeLevel[] = ["agent", "project", "default"];

/** Values set for one agent (by pin id) and for one project (by name). */
export type ScopeValues<T> = {
  readonly agents: Readonly<Record<string, T>>;
  readonly projects: Readonly<Record<string, T>>;
};

/** Who a value is looked up for: the pin id, and the project it works in when known. */
export type ScopeWho = { id: string; project: string | null };

export function emptyScope<T>(): ScopeValues<T> {
  return { agents: {}, projects: {} };
}

/** The project key: the board's project name, trimmed; null when there is none. */
export function projectKey(project: string | null | undefined): string | null {
  const key = project?.trim();
  return key ? key : null;
}

/** The value set at one level for this agent, or undefined when that level holds none. */
export function scopedAt<T>(values: ScopeValues<T>, level: "agent" | "project", who: ScopeWho): T | undefined {
  if (level === "agent") return Object.hasOwn(values.agents, who.id) ? values.agents[who.id] : undefined;
  return who.project !== null && Object.hasOwn(values.projects, who.project) ? values.projects[who.project] : undefined;
}

/** The agent's own value, else its project's; undefined when neither level holds one. */
export function scopedValue<T>(values: ScopeValues<T>, who: ScopeWho): { value: T; from: "agent" | "project" } | undefined {
  const own = scopedAt(values, "agent", who);
  if (own !== undefined) return { value: own, from: "agent" };
  const project = scopedAt(values, "project", who);
  return project !== undefined ? { value: project, from: "project" } : undefined;
}

/** Set (or with null, clear) one agent's or one project's value. The same object when nothing changes. */
export function withScoped<T>(values: ScopeValues<T>, level: "agent" | "project", key: string, value: T | null): ScopeValues<T> {
  const field = level === "agent" ? "agents" : "projects";
  const map = values[field];
  const has = Object.hasOwn(map, key);
  if (value === null) {
    if (!has) return values;
    const next: Record<string, T> = { ...map };
    delete next[key];
    return { ...values, [field]: next };
  }
  if (has && map[key] === value) return values;
  return { ...values, [field]: { ...map, [key]: value } };
}

/** Forget agents the host no longer pins; projects stay. The same object when nothing is dropped. */
export function keepScopedAgents<T>(values: ScopeValues<T>, ids: Iterable<string>): ScopeValues<T> {
  const keep = new Set(ids);
  if (Object.keys(values.agents).every((id) => keep.has(id))) return values;
  return { ...values, agents: Object.fromEntries(Object.entries(values.agents).filter(([id]) => keep.has(id))) };
}

function readMap<T>(value: unknown, valid: (v: unknown) => v is T): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => Boolean(entry[0]) && valid(entry[1])));
}

/** Stored values; anything unreadable is dropped, never thrown. */
export function parseScopeValues<T>(raw: string | null | undefined, valid: (v: unknown) => v is T): ScopeValues<T> {
  if (!raw) return emptyScope();
  try {
    const value = JSON.parse(raw) as { agents?: unknown; projects?: unknown } | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptyScope();
    return { agents: readMap(value.agents, valid), projects: readMap(value.projects, valid) };
  } catch {
    return emptyScope();
  }
}

/** Where a value an agent shows comes from: a level, or (below the project) the form it landed as, or its character in Agents. */
export type ScopeOrigin = ScopeLevel | "landed" | "app";

const RANK: Record<ScopeOrigin, number> = { agent: 0, project: 1, landed: 2, app: 2, default: 3 };

/** A level's name, the project by its name. */
export function scopeLabel(level: ScopeLevel, project: string | null): string {
  return level === "agent" ? "This agent" : level === "project" ? project ?? "Its project" : "Every figure";
}

/**
 * The quiet note beside a value in Details, editing `level`: what wins over
 * it for this agent, or where the value it inherits comes from. `holds`:
 * this level has a value of its own (it does when it is where the value
 * comes from), which `reset` offers to clear, even under a level that wins
 * over it. Null when there is nothing to say.
 */
export function scopeNote(level: ScopeLevel, from: ScopeOrigin, project: string | null, holds = RANK[from] === RANK[level]): { text: string; reset: boolean } | null {
  const here = RANK[level], there = RANK[from];
  if (there === here) return level === "default" ? null : { text: "", reset: true };
  if (there < here) {
    const wins = from === "agent" ? "this agent's own" : from === "project" ? `${project ?? "its project"}'s` : from === "landed" ? "the form it landed as" : "its character in Agents";
    return { text: `${wins} wins here`, reset: holds && level !== "default" };
  }
  const text = from === "project" ? `from ${project ?? "its project"}` : from === "default" ? "from every figure" : from === "landed" ? "as it landed" : "from Agents";
  return { text, reset: false };
}
