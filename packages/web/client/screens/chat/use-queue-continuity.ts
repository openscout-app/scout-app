import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import { messagePermalinkAnchor } from "../../lib/message-permalink.ts";
import type { QueuedDraft } from "./conversation-model.ts";
import "./queue-continuity.css";

export type PendingQueueDraft = { draft: QueuedDraft; index: number; conversationId: string };

/** Presentation only: neither a flying ticket nor a receipt authorizes a send. */
export function useQueueContinuity(conversationId: string, feedRef: RefObject<HTMLDivElement | null>) {
  const reduceMotion = useReducedMotion();
  const transferring = useRef(false);
  const [pending, setPending] = useState<PendingQueueDraft | null>(null);
  const [accepted, setAccepted] = useState<{ conversationId: string; messageId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const activeConversation = useRef(conversationId);
  activeConversation.current = conversationId;
  useEffect(() => {
    transferring.current = false;
    setPending(null); setAccepted(null); setNotice(null);
    return () => cleanupRef.current();
  }, [conversationId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  useLayoutEffect(() => {
    if (!accepted || accepted.conversationId !== conversationId) return;
    cleanupRef.current();
    const source = pending ? document.getElementById(`queue-draft-${pending.draft.id}`) : null;
    const target = document.getElementById(messagePermalinkAnchor(accepted.messageId));
    const feed = feedRef.current;
    const from = source?.getBoundingClientRect();
    const to = target?.getBoundingClientRect();
    const bounds = feed?.getBoundingClientRect();
    const visible = (rect: DOMRect) => rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
    const targetVisible = to && bounds && visible(to) && to.top >= bounds.top && to.bottom <= bounds.bottom;
    const animations: Animation[] = [];
    let ticket: HTMLElement | null = null;
    if (!reduceMotion && from && visible(from) && targetVisible && target?.animate) {
      ticket = document.createElement("div");
      ticket.className = "scout-queue-ticket";
      ticket.setAttribute("aria-hidden", "true");
      ticket.textContent = pending?.draft.body.trim() || "Attachments only";
      Object.assign(ticket.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${Math.min(from.width, 320)}px` });
      document.body.append(ticket);
      animations.push(ticket.animate([
        { transform: "translate(0, 0)", opacity: .95 },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`, opacity: 0 },
      ], { duration: 220, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" }));
      animations.push(target.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 220 }));
    }
    const clean = () => { animations.forEach((animation) => animation.cancel()); ticket?.remove(); };
    cleanupRef.current = clean;
    if (animations.length) void Promise.all(animations.map((animation) => animation.finished)).then(clean, clean);
    transferring.current = false;
    setNotice("Queued message submitted");
    setPending(null); setAccepted(null);
  }, [accepted, conversationId, feedRef, pending, reduceMotion]);

  return {
    pending: pending?.conversationId === conversationId ? pending : null,
    notice,
    begin(draft: QueuedDraft, index: number) {
      if (transferring.current) return false;
      transferring.current = true;
      setPending({ draft, index, conversationId }); setNotice(null);
      return true;
    },
    finish(messageId?: string) {
      // A response from a chat we left must not animate into the new chat.
      if (activeConversation.current !== conversationId) return;
      if (messageId) setAccepted({ conversationId, messageId });
      else { transferring.current = false; setPending(null); }
    },
  };
}
