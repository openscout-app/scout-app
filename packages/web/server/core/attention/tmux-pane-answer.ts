/**
 * The operator answering a Claude permission prompt on a tmux pane with Yes or
 * No from the companion, without jumping in.
 *
 * As with a Herdr pane (herdr-permission-answer.ts), this is the operator's own
 * decision. The tap names the dialog it was shown (the prompt's `version`), the
 * pane is read again, and keys go out only while that same dialog is up. Yes
 * presses the dialog's plain Yes, never "don't ask again"; No presses its No,
 * or Esc when it shows none. Anything that is more than Yes or No is answered
 * in the pane. Every send is written to the continuation audit log first. A
 * success receipt means tmux took the keys; Scout has not checked that the
 * prompt closed.
 */

import {
  appendContinuationAudit,
  claimContinuationActuation,
  releaseContinuationActuation,
  type ContinuationAuditEntry,
} from "@openscout/runtime";
import { execSystemFile } from "@openscout/runtime/system-probes";

import { answerablePermissionDialog, keysFor, permissionDialogVersion, type PaneDecision } from "./pane-dialog.ts";

/** The pane an item was read from, as the attention snapshot last saw it. */
export type TmuxPromptPane = { agentId: string; sessionName: string; paneTarget: string };

export type TmuxPaneAnswer =
  | { ok: true; keys: string[]; message: string }
  | { ok: false; code: "not_found" | "changed" | "claimed" | "send_failed"; message: string };

export type TmuxPaneAnswerDeps = {
  /** The pane behind a listed prompt item; null when nothing lists it. */
  findPane: (itemId: string) => Promise<TmuxPromptPane | null>;
  /** The pane's text now. */
  capture: (pane: TmuxPromptPane) => Promise<string | null>;
  sendKeys?: (paneTarget: string, keys: readonly string[]) => Promise<void>;
  audit?: typeof appendContinuationAudit;
  claim?: (key: string, ttlMs: number) => boolean;
  release?: (key: string) => void;
};

const PREFIX = "tmux-host-permission:";
const CLAIM_TTL_MS = 30_000;

export async function answerTmuxPanePrompt(
  input: { itemId: string; version: number; decision: PaneDecision },
  deps: TmuxPaneAnswerDeps,
): Promise<TmuxPaneAnswer> {
  if (!input.itemId.startsWith(PREFIX)) {
    return { ok: false, code: "not_found", message: "That isn't a prompt on a tmux pane." };
  }
  const pane = await deps.findPane(input.itemId).catch(() => null);
  if (!pane) {
    return { ok: false, code: "not_found", message: "The pane isn't waiting on this prompt anymore." };
  }

  const text = await deps.capture(pane).catch(() => null);
  const dialog = answerablePermissionDialog(text);
  if (!dialog || permissionDialogVersion(dialog) !== input.version) {
    return { ok: false, code: "changed", message: "The prompt changed since you saw it. Look at the pane again." };
  }

  const keys = keysFor(dialog, input.decision);
  const audit = deps.audit ?? appendContinuationAudit;
  const record = (outcome: "attempt" | "sent" | "failed" | "claimed-elsewhere") => {
    // The audit row's session fields are named for herdr; `backend` says which multiplexer this was.
    const entry: ContinuationAuditEntry & { backend: "tmux" } = {
      at: Date.now(),
      outcome,
      backend: "tmux",
      herdrSession: pane.sessionName,
      paneId: pane.paneTarget,
      level: "ask",
      grant: "operator:companion",
      command: dialog.command,
      risk: "operator",
      keys,
      source: "rules",
      reason: `operator ${input.decision === "approve" ? "said Yes" : "said No"} from the companion`,
    };
    audit(entry);
  };

  // The same claim continuation takes, for 30 seconds, plus the dialog's fingerprint.
  const claimId = `tmux:${pane.sessionName}:${pane.paneTarget}:${dialog.command ?? ""}:${input.version}`;
  if (!(deps.claim ?? claimContinuationActuation)(claimId, CLAIM_TTL_MS)) {
    try { record("claimed-elsewhere"); } catch { /* nothing was sent */ }
    return { ok: false, code: "claimed", message: "Something else is answering this prompt right now." };
  }

  // No audit row, no keys.
  try {
    record("attempt");
  } catch {
    try { (deps.release ?? releaseContinuationActuation)(claimId); } catch { /* it expires on its own */ }
    return { ok: false, code: "send_failed", message: "Couldn't write the audit record, so nothing was sent." };
  }
  try {
    await (deps.sendKeys ?? sendTmuxKeys)(pane.paneTarget, keys);
  } catch {
    try { record("failed"); } catch { /* the attempt row already stands */ }
    // The next tap reads the pane again and presses only if the same dialog is still up.
    try { (deps.release ?? releaseContinuationActuation)(claimId); } catch { /* it expires on its own */ }
    return { ok: false, code: "send_failed", message: `Couldn't press the key in ${pane.sessionName}'s pane.` };
  }
  try { record("sent"); } catch { /* the attempt row already stands */ }
  return { ok: true, keys, message: "tmux took the keys. Scout has not checked that the prompt closed." };
}

/** tmux key names for the dialog keys: Enter, Escape, or the option's digit. */
export function tmuxKeyNames(keys: readonly string[]): string[] {
  return keys.map((key) => key === "enter" ? "Enter" : key === "esc" ? "Escape" : key);
}

async function sendTmuxKeys(paneTarget: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) throw new Error("refused to send empty keys");
  await execSystemFile("tmux", ["send-keys", "-t", paneTarget, ...tmuxKeyNames(keys)], { timeoutMs: 2_000 });
}
