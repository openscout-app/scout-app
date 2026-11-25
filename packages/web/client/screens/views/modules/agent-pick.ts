import type { AgentTab } from "../../../lib/types.ts";

/*
 * Which session each Agent panel off its page is on, so an Agent session
 * panel for the same agent on the same view follows it without either one
 * moving the page. On an agent's page the URL holds the session and both
 * panels read it there instead.
 *
 * An Agent panel publishes under its instance id and withdraws when it goes
 * (removed, replaced, another agent chosen, or the view closes). A reader
 * takes the latest pick for its agent among the panels still there; only one
 * view draws at a time, so those are its siblings. The idiom is
 * search-pick.ts's.
 */

export type AgentPick = {
  /** The Agent panel's instance id. */
  from: string;
  agentId: string;
  /** The session it is on, or null for the agent's active one. */
  sessionId: string | null;
  tab: AgentTab | null;
  /** Order of the last change: the highest is the latest. */
  seq: number;
};

export type AgentPicks = ReturnType<typeof createAgentPicks>;

export function createAgentPicks() {
  const picks = new Map<string, AgentPick>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let rev = 0;

  const emit = () => {
    rev++;
    for (const listener of listeners) listener();
  };

  return {
    /** Set a panel's pick. The same pick again changes nothing, so a re-render never reorders panels. */
    publish(from: string, pick: { agentId: string; sessionId: string | null; tab: AgentTab | null }): void {
      const was = picks.get(from);
      if (was && was.agentId === pick.agentId && was.sessionId === pick.sessionId && was.tab === pick.tab) return;
      picks.set(from, { from, ...pick, seq: ++seq });
      emit();
    },
    /** The panel left the view, or stopped showing an agent. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    /** The latest pick for this agent, or null when no Agent panel on the view shows it. */
    latestFor(agentId: string): AgentPick | null {
      let latest: AgentPick | null = null;
      for (const pick of picks.values()) if (pick.agentId === agentId && (!latest || pick.seq > latest.seq)) latest = pick;
      return latest;
    },
    /** Changes with every publish and withdraw: a snapshot for useSyncExternalStore. */
    version(): number {
      return rev;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The window's picks: every Agent and Agent session panel reads this one. */
export const agentPicks = createAgentPicks();
