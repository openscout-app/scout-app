import { describe, expect, test } from "bun:test";
import type { ScoutDeliverRequest, ScoutDeliverResponse } from "@openscout/protocol";
import { recordedWebReply } from "./recorded-reply.ts";

const runtime = { baseUrl: "http://example.invalid", expectedNodeId: "test-host" };
const input = { sessionId: "native", harness: "codex", body: "Ship it.", clientMessageId: "click1" };
const accepted = {
  kind: "delivery",
  accepted: true,
  targetSessionId: input.sessionId,
  conversation: { id: "chat" },
  message: { id: "operator-message" },
  receipt: {
    inputSubmitted: {
      kind: "in_place",
      state: "submitted",
      harness: "codex",
      sessionId: input.sessionId,
      via: "tmux",
      location: "%1",
    },
  },
} as ScoutDeliverResponse;

describe("recorded web replies", () => {
  test("reactions and decisions need a runtime message even when typed into a live session", async () => {
    const commands: ScoutDeliverRequest[] = [];
    const send = async (_runtime: typeof runtime, command: ScoutDeliverRequest) => {
      commands.push(command);
      return accepted;
    };
    const reply = await recordedWebReply(input, "operator", "scout-web", runtime, send);
    expect(commands[0]).toMatchObject({
      sessionDelivery: "in_place_or_resume",
      requesterId: "operator",
      target: { sessionId: "native" },
      body: "Ship it.",
      messageMetadata: { clientMessageId: "click1" },
      requestId: expect.any(String),
    });
    expect(reply).toMatchObject({
      ok: true,
      delivery: "in_place",
      conversationId: "chat",
      messageId: "operator-message",
    });
  });

  test("an unsupported runtime or an uncertain submission never triggers a second delivery", async () => {
    for (const reason of ["session_input_unsupported", "request_outcome_unknown"]) {
      let calls = 0;
      const reply = await recordedWebReply(input, "operator", "scout-web", runtime, async () => {
        calls++;
        throw new Error(reason);
      });
      expect(reply.ok).toBe(false);
      expect(calls).toBe(1);
    }
    const reply = await recordedWebReply(
      input,
      "operator",
      "scout-web",
      runtime,
      async () => ({ ...accepted, message: undefined }) as unknown as ScoutDeliverResponse,
    );
    expect(reply).toMatchObject({ ok: false, code: "delivery_unconfirmed" });
  });

  test("a harness without native input receipts goes through a recorded exact-session ask", async () => {
    const reply = await recordedWebReply(
      { ...input, harness: "grok" },
      "operator",
      "scout-web",
      runtime,
      async (_, cmd) => {
        expect(cmd.target).toMatchObject({ kind: "session_id", sessionId: "native", harness: "grok" });
        expect(cmd.sessionDelivery).toBeUndefined();
        return { ...accepted, receipt: {}, flight: { id: "flight" } } as ScoutDeliverResponse;
      },
    );
    expect(reply).toMatchObject({ ok: true, delivery: "resumed", messageId: "operator-message", flightId: "flight" });
  });
});
