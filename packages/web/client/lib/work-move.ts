export type WebWorkMoveVerdict = "allow" | "deny" | "hold" | "consult";

export type WebWorkMoveDecision = {
  verdict: WebWorkMoveVerdict;
  from: string;
  to: string;
  toState: string;
  reasons: Array<{ ruleId: string; scope: string; check: string; outcome: "pass" | "fail"; effect: string; message: string; shadow?: boolean }>;
  judges: string[];
  review: "pending" | "not_needed";
};

export type WebWorkMove = {
  id: string;
  itemId: string;
  lifecycleId: string;
  from: string;
  to: string;
  moverId: string;
  verdict: WebWorkMoveVerdict;
  decision: WebWorkMoveDecision;
  note?: string;
  revision?: number;
  review: "pending" | "not_needed" | "confirmed" | "reopened" | "consulted" | "stale";
  reviewNote?: string;
  reviewedById?: string;
  reviewedAt?: number;
  createdAt: number;
};

export type WebWorkMoveResponse = { decision: WebWorkMoveDecision; move?: WebWorkMove; applied: boolean };
