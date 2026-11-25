/**
 * Thread: the conversation surface the native hosts embed.
 *
 * A thread is a Scout conversation (`?conversationId=`) or a native harness
 * session (`?sessionRef=session:<harness>:<id>`). Both read as one chat: the
 * session renders in the conversation grammar under the bar that names where it
 * runs. The host owns message input for both; the shared embed boundary hides
 * MessageComposer atoms, and the session view leaves out its own composer.
 */

import { defineSurface } from "../../surfaces/types.ts";
import type { Route } from "../../lib/types.ts";
import { SessionRefEmbed } from "../sessions/SessionEmbedScreen.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { resolveThreadEmbedProps, type ThreadTreatment } from "./conversation-model.ts";

export function ThreadEmbedScreen({
  conversationId,
  sessionRef,
  initialDraft,
  navigate,
  embedded,
  showBackNav,
  treatment,
}: {
  conversationId: string;
  sessionRef?: string;
  initialDraft?: string;
  navigate: (route: Route) => void;
  embedded?: boolean;
  showBackNav?: boolean;
  treatment?: ThreadTreatment;
}) {
  const conversation = (id: string) => (
    <ConversationScreen
      conversationId={id}
      initialDraft={initialDraft}
      navigate={navigate}
      embedded={embedded}
      showBackNav={showBackNav}
      treatment={treatment}
    />
  );

  if (!conversationId && sessionRef) {
    return (
      <SessionRefEmbed
        sessionRef={sessionRef}
        composer={false}
        renderConversation={conversation}
      />
    );
  }

  return conversation(conversationId);
}

export const scoutSurface = defineSurface({
  id: "thread",
  label: "Thread",
  route: { view: "conversation", conversationId: "" },
  webPath: "/chat",
  screen: "ThreadEmbedScreen",
  embed: {
    path: "/embed/thread",
    profile: "macos.thread",
    rootClassName: "s-thread-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
    // The host owns navigation; an in-embed back arrow would strand the user
    // inside a pane that has nowhere to go back to. Composer ownership is
    // resolved once by the shared embed boundary.
    resolveEmbedProps: resolveThreadEmbedProps,
  },
});
