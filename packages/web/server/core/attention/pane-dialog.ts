/**
 * A Claude dialog read off a terminal pane, as the companion and the answer
 * paths need it. The core's `parseContinuationDialog` does the reading; this
 * decides what the operator may answer from another surface.
 *
 * Only a plain permission dialog is answered from outside the pane, and only
 * with Yes or No. Its "don't ask again" and "tell Claude what to do" choices,
 * a plan approval, a held action, or a menu Scout could not read are answered
 * in the pane itself.
 */

import {
  parseContinuationDialog,
  type ContinuationDialog,
} from "@openscout/runtime";

export type PaneDecision = "approve" | "deny";

/** What a pane is waiting on, for the companion: which kind, how many choices, and whether Yes / No can answer it. */
export type PanePrompt = {
  kind: ContinuationDialog["kind"];
  /** The dialog's fingerprint; an answer names it, and keys go out only while the same dialog is up. */
  version: number;
  /** How many numbered choices its menu offers (0 when Scout could not read one). */
  choices: number;
  /** A plain permission dialog with a Yes to press. */
  answerable: boolean;
};

/**
 * A live Claude permission dialog the operator can answer remotely: parsed,
 * still on screen, with a plain Yes to press.
 */
export function answerablePermissionDialog(paneText: string | null): ContinuationDialog | null {
  if (!paneText) return null;
  const dialog = parseContinuationDialog(paneText);
  return isAnswerable(dialog) ? dialog : null;
}

/** The live dialog on a pane, whatever it asks; null when none is up. */
export function livePanePrompt(paneText: string | null): { dialog: ContinuationDialog; prompt: PanePrompt } | null {
  if (!paneText) return null;
  const dialog = parseContinuationDialog(paneText);
  if (!dialog.live) return null;
  return {
    dialog,
    prompt: {
      kind: dialog.kind,
      version: permissionDialogVersion(dialog),
      choices: dialog.options.length,
      answerable: isAnswerable(dialog),
    },
  };
}

function isAnswerable(dialog: ContinuationDialog): boolean {
  return dialog.live && dialog.kind === "permission" && dialog.options.some((option) => option.kind === "allow");
}

/** A stable 31-bit fingerprint of what the dialog asks and offers. */
export function permissionDialogVersion(dialog: ContinuationDialog): number {
  const text = [
    dialog.title ?? "",
    dialog.command ?? "",
    dialog.permissionRule ?? "",
    ...dialog.options.map((option) => `${option.index}.${option.label}`),
  ].join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 0x7fffffff;
}

/**
 * The key that gives a dialog's plain Yes or No: that option's number, never
 * Enter. Enter takes whatever the cursor is on when the key lands, and the
 * cursor can move between the read and the send (someone in the pane, or the
 * operator jumped in), which could press "don't ask again". A number names its
 * option. No with no No option is Esc, which cancels.
 */
export function keysFor(dialog: ContinuationDialog, decision: PaneDecision): string[] {
  const option = dialog.options.find((candidate) => candidate.kind === (decision === "approve" ? "allow" : "deny"));
  if (!option) return decision === "deny" ? ["esc"] : [];
  return [String(option.index)];
}
