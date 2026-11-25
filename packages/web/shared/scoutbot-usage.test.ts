import { describe, expect, test } from "bun:test";

import type { VoiceModelUsage } from "./voice-usage.ts";
import {
  briefScoutbotUsage,
  formatShare,
  formatTokenCount,
  SCOUTBOT_USAGE_OCCASIONS,
  scoutbotRequestInput,
  scoutbotRequestTokens,
  scoutbotSnapshotPartLabel,
  scoutbotTotalsLine,
  scoutbotUsageLabel,
  summarizeScoutbotUsage,
} from "./scoutbot-usage.ts";

const DAY = 24 * 60 * 60 * 1000;
// Noon, so a few hours either way stays inside the local day.
const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();

let seq = 0;
function record(over: Partial<VoiceModelUsage> = {}): VoiceModelUsage {
  seq += 1;
  return {
    id: `r${seq}`,
    sessionId: "s",
    mode: "chat",
    model: "m",
    provider: "openai",
    startedAt: NOW - 60_000,
    finishedAt: NOW - 58_000,
    elapsedMs: 2000,
    state: "completed",
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    ...over,
  };
}

describe("summarizeScoutbotUsage", () => {
  test("sums today, the last seven days and the whole window apart", () => {
    const summary = summarizeScoutbotUsage([
      record(),
      record({ startedAt: NOW - 3 * DAY }),
      record({ startedAt: NOW - 20 * DAY }),
      record({ startedAt: NOW - 45 * DAY }),
    ], NOW);
    expect(summary.today.tokens).toBe(110);
    expect(summary.week.tokens).toBe(220);
    expect(summary.window.tokens).toBe(330);
    expect(summary.window.requests).toBe(3);
    expect(summary.window.tokensIn).toBe(300);
    expect(summary.window.tokensOut).toBe(30);
  });

  test("gives one entry per local day, oldest first, ending today", () => {
    const summary = summarizeScoutbotUsage([record(), record({ startedAt: NOW - 2 * DAY })], NOW, 7);
    expect(summary.days).toHaveLength(7);
    expect(summary.days.map((day) => day.tokens)).toEqual([0, 0, 0, 0, 110, 0, 110]);
    expect(new Date(summary.days[6]!.start).getDate()).toBe(10);
    expect(new Date(summary.days[6]!.start).getHours()).toBe(0);
  });

  test("counts a request with no token report as a request, never as tokens", () => {
    const summary = summarizeScoutbotUsage([
      record({ provider: "codex", inputTokens: null, outputTokens: null, totalTokens: null }),
      record(),
    ], NOW);
    expect(summary.today).toMatchObject({ requests: 2, reported: 1, unreported: 1, tokens: 110 });
  });

  test("counts failed and pending requests without tokens", () => {
    const summary = summarizeScoutbotUsage([
      record({ state: "failed", inputTokens: null, outputTokens: null, totalTokens: null }),
      record({ state: "pending", finishedAt: null, elapsedMs: null, inputTokens: null, outputTokens: null, totalTokens: null }),
    ], NOW);
    expect(summary.today).toMatchObject({ requests: 2, failed: 1, reported: 0, unreported: 0, tokens: 0 });
  });

  test("describes each kind by its median reported request", () => {
    const summary = summarizeScoutbotUsage([
      record({ inputTokens: 48_000, outputTokens: 300, totalTokens: 48_300 }),
      record({ inputTokens: 48_400, outputTokens: 340, totalTokens: 48_740 }),
      record({ inputTokens: 90_000, outputTokens: 900, totalTokens: 90_900 }),
      record({ provider: "codex", inputTokens: null, outputTokens: null, totalTokens: null }),
      record({ mode: "local", inputTokens: 14_000, outputTokens: 30, totalTokens: 14_030, startedAt: NOW - DAY }),
    ], NOW);
    expect(summary.kinds.map((kind) => kind.mode)).toEqual(["chat", "local"]);
    expect(summary.kinds[0]).toMatchObject({
      requests: 4, reported: 3, unreported: 1, typicalTokens: 48_740, typicalIn: 48_400, typicalOut: 340,
    });
    expect(summary.kinds[1]).toMatchObject({ typicalTokens: 14_030, lastAt: NOW - DAY });
  });

  test("a kind with nothing reported has no typical request", () => {
    const summary = summarizeScoutbotUsage([
      record({ provider: "codex", inputTokens: null, outputTokens: null, totalTokens: null }),
    ], NOW);
    expect(summary.kinds[0]).toMatchObject({ typicalTokens: null, typicalIn: null, typicalOut: null, unreported: 1 });
  });

  test("with no records every window is empty and no kind is listed", () => {
    const summary = summarizeScoutbotUsage([], NOW);
    expect(summary.window).toMatchObject({ requests: 0, tokens: 0 });
    expect(summary.kinds).toEqual([]);
    expect(summary.days).toHaveLength(30);
  });
});

describe("scoutbotRequestTokens", () => {
  test("uses the reported total, or the parts when only they were reported", () => {
    expect(scoutbotRequestTokens(record({ totalTokens: 52_040, inputTokens: 3, outputTokens: 149 }))).toBe(52_040);
    expect(scoutbotRequestTokens(record({ totalTokens: null, inputTokens: 8, outputTokens: 3 }))).toBe(11);
    expect(scoutbotRequestTokens(record({ totalTokens: null, inputTokens: null, outputTokens: null }))).toBeNull();
    expect(scoutbotRequestTokens(record({ totalTokens: 0, inputTokens: 0, outputTokens: 0 }))).toBe(0);
  });
});

describe("scoutbotRequestInput", () => {
  test("is the total less the output, so cached input is counted", () => {
    const cached = record({ totalTokens: 52_040, inputTokens: 3, outputTokens: 149 });
    expect(scoutbotRequestInput(cached)).toBe(51_891);
    expect(summarizeScoutbotUsage([cached], NOW).today).toMatchObject({ tokens: 52_040, tokensIn: 51_891, tokensOut: 149 });
    expect(summarizeScoutbotUsage([cached], NOW).kinds[0]).toMatchObject({ typicalIn: 51_891, typicalOut: 149 });
  });

  test("falls back to the reported input when there is no total", () => {
    expect(scoutbotRequestInput(record({ totalTokens: null, inputTokens: 8, outputTokens: 3 }))).toBe(8);
    expect(scoutbotRequestInput(record({ totalTokens: null, inputTokens: null, outputTokens: null }))).toBeNull();
  });
});

describe("the occasions and their names", () => {
  test("every recorded kind has a name, and an unknown one keeps its own", () => {
    for (const mode of ["chat", "local", "api", "recap", "advice", "brief"]) {
      expect(scoutbotUsageLabel(mode)).not.toBe(mode);
    }
    expect(scoutbotUsageLabel("later-kind")).toBe("later-kind");
    expect(SCOUTBOT_USAGE_OCCASIONS.filter((occasion) => occasion.unprompted).map((occasion) => occasion.mode)).toEqual(["advice"]);
  });

  test("snapshot parts are named in the app's words, never the runtime's old one", () => {
    expect(scoutbotSnapshotPartLabel("broker")).toBe("Runtime diagnostics");
    expect(scoutbotSnapshotPartLabel("somethingNew")).toBe("somethingNew");
  });

  test("a share is a whole percent, and a sliver is not zero", () => {
    expect(formatShare(61_200, 187_650)).toBe("33%");
    expect(formatShare(40, 187_650)).toBe("<1%");
    expect(formatShare(0, 187_650)).toBe("0%");
    expect(formatShare(5, 0)).toBe("0%");
  });
});

describe("briefScoutbotUsage", () => {
  test("gives Scoutbot three windows and a line per kind, in the app's names", () => {
    const brief = briefScoutbotUsage([
      record({ inputTokens: 48_000, outputTokens: 300, totalTokens: 48_300 }),
      record({ provider: "codex", inputTokens: null, outputTokens: null, totalTokens: null }),
      record({ mode: "local", startedAt: NOW - 3 * DAY, inputTokens: 14_000, outputTokens: 30, totalTokens: 14_030 }),
      record({ state: "failed", startedAt: NOW - 20 * DAY, inputTokens: null, outputTokens: null, totalTokens: null }),
    ], NOW);
    expect(brief.today).toEqual({ requests: 2, tokens: 48_300, tokensIn: 48_000, tokensOut: 300, noTokenReport: 1, failed: 0 });
    expect(brief.last7Days).toMatchObject({ requests: 3, tokens: 62_330 });
    expect(brief.last30Days).toMatchObject({ requests: 4, failed: 1 });
    expect(brief.byKind).toEqual([
      { kind: "Typed message", requests: 3, typicalTokens: 48_300, typicalIn: 48_000, typicalOut: 300 },
      { kind: "Spoken reply", requests: 1, typicalTokens: 14_030, typicalIn: 14_000, typicalOut: 30 },
    ]);
    expect(brief.about).not.toContain("broker");
    expect(brief.partial).toBeUndefined();
    expect(JSON.stringify(brief).length).toBeLessThan(1200);
  });

  test("says so when older requests in the window were left out of the sums", () => {
    const brief = briefScoutbotUsage([record({ inputTokens: 10, outputTokens: 1, totalTokens: 11 })], NOW, { truncated: true });
    expect(brief.partial).toContain("lower than the real ones");
    expect(JSON.stringify(brief).length).toBeLessThan(1200);
  });
});

describe("scoutbotTotalsLine", () => {
  test("says what was asked, what it used, and what is missing from the count", () => {
    const summary = summarizeScoutbotUsage([
      record({ inputTokens: 51_891, outputTokens: 149, totalTokens: 52_040 }),
      record({ provider: "codex", inputTokens: null, outputTokens: null, totalTokens: null }),
      record({ state: "failed", inputTokens: null, outputTokens: null, totalTokens: null }),
    ], NOW);
    expect(scoutbotTotalsLine(summary.today)).toBe("3 requests. 51.9k in, 149 out. 1 with no token report. 1 failed.");
    expect(scoutbotTotalsLine(summarizeScoutbotUsage([], NOW).today)).toBe("No requests.");
    expect(scoutbotTotalsLine(summarizeScoutbotUsage([
      record({ provider: "codex", inputTokens: null, outputTokens: null, totalTokens: null }),
    ], NOW).today)).toBe("1 request. 1 with no token report.");
  });
});

describe("formatTokenCount", () => {
  test("keeps small counts whole and shortens the rest", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(812)).toBe("812");
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(48_365)).toBe("48.4k");
    expect(formatTokenCount(149_446)).toBe("149k");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
  });
});
