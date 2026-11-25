import { describe, expect, test } from "bun:test";

import {
  cleanSourceName,
  firstSourceName,
  firstSourceSentence,
  harnessSessionRef,
  isMachineName,
} from "./terminal-source-names.ts";

describe("isMachineName", () => {
  test("rejects the names programs make up", () => {
    for (const name of [
      "flat-claude-fb29e11e-7979-4e62-af4d-1a10a72f3a30-relay-agent",
      "Flat Claude Fb29e11e 7979 4e62 Af4d 1a10a72f3a30",
      "session-mw8dzuz2-1fbkvn-relay-agent",
      "Session Mw746hte Bn7k2z",
      "session-mrplh7sw-j6wqte",
      "relay-hudson-claude",
      "scout-codex-vox-c36c989274",
      "scout-claude-openscout-82cf94c694",
      "2.1.319",
      "1",
      "claude",
      "Claude Code",
      "OpenCode",
      "-zsh",
      "~/dev/openscout",
      "art@dev-host: ~/dev",
      "ses_f3e9dee72ffeVCGTBCBC16wXAK",
      "✳ Claude Code",
      "",
      null,
    ]) {
      expect(isMachineName(name)).toBe(true);
    }
  });

  test("keeps the names people and harnesses choose", () => {
    for (const name of [
      "companion motion",
      "oc-a",
      "Board view brief",
      "terminals view spacing compaction",
      "companion-waiting-card-permission",
      "review-scout-services",
      "Cloud-hosted Scout plan and deck",
      "查询集成架构文档",
      "review-pr-1694-conflicts",
      "Session summary review",
      "Click message to reply and mark read - grok",
    ]) {
      expect(isMachineName(name)).toBe(false);
    }
  });
});

describe("cleanSourceName", () => {
  test("drops spinner glyphs and the harness signature", () => {
    expect(cleanSourceName("✳ Fix the login flow")).toBe("Fix the login flow");
    expect(cleanSourceName("⠂ Fix the login flow")).toBe("Fix the login flow");
    expect(cleanSourceName("Click message to reply and mark read - grok")).toBe("Click message to reply and mark read");
    expect(cleanSourceName("  two\n lines ")).toBe("two lines");
  });
});

describe("firstSourceName", () => {
  test("skips generated names to the first chosen one", () => {
    expect(firstSourceName(
      "flat-claude-fb29e11e-7979-4e62-af4d-1a10a72f3a30-relay-agent",
      null,
      "review-scout-services",
    )).toBe("review-scout-services");
    expect(firstSourceName("claude", "2.1.319")).toBeNull();
  });
});

describe("firstSourceSentence", () => {
  test("keeps one sentence of what the agent said", () => {
    expect(firstSourceSentence("The full run reached the source tests this time, and two of them failed. Finding the cause.")).toBe(
      "The full run reached the source tests this time, and two of them failed.",
    );
    expect(firstSourceSentence("Checking whether this session used any of those worktrees:")).toBe(
      "Checking whether this session used any of those worktrees",
    );
    expect(firstSourceSentence("Note: the build is green.")).toBe("Note: the build is green.");
    expect(firstSourceSentence("Checking the worktrees:\nNone of them are mine.")).toBe("Checking the worktrees");
    expect(firstSourceSentence("The studio's sans is `--s-font-sans`.")).toBe("The studio's sans is --s-font-sans.");
  });

  test("ignores injected messages and clips long ones", () => {
    expect(firstSourceSentence("<task-notification>done</task-notification>")).toBeNull();
    const long = firstSourceSentence("a".repeat(200), 20);
    expect(long?.length).toBe(20);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("harnessSessionRef", () => {
  test("forms the session-ref the routes read", () => {
    expect(harnessSessionRef("claude", "fb29e11e")).toBe("session:claude:fb29e11e");
    expect(harnessSessionRef("claude-code", "x")).toBe("session:claude:x");
    expect(harnessSessionRef("codex_app_server", "y")).toBe("session:codex:y");
    expect(harnessSessionRef(null, "z")).toBeNull();
  });
});
