/*
 * A native session's permission request, as the runtime records it
 * (metadata.permissionRequest.native): which harness asked, which tool, and
 * the request laid out in parts (`display`) so a surface never parses the
 * summary text. Older runtimes send no display; the summary stands alone then.
 */

export type NativePermissionDisplay = {
  action: string;
  command?: string;
  target?: string;
  note?: string;
  questions?: Array<{ header?: string; question: string; options: Array<{ label: string; description?: string }> }>;
  fields?: Array<{ key: string; value: string }>;
};

/** `alwaysRules`: what Allow always keeps, as Claude Code writes the rules ("Bash(npm test:*)"). */
export type NativePermission = { harness: string; tool: string; display?: NativePermissionDisplay; alwaysRules?: string[] };

const MAX = { action: 160, command: 2_000, text: 600, label: 120, items: 8 };

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX.items) : [];
}

/** The runtime's display, kept to the parts and sizes it promises; anything else is dropped. */
export function parseNativePermissionDisplay(value: unknown): NativePermissionDisplay | undefined {
  const raw = record(value);
  const action = str(raw?.action, MAX.action);
  if (!raw || !action) return undefined;
  const display: NativePermissionDisplay = { action };
  const command = str(raw.command, MAX.command);
  const target = str(raw.target, MAX.text);
  const note = str(raw.note, MAX.text);
  if (command) display.command = command;
  if (target) display.target = target;
  if (note) display.note = note;
  const questions = list(raw.questions).flatMap((entry) => {
    const q = record(entry);
    const question = str(q?.question, MAX.text);
    if (!q || !question) return [];
    const header = str(q.header, MAX.label);
    const options = list(q.options).flatMap((o) => {
      const option = record(o);
      const label = str(option?.label, MAX.label);
      const description = str(option?.description, MAX.text);
      return label ? [{ label, ...(description ? { description } : {}) }] : [];
    });
    return [{ ...(header ? { header } : {}), question, options }];
  });
  if (questions.length) display.questions = questions;
  const fields = list(raw.fields).flatMap((f) => {
    const entry = record(f);
    const key = str(entry?.key, MAX.label);
    const val = str(entry?.value, MAX.text);
    return key && val ? [{ key, value: val }] : [];
  });
  if (fields.length) display.fields = fields;
  return display;
}

export function parseNativePermission(value: unknown): NativePermission | undefined {
  const raw = record(value);
  const harness = str(raw?.harness, 40);
  const tool = str(raw?.tool, 200);
  if (!raw || !harness || !tool) return undefined;
  const display = parseNativePermissionDisplay(raw.display);
  const alwaysRules = Array.isArray(raw.alwaysRules)
    ? raw.alwaysRules.slice(0, 8).map((rule) => str(rule, 300)).filter((rule): rule is string => Boolean(rule))
    : [];
  return { harness, tool, ...(display ? { display } : {}), ...(alwaysRules.length ? { alwaysRules } : {}) };
}

const HARNESS_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "Grok", kimi: "Kimi", antigravity: "Antigravity" };

/**
 * A native session's actor (`native:claude:<session id>`) has no card, so no
 * display name: it reads as its harness and the session's short id, as a
 * session is named elsewhere ("Claude d158a9ca"). Null for any other actor.
 */
export function nativeActorName(actorId: string): string | null {
  const match = /^native:([a-z0-9_-]+):([A-Za-z0-9._-]+)$/iu.exec(actorId);
  if (!match) return null;
  const harness = match[1]!.toLowerCase();
  const name = HARNESS_NAMES[harness] ?? `${harness.charAt(0).toUpperCase()}${harness.slice(1)}`;
  return `${name} ${match[2]!.slice(0, 8)}`;
}
