import { describe, expect, test } from "bun:test";
import type { WorldHandle } from "../../ops/world-week/engine.ts";
import { applyWorldDock, createWorldDock, type WorldDockParts } from "./world-dock.ts";
import type { WorldPlacement } from "./world-panels-model.ts";

/*
 * The World dock: which panel holds each of the HUD's side columns, and the
 * moves themselves, on a small stand-in for the DOM (only what world-dock.ts
 * touches). The engine's side of the seam is simulated as engine.ts does it:
 * at mount each aside.col moves out of the frame into a .wm wrap, then
 * slots.attach(side, wrap) hands it over; on dispose attach(side, null).
 */

class FakeEl {
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  readonly classes = new Set<string>();
  readonly attrs = new Map<string, string>();
  readonly ownerDocument = { createElement: (tag: string) => new FakeEl(tag) };
  constructor(
    readonly tag: string,
    className = "",
    readonly name = "",
  ) {
    for (const c of className.split(" ").filter(Boolean)) this.classes.add(c);
  }
  set className(value: string) {
    this.classes.clear();
    for (const c of value.split(" ").filter(Boolean)) this.classes.add(c);
  }
  get className() {
    return [...this.classes].join(" ");
  }
  readonly classList = {
    toggle: (c: string, on: boolean) => (on ? this.classes.add(c) : this.classes.delete(c), on),
    contains: (c: string) => this.classes.has(c),
  };
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get isConnected(): boolean {
    return this.tag === "document" || !!this.parentElement?.isConnected;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  private detach() {
    const p = this.parentElement;
    if (p) p.children.splice(p.children.indexOf(this), 1);
    this.parentElement = null;
  }
  private insert(parent: FakeEl, at: number, el: FakeEl) {
    el.detach();
    parent.children.splice(at, 0, el);
    el.parentElement = parent;
  }
  appendChild(el: FakeEl) {
    el.detach();
    this.insert(this, this.children.length, el);
    return el;
  }
  prepend(el: FakeEl) {
    el.detach();
    this.insert(this, 0, el);
  }
  before(el: FakeEl) {
    el.detach();
    const p = this.parentElement!;
    this.insert(p, p.children.indexOf(this), el);
  }
  after(el: FakeEl) {
    el.detach();
    const p = this.parentElement!;
    this.insert(p, p.children.indexOf(this) + 1, el);
  }
  replaceWith(el: FakeEl) {
    const p = this.parentElement;
    if (!p) return;
    el.detach();
    const at = p.children.indexOf(this);
    this.detach();
    this.insert(p, at, el);
  }
  remove() {
    this.detach();
  }
  querySelector(sel: string): FakeEl | null {
    if (sel === ":scope > main.center") return this.children.find((c) => c.tag === "main" && c.classes.has("center")) ?? null;
    if (sel === ".frame") {
      for (const c of this.children) {
        if (c.classes.has("frame")) return c;
        const deeper = c.querySelector(sel);
        if (deeper) return deeper;
      }
      return null;
    }
    throw new Error(`fake DOM: no ${sel}`);
  }
  /** what a container holds, by name, for reading a layout at a glance */
  get names() {
    return this.children.map((c) => (c.classes.has("vw-world-gap") ? `gap` : c.name || c.tag));
  }
}

const el = (x: FakeEl) => x as unknown as HTMLElement;

/** The HUD as markup.ts draws it, mounted with slots: both asides already moved into their wraps. */
function mountHud(stageHost: FakeEl) {
  const root = stageHost.appendChild(new FakeEl("div", "", "root"));
  const frame = root.appendChild(new FakeEl("div", "frame slotted", "frame"));
  frame.appendChild(new FakeEl("header", "top", "top"));
  const left = new FakeEl("aside", "col", "left");
  const center = frame.appendChild(new FakeEl("main", "center", "center"));
  const right = new FakeEl("aside", "col", "right");
  frame.appendChild(new FakeEl("footer", "status", "status"));
  const wrapL = new FakeEl("div", "wm wm--slot wm--slot-left", "wrapL");
  const wrapR = new FakeEl("div", "wm wm--slot wm--slot-right", "wrapR");
  wrapL.appendChild(left);
  wrapR.appendChild(right);
  return { root, frame, left, right, center, wrapL, wrapR };
}

function setup() {
  const doc = new FakeEl("document");
  const stageHost = doc.appendChild(new FakeEl("div", "vw-world-stage", "stage"));
  const hostL = doc.appendChild(new FakeEl("div", "vw-world-column-host", "hostL"));
  const hostR = doc.appendChild(new FakeEl("div", "vw-world-column-host", "hostR"));
  let relayouts = 0;
  const world = Object.assign(() => {}, { relayout: () => void relayouts++ }) as unknown as WorldHandle;
  const dock = createWorldDock();
  return { doc, stageHost, hostL, hostR, dock, world, relayouts: () => relayouts };
}

describe("the World dock, on the DOM", () => {
  test("both column panels on the view: each column in its panel, a stand-in at its place, the one-column frame", () => {
    const s = setup();
    s.dock.mountStage(el(s.stageHost));
    s.dock.mountColumn("left", el(s.hostL));
    s.dock.mountColumn("right", el(s.hostR));
    const hud = mountHud(s.stageHost);
    s.dock.slots.attach("left", el(hud.wrapL));
    s.dock.slots.attach("right", el(hud.wrapR));

    expect(hud.frame.names).toEqual(["top", "gap", "center", "gap", "status"]);
    expect(s.hostL.names).toEqual(["wrapL"]);
    expect(s.hostR.names).toEqual(["wrapR"]);
    expect(hud.wrapL.names).toEqual(["left"]);
    expect(hud.frame.classes.has("slotted")).toBe(true);
    expect(s.stageHost.classes.has("is-docked")).toBe(false);
    expect(s.dock.get()).toMatchObject({ stages: 1, columns: { left: 1, right: 1 }, ready: { left: true, right: true }, placement: { left: "out", right: "out" } });
  });

  test("no column panels: the page's frame exactly, columns where the markup has them", () => {
    const s = setup();
    s.dock.mountStage(el(s.stageHost));
    const hud = mountHud(s.stageHost);
    s.dock.slots.attach("left", el(hud.wrapL));
    s.dock.slots.attach("right", el(hud.wrapR));

    expect(hud.frame.names).toEqual(["top", "left", "center", "right", "status"]);
    expect(hud.frame.classes.has("slotted")).toBe(false);
    expect(hud.wrapL.isConnected).toBe(false);
    expect(s.stageHost.classes.has("is-docked")).toBe(true);
  });

  test("removing a column panel puts that column back at its place; adding it again takes it out", () => {
    const s = setup();
    s.dock.mountStage(el(s.stageHost));
    s.dock.mountColumn("left", el(s.hostL));
    const releaseRight = s.dock.mountColumn("right", el(s.hostR));
    const hud = mountHud(s.stageHost);
    s.dock.slots.attach("left", el(hud.wrapL));
    s.dock.slots.attach("right", el(hud.wrapR));

    releaseRight();
    expect(hud.frame.names).toEqual(["top", "gap", "center", "right", "status"]);
    expect(s.hostR.names).toEqual([]);
    expect([...hud.frame.classes].sort()).toEqual(["frame", "vw-world-out-left"]);
    expect(s.stageHost.classes.has("is-docked")).toBe(true);

    s.dock.mountColumn("right", el(s.hostR));
    expect(hud.frame.names).toEqual(["top", "gap", "center", "gap", "status"]);
    expect(s.hostR.names).toEqual(["wrapR"]);
    expect(hud.frame.classes.has("slotted")).toBe(true);
  });

  test("full view brings both columns home, and leaving it sends them back", () => {
    const s = setup();
    s.dock.mountStage(el(s.stageHost));
    s.dock.mountColumn("left", el(s.hostL));
    s.dock.mountColumn("right", el(s.hostR));
    const hud = mountHud(s.stageHost);
    s.dock.slots.attach("left", el(hud.wrapL));
    s.dock.slots.attach("right", el(hud.wrapR));
    s.dock.setWorld(s.world);

    s.dock.setFull(true);
    expect(hud.frame.names).toEqual(["top", "left", "center", "right", "status"]);
    expect(s.hostL.names).toEqual([]);
    expect(hud.frame.classes.has("slotted")).toBe(false);
    expect(s.relayouts()).toBe(1);

    s.dock.setFull(false);
    expect(hud.frame.names).toEqual(["top", "gap", "center", "gap", "status"]);
    expect(s.hostL.names).toEqual(["wrapL"]);
    expect(s.relayouts()).toBe(2);
    // the same elements throughout: nothing was rebuilt
    expect(hud.wrapL.firstElementChild).toBe(hud.left);
  });

  test("a remount (a source switch, a re-seed) hands over a new frame, and the columns go where they were", () => {
    const s = setup();
    s.dock.mountStage(el(s.stageHost));
    s.dock.mountColumn("left", el(s.hostL));
    const first = mountHud(s.stageHost);
    s.dock.slots.attach("left", el(first.wrapL));
    s.dock.slots.attach("right", el(first.wrapR));
    expect(first.frame.names).toEqual(["top", "gap", "center", "right", "status"]);

    // engine dispose: attach(null), the wraps removed, then the page's innerHTML reset
    s.dock.slots.attach("left", null);
    first.wrapL.remove();
    s.dock.slots.attach("right", null);
    first.wrapR.remove();
    first.root.remove();
    expect(s.dock.get().ready).toEqual({ left: false, right: false });

    const second = mountHud(s.stageHost);
    s.dock.slots.attach("left", el(second.wrapL));
    s.dock.slots.attach("right", el(second.wrapR));
    expect(second.frame.names).toEqual(["top", "gap", "center", "right", "status"]);
    expect(s.hostL.names).toEqual(["wrapL"]);
    expect(s.hostL.firstElementChild).toBe(second.wrapL);
  });

  test("a column that has not been handed over yet stays put; the frame waits for it", () => {
    const parts: WorldDockParts = {
      stageHost: null,
      world: null,
      wraps: { left: null, right: null },
      asides: { left: null, right: null },
      gaps: { left: null, right: null },
      hosts: { left: [], right: [] },
    };
    // no stage, no frame: nothing to move, nothing thrown
    applyWorldDock(parts, { left: "out", right: "out" });
    expect(parts.gaps).toEqual({ left: null, right: null });
  });
});

describe("the World dock's counts", () => {
  const recorder = () => {
    const seen: WorldPlacement[] = [];
    return { seen, dock: createWorldDock((_parts, placement) => void seen.push(placement)) };
  };

  test("a release counts once, so StrictMode's mount, release, mount leaves one", () => {
    const { dock } = recorder();
    const host = {} as HTMLElement;
    const first = dock.mountColumn("left", host);
    first();
    first();
    dock.mountColumn("left", host);
    expect(dock.get().columns).toEqual({ left: 1, right: 0 });
    const stage = dock.mountStage({} as HTMLElement);
    stage();
    stage();
    expect(dock.get().stages).toBe(0);
  });

  test("tells its panels only when something they show changed", () => {
    const { dock } = recorder();
    let calls = 0;
    const unsubscribe = dock.subscribe(() => calls++);
    dock.mountStage({} as HTMLElement);
    expect(calls).toBe(1);
    const held = dock.get();
    dock.setFull(false);
    dock.setWorld(null);
    expect(calls).toBe(1);
    expect(dock.get()).toBe(held);
    dock.mountColumn("right", {} as HTMLElement);
    expect(calls).toBe(2);
    expect(dock.get().placement).toEqual({ left: "in", right: "out" });
    unsubscribe();
  });

  test("answers the engine's reveal itself, so the shell's inspector is never asked", () => {
    const { dock } = recorder();
    let asked = 0;
    const onAsk = () => asked++;
    globalThis.addEventListener?.("scout:set-inspector-width", onAsk);
    dock.slots.reveal?.("right");
    globalThis.removeEventListener?.("scout:set-inspector-width", onAsk);
    expect(typeof dock.slots.reveal).toBe("function");
    expect(asked).toBe(0);
  });
});
