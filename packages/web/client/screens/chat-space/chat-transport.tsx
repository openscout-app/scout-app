/**
 * Which server the standalone Chat surface is talking to.
 *
 * The components, model, and CSS in `screens/chat-space/` are shared between
 * local Scout, hosted Chat, and external projections. This module isolates the
 * HTTP implementation, the capabilities a backend can honestly claim, and the
 * source identity used by source-specific interaction rules.
 *
 * Two rules keep the seam narrow:
 *
 *  - **The transport answers, the surface renders.** Source identity and
 *    capabilities are explicit inputs; the shared components own the resulting
 *    presentation and interaction rules.
 *  - **An absent capability is stated, not simulated.** Where a backend has no
 *    endpoint for something, the capability is `false` and the affordance is not
 *    rendered. Nothing degrades into an empty list that reads as "none yet".
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  chatApi,
  DEFAULT_CHAT_SPACE,
  LOCAL_CHAT_CAPABILITIES,
  type ChatApi,
  type ChatCapabilities,
} from "./chat-api.ts";
import { createQueryChatAddress, type ChatAddress } from "./chat-address.ts";

export interface ChatTransport {
  api: ChatApi;
  capabilities: ChatCapabilities;
  source?: "scout" | "slack";
  /** How this deployment spells "which space, which channel" in the address bar. */
  address: ChatAddress;
}

/** The local Scout server, which answers the whole contract. */
export const LOCAL_CHAT_TRANSPORT: ChatTransport = {
  api: chatApi,
  capabilities: LOCAL_CHAT_CAPABILITIES,
  source: "scout",
  address: createQueryChatAddress(DEFAULT_CHAT_SPACE),
};

const ChatTransportContext = createContext<ChatTransport>(LOCAL_CHAT_TRANSPORT);

/**
 * Wrap the surface to point it at a different server.
 *
 * Absent, the surface runs against the local Scout server exactly as it always
 * has — `/chat` and `/invite/<token>` mount no provider and are unchanged.
 */
export function ChatTransportProvider({
  api,
  capabilities,
  source = "scout",
  address,
  children,
}: {
  api: ChatApi;
  capabilities: ChatCapabilities;
  source?: "scout" | "slack";
  address: ChatAddress;
  children: ReactNode;
}) {
  const value = useMemo<ChatTransport>(
    () => ({ api, capabilities, source, address }),
    [api, capabilities, source, address],
  );
  return <ChatTransportContext.Provider value={value}>{children}</ChatTransportContext.Provider>;
}

export function useChatTransport(): ChatTransport {
  return useContext(ChatTransportContext);
}

export function useChatApi(): ChatApi {
  return useContext(ChatTransportContext).api;
}

export function useChatCapabilities(): ChatCapabilities {
  return useContext(ChatTransportContext).capabilities;
}

export function useChatAddress(): ChatAddress {
  return useContext(ChatTransportContext).address;
}
