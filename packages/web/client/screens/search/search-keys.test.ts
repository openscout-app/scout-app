import { describe, expect, test } from "bun:test";

import { answerPick, searchKeyAction, stepMoment, type SearchKeyInput } from "./search-keys.ts";

const page: SearchKeyInput = {
  key: "j",
  meta: false,
  ctrl: false,
  alt: false,
  inField: false,
  inScope: true,
  inOtherPanel: false,
  onPanelFrame: false,
  fullView: false,
};

const press = (key: string, patch: Partial<SearchKeyInput> = {}) => searchKeyAction({ ...page, key, ...patch });

describe("Search keys", () => {
  test("on the page: / focuses, j and k walk, Esc clears", () => {
    expect(press("/")).toBe("focus");
    expect(press("j")).toBe("next");
    expect(press("k")).toBe("prev");
    expect(press("Escape")).toBe("escape");
    expect(press("x")).toBeNull();
  });

  test("typing in a field is typing", () => {
    for (const key of ["/", "j", "k", "Escape"]) expect(press(key, { inField: true })).toBeNull();
  });

  test("app shortcuts with a modifier are not Search's", () => {
    expect(press("k", { meta: true })).toBeNull();
    expect(press("j", { ctrl: true })).toBeNull();
    expect(press("/", { alt: true })).toBeNull();
  });

  test("a panel off the Search page answers only from inside itself", () => {
    for (const key of ["/", "j", "k", "Escape"]) expect(press(key, { inScope: false })).toBeNull();
  });

  test("another kind of panel keeps its own j, k and Esc; / still finds the field", () => {
    expect(press("j", { inOtherPanel: true })).toBeNull();
    expect(press("Escape", { inOtherPanel: true })).toBeNull();
    expect(press("/", { inOtherPanel: true })).toBe("focus");
  });

  test("Esc belongs to the grid in full view and on a panel's frame", () => {
    expect(press("Escape", { fullView: true })).toBeNull();
    expect(press("Escape", { onPanelFrame: true })).toBeNull();
    expect(press("j", { onPanelFrame: true })).toBe("next");
  });
});

describe("walking moments", () => {
  const ids = ["a", "b", "c"];

  test("from nothing, j takes the first and k the first", () => {
    expect(stepMoment(ids, null, "next")).toBe("a");
    expect(stepMoment(ids, null, "prev")).toBe("a");
  });

  test("steps and stops at the ends", () => {
    expect(stepMoment(ids, "a", "next")).toBe("b");
    expect(stepMoment(ids, "c", "next")).toBe("c");
    expect(stepMoment(ids, "a", "prev")).toBe("a");
    expect(stepMoment(ids, "c", "prev")).toBe("b");
  });

  test("a selection no longer in the list starts over", () => {
    expect(stepMoment(ids, "gone", "next")).toBe("a");
    expect(stepMoment([], "a", "next")).toBeNull();
  });
});

describe("what an answer selects", () => {
  const hits = [{ id: "a" }, { id: "b" }];

  test("the moment the selection names, when the answer holds it", () => {
    expect(answerPick(hits, "b")).toEqual({ id: "b" });
  });

  test("else the first, and nothing from an empty answer", () => {
    expect(answerPick(hits, "gone")).toEqual({ id: "a" });
    expect(answerPick(hits, null)).toEqual({ id: "a" });
    expect(answerPick([], "a")).toBeNull();
  });
});
