import { describe, expect, test } from "bun:test";

import { cockpitGauges } from "./cockpit-gauges.ts";
import type { ServiceGauge } from "./quota-gauge.ts";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-06T12:00:00Z");

function quota(id: string, fill: number, resetInMs: number, extra: Partial<Extract<ServiceGauge, { kind: "quota" }>> = {}): ServiceGauge {
  return {
    id,
    label: id,
    kind: "quota",
    fill,
    usedLabel: "",
    capLabel: "",
    unitLabel: "weekly",
    resetAt: now.getTime() + resetInMs,
    capturedAt: now.getTime() - 5 * 60 * 1000,
    ...extra,
  };
}

describe("cockpit gauges", () => {
  test("one reading per subscription, in the runtime's order, status services left out", () => {
    const readings = cockpitGauges(
      [
        quota("codex", 0.27, 67 * HOUR),
        { id: "github", label: "github", kind: "status", statusLabel: "ok", tone: "ok" },
        quota("claude", 0.1, 100 * HOUR),
      ],
      now,
    );
    expect(readings.map((g) => g.label)).toEqual(["codex", "claude"]);
  });

  test("a reading is percent used and the countdown to reset; the title adds what is left", () => {
    const [codex] = cockpitGauges([quota("codex", 0.27, 67 * HOUR)], now);
    expect(codex).toMatchObject({ fill: 0.27, used: "27%", reset: "2d 19h", tone: "ok" });
    expect(codex?.title).toStartWith("codex 7d: 27% used, 73% left · resets ");
    expect(codex?.title).toEndWith("(in 2d 19h)");
  });

  test("reads the long window, not the short one, the way the quotas panel does", () => {
    const [claude] = cockpitGauges(
      [
        quota("claude", 0.8, 0, {
          windows: [
            { label: "5h", fill: 0.95, usedLabel: "", capLabel: "", unitLabel: "", resetAt: now.getTime() + 2 * HOUR },
            { label: "7d", fill: 0.8, usedLabel: "", capLabel: "", unitLabel: "", resetAt: now.getTime() + 124 * HOUR },
          ],
        }),
      ],
      now,
    );
    expect(claude).toMatchObject({ used: "80%", reset: "5d 4h", tone: "warn" });
  });

  test("past 90% the reading is marked; over 100% is held at full", () => {
    const [hot] = cockpitGauges([quota("hot", 1.3, 20 * 60 * 1000)], now);
    expect(hot).toMatchObject({ fill: 1, used: "100%", tone: "err" });
  });

  test("an old reading says how old it is", () => {
    const [stale] = cockpitGauges([quota("codex", 0.3, 67 * HOUR, { capturedAt: now.getTime() - 3 * HOUR })], now);
    expect(stale?.title).toEndWith("· read 3h ago");
  });

  test("a rolled-over window has no current reading: a dash, not last cycle's number", () => {
    const [old] = cockpitGauges([quota("gemini", 0.5, -30 * HOUR)], now);
    expect(old).toMatchObject({ fill: null, used: "—", reset: "rolled over", tone: "none" });
    expect(old?.title).toBe("gemini 7d: rolled over, waiting for a fresh reading");
  });

  test("nothing reported is no readings", () => {
    expect(cockpitGauges([], now)).toEqual([]);
  });
});
