import {
  ChatApiError,
  type ChannelFeed,
  type ChannelInviteList,
  type ChannelMemberIdentity,
  type ChannelMembers,
  type ChatApi,
  type ChatBootstrap,
  type ChatCapabilities,
  type ChatMessage,
  type ChatSpaceView,
  type ChatUploadAttachment,
  type CreatedChannelInvite,
  type InviteCreateInput,
  type InviteJoinResult,
  type InvitePreview,
  type TrackedRequest,
} from "./chat-api.ts";

const base = "/api/slack/client";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ChatApiError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const payload = await response.json().catch(() => ({})) as { error?: string; reason?: string };
  const retryAfter = Number(response.headers.get("retry-after"));
  if (!response.ok) throw new ChatApiError(payload.error || `${init?.method ?? "GET"} ${path} failed (${response.status})`, response.status, payload.reason ?? null, Number.isSafeInteger(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  return payload as T;
}

function withSpace(path: string, space?: string | null): string {
  if (!space) return path;
  return `${path}${path.includes("?") ? "&" : "?"}space=${encodeURIComponent(space)}`;
}

function id(value: string): string {
  return encodeURIComponent(value);
}

export type SlackConnectionStatus = {
  connected: boolean;
  source: "oauth" | "environment" | null;
  oauthConfigured: boolean;
  authorizationUrl?: string;
  teamId?: string;
  teamName?: string;
  userId?: string;
  displayName?: string;
  workspaceUrl?: string;
  scopes: string[];
  error?: string;
};

export function slackConnectionStatus(next = "/rooms?source=slack"): Promise<SlackConnectionStatus> {
  return request(`${base}/oauth/status?next=${encodeURIComponent(next)}`);
}

export function slackDisconnect(): Promise<{ ok: true }> {
  return request(`${base}/oauth/disconnect`, { method: "POST" });
}

function unsupported(what: string): never {
  throw new ChatApiError(`This Slack connection does not support ${what}.`, 501, "capability_unsupported");
}

export const SLACK_CHAT_CAPABILITIES: ChatCapabilities = {
  readState: true,
  asks: false,
  inviteList: false,
  inviteKinds: [],
  inviteRevoke: false,
  liveStream: false,
  signOut: false,
  spaceCreate: false,
  channelCreate: false,
  spaceDelete: false,
  namedFirstChannel: false,
  memberDetail: false,
  memberReceptionEvidence: false,
  memberRemove: false,
  reactions: true,
  attachments: true,
  signIn: {
    startPath: "",
    returnToParam: "next",
    label: "Connect Slack",
    prompt: "Connect an operator user token to read and respond to Slack.",
    note: "The existing Scout bot installation remains separate.",
  },
};

export const slackChatApi = {
  bootstrap(options: { space?: string | null } = {}): Promise<ChatBootstrap> {
    return request(withSpace(`${base}/chat/bootstrap`, options.space));
  },
  spaces(): Promise<{ spaces: ChatSpaceView[] }> {
    return request(`${base}/chat/spaces`);
  },
  feed(channelId: string, space?: string | null): Promise<ChannelFeed> {
    return request(withSpace(`${base}/channels/${id(channelId)}/feed`, space));
  },
  members(channelId: string, space?: string | null): Promise<ChannelMembers> {
    return request(withSpace(`${base}/channels/${id(channelId)}/members`, space));
  },
  readState(channelId: string, space?: string | null): Promise<import("@openscout/protocol").ChatReadState> {
    return request(withSpace(`${base}/channels/${id(channelId)}/read-state`, space));
  },
  markRead(channelId: string, input: { messageId: string; rootMessageId?: string | null; space?: string | null }): Promise<{ ok: true }> {
    return request(withSpace(`${base}/channels/${id(channelId)}/read-state`, input.space), {
      method: "POST",
      body: JSON.stringify({ messageId: input.messageId, rootMessageId: input.rootMessageId ?? null }),
    });
  },
  messageContext(channelId: string, messageId: string, space?: string | null, cursor?: string | null) {
    const path = withSpace(`${base}/channels/${id(channelId)}/messages/${id(messageId)}/context`, space);
    return request<{ rootMessageId: string; messages: ChatMessage[]; hasMore: boolean; nextCursor?: string | null }>(`${path}${cursor ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : ""}`);
  },
  uploadAttachments(channelId: string, files: File[], space?: string | null): Promise<ChatUploadAttachment[]> {
    const body = new FormData();
    for (const file of files) body.append("files", file, file.name);
    return request<{ attachments: ChatUploadAttachment[] }>(withSpace(`${base}/channels/${id(channelId)}/uploads`, space), { method: "POST", body })
      .then(result => result.attachments);
  },
  correctMessage(channelId: string, messageId: string, change: import("@openscout/protocol").ChatMessageChange, space?: string | null): Promise<{ ok: true; message: ChatMessage }> {
    return request(withSpace(`${base}/channels/${id(channelId)}/corrections`, space), {
      method: "POST",
      body: JSON.stringify({ messageId, change }),
    });
  },
  postMessage(channelId: string, input: {
    requestId: string;
    body: string;
    replyToMessageId?: string;
    space?: string | null;
    attachments?: ChatUploadAttachment[];
    mentionActorIds?: string[];
  }): Promise<{ message: ChatMessage }> {
    return request(withSpace(`${base}/channels/${id(channelId)}/messages`, input.space), {
      method: "POST",
      body: JSON.stringify({
        requestId: input.requestId,
        body: input.body,
        ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        ...(input.mentionActorIds?.length ? { mentionActorIds: input.mentionActorIds } : {}),
      }),
    });
  },
  addReaction(channelId: string, input: { messageId: string; emoji: string; requestId: string; space?: string | null }) {
    return request<{ ok: true; replayed: boolean }>(withSpace(`${base}/channels/${id(channelId)}/reactions`, input.space), {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  removeReaction(channelId: string, input: { messageId: string; emoji: string; requestId: string; space?: string | null }) {
    return request<{ ok: true; replayed: boolean }>(withSpace(`${base}/channels/${id(channelId)}/reactions/remove`, input.space), {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  me(): Promise<{ member: ChannelMemberIdentity | null }> {
    return request(`${base}/member/me`);
  },
  async createSpace(): Promise<never> { unsupported("creating Slack workspaces"); },
  async createChannel(): Promise<never> { unsupported("creating channels"); },
  async signOut(): Promise<never> { unsupported("signing out of Slack here"); },
  async postAsk(): Promise<{ message: ChatMessage; request: TrackedRequest }> { unsupported("asks in this view"); },
  async cancelAsk(): Promise<never> { unsupported("asks in this view"); },
  async invites(): Promise<ChannelInviteList> { unsupported("Slack invitations here"); },
  async createInvite(): Promise<CreatedChannelInvite> { unsupported("Slack invitations here"); },
  async revokeInvite(): Promise<never> { unsupported("Slack invitations here"); },
  async invitePreview(): Promise<InvitePreview> { unsupported("Slack invitations here"); },
  async joinInvite(): Promise<InviteJoinResult> { unsupported("Slack invitations here"); },
} satisfies ChatApi;
