import type { OperatorAttentionItem } from "../../lib/types.ts";
import { isRequestDismissal, requestActions } from "./requests-model.ts";
import { decideApproval, decidePermission, dismissRequestRecord } from "./use-request-actions.ts";

/*
 * Clearing open requests from the companion, one or all at once. The runtime
 * ends each one through the same calls a single request uses
 * (useRequestActions); it has no bulk call, so "all" is one call per request,
 * in turn. Nothing is hidden on this page: a request that did not clear stays
 * listed by the runtime, and the line says why.
 *
 *  - A request the runtime can dismiss is dismissed.
 *  - A permission or approval is denied when it cannot be dismissed, or when
 *    the dismissal is refused because a session still waits on it.
 *  - A question with neither needs an answer, and is left.
 */

export type ClearStep = {
  item: OperatorAttentionItem;
  /** The runtime's dismissal record, when it offers one. */
  dismiss: string | null;
  /** It is a permission or an approval with a deny: the way out when it cannot be dismissed. */
  deny: boolean;
};

export type ClearPlan = { steps: ClearStep[]; left: OperatorAttentionItem[] };

export type ClearOutcome = { cleared: number; failed: { item: OperatorAttentionItem; reason: string }[] };

/** How one request clears, or null when only an answer will. */
export function clearStepOf(item: OperatorAttentionItem): ClearStep | null {
  const actions = requestActions(item);
  const dismissal = actions.find((a) => isRequestDismissal(item, a));
  const deny = Boolean(item.permission || item.approval) && actions.some((a) => a.kind === "deny");
  if (!dismissal && !deny) return null;
  return { item, dismiss: dismissal && isRequestDismissal(item, dismissal) ? dismissal.recordId : null, deny };
}

export function clearPlan(items: readonly OperatorAttentionItem[]): ClearPlan {
  const steps: ClearStep[] = [];
  const left: OperatorAttentionItem[] = [];
  for (const item of items) {
    const step = clearStepOf(item);
    if (step) steps.push(step);
    else left.push(item);
  }
  return { steps, left };
}

function deny(item: OperatorAttentionItem): Promise<void> {
  if (item.permission) return decidePermission(item.permission, "deny");
  if (item.approval) return decideApproval(item.approval, "deny");
  return Promise.reject(new Error("Nothing to deny."));
}

/** One request: its dismissal, else (or when a session still waits on it) its deny. */
export async function runClearStep(step: ClearStep): Promise<void> {
  if (step.dismiss) {
    try {
      await dismissRequestRecord(step.dismiss);
      return;
    } catch (cause) {
      const status = (cause as { status?: unknown } | null)?.status;
      if (!(step.deny && status === 409)) throw cause;
    }
  }
  await deny(step.item);
}

/** Every step, in turn; a refusal is kept with its reason and the rest go on. */
export async function clearRequests(steps: readonly ClearStep[], run: (step: ClearStep) => Promise<void> = runClearStep): Promise<ClearOutcome> {
  let cleared = 0;
  const failed: ClearOutcome["failed"] = [];
  for (const step of steps) {
    try {
      await run(step);
      cleared += 1;
    } catch (cause) {
      failed.push({ item: step.item, reason: cause instanceof Error && cause.message ? cause.message : "Refused." });
    }
  }
  return { cleared, failed };
}

const requests = (n: number) => `${n} ${n === 1 ? "request" : "requests"}`;

/** The confirm's question, naming the count. */
export function clearQuestion(plan: ClearPlan): string {
  return `Clear ${requests(plan.steps.length)}?`;
}

/** What clearing does, in a line: which get denied, and what it leaves. */
export function clearNote(plan: ClearPlan): string {
  const denies = plan.steps.some((s) => s.deny);
  const said = denies
    ? plan.steps.every((s) => s.deny && !s.dismiss) ? "Each one is denied." : "Each one is dismissed; a permission still in use is denied."
    : "Each one is dismissed.";
  const left = plan.left.length;
  return left ? `${said} ${left} more ${left === 1 ? "needs" : "need"} an answer.` : said;
}

/** After it ran: how many cleared, and the first reason one did not. */
export function clearResult(outcome: ClearOutcome): string {
  const total = outcome.cleared + outcome.failed.length;
  if (!outcome.failed.length) return `Cleared ${requests(outcome.cleared)}.`;
  const first = outcome.failed[0]!;
  const who = first.item.title?.trim();
  return `Cleared ${outcome.cleared} of ${total}. ${who ? `${who}: ` : ""}${first.reason}`;
}

/** Clear all, ready to confirm: how many, what it does, and the run that says how it went. */
export type ClearAll = {
  count: number;
  question: string;
  note: string;
  run: () => Promise<{ line: string; ok: boolean }>;
};

/** Clear all for these requests, or null when none of them can be cleared. */
export function clearAllOf(items: readonly OperatorAttentionItem[], run: (step: ClearStep) => Promise<void> = runClearStep): ClearAll | null {
  const plan = clearPlan(items);
  if (!plan.steps.length) return null;
  return {
    count: plan.steps.length,
    question: clearQuestion(plan),
    note: clearNote(plan),
    run: async () => {
      const outcome = await clearRequests(plan.steps, run);
      return { line: clearResult(outcome), ok: outcome.failed.length === 0 };
    },
  };
}
