/**
 * What a permission request asks to do, read the same way wherever it is
 * shown: the companion (Scoutbot, the tap-in board) and Home.
 *
 * `permissionPresentation` decodes only a known native approval payload, a
 * command waiting to run; prose and unknown schemas stay as they are.
 * `permissionAsk` widens that to every permission the runtime describes: the
 * same command payload, a harness's own permission (its tool and target), or
 * the command a terminal dialog showed. Pure.
 */
import type { OperatorAttentionItem } from "./types.ts";

export type PermissionPresentation = { command: string; reason: string | null; cwd: string };

/** Decode only known native approval payloads; prose and unknown schemas stay visible. */
export function permissionPresentation(item: OperatorAttentionItem): PermissionPresentation | null {
  if (!item.permission || !item.summary) return null;
  try {
    const payload = JSON.parse(item.summary) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (payload.method !== "item/commandExecution/requestApproval" || typeof payload.command !== "string" || !payload.command.trim()) return null;
    return {
      command: payload.command,
      reason: typeof payload.reason === "string" ? payload.reason : null,
      cwd: typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : item.permission.projectRoot,
    };
  } catch {
    return null;
  }
}

export type PermissionAsk = {
  /** What kind of thing it does, in the harness's words ("Bash", "Edit"); null when only a command is known. */
  tool: string | null;
  /** The thing itself, shown in mono: the command, or the tool's target or path. */
  action: string;
  /** Why the agent wants it, when the request says. */
  reason: string | null;
  /** The folder it runs in, when the request says. */
  cwd: string | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A terminal dialog's permission (tmux or Herdr pane): the runtime puts the dialog's command in the detail. */
function paneDialog(item: OperatorAttentionItem): boolean {
  return item.pane?.prompt?.kind === "permission" || /^(?:tmux-host|herdr)-permission:/u.test(item.id);
}

/** What a permission asks to do; null when it is not a permission or says nothing concrete. */
export function permissionAsk(item: OperatorAttentionItem): PermissionAsk | null {
  const command = permissionPresentation(item);
  if (command) return { tool: null, action: command.command, reason: text(command.reason), cwd: text(command.cwd) };
  const native = item.permission?.native;
  const display = native?.display;
  const target = text(display?.command) ?? text(display?.target) ?? text(display?.fields?.find((f) => text(f.value))?.value);
  if (native && target) {
    return { tool: text(display?.action) ?? text(native.tool), action: target, reason: text(display?.note), cwd: text(item.permission?.projectRoot) };
  }
  if (paneDialog(item) && text(item.detail)) return { tool: null, action: text(item.detail)!, reason: null, cwd: text(item.permission?.projectRoot) };
  return null;
}
