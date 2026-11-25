import { describe, expect, test } from "bun:test";
import { HOME_GRID_ARRANGEMENTS, HOME_GRID_DEFAULT } from "../../screens/home/home-grid.ts";
import { collides, edit, expand, heightLimit, inferPanes, land, paneAt, paneMove, paneTarget, paneTrade, panesOf, swapTarget, swapWith, fitHeights, fitTo, gridColumnsFor, mergeSaved, minFor, parseLayout, reconcile, resolve, rowsFor, seamAt, shrinkToRows, unfitHeights, widthLimit, type GridLayout, growToBottom } from "./hud-grid-layout.ts";

const overlaps = (l: GridLayout) => l.some((a) => l.some((b) => collides(a, b)));
const inBounds = (l: GridLayout, cols: number) => l.every((i) => i.x >= 0 && i.x + i.w <= cols && i.y >= 0);

describe("hud grid layout", () => {
  test("every Home arrangement fits 12 and 8 columns without overlap", () => {
    for (const a of HOME_GRID_ARRANGEMENTS) {
      for (const cols of [12, 8]) {
        const l = fitTo(a.layout, cols);
        expect(overlaps(l)).toBe(false);
        expect(inBounds(l, cols)).toBe(true);
      }
    }
  });

  // Main's "moving a panel onto another pushes the other below", kept for a plain drag. Swapping is
  // deliberate: only with ⌥ held does a move onto a neighbour along a whole edge trade places.
  test("moving a panel onto another pushes the other below; with ⌥ held, onto its neighbour it trades places", () => {
    const from = { x: 4, y: 16.5 }; // coord's head
    const plain = swapTarget(HOME_GRID_DEFAULT, "coord", { x: 4, y: 9.5 }, from, null, 12);
    expect(plain).toBeNull();
    const pushed = edit(HOME_GRID_DEFAULT, "coord", "move", 0, -7, 12, undefined, undefined, plain);
    const coord = pushed.find((i) => i.id === "coord")!;
    expect(pushed.find((i) => i.id === "moving")!.y).toBeGreaterThanOrEqual(coord.y + coord.h);
    expect(overlaps(pushed)).toBe(false);
    const onMoving = swapTarget(HOME_GRID_DEFAULT, "coord", { x: 4, y: 9.5 }, from, null, 12, undefined, undefined, true);
    expect(onMoving).toBe("moving");
    const traded = edit(HOME_GRID_DEFAULT, "coord", "move", 0, -7, 12, undefined, undefined, onMoving);
    expect(traded.find((i) => i.id === "coord")).toMatchObject({ y: 6, h: 10 });
    expect(traded.find((i) => i.id === "moving")).toMatchObject({ y: 16, h: 10 });
    expect(traded.filter((i) => i.id !== "coord" && i.id !== "moving")).toEqual(HOME_GRID_DEFAULT.filter((i) => i.id !== "coord" && i.id !== "moving"));
    // quotas is two panels up, not a neighbour: no trade even with ⌥, and the move pushes it below as on main
    const onQuotas = swapTarget(HOME_GRID_DEFAULT, "coord", { x: 4, y: 0.5 }, from, null, 12, undefined, undefined, true);
    expect(onQuotas).toBeNull();
    const l = edit(HOME_GRID_DEFAULT, "coord", "move", 0, -16, 12, undefined, undefined, onQuotas);
    expect(l.find((i) => i.id === "coord")!.y).toBe(0);
    expect(overlaps(l)).toBe(false);
  });

  const stack: GridLayout = [
    { id: "a", x: 0, y: 0, w: 12, h: 4 },
    { id: "b", x: 0, y: 4, w: 12, h: 4 },
    { id: "c", x: 0, y: 8, w: 12, h: 4 },
  ];
  const order = (l: GridLayout) => [...l].sort((p, q) => p.y - q.y || p.x - q.x).map((i) => i.id);

  test("a panel a downward move passes rises into the room the move left", () => {
    const l = edit(stack, "a", "move", 0, 5, 12);
    expect(order(l)).toEqual(["b", "a", "c"]);
    expect(l).toEqual(resolve(l));
  });

  test("a short downward drag shows no change: the move must pass the panel's height", () => {
    expect(edit(stack, "a", "move", 0, 2, 12)).toEqual(stack);
    expect(edit(stack, "a", "move", 0, 3, 12)).toEqual(stack);
  });

  test("a move's preview is already packed, so the drop saves it unchanged", () => {
    for (const dy of [-8, -4, 2, 5, 9, 20]) {
      const l = edit(stack, "b", "move", 0, dy, 12);
      expect(land(l, stack, stack, "b", "move")).toEqual(l);
    }
  });

  test("resizing clamps to the column count and minimums", () => {
    // the panel beside it gives down to the grid's 2-column floor and stays beside (expand takes the row)
    const wide = edit(HOME_GRID_DEFAULT, "quotas", "width", 20, 0, 12);
    expect(wide.find((i) => i.id === "quotas")!.w).toBe(10);
    const alone = edit([{ id: "a", x: 3, y: 0, w: 4, h: 4 }], "a", "width", 20, 0, 12);
    expect(alone[0]).toMatchObject({ x: 3, w: 9 });
    const tiny = edit(HOME_GRID_DEFAULT, "quotas", "size", -20, -20, 12);
    expect(tiny.find((i) => i.id === "quotas")).toMatchObject({ w: 2, h: 3 });
    expect(overlaps(wide) || overlaps(tiny)).toBe(false);
  });

  test("expand grows into free columns, else takes the full row", () => {
    const narrow: GridLayout = [
      { id: "a", x: 0, y: 0, w: 4, h: 4 },
      { id: "b", x: 8, y: 0, w: 4, h: 4 },
    ];
    expect(expand(narrow, "a", 12).find((i) => i.id === "a")!.w).toBe(8);
    const full = expand(HOME_GRID_DEFAULT, "quotas", 12);
    expect(full.find((i) => i.id === "quotas")).toMatchObject({ x: 0, w: 12 });
    expect(overlaps(full)).toBe(false);
  });

  test("absent panels leave no hole and keep their saved cell", () => {
    const view = reconcile(null, HOME_GRID_DEFAULT, ["moving", "tail", "coord"], 12);
    expect(view.find((i) => i.id === "moving")!.y).toBe(0);
    const saved = mergeSaved(HOME_GRID_DEFAULT, view);
    expect(saved.find((i) => i.id === "quotas")).toEqual(HOME_GRID_DEFAULT[0]);
  });

  test("parseLayout rejects malformed storage", () => {
    expect(parseLayout([{ id: "a", x: 0, y: 0, w: 2 }])).toBeNull();
    expect(parseLayout("x")).toBeNull();
    expect(parseLayout([{ id: "a", x: 0, y: 0, w: 2, h: 3 }])).toEqual([{ id: "a", x: 0, y: 0, w: 2, h: 3 }]);
  });
});

describe("per-panel minimums", () => {
  const mins = { t: { w: 4, h: 8 } };

  test("resizing stops at the panel's minimum, not the grid's", () => {
    const base = [{ id: "t", x: 0, y: 0, w: 6, h: 12 }];
    expect(edit(base, "t", "size", -5, -10, 12, mins)[0]).toMatchObject({ w: 4, h: 8 });
  });

  test("a minimum wider than the room to the right slides the panel left", () => {
    const base = [{ id: "t", x: 10, y: 0, w: 2, h: 8 }];
    expect(edit(base, "t", "width", 0, 0, 12, mins)[0]).toMatchObject({ x: 8, w: 4 });
  });

  test("a saved cell below the minimum is lifted to it", () => {
    const out = reconcile([{ id: "t", x: 0, y: 0, w: 2, h: 3 }], [], ["t"], 12, mins);
    expect(out[0]).toMatchObject({ w: 4, h: 8 });
  });

  test("mapping down to 8 columns keeps the minimum", () => {
    const out = fitTo([{ id: "t", x: 0, y: 0, w: 4, h: 8 }, { id: "u", x: 4, y: 0, w: 8, h: 8 }], 8, mins);
    expect(out.find((i) => i.id === "t")!.w).toBeGreaterThanOrEqual(4);
  });

  test("mapping down fills the columns a dropped neighbour leaves", () => {
    // 3 + 3 + 4 minimums do not fit 8 columns: the right panel drops below,
    // and the middle one takes the columns it left
    const fit = fitTo(
      [
        { id: "list", x: 0, y: 0, w: 3, h: 24 },
        { id: "rows", x: 3, y: 0, w: 4, h: 16 },
        { id: "detail", x: 7, y: 0, w: 5, h: 16 },
      ],
      8,
      { list: { w: 3, h: 6 }, rows: { w: 3, h: 6 }, detail: { w: 4, h: 8 } },
    );
    expect(overlaps(fit)).toBe(false);
    expect(inBounds(fit, 8)).toBe(true);
    expect(fit.find((i) => i.id === "rows")).toMatchObject({ x: 3, w: 5 });
    const detail = fit.find((i) => i.id === "detail")!;
    expect(detail.y).toBeGreaterThanOrEqual(16);
    expect(detail.x + detail.w).toBe(8);
  });

  test("mapping the Home desk to 8 columns keeps it packed", () => {
    // Tail (min 4) beside Moving (min 5) does not fit 8 columns: Coordination
    // narrows to sit beside Tail instead of dropping below it
    const desk: GridLayout = [
      { id: "home-cockpit", x: 0, y: 0, w: 12, h: 3 },
      { id: "home-quotas", x: 0, y: 3, w: 8, h: 6 },
      { id: "home-velocity", x: 8, y: 3, w: 4, h: 6 },
      { id: "home-moving", x: 0, y: 9, w: 8, h: 10 },
      { id: "home-tail", x: 8, y: 9, w: 4, h: 20 },
      { id: "home-coord", x: 0, y: 19, w: 8, h: 10 },
      { id: "home-recent", x: 0, y: 29, w: 8, h: 8 },
      { id: "home-message", x: 8, y: 29, w: 4, h: 8 },
    ];
    const fit = fitTo(desk, 8, {
      "home-cockpit": { w: 4, h: 3 },
      "home-quotas": { w: 4, h: 4 },
      "home-velocity": { w: 4, h: 4 },
      "home-moving": { w: 5, h: 6 },
      "home-tail": { w: 4, h: 7 },
      "home-coord": { w: 4, h: 6 },
      "home-recent": { w: 3, h: 6 },
      "home-message": { w: 3, h: 5 },
    });
    const at = (id: string) => fit.find((i) => i.id === id)!;
    expect(overlaps(fit)).toBe(false);
    expect(inBounds(fit, 8)).toBe(true);
    expect(at("home-quotas")).toMatchObject({ x: 0, w: 4 });
    expect(at("home-velocity")).toMatchObject({ x: 4, w: 4, y: at("home-quotas").y });
    expect(at("home-moving").w).toBe(8);
    const tail = at("home-tail");
    expect(at("home-coord")).toMatchObject({ x: 0, w: 4, y: tail.y });
    // left of the tail, on the rows it spans, at most 2 rows stay empty
    let empty = 0;
    for (let y = tail.y; y < tail.y + tail.h; y++) {
      if (!fit.some((i) => i.x < tail.x && i.y <= y && y < i.y + i.h)) empty++;
    }
    expect(empty).toBeLessThanOrEqual(2);
  });

  test("a minimum never exceeds the column count", () => {
    expect(minFor({ t: { w: 20, h: 4 } }, "t", 8)).toEqual({ w: 8, h: 4 });
  });
});

describe("shared edges", () => {
  const pair: GridLayout = [
    { id: "a", x: 0, y: 0, w: 6, h: 8 },
    { id: "b", x: 6, y: 0, w: 6, h: 8 },
  ];
  test("widening a panel narrows the one beside it instead of pushing it down", () => {
    const out = edit(pair, "a", "width", 2, 0, 12);
    expect(out.find((i) => i.id === "a")).toMatchObject({ x: 0, w: 8, y: 0 });
    expect(out.find((i) => i.id === "b")).toMatchObject({ x: 8, w: 4, y: 0 });
  });
  test("narrowing a panel lets the one beside it take the room", () => {
    const out = edit(pair, "a", "width", -2, 0, 12);
    expect(out.find((i) => i.id === "b")).toMatchObject({ x: 4, w: 8, y: 0 });
  });
  test("the shared edge stops where the neighbour reaches its minimum; the neighbour stays beside", () => {
    const held = edit(pair, "a", "width", 2, 0, 12, { b: { w: 6, h: 3 } });
    expect(held.find((i) => i.id === "a")).toMatchObject({ x: 0, w: 6, y: 0 });
    expect(held.find((i) => i.id === "b")).toMatchObject({ x: 6, w: 6, y: 0 });
    const part = edit(pair, "a", "width", 3, 0, 12, { b: { w: 5, h: 3 } });
    expect(part.find((i) => i.id === "a")).toMatchObject({ x: 0, w: 7, y: 0 });
    expect(part.find((i) => i.id === "b")).toMatchObject({ x: 7, w: 5, y: 0 });
  });
  test("a width drag draws the panel no wider than its neighbours can give", () => {
    expect(widthLimit(pair, "a", 12)).toBe(10); // b down to the grid's 2-column floor
    expect(widthLimit(pair, "a", 12, { b: { w: 5, h: 3 } })).toBe(7);
    expect(widthLimit(pair, "a", 12, { b: { w: 8, h: 3 } })).toBe(6);
    expect(widthLimit([{ id: "lone", x: 3, y: 0, w: 4, h: 4 }], "lone", 12)).toBe(9);
  });
});

describe("columns for a width", () => {
  const lone: GridLayout = [{ id: "deck", x: 0, y: 0, w: 12, h: 28 }];
  const stacked: GridLayout = [
    { id: "a", x: 0, y: 0, w: 12, h: 10 },
    { id: "b", x: 0, y: 10, w: 6, h: 8 },
  ];
  const beside: GridLayout = [
    { id: "a", x: 0, y: 0, w: 6, h: 10 },
    { id: "b", x: 6, y: 0, w: 6, h: 10 },
  ];
  test("panels side by side need the room: 12 from 1100px, 8 from 720, stacked below", () => {
    for (const l of [undefined, beside]) {
      expect(gridColumnsFor(1400, l)).toBe(12);
      expect(gridColumnsFor(900, l)).toBe(8);
      expect(gridColumnsFor(600, l)).toBeNull();
    }
  });
  test("one panel, or panels one over another, keep the grid at any width: nothing to stack", () => {
    for (const l of [lone, stacked]) {
      expect(gridColumnsFor(480, l)).toBe(12);
      expect(gridColumnsFor(900, l)).toBe(12);
    }
    expect(gridColumnsFor(0, lone)).toBeNull(); // not measured yet
  });
});

describe("shrinkToRows", () => {
  const end = (l: GridLayout) => Math.max(...l.map((i) => i.y + i.h));
  test("a layout that fits the window is returned as is", () => {
    const l: GridLayout = [{ id: "deck", x: 0, y: 0, w: 12, h: 20 }];
    expect(shrinkToRows(l, 24)).toBe(l);
    expect(shrinkToRows(l, 0)).toBe(l); // window not measured
  });
  test("a panel taller than the window comes up to its bottom row", () => {
    const out = shrinkToRows([{ id: "deck", x: 0, y: 0, w: 12, h: 28 }], 20);
    expect(out).toEqual([{ id: "deck", x: 0, y: 0, w: 12, h: 20 }]);
  });
  test("panels one over another each give, never below their minimum, and close up", () => {
    const l: GridLayout = [
      { id: "a", x: 0, y: 0, w: 12, h: 10 },
      { id: "b", x: 0, y: 10, w: 12, h: 10 },
    ];
    const out = shrinkToRows(l, 14, undefined, { a: { w: 2, h: 8 }, b: { w: 2, h: 4 } });
    const a = out.find((i) => i.id === "a")!;
    const b = out.find((i) => i.id === "b")!;
    expect(end(out)).toBe(14);
    expect(a.h).toBeGreaterThanOrEqual(8);
    expect(b.h).toBeGreaterThanOrEqual(4);
    expect(b.y).toBe(a.h);
    expect(overlaps(out)).toBe(false);
  });
  test("only panels that follow the window give; one you sized keeps its height", () => {
    const l: GridLayout = [
      { id: "sized", x: 0, y: 0, w: 12, h: 6 },
      { id: "stream", x: 0, y: 6, w: 12, h: 20 },
    ];
    const out = shrinkToRows(l, 18, (id) => id === "stream");
    expect(out.find((i) => i.id === "sized")!.h).toBe(6);
    expect(out.find((i) => i.id === "stream")).toMatchObject({ y: 6, h: 12 });
  });
  test("columns that cannot come up to the window leave the whole layout as it is: the page scrolls", () => {
    const l: GridLayout = [
      { id: "a", x: 0, y: 0, w: 6, h: 28 },
      { id: "b", x: 6, y: 0, w: 6, h: 28 },
    ];
    expect(shrinkToRows(l, 20, undefined, { b: { w: 2, h: 24 } })).toBe(l);
    const out = shrinkToRows(l, 20);
    expect(out.map((i) => i.h)).toEqual([20, 20]);
  });
  test("the Work page in a short window comes up whole: no rows left empty, edges that met still meet", () => {
    // the shipped Work layout and its panels' minimums; 33 rows is a laptop window
    const work: GridLayout = [
      { id: "list", x: 0, y: 0, w: 3, h: 24 },
      { id: "item", x: 3, y: 0, w: 6, h: 24 },
      { id: "people", x: 9, y: 0, w: 3, h: 10 },
      { id: "flights", x: 9, y: 10, w: 3, h: 14 },
      { id: "timeline", x: 0, y: 24, w: 6, h: 16 },
      { id: "tail", x: 6, y: 24, w: 6, h: 16 },
      { id: "files", x: 0, y: 40, w: 12, h: 16 },
    ];
    const mins = { list: { w: 3, h: 4 }, item: { w: 4, h: 10 }, people: { w: 3, h: 5 }, flights: { w: 3, h: 5 }, timeline: { w: 4, h: 6 }, tail: { w: 4, h: 7 }, files: { w: 5, h: 10 } };
    const out = shrinkToRows(work, 33, undefined, mins);
    const cell = (id: string) => out.find((i) => i.id === id)!;
    expect(end(out)).toBe(33);
    expect(overlaps(out)).toBe(false);
    // every column is covered from the top row to the bottom one: no hole anywhere
    for (let x = 0; x < 12; x++) for (let y = 0; y < 33; y++) expect(out.some((i) => i.x <= x && x < i.x + i.w && i.y <= y && y < i.y + i.h)).toBe(true);
    // the list ends where the item ends, the timeline and the tail start together under them
    expect(cell("list").h).toBe(cell("item").h);
    expect(cell("people").h + cell("flights").h).toBe(cell("item").h);
    expect(cell("timeline")).toMatchObject({ y: cell("item").h, h: cell("tail").h });
    expect(cell("tail").y).toBe(cell("timeline").y);
    for (const i of out) expect(i.h).toBeGreaterThanOrEqual(mins[i.id as keyof typeof mins].h);
  });
  test("a panel that keeps its height holds only the rows it crosses; the bands beside it still give", () => {
    const l: GridLayout = [
      { id: "head", x: 0, y: 0, w: 12, h: 4 },
      { id: "side", x: 0, y: 4, w: 4, h: 20 },
      { id: "main", x: 4, y: 4, w: 8, h: 20 },
    ];
    const out = shrinkToRows(l, 16, (id) => id !== "head");
    expect(out).toEqual([
      { id: "head", x: 0, y: 0, w: 12, h: 4 },
      { id: "side", x: 0, y: 4, w: 4, h: 12 },
      { id: "main", x: 4, y: 4, w: 8, h: 12 },
    ]);
  });
  test("empty rows across the whole grid go before any panel gives", () => {
    const l: GridLayout = [
      { id: "a", x: 0, y: 0, w: 12, h: 10 },
      { id: "b", x: 0, y: 14, w: 12, h: 10 },
    ];
    expect(shrinkToRows(l, 20)).toEqual([
      { id: "a", x: 0, y: 0, w: 12, h: 10 },
      { id: "b", x: 0, y: 10, w: 12, h: 10 },
    ]);
  });
});

describe("saved cells from storage", () => {
  test("a cell out of bounds is refused, not trusted", () => {
    expect(parseLayout([{ id: "a", x: 0, y: 1e20, w: 7, h: 22 }])).toBeNull();
    expect(parseLayout([{ id: "a", x: 0, y: 0, w: 0.5, h: 22 }])).toBeNull();
    expect(parseLayout([{ id: "a", x: 12, y: 0, w: 2, h: 4 }])).toBeNull();
    expect(parseLayout([{ id: "", x: 0, y: 0, w: 2, h: 4 }])).toBeNull();
  });
  test("a repeated id keeps its first cell", () => {
    expect(parseLayout([{ id: "a", x: 0, y: 0, w: 2, h: 4 }, { id: "a", x: 2, y: 0, w: 2, h: 4 }])).toEqual([{ id: "a", x: 0, y: 0, w: 2, h: 4 }]);
  });
  test("resolve packs a far-down panel in bounded time", () => {
    const out = resolve([{ id: "a", x: 0, y: 0, w: 4, h: 4 }, { id: "b", x: 0, y: 1e9, w: 4, h: 4 }]);
    expect(out.find((i) => i.id === "b")!.y).toBe(4);
  });
});

describe("content-fit heights", () => {
  const cells: GridLayout = [
    { id: "list", x: 0, y: 0, w: 8, h: 10 },
    { id: "chart", x: 8, y: 0, w: 4, h: 6 },
    { id: "under", x: 0, y: 10, w: 8, h: 6 },
  ];

  test("rows for a height: whole rows at the row pitch, at least one", () => {
    expect(rowsFor(0, 24)).toBe(1);
    expect(rowsFor(24, 24)).toBe(1);
    expect(rowsFor(25, 24)).toBe(2);
    expect(rowsFor(150, 24)).toBe(5);
  });

  test("a fitted panel draws no taller than its content and what is under it closes up", () => {
    const drawn = fitHeights(cells, { list: 4 });
    expect(drawn.find((i) => i.id === "list")!.h).toBe(4);
    expect(drawn.find((i) => i.id === "under")!.y).toBe(4);
    expect(drawn.find((i) => i.id === "chart")).toEqual(cells[1]!);
  });

  test("content taller than the cell keeps the cell: it scrolls", () => {
    expect(fitHeights(cells, { list: 14 })).toBe(cells);
  });

  test("a move on the drawn layout gives fitted panels their cells back; a resize keeps what it set", () => {
    const drawn = fitHeights(cells, { list: 4 });
    const moved = edit(drawn, "under", "move", 0, -1, 12);
    expect(unfitHeights(moved, drawn, cells, "under").find((i) => i.id === "list")!.h).toBe(10);
    const sized = edit(drawn, "list", "height", 0, 2, 12);
    expect(unfitHeights(sized, drawn, cells, "list").find((i) => i.id === "list")!.h).toBe(6);
  });

  test("landing a move with fitted heights keeps the order the preview showed", () => {
    // `a` draws 4 rows of its 10-row cell; `b` is dragged past `d`
    const fitted: GridLayout = [
      { id: "a", x: 0, y: 0, w: 8, h: 10 },
      { id: "b", x: 0, y: 10, w: 8, h: 6 },
      { id: "d", x: 0, y: 16, w: 8, h: 6 },
    ];
    const drawn = fitHeights(fitted, { a: 4 });
    const preview = edit(drawn, "b", "move", 0, 6, 12);
    const ids = (l: GridLayout) => [...l].sort((p, q) => p.y - q.y).map((i) => i.id);
    expect(ids(preview)).toEqual(["a", "d", "b"]);
    const landed = land(preview, drawn, fitted, "b", "move");
    expect(ids(landed)).toEqual(["a", "d", "b"]);
    expect(landed.find((i) => i.id === "a")!.h).toBe(10);
    // pinning the moved panel here put `b` back above `d` once `a` grew back
    expect(ids(resolve(unfitHeights(preview, drawn, fitted, "b")))).toEqual(["a", "b", "d"]);
  });

  test("a height drawn to the window, grown or shrunk, is never saved into the cell", () => {
    const deck: GridLayout = [{ id: "deck", x: 0, y: 0, w: 12, h: 28 }];
    for (const h of [20, 34]) {
      const drawn: GridLayout = [{ id: "deck", x: 0, y: 0, w: 12, h }];
      expect(unfitHeights(drawn, drawn, deck)[0]!.h).toBe(28);
    }
    const shrunk: GridLayout = [{ id: "deck", x: 0, y: 0, w: 12, h: 20 }];
    const sized = edit(shrunk, "deck", "height", 0, 2, 12);
    expect(unfitHeights(sized, shrunk, deck, "deck")[0]!.h).toBe(22);
  });
});

describe("growToBottom", () => {
  test("the lowest panel of each column takes the room down to the bottom row", () => {
    const layout = [
      { id: "quotas", x: 0, y: 0, w: 8, h: 4 },
      { id: "coord", x: 0, y: 4, w: 8, h: 5 },
      { id: "velocity", x: 8, y: 0, w: 4, h: 6 },
      { id: "tail", x: 8, y: 6, w: 4, h: 14 },
    ];
    expect(growToBottom(layout, 20)).toEqual([
      { id: "quotas", x: 0, y: 0, w: 8, h: 4 },
      { id: "coord", x: 0, y: 4, w: 8, h: 16 },
      { id: "velocity", x: 8, y: 0, w: 4, h: 6 },
      { id: "tail", x: 8, y: 6, w: 4, h: 14 },
    ]);
  });

  test("a panel with another under any of its columns stays as it is, and a full grid is returned as is", () => {
    const layout = [
      { id: "wide", x: 0, y: 0, w: 12, h: 3 },
      { id: "left", x: 0, y: 3, w: 6, h: 4 },
    ];
    expect(growToBottom(layout, 10).find((i) => i.id === "wide")?.h).toBe(3);
    expect(growToBottom(layout, 10).find((i) => i.id === "left")?.h).toBe(7);
    const full = [{ id: "a", x: 0, y: 0, w: 12, h: 10 }];
    expect(growToBottom(full, 10)).toBe(full);
  });

  test("the room goes to the column's growable panel; the panel under it keeps its height and moves down", () => {
    const layout = [
      { id: "velocity", x: 8, y: 0, w: 4, h: 6 },
      { id: "tail", x: 8, y: 6, w: 4, h: 8 },
      { id: "message", x: 8, y: 14, w: 4, h: 3 },
    ];
    const out = growToBottom(layout, 20, (id) => id === "tail");
    expect(out.find((i) => i.id === "tail")).toEqual({ id: "tail", x: 8, y: 6, w: 4, h: 11 });
    expect(out.find((i) => i.id === "message")).toEqual({ id: "message", x: 8, y: 17, w: 4, h: 3 });
    expect(out.find((i) => i.id === "velocity")?.h).toBe(6);
  });

  test("a column with nothing that can use the room ends level anyway: its last panel takes it", () => {
    const layout = [
      { id: "quotas", x: 0, y: 0, w: 8, h: 4 },
      { id: "sized-by-you", x: 0, y: 4, w: 8, h: 5 },
    ];
    const out = growToBottom(layout, 20, () => false);
    expect(out.find((i) => i.id === "quotas")).toEqual({ id: "quotas", x: 0, y: 0, w: 8, h: 4 });
    expect(out.find((i) => i.id === "sized-by-you")).toEqual({ id: "sized-by-you", x: 0, y: 4, w: 8, h: 16 });
  });

  test("a stream above a panel you sized still takes the room first; the sized panel keeps its height", () => {
    const layout = [
      { id: "tail", x: 8, y: 0, w: 4, h: 8 },
      { id: "sized-by-you", x: 8, y: 8, w: 4, h: 4 },
    ];
    const out = growToBottom(layout, 20, (id) => id === "tail");
    expect(out.find((i) => i.id === "tail")?.h).toBe(16);
    expect(out.find((i) => i.id === "sized-by-you")).toEqual({ id: "sized-by-you", x: 8, y: 16, w: 4, h: 4 });
  });

  test("a wide panel over two columns never grows into either; each column's last panel ends level", () => {
    const layout = [
      { id: "wide", x: 0, y: 0, w: 12, h: 4 },
      { id: "recent", x: 0, y: 4, w: 6, h: 6 },
      { id: "terminal", x: 6, y: 4, w: 6, h: 3 },
    ];
    // only the wide panel is a stream: growing it would push one column and run into the other
    const out = growToBottom(layout, 14, (id) => id === "wide");
    expect(out.find((i) => i.id === "wide")?.h).toBe(4);
    expect(out.find((i) => i.id === "recent")).toEqual({ id: "recent", x: 0, y: 4, w: 6, h: 10 });
    expect(out.find((i) => i.id === "terminal")).toEqual({ id: "terminal", x: 6, y: 4, w: 6, h: 10 });
    expect(overlaps(out)).toBe(false);
  });
});

describe("seamAt", () => {
  // the Terminal page: index over details on the left, the session beside both
  const boxes = [
    { id: "index", left: 50, top: 40, right: 390, bottom: 430 },
    { id: "details", left: 50, top: 438, right: 390, bottom: 860 },
    { id: "session", left: 398, top: 40, right: 1420, bottom: 860 },
  ];
  test("the gap under a panel sizes its height", () => {
    expect(seamAt(boxes, 200, 434, 8)).toEqual({ id: "index", mode: "height" });
  });
  test("the gap beside a panel sizes its width", () => {
    expect(seamAt(boxes, 394, 200, 8)).toEqual({ id: "index", mode: "width" });
    expect(seamAt(boxes, 394, 600, 8)).toEqual({ id: "details", mode: "width" });
  });
  test("where the gaps cross, the bottom seam wins", () => {
    expect(seamAt(boxes, 394, 434, 8)?.id).toBe("index");
  });
  test("inside a panel or far from any edge is no seam", () => {
    expect(seamAt(boxes, 200, 300, 8)).toBeNull();
    expect(seamAt(boxes, 900, 20, 8)).toBeNull();
  });
});

describe("panes", () => {
  const two: GridLayout = [
    { id: "top", x: 0, y: 0, w: 12, h: 6 },
    { id: "a", x: 0, y: 6, w: 5, h: 10 },
    { id: "c", x: 5, y: 6, w: 7, h: 10 },
    { id: "b", x: 0, y: 16, w: 5, h: 8 },
    { id: "d", x: 5, y: 16, w: 7, h: 8 },
  ];

  test("a pane is panels sharing a column with no gap between them", () => {
    expect(inferPanes(two)).toEqual([["a", "b"], ["c", "d"]]);
    // a row's gap or a different width ends it
    expect(inferPanes(two.map((i) => (i.id === "b" ? { ...i, y: 17 } : i)))).toEqual([["c", "d"]]);
    expect(inferPanes(two.map((i) => (i.id === "d" ? { ...i, w: 6 } : i)))).toEqual([["a", "b"]]);
  });

  test("a declared pane wins where it holds; one a swap took apart frees its panels to the column they sit in", () => {
    const three: GridLayout = [...two, { id: "e", x: 0, y: 24, w: 5, h: 6 }];
    expect(inferPanes(three)).toEqual([["a", "b", "e"], ["c", "d"]]);
    expect(panesOf(three, { panes: [["a", "b"]] })).toEqual([["a", "b"], ["c", "d"]]);
    expect(panesOf(two, { swaps: [["a", "d"]] })).toEqual(inferPanes(two));
    // a and d traded cells: the declared panes no longer hold, and the columns read as d over b, c over a
    const traded = swapWith(two, "a", "d")!;
    expect(panesOf(traded, { panes: [["a", "b"], ["c", "d"]] })).toEqual([["d", "b"], ["c", "a"]]);
  });

  test("a pane taken apart resizes panel by panel, as before", () => {
    const apart = two.map((i) => (i.id === "b" ? { ...i, y: 30 } : i));
    expect(paneAt(apart, "a", panesOf(apart))).toBeNull();
    const wide = edit(apart, "a", "width", 2, 0, 12);
    expect(wide.find((i) => i.id === "b")!.w).toBe(5);
  });

  test("the hand stops where the pane will: at the far pane's minimums and the lower member's", () => {
    const mins = { c: { w: 4, h: 3 }, d: { w: 5, h: 3 }, b: { w: 2, h: 5 } };
    expect(widthLimit(two, "a", 12, mins)).toBe(7);
    expect(widthLimit(two, "b", 12, mins)).toBe(7);
    expect(heightLimit(two, "a", 12, mins)).toBe(13);
    expect(heightLimit(two, "b", 12, mins)).toBe(Infinity);
    expect(edit(two, "a", "height", 0, 9, 12, mins).find((i) => i.id === "b")).toMatchObject({ y: 19, h: 5 });
  });

  test("a trade on fitted heights saves the rows it traded and keeps the pane whole", () => {
    const drawn = fitHeights(two, { a: 4 });
    const live = edit(drawn, "a", "height", 0, 2, 12);
    const saved = land(live, drawn, two, "a", "height");
    expect(saved.find((i) => i.id === "a")).toMatchObject({ y: 6, h: 6 });
    expect(saved.find((i) => i.id === "b")).toMatchObject({ y: 12, h: 6 });
    expect(paneAt(saved, "a", panesOf(saved))).not.toBeNull();
    expect(saved.filter((i) => i.id === "c" || i.id === "d")).toEqual(two.filter((i) => i.id === "c" || i.id === "d"));
  });

  test("a pane made taller: the grid levels the other pane's bottom when it draws", () => {
    const taller = edit(two, "b", "height", 0, 4, 12);
    const end = (id: string, l: GridLayout) => { const i = l.find((x) => x.id === id)!; return i.y + i.h; };
    expect(end("b", taller) - end("d", taller)).toBe(4);
    const drawn = growToBottom(taller, 28);
    expect(end("d", drawn)).toBe(end("b", drawn));
  });
});

describe("swap on hover", () => {
  const two: GridLayout = [
    { id: "top", x: 0, y: 0, w: 12, h: 6 },
    { id: "a", x: 0, y: 6, w: 5, h: 10 },
    { id: "c", x: 5, y: 6, w: 7, h: 10 },
    { id: "b", x: 0, y: 16, w: 5, h: 8 },
    { id: "d", x: 5, y: 16, w: 7, h: 8 },
  ];
  const fromA = { x: 2.5, y: 6.5 }; // a's head
  /** With ⌥ held. */
  const opt = (at: { x: number; y: number }, held: string | null = null) => swapTarget(two, "a", at, fromA, held, 12, undefined, undefined, true);

  test("a plain drag trades with no undeclared panel, however far in; ⌥ makes the same move a trade", () => {
    for (const at of [{ x: 8.5, y: 6.5 }, { x: 8.5, y: 11 }, { x: 2.5, y: 20 }]) {
      expect(swapTarget(two, "a", at, fromA, null, 12)).toBeNull();
    }
    expect(opt({ x: 8.5, y: 11 })).toBe("c");
    expect(opt({ x: 2.5, y: 20 })).toBe("b");
  });

  test("letting go of ⌥ lets go of a held trade at once", () => {
    expect(opt({ x: 8.5, y: 11 }, "c")).toBe("c");
    expect(swapTarget(two, "a", { x: 8.5, y: 11 }, fromA, "c", 12)).toBeNull();
  });

  test("with ⌥, a pointer at the target's edge doesn't swap; a quarter of the way in, it does", () => {
    // sideways onto c, a's neighbour on its row: c starts at column 5, a quarter of its 7 columns is 1.75
    expect(opt({ x: 5.5, y: 6.5 })).toBeNull();
    expect(opt({ x: 6.5, y: 6.5 })).toBeNull();
    expect(opt({ x: 7, y: 6.5 })).toBe("c");
    // down onto b: b starts at row 16, a quarter of its 8 rows is 2
    expect(opt({ x: 2.5, y: 17.5 })).toBeNull();
    expect(opt({ x: 2.5, y: 18.5 })).toBe("b");
  });

  test("once found, the target holds until the pointer leaves it, so the preview doesn't flicker at its edge", () => {
    expect(opt({ x: 5.5, y: 6.5 }, "c")).toBe("c");
    expect(opt({ x: 4.5, y: 6.5 }, "c")).toBeNull();
  });

  test("a declared pair trades on a plain drag, engages after an eighth, and trades across sizes, where an undeclared pair keeps today's placement", () => {
    // a and d are diagonal, of different sizes: undeclared, no trade anywhere over d, even with ⌥
    expect(opt({ x: 8.5, y: 20 })).toBeNull();
    const bonds = { swaps: [["a", "d"]] };
    // declared, they trade on a plain drag: the view has said they prefer to
    expect(swapTarget(two, "a", { x: 5.5, y: 17.5 }, fromA, null, 12, undefined, bonds)).toBeNull();
    expect(swapTarget(two, "a", { x: 6, y: 17.5 }, fromA, null, 12, undefined, bonds)).toBe("d");
    const traded = edit(two, "a", "move", 4, 11, 12, undefined, bonds, "d");
    expect(traded.find((i) => i.id === "a")).toMatchObject({ x: 5, y: 16, w: 7, h: 8 });
    expect(traded.find((i) => i.id === "d")).toMatchObject({ x: 0, y: 6, w: 5, h: 10 });
    expect(traded.filter((i) => i.id !== "a" && i.id !== "d")).toEqual(two.filter((i) => i.id !== "a" && i.id !== "d"));
  });

  test("no trade that would put either panel below its minimum", () => {
    const bonds = { swaps: [["a", "d"]] };
    expect(swapTarget(two, "a", { x: 8.5, y: 20 }, fromA, null, 12, { a: { w: 2, h: 9 } }, bonds)).toBeNull();
    expect(swapTarget(two, "a", { x: 8.5, y: 20 }, fromA, null, 12, { d: { w: 6, h: 3 } }, bonds)).toBeNull();
  });

  test("two members of a pane trade order and keep their heights", () => {
    const traded = swapWith(two, "a", "b")!;
    expect(traded.find((i) => i.id === "b")).toMatchObject({ x: 0, y: 6, w: 5, h: 8 });
    expect(traded.find((i) => i.id === "a")).toMatchObject({ x: 0, y: 14, w: 5, h: 10 });
  });

  test("a trade made on fitted heights saves each panel in the other's cell", () => {
    // a draws 4 rows of its 10-row cell; dragged onto c (undeclared, side by side on one row in cells, but not as drawn)
    const bonds = { swaps: [["a", "c"]] };
    const drawn = fitHeights(two, { a: 4 });
    const live = edit(drawn, "a", "move", 5, 0, 12, undefined, bonds, "c");
    const saved = land(live, drawn, two, "a", "move");
    expect(saved.find((i) => i.id === "a")).toMatchObject({ x: 5, y: 6, w: 7, h: 10 });
    expect(saved.find((i) => i.id === "c")).toMatchObject({ x: 0, y: 6, w: 5, h: 10 });
    expect(overlaps(saved)).toBe(false);
  });
});

describe("a pane moving as one (⇧)", () => {
  // Projects, shortened: Sessions over Worktrees (5 wide) beside Session over PRs (7 wide), under a full-width Project
  const projects: GridLayout = [
    { id: "Project", x: 0, y: 0, w: 12, h: 6 },
    { id: "Sessions", x: 0, y: 6, w: 5, h: 18 },
    { id: "Session", x: 5, y: 6, w: 7, h: 18 },
    { id: "Worktrees", x: 0, y: 24, w: 5, h: 14 },
    { id: "PRs", x: 5, y: 24, w: 7, h: 14 },
  ];
  const from = { x: 2.5, y: 6.5 }; // Sessions' head

  test("the other pane is a target a quarter of the way in, not at its edge, and holds until the pointer leaves it", () => {
    // the right pane starts at column 5; a quarter of its 7 columns is 1.75
    expect(paneTarget(projects, "Sessions", { x: 6, y: 10 }, from, null)).toBeNull();
    expect(paneTarget(projects, "Sessions", { x: 7, y: 10 }, from, null)).toBe("Session");
    // over PRs, the bottom of the same pane, the target is still the pane
    expect(paneTarget(projects, "Sessions", { x: 9, y: 30 }, from, null)).toBe("Session");
    expect(paneTarget(projects, "Sessions", { x: 5.5, y: 10 }, from, "Session")).toBe("Session");
    expect(paneTarget(projects, "Sessions", { x: 4.5, y: 10 }, from, "Session")).toBeNull();
  });

  test("a panel in no pane has no pane to move: no target, no pane move", () => {
    expect(paneTarget(projects, "Project", { x: 6, y: 20 }, { x: 6, y: 0.5 }, null)).toBeNull();
    expect(paneMove(projects, "Project", 0, 10, 12)).toBeNull();
  });

  test("the panes trade sides at their own widths; the full-width panel above them doesn't move", () => {
    const l = paneMove(projects, "Sessions", 7, 0, 12, undefined, "Session")!;
    expect(l.find((i) => i.id === "Project")).toEqual(projects[0]);
    expect(l.find((i) => i.id === "Session")).toMatchObject({ x: 0, w: 7, y: 6 });
    expect(l.find((i) => i.id === "PRs")).toMatchObject({ x: 0, w: 7, y: 24 });
    expect(l.find((i) => i.id === "Sessions")).toMatchObject({ x: 7, w: 5, y: 6 });
    expect(l.find((i) => i.id === "Worktrees")).toMatchObject({ x: 7, w: 5, y: 24 });
  });

  test("no trade when a panel under the shorter column would be in the way", () => {
    const short: GridLayout = [
      { id: "Sessions", x: 0, y: 0, w: 5, h: 18 },
      { id: "Worktrees", x: 0, y: 18, w: 5, h: 14 },
      { id: "Session", x: 5, y: 0, w: 7, h: 14 },
      { id: "PRs", x: 5, y: 14, w: 7, h: 10 },
      { id: "Extra", x: 5, y: 24, w: 4, h: 8 },
    ];
    const left = short.slice(0, 2);
    const right = [short[2]!, short[3]!];
    expect(paneTrade(short, left, right)).toBeNull();
    expect(paneTarget(short, "Sessions", { x: 9, y: 5 }, { x: 2.5, y: 0.5 }, null)).toBeNull();
  });

  test("placed as one, the members keep their order, heights and shared width", () => {
    const l = paneMove(projects, "Worktrees", 0, 40, 12)!;
    const s = l.find((i) => i.id === "Sessions")!;
    const w = l.find((i) => i.id === "Worktrees")!;
    expect([s.w, s.h, w.w, w.h]).toEqual([5, 18, 5, 14]);
    expect(w.x).toBe(s.x);
    expect(w.y).toBe(s.y + s.h);
    expect(l).toEqual(resolve(l));
  });
});
