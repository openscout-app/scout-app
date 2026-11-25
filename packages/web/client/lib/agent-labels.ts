import type { Agent } from "./types.ts";

export function compactAgentId(id: string | null | undefined): string | null {
  const trimmed = id?.trim();
  if (!trimmed) return null;

  const [head] = trimmed.split(".");
  return head?.trim() || trimmed;
}

/** A checkout's folder name: `/example/me/dev/demo-app/` → `demo-app`. */
export function folderName(path: string | null | undefined): string | null {
  const parts = path?.trim().replace(/\/+$/u, "").split("/").filter(Boolean) ?? [];
  return parts[parts.length - 1] ?? null;
}

/** The model without its harness prefix: `claude-fable-5` → `fable-5`. */
export function sessionModelLabel(model: string | null | undefined, harness: string | null | undefined): string | null {
  const value = model?.trim();
  if (!value) return null;
  const prefix = harness?.trim().toLowerCase();
  return prefix && value.toLowerCase().startsWith(`${prefix}-`) ? value.slice(prefix.length + 1) : value;
}

export function minimalAgentHandle(input: {
  handle?: string | null;
  selector?: string | null;
  id?: string | null;
}): string | null {
  const handle = input.handle?.trim().replace(/^@+/, "");
  if (handle) return `@${handle}`;

  const selector = input.selector?.trim();
  if (selector) return selector;

  const compact = compactAgentId(input.id);
  return compact ? `@${compact}` : null;
}

export function minimalAgentDisplayName(input: {
  name?: string | null;
  agentName?: string | null;
  id?: string | null;
  title?: string | null;
}): string {
  return (
    input.name?.trim()
    || input.agentName?.trim()
    || compactAgentId(input.id)
    || input.title?.trim()
    || "Conversation"
  );
}

export function minimalAgentLabel(agent: Agent | null | undefined): string | null {
  if (!agent) return null;
  return minimalAgentDisplayName({
    name: agent.name,
    id: agent.id,
  });
}
