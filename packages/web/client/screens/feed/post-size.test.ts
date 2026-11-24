import { describe, expect, test } from "bun:test";
import { clip, dismissTarget, grow, shrink, sizeForKey, WORDS } from "./post-size.ts";

describe("post sizes", () => {
  test("Enter grows one size, Escape shrinks one size, and each stops at its end", () => {
    expect([grow("s"), grow("m"), grow("l")]).toEqual(["m", "l", "l"]);
    expect([shrink("l"), shrink("m"), shrink("s")]).toEqual(["m", "s", "s"]);
    expect(sizeForKey("Enter", "s")).toBe("m");
    expect(sizeForKey("Enter", "m")).toBe("l");
    expect(sizeForKey("Enter", "l")).toBeNull();
    expect(sizeForKey("Escape", "l")).toBe("m");
    expect(sizeForKey("Escape", "s")).toBeNull();
    expect(sizeForKey("j", "m")).toBeNull();
  });

  test("word budgets: S keeps a line of gist, L shows every word", () => {
    expect(WORDS.s.caption! > 0 && WORDS.s.caption! < WORDS.m.caption!).toBe(true);
    expect(WORDS.l).toEqual({ title: null, caption: null });
    expect(WORDS.s.title! < WORDS.m.title!).toBe(true);
  });

  test("clip cuts at a word count, drops trailing punctuation, folds space", () => {
    expect(clip("one two  three", 2)).toBe("one two…");
    expect(clip("one, two, three", 2)).toBe("one, two…");
    expect(clip("one two", 2)).toBe("one two");
    expect(clip("one two", null)).toBe("one two");
    expect(clip("one two", 0)).toBe("");
    expect(clip(null, 3)).toBe("");
  });

  test("Escape dismisses the focused opened post, else the newest opened one on the page, else nothing", () => {
    const all = () => true;
    expect(dismissTarget("b", ["a", "b", "c"], all)).toBe("b");
    // Focus on a post that was never opened (j and k): the newest opened one goes back.
    expect(dismissTarget("x", ["a", "c"], all)).toBe("c");
    // The newest one scrolled off the page into an unloaded fold: the one before it.
    expect(dismissTarget(null, ["a", "c"], (id) => id !== "c")).toBe("a");
    // Nothing open: the key is left to the page.
    expect(dismissTarget("x", [], all)).toBeNull();
  });
});
