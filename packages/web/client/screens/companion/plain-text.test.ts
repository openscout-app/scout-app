import { expect, test } from "bun:test";

import { stripMarkup } from "./plain-text.ts";
import { plainLine as rowLine } from "./arrivals/TapText.tsx";
import { plainLine as cornerLine } from "./system-corner/system-corner-model.ts";

test("element tags never reach the board; the words between them do", () => {
  const kimi = '<notification type="task" id="bg-7">Background task finished: bun test</notification>';
  for (const line of [rowLine, cornerLine]) {
    expect(line(kimi)).toBe("Background task finished: bun test");
    expect(line("<system-reminder>\nnote</system-reminder> Ported the strip.<br/>")).toBe("note Ported the strip.");
    expect(line("Done <!-- scout:route --> here")).toBe("Done here");
  }
});

test("a tag cut off by truncation goes too, and comparisons and code keep their brackets", () => {
  expect(stripMarkup('Waiting <notification id="ab').trim()).toBe("Waiting");
  expect(stripMarkup("a < b and c > d")).toBe("a < b and c > d");
  expect(stripMarkup("x<3 is fine")).toBe("x<3 is fine");
  expect(rowLine("Typed `Map<string, number>` as the cache")).toBe("Typed Map<string, number> as the cache");
});
