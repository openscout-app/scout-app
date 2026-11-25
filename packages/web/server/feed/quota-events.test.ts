import { expect, test } from "bun:test";
import { quotaCrossings, type QuotaGaugeInput } from "./quota-events.ts";

const H = 3_600_000;
const RESET = Date.UTC(2026, 10, 18, 22);

/** One 7d window whose readings climb hour by hour to `fills`, the last reading `hoursLeft` before the reset. */
function gauge(fills: number[], hoursLeft: number): QuotaGaugeInput {
  const last = RESET - hoursLeft * H;
  const history = fills.map((fill, i) => ({ capturedAt: last - (fills.length - 1 - i) * H, fill, resetAt: RESET }));
  return { id: "claude", label: "claude", kind: "quota", windows: [{ label: "7d", fill: fills.at(-1)!, resetAt: RESET + 168 * H, windowMs: 168 * H, history }] };
}

test("passing 90% late in the window is good use and makes no warning", () => {
  expect(quotaCrossings([gauge([0.86, 0.89, 0.9, 0.97], 1)])).toEqual([]);
});

test("passing 90% with days left warns, with the window's length", () => {
  const [event] = quotaCrossings([gauge([0.86, 0.91], 48)]);
  expect(event).toMatchObject({ windowMs: 168 * H, ranOutAt: null, crossedAt: RESET - 48 * H });
});

test("a window that ran out warns, however late", () => {
  const [event] = quotaCrossings([gauge([0.9, 0.97, 1], 2)]);
  expect(event?.ranOutAt).toBe(RESET - 2 * H);
});
