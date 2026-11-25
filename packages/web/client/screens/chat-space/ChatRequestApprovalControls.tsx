import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ChatRequestApprovalDecision, TrackedRequest } from "./chat-api.ts";

type RequestApprovalAccess = {
  scope: string;
  decide: (flightId: string, decision: ChatRequestApprovalDecision) => Promise<unknown>;
};
export const ChatRequestApprovalAccess = createContext<RequestApprovalAccess | null>(null);

export function ChatRequestApprovalControls({ request }: { request: TrackedRequest }) {
  const access = useContext(ChatRequestApprovalAccess);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Set<string>>(() => new Set());
  const pendingWrite = useRef(false);
  useEffect(() => { setSubmitted(new Set()); setError(null); }, [access?.scope, request.flightId]);

  const decide = async (approval: NonNullable<TrackedRequest["approvals"]>[number], decision: "approve" | "deny") => {
    if (!access || pendingWrite.current || submitted.has(approval.blockId)) return;
    pendingWrite.current = true;
    setBusy(true);
    setError(null);
    setSubmitted(current => new Set([...current, approval.blockId]));
    try {
      await access.decide(request.flightId, {
        blockId: approval.blockId,
        requestVersion: approval.requestVersion,
        version: approval.version,
        decision,
      });
    } catch {
      setSubmitted(current => { const next = new Set(current); next.delete(approval.blockId); return next; });
      setError("The decision could not be confirmed. Re-read the request before trying again.");
    } finally {
      pendingWrite.current = false;
      setBusy(false);
    }
  };

  const approvals = request.approvals ?? [];
  if (!approvals.length) return null;
  return <>
    {approvals.map(approval => {
      const sent = submitted.has(approval.blockId);
      return <div key={approval.blockId} className="chat-ask-slot" data-kind="approval">
        <p className="chat-ask-slot-label">{approval.title} · {approval.risk} risk</p>
        {approval.description ? <p className="chat-ask-quote">{approval.description}</p> : null}
        {approval.detail ? <pre className="chat-ask-code">{approval.detail}</pre> : null}
        {approval.state === "pending" && access && !sent ? <div className="chat-ask-actions">
          <button type="button" className="btn btn--accent btn--sm" disabled={busy} onClick={() => void decide(approval, "approve")}>Approve</button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void decide(approval, "deny")}>Deny</button>
        </div> : null}
        <p className="chat-ask-trail" role="status">{approval.state === "pending"
          ? sent ? "Decision submitted · the agent sees it on its next poll." : access ? "This records a request decision. The agent chooses whether to honor it." : "The space owner decides."
          : approval.state === "decided"
            ? `${approval.decision === "deny" ? "Denied" : "Approved"} · decision recorded for the agent.`
            : "No longer active. The request finished before a decision."}</p>
      </div>;
    })}
    {error ? <p className="chat-ask-trail" role="alert">{error}</p> : null}
  </>;
}
