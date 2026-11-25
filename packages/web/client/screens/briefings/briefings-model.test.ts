import { describe, expect, test } from "bun:test";

import {
  briefingDetailPath,
  briefingRoute,
  BRIEFINGS_LIST_PATH,
  deriveSnapshotCounts,
  detailIsStale,
  elapsedLabel,
  hasTelemetry,
  kindLabel,
  latestBriefingId,
  observationTone,
  presenterNote,
  referenceLabel,
  TONE_LABEL,
  type BriefingSummary,
  type CallBody,
} from "./briefings-model.ts";

/* The Briefings page and panels read the archive and draw a briefing's parts with these. */

const row = (id: string, preparedAt: number): BriefingSummary => ({
  id,
  kind: "fleet-home",
  title: `Brief ${id}`,
  summary: "Two agents are waiting on review.",
  recommendation: null,
  preparedAt,
  ttlMs: 60_000,
  observationCount: 2,
  createdAt: preparedAt,
});

const call = (over: Partial<CallBody>): CallBody => ({
  model: "gpt",
  systemPrompt: "system",
  operatorRequest: "request",
  responseId: null,
  ...over,
});

describe("the reads", () => {
  test("the archive reads the newest 50, as the page always did", () => {
    expect(BRIEFINGS_LIST_PATH).toBe("/api/briefings?limit=50");
  });

  test("a briefing's read escapes its id", () => {
    expect(briefingDetailPath("b 1/2")).toBe("/api/briefings/b%201%2F2");
  });

  test("a briefing's page, and the archive with no id", () => {
    expect(briefingRoute("b1")).toEqual({ view: "briefings", briefingId: "b1" });
    expect(briefingRoute()).toEqual({ view: "briefings" });
    expect(briefingRoute("")).toEqual({ view: "briefings" });
  });

  test("the latest is the first row (the server lists newest first); none before a read or when empty", () => {
    expect(latestBriefingId([row("b2", 2), row("b1", 1)])).toBe("b2");
    expect(latestBriefingId([])).toBeNull();
    expect(latestBriefingId(null)).toBeNull();
  });

  test("a briefing shown is stale once its archive row was written again", () => {
    expect(detailIsStale({ preparedAt: 2 }, { preparedAt: 1 })).toBe(true);
    expect(detailIsStale({ preparedAt: 2 }, { preparedAt: 2 })).toBe(false);
    // nothing to compare: nothing to read again
    expect(detailIsStale(null, { preparedAt: 1 })).toBe(false);
    expect(detailIsStale({ preparedAt: 2 }, null)).toBe(false);
  });
});

describe("how the parts read", () => {
  test("the kind, short on a row and long in a header; an unknown kind reads as itself", () => {
    expect(kindLabel("fleet-home")).toBe("fleet");
    expect(kindLabel("tour")).toBe("tour");
    expect(kindLabel("fleet-home", true)).toBe("fleet briefing");
    expect(kindLabel("tour", true)).toBe("tour briefing");
    expect(kindLabel("digest")).toBe("digest");
  });

  test("only warnings and errors are marked, and they say so in words", () => {
    expect(observationTone("warn")).toBe("warn");
    expect(observationTone("err")).toBe("err");
    expect(observationTone("error")).toBe("err");
    expect(observationTone("info")).toBeNull();
    expect(observationTone(undefined)).toBeNull();
    expect(TONE_LABEL).toEqual({ warn: "Warning", err: "Error" });
  });

  test("a reference chip carries its detail when it has one", () => {
    expect(referenceLabel({ label: "atlas" })).toBe("atlas");
    expect(referenceLabel({ label: "atlas", detail: "waiting 4m" })).toBe("atlas · waiting 4m");
  });

  test("the presenter row says why it did not run", () => {
    expect(presenterNote({ skipped: null })).toBeNull();
    expect(presenterNote({ skipped: "rate-guard" })).toBe("skipped — rate-guard hit");
    expect(presenterNote({ skipped: "error", errorMessage: "timeout" })).toBe("failed — timeout");
    expect(presenterNote({ skipped: "error" })).toBe("failed — unknown");
  });

  test("a call's time in seconds, a dash when unmeasured", () => {
    expect(elapsedLabel({ elapsedMs: 1234, usage: null })).toBe("1.23s");
    expect(elapsedLabel({ elapsedMs: 0, usage: null })).toBe("—");
    expect(elapsedLabel(null)).toBe("—");
  });

  test("telemetry shows when either call measured anything", () => {
    expect(hasTelemetry(null)).toBe(false);
    expect(hasTelemetry(call({}))).toBe(false);
    expect(hasTelemetry(call({ telemetry: { elapsedMs: 10, usage: null } }))).toBe(true);
    expect(
      hasTelemetry(call({ presenter: { elapsedMs: 0, usage: null, model: "m", responseId: null, skipped: "rate-guard" } })),
    ).toBe(true);
  });

  test("the snapshot's counts, one per list it carried, in the page's order", () => {
    expect(deriveSnapshotCounts(null)).toEqual([]);
    expect(deriveSnapshotCounts({})).toEqual([]);
    expect(
      deriveSnapshotCounts({
        state: {
          agents: [1, 2, 3],
          fleet: { activeAsks: [1], needsAttention: [], recentCompleted: [1, 2] },
          broker: { recentMessages: [1] },
          scoutChatter: [1, 2],
          agentLogMessages: "not a list",
          operatorAttention: { items: [1] },
        },
      }),
    ).toEqual([
      { label: "agents", value: 3 },
      { label: "active requests", value: 1 },
      { label: "attention", value: 0 },
      { label: "recent", value: 2 },
      { label: "broker msgs", value: 1 },
      { label: "scout chatter", value: 2 },
      { label: "operator items", value: 1 },
    ]);
  });
});
