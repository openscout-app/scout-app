import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { forwardScoutbotUiActionToNativeHost } from "../../lib/scoutbot.ts";
import type { Route } from "../../lib/types.ts";

/*
 * The Code head's small parts, shared by the page and the Code panels: the
 * way back to the conversation that handed a file in, and Copy scout://.
 */

/**
 * Back to the conversation that handed this file into Code, or null when none
 * did. ⌘[ goes back too while it applies (not from a field). The macOS app
 * takes the route itself when it hosts the page.
 */
export function useReturnToThread(
  returnConversationId: string | null,
  navigate: ((route: Route) => void) | undefined,
): (() => void) | null {
  const back = useCallback(() => {
    if (!returnConversationId) return;
    const destination: Route = { view: "conversation", conversationId: returnConversationId };
    if (forwardScoutbotUiActionToNativeHost({ type: "navigate", route: destination })) return;
    navigate?.(destination);
  }, [navigate, returnConversationId]);

  useEffect(() => {
    if (!returnConversationId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!event.metaKey || event.key !== "[") return;
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      }
      event.preventDefault();
      back();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, returnConversationId]);

  return returnConversationId ? back : null;
}

export function ReturnToThreadButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="s-code-returnThread" onClick={onClick} title="Back to thread (⌘[)">
      <ArrowLeft size={13} strokeWidth={1.9} aria-hidden />
      <span>Back to thread</span>
    </button>
  );
}

/** Copy a scout:// link; `copied` holds for 1.5s after a copy lands. */
export function useCopyLink(link: string | null): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
  const copy = useCallback(() => {
    if (!link) return;
    void copyTextToClipboard(link).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [link]);
  return { copied, copy };
}
