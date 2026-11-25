import { expect, test } from "bun:test";
import { buildBoardSelection, parseBoardSelection } from "./board-selection.ts";
test("selection is shareable, encoded and preserves unrelated parameters", () => {
  const path = buildBoardSelection("/work/board?machineId=host", "work /&?", true);
  expect(parseBoardSelection(new URL(path, "https://scout.local").search)).toEqual({ boardItem: "work /&?", boardFull: true });
  expect(path).toContain("machineId=host");
  expect(buildBoardSelection(path)).toBe("/work/board?machineId=host");
});
test("empty selection cannot expand and absent full stays in the board", () => {
  expect(parseBoardSelection("?item=+&full=1")).toEqual({ boardItem: undefined, boardFull: false });
  expect(parseBoardSelection("?item=one")).toEqual({ boardItem: "one", boardFull: false });
});
