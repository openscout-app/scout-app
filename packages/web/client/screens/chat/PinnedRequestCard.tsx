import { useState } from "react";
import type { OperatorAttentionAction, OperatorAttentionItem } from "../../lib/types.ts";
import { isAlwaysAllow, isRequestDismissal, requestActionTitle, requestActions } from "../requests/requests-model.ts";
import { useSessionReveal } from "../requests/request-session.ts";
import { useRequestActions } from "../requests/use-request-actions.ts";
import { PinnedAskCard } from "./ConversationStatus.tsx";

/**
 * The pinned card, answered the way the Inbox answers it. A permission request
 * (or a pairing approval) is allowed or denied in the session that asked, and
 * dismissed when nothing waits on it; the runtime refuses a dismissal while a
 * session still waits and says so here. Answer and Reply still write in the
 * thread, for a question that wants words.
 */
export function PinnedRequestCard({
  request,
  onAnswer,
  onSteer,
  onOpen,
}: {
  request: OperatorAttentionItem;
  onAnswer: () => void;
  onSteer?: () => void;
  onOpen: (action: OperatorAttentionAction) => void;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const { busy, error, pendingLabel, act } = useRequestActions(request, onOpen, (feedback) => {
    if (feedback.phase === "recorded") setReceipt(feedback.label);
  });
  // only the decisions the runtime backs for this request: never a button that can't land
  const backed = requestActions(request);
  const approve = backed.find((action) => action.kind === "approve" && !isAlwaysAllow(action)) ?? backed.find((action) => action.kind === "approve");
  const always = backed.find((action) => isAlwaysAllow(action) && action !== approve);
  const terminal = useSessionReveal(request.permission?.requestId);
  const deny = backed.find((action) => action.kind === "deny");
  const dismiss = backed.find((action) => isRequestDismissal(request, action));

  return (
    <PinnedAskCard
      request={request}
      onAnswer={onAnswer}
      onSteer={onSteer}
      onApprove={approve ? () => void act(approve) : undefined}
      approveLabel={approve?.label}
      onApproveAlways={always ? () => void act(always) : undefined}
      approveAlwaysLabel={always?.label}
      approveAlwaysTitle={always ? requestActionTitle(request, always) : undefined}
      onOpenTerminal={terminal.go ?? undefined}
      terminalPending={terminal.going}
      terminalLine={terminal.result?.line ?? null}
      onReject={deny ? () => void act(deny) : undefined}
      rejectLabel={deny?.label}
      onDismiss={dismiss ? () => void act(dismiss) : undefined}
      busy={busy}
      pending={pendingLabel}
      error={error}
      receipt={receipt}
    />
  );
}
