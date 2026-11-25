import { describe, expect, test } from "bun:test";
import { foldWord, noteSeen, panelFold, parseFoldHolds, toggleFold, type FoldHolds, type PanelContent } from "./hud-grid-fold.ts";
import { fitHeights, growToBottom, type GridLayout } from "./hud-grid-layout.ts";

const empty: PanelContent = { empty: true };
const full = (mark: string): PanelContent => ({ empty: false, mark, count: 2 });

describe("hud grid fold", () => {
  test("an empty panel folds on its own and opens when content arrives", () => {
    expect(panelFold(empty, undefined)).toEqual({ folded: true, manual: false, fresh: false });
    expect(panelFold(full("a"), undefined)).toEqual({ folded: false, manual: false, fresh: false });
    // before its content reports, a panel draws open
    expect(panelFold(undefined, undefined).folded).toBe(false);
  });

  test("a panel folded by hand stays folded when content arrives, and marks the arrival", () => {
    const holds = toggleFold({}, "queue", full("a"));
    expect(holds.queue).toEqual({ held: "folded", seen: "a" });
    expect(panelFold(full("a"), holds.queue)).toEqual({ folded: true, manual: true, fresh: false });
    expect(panelFold(full("b"), holds.queue)).toEqual({ folded: true, manual: true, fresh: true });
    // empty again: nothing new to mark
    expect(panelFold(empty, holds.queue).fresh).toBe(false);
  });

  test("a time mark is news only when it grows", () => {
    const hold = { held: "folded" as const, seen: "200" };
    expect(panelFold(full("300"), hold).fresh).toBe(true);
    // the newest item left: the latest time went back, nothing arrived
    expect(panelFold(full("150"), hold).fresh).toBe(false);
    // an id mark: any change is news
    expect(panelFold(full("lane-b@2"), { held: "folded", seen: "lane-a@9" }).fresh).toBe(true);
  });

  test("opening a hand fold whose content is there drops the hold", () => {
    const holds = toggleFold({}, "queue", full("a"));
    expect(toggleFold(holds, "queue", full("b"))).toEqual({});
  });

  test("opening an empty panel by hand holds it open; folding it again goes back to following its content", () => {
    const opened = toggleFold({}, "lane", empty);
    expect(opened.lane).toEqual({ held: "open" });
    expect(panelFold(empty, opened.lane).folded).toBe(false);
    expect(toggleFold(opened, "lane", empty)).toEqual({});
  });

  test("a fold made before the content reported takes its first mark as seen", () => {
    const holds: FoldHolds = toggleFold({}, "summary", undefined);
    expect(holds.summary).toEqual({ held: "folded", seen: undefined });
    const noted = noteSeen(holds, "summary", full("a"));
    expect(noted.summary).toEqual({ held: "folded", seen: "a" });
    expect(panelFold(full("a"), noted.summary).fresh).toBe(false);
    expect(noteSeen(noted, "summary", full("b"))).toBe(noted);
  });

  test("the folded row's word: news, then the content's word, then empty", () => {
    const fresh = panelFold(full("b"), { held: "folded", seen: "a" });
    expect(foldWord(fresh, { ...full("b"), state: "waiting" })).toBe("new");
    expect(foldWord(panelFold(empty, undefined), { empty: true, state: "all clear" })).toBe("all clear");
    expect(foldWord(panelFold(empty, undefined), empty)).toBe("empty");
    expect(foldWord(panelFold(full("a"), undefined), full("a"))).toBeNull();
  });

  test("holds read back from storage keep known shapes only", () => {
    expect(parseFoldHolds(null)).toEqual({});
    expect(parseFoldHolds([])).toEqual({});
    expect(parseFoldHolds({ a: { held: "folded", seen: "x" }, b: { held: "open", seen: "y" }, c: { held: "wide" }, d: 4 })).toEqual({
      a: { held: "folded", seen: "x" },
      b: { held: "open" },
    });
  });

  test("a folded panel gives its rows to the panels in its column (Ops › Lanes' right column)", () => {
    const cells: GridLayout = [
      { id: "roster", x: 0, y: 0, w: 2, h: 28 },
      { id: "deck", x: 2, y: 0, w: 6, h: 28 },
      { id: "lane", x: 8, y: 0, w: 4, h: 14 },
      { id: "summary", x: 8, y: 14, w: 4, h: 8 },
      { id: "queue", x: 8, y: 22, w: 4, h: 6 },
    ];
    const folded = new Set(["lane"]);
    const drawn = growToBottom(fitHeights(cells, { lane: 1 }), 28, (id) => !folded.has(id));
    const at = (id: string) => drawn.find((i) => i.id === id)!;
    expect(at("lane")).toMatchObject({ y: 0, h: 1 });
    expect(at("summary")).toMatchObject({ y: 1, h: 8 });
    // the lowest panel that can grow takes the 13 rows the fold freed; the column still ends with the deck
    expect(at("queue")).toMatchObject({ y: 9, h: 19 });
    expect(at("deck")).toMatchObject({ y: 0, h: 28 });
  });

  test("a folded panel at the bottom of a column stays one row; the panel above it takes the room", () => {
    const cells: GridLayout = [
      { id: "lane", x: 8, y: 0, w: 4, h: 14 },
      { id: "summary", x: 8, y: 14, w: 4, h: 8 },
      { id: "queue", x: 8, y: 22, w: 4, h: 6 },
    ];
    const folded = new Set(["queue"]);
    const drawn = growToBottom(fitHeights(cells, { queue: 1 }), 28, (id) => !folded.has(id));
    const at = (id: string) => drawn.find((i) => i.id === id)!;
    expect(at("queue")).toMatchObject({ y: 27, h: 1 });
    expect(at("summary")).toMatchObject({ y: 14, h: 13 });
  });
});
