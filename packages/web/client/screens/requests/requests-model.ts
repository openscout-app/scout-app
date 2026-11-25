import type { OperatorAttentionAction, OperatorAttentionItem } from "../../lib/types.ts";

/** A live item keeps its place when severity, age, or badge state changes. */
export function stableRequestItems(previous: readonly OperatorAttentionItem[], incoming: readonly OperatorAttentionItem[]): OperatorAttentionItem[] {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const result: OperatorAttentionItem[] = [];
  for (const item of previous) {
    const current = byId.get(item.id);
    if (current) { result.push(current); byId.delete(item.id); }
  }
  return [...result, ...byId.values()];
}

export function requestsCountState(count: number) {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return { count: value, attention: value > 0 };
}

/**
 * Requests lists only what the broker declared as waiting on the operator:
 * approvals, questions addressed to them, and permission requests (including a
 * harness prompt observed in a terminal). Work items,
 * delivery failures and inferred session states never count (operator rule:
 * inferred "needs you" is usually wrong).
 */
export function isDeclaredRequest(item: OperatorAttentionItem): boolean {
  if (item.id.startsWith("tmux-host-permission:")) return true; // a harness permission prompt on screen
  // Ready is declared too: the runtime wrote it on the flight because the operator asked to hear about the task.
  if (isReadyRequest(item)) return true;
  return item.kind === "approval" || item.kind === "question" || item.kind === "configuration";
}

/** A Ready task: the operator asked to hear when it was done, and it is. Continue or Hold, never an answer. */
export function isReadyRequest(item: OperatorAttentionItem): item is OperatorAttentionItem & { ready: NonNullable<OperatorAttentionItem["ready"]> } {
  return item.kind === "ready" && Boolean(item.ready);
}

export function requestKind(item: OperatorAttentionItem): string {
  if (isReadyRequest(item)) return "Ready";
  if (item.kind === "approval") return "Approval";
  // A dialog on a pane says what it is: a plan to approve, or a question or menu that is not a permission.
  const promptKind = item.pane?.prompt?.kind;
  if (promptKind === "plan") return "Approval";
  if (promptKind === "question" || promptKind === "unknown") return "Ask";
  if (item.kind === "configuration" || item.id.startsWith("tmux-host-permission:") || /permission/i.test(item.sourceLabel)) return "Permission request";
  // The attention API also includes failures, which are not answerable asks.
  if (item.kind === "ask" || (item.kind === "session" && /action|error|failure/i.test(item.sourceLabel))) return "Notice";
  return "Ask";
}

/** The kind as a row's tag, one word so a row's kind column never clips it. */
export function requestKindTag(item: OperatorAttentionItem): string {
  const kind = requestKind(item);
  return kind === "Permission request" ? "Permission" : kind;
}

/** Only decisions declared by a backed approval or permission record, plus source links and the runtime's dismissal. */
export function requestActions(item: OperatorAttentionItem): OperatorAttentionAction[] {
  return item.actions.filter((action) => {
    if (action.kind === "open") return Boolean(action.route);
    if (isRequestDismissal(item, action)) return true;
    if (isReadyRequest(item)) return action.kind === "continue" || action.kind === "hold";
    return (Boolean(item.permission) || answersOnPane(item) || (item.kind === "approval" && Boolean(item.approval)))
      && (action.kind === "approve" || action.kind === "deny");
  });
}

/** A plain permission dialog on a tmux pane: Yes and No answer it from here, as keys in the pane. */
export function answersOnPane(item: OperatorAttentionItem): boolean {
  return item.pane?.prompt?.answerable === true;
}

const PANE_PROMPT_WHAT: Record<NonNullable<NonNullable<OperatorAttentionItem["pane"]>["prompt"]>["kind"], string> = {
  permission: "A permission prompt",
  plan: "A plan approval",
  hold: "An action auto mode held",
  question: "A question",
  unknown: "A prompt",
};

/**
 * What a pane is waiting on when it is more than Yes or No: what kind of dialog, and how many choices its menu
 * offers. Null when Yes and No answer it from here.
 */
export function panePromptNote(pane: NonNullable<OperatorAttentionItem["pane"]>): string | null {
  const prompt = pane.prompt;
  if (prompt?.answerable) return null;
  if (!prompt || (prompt.kind === "unknown" && prompt.choices === 0)) return "Jump in to answer it in the pane.";
  const choices = prompt.choices > 0 ? `, with ${prompt.choices} ${prompt.choices === 1 ? "choice" : "choices"}` : "";
  return `${PANE_PROMPT_WHAT[prompt.kind]}${choices}. Jump in to choose in the pane.`;
}

/** A permission request or an agent's question to the operator: the runtime itself ends its record when it is dismissed. */
export function isRequestDismissal(item: OperatorAttentionItem, action: OperatorAttentionAction): action is OperatorAttentionAction & { recordId: string } {
  return action.kind === "dismiss" && action.recordKind === "question" && Boolean(action.recordId)
    && (Boolean(item.permission) || item.id.startsWith("need:"));
}

export function requestActionLabel(action: OperatorAttentionAction): string {
  if (action.kind === "open" && action.route
    && (action.route.view === "conversation" || action.route.view === "messages"
      || (action.route.view === "follow" && action.route.preferredView === "chat"))) return "Open conversation";
  return action.label;
}

/** A permission request's "don't ask again" decision. */
export function isAlwaysAllow(action: Pick<OperatorAttentionAction, "kind" | "value">): boolean {
  return action.kind === "approve" && action.value === "project";
}

/**
 * The approve a surface leads with: its accent and its one-key shortcut. Allow once, never Allow always, whatever
 * order the harness listed them in; a request that offers only Allow always has no lead, so no key keeps a rule.
 */
export function leadApprove<T extends Pick<OperatorAttentionAction, "kind" | "value">>(actions: readonly T[]): T | undefined {
  return actions.find((action) => action.kind === "approve" && !isAlwaysAllow(action));
}

/** One line of a harness prompt as its terminal drew it. */
export type TerminalLine = { text: string; tone: "head" | "cursor" | "hint" | "plain" };

const CURSOR_LINE = /^\s*[❯›>]\s/u;
const OPTION_LINE = /^\s*(?:[❯›>]\s*)?\d+\.\s+\S/u;
const HINT_LINE = /^\s*(?:esc to |enter to |tab to |shift\+tab|ctrl\+|press )/iu;

/**
 * A permission prompt captured from a terminal pane, line by line with its spacing, or null when the text is prose.
 * It counts as a screen when it draws a choice: the harness's cursor (❯) or two numbered options.
 */
export function terminalScreen(text: string | null | undefined): TerminalLine[] | null {
  if (!text || !text.includes("\n")) return null;
  const lines = text.replace(/\t/g, "    ").split(/\r?\n/u).map((line) => line.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length < 3) return null;
  const drawsChoice = lines.some((line) => CURSOR_LINE.test(line)) || lines.filter((line) => OPTION_LINE.test(line)).length >= 2;
  if (!drawsChoice) return null;
  return lines.map((text, index) => ({
    text,
    tone: CURSOR_LINE.test(text) ? "cursor" : HINT_LINE.test(text) ? "hint" : index === 0 ? "head" : "plain",
  }));
}

/** What Allow always keeps, when the request offers it: the harness's own rules, or its project scope when it names none. */
export function alwaysAllowLine(item: OperatorAttentionItem): string | null {
  if (!item.permission || !item.actions.some(isAlwaysAllow)) return null;
  const rules = item.permission.native?.alwaysRules ?? [];
  return rules.length ? `Allow always keeps: ${rules.join(", ")}` : "Allow always stops the harness asking again for this in the project.";
}

/** A decision's hover text: Allow always says what it keeps. */
export function requestActionTitle(item: OperatorAttentionItem, action: OperatorAttentionAction): string | undefined {
  return isAlwaysAllow(action) ? alwaysAllowLine(item) ?? undefined : undefined;
}

export function requestUpdatedAge(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "Update time unavailable";
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 60) return `updated ${minutes}m ago`;
  if (minutes < 48 * 60) return `updated ${Math.floor(minutes / 60)}h ago`;
  return `updated ${Math.floor(minutes / 1440)}d ago`;
}
