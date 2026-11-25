import { expect, test } from "bun:test";
import { rhythmCurrent, rhythmTime } from "./rhythm.ts";

test("Montreal clock cells survive both DST transitions", () => {
  const old = process.env.TZ;
  process.env.TZ = "America/Montreal";
  try {
    for (const day of [new Date(2026, 10, 1), new Date(2026, 2, 8)]) {
      const time = rhythmTime(+day, 12), date = new Date(time);
      expect(date.getHours()).toBe(12);
      expect(date.getMinutes()).toBe(30);
      expect(rhythmCurrent(+day, 12, time)).toBe(true);
      expect(rhythmCurrent(+day, 11, time)).toBe(false);
      expect(rhythmCurrent(+day, 12, +new Date(2026, 10, 2, 12))).toBe(false);
    }
    const fall = +new Date(2026, 10, 1);
    for (const time of ["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"])
      expect(rhythmCurrent(fall, 1, Date.parse(time))).toBe(true);
    expect(new Date(rhythmTime(+new Date(2026, 2, 8), 2)).getHours()).toBe(3);
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
