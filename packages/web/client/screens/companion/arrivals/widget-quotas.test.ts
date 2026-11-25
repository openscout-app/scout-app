import { expect, test } from "bun:test";
import { groupWidgetQuotas, quotaTitle, widgetQuotas } from "./widget-quotas";
import type { ServiceGauge } from "../../home/HomeHero";

const now = new Date("2026-10-17T12:00:00Z");
const gauge: ServiceGauge = { id: "claude", label: "Claude", kind: "quota", fill: 0.2, usedLabel: "20%", capLabel: "100%", unitLabel: "weekly", resetAt: now.getTime() + 3600000 };

test("legacy quota becomes a weekly window without inventing absent providers", () => {
  expect(widgetQuotas([gauge], now)[0]).toMatchObject({ label: "Claude", window: "7d", used: 20, unavailable: false });
  expect(widgetQuotas([], now)).toEqual([]);
});

test("weekly countdown uses days and hours, with a compact label for the last hour", () => {
  const at = now.getTime();
  const read = (hours: number) => widgetQuotas([{ ...gauge, resetAt: at + hours * 3_600_000 }], now)[0]!;
  expect(read(52).resetCountdown).toBe("2d 4h");
  expect(read(4.5).resetCountdown).toBe("4h");
  expect(read(0.5).resetCountdown).toBe("<1h");
  expect(read(-1).resetCountdown).toBeUndefined();
});

test("keeps all windows, short before long, clamps fill, and marks rolled-over readings unknown", () => {
  const windows = [
    { label: "7d", fill: 1.4, usedLabel: "", capLabel: "", unitLabel: "", resetAt: gauge.resetAt },
    { label: "5h", fill: 0.7, usedLabel: "", capLabel: "", unitLabel: "", resetAt: now.getTime() - 1 },
  ];
  const result = widgetQuotas([{ ...gauge, windows }], now);
  expect(result.map((q) => q.window)).toEqual(["5h", "7d"]);
  expect(result[0]).toMatchObject({ unavailable: true, reset: "Awaiting read" });
  expect(result[1]!.used).toBe(100);
});


test("compact quotas group all windows by provider, showing the worst available percentage", () => {
  const quotas = [
    { id: "claude5h", label: "Claude", window: "5h", used: 81, reset: "in 2h" },
    { id: "codex7d", label: "Codex", window: "7d", used: 80, reset: "in 4d" },
    { id: "claude7d", label: "claude", window: "7d", used: 92, reset: "in 5d" },
    { id: "grok7d", label: "Grok", window: "7d", used: 0, reset: "in 6d" },
    { id: "github1h", label: "GitHub", window: "1h", used: 5, reset: "in 1h" },
  ];
  const cells = groupWidgetQuotas(quotas);
  expect(cells.map((p) => p.label)).toEqual(["Claude", "Codex", "Grok", "GitHub"]);
  expect(cells[0]!.windows).toEqual([quotas[0]!, quotas[2]!]);
  expect(cells[0]!.worst).toBe(quotas[2]!);
  expect(cells[2]!.worst?.used).toBe(0);
  expect(quotas[0]!.reset).toBe("in 2h");
});

test("unknown windows stay in their provider cell but never become a fabricated reading", () => {
  const unknown = { id: "claude5h", label: "Claude", window: "5h", used: 99, reset: "Awaiting read", unavailable: true };
  const known = { id: "claude7d", label: "Claude", window: "7d", used: 12, reset: "in 4d" };
  expect(groupWidgetQuotas([unknown, known])[0]).toEqual({ label: "Claude", windows: [unknown, known], worst: known });
  expect(groupWidgetQuotas([unknown])[0]!.worst).toBeNull();
  expect(groupWidgetQuotas([])).toEqual([]);
});

test("a reading older than an hour names its age; a recent one does not", () => {
  const read = (ago: number) => widgetQuotas([{ ...gauge, capturedAt: now.getTime() - ago }], now)[0]!;
  expect(read(10 * 60_000)).toMatchObject({ readAt: now.getTime() - 10 * 60_000 });
  expect(read(10 * 60_000).age).toBeUndefined();
  expect(read(15 * 3_600_000)).toMatchObject({ age: "15h" });
  // A window's own capture time wins over the gauge's.
  const windows = [{ label: "7d", fill: 0.91, usedLabel: "", capLabel: "", unitLabel: "", resetAt: gauge.resetAt, capturedAt: now.getTime() - 2 * 3_600_000 }];
  expect(widgetQuotas([{ ...gauge, capturedAt: now.getTime(), windows }], now)[0]).toMatchObject({ used: 91, age: "2h" });
  // A rolled-over window already says "Awaiting read"; it carries no age.
  const rolled = [{ ...windows[0]!, resetAt: now.getTime() - 1 }];
  expect(widgetQuotas([{ ...gauge, windows: rolled }], now)[0]!.age).toBeUndefined();
});

test("the hover line says when the reading was taken", () => {
  const q = { id: "codex7d", label: "Codex", window: "7d", used: 91, reset: "in 1d", readAt: now.getTime() - 15 * 3_600_000, age: "15h" };
  expect(quotaTitle(q)).toMatch(/^Codex 7d · 91% used · resets in 1d · read 15h ago, /);
  expect(quotaTitle({ ...q, readAt: undefined, age: undefined })).toBe("Codex 7d · 91% used · resets in 1d");
});
