import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { ObserveSessionSummary, ObserveSummaryTurn } from "../../../shared/api/observe.ts";

const HEAD_BYTES = 128 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;
const TEXT_CHARS = 4000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function parse(line: string): Record<string, unknown> | null {
  try { return record(JSON.parse(line)); } catch { return null; }
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    const block = record(part);
    return ["text", "input_text", "output_text"].includes(String(block?.type)) && typeof block?.text === "string" ? block.text : "";
  }).filter(Boolean).join("\n");
}

/** Read complete JSONL lines only, at most 128 KiB head + 2 MiB tail. */
export type TranscriptTitles = { customTitle?: string; agentName?: string; aiTitle?: string };

export function readSummaryHistory(path: string): {
  content: string;
  summary: ObserveSessionSummary;
  /** Each title kind on its own: a generated custom title must not hide Claude's own. */
  titles: TranscriptTitles;
} {
  const totalBytes = statSync(path).size;
  const fd = openSync(path, "r");
  const read = (start: number, size: number) => {
    const buffer = Buffer.alloc(size);
    const count = readSync(fd, buffer, 0, size, start);
    return buffer.subarray(0, count).toString("utf8");
  };
  let content: string, recent: string, readBytes: number;
  try {
    if (totalBytes <= HEAD_BYTES + TAIL_BYTES) {
      content = recent = read(0, totalBytes);
      readBytes = totalBytes;
    } else {
      const head = read(0, HEAD_BYTES);
      const tail = read(totalBytes - TAIL_BYTES, TAIL_BYTES);
      recent = tail.slice(tail.indexOf("\n") + 1);
      if (!tail.includes("\n")) recent = "";
      content = head.slice(0, head.lastIndexOf("\n") + 1) + recent;
      readBytes = HEAD_BYTES + TAIL_BYTES;
    }
  } finally { closeSync(fd); }
  const titles: TranscriptTitles = {};
  for (const line of content.split("\n")) {
    const entry = parse(line);
    const key = entry?.type === "custom-title" ? "customTitle"
      : entry?.type === "agent-name" ? "agentName" : entry?.type === "ai-title" ? "aiTitle" : null;
    if (entry && key && typeof entry[key] === "string") titles[key] = entry[key] as string;
  }
  return {
    content,
    titles,
    summary: {
      schema: "openscout.session.summary/v1",
      title: titles.customTitle ?? titles.agentName ?? titles.aiTitle ?? null,
      turns: recentSummaryTurns(recent),
      subagents: [], subagentCount: 0, subagentsTruncated: false,
      history: { readBytes, totalBytes, truncated: readBytes < totalBytes },
      usageScope: readBytes < totalBytes ? "window" : "session",
    },
  };
}

/** Native user prompts aren't Observe events; extract them without tool output. */
export function recentSummaryTurns(content: string, limit = 10): ObserveSummaryTurn[] {
  const turns: ObserveSummaryTurn[] = [];
  for (const line of content.split("\n")) {
    const entry = parse(line);
    if (!entry) continue;
    const payload = record(entry.payload);
    const message = record(entry.message);
    let role: unknown = entry.type;
    let body = message?.content ?? entry.content;
    if (entry.type === "response_item" && payload?.type === "message") {
      role = payload.role;
      body = payload.content;
    } else if (entry.type === "event_msg" && payload?.type === "user_message") {
      role = "user"; body = payload.message;
    } else if (entry.type === "event_msg" && payload?.type === "item_completed") {
      const item = record(payload.item);
      if (String(item?.type).replace(/_/gu, "").toLowerCase() === "agentmessage") {
        role = "assistant"; body = item?.text ?? item?.content;
      }
    }
    if (role !== "user" && role !== "assistant") continue;
    const value = text(body).trim();
    if (!value) continue; // tool results, thinking and tool-use blocks aren't prompts/answers.
    const timestamp = entry.timestamp ?? payload?.timestamp;
    const at = typeof timestamp === "number" && Number.isFinite(timestamp) ? (timestamp < 1e12 ? timestamp * 1000 : timestamp)
      : typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : null;
    if (role === "user") {
      const previous = turns.at(-1);
      if (previous?.prompt === value && !previous.answer && previous.at !== null
        && at !== null && Math.abs(at - previous.at) < 1000) continue;
      turns.push({ prompt: value.slice(0, TEXT_CHARS), answer: null, at, truncated: value.length > TEXT_CHARS });
      if (turns.length > 10) turns.shift();
    } else {
      let turn = turns.at(-1);
      if (!turn) { turn = { prompt: null, answer: null, at, truncated: false }; turns.push(turn); }
      const answer = [turn.answer, value].filter(Boolean).join("\n");
      turn.answer = answer.slice(0, TEXT_CHARS);
      turn.truncated ||= answer.length > TEXT_CHARS;
    }
  }
  return limit <= 0 ? [] : turns.slice(-Math.min(10, limit));
}
