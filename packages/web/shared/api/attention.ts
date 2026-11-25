import { z } from "zod";

export const approvalDecisionBody = z.object({
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  blockId: z.string().optional(),
  version: z.number().optional(),
  decision: z.string().optional(),
  reason: z.string().nullable().optional(),
});
export type ApprovalDecisionBody = z.input<typeof approvalDecisionBody>;

export const permissionRevealBody = z.object({ requestId: z.string().min(1) });

export const permissionDecisionBody = z.object({
  requestId: z.string().min(1), version: z.string().min(1), decision: z.enum(["once", "project", "deny"]),
});

/** Yes or No to the plain permission dialog on a tmux pane, naming the dialog (its version) the operator saw. */
export const panePromptAnswerBody = z.object({
  itemId: z.string().min(1), version: z.number().int().nonnegative(), decision: z.enum(["approve", "deny"]),
});

export const requestDismissBody = z.object({ requestId: z.string().min(1) });

/** Continue or Hold on a Ready task: `ref` is its flight or invocation id. */
export const taskReadyDecisionBody = z.object({
  ref: z.string().min(1), decision: z.enum(["continue", "hold"]), requestId: z.string().min(1).optional(),
});

/** Ask to hear, or stop hearing, when a running task is done. */
export const taskNotifyBody = z.object({ ref: z.string().min(1), notify: z.boolean() });
