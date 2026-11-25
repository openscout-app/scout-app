import { describe, expect, test } from "bun:test";

import {
  SCOUTBOT_MARK_LIMIT,
  readScoutbotMarks,
  scoutbotOfferMarkKey,
  scoutbotRequestMarkKey,
  writeScoutbotMark,
} from "./scoutbot-marks.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("Scoutbot marks", () => {
  test("keeps a mark and reads it back", () => {
    const storage = memoryStorage();

    writeScoutbotMark("offer:m1:0", "sent", storage);
    writeScoutbotMark("next:r1:10", "held", storage);

    expect(readScoutbotMarks(storage)).toEqual({ "offer:m1:0": "sent", "next:r1:10": "held" });
  });

  test("a request that changes gets a new key, so its row comes back", () => {
    const before = scoutbotRequestMarkKey({ id: "r1", updatedAt: 10 });
    const after = scoutbotRequestMarkKey({ id: "r1", updatedAt: 11 });

    expect(before).not.toBe(after);
  });

  test("keys an offer by its reply and its place in it", () => {
    expect(scoutbotOfferMarkKey("m1", 0)).not.toBe(scoutbotOfferMarkKey("m1", 1));
    expect(scoutbotOfferMarkKey("m1", 0)).not.toBe(scoutbotOfferMarkKey("m2", 0));
  });

  test("drops the oldest marks past the limit and keeps the newest", () => {
    const storage = memoryStorage();
    for (let index = 0; index < SCOUTBOT_MARK_LIMIT + 5; index += 1) {
      writeScoutbotMark(`next:r${index}:1`, "held", storage);
    }
    const marks = readScoutbotMarks(storage);

    expect(Object.keys(marks)).toHaveLength(SCOUTBOT_MARK_LIMIT);
    expect(marks["next:r0:1"]).toBeUndefined();
    expect(marks[`next:r${SCOUTBOT_MARK_LIMIT + 4}:1`]).toBe("held");
  });

  test("marking again moves a mark to the newest end", () => {
    const storage = memoryStorage();
    writeScoutbotMark("a", "held", storage);
    writeScoutbotMark("b", "held", storage);
    writeScoutbotMark("a", "sent", storage);

    expect(Object.entries(readScoutbotMarks(storage))).toEqual([["b", "held"], ["a", "sent"]]);
  });

  test("reads nothing from missing, broken or foreign storage", () => {
    expect(readScoutbotMarks(null)).toEqual({});
    expect(readScoutbotMarks(memoryStorage({ "openscout.scoutbot.marks": "{not json" }))).toEqual({});
    expect(readScoutbotMarks(memoryStorage({ "openscout.scoutbot.marks": "[1,2]" }))).toEqual({});
    expect(readScoutbotMarks(memoryStorage({
      "openscout.scoutbot.marks": JSON.stringify({ a: "held", b: "done", c: 3 }),
    }))).toEqual({ a: "held" });
  });

  test("still returns the mark when storage refuses the write", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };

    expect(writeScoutbotMark("a", "held", storage)).toEqual({ a: "held" });
  });
});
