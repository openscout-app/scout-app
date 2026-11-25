import { useEffect, useMemo } from "react";
import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { conversationHarmonyRoute } from "./conversation-model.ts";

import { MessagesScreen } from "./MessagesScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

function LegacyConversationContent({ route, navigate }: {
  route: Extract<Route, { view: "conversation" }>;
  navigate: Navigate;
}) {
  const { sessions, loading } = useConversationList();
  const conversation = sessions.find((candidate) =>
    candidate.id === route.conversationId || candidate.equivalentConversationIds?.includes(route.conversationId));
  const destination = useMemo(
    // A native recovery draft belongs to this conversation's composer. Keep the
    // legacy surface until the Session composer can receive that draft intact.
    () => route.composeDraft ? null : conversationHarmonyRoute(conversation, route.machineId),
    [conversation, route.composeDraft, route.machineId],
  );
  useEffect(() => {
    if (destination) navigate(destination, { replace: true });
  }, [destination, navigate]);
  if (loading || destination) return null;
  return (
    <ConversationScreen
      key={route.conversationId}
      conversationId={route.conversationId}
      initialDraft={route.composeDraft}
      navigate={navigate}
    />
  );
}

export function ChatContent({ route, navigate }: { route: Route; navigate: Navigate }) {
  switch (route.view) {
    case "conversation":
      return <LegacyConversationContent route={route} navigate={navigate} />;
    case "messages":
      return (
        <MessagesScreen
          conversationId={route.conversationId}
          agentId={route.agentId}
          threadId={route.threadId}
          machineId={route.machineId}
          navigate={navigate}
        />
      );
    default:
      return null;
  }
}
