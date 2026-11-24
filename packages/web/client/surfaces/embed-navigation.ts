import type { Route } from "../lib/types.ts";

type ScoutbotUiAction = { type: "navigate"; route: Route };

type ScoutNativeUiActionHost = {
  webkit?: {
    messageHandlers?: {
      scoutNativeUI?: {
        postMessage: (message: unknown) => void;
      };
      scoutRealtimeVoice?: {
        postMessage: (message: unknown) => void;
      };
    };
  };
};

/**
 * Native embeds own app navigation. Their WebViews only own the embedded
 * document, so a UI action must leave that document instead of asking its
 * local router to become the destination screen.
 */
export function forwardScoutbotUiActionToNativeHost(
  action: ScoutbotUiAction,
  host: ScoutNativeUiActionHost = globalThis.window as unknown as ScoutNativeUiActionHost,
): boolean {
  const handlers = host.webkit?.messageHandlers;
  const handler = handlers?.scoutNativeUI ?? handlers?.scoutRealtimeVoice;
  if (!handler) return false;
  try {
    handler.postMessage({ kind: "ui-action", action });
    return true;
  } catch {
    return false;
  }
}

type NativeUiActionForwarder = (action: ScoutbotUiAction) => boolean;

/**
 * A native embed owns only its document; the host owns product navigation.
 * Keeping this boundary here prevents every embeddable screen from having to
 * remember whether its `navigate` callback is allowed to replace the WebView.
 */
export function routeEmbeddedNavigation(
  route: Route,
  navigate: (route: Route) => void,
  forwardToNative: NativeUiActionForwarder = forwardScoutbotUiActionToNativeHost,
  /**
   * Routes that stay on the embedded surface. The host has no better answer
   * for these than "you are already there", so handing them over would drop
   * the state change on the floor.
   */
  isInternalRoute: (route: Route) => boolean = () => false,
): void {
  if (!isInternalRoute(route) && forwardToNative({ type: "navigate", route })) return;
  navigate(route);
}
