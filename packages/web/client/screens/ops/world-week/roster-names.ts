import type { AgentRosterListResult } from "../../../../shared/api/roster.ts";

/*
 * The runtime's roster codes for the World's agents: an agent reads as
 * "SP 253" (the runtime's drawn label for SP-253). The runtime numbers agents;
 * the World only looks the label up (GET /api/roster) and keeps an agent's own
 * name for anything the roster has not numbered, people included.
 *
 * The World meets an agent by the id its asks carry. That is the roster's
 * agent id, or its bare handle when the runtime keeps the agent qualified by
 * branch and host ("session-x" for "session-x.main.dev-host"); live rows
 * also carry their host in front ("dev-host:session-x").
 */

export type RosterLabels = {
  /** label by the roster's agent id */
  exact: ReadonlyMap<string, string>;
  /** [qualified agent id, label] by each leading part of a qualified id ("a" and "a.main" for "a.main.mini") */
  qualified: ReadonlyMap<string, ReadonlyArray<readonly [string, string]>>;
};

export const NO_ROSTER: RosterLabels = { exact: new Map(), qualified: new Map() };

/** The runtime's list as labels. A gone agent, whose number frees soon, has none. */
export function rosterLabels(list: Pick<AgentRosterListResult, "agents"> | null | undefined): RosterLabels {
  const exact = new Map<string, string>(), qualified = new Map<string, Array<readonly [string, string]>>();
  for (const entry of list?.agents ?? []) {
    if (!entry || entry.goneAt || !entry.agentId || !entry.label) continue;
    exact.set(entry.agentId, entry.label);
    const parts = entry.agentId.split(".");
    for (let k = 1; k < parts.length; k++) {
      const head = parts.slice(0, k).join(".");
      const list = qualified.get(head);
      if (list) list.push([entry.agentId, entry.label]); else qualified.set(head, [[entry.agentId, entry.label]]);
    }
  }
  return { exact, qualified };
}

type ActorLike = { id: string; kind?: string | null; node?: string | null; host?: string | null };

/** The roster label for one actor of the World, or null: a person, or an agent the runtime has not numbered. */
export function rosterLabelFor(actor: ActorLike, labels: RosterLabels): string | null {
  if (!actor?.id || /^(person|human|operator|user)$/i.test(actor.kind || "")) return null;
  const id = actor.host && actor.id.startsWith(actor.host + ":") ? actor.id.slice(actor.host.length + 1) : actor.id;
  const hit = labels.exact.get(id);
  if (hit) return hit;
  const some = labels.qualified.get(id);
  if (!some?.length) return null;
  if (some.length === 1) return some[0][1];
  // more than one branch or host holds that handle: only the one on the actor's own host is it
  const on = [actor.host, actor.node].filter((x): x is string => !!x);
  const mine = some.filter(([q]) => on.some(h => q.endsWith("." + h)));
  return mine.length === 1 ? mine[0][1] : null;
}

/** Spoken candidates and typed names share the same matching path. */
export function rosterNameHit(a: { tag?: string; short: string; full: string; name?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  const code = (a.tag || "").toLowerCase();
  const candidate = a.tag ? `${a.tag} (${a.full})` : a.short;
  return [candidate, a.short, a.full, a.name || ""].some(s => s.toLowerCase().includes(q))
    || (!!code && code.replace(/[ -]/g, "").includes(q.replace(/[ -]/g, "")));
}
