import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSummaryHistory, recentSummaryTurns } from "./session-summary.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const jsonl = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";
const file = (content: string) => {
  const root = mkdtempSync(join(tmpdir(), "session-summary-")); roots.push(root);
  const path = join(root, "session.jsonl"); writeFileSync(path, content); return path;
};

test("bounded head/tail read excludes the middle and never presents old head prompts as recent", () => {
  const content = jsonl([
    { type: "custom-title", customTitle: "Exact title" },
    { type: "user", message: { content: "old prompt" } },
    { type: "tool_result", content: "x".repeat(3 * 1024 * 1024) },
    { type: "user", timestamp: "2026-10-15T12:00:00Z", message: { content: "recent prompt" } },
    { type: "assistant", message: { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "recent answer" }] } },
  ]);
  const sample = readSummaryHistory(file(content));
  expect(sample.summary.history).toMatchObject({ readBytes: 2228224, totalBytes: Buffer.byteLength(content), truncated: true });
  expect(sample.summary.usageScope).toBe("window");
  expect(sample.content).not.toContain('"type":"tool_result"');
  expect(sample.summary.title).toBe("Exact title");
  expect(sample.summary.turns).toEqual([{ prompt: "recent prompt", answer: "recent answer", at: Date.parse("2026-10-15T12:00:00Z"), truncated: false }]);
});

test("small journals preserve title precedence, prompts and text answers, not tool payloads", () => {
  const sample = readSummaryHistory(file(jsonl([
    { type: "custom-title", customTitle: "Custom" },
    { type: "agent-name", agentName: "Agent" }, { type: "ai-title", aiTitle: "AI" },
    { type: "user", message: { content: [{ type: "text", text: "question" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "huge tool payload" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "answer" }, { type: "tool_use", input: { token: "no" } }] } },
  ])));
  expect(sample.summary.title).toBe("Custom");
  expect(sample.summary.history?.truncated).toBe(false);
  expect(sample.summary.usageScope).toBe("session");
  expect(sample.summary.turns[0]).toMatchObject({ prompt: "question", answer: "answer" });
});

test("Codex structured messages work, role instructions do not leak, and prompt representations dedupe", () => {
  const content = jsonl([
    { type: "response_item", timestamp: "2026-10-15T12:00:00Z", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "instructions" }] } },
    { type: "response_item", timestamp: "2026-10-15T12:00:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "question" }] } },
    { type: "event_msg", timestamp: "2026-10-15T12:00:00Z", payload: { type: "user_message", message: "question" } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", text: "answer", phase: "final" } } },
  ]);
  expect(recentSummaryTurns(content)).toEqual([{ prompt: "question", answer: "answer", at: Date.parse("2026-10-15T12:00:00Z"), truncated: false }]);
});

test("turn count and text length are capped, malformed/partial lines do not fail", () => {
  const content = jsonl(Array.from({ length: 20 }, (_, i) => ({ type: "user", message: { content: String(i) } })));
  expect(recentSummaryTurns(content)).toHaveLength(10);
  expect(recentSummaryTurns(content, 3).map((t) => t.prompt)).toEqual(["17", "18", "19"]);
  expect(recentSummaryTurns(content, 0)).toEqual([]);
  expect(recentSummaryTurns('{"partial":\n' + jsonl([
    { type: "assistant", message: { content: [{ type: "text", text: "x".repeat(6000) }] } },
  ]))[0]).toMatchObject({ prompt: null, answer: "x".repeat(4000), truncated: true });
});
