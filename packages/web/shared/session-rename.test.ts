import { describe, expect, test } from "bun:test";
import { formatRenamePolicy, parseRenamePolicy, RENAME_MINUTES, RENAME_NEVER, RENAME_TURNS } from "./session-rename.ts";

describe("rename policy", () => {
  test("never is the default, and anything unreadable or out of range reads as never", () => {
    for (const value of [null, undefined, "", "never", "turns", "turns:0", "turns:11", "minutes:0", "minutes:1441", "hours:2", "turns:-3", "turns:3.5", "TURNS:3"]) {
      expect(parseRenamePolicy(value)).toEqual(RENAME_NEVER);
    }
  });

  test("every choice the settings sheet offers survives the round trip", () => {
    expect(parseRenamePolicy(formatRenamePolicy(RENAME_NEVER))).toEqual(RENAME_NEVER);
    for (const n of RENAME_TURNS) expect(parseRenamePolicy(formatRenamePolicy({ every: "turns", n }))).toEqual({ every: "turns", n });
    for (const n of RENAME_MINUTES) expect(parseRenamePolicy(formatRenamePolicy({ every: "minutes", n }))).toEqual({ every: "minutes", n });
    expect(parseRenamePolicy(" minutes:45 ")).toEqual({ every: "minutes", n: 45 });
  });
});
