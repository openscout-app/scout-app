/**
 * The rooms page inside the Mac app: the spaces bridge.
 *
 * The Mac app lists a host's spaces in its own sidebar, under Chats, so a
 * space is one click from anywhere in the app rather than a menu inside the
 * page. The page is still the source of truth: it has the session, it calls
 * the server, and it tells the app what the server answered. The app never
 * reads the space list over its own connection and never holds the session.
 *
 * Page → app, over the `scoutNativeUI` message handler:
 * - `chat-spaces`: the spaces this viewer can open, the open one, and whether
 *   the viewer is signed in and may create one. Sent whenever any of that
 *   changes.
 * - `chat-space-created`: the answer to a create the app asked for.
 *
 * App → page, as a `scout:chat-space` window event:
 * - `{ type: "select", slug }`: open that space.
 * - `{ type: "create", requestId, title, channel }`: create a space through
 *   the page's own `createSpace`, the same route the page's menu uses.
 *
 * The app opts in with `nativeSpaces=1` on the page's URL. Without it, or
 * without the message handler, the page keeps its own switcher and none of
 * this runs, so an older app, a browser tab and the web shell are unchanged.
 */

import type { ChatSpaceView } from "./chat-api.ts";

export const NATIVE_SPACES_PARAM = "nativeSpaces";
export const NATIVE_SPACE_EVENT = "scout:chat-space";

type NativeHandler = { postMessage: (message: unknown) => void };
type NativeWindow = {
  location?: { search?: string };
  webkit?: { messageHandlers?: { scoutNativeUI?: NativeHandler } };
  __scoutPendingChatSpace?: unknown;
};

function nativeHandler(win: NativeWindow | undefined): NativeHandler | null {
  return win?.webkit?.messageHandlers?.scoutNativeUI ?? null;
}

let hostedByApp: boolean | null = null;

/**
 * Whether the Mac app is listing this page's spaces. Read once, at the first
 * call: the page rewrites its own query string as it moves between channels,
 * and the opt-in must outlive that.
 */
export function nativeSpacesHost(win: NativeWindow | undefined = globalThis.window as NativeWindow | undefined): boolean {
  if (hostedByApp !== null) return hostedByApp;
  const search = win?.location?.search ?? "";
  hostedByApp = new URLSearchParams(search).get(NATIVE_SPACES_PARAM) === "1" && nativeHandler(win) !== null;
  return hostedByApp;
}

/** Tests only. */
export function resetNativeSpacesHost(): void {
  hostedByApp = null;
}

export type ChatSpacesMessage = {
  kind: "chat-spaces";
  current: string | null;
  signedIn: boolean;
  canCreate: boolean;
  spaces: { slug: string; title: string; isDefault: boolean; channelCount: number | null }[];
};

export function chatSpacesMessage(input: {
  spaces: readonly ChatSpaceView[];
  current: string | null;
  signedIn: boolean;
  canCreate: boolean;
}): ChatSpacesMessage {
  return {
    kind: "chat-spaces",
    current: input.signedIn ? input.current : null,
    signedIn: input.signedIn,
    canCreate: input.signedIn && input.canCreate,
    // A signed-out page lists nothing: the app must not keep showing the
    // spaces of a session that has ended.
    spaces: input.signedIn
      ? input.spaces.map((space) => ({
          slug: space.slug,
          title: space.title,
          isDefault: space.isDefault,
          channelCount: space.channelCount ?? null,
        }))
      : [],
  };
}

export type ChatSpaceCreatedMessage = {
  kind: "chat-space-created";
  requestId: string;
  ok: boolean;
  slug: string | null;
  error: string | null;
};

export function postToApp(message: ChatSpacesMessage | ChatSpaceCreatedMessage, win: NativeWindow | undefined = globalThis.window as NativeWindow | undefined): void {
  if (!nativeSpacesHost(win)) return;
  try {
    nativeHandler(win)?.postMessage(message);
  } catch {
    // The app went away mid-message; the page carries on without it.
  }
}

export type NativeSpaceCommand =
  | { type: "select"; slug: string }
  | { type: "create"; requestId: string; title: string; channel: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The app's command, checked: anything else on the event is ignored. */
export function parseNativeSpaceCommand(detail: unknown): NativeSpaceCommand | null {
  if (!detail || typeof detail !== "object") return null;
  const value = detail as Record<string, unknown>;
  if (value.type === "select" && typeof value.slug === "string" && SLUG.test(value.slug)) {
    return { type: "select", slug: value.slug };
  }
  if (
    value.type === "create"
    && typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 64
    && typeof value.title === "string" && value.title.trim().length > 0
  ) {
    return {
      type: "create",
      requestId: value.requestId,
      title: value.title.trim(),
      channel: typeof value.channel === "string" ? value.channel.trim() : "",
    };
  }
  return null;
}

/**
 * A command the app sent before the page's listener mounted (the first load
 * of a deep link). Taken once.
 */
export function takePendingNativeSpaceCommand(win: NativeWindow | undefined = globalThis.window as NativeWindow | undefined): NativeSpaceCommand | null {
  if (!win) return null;
  const pending = win.__scoutPendingChatSpace;
  win.__scoutPendingChatSpace = undefined;
  return parseNativeSpaceCommand(pending);
}
