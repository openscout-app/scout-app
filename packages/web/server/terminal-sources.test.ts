import { describe, expect, test } from "bun:test";

import { discoveredTranscriptTitle, herdrClientSession } from "./terminal-sources.ts";

describe("herdrClientSession", () => {
  test("reads the session a client attaches", () => {
    expect(herdrClientSession("/opt/homebrew/bin/herdr session attach chat-levelup")).toBe("chat-levelup");
    expect(herdrClientSession("/opt/homebrew/bin/herdr --session scout")).toBe("scout");
    expect(herdrClientSession("herdr --session=blink")).toBe("blink");
    expect(herdrClientSession("herdr")).toBe("default");
  });

  test("a server or another subcommand is not a client", () => {
    expect(herdrClientSession("/opt/homebrew/bin/herdr --session scout server")).toBeNull();
    expect(herdrClientSession("/opt/homebrew/bin/herdr server")).toBeNull();
    expect(herdrClientSession("herdr session list")).toBeNull();
    expect(herdrClientSession("herdr --session")).toBeNull();
    expect(herdrClientSession("/usr/bin/grep herdr")).toBeNull();
  });
});

describe("discoveredTranscriptTitle", () => {
  const relay = "session-mw8dzuz2-1fbkvn-relay-agent";

  test("a relay's custom title steps aside for the agent name or AI title discovery reports", () => {
    expect(discoveredTranscriptTitle(
      { title: relay, customTitle: relay, agentName: null, aiTitle: "Terminals view spacing" } as never,
      null,
    )).toBe("Terminals view spacing");
    expect(discoveredTranscriptTitle(
      { title: relay, customTitle: relay, agentName: "review-scout-services", aiTitle: "Review services" } as never,
      null,
    )).toBe("review-scout-services");
  });

  test("a person's custom title leads", () => {
    expect(discoveredTranscriptTitle(
      { title: "Board view", customTitle: "Board view", agentName: null, aiTitle: "Rework the board" } as never,
      null,
    )).toBe("Board view");
  });

  test("an older core reports only the merged title, so the transcript's own titles stand in", () => {
    expect(discoveredTranscriptTitle(
      { title: relay },
      { customTitle: relay, agentName: null, aiTitle: "Routing catalog defaults" },
    )).toBe("Routing catalog defaults");
    expect(discoveredTranscriptTitle({ title: relay, agentNickname: null }, null)).toBeNull();
  });
});
