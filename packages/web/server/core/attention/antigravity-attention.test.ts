import { describe, expect, test } from "bun:test";

import { readRemark, sessionReads } from "../../../client/screens/companion/arrivals/board-sessions-model.ts";
import { nativeTranscriptAskAttentionItems } from "./operator-attention-state.ts";

describe("Antigravity operator attention and companion remarks", () => {
  const sessionId = "3a102f26-6237-46c4-ae20-6152148eecaa";
  const now = 1_800_000_000_000;

  test("projects native Antigravity questions and approvals into operator attention items and skips covered sessions", () => {
    const transcripts = [
      {
        source: "antigravity",
        sessionId,
        transcriptPath: `/fixture/brain/${sessionId}/.system_generated/logs/transcript.jsonl`,
        title: "Navigation architecture",
        cwd: "/fixture/openscout",
        project: "openscout",
        harness: "unattributed" as const,
        mtimeMs: now - 2_000,
        size: 512,
        status: "waiting" as const,
        statusUpdatedAt: now - 2_000,
        waitingFor: "Question: Promote sidebar to demo-platform?",
        attention: {
          kind: "ask" as const,
          source: "registry" as const,
          reason: "Question: Promote sidebar to demo-platform?",
          since: now - 2_000,
          pending: {
            toolUseId: "call-1",
            tool: "ask_question",
            title: "Question",
            subject: "Promote sidebar to demo-platform?",
            detail: "Yes · Keep in scout-app",
            subjectKind: null,
            at: now - 2_000,
            alsoPending: 0,
          },
        },
      },
    ];

    const items = nativeTranscriptAskAttentionItems(transcripts, {
      coveredSessionIds: new Set(),
      justSettledSessionIds: new Set(),
      now,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "question",
      title: "Antigravity asked a question",
      summary: "Promote sidebar to demo-platform?",
      detail: "openscout · Yes · Keep in scout-app",
      agentId: `native:antigravity:${sessionId}`,
      agentName: "Navigation architecture",
      sourceLabel: "Antigravity question",
      actions: [
        {
          kind: "open",
          label: "Open session",
          route: { view: "follow", sessionId: `session:antigravity:${sessionId}`, preferredView: "session" },
        },
      ],
    });

    expect(nativeTranscriptAskAttentionItems(transcripts, {
      coveredSessionIds: new Set([sessionId]),
      justSettledSessionIds: new Set(),
      now,
    })).toEqual([]);
  });

  test("companion sessionReads transitions Antigravity turns across WORKING, ASKING, and DONE", () => {
    const events = [
      {
        id: `antigravity:${sessionId}:0`,
        ts: now - 30_000,
        source: "antigravity",
        sessionId,
        pid: 42,
        parentPid: 1,
        project: "openscout",
        cwd: "/fixture/openscout",
        harness: "unattributed" as const,
        kind: "user" as const,
        summary: "Wire AGY permissions",
      },
      {
        id: `antigravity:${sessionId}:1`,
        ts: now - 10_000,
        source: "antigravity",
        sessionId,
        pid: 42,
        parentPid: 1,
        project: "openscout",
        cwd: "/fixture/openscout",
        harness: "unattributed" as const,
        kind: "tool" as const,
        summary: "ask_question",
      },
    ];

    const askingReads = sessionReads({
      events,
      transcripts: [{
        source: "antigravity",
        sessionId,
        transcriptPath: `/fixture/brain/${sessionId}/.system_generated/logs/transcript.jsonl`,
        cwd: "/fixture/openscout",
        project: "openscout",
        harness: "unattributed",
        mtimeMs: now - 5_000,
        size: 256,
        status: "waiting",
        statusUpdatedAt: now - 5_000,
        waitingFor: "Question: Ready to push?",
      }],
    });
    expect(readRemark(askingReads.get(sessionId), { working: false, at: now }, undefined, now)).toEqual({
      remark: "ASKING",
      since: now - 5_000,
      now: "Question: Ready to push?",
    });

    const doneReads = sessionReads({
      events: [
        ...events,
        { ...events[1]!, id: `antigravity:${sessionId}:2`, ts: now - 2_000, kind: "assistant", summary: "All set." },
      ],
      transcripts: [{
        source: "antigravity",
        sessionId,
        transcriptPath: `/fixture/brain/${sessionId}/.system_generated/logs/transcript.jsonl`,
        cwd: "/fixture/openscout",
        project: "openscout",
        harness: "unattributed",
        mtimeMs: now - 1_000,
        size: 512,
        status: "idle",
        statusUpdatedAt: now - 1_000,
      }],
    });
    expect(readRemark(doneReads.get(sessionId), { working: false, at: now }, undefined, now)).toMatchObject({
      remark: "DONE",
      since: now - 1_000,
      now: "All set.",
    });
  });
});
