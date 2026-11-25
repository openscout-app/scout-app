import { useEffect, useMemo, type ReactNode } from "react";
import { Plus } from "lucide-react";

import {
  readReturnToFromState,
  routeMachineId,
  useBrowserLocation,
} from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import { useScout } from "../../scout/Provider.tsx";
import { AgentMasterScreen } from "./AgentMasterScreen.tsx";
import { CommsDeck } from "./CommsDeck.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { HostConversationScreen } from "./HostConversationScreen.tsx";
import { conversationHarmonyRoute } from "./conversation-model.ts";
import { rememberedPeerConversation } from "../../lib/host-conversations.ts";
import { useBeside, useStage } from "./use-beside.ts";
import "./agent-master.css";
import "./conversation-screen.css";

export function MessagesScreen({
  conversationId,
  agentId,
  threadId,
  machineId,
  navigate,
}: {
  conversationId?: string;
  agentId?: string;
  threadId?: string;
  machineId?: string;
  navigate: (route: Route) => void;
}) {
  // Every Comms page is one STAGE — the conversation or agent surface the route
  // names — with the conversations kept BESIDE it in columns to the right.
  // The columns are the page's, not any one screen's: `?open=` names them, it
  // is sticky across /messages routes, so they stay put while the stage moves
  // from one conversation to the next. See comms-deck.ts.
  const beside = useBeside();
  const toStage = useStage(navigate, machineId);

  let stage: ReactNode;
  if (agentId) {
    // /messages/agent/<id> — the agent surface: its own conversation or the
    // `?thread=` on the stage, its other conversations in a strip above.
    stage = (
      <AgentMasterScreen
        agentId={agentId}
        threadId={threadId}
        machineId={machineId}
        navigate={navigate}
      />
    );
  } else if (!conversationId) {
    // Bare /messages was the Direct list. DMs now live in Chats beside the
    // rooms, so the old address opens Chats; with columns kept beside, the
    // directory stays under them.
    stage = beside.ids.length > 0 ? <MessagesLander /> : <OpenChats />;
  } else {
    stage = <ConversationRoute conversationId={conversationId} navigate={navigate} beside={beside} />;
  }

  return (
    <div className="amv">
      <section className="amv-main">{stage}</section>
      <CommsDeck
        ids={beside.ids}
        onClose={beside.remove}
        onStage={(id) => {
          // Move first, close second: the move carries `open` along (it is
          // sticky), and the close then edits the URL the move produced.
          // The other way round, the move would put the column back.
          toStage(id);
          beside.remove(id);
        }}
        renderConversation={(id) => (
          <ConversationScreen
            key={id}
            conversationId={id}
            navigate={navigate}
            embedded
            showBackNav={false}
          />
        )}
      />
    </div>
  );
}

/**
 * One conversation, on its own page.
 *
 * There is deliberately no back pill on the ordinary route (D2: the rail is the
 * triage surface, and "back to the list" is what the rail already is). But a
 * deck column can pop out to here, and an arrival that recorded where it came
 * from is owed the way back — so the pill appears exactly when there is
 * somewhere specific to return to, and names it.
 */
function ConversationRoute({
  conversationId,
  navigate,
  beside,
}: {
  conversationId: string;
  navigate: (route: Route) => void;
  beside: ReturnType<typeof useBeside>;
}) {
  const { agents, route: currentRoute, navigate: navigateWithOptions } = useScout();
  const { sessions, loading } = useConversationList();
  const location = useBrowserLocation();
  const returnTo = useMemo(() => readReturnToFromState(location.state), [location.state]);
  const harmonyDestination = useMemo(() => {
    if (beside.ids.length > 0) return null;
    const conversation = sessions.find((candidate) =>
      candidate.id === conversationId || candidate.equivalentConversationIds?.includes(conversationId));
    return conversationHarmonyRoute(conversation, routeMachineId(currentRoute));
  }, [sessions, conversationId, currentRoute, beside.ids.length]);
  useEffect(() => {
    if (harmonyDestination) navigateWithOptions(harmonyDestination, { replace: true });
  }, [harmonyDestination, navigateWithOptions]);
  /** A chat that lives on another host opens read-only through the host proxy. */
  const peer = useMemo(() => {
    const row = sessions.find((s) => s.id === conversationId);
    if (row?.remoteMachineId) {
      return { machineId: row.remoteMachineId, name: row.remoteMachineName ?? row.remoteMachineId };
    }
    if (row) return null;
    const remembered = rememberedPeerConversation(conversationId);
    return remembered ? { machineId: remembered.machineId, name: remembered.name } : null;
  }, [sessions, conversationId]);
  const backLabel = useMemo(() => {
    if (!returnTo || returnTo.view !== "messages" || !returnTo.agentId) return undefined;
    const name = agents.find((agent) => agent.id === returnTo.agentId)?.name
      ?? returnTo.agentId.split(".")[0]
      ?? returnTo.agentId;
    return `Back to ${name}`;
  }, [returnTo, agents]);

  if (loading || harmonyDestination) return null;

  if (peer) {
    return (
      <HostConversationScreen
        key={`${peer.machineId}:${conversationId}`}
        conversationId={conversationId}
        machineId={peer.machineId}
        hostName={peer.name}
      />
    );
  }

  return (
    <ConversationScreen
      key={conversationId}
      conversationId={conversationId}
      navigate={navigate}
      showBackNav={Boolean(returnTo)}
      backLabel={backLabel}
      beside={beside}
    />
  );
}

/** The old Direct address: replace it with Chats, so Back does not return here. */
function OpenChats() {
  const { navigate } = useScout();
  useEffect(() => {
    navigate({ view: "rooms" }, { replace: true });
  }, [navigate]);
  return null;
}

/** Bare /messages with columns beside: the directory under them. */
function MessagesLander() {
  const { onlineCount, apiConnection, reload, openContextCapture } = useScout();
  const { loading, loadError } = useConversationList();
  const apiOffline = apiConnection.status === "offline";

  return (
    <div className={`s-conv-empty${apiOffline ? " s-conv-empty--offline" : ""}`}>
      <div className="s-conv-empty-inner">
        <EmptyMesh />
        <div className="s-conv-empty-eyebrow">
          {apiOffline ? "Connection" : "Direct conversations"}
        </div>
        <p className="s-conv-empty-title">
          {apiOffline
            ? "Scout server offline"
            : loading
              ? "Loading conversations"
              : loadError
                ? "Chats unavailable"
                : "Choose a direct conversation"}
        </p>
        <p className="s-conv-empty-detail">
          {apiOffline
            ? "Start or restart Scout services. Chats and context will appear when the server responds."
            : loadError
              ? loadError
              : "Pick a conversation from the list, or start a new one."}
        </p>

        {apiOffline || loadError ? (
          <button
            type="button"
            className="s-conv-empty-action"
            onClick={() => {
              void reload();
            }}
          >
            Retry connection
          </button>
        ) : (
          <button
            type="button"
            className="s-conv-empty-new"
            onClick={() => openContextCapture()}
          >
            <Plus size={16} aria-hidden="true" />
            New chat
          </button>
        )}

        <div className="s-conv-empty-ambient">
          <span className="s-conv-empty-ambient-dot" aria-hidden="true" />
          {apiOffline
            ? "waiting for server"
            : `${onlineCount} ${onlineCount === 1 ? "agent" : "agents"} active`}
        </div>
      </div>
    </div>
  );
}

/** Quiet constellation echo of the brand mesh motif — six nodes, thin links,
 *  one node lit in the single accent. Decorative only. */
function EmptyMesh() {
  return (
    <svg
      className="s-conv-empty-mesh"
      viewBox="0 0 72 72"
      fill="none"
      aria-hidden="true"
    >
      <line className="s-conv-empty-mesh-link" x1="14" y1="20" x2="36" y2="12" />
      <line className="s-conv-empty-mesh-link" x1="36" y1="12" x2="58" y2="24" />
      <line className="s-conv-empty-mesh-link" x1="14" y1="20" x2="24" y2="46" />
      <line className="s-conv-empty-mesh-link" x1="24" y1="46" x2="36" y2="12" />
      <line className="s-conv-empty-mesh-link" x1="24" y1="46" x2="50" y2="54" />
      <line className="s-conv-empty-mesh-link" x1="50" y1="54" x2="58" y2="24" />
      <line className="s-conv-empty-mesh-link" x1="36" y1="12" x2="50" y2="54" />
      <circle className="s-conv-empty-mesh-node" cx="14" cy="20" r="2.5" />
      <circle className="s-conv-empty-mesh-node" cx="58" cy="24" r="2.5" />
      <circle className="s-conv-empty-mesh-node" cx="24" cy="46" r="2.5" />
      <circle className="s-conv-empty-mesh-node" cx="50" cy="54" r="2.5" />
      <circle
        className="s-conv-empty-mesh-node s-conv-empty-mesh-node--accent"
        cx="36"
        cy="12"
        r="3.5"
      />
    </svg>
  );
}
