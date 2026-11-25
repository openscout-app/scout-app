import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { CompanionAnchorUpdate, CompanionFigureAnchor } from "../../lib/companion-host.ts";
import { WindowChase, chaseTransform, isWindowMove, offEdge, squeezeFlip } from "./window-chase.ts";

type FakeEl = {
  style: Record<string, string> & { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void };
  dataset: Record<string, string>;
  querySelector: () => null;
};

function fakeButton(ax: number, ay: number): FakeEl {
  const style: Record<string, string> = { transform: "", opacity: "", visibility: "", left: "0px", top: "0px" };
  return {
    style: Object.assign(style, {
      setProperty: (k: string, v: string) => { style[k] = v; },
      removeProperty: (k: string) => { delete style[k]; },
    }),
    dataset: { ax: String(ax), ay: String(ay) },
    querySelector: () => null,
  };
}

let clock = 0;
let frames: Array<(t: number) => void> = [];
const saved = { now: performance.now, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, css: (globalThis as { CSS?: unknown }).CSS };

beforeEach(() => {
  clock = 0;
  frames = [];
  performance.now = () => clock;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => { frames.push(cb); return frames.length; }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
});

afterEach(() => {
  performance.now = saved.now;
  globalThis.requestAnimationFrame = saved.raf;
  globalThis.cancelAnimationFrame = saved.caf;
  (globalThis as { CSS?: unknown }).CSS = saved.css;
});

function pump(until: number) {
  while (clock < until) {
    clock += 16;
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(clock);
  }
}

function anchor(x: number, y: number, extra: Partial<CompanionFigureAnchor> = {}): CompanionFigureAnchor {
  return { x, y, down: "bottom", covered: false, away: false, frame: { x: x - 50, y, w: 400, h: 300 }, ...extra };
}

function update(figures: Record<string, CompanionFigureAnchor | null>, falling: string[] = [], landing: Record<string, "window" | "edge"> = {}): CompanionAnchorUpdate {
  return {
    anchors: new Map(Object.entries(figures).map(([id, a]) => [id, { anchor: a, label: null }])),
    falling,
    landing: new Map(Object.entries(landing)),
  };
}

function setup(variant: "scurry" | "reduced" = "scurry") {
  const buttons = new Map<string, FakeEl>();
  const chasing: string[][] = [];
  const pops: string[] = [];
  const root = { querySelector: (sel: string) => buttons.get(/data-placed="([^"]+)"/.exec(sel)?.[1] ?? "") ?? null, querySelectorAll: () => [] };
  const chase = new WindowChase({
    root: () => root as unknown as HTMLElement,
    ghosts: () => null,
    variantOf: () => variant,
    screen: () => ({ width: 1440, height: 900 }),
    hex: () => ({ x: 1400, y: 880 }),
    skip: () => false,
    onChasing: (ids) => chasing.push([...ids]),
    onPop: (workId, dir) => pops.push(`${workId}:${dir}`),
  });
  return { buttons, chasing, chase, pops };
}

describe("window chase helpers", () => {
  test("a pose becomes an offset from where React drew the figure", () => {
    const pose = { x: 110, y: 96, rot: 3, sx: 1, sy: 0.9, gaze: "rest", facing: 1, stride: null, opacity: 1, ground: 0, groundAt: { x: 0, y: 0 }, trail: 0, stance: "contact" } as const;
    expect(chaseTransform(pose, { x: 300, y: 100 })).toBe("translate(-190px, -4px) rotate(3deg) scale(1, 0.9)");
  });

  test("only a same-size translate is a move", () => {
    const a = { x: 0, y: 0, w: 400, h: 300 };
    expect(isWindowMove(a, { ...a, x: 40 }, { x: 0, y: 0 }, { x: 40, y: 0 })).toBe(true);
    expect(isWindowMove(a, { ...a, w: 500 }, { x: 0, y: 0 }, { x: 40, y: 0 })).toBe(false);
    expect(isWindowMove(null, a, { x: 0, y: 0 }, { x: 40, y: 0 })).toBe(false);
    expect(isWindowMove(a, a, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  test("a squeezed flip is up onto the window, or back down under it", () => {
    expect(squeezeFlip(false, true)).toBe("up");
    expect(squeezeFlip(true, false)).toBe("down");
    expect(squeezeFlip(false, false)).toBeNull();
    expect(squeezeFlip(true, true)).toBeNull();
  });

  test("off the nearest side edge", () => {
    expect(offEdge({ x: 100, y: 50 }, 20, 1000)).toEqual({ x: -20, y: 50 });
    expect(offEdge({ x: 900, y: 50 }, 20, 1000)).toEqual({ x: 1020, y: 50 });
  });
});

describe("WindowChase", () => {
  test("a moved window leaves the figure behind, then it scurries back and the transform clears", () => {
    const { buttons, chasing, chase } = setup();
    buttons.set("work-1", fakeButton(100, 100));
    chase.anchors(update({ "work-1": anchor(100, 100) }));
    expect(frames.length).toBe(0);

    clock = 66;
    buttons.get("work-1")!.dataset.ax = "300";
    chase.anchors(update({ "work-1": anchor(300, 100) }));
    expect(chasing.at(-1)).toEqual(["work-1"]);
    pump(150);
    // Still drawn where the perch was: 200px left of the new anchor.
    expect(buttons.get("work-1")!.style.transform).toStartWith("translate(-200px");
    pump(3000);
    expect(buttons.get("work-1")!.style.transform).toBe("");
    expect(chasing.at(-1)).toEqual([]);
  });

  test("squeezed out from under its window, it pops onto the top instead of chasing", () => {
    const { buttons, chasing, chase, pops } = setup();
    buttons.set("work-1", fakeButton(100, 600));
    const frame = { x: 50, y: 300, w: 400, h: 300 };
    chase.anchors(update({ "work-1": anchor(100, 600, { frame }) }));
    // Same window, same size, but the host now sits it on the top: a 300px jump that is not a move.
    chase.anchors(update({ "work-1": anchor(100, 300, { frame, squeezed: true }) }));
    expect(pops).toEqual(["work-1:up"]);
    expect(frames.length).toBe(0);
    expect(chasing.length === 0 || chasing.at(-1)!.length === 0).toBe(true);
    // Room again: back under.
    chase.anchors(update({ "work-1": anchor(100, 600, { frame }) }));
    expect(pops).toEqual(["work-1:up", "work-1:down"]);
    expect(frames.length).toBe(0);
  });

  test("under Reduce Motion a squeezed flip just moves the figure", () => {
    const { buttons, chase, pops } = setup("reduced");
    buttons.set("work-1", fakeButton(100, 600));
    const frame = { x: 50, y: 300, w: 400, h: 300 };
    chase.anchors(update({ "work-1": anchor(100, 600, { frame }) }));
    chase.anchors(update({ "work-1": anchor(100, 300, { frame, squeezed: true }) }));
    expect(pops).toEqual([]);
  });

  test("a resize just re-anchors", () => {
    const { buttons, chasing, chase } = setup();
    buttons.set("work-1", fakeButton(100, 100));
    chase.anchors(update({ "work-1": anchor(100, 100) }));
    chase.anchors(update({ "work-1": anchor(300, 100, { frame: { x: 0, y: 0, w: 800, h: 300 } }) }));
    expect(chasing.length === 0 || chasing.at(-1)!.length === 0).toBe(true);
    expect(frames.length).toBe(0);
  });

  test("a closed window takes the figure for the Coyote fall; a shift-drop does not", () => {
    const { buttons, chase } = setup();
    buttons.set("work-1", fakeButton(100, 100));
    buttons.set("work-2", fakeButton(500, 100));
    chase.anchors(update({ "work-1": anchor(100, 100), "work-2": anchor(500, 100) }));
    clock = 66;
    chase.anchors(update({ "work-1": anchor(100, 100, { pending: true }), "work-2": anchor(500, 100) }));
    pump(300);
    // Pending: it stands where it was, none the wiser.
    expect(buttons.get("work-1")!.style.transform).toBe("translate(0px, 0px) rotate(0deg) scale(1, 1)");
    pump(600);
    buttons.get("work-1")!.dataset.ay = "400";
    const taken = chase.anchors(update({ "work-1": anchor(100, 400), "work-2": anchor(500, 880) }, ["work-1", "work-2"], { "work-1": "edge" }));
    expect([...taken]).toEqual(["work-1"]);
    pump(700);
    // Still up top (uh-oh, the camera look) before gravity; standing, it nods down at the drop.
    expect(buttons.get("work-1")!.style.transform).toMatch(/^translate\(-?0(\.\d+)?px, -(300|299\.5)px\)/);
    pump(4000);
    expect(buttons.get("work-1")!.style.transform).toBe("");
  });

  test("the window coming back during the grace cancels the fall", () => {
    const { buttons, chasing, chase } = setup();
    buttons.set("work-1", fakeButton(100, 100));
    chase.anchors(update({ "work-1": anchor(100, 100) }));
    chase.anchors(update({ "work-1": anchor(100, 100, { pending: true }) }));
    expect(chasing.at(-1)).toEqual(["work-1"]);
    pump(200);
    chase.anchors(update({ "work-1": anchor(100, 100) }));
    expect(chasing.at(-1)).toEqual([]);
  });
});

describe("window chase: sitting back down", () => {
  test("a figure that stood stays standing until its resting drawing can paint, then sits", async () => {
    const stances: Array<Map<string, string>> = [];
    const { buttons, chase } = setup();
    // The setup's options object is private; a second controller reports stances.
    const root = { querySelector: (sel: string) => buttons.get(/data-placed="([^"]+)"/.exec(sel)?.[1] ?? "") ?? null, querySelectorAll: () => [] };
    chase.dispose();
    const seated = new WindowChase({
      root: () => root as unknown as HTMLElement,
      ghosts: () => null,
      variantOf: () => "scurry",
      screen: () => ({ width: 1440, height: 900 }),
      hex: () => ({ x: 1400, y: 880 }),
      skip: () => false,
      onChasing: () => {},
      onStances: (next) => stances.push(new Map(next)),
    });
    const el = fakeButton(100, 100);
    Object.assign(el.dataset, { pose: "sit-on-ledge", upX: "0", upY: "-6", restArt: "/crew/edge-poses-v1/sprout/sit-on-ledge.webp" });
    buttons.set("work-1", el);
    seated.anchors(update({ "work-1": anchor(100, 100) }));
    clock = 66;
    el.dataset.ax = "300";
    seated.anchors(update({ "work-1": anchor(300, 100) }));
    pump(3000);
    // Back on the perch and the chase is done, but it is still drawn standing.
    expect(el.style.transform).toBe("");
    expect(stances.at(-1)?.get("work-1")).toBe("rest");
    await Promise.resolve();
    await Promise.resolve();
    expect(stances.at(-1)?.has("work-1")).toBe(false);
  });
});

describe("window chase: where a chase starts", () => {
  test("a resize re-anchors a resting figure, and the next move leaves it there, not at its old spot", () => {
    const { buttons, chase } = setup();
    buttons.set("w", fakeButton(100, 100));
    chase.anchors(update({ w: anchor(100, 100) }));
    // A resize: the size changes, the anchor shifts, no chase.
    chase.anchors(update({ w: anchor(160, 100, { frame: { x: 110, y: 100, w: 500, h: 300 } }) }));
    // Then a real move.
    chase.anchors(update({ w: anchor(400, 100, { frame: { x: 350, y: 100, w: 500, h: 300 } }) }));
    buttons.get("w")!.dataset.ax = "400"; // React draws it at the new anchor
    pump(32);
    // Drawn at the new anchor (400) and offset back to where it last rested (160).
    expect(buttons.get("w")!.style.transform).toStartWith("translate(-240px, 0px)");
  });

  test("a mirrored figure looks the other way in its own drawing", async () => {
    const { mirrorGaze } = await import("./window-chase.ts");
    expect(mirrorGaze("look-down-left")).toBe("look-down-right");
    expect(mirrorGaze("look-right")).toBe("look-left");
    expect(mirrorGaze("look-up")).toBe("look-up");
  });
});
