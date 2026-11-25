import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionalFlag } from "hudsonkit/flags";

import { bestFleetAskForAgentIds } from "../../lib/fleet-active-asks.ts";
import { NO_PROJECT_LABEL, projectLabelForAgent } from "../../lib/sessions-view.ts";
import type { FleetAsk, Route } from "../../lib/types.ts";
import { useAgentFlowMessages } from "../../lib/use-agent-flow.ts";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { useBrowserLocation } from "../../lib/router.ts";
import { useScout } from "../../scout/Provider.tsx";
import { CommsFlowView } from "./CommsFlowGraph.tsx";
import { mapIdentities } from "./CommsFlowMap.tsx";
import { flowTasks } from "./comms-flow-map.ts";
import type { DeckCard } from "./comms-deck.ts";
import { useBeside, useStage } from "./use-beside.ts";
import { buildCommsFlow, flowCanonicalId, type FlowSourceMessage } from "../../lib/comms-flow.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { AgentPageHeader, type ConversationHeadReport } from "./ConversationHeader.tsx";
import { buildAgentMasterModel } from "./agent-master-model.ts";
import "./agent-master.css";

type AgentView = "chat" | "flow" | "map" | "canvas";

const AGENT_VIEWS: { id: AgentView; label: string; hint: string }[] = [
  { id: "chat", label: "Chat", hint: "The conversation on the stage" },
  { id: "flow", label: "Flow", hint: "Who asked whom across everything this agent is in" },
  { id: "map", label: "Map", hint: "Who this agent exchanges work with, and on which model" },
  { id: "canvas", label: "Canvas", hint: "The same window laid out left to right, with nobody folded away" },
];

/** Map and Canvas are experimental: drawn only under the surface.chat-drawings flag. */
const EXPERIMENTAL_AGENT_VIEWS: ReadonlySet<AgentView> = new Set(["map", "canvas"]);

/**
 * The agent's neighbourhood as a flow: every conversation it is mixed up in.
 */
function useAgentFlow(agentId: string, enabled: boolean) {
  const { messages, loading, error } = useAgentFlowMessages(agentId, enabled);
  const { passes, flights } = useMemo(() => {
    const source: FlowSourceMessage[] = messages
      // A message with no actor has no sender to draw it from.
      .filter((message): message is typeof message & { actorId: string } => Boolean(message.actorId))
      .map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        actorId: message.actorId,
        actorName: message.actorName,
        body: message.body,
        createdAt: message.createdAt,
        class: message.class,
        metadata: message.metadata ?? null,
        replyToMessageId: message.replyToMessageId ?? null,
      }));
    return buildCommsFlow(source);
  }, [messages]);
  const tasks = useMemo(() => flowTasks(passes, flights), [passes, flights]);
  return { passes, flights, tasks, loading, error, count: messages.length };
}

/**
 * Agent surface — ONE relationship surface per agent, with one stage.
 *
 * The stage is the conversation the route names: the agent's own conversation
 * by default, or the thread `?thread=` asks for. One header sits over it
 * (AgentPageHeader); the Chats list beside the page switches conversations.
 * Flow (and, under the surface.chat-drawings flag, Map and Canvas) draw the
 * agent's whole neighbourhood in place of the stage, and a click inside a
 * drawing selects — one thing, shown in a panel docked to the drawing —
 * rather than opening anything.
 *
 * Keeping a conversation beside the stage is a separate, deliberate act: the
 * Chats list's context menu, or a drawing's panel. Those columns are the
 * Comms page's, not this surface's (MessagesScreen draws them), so they stay
 * put when the stage changes to another agent.
 *
 * Route: /messages/agent/<id>?thread=.
 */
export function AgentMasterScreen({
  agentId,
  threadId,
  machineId,
  navigate,
}: {
  agentId: string;
  threadId?: string;
  machineId?: string;
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  const location = useBrowserLocation();
  const beside = useBeside();
  const toStage = useStage(navigate, machineId);
  // Which drawing is on screen, seeded from the URL so a Map can be linked to.
  const [view, setView] = useState<AgentView>(() => {
    if (typeof window === "undefined") return "chat";
    const asked = new URLSearchParams(window.location.search).get("view");
    return asked === "flow" || asked === "map" || asked === "canvas" ? asked : "chat";
  });
  // The one thing selected in the drawing. Local to this surface and to the
  // drawing: it is what you are looking at, not where you are.
  const [selected, setSelected] = useState<DeckCard | null>(null);
  // What the conversation on the stage reported about itself, for the header.
  // It outlives a switch to a drawing (the stage unmounts then), and goes with
  // the stage.
  const [head, setHead] = useState<ConversationHeadReport | null>(null);
  const drawingsEnabled = useOptionalFlag("surface.chat-drawings", false);
  const views = drawingsEnabled
    ? AGENT_VIEWS
    : AGENT_VIEWS.filter((option) => !EXPERIMENTAL_AGENT_VIEWS.has(option.id));
  // A linked or remembered view that is now hidden falls back to Chat.
  useEffect(() => {
    if (!drawingsEnabled && EXPERIMENTAL_AGENT_VIEWS.has(view)) setView("chat");
  }, [drawingsEnabled, view]);

  // Navigation lands on the conversation. When the route brings a different
  // stage — another agent, another thread — the drawing gives way to Chat and
  // the selection is dropped; a drawing is something you switch to from there.
  // A link straight to a drawing still opens on it, since that is the first
  // stage, not a change of stage.
  const stageKey = `${agentId}\u0000${threadId ?? ""}`;
  const lastStage = useRef(stageKey);
  useEffect(() => {
    if (lastStage.current === stageKey) return;
    lastStage.current = stageKey;
    setView("chat");
    setSelected(null);
    setHead(null);
  }, [stageKey]);
  // Another drawing is another set of things to click.
  useEffect(() => setSelected(null), [view]);

  // `view` is route-local view state: it says what you are looking at, not
  // which page you are on. So it rides the URL by replaceState — never pushing
  // a history entry — rather than living in the Route.
  //
  // The router owns the canonical URL and strips params it does not know, so
  // this watches the location as well as the state and puts it back. A bare
  // replaceState does not go through the location store, so restoring it
  // cannot re-trigger this; only a real navigation can.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const want = view === "chat" ? "" : view;
    if ((url.searchParams.get("view") ?? "") === want) return;
    if (want) url.searchParams.set("view", want);
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [view, location.searchStr]);

  const { sessions, loading } = useConversationList();
  const activeAsks = useFleetActiveAsks();
  const {
    agent,
    memberAgentIds,
    sessions: agentSessions,
    master,
  } = useMemo(
    () => buildAgentMasterModel({ agentId, threadId, machineId, agents, sessions }),
    [agentId, threadId, machineId, agents, sessions],
  );

  const ask = useMemo(
    () => bestFleetAskForAgentIds(activeAsks, memberAgentIds),
    [activeAsks, memberAgentIds],
  );

  // The drawings read the agent's window; the stage does not need it.
  const flow = useAgentFlow(agentId, view !== "chat");
  const identities = useMemo(
    () => mapIdentities(agentSessions.flatMap((entry) => entry.participants ?? [])),
    [agentSessions],
  );

  // What is on the stage: the thread the route asks for, else the agent's own
  // conversation. The Chats list beside the page switches between them.
  const stageId = threadId ?? master?.id ?? null;

  const name = agent?.name
    ?? agentSessions[0]?.agentName
    ?? agentId.split(".")[0]
    ?? agentId;
  const projectLabel = (() => {
    const label = projectLabelForAgent(agent);
    return label === NO_PROJECT_LABEL ? null : label;
  })();
  const activity = askActivity(ask);
  const harness = agent?.harness ?? master?.harness ?? null;
  const subline = [projectLabel, agent?.branch ?? null].filter(Boolean).join(" · ") || null;
  // The list's entry for the agent's own conversation fills what the stage's
  // report lacks while its metadata loads (or when that read fails).
  const listEntry = master && head && master.id === head.conversationId ? master : null;
  const shownHead = head && listEntry
    ? {
        ...head,
        model: head.model ?? listEntry.model ?? null,
        hostName: head.hostName ?? listEntry.executionNodeName ?? null,
        workspaceRoot: head.workspaceRoot ?? listEntry.workspaceRoot ?? null,
        branch: head.branch ?? listEntry.currentBranch ?? null,
      }
    : head;

  return (
    <>
      <AgentPageHeader
        name={name}
        harness={harness}
        head={shownHead}
        fallbackState={activity?.tone === "working" ? "working" : activity?.tone === "attention" ? "waiting" : null}
        subline={subline}
        views={views}
        view={view}
        onChangeView={(next) => setView(next as AgentView)}
        onOpenSession={head?.sessionRoute ? () => navigate(head.sessionRoute!) : undefined}
      />

      <div className="amv-feed">
        {view !== "chat" ? (
          flow.error ? (
            <div className="amv-empty">{flow.error}</div>
          ) : flow.loading && flow.count === 0 ? (
            <div className="amv-empty">Loading this agent&rsquo;s work…</div>
          ) : flow.count === 0 ? (
            <div className="amv-empty">Nothing has passed through this agent yet.</div>
          ) : (
            <CommsFlowView
              passes={flow.passes}
              flights={flow.flights}
              rootId={flowCanonicalId(agentId)}
              identities={identities}
              view={view}
              selected={selected}
              onSelect={setSelected}
              onStage={(conversationId) => {
                // Even when it is the conversation already on the stage: the
                // ask was to see it, and the drawing is in the way.
                setView("chat");
                toStage(conversationId);
              }}
              beside={beside}
            />
          )
        ) : stageId ? (
          <ConversationScreen
            key={stageId}
            conversationId={stageId}
            navigate={navigate}
            embedded
            showBackNav={false}
            beside={beside}
            onHead={setHead}
          />
        ) : (
          <div className="amv-empty">
            {loading ? "Loading conversations…" : `No conversations with ${name} yet.`}
          </div>
        )}
      </div>
    </>
  );
}

function askActivity(
  ask: FleetAsk | undefined,
): { label: string; tone: "working" | "attention" | "pending" } | null {
  if (!ask) return null;
  if (ask.status === "working") return { label: "working", tone: "working" };
  if (ask.status === "needs_attention") return { label: "asking", tone: "attention" };
  if (ask.status === "queued") return { label: "starting", tone: "pending" };
  return null;
}
