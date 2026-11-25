import { useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { holdRequest, receiveRequests, refreshRequests, releaseRequest, settleRequests } from "../../lib/operator-requests-store.ts";
import type { OperatorAttentionAction, OperatorAttentionItem, OperatorAttentionState } from "../../lib/types.ts";
import { failedDelivery, type RequestDelivery } from "./request-delivery.ts";
import { answersOnPane, isReadyRequest, isRequestDismissal } from "./requests-model.ts";

export type { RequestDelivery };

/**
 * Backed decisions: question replies, pairing approvals, broker-managed
 * live-process permission decisions, and the runtime's dismissal of a request.
 * Shared by the Requests page and Scoutbot so both answer the same way.
 */
/** The runtime ends a request (its dismissal). Its settle event drops the row; the list is read again past the caches. */
export async function dismissRequestRecord(recordId: string): Promise<void> {
  await api<{ ok: true }>("/api/operator-attention/requests/dismiss", {
    method: "POST", body: JSON.stringify({ requestId: recordId }),
  });
  void refreshRequests({ fresh: true });
}

/**
 * A live process's permission request, decided through the runtime. The route answers once the runtime has
 * taken the decision; the row goes now (its settle event says the same), and the list is read again.
 */
export async function decidePermission(permission: NonNullable<OperatorAttentionItem["permission"]>, decision: "once" | "project" | "deny"): Promise<void> {
  await api<{ ok: true }>("/api/operator-attention/permissions/decide", {
    method: "POST", body: JSON.stringify({ requestId: permission.requestId, version: permission.version, decision }),
  });
  settleRequests([`permission:${permission.requestId}`]);
  void refreshRequests({ fresh: true });
}

/** A session's approval block, decided through the runtime. */
export async function decideApproval(approval: NonNullable<OperatorAttentionItem["approval"]>, decision: "approve" | "deny"): Promise<void> {
  const { sessionId, turnId, blockId, version } = approval;
  receiveRequests(await api<OperatorAttentionState>("/api/operator-attention/approvals/decide", {
    method: "POST", body: JSON.stringify({ sessionId, turnId, blockId, version, decision }),
  }));
}

/** Yes or No to the plain permission dialog on a tmux pane, sent as keys while the same dialog is up. */
export async function answerPanePrompt(item: OperatorAttentionItem, decision: "approve" | "deny"): Promise<void> {
  const prompt = item.pane?.prompt;
  if (!prompt?.answerable) throw new Error("Jump in to answer it in the pane.");
  receiveRequests(await api<OperatorAttentionState>("/api/operator-attention/pane-prompts/answer", {
    method: "POST", body: JSON.stringify({ itemId: item.id, version: prompt.version, decision }),
  }));
}

/**
 * Continue or Hold on a Ready task, through the runtime. Continue hands the next move back to the agent in the
 * same session; Hold takes it off the list and leaves it Ready. Either way the fresh state no longer lists it.
 * A task that is not Ready any more refuses (409).
 */
export async function decideReadyTask(ready: NonNullable<OperatorAttentionItem["ready"]>, decision: "continue" | "hold"): Promise<void> {
  receiveRequests(await api<OperatorAttentionState>("/api/operator-attention/ready/decide", {
    method: "POST", body: JSON.stringify({ ref: ready.flightId, decision }),
  }));
}

/** What a Ready move says once the runtime took it. */
export const READY_DECIDED: Record<"continue" | "hold", string> = { continue: "Continued", hold: "Held" };

export type RequestActionFeedback = { phase: "sending"; label: string } | { phase: "recorded"; label: string } | { phase: "failed" };

/** A decision with no answer after this long is stalled: its card says it is still waiting and offers Retry. */
export const STALL_MS = 5_000;
/** How long a card shows how its decision went before the list may let the request go. */
export const OUTCOME_MS = 1_600;

/** One send: what goes out, and what its success and failure say. */
type Send = { label: string; send: () => Promise<void>; done: () => void; fail: (cause: unknown) => void };

export function useRequestActions(item: OperatorAttentionItem, onOpen: (action: OperatorAttentionAction) => void,
  onFeedback?: (feedback: RequestActionFeedback) => void,
) {
  const inFlight = useRef(false);
  const recorded = useRef(false);
  /** Each send, and each retry of it, is an attempt; only the latest one's failure is shown. */
  const attempt = useRef(0);
  const stalledNow = useRef(false);
  const last = useRef<Send | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<RequestDelivery | null>(null);

  // The card shows the send at once and holds the request on screen until the outcome has shown. A send with
  // no answer after STALL_MS is stalled, and Retry sends it again; the first answer that lands wins.
  const run = async (spec: Send, retrying = false) => {
    if (recorded.current) return;
    if (!retrying && (inFlight.current || busy || sent)) return;
    const mine = ++attempt.current;
    last.current = spec;
    inFlight.current = true;
    stalledNow.current = false;
    setBusy(true); setStalled(false); setError(null); setPendingLabel(spec.label); setDelivery({ state: "sending", label: spec.label });
    holdRequest(item);
    onFeedback?.({ phase: "sending", label: spec.label });
    globalThis.setTimeout(() => {
      if (attempt.current !== mine || !inFlight.current || recorded.current) return;
      stalledNow.current = true;
      setStalled(true);
    }, STALL_MS);
    let latest = true;
    try {
      await spec.send();
      if (recorded.current) return;
      recorded.current = true;
      spec.done();
    } catch (cause) {
      latest = attempt.current === mine;
      if (recorded.current || !latest) return;
      spec.fail(cause);
    } finally {
      if (latest || recorded.current) {
        inFlight.current = false;
        stalledNow.current = false;
        setBusy(false); setStalled(false); setPendingLabel(null);
        globalThis.setTimeout(() => releaseRequest(item.id), OUTCOME_MS);
      }
    }
  };

  /** Send the last decision again: while it is stalled, or after it went unconfirmed. */
  const retry = (): Promise<void> => {
    const spec = last.current;
    if (!spec || recorded.current) return Promise.resolve();
    return stalledNow.current || !inFlight.current ? run(spec, true) : Promise.resolve();
  };

  const answer = async (option: string) => {
    if (!item.answer) return;
    const { conversationId, replyToMessageId } = item.answer;
    await run({
      label: option,
      send: () => api("/api/send", { method: "POST", body: JSON.stringify({ body: option, conversationId, replyToMessageId }) }).then(() => {}),
      done: () => {
        onFeedback?.({ phase: "recorded", label: `Reply recorded: ${option}` });
        setSent(option); setDelivery({ state: "delivered", label: option });
        void refreshRequests();
      },
      fail: (cause) => {
        onFeedback?.({ phase: "failed" });
        const fallback = "Answer failed; open the conversation and reply there.";
        setError(cause instanceof Error ? cause.message : fallback);
        setDelivery(failedDelivery(option, cause, fallback));
        void refreshRequests();
      },
    });
  };

  const act = async (action: OperatorAttentionAction) => {
    if (action.kind === "open" && action.route) { onOpen(action); return; }
    if (isRequestDismissal(item, action)) {
      await run({
        label: action.label,
        // The runtime ends the request; the fresh state no longer lists it.
        send: () => dismissRequestRecord(action.recordId),
        done: () => {
          onFeedback?.({ phase: "recorded", label: "Dismissed" });
          setSent("Dismissed"); setDelivery({ state: "delivered", label: "Dismissed" });
        },
        fail: (cause) => {
          // A refusal says why: a session still waits on the request, so a decision is the way out.
          onFeedback?.({ phase: "failed" });
          const fallback = "Dismiss failed; refresh and try again.";
          setError(cause instanceof Error ? cause.message : fallback);
          setDelivery(failedDelivery(action.label, cause, fallback));
          void refreshRequests();
        },
      });
      return;
    }
    if (isReadyRequest(item) && (action.kind === "continue" || action.kind === "hold")) {
      if (inFlight.current || recorded.current || busy || sent) return;
      const decision = action.kind;
      inFlight.current = true;
      setBusy(true); setError(null); setPendingLabel(action.label); setDelivery({ state: "sending", label: action.label });
      onFeedback?.({ phase: "sending", label: action.label });
      try {
        await decideReadyTask(item.ready, decision);
        recorded.current = true;
        onFeedback?.({ phase: "recorded", label: READY_DECIDED[decision] });
        setSent(READY_DECIDED[decision]); setDelivery({ state: "delivered", label: READY_DECIDED[decision] });
      } catch (cause) {
        const fallback = decision === "continue" ? "Continue failed; refresh and try again." : "Hold failed; refresh and try again.";
        onFeedback?.({ phase: "failed" });
        setError(cause instanceof Error ? cause.message : fallback);
        setDelivery(failedDelivery(action.label, cause, fallback));
        void refreshRequests();
      }
      finally { inFlight.current = false; setBusy(false); setPendingLabel(null); }
      return;
    }
    if (item.permission && (action.kind === "approve" || action.kind === "deny")) {
      const decision = action.kind === "deny" ? "deny" : action.value;
      if (decision !== "once" && decision !== "project" && decision !== "deny") return;
      const permission = item.permission;
      await run({
        label: action.label,
        send: () => decidePermission(permission, decision),
        done: () => {
          onFeedback?.({ phase: "recorded", label: action.kind === "approve" ? "Approval recorded" : "Denial recorded" });
          setSent(action.label); setDelivery({ state: "delivered", label: action.label });
        },
        fail: (cause) => {
          const fallback = "Decision delivery failed. Open the live session before retrying.";
          const outcome = failedDelivery(action.label, cause, fallback);
          if (outcome.state === "ended") {
            // The runtime closed the request: nothing can take a decision any more. Its reason is the receipt.
            recorded.current = true;
            onFeedback?.({ phase: "recorded", label: outcome.reason });
          } else {
            onFeedback?.({ phase: "failed" });
            setError(cause instanceof Error ? cause.message : fallback);
          }
          setDelivery(outcome);
          void refreshRequests();
        },
      });
      return;
    }
    if (answersOnPane(item) && (action.kind === "approve" || action.kind === "deny")) {
      await run({
        label: action.label,
        send: () => answerPanePrompt(item, action.kind as "approve" | "deny"),
        done: () => {
          // tmux took the keys; the pane shows whether the prompt closed.
          onFeedback?.({ phase: "recorded", label: `${action.label} sent to the pane` });
          setSent(action.label); setDelivery({ state: "delivered", label: action.label });
        },
        fail: (cause) => {
          // A changed prompt or a busy claim is a refusal with its reason; the pane is the way to look again.
          onFeedback?.({ phase: "failed" });
          const fallback = "The keys may not have reached the pane. Watch it before you try again.";
          setError(cause instanceof Error ? cause.message : fallback);
          setDelivery(failedDelivery(action.label, cause, fallback));
          void refreshRequests();
        },
      });
      return;
    }
    if (!item.approval || (action.kind !== "approve" && action.kind !== "deny")) return;
    const approval = item.approval;
    const kind = action.kind;
    await run({
      label: action.label,
      send: () => decideApproval(approval, kind),
      done: () => {
        onFeedback?.({ phase: "recorded", label: kind === "approve" ? "Approval recorded" : "Denial recorded" });
        setDelivery({ state: "delivered", label: action.label });
      },
      fail: (cause) => {
        onFeedback?.({ phase: "failed" });
        const fallback = "Decision failed; refresh and try again.";
        setError(cause instanceof Error ? cause.message : fallback);
        setDelivery(failedDelivery(action.label, cause, fallback));
        void refreshRequests();
      },
    });
  };
  return { busy, stalled, error, sent, pendingLabel, delivery, answer, act, retry };
}
