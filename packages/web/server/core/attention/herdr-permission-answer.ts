/**
 * The operator answering a Claude permission prompt in a Herdr pane from
 * another device (the phone or iPad, by its inbox item), or from the companion
 * on this host (by its continuation stop), without opening the terminal.
 *
 * This is the operator's own decision, not continuation: no grant is consulted
 * and nothing is decided for them. The tap names the dialog it was shown (the
 * item's `version`), the pane is read again, and keys go out only while that
 * same dialog is still up. Approve presses the dialog's plain Yes (never
 * "don't ask again"); Deny presses its No, or Esc when it shows none. Every
 * send is written to the continuation audit log first. A success receipt means
 * Herdr accepted the keys; Scout has not checked that the prompt closed.
 */

import type { HerdrPaneProjection } from "@openscout/protocol";
import {
  appendContinuationAudit,
  claimContinuationActuation,
  releaseContinuationActuation,
} from "@openscout/runtime";
import { execSystemFile } from "@openscout/runtime/system-probes";

import { keysFor, type PaneDecision } from "./pane-dialog.ts";
import {
  answerablePermissionDialog,
  captureHerdrPane,
  herdrPaneItemKey,
  permissionDialogVersion,
  readBlockedHerdrPanes,
  type HerdrBlockedPane,
} from "./herdr-host-attention.ts";

export type HerdrPermissionDecision = PaneDecision;

export { keysFor };

export type HerdrPermissionAnswer =
  | { ok: true; keys: string[]; location: string; message: string }
  | { ok: false; code: "not_found" | "changed" | "claimed" | "send_failed"; message: string };

export type HerdrPermissionAnswerDeps = {
  readBlockedPanes?: () => Promise<HerdrBlockedPane[]>;
  capture?: (session: string, pane: HerdrPaneProjection) => Promise<string | null>;
  sendKeys?: (session: string, target: string, keys: readonly string[]) => Promise<void>;
  audit?: typeof appendContinuationAudit;
  claim?: (key: string, ttlMs: number) => boolean;
  release?: (key: string) => void;
};

const PREFIX = "herdr-permission:";
/** The companion's item for a blocked Claude pane (herdr-continuation.ts): `<session>:<terminal or pane id>`. */
const CONTINUATION_PREFIX = "herdr-continuation:";
const CLAIM_TTL_MS = 30_000;

/** Where the operator answered: the phone or iPad (its inbox item), or the companion on this host (its stop). */
export type HerdrPermissionAnswerFrom = "device" | "companion";

export async function answerHerdrPermission(
  input: { itemId: string; version: number; decision: HerdrPermissionDecision; from?: HerdrPermissionAnswerFrom },
  deps: HerdrPermissionAnswerDeps = {},
): Promise<HerdrPermissionAnswer> {
  const matches = paneMatcher(input.itemId);
  if (!matches) {
    return { ok: false, code: "not_found", message: "That isn't a terminal permission prompt." };
  }
  const panes = await (deps.readBlockedPanes ?? readBlockedHerdrPanes)().catch(() => []);
  const match = panes.find(({ session, pane }) => matches(session, pane));
  if (!match) {
    return { ok: false, code: "not_found", message: "The terminal isn't waiting on this prompt anymore." };
  }

  const { session, pane } = match;
  const location = `Herdr ${session} · ${pane.paneId}`;
  const text = await (deps.capture ?? captureHerdrPane)(session, pane).catch(() => null);
  const dialog = answerablePermissionDialog(text);
  if (!dialog || permissionDialogVersion(dialog) !== input.version) {
    return { ok: false, code: "changed", message: "The prompt changed since you saw it. Refresh and look again." };
  }

  const keys = keysFor(dialog, input.decision);
  const audit = deps.audit ?? appendContinuationAudit;
  const record = (outcome: "attempt" | "sent" | "failed" | "claimed-elsewhere") => audit({
    at: Date.now(),
    outcome,
    herdrSession: session,
    paneId: pane.paneId,
    level: "ask",
    grant: input.from === "companion" ? "operator:companion" : "operator:remote",
    command: dialog.command,
    risk: "operator",
    keys,
    source: "rules",
    reason: input.from === "companion"
      ? `operator ${input.decision === "approve" ? "said Yes" : "said No"} from the companion`
      : `operator ${input.decision === "approve" ? "approved" : "denied"} from another device`,
  });

  // The same claim as continuation excludes competing claim acquisitions for
  // a 30-second window, not indefinitely. It does not verify a prompt answer.
  const claimKey = `${session}:${pane.terminalId ?? pane.paneId}:${dialog.command ?? ""}`;
  // Plus the dialog's fingerprint: herdr's visible read often cuts off the
  // command, so the parsed command alone can't tell one prompt from the next.
  const claimId = `${claimKey}:${input.version}`;
  if (!(deps.claim ?? claimContinuationActuation)(claimId, CLAIM_TTL_MS)) {
    try { record("claimed-elsewhere"); } catch { /* nothing was sent */ }
    return { ok: false, code: "claimed", message: "Something else is answering this prompt right now." };
  }

  // No audit row, no keys.
  try {
    record("attempt");
  } catch {
    return { ok: false, code: "send_failed", message: "Couldn't write the audit record, so nothing was sent." };
  }
  // herdr's agent commands take the pane id; a terminal id is "agent_not_found".
  try {
    await (deps.sendKeys ?? sendHerdrKeys)(session, pane.paneId, keys);
  } catch {
    try { record("failed"); } catch { /* the attempt row already stands */ }
    // Give the claim back so the operator's next tap is answered, not refused
    // as "something else is answering". That tap reads the pane again and
    // presses only if this same dialog is still up.
    try { (deps.release ?? releaseContinuationActuation)(claimId); } catch { /* it expires on its own */ }
    return { ok: false, code: "send_failed", message: `Couldn't press the key in ${location}.` };
  }
  try { record("sent"); } catch { /* the attempt row already stands */ }
  return { ok: true, keys, location, message: "Herdr accepted the keys. Scout has not checked that the prompt closed." };
}

/** Which blocked pane an item id names, or null when it names none Scout answers. */
function paneMatcher(itemId: string): ((session: string, pane: HerdrPaneProjection) => boolean) | null {
  if (itemId.startsWith(PREFIX)) {
    const key = itemId.slice(PREFIX.length);
    return (session, pane) => herdrPaneItemKey(session, pane) === key;
  }
  if (itemId.startsWith(CONTINUATION_PREFIX)) {
    const key = itemId.slice(CONTINUATION_PREFIX.length);
    return (session, pane) => `${session}:${pane.terminalId ?? pane.paneId}` === key;
  }
  return null;
}

async function sendHerdrKeys(session: string, target: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) throw new Error("refused to send empty keys");
  await execSystemFile("herdr", ["--session", session, "agent", "send-keys", target, ...keys], {
    timeoutMs: 2_000,
  });
}
