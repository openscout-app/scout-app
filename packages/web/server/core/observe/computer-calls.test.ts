import { expect, test } from "bun:test";
import { computerOperation, transcriptComputerUse } from "./computer-calls.ts";

const at = "2026-01-01T10:00:00Z";
const later = "2026-01-01T10:02:00Z";
const codex = (payload: object, timestamp = at) => JSON.stringify({ type: "response_item", timestamp, payload });
const claude = (type: string, content: object[], timestamp = at) => JSON.stringify({ type, timestamp, message: { content } });

test("Codex journals keep only the operation, explicit matches and real return time", () => {
  const content = [
    codex({ type: "function_call", namespace: "mcp__cua_repl", name: "js", arguments: '{"code":"PRIVATE"}', call_id: "c1" }),
    codex({ type: "computer_call", action: { type: "click", x: 111 }, call_id: "c2" }),
    codex({ type: "function_call", name: "js", arguments: '{"code":"PRIVATE"}', call_id: "c3" }),
    codex({ type: "custom_tool_call", name: "exec", input: 'text(await tools.mcp__lattices__browser_screenshot({}))', call_id: "c4" }),
    codex({ type: "function_call_output", call_id: "c1", output: { isError: true } }, later),
    codex({ type: "computer_call_output", call_id: "c2", output: { type: "computer_screenshot", image_url: "PRIVATE" } }, later),
    codex({ type: "custom_tool_call_output", call_id: "c4", output: '{"runId":"unrelated"}' }, later),
  ].join("\n");
  const calls = transcriptComputerUse(content, "codex")!.calls;
  expect(calls.map(c => c.operation)).toEqual(["Computer interaction", "Click", "Take screenshot"]);
  expect(calls.map(c => c.failed)).toEqual([true, false, false]);
  expect(calls[1]!.returnedAt).toBe(Date.parse(later));
  expect(JSON.stringify(calls)).not.toMatch(/PRIVATE|111|unrelated/);
});

test("Claude results use the tool-use ID, across turns and out of order", () => {
  const content = [
    claude("assistant", [
      { type: "tool_use", id: "a", name: "mcp__action__drive_begin", input: { task: "PRIVATE" } },
      { type: "tool_use", id: "b", name: "mcp__claude-in-chrome__computer", input: { action: "type", text: "PRIVATE" } },
      { type: "text", text: "mcp__action__layer_open" },
    ]),
    claude("user", [{ type: "tool_result", tool_use_id: "b", is_error: true, content: "PRIVATE" }], later),
    claude("user", [{ type: "tool_result", tool_use_id: "a", content: [{ type: "text", text: '{"ok":true,"lease":{"sessionId":"drive-1"}}' }] }], later),
    claude("user", [{ type: "tool_result", tool_use_id: "a", is_error: true }], later),
    claude("assistant", [{ type: "tool_use", id: "c", name: "mcp__lattices__browser_open", input: {} }], later),
  ].join("\n");
  const calls = transcriptComputerUse(content, "claude-code")!.calls;
  expect(calls.map(c => [c.provider, c.operation, c.failed, c.nativeRun])).toEqual([
    ["Action", "Begin drive", false, "action/drive-1"],
    ["Claude in Chrome", "Type text", true, undefined],
    ["Lattices", "Open browser", undefined, undefined],
  ]);
  expect(JSON.stringify(calls)).not.toContain("PRIVATE");
});

test("replays older calls and refuses ambiguous names, scripts and tab IDs", () => {
  const calls = Array.from({ length: 201 }, (_, i) => codex({ type: "function_call", name: "mcp__lattices__browser_open", arguments: "{}", call_id: "b" + i }));
  calls.push(codex({ type: "function_call_output", call_id: "b0", output: { tabId: "tab-1" } }, later));
  calls.push(codex({ type: "function_call_output", call_id: "b1", output: { runId: "../foreign" } }, later));
  const data = transcriptComputerUse(calls.join("\n"), "codex")!;
  expect(data.calls).toHaveLength(201);
  expect(data.calls[0]!.nativeRun).toBeUndefined();
  expect(data.calls[1]!.nativeRun).toBeUndefined();
  expect(computerOperation("exec", 'const example = "await tools.mcp__lattices__browser_open({})"')).toBeUndefined();
  expect(computerOperation("mcp__cua_repl__js", { completion_summary: "Finished" })).toBeUndefined();
  expect(computerOperation("mcpToolCall", { server: "claude-in-chrome", tool: "computer", arguments: { action: "scroll" } })?.operation).toBe("Scroll");
});
