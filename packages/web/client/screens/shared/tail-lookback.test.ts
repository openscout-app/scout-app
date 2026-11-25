import { describe, expect, test } from "bun:test";
import type { TailEvent } from "../../lib/types.ts";
import {
  measureTailLookback,
  mergeTailLookbackEvents,
  nextTailLookbackSteps,
  TAIL_LOOKBACK_WINDOW_CAP_MS,
  tailLookbackEarlierLead,
  tailLookbackLead,
  tailLookbackPath,
  tailLookbackStepLabel,
  tailLookbackStepTitle,
  type TailLookbackOrigin,
  type TailLookbackOutcome,
  type TailLookbackStep,
} from "./tail-lookback.ts";

const HOUR = 60 * 60 * 1000;
const BUFFER = 5_000;
const NOW = Date.UTC(2026, 9, 14, 20, 0, 0);

/** /ops/tail: the first load read the live buffer only. */
const LIVE: TailLookbackOrigin = { limit: 500, transcripts: false, count: 500 };
/** Work Task tail, Tail module: the first load already read transcripts. */
const READ = (count: number): TailLookbackOrigin => ({ limit: 500, transcripts: true, count });

function event(ts: number, summary = `line ${ts}`): TailEvent {
  return {
    id: `codex:${ts}`,
    ts,
    source: "codex",
    sessionId: "01a13bee",
    pid: 0,
    parentPid: null,
    project: "openscout",
    cwd: "/",
    harness: "scout-managed",
    kind: "assistant",
    summary,
  };
}

function span(from: number, to: number): TailEvent[] {
  const out: TailEvent[] = [];
  for (let ts = from; ts <= to; ts += 1) out.push(event(ts));
  return out;
}

function outcome(step: TailLookbackStep, count: number, movedBack: boolean, added = movedBack ? 1 : 0): TailLookbackOutcome {
  return { step, count, added, movedBack };
}

function steps(
  origin: TailLookbackOrigin | null,
  last: TailLookbackOutcome | null = null,
  oldestHeldTs: number | null = NOW - 10 * 60_000,
  held = 100,
): string[] {
  return nextTailLookbackSteps({ origin, last, bufferLimit: BUFFER, held, oldestHeldTs, now: NOW })
    .map(tailLookbackStepLabel);
}

describe("tail look back: what is offered", () => {
  test("nothing before the first load lands, and nothing once the buffer is full", () => {
    expect(steps(null)).toEqual([]);
    expect(steps(LIVE, null, NOW - 60_000, BUFFER)).toEqual([]);
    expect(steps(READ(500), null, NOW - 60_000, BUFFER)).toEqual([]);
  });

  test("a live-only first load offers windows, which add transcript replay, then Older", () => {
    expect(steps(LIVE)).toEqual(["1h", "6h", "24h"]);
    const hour = { kind: "window", windowMs: HOUR } as const;
    expect(steps(LIVE, outcome(hour, 300, true))).toEqual(["6h", "24h"]);
    const day = { kind: "window", windowMs: TAIL_LOOKBACK_WINDOW_CAP_MS } as const;
    expect(nextTailLookbackSteps({ origin: LIVE, last: outcome(day, 300, true), bufferLimit: BUFFER, held: 800, oldestHeldTs: NOW - 20 * HOUR, now: NOW }))
      .toEqual([{ kind: "older", limit: 5_000 }]);
    // A 10,000-line view gets one more step; a 5,000-line view stops at 5,000.
    expect(steps(LIVE, outcome({ kind: "older", limit: 5_000 }, 5_000, true))).toEqual([]);
    expect(nextTailLookbackSteps({ origin: LIVE, last: outcome({ kind: "older", limit: 5_000 }, 5_000, true), bufferLimit: 10_000, held: 5_000, oldestHeldTs: NOW - 30 * HOUR, now: NOW }))
      .toEqual([{ kind: "older", limit: 10_000 }]);
  });

  test("the live buffer's own span does not skip a window: transcripts can fill it", () => {
    // Three hours of live rows held, no step yet: 1h still adds unwatched sessions.
    expect(steps(LIVE, null, NOW - 3 * HOUR)).toEqual(["1h", "6h", "24h"]);
    // Once a window has read transcripts, a window inside what is held adds nothing.
    const hour = { kind: "window", windowMs: HOUR } as const;
    expect(steps(LIVE, outcome(hour, 800, true), NOW - 7 * HOUR)).toEqual(["24h"]);
    expect(steps(LIVE, outcome(hour, 800, true), NOW - 30 * HOUR)).toEqual(["Older"]);
  });

  test("a window that came back full skips the wider windows: they return the same newest rows", () => {
    const hour = { kind: "window", windowMs: HOUR } as const;
    expect(steps(LIVE, outcome(hour, 2_000, true))).toEqual(["Older"]);
    expect(nextTailLookbackSteps({ origin: LIVE, last: outcome(hour, 2_000, true), bufferLimit: BUFFER, held: 2_400, oldestHeldTs: NOW - 50 * 60_000, now: NOW }))
      .toEqual([{ kind: "older", limit: 5_000 }]);
  });

  test("a window that found nothing still leaves the wider ones", () => {
    const hour = { kind: "window", windowMs: HOUR } as const;
    expect(steps(LIVE, outcome(hour, 0, false))).toEqual(["6h", "24h"]);
  });

  test("a first load that already read transcripts offers no windows, only more lines", () => {
    expect(nextTailLookbackSteps({ origin: READ(215), last: null, bufferLimit: BUFFER, held: 215, oldestHeldTs: NOW - 56 * 60_000, now: NOW }))
      .toEqual([{ kind: "older", limit: 2_000 }]);
    expect(nextTailLookbackSteps({ origin: READ(500), last: outcome({ kind: "older", limit: 2_000 }, 1_400, true), bufferLimit: BUFFER, held: 1_400, oldestHeldTs: NOW - 9 * HOUR, now: NOW }))
      .toEqual([{ kind: "older", limit: 5_000 }]);
  });

  test("an empty first load that already read transcripts still offers a larger read", () => {
    // The broker drops noise after the limit: an answer behind 500 token-count
    // records comes back at 2,000 lines and not at 500 (Codex round 3).
    expect(nextTailLookbackSteps({ origin: READ(0), last: null, bufferLimit: BUFFER, held: 0, oldestHeldTs: null, now: NOW }))
      .toEqual([{ kind: "older", limit: 2_000 }]);
  });

  test("a line-count step that reached no further back offers the next larger read, then stops", () => {
    // 01a13bee: the first load returned the whole session (215 rows of 298 lines).
    const again = outcome({ kind: "older", limit: 2_000 }, 215, false);
    expect(nextTailLookbackSteps({ origin: READ(215), last: again, bufferLimit: BUFFER, held: 215, oldestHeldTs: NOW - 56 * 60_000, now: NOW }))
      .toEqual([{ kind: "older", limit: 5_000 }]);
    expect(tailLookbackEarlierLead(again)).toBe("Nothing earlier in 2,000 lines.");
    // The largest read the buffer holds ends the ladder.
    const largest = outcome({ kind: "older", limit: 5_000 }, 215, false);
    expect(nextTailLookbackSteps({ origin: READ(215), last: largest, bufferLimit: BUFFER, held: 215, oldestHeldTs: NOW - 56 * 60_000, now: NOW })).toEqual([]);
    expect(steps(LIVE, outcome({ kind: "older", limit: 5_000 }, 3_000, false), NOW - 30 * HOUR, 3_000)).toEqual([]);
  });
});

describe("tail look back: what it says", () => {
  test("under an empty tail the lead names how far the view has looked", () => {
    expect(tailLookbackLead(null)).toBeNull();
    expect(tailLookbackLead(outcome({ kind: "window", windowMs: 6 * HOUR }, 0, false))).toBe("Nothing in the last 6h.");
    expect(tailLookbackLead(outcome({ kind: "older", limit: 5_000 }, 0, false))).toBe("Nothing in the last 5,000 lines.");
    expect(tailLookbackStepTitle({ kind: "window", windowMs: HOUR })).toBe("Look back 1 hour");
    expect(tailLookbackStepTitle({ kind: "window", windowMs: 24 * HOUR })).toBe("Look back 24 hours");
  });

  test("above the oldest row it speaks only when a step changed nothing", () => {
    expect(tailLookbackEarlierLead(null)).toBeNull();
    expect(tailLookbackEarlierLead(outcome({ kind: "older", limit: 2_000 }, 400, true))).toBeNull();
    expect(tailLookbackEarlierLead(outcome({ kind: "window", windowMs: HOUR }, 30, false, 30))).toBeNull();
    expect(tailLookbackEarlierLead(outcome({ kind: "window", windowMs: HOUR }, 30, false, 0))).toBe("Nothing more in the last 1h.");
  });

  test("a step reads /api/tail/recent with a window, transcripts, a larger limit and the session scope", () => {
    const windowed = new URL(tailLookbackPath({ kind: "window", windowMs: 6 * HOUR }, "01a13bee-thread"), "http://x");
    expect(windowed.pathname).toBe("/api/tail/recent");
    expect(Object.fromEntries(windowed.searchParams)).toEqual({
      limit: "2000",
      transcripts: "true",
      windowMs: String(6 * HOUR),
      sessionId: "01a13bee-thread",
    });

    const older = new URL(tailLookbackPath({ kind: "older", limit: 5_000 }), "http://x");
    expect(Object.fromEntries(older.searchParams)).toEqual({ limit: "5000", transcripts: "true" });
  });
});

describe("tail look back: merging a step's rows", () => {
  test("held rows older than the step's newest set stay at the top, not the live end", () => {
    // Held t1..3000; the 1h step returns only the newest 2,000 of its window.
    const merged = mergeTailLookbackEvents(span(1, 3_000), span(1_001, 3_000), BUFFER);
    expect(merged).toHaveLength(3_000);
    expect(merged.slice(0, 3).map((e) => e.ts)).toEqual([1, 2, 3]);
    expect(merged.slice(-3).map((e) => e.ts)).toEqual([2_998, 2_999, 3_000]);
  });

  test("older rows go before what is held, in time order, and the newest are kept at the cap", () => {
    const merged = mergeTailLookbackEvents(span(1_001, 3_000), span(1, 2_000), BUFFER);
    expect(merged.map((e) => e.ts)).toEqual(span(1, 3_000).map((e) => e.ts));
    const capped = mergeTailLookbackEvents(span(1_001, 3_000), span(1, 2_000), 2_500);
    expect(capped[0]?.ts).toBe(501);
    expect(capped.at(-1)?.ts).toBe(3_000);
  });

  test("a held row wins a content match, so its id and row key stay put", () => {
    const held = [{ ...event(10), id: "live:7" }];
    const merged = mergeTailLookbackEvents(held, [event(5), event(10)], BUFFER);
    expect(merged.map((e) => e.id)).toEqual(["codex:5", "live:7"]);
  });

  test("measuring a step: the same rows again add nothing and do not move back", () => {
    const held = span(100, 314);
    expect(measureTailLookback(held, span(100, 314), BUFFER)).toEqual({ added: 0, movedBack: false });
    expect(measureTailLookback(held, span(40, 314), BUFFER)).toEqual({ added: 60, movedBack: true });
    // Rows inside the held span (an unwatched session's transcript) add without moving back.
    expect(measureTailLookback(held, [event(200, "other session")], BUFFER)).toEqual({ added: 1, movedBack: false });
    expect(measureTailLookback([], span(1, 3), BUFFER)).toEqual({ added: 3, movedBack: true });
  });

  test("measuring a step: rows the cap would trim do not count as reaching back", () => {
    expect(measureTailLookback(span(1_001, 6_000), span(1, 1_000), BUFFER)).toEqual({ added: 0, movedBack: false });
  });
});
