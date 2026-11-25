import { afterEach, beforeEach, expect, test } from "bun:test";
import { rowPullCue, startRowPull } from "./row-pull.ts";

const box = { left: 100, top: 100, right: 400, bottom: 500 };
test("the cue follows the nearest edge and uses the same 12pt rim in every direction", () => {
  for (const point of [{ x: 88, y: 200 }, { x: 412, y: 200 }, { x: 200, y: 88 }, { x: 200, y: 512 }]) {
    expect(rowPullCue(point, box).ready).toBe(true);
  }
  expect(rowPullCue({ x: 89, y: 200 }, box).ready).toBe(false);
  expect(rowPullCue({ x: 100, y: 200 }, box)).toEqual({ x: 112, y: 200, ready: false });
  expect(rowPullCue({ x: 450, y: 600 }, box)).toEqual({ x: 388, y: 488, ready: true });
});

const saved = { window: globalThis.window, document: globalThis.document };
let listeners: Map<string, Set<(event: any) => void>>;
let classes: Set<string>;
beforeEach(() => {
  listeners = new Map();
  classes = new Set();
  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, fn: (event: any) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
      removeEventListener: (type: string, fn: (event: any) => void) => { listeners.get(type)?.delete(fn); },
    },
    document: { documentElement: { classList: {
      add: (...names: string[]) => names.forEach((c) => classes.add(c)),
      remove: (...names: string[]) => names.forEach((c) => classes.delete(c)),
      toggle: (c: string, on: boolean) => on ? classes.add(c) : classes.delete(c),
    } } },
  });
});
afterEach(() => Object.assign(globalThis, saved));
function fire(type: string, x = 200, y = 200, extra = {}) {
  for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, pointerId: 1, clientX: x, clientY: y, buttons: 1, preventDefault() {}, ...extra });
}
function pull() {
  let drops = 0, moves = 0;
  const cues: unknown[] = [];
  const stop = startRowPull({ from: { x: 200, y: 200 }, pointerId: 1, box: () => box,
    preview: (cue) => cues.push(cue), drop: () => drops++, moved: () => moves++ });
  return { cues, stop, drops: () => drops, moves: () => moves };
}
function cleared() {
  expect(classes.size).toBe(0);
  expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
}
test("a click stays a selection; moving among rows does not tear out", () => {
  const p = pull();
  fire("pointermove", 202, 201);
  expect(p.moves()).toBe(0);
  fire("pointerup", 202, 201);
  expect(p.drops()).toBe(0);
  cleared();
  const q = pull();
  fire("pointermove", 240, 350);
  expect(classes.has("is-pulling-row")).toBe(true);
  fire("pointerup", 240, 350);
  expect(q.drops()).toBe(0);
  cleared();
});
test("crossing the rim previews only; release beyond it brings out once", () => {
  const p = pull();
  fire("pointermove", 420, 300);
  expect(classes.has("is-row-pull-ready")).toBe(true);
  expect(p.drops()).toBe(0);
  fire("pointerup", 420, 300);
  fire("pointerup", 420, 300);
  expect(p.drops()).toBe(1);
  expect(p.cues.at(-1)).toBeNull();
  cleared();
});
test("returning within the rim cancels the tear-out, including at release", () => {
  const p = pull();
  fire("pointermove", 420, 300);
  fire("pointermove", 300, 300);
  expect(classes.has("is-row-pull-ready")).toBe(false);
  fire("pointerup", 300, 300);
  expect(p.drops()).toBe(0);
  cleared();
});
test("pointer cancellation, focus loss, missing mouse-up and unmount all clean up without dropping", () => {
  for (const kind of ["pointercancel", "blur", "lost-up", "unmount"]) {
    const p = pull();
    fire("pointermove", 420, 300);
    if (kind === "unmount") p.stop();
    else if (kind === "lost-up") fire("pointermove", 420, 300, { buttons: 0 });
    else fire(kind, 420, 300);
    expect(p.drops()).toBe(0);
    cleared();
  }
});
test("another pointer cannot move or release the row", () => {
  const p = pull();
  fire("pointermove", 420, 300, { pointerId: 2 });
  fire("pointerup", 420, 300, { pointerId: 2 });
  expect(p.moves()).toBe(0);
  expect(p.drops()).toBe(0);
  p.stop();
  cleared();
});

test("a finished row's later unmount cannot clear another row's active cue", () => {
  const first = pull();
  fire("pointerup");
  const second = pull();
  fire("pointermove", 420, 300);
  first.stop();
  expect(classes.has("is-row-pull-ready")).toBe(true);
  expect(second.cues.at(-1)).toEqual({ x: 388, y: 300, ready: true });
  fire("pointerup", 420, 300);
  expect(second.drops()).toBe(1);
  cleared();
});
