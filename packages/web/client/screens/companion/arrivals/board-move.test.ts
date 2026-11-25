import { afterEach, beforeEach, expect, test } from "bun:test";
import type { PointerEvent as ReactPointerEvent } from "react";
import { boardMoveHandler, isOffView } from "./board-move.ts";

/* Just enough of a page for the handler: window listeners, <html>'s classes, frames. */
type Listener = (ev: never) => void;
let listeners: Map<string, Set<Listener>>;
let classes: Set<string>;
const saved = { window: globalThis.window, document: globalThis.document, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };

beforeEach(() => {
  listeners = new Map();
  classes = new Set();
  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, fn: Listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
      removeEventListener: (type: string, fn: Listener) => { listeners.get(type)?.delete(fn); },
      setTimeout: (fn: () => void) => { fn(); return 0; },
    },
    document: { documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } },
    requestAnimationFrame: (fn: () => void) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
  });
});
afterEach(() => {
  Object.assign(globalThis, { window: saved.window, document: saved.document, requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf });
});

function fire(type: string, ev: Record<string, unknown> = {}) {
  for (const fn of [...(listeners.get(type) ?? [])]) fn({ preventDefault() {}, stopPropagation() {}, ...ev } as never);
}

function board() {
  const style: Record<string, string> = {};
  const box = {
    style,
    getBoundingClientRect: () => {
      const left = style.left ? parseFloat(style.left) : 900;
      const top = style.top ? parseFloat(style.top) : 600;
      return { left, top, width: 300, height: 200, right: left + 300, bottom: top + 200 } as DOMRect;
    },
  };
  return { box, ref: { current: box as unknown as HTMLElement } };
}

const press = (x: number, y: number, target: unknown = { closest: (sel: string) => sel === "[data-board-grip]" ? {} : null }) =>
  ({ button: 0, clientX: x, clientY: y, target }) as unknown as ReactPointerEvent;

test("a press that travels past the slop moves the board and lands it", () => {
  const { box, ref } = board();
  const moving = { current: false };
  const drops: DOMRect[] = [];
  let frames = 0;
  const down = boardMoveHandler({ boxRef: ref, moving, enabled: true, onFrame: () => { frames++; }, onDrop: (r) => drops.push(r) });

  down(press(950, 620));
  fire("pointermove", { clientX: 952, clientY: 621 });
  expect(moving.current).toBe(false);
  expect(box.style.left).toBeUndefined();

  fire("pointermove", { clientX: 650, clientY: 320 });
  expect(moving.current).toBe(true);
  expect(classes.has("is-moving-board")).toBe(true);
  expect(box.style).toEqual({ translate: "none", left: "600px", top: "300px", right: "auto", bottom: "auto" });
  expect(frames).toBe(1);

  fire("pointerup");
  expect(drops).toHaveLength(1);
  expect(drops[0]!.left).toBe(600);
  expect(drops[0]!.top).toBe(300);
  expect(moving.current).toBe(false);
  expect(classes.has("is-moving-board")).toBe(false);
  expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
});

test("a button moves the board only where the grip lets presses through it", () => {
  // A chip on the notch's strip: inside the strip grip, and a button.
  const chip = { closest: (sel: string) => (sel === ".cw-s" || sel === ".cw-s button" || sel.startsWith("button")) ? {} : null };
  const travel = (opts: { grip?: string; pressThrough?: string }) => {
    const { ref } = board();
    const moving = { current: false };
    const down = boardMoveHandler({ boxRef: ref, moving, enabled: true, ...opts, onFrame: () => {}, onDrop: () => {} });
    down(press(950, 620, chip));
    fire("pointermove", { clientX: 650, clientY: 320 });
    const moved = moving.current;
    fire("pointerup");
    return moved;
  };
  expect(travel({})).toBe(false);
  expect(travel({ grip: ".cw-s" })).toBe(false);
  expect(travel({ grip: ".cw-s", pressThrough: ".cw-s button" })).toBe(true);
});

test("a press that never travels is still a click", () => {
  const { box, ref } = board();
  const drops: DOMRect[] = [];
  const down = boardMoveHandler({ boxRef: ref, moving: { current: false }, enabled: true, onFrame: () => {}, onDrop: (r) => drops.push(r) });
  down(press(950, 620));
  fire("pointermove", { clientX: 951, clientY: 621 });
  fire("pointerup");
  expect(drops).toHaveLength(0);
  expect(box.style.left).toBeUndefined();
  expect(listeners.get("click")?.size ?? 0).toBe(0);
});

test("rows, fields and the stack keep their presses", () => {
  const { ref } = board();
  const down = boardMoveHandler({ boxRef: ref, moving: { current: false }, enabled: true, onFrame: () => {}, onDrop: () => {} });
  down(press(950, 620, { closest: (sel: string) => (sel.includes("li.arv-row") ? {} : null) }));
  expect(listeners.get("pointermove")?.size ?? 0).toBe(0);

  const stacked = boardMoveHandler({ boxRef: ref, moving: { current: false }, enabled: false, onFrame: () => {}, onDrop: () => {} });
  stacked(press(950, 620));
  expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
});

test("let go past the page, the drop says so; inside, or cancelled, it does not", () => {
  Object.assign(globalThis.window, { innerWidth: 1440, innerHeight: 900 });
  const { ref } = board();
  const drops: boolean[] = [];
  const down = boardMoveHandler({ boxRef: ref, moving: { current: false }, enabled: true, onFrame: () => {}, onDrop: (_r, offView) => drops.push(offView) });
  down(press(950, 620));
  fire("pointermove", { clientX: 1500, clientY: 620 });
  fire("pointerup", { type: "pointerup", clientX: 1500, clientY: 620 });
  down(press(950, 620));
  fire("pointermove", { clientX: 600, clientY: 300 });
  fire("pointerup", { type: "pointerup", clientX: 600, clientY: 300 });
  down(press(950, 620));
  fire("pointermove", { clientX: -60, clientY: 300 });
  fire("pointercancel", { type: "pointercancel", clientX: -60, clientY: 300 });
  expect(drops).toEqual([true, false, false]);
});

test("past the page mid-move, the host carries the panel and the board goes on under the pointer", async () => {
  Object.assign(globalThis.window, { innerWidth: 1440, innerHeight: 900 });
  const { box, ref } = board();
  const asked: number[] = [];
  const drops: Array<{ left: number; offView: boolean }> = [];
  const down = boardMoveHandler({
    boxRef: ref,
    moving: { current: false },
    enabled: true,
    onFrame: () => {},
    onDrop: (r, offView) => drops.push({ left: r.left, offView }),
    // The next display sits to the right: the box at 1450 is at 10 on its page.
    onCross: async (r) => { asked.push(r.left); return { left: r.left - 1440, top: r.top }; },
  });

  down(press(950, 620)); // held 50 in from the board's left
  fire("pointermove", { clientX: 1500, clientY: 620 });
  expect(asked).toEqual([1450]);
  await Promise.resolve();
  expect(box.style.left).toBe("10px");
  // The new page's points from here on: the board keeps the same hold.
  fire("pointermove", { clientX: 120, clientY: 620 });
  expect(box.style.left).toBe("70px");
  fire("pointerup", { type: "pointerup", clientX: 120, clientY: 620 });
  expect(drops).toEqual([{ left: 70, offView: false }]);
  expect(asked).toHaveLength(1);
});

test("a carry the host refuses is not asked again every frame, and the drop still says off the page", async () => {
  Object.assign(globalThis.window, { innerWidth: 1440, innerHeight: 900 });
  const { ref } = board();
  let asked = 0;
  const drops: boolean[] = [];
  const down = boardMoveHandler({
    boxRef: ref,
    moving: { current: false },
    enabled: true,
    onFrame: () => {},
    onDrop: (_r, offView) => drops.push(offView),
    onCross: async () => { asked++; return null; },
  });
  down(press(950, 620));
  fire("pointermove", { clientX: 1500, clientY: 620 });
  await Promise.resolve();
  await Promise.resolve();
  fire("pointermove", { clientX: 1510, clientY: 620 });
  fire("pointermove", { clientX: 1520, clientY: 620 });
  expect(asked).toBe(1);
  fire("pointerup", { type: "pointerup", clientX: 1520, clientY: 620 });
  await Promise.resolve();
  expect(drops).toEqual([true]);
});

test("let go while the host is still carrying the panel: the drop waits and lands on the new page", async () => {
  Object.assign(globalThis.window, { innerWidth: 1440, innerHeight: 900 });
  const { box, ref } = board();
  const moving = { current: false };
  const drops: Array<{ left: number; offView: boolean }> = [];
  let answer: (at: { left: number; top: number } | null) => void = () => {};
  const down = boardMoveHandler({
    boxRef: ref,
    moving,
    enabled: true,
    onFrame: () => { reportedMoving.push(moving.current); },
    onDrop: (r, offView) => drops.push({ left: r.left, offView }),
    onCross: () => new Promise((resolve) => { answer = resolve; }),
  });
  const reportedMoving: boolean[] = [];
  down(press(950, 620));
  fire("pointermove", { clientX: 1500, clientY: 620 });
  reportedMoving.length = 0;
  fire("pointerup", { type: "pointerup", clientX: 1500, clientY: 620 });
  expect(drops).toHaveLength(0);
  // The display-sized hold ends at the release, not when the host answers (it can take 8 s to give up).
  expect(moving.current).toBe(false);
  expect(reportedMoving).toEqual([false]);
  answer({ left: 10, top: 600 });
  await Promise.resolve();
  await Promise.resolve();
  expect(box.style.left).toBe("10px");
  expect(drops).toEqual([{ left: 10, offView: false }]);
  expect(moving.current).toBe(false);
});

test("a drop handler that throws still ends the move and reports regions without the hold", () => {
  const { ref } = board();
  const moving = { current: false };
  const reportedMoving: boolean[] = [];
  const down = boardMoveHandler({
    boxRef: ref,
    moving,
    enabled: true,
    onFrame: () => { reportedMoving.push(moving.current); },
    onDrop: () => { throw new Error("anchorBoard failed"); },
  });
  down(press(950, 620));
  fire("pointermove", { clientX: 650, clientY: 320 });
  reportedMoving.length = 0;
  expect(() => fire("pointerup")).toThrow("anchorBoard failed");
  expect(moving.current).toBe(false);
  expect(classes.has("is-moving-board")).toBe(false);
  // Reported at the release and again after the drop, never with the board-move region.
  expect(reportedMoving).toEqual([false, false]);
  expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
});

test("isOffView: the page's own box is in view; its far edges are not", () => {
  expect(isOffView(0, 0, 1440, 900)).toBe(false);
  expect(isOffView(1439, 899, 1440, 900)).toBe(false);
  expect(isOffView(1440, 10, 1440, 900)).toBe(true);
  expect(isOffView(-1, 10, 1440, 900)).toBe(true);
  expect(isOffView(10, 900, 1440, 900)).toBe(true);
});

test("only chrome starts a move; controls, chips, rows and gaps keep their presses", () => {
  const { ref } = board();
  const down = boardMoveHandler({ boxRef: ref, moving: { current: false }, enabled: true, onFrame: () => {}, onDrop: () => {} });
  // Row area, including its padding and project headings, is not a grip.
  down(press(950, 700, { closest: () => null }));
  expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
  // A clickable control inside the chrome is not a grip either.
  down(press(950, 620, { closest: () => ({}) }));
  expect(listeners.get("pointermove")?.size ?? 0).toBe(0);
  down(press(950, 620));
  expect(listeners.get("pointermove")?.size).toBe(1);
  fire("pointerup");
});
