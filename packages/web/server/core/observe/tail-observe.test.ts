import { describe, expect, test } from "bun:test";

import { classifyClaudeCodePrompt } from "@openscout/agent-sessions/adapters/claude-code/prompt-markup";
import type { DiscoveredTranscript, TailEvent } from "@openscout/runtime/tail";

import { buildObserveDataFromTail } from "./tail-observe.ts";

const transcript: DiscoveredTranscript = {
  source: "kimi",
  transcriptPath: "/example/test/.kimi-code/sessions/wd_repo/session_123/agents/main/wire.jsonl",
  sessionId: "session_123",
  cwd: "/repo",
  project: "repo",
  harness: "unattributed",
  mtimeMs: 1_700_000_000_000,
  size: 100,
};

function event(overrides: Partial<TailEvent>): TailEvent {
  return {
    id: "kimi:session_123:event",
    ts: 1_700_000_000_000,
    source: "kimi",
    sessionId: "session_123",
    pid: -1,
    parentPid: null,
    project: "repo",
    cwd: "/repo",
    harness: "unattributed",
    kind: "system",
    summary: "event",
    ...overrides,
  };
}

describe("buildObserveDataFromTail Kimi mapping", () => {
  test("maps thinking and clean-log tool activity", () => {
    const data = buildObserveDataFromTail(transcript, [
      event({
        id: "think",
        summary: "[thinking] Inspect the source registry.",
      }),
      event({
        id: "tool",
        ts: 1_700_000_001_000,
        kind: "tool",
        summary: "Read runtime/tail/service.ts",
      }),
      event({
        id: "result",
        ts: 1_700_000_002_000,
        kind: "tool-result",
        summary: "Read runtime/tail/service.ts -> res: export function refreshTailDiscovery",
      }),
    ], true);

    expect(data.events).toEqual([
      expect.objectContaining({ id: "think", kind: "think", text: "Inspect the source registry." }),
      expect.objectContaining({ id: "tool", kind: "tool", tool: "Read", arg: "runtime/tail/service.ts" }),
      expect.objectContaining({
        id: "result",
        kind: "tool",
        tool: "Read",
        arg: "runtime/tail/service.ts",
        result: { outcome: "success" },
      }),
    ]);
    expect(data.metadata?.session?.adapterType).toBe("kimi");
    expect(data.metadata?.session?.externalSessionId).toBe("session_123");
  });
});

describe("buildObserveDataFromTail classified prompts", () => {
  test("a harness-only turn is a system line read from its parts, not an ask", () => {
    const prompt = classifyClaudeCodePrompt("<task-notification>\n<task-id>b2akh</task-id>\n<status>completed</status>\n<summary>Background command \"Start the studio\" completed (exit code 0)</summary>\n</task-notification>");
    const data = buildObserveDataFromTail(transcript, [
      event({ id: "notice", source: "claude", kind: "user", summary: "<task-notification> <task-id>b2akh</task-id> <status>comp…", prompt }),
    ], false);
    expect(data.events[0]).toMatchObject({ kind: "system", text: 'Background command "Start the studio" completed (exit code 0)', prompt });
  });

  test("a mixed turn stays an ask and reads as the operator's words", () => {
    const prompt = classifyClaudeCodePrompt("<system-reminder>be brief</system-reminder>\nMake it full width.");
    const data = buildObserveDataFromTail(transcript, [
      event({ id: "ask", source: "claude", kind: "user", summary: "<system-reminder>be brief</system-reminder> Make it full width.", prompt }),
    ], false);
    expect(data.events[0]).toMatchObject({ kind: "ask", text: "Make it full width." });
  });
});

describe("buildObserveDataFromTail Antigravity structured tools", () => {
  test("preserves structured tool names, line ranges, diffs, command descriptions, exit codes, and touched files", () => {
    const agyTranscript: DiscoveredTranscript = {
      source: "antigravity",
      transcriptPath: "/example/test/.gemini/antigravity-cli/brain/11111111-1111-4111-8111-111111111111/.system_generated/logs/transcript.jsonl",
      sessionId: "11111111-1111-4111-8111-111111111111",
      cwd: "/repo",
      project: "repo",
      harness: "unattributed",
      mtimeMs: 1_700_000_005_000,
      size: 512,
    };
    const data = buildObserveDataFromTail(agyTranscript, [
      event({
        id: "agy:1",
        source: "antigravity",
        ts: 1_700_000_001_000,
        kind: "tool",
        summary: "Read /repo/src/App.tsx:10-40",
        raw: { tool: "Read", toolName: "read_file", path: "/repo/src/App.tsx", arg: "/repo/src/App.tsx:10-40" },
      }),
      event({
        id: "agy:2",
        source: "antigravity",
        ts: 1_700_000_002_000,
        kind: "tool",
        summary: "Edit /repo/src/App.tsx",
        raw: {
          tool: "Edit",
          toolName: "edit_file",
          path: "/repo/src/App.tsx",
          arg: "/repo/src/App.tsx",
          diff: { add: 2, del: 1, preview: "-old\n+new1\n+new2" },
        },
      }),
      event({
        id: "agy:3",
        source: "antigravity",
        ts: 1_700_000_003_000,
        kind: "tool",
        summary: "bun test src/App.test.tsx",
        raw: {
          tool: "Bash",
          toolName: "run_command",
          command: "bun test src/App.test.tsx",
          arg: "bun test src/App.test.tsx",
          description: "Run App unit tests",
        },
      }),
      event({
        id: "agy:4",
        source: "antigravity",
        ts: 1_700_000_004_000,
        kind: "tool-result",
        summary: "res: exit code 1",
        raw: { content: "exit code 1", tool: "res", exitCode: 1, outcome: "error" },
      }),
    ], false);

    expect(data.events).toEqual([
      expect.objectContaining({ id: "agy:1", kind: "tool", tool: "Read", arg: "/repo/src/App.tsx:10-40" }),
      expect.objectContaining({
        id: "agy:2",
        kind: "tool",
        tool: "Edit",
        arg: "/repo/src/App.tsx",
        diff: { add: 2, del: 1, preview: "-old\n+new1\n+new2" },
      }),
      expect.objectContaining({
        id: "agy:3",
        kind: "tool",
        tool: "Bash",
        arg: "bun test src/App.test.tsx",
        stream: ["Run App unit tests"],
      }),
      expect.objectContaining({
        id: "agy:4",
        kind: "tool",
        tool: "res",
        result: { outcome: "error", exitCode: "1" },
        stream: ["exit code 1"],
      }),
    ]);
    expect(data.files).toEqual([
      { path: "/repo/src/App.tsx", state: "modified", touches: 2, lastT: 1 },
    ]);
  });
});
