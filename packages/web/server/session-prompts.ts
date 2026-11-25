/**
 * The operator's prompts, read from a session's history file.
 *
 * Observe turns carry only the agent's blocks, so the human side of a
 * session lives only in the harness transcript. This reads the tail of a
 * Claude Code or Codex JSONL transcript and keeps what the operator typed:
 * full prompts and mid-turn messages. Each harness's adapter splits its own
 * markup out (agent-sessions/adapters/<harness>/prompt-markup.ts).
 */

import { open } from "node:fs/promises";

import { classifyHarnessPrompt } from "@openscout/agent-sessions/prompt-classifiers";

export type SessionPrompt = { text: string; at: number | null };

/** Prompts past this are older than any read needs. */
const TAIL_BYTES = 6 * 1024 * 1024;

/** The operator's words in a turn, split out by the harness's own adapter
 *  (which knows its markup); empty when the turn holds none. */
function operatorWords(harness: "claude" | "codex", raw: string, meta = false): string | null {
  const words = classifyHarnessPrompt(harness, raw, { meta })?.words.trim() ?? "";
  return words || null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function textBlocks(content: unknown, type: string): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "tool_result")) {
    return null;
  }
  const parts = content
    .filter((block): block is { type: string; text: string } =>
      !!block && typeof block === "object"
      && (block as { type?: unknown }).type === type
      && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text);
  return parts.length ? parts.join("\n") : null;
}

/** One transcript line → the operator prompt it carries, if any. */
export function promptFromTranscriptLine(line: string): SessionPrompt | null {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Claude Code: a user turn.
  if (entry.type === "user" && !entry.isMeta && !entry.isSidechain) {
    const message = entry.message as { content?: unknown } | undefined;
    const text = operatorWords("claude", textBlocks(message?.content, "text") ?? "");
    return text ? { text, at: timestamp(entry.timestamp) } : null;
  }
  // Claude Code: a message the operator sent mid-turn.
  if (entry.type === "attachment") {
    const attachment = entry.attachment as Record<string, unknown> | undefined;
    const origin = attachment?.origin as { kind?: unknown } | undefined;
    if (attachment?.type === "queued_command" && origin?.kind === "human" && typeof attachment.prompt === "string") {
      const text = operatorWords("claude", attachment.prompt);
      return text ? { text, at: timestamp(attachment.timestamp ?? entry.timestamp) } : null;
    }
    return null;
  }
  // Codex: a user message item, or the older user_message event.
  const payload = entry.payload as Record<string, unknown> | undefined;
  if (entry.type === "response_item" && payload?.type === "message" && payload.role === "user") {
    const text = operatorWords("codex", textBlocks(payload.content, "input_text") ?? "");
    return text ? { text, at: timestamp(entry.timestamp) } : null;
  }
  if (entry.type === "event_msg" && payload?.type === "user_message" && typeof payload.message === "string") {
    const text = operatorWords("codex", payload.message);
    return text ? { text, at: timestamp(entry.timestamp) } : null;
  }
  return null;
}

/** Operator prompts from a transcript, oldest first. Empty when unreadable. */
export async function readSessionPrompts(historyPath: string | null | undefined): Promise<SessionPrompt[]> {
  if (!historyPath?.endsWith(".jsonl")) return [];
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(historyPath, "r");
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    // A tail read starts mid-line; drop the partial first line.
    if (start > 0) lines.shift();
    const prompts: SessionPrompt[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const prompt = promptFromTranscriptLine(line);
      // Codex can log one prompt as both an item and an event.
      if (prompt && prompts.at(-1)?.text !== prompt.text) prompts.push(prompt);
    }
    return prompts;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}
