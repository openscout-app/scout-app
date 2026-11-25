import { describe, expect, test } from "bun:test";
import type { Agent } from "../../lib/types.ts";
import { replyRoute } from "./AgentsFeedRespond.tsx";

const agent = { id: "demo-app-bohr-18" } as Agent;

describe("replyRoute", () => {
  test("a post worked in a harness session replies to that exact session, even when an agent shares its name", () => {
    expect(replyRoute({ conversationId: null, sessionId: "717d9a47-fcc2" }, agent)).toEqual({ to: "session", sessionId: "717d9a47-fcc2" });
  });
  test("a Scout agent's post replies to the agent", () => {
    expect(replyRoute({ conversationId: "chn-1", sessionId: null }, agent)).toEqual({ to: "agent", agent });
    expect(replyRoute({ conversationId: "chn-1", sessionId: "s-1" }, agent)).toEqual({ to: "agent", agent });
  });
  test("a roll-up of reviewers, or a post with no one behind it, offers no reply and says why", () => {
    const rollup = replyRoute({ conversationId: "chn-1", sessionId: null, reviewers: [{ agent: "a", harness: null }, { agent: "b", harness: null }] }, agent);
    expect(rollup.to).toBe("none");
    expect(replyRoute({ conversationId: "chn-1", sessionId: null }, null).to).toBe("none");
  });
});
