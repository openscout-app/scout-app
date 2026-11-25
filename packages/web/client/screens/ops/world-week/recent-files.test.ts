import { expect, test } from "bun:test";
import { recentFiles } from "./recent-files.ts";

test("all 100 distinct files remain reachable beyond a 24-row viewport", () => {
  const events = Array.from({ length: 100 }, (_, i) => ({ file: `/${i}`, hidden: false }));
  events.push({ file: "/99", hidden: false }, { file: "/hidden", hidden: true });
  const rows = recentFiles(events, events.length, e => !e.hidden);
  expect(rows).toHaveLength(100);
  expect(rows[0]!.file).toBe("/99");
  expect(rows[99]!.file).toBe("/0");
  expect(recentFiles(events, 50, e => !e.hidden)).toHaveLength(50);
});
