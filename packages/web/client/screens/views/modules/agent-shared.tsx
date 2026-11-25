import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { NavigateOptions } from "../../../lib/router.ts";
import type { Agent, Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { agentLabel, resolveSelectedAgent } from "../../agents/model.ts";
import { agentPicks, type AgentPick } from "./agent-pick.ts";
import type { ModuleProps, ModuleScope } from "./contract.ts";

/*
 * What the agent modules share: the Agent scope, the agent a panel shows,
 * and the pick an Agent panel off its page leaves for its siblings.
 * agent-model.ts holds the rules.
 */

/** The page's navigate, which also takes a Back destination (the shell's navigate does). */
export type PageNavigate = (route: Route, options?: NavigateOptions) => void;

export const asPageNavigate = (navigate: ModuleProps["navigate"]) => navigate as PageNavigate;

/** Agent: one agent, or "This page's agent" on an agent's page. Retired agents are left out. */
export function agentScope(allLabel: string): ModuleScope {
  return {
    key: "agent",
    allLabel,
    followsPage: "This page's agent",
    useOptions: () => {
      const { agents } = useScout();
      return useMemo(() => {
        const live = agents.filter((a) => !a.retiredFromFleet);
        return live
          .map((a) => {
            const { name, qualifier } = agentLabel(a, live);
            return { value: a.id, label: qualifier ? `${name} · ${qualifier}` : name };
          })
          .sort((a, b) => a.label.localeCompare(b.label));
      }, [agents]);
    },
  };
}

/** The agent behind an id or alias, from the roster (null while it reads, or when nothing matches). */
export function usePanelAgent(id: string, agents?: Agent[]): Agent | null {
  const scout = useScout();
  const roster = agents ?? scout.agents;
  return useMemo(() => (id ? resolveSelectedAgent(roster, id) : null), [id, roster]);
}

/** Leave this panel's pick for the panels beside it; withdraw it when the panel goes or shows no agent. */
export function usePublishAgentPick(from: string, pick: Omit<AgentPick, "from" | "seq"> | null): void {
  const agentId = pick?.agentId ?? null;
  const sessionId = pick?.sessionId ?? null;
  const tab = pick?.tab ?? null;
  useEffect(() => {
    if (agentId) agentPicks.publish(from, { agentId, sessionId, tab });
    else agentPicks.withdraw(from);
  }, [agentId, from, sessionId, tab]);
  useEffect(() => () => agentPicks.withdraw(from), [from]);
}

/** The latest Agent panel pick for this agent on the view, or null. */
export function useAgentPick(agentId: string | null): AgentPick | null {
  useSyncExternalStore(agentPicks.subscribe, agentPicks.version, agentPicks.version);
  return agentId ? agentPicks.latestFor(agentId) : null;
}
