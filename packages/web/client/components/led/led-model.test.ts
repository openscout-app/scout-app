import { expect, test } from "bun:test";

import { ledColumns, ledInitials, ledName, ledScrolls, ledWindow } from "./led-model.ts";

test("letters are as wide as their dots, one dark column between", () => {
  expect(ledColumns("H")).toHaveLength(5);
  expect(ledColumns("I")).toHaveLength(3);
  expect(ledColumns("HI")).toHaveLength(9);
  expect(ledColumns("H I")).toHaveLength(11);
  expect(ledColumns("i")).toEqual(ledColumns("I"));
  expect(ledColumns("é")).toEqual(ledColumns("E"));
});

test("initials read the agent, not the project", () => {
  expect(ledInitials("openscout-chopin-3")).toBe("C3");
  expect(ledInitials("Arach Tchoupani")).toBe("AT");
  expect(ledInitials("witt")).toBe("WI");
  expect(ledInitials("")).toBe("?");
  expect(ledName("openscout-chopin-3")).toBe("CHOPIN");
  expect(ledName("Scoutbot")).toBe("SCOUTBOT");
});

test("a sign that fits is centered and still; a long one loops", () => {
  const cols = ledColumns("I");
  const view = ledWindow(cols, 9, 40);
  expect(view.slice(3, 6)).toEqual(cols);
  expect(ledScrolls(cols, 9)).toBe(false);
  const long = ledColumns("HELLO");
  expect(ledScrolls(long, 10)).toBe(true);
  expect(ledWindow(long, 10, 0)).toEqual(long.slice(0, 10));
  expect(ledWindow(long, 10, long.length + 8)).toEqual(long.slice(0, 10));
});
