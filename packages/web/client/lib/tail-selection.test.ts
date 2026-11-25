import { describe, expect, test } from "bun:test";
import { tailSelectionRange } from "./tail-selection.ts";

describe("Tail range selection", () => {
  const rows = Array.from({ length: 120 }, (_, i) => String(i));
  test("selects more than a page in either direction", () => {
    expect(tailSelectionRange(rows, "30", "100")).toEqual(rows.slice(30, 101));
    expect(tailSelectionRange(rows, "100", "30")).toEqual(rows.slice(30, 101));
  });
  test("recovers when the anchor leaves the filtered view", () => {
    expect(tailSelectionRange(rows, "expired", "30")).toEqual(["30"]);
    expect(tailSelectionRange(rows, "30", "expired")).toEqual([]);
  });
});
