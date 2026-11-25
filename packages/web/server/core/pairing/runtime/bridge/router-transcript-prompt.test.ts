import { expect, test } from "bun:test";

import { withTranscriptPrompt } from "./router.ts";

test("a Claude user line carries its classified prompt", () => {
  const line = JSON.stringify({ type: "user", message: { role: "user", content: "<system-reminder>be brief</system-reminder>\nFix the lane header." } });
  const out = JSON.parse(withTranscriptPrompt(line));
  expect(out._prompt.words).toBe("Fix the lane header.");
  expect(out._prompt.harnessOnly).toBe(false);
  expect(out.type).toBe("user");
});

test("a Claude background notice is harness-only", () => {
  const line = JSON.stringify({ type: "user", message: { role: "user", content: "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Build finished</summary>\n</task-notification>" } });
  expect(JSON.parse(withTranscriptPrompt(line))._prompt.harnessOnly).toBe(true);
});

test("a Codex user message carries its words; tool results and assistant lines are untouched", () => {
  const codex = JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/tmp</cwd>\n</environment_context>" }, { type: "input_text", text: "Ship it." }] } });
  expect(JSON.parse(withTranscriptPrompt(codex))._prompt.words).toBe("Ship it.");
  const result = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } });
  expect(withTranscriptPrompt(result)).toBe(result);
  const assistant = JSON.stringify({ type: "assistant", message: { content: "hi" } });
  expect(withTranscriptPrompt(assistant)).toBe(assistant);
});
