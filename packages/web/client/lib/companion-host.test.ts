import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  COMPANION_EVENT,
  companionHostAvailable,
  isCompanionId,
  onCompanionState,
  allowCompanionScope,
  beginCompanionDrag,
  disallowCompanionScope,
  isCompanionProjectRoot,
  isCompanionSessionRef,
  openFromCompanion,
  openSessionInScout,
  parseCompanionHostState,
  setCompanionPreferences,
  pinToCompanion,
  readCompanionState,
  reorderCompanion,
  COMPANION_POINTER_EVENT,
  onCompanionPointer,
  parseCompanionEdgeGeometry,
  reportCompanionHitRegions,
  stopCompanionRegionRenewal,
  COMPANION_REGION_RENEW_MS,
  reportCompanionLabels,
  budgetHitRegions,
  COMPANION_MAX_REGIONS,
  COMPANION_ANCHORS_EVENT,
  COMPANION_FIGURE_DRAG_EVENT,
  beginFigureDrag,
  nudgeCompanionFigure,
  onCompanionAnchors,
  onCompanionFigureDrag,
  parseCompanionFigures,
  parseCompanionFigureDefaults,
  COMPANION_LEAVE_EVENT,
  COMPANION_RETRACT_EVENT,
  COMPANION_SUMMONED_EVENT,
  onCompanionLeave,
  onCompanionRetract,
  onCompanionSummoned,
  parseCompanionAnchors,
  parseCompanionFigureAnchor,
  reportCompanionLeft,
  sendCompanionFiguresHome,
  setCompanionFigure,
  setCompanionFigureDefaults,
  noteCompanionPress,
  pointCompanionAt,
  companionKeepClear,
  isPopOutToken,
  noteCompanionPopOutOpening,
  onCompanionPopOutDone,
  unionBoxes,
} from "./companion-host.ts";

type Posted = { kind: string; id: string; method: string; params: Record<string, unknown> };

const originalWindow = (globalThis as { window?: unknown }).window;
let posted: Posted[] = [];
let reply: (message: Posted) => unknown;

function installHost() {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  target.webkit = {
    messageHandlers: {
      scoutCompanion: {
        postMessage(body: Posted) {
          posted.push(body);
          const value = reply(body);
          queueMicrotask(() => {
            const respond = target.__scoutCompanionReply as (id: string, reply: unknown) => void;
            respond(body.id, value instanceof Error ? { ok: false, error: value.message } : { ok: true, value });
          });
        },
      },
    },
  };
  (globalThis as { window?: unknown }).window = target;
  return target;
}

beforeEach(() => {
  posted = [];
  reply = () => ({ pins: [], corner: "bottom-right", minimized: false, visible: true });
});

afterEach(() => {
  stopCompanionRegionRenewal();
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe("ids", () => {
  test("accepts broker ids and rejects anything that could carry markup or paths", () => {
    expect(isCompanionId("work-murpazcf-d0g5fr")).toBe(true);
    expect(isCompanionId("node:dev-host.local")).toBe(true);
    expect(isCompanionId("")).toBe(false);
    expect(isCompanionId("../etc")).toBe(false);
    expect(isCompanionId("<img src=x>")).toBe(false);
    expect(isCompanionId("a".repeat(129))).toBe(false);
    expect(isCompanionId(42)).toBe(false);
  });
});

describe("parseCompanionHostState", () => {
  test("drops malformed and duplicate pins, defaults the corner", () => {
    expect(parseCompanionHostState({
      pins: [{ workId: "work-1", machineId: "node-a" }, { workId: "work-1" }, { workId: "bad id" }, null, { workId: "work-2", machineId: "<x>" }],
      corner: "middle",
      minimized: "yes",
    })).toEqual({
      pins: [{ workId: "work-1", machineId: "node-a" }, { workId: "work-2", machineId: null }],
      corner: "bottom-right",
      minimized: false,
      visible: true,
      restingOpacity: 0.55,
      alwaysOn: false,
      scopes: [],
      mode: "stack",
      originPins: true,
      edgeAnchor: "right",
      edgeFloat: 0.5,
      edge: null,
      figures: [
        { workId: "work-1", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row" },
        { workId: "work-2", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row" },
      ],
      figureDefaults: { size: 24, motion: "full", hold: "edge" },
      scoutbot: { workId: "scoutbot", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row" },
    });
  });

  test("clamps opacity and keeps only well-formed, unique grants", () => {
    const state = parseCompanionHostState({
      pins: [],
      restingOpacity: 0.01,
      alwaysOn: true,
      scopes: [
        { kind: "agent", id: "agent-1", label: " Hudson " },
        { kind: "agent", id: "agent-1" },
        { kind: "project", id: "/example/workstation-user/dev/openscout", label: null },
        { kind: "project", id: "relative" },
        { kind: "everything", id: "x" },
        { kind: "work", id: "bad id" },
      ],
    });
    expect(state?.restingOpacity).toBe(0.25);
    expect(state?.alwaysOn).toBe(true);
    expect(state?.scopes).toEqual([
      { kind: "agent", id: "agent-1", label: "Hudson" },
      { kind: "project", id: "/example/workstation-user/dev/openscout", label: null },
    ]);
    expect(parseCompanionHostState({ pins: [], restingOpacity: Number.NaN })?.restingOpacity).toBe(0.55);
  });

  test("project roots are absolute and free of control characters", () => {
    expect(isCompanionProjectRoot("/example/workstation-user/dev/openscout")).toBe(true);
    expect(isCompanionProjectRoot("relative/path")).toBe(false);
    expect(isCompanionProjectRoot("/a\u0000b")).toBe(false);
    expect(isCompanionProjectRoot("/" + "a".repeat(600))).toBe(false);
  });

  test("rejects non-objects and missing pins", () => {
    expect(parseCompanionHostState(null)).toBeNull();
    expect(parseCompanionHostState("{}")).toBeNull();
    expect(parseCompanionHostState({ corner: "top-left" })).toBeNull();
  });

  test("keeps explicit hidden and top corners", () => {
    expect(parseCompanionHostState({ pins: [], corner: "top-left", visible: false })?.visible).toBe(false);
    expect(parseCompanionHostState({ pins: [], corner: "top-left" })?.corner).toBe("top-left");
  });
});

describe("bridge calls", () => {
  test("without the Mac host nothing is offered and calls reject", async () => {
    (globalThis as { window?: unknown }).window = new EventTarget();
    expect(companionHostAvailable()).toBe(false);
    await expect(readCompanionState()).rejects.toThrow("needs the Scout app");
  });

  test("round-trips a request through the reply hook", async () => {
    installHost();
    reply = (message) => ({ pins: [{ workId: String(message.params.workId) }], corner: "top-right", minimized: false, visible: true });
    const state = await pinToCompanion("work-1", "node-a");
    expect(posted[0]).toMatchObject({ kind: "companion-request", method: "pin", params: { workId: "work-1", machineId: "node-a" } });
    expect(state.pins).toEqual([{ workId: "work-1", machineId: null }]);
    expect(state.corner).toBe("top-right");
  });

  test("host errors surface as rejections", async () => {
    installHost();
    reply = () => new Error("That work id is not pinned.");
    await expect(readCompanionState()).rejects.toThrow("not pinned");
  });

  test("an unreadable host state is an error, not an empty companion", async () => {
    installHost();
    reply = () => ({ nope: true });
    await expect(readCompanionState()).rejects.toThrow("unreadable");
  });

  test("invalid ids never reach the host", async () => {
    installHost();
    await expect(pinToCompanion("bad id")).rejects.toThrow();
    await expect(openFromCompanion("work", { workId: "<x>" })).rejects.toThrow();
    await reorderCompanion(["work-1", "bad id"]);
    expect(posted.map((message) => message.method)).toEqual(["reorder"]);
    expect(posted[0]!.params).toEqual({ workIds: ["work-1"] });
  });

  test("open drops invalid optional ids", async () => {
    installHost();
    reply = () => null;
    await openFromCompanion("thread", { workId: "work-1", machineId: "bad id", conversationId: "chn-1" });
    expect(posted[0]!.params).toEqual({ target: "thread", workId: "work-1", conversationId: "chn-1" });
  });

  test("pushed state is parsed before listeners see it", () => {
    const target = installHost();
    const seen: unknown[] = [];
    const stop = onCompanionState((state) => seen.push(state));
    target.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: { pins: [{ workId: "work-9" }], corner: "bottom-left" } }));
    target.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: "garbage" }));
    stop();
    target.dispatchEvent(new CustomEvent(COMPANION_EVENT, { detail: { pins: [] } }));
    expect(seen).toEqual([{
      pins: [{ workId: "work-9", machineId: null }],
      corner: "bottom-left",
      minimized: false,
      visible: true,
      restingOpacity: 0.55,
      alwaysOn: false,
      scopes: [],
      mode: "stack",
      originPins: true,
      edgeAnchor: "right",
      edgeFloat: 0.5,
      edge: null,
      figures: [{ workId: "work-9", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row" }],
      figureDefaults: { size: 24, motion: "full", hold: "edge" },
      scoutbot: { workId: "scoutbot", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row" },
    }]);
  });

  test("drag names its source; preferences and grants are validated before posting", async () => {
    installHost();
    reply = () => ({ pins: [] });
    beginCompanionDrag("mark");
    await setCompanionPreferences({ restingOpacity: 0.1, preview: true });
    await setCompanionPreferences({ alwaysOn: true });
    await allowCompanionScope("project", "/example/workstation-user/dev/openscout", "openscout");
    await disallowCompanionScope("agent", "agent-1");
    await expect(allowCompanionScope("agent", "bad id")).rejects.toThrow();
    await expect(allowCompanionScope("project", "relative")).rejects.toThrow();
    expect(posted.map((message) => [message.method, message.params])).toEqual([
      ["drag", { source: "mark" }],
      ["preferences", { restingOpacity: 0.25, preview: true }],
      ["preferences", { alwaysOn: true }],
      ["allow", { kind: "project", id: "/example/workstation-user/dev/openscout", label: "openscout" }],
      ["disallow", { kind: "agent", id: "agent-1" }],
    ]);
  });
});

describe("open session", () => {
  test("accepts a qualified session ref, or the bare id of a row with no known harness", () => {
    expect(isCompanionSessionRef("session:claude:6f1c2d1e-4b7a-4d0e-9a51-0c1d2e3f4a5b")).toBe(true);
    expect(isCompanionSessionRef("session:codex:019a2b3c-0000-7000-8000-000000000000")).toBe(true);
    expect(isCompanionSessionRef("session:grok-acp:agent-a1b2.c3")).toBe(true);
    // formatSessionRouteRef falls back to the bare id; /api/session-ref/:id resolves it.
    expect(isCompanionSessionRef("6f1c2d1e")).toBe(true);
    expect(isCompanionSessionRef("s7")).toBe(true);
    const bad: unknown[] = [
      "", "-lead", "../etc", "a b", "a".repeat(129),
      "session:6f1c2d1e", "session:Claude:abc", "session:1x:abc", "session::abc",
      "session:claude:", "session:claude:a:b", "session:claude:../etc", "session:claude:a b",
      "session:claude:-lead", "work:claude:abc", `session:${"a".repeat(33)}:abc`,
      `session:claude:${"a".repeat(129)}`, 42, null,
    ];
    for (const value of bad) expect(isCompanionSessionRef(value)).toBe(false);
  });

  test("posts the session target with the ref, and the machine id only when valid", async () => {
    installHost();
    reply = () => null;
    expect(await openSessionInScout("session:claude:s1", "node:dev-host.local")).toBe(true);
    expect(await openSessionInScout("session:codex:t1", "bad id")).toBe(true);
    expect(await openSessionInScout("s7")).toBe(true);
    expect(posted.map((message) => [message.method, message.params])).toEqual([
      ["open", { target: "session", sessionRef: "session:claude:s1", machineId: "node:dev-host.local" }],
      ["open", { target: "session", sessionRef: "session:codex:t1" }],
      ["open", { target: "session", sessionRef: "s7" }],
    ]);
  });

  test("never rejects: no host, a bad ref, or an app without the target reads as not opened", async () => {
    (globalThis as { window?: unknown }).window = new EventTarget();
    expect(await openSessionInScout("session:claude:s1")).toBe(false);
    installHost();
    expect(await openSessionInScout("session:s1")).toBe(false);
    expect(posted).toEqual([]);
    reply = () => new Error("Unknown open target.");
    expect(await openSessionInScout("session:claude:s1")).toBe(false);
    expect(posted.map((message) => message.params.target)).toEqual(["session"]);
  });
});

describe("edge mode", () => {
  test("mode defaults to the stack; geometry is read only in edge mode", () => {
    const geometry = { width: 1512, height: 470, anchor: "left", dock: "bottom", obstacles: [{ start: 194, end: 406, label: "Scout · Work" }] };
    expect(parseCompanionHostState({ pins: [], mode: "carousel", edge: geometry })).toMatchObject({ mode: "stack", edge: null, originPins: true });
    expect(parseCompanionHostState({ pins: [], mode: "edge", originPins: false, edgeAnchor: "left", edge: geometry })).toMatchObject({
      mode: "edge",
      originPins: false,
      edgeAnchor: "left",
      edge: { ...geometry, band: null, visible: null, screen: null },
    });
  });

  test("malformed geometry is dropped or narrowed, never trusted", () => {
    expect(parseCompanionEdgeGeometry({ width: Number.NaN, height: 470 })).toBeNull();
    expect(parseCompanionEdgeGeometry("wide")).toBeNull();
    const narrowed = parseCompanionEdgeGeometry({
      width: 1000,
      height: 470,
      anchor: "middle",
      dock: "top",
      obstacles: [{ start: 50, end: 10 }, { start: 10, end: 5000 }, { start: 100, end: 200, label: 7 }, "x"],
    });
    expect(narrowed).toEqual({ width: 1000, height: 470, band: null, visible: null, screen: null, housing: null, deskNotch: null, aboveMenuBar: false, anchor: "right", dock: "hidden", obstacles: [{ start: 100, end: 200, label: "Scout window" }] });
    // The full-display layer: band and visible frame as page rectangles.
    expect(parseCompanionEdgeGeometry({
      width: 1512,
      height: 982,
      band: { x: 0, y: 442, width: 1512, height: 470 },
      visible: { x: 0, y: 33, width: 1512, height: 879 },
      screen: { width: 1512, height: 982 },
    })).toMatchObject({ band: { x: 0, y: 442, width: 1512, height: 470 }, visible: { y: 33 }, screen: { width: 1512, height: 982 } });
    expect(parseCompanionEdgeGeometry({ width: 10, height: 10, band: { x: 0, y: 0, width: 0, height: 4 }, screen: { width: "big" } }))
      .toMatchObject({ band: null, screen: null });
  });

  test("hit regions are cleaned and bounded before they reach the host", async () => {
    installHost();
    reply = () => null;
    reportCompanionHitRegions([
      { id: "work-1", x: 10.4, y: 436.2, width: 29.5, height: 34 },
      { id: "bad id", x: 0, y: 0, width: 1, height: 1 },
      { id: "work-2", x: Number.NaN, y: 0, width: 1, height: 1 },
      { id: "work-3", x: 0, y: 0, width: 0, height: 1 },
    ]);
    await Promise.resolve();
    expect(posted.map((message) => [message.method, message.params])).toEqual([
      ["regions", { regions: [{ id: "work-1", x: 10, y: 436, width: 30, height: 34 }], generation: expect.any(Number) }],
    ]);
    posted = [];
    // A wide screen at capacity: 224 figures, 112 origin pins, +N, home and the popover all fit.
    const full = [
      ...Array.from({ length: 224 }, (_, i) => ({ id: `w-${i}`, x: 0, y: 0, width: 1, height: 1 })),
      ...Array.from({ length: 112 }, (_, i) => ({ id: `pin.${i}`, x: 0, y: 0, width: 1, height: 1 })),
      { id: "stack", x: 0, y: 0, width: 1, height: 1 },
      { id: "home", x: 0, y: 0, width: 1, height: 1 },
      { id: "popover", x: 0, y: 0, width: 1, height: 1 },
    ];
    reportCompanionHitRegions(full);
    expect((posted[0]!.params.regions as unknown[]).length).toBe(full.length);
    expect(COMPANION_MAX_REGIONS).toBeGreaterThanOrEqual(full.length);
  });

  test("each region report is numbered, and renewed while it holds anything", () => {
    installHost();
    reply = () => null;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const cleared: unknown[] = [];
    const saved = { set: globalThis.setInterval, clear: globalThis.clearInterval };
    Object.assign(globalThis, {
      setInterval: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
      clearInterval: (id: unknown) => { cleared.push(id); },
    });
    try {
      const figure = { id: "work-1", x: 10, y: 436, width: 30, height: 34 };
      reportCompanionHitRegions([figure]);
      reportCompanionHitRegions([figure, { id: "popover", x: 0, y: 0, width: 320, height: 300 }]);
      // One renewal timer, however many reports.
      expect(timers.map((t) => t.ms)).toEqual([COMPANION_REGION_RENEW_MS]);
      // A renewal re-sends the last report under a new number.
      timers[0]!.fn();
      const sent = posted.map((m) => m.params as { regions: Array<{ id: string }>; generation: number });
      expect(sent.map((p) => p.regions.map((r) => r.id))).toEqual([["work-1"], ["work-1", "popover"], ["work-1", "popover"]]);
      const numbers = sent.map((p) => p.generation);
      expect(numbers[1]! > numbers[0]! && numbers[2]! > numbers[1]!).toBe(true);
      // Nothing left to hold: the renewal stops.
      reportCompanionHitRegions([]);
      expect(cleared).toEqual([1]);
    } finally {
      Object.assign(globalThis, { setInterval: saved.set, clearInterval: saved.clear });
    }
  });

  test("desk labels are cleaned before they reach the host, keyed by figure", async () => {
    installHost();
    reply = () => null;
    reportCompanionLabels([
      { workId: "session:s1", x: 100.4, y: 436.6, width: 20, height: 12 },
      { workId: "bad id", x: 0, y: 0, width: 20, height: 12 },
      { workId: "work-2", x: Number.POSITIVE_INFINITY, y: 0, width: 20, height: 12 },
      { workId: "work-3", x: 0, y: 0, width: 0, height: 12 },
    ]);
    await Promise.resolve();
    expect(posted.map((message) => [message.method, message.params])).toEqual([
      ["labels", { labels: [{ id: "session:s1", x: 100, y: 437, width: 20, height: 12 }] }],
    ]);
  });

  test("over budget, the popover and home survive and keep their stacking order", () => {
    const many = [
      ...Array.from({ length: COMPANION_MAX_REGIONS + 50 }, (_, i) => ({ id: `w-${i}`, x: 0, y: 0, width: 1, height: 1 })),
      { id: "home", x: 0, y: 0, width: 1, height: 1 },
      { id: "popover", x: 0, y: 0, width: 1, height: 1 },
    ];
    const kept = budgetHitRegions(many);
    expect(kept.length).toBe(COMPANION_MAX_REGIONS);
    expect(kept.slice(-2).map((r) => r.id)).toEqual(["home", "popover"]);
    expect(budgetHitRegions(many, 3).map((r) => r.id)).toEqual(["w-0", "home", "popover"]);
    expect(budgetHitRegions([{ id: "popover", x: 0, y: 0, width: 1, height: 1 }], 0)).toEqual([]);
  });

  test("edge preferences post only known values", async () => {
    installHost();
    reply = () => ({ pins: [] });
    await setCompanionPreferences({ mode: "edge", originPins: false, edgeAnchor: "left" });
    await setCompanionPreferences({ mode: "floating" as never, edgeAnchor: "top" as never });
    expect(posted.map((message) => message.params)).toEqual([{ mode: "edge", originPins: false, edgeAnchor: "left" }, {}]);
  });

  test("a floating home posts a clamped position and reads back clamped", async () => {
    installHost();
    reply = () => ({ pins: [] });
    await setCompanionPreferences({ edgeAnchor: "floating", edgeFloat: 1.4 });
    await setCompanionPreferences({ edgeFloat: Number.NaN });
    expect(posted.map((message) => message.params)).toEqual([{ edgeAnchor: "floating", edgeFloat: 1 }, {}]);
    expect(parseCompanionHostState({ pins: [], edgeAnchor: "floating", edgeFloat: 0.3 })).toMatchObject({ edgeAnchor: "floating", edgeFloat: 0.3 });
    expect(parseCompanionHostState({ pins: [], edgeAnchor: "middle", edgeFloat: "half" })).toMatchObject({ edgeAnchor: "right", edgeFloat: 0.5 });
  });

  test("pointer reports are narrowed before listeners see them", () => {
    const target = installHost();
    const seen: unknown[] = [];
    const stop = onCompanionPointer((event) => seen.push(event));
    target.dispatchEvent(new CustomEvent(COMPANION_POINTER_EVENT, { detail: { id: "work-1", outside: false } }));
    target.dispatchEvent(new CustomEvent(COMPANION_POINTER_EVENT, { detail: { id: "<x>", outside: true } }));
    target.dispatchEvent(new CustomEvent(COMPANION_POINTER_EVENT, { detail: null }));
    stop();
    target.dispatchEvent(new CustomEvent(COMPANION_POINTER_EVENT, { detail: { id: "work-2" } }));
    expect(seen).toEqual([{ id: "work-1", outside: false }, { id: null, outside: true }]);
  });
});

describe("bridge timeout", () => {
  test("an unanswered call rejects, and a late reply is ignored", async () => {
    const target = installHost();
    // The host never answers this call on its own.
    (target.webkit as { messageHandlers: { scoutCompanion: { postMessage: (body: Posted) => void } } })
      .messageHandlers.scoutCompanion.postMessage = (body) => { posted.push(body); };
    const timers: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: () => void) => {
      timers.push(callback);
      return 0;
    }) as unknown as typeof setTimeout;
    let call: Promise<unknown>;
    try {
      call = readCompanionState();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(timers).toHaveLength(1);
    timers[0]!();
    await expect(call).rejects.toThrow("The Scout app did not answer.");
    const respond = target.__scoutCompanionReply as (id: string, reply: unknown) => void;
    expect(() => respond(posted[0]!.id, { ok: true, value: { pins: [] } })).not.toThrow();
    // A later call still round-trips normally.
    installHost();
    await expect(readCompanionState()).resolves.toMatchObject({ pins: [] });
  });
});

describe("figures you place", () => {
  const pins = [{ workId: "work-1" }, { workId: "work-2" }, { workId: "work-3" }];

  test("one figure per pin, in pin order; malformed fields fall back", () => {
    const figures = parseCompanionFigures([
      { workId: "work-2", size: 48, motion: "calm", hidden: true, placement: { kind: "window", side: "top", t: 0.3, ownerBundleID: "com.apple.Safari", windowNumber: 9 },
        anchor: { x: 400, y: 300, down: "bottom", covered: true, away: false }, label: "Standing on the Safari window" },
      { workId: "work-1", size: 200, motion: "wild", hidden: "yes", placement: { kind: "free", x: 3, y: 0.2 }, anchor: { x: Number.NaN, y: 1 } },
      { workId: "work-2", size: 16 },
      { workId: "<x>", size: 32 },
      "junk",
    ], pins);
    expect(figures.map((f) => f.workId)).toEqual(["work-1", "work-2", "work-3"]);
    expect(figures[0]).toEqual({ workId: "work-1", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row" });
    // Window ids stay with the host; the page only sees the side.
    expect(figures[1]).toEqual({
      workId: "work-2", size: 48, motion: "calm", hidden: true,
      placement: { kind: "window", side: "top", t: 0.3 },
      anchor: { x: 400, y: 300, down: "bottom", covered: true, away: false },
      label: "Standing on the Safari window",
    });
    expect(figures[2]!.placement).toEqual({ kind: "home" });
    expect(parseCompanionFigures([{ workId: "work-1", size: 24.5 }], pins)[0]!.size).toBeNull();
    expect(parseCompanionFigures([{ workId: "work-1", placement: { kind: "edge", edge: "middle", t: 0.5 } }], pins)[0]!.placement).toEqual({ kind: "home" });
    expect(parseCompanionFigures([{ workId: "work-1", placement: { kind: "edge", edge: "left", t: 0.5 }, anchor: { x: 0, y: 10, down: "sideways" } }], pins)[0])
      .toMatchObject({ placement: { kind: "edge", edge: "left", t: 0.5 }, anchor: { x: 0, y: 10, down: null, covered: false, away: false } });
    expect(parseCompanionFigureDefaults({ size: 99, motion: "still" })).toEqual({ size: 24, motion: "still", hold: "edge" });
    expect(parseCompanionFigureDefaults({ hold: "latch" })).toEqual({ size: 24, motion: "full", hold: "latch" });
    expect(parseCompanionFigureDefaults({ hold: "hex" })).toEqual({ size: 24, motion: "full", hold: "edge" });
    expect(parseCompanionFigureDefaults(null)).toEqual({ size: 24, motion: "full", hold: "edge" });
  });

  test("figure calls post only valid values", async () => {
    installHost();
    reply = () => ({ pins: [] });
    beginFigureDrag("work-1");
    beginFigureDrag("bad id");
    await setCompanionFigure("work-1", { size: 48, motion: "default" });
    await setCompanionFigure("work-1", { size: "default", hidden: true, home: true });
    await expect(setCompanionFigure("work-1", { size: 12 })).rejects.toThrow("Nothing to change.");
    await expect(setCompanionFigure("<x>", { hidden: true })).rejects.toThrow();
    await nudgeCompanionFigure("work-1", 10, -1);
    await expect(nudgeCompanionFigure("work-1", 101, 0)).rejects.toThrow();
    await expect(nudgeCompanionFigure("work-1", Number.NaN, 0)).rejects.toThrow();
    await setCompanionFigureDefaults({ size: 32, motion: "wild" as never });
    await expect(setCompanionFigureDefaults({ size: 200 })).rejects.toThrow();
    await sendCompanionFiguresHome();
    expect(posted.map((message) => [message.method, message.params])).toEqual([
      ["figureDrag", { workId: "work-1" }],
      ["figure", { workId: "work-1", size: 48, motion: "default" }],
      ["figure", { workId: "work-1", size: "default", hidden: true, home: true }],
      ["figureNudge", { workId: "work-1", dx: 10, dy: -1 }],
      ["figureDefaults", { size: 32 }],
      ["figuresHome", {}],
    ]);
  });

  test("drag and anchor events are narrowed before listeners see them", () => {
    const target = installHost();
    const drags: unknown[] = [];
    const anchors: unknown[] = [];
    const stopDrag = onCompanionFigureDrag((drag) => drags.push(drag));
    const stopAnchors = onCompanionAnchors((update) => anchors.push({ anchors: Object.fromEntries(update.anchors), falling: update.falling }));
    target.dispatchEvent(new CustomEvent(COMPANION_FIGURE_DRAG_EVENT, { detail: {
      workId: "work-1", x: 10, y: 20, mod: "alt",
      guide: { kind: "perch", spot: { x: 12, y: 30 }, from: { x: 0, y: 30 }, to: { x: 100, y: 30 }, horizontal: true },
    } }));
    target.dispatchEvent(new CustomEvent(COMPANION_FIGURE_DRAG_EVENT, { detail: { workId: "work-1", x: 10, y: 20, mod: "ctrl", guide: { kind: "teleport", spot: { x: 1, y: 1 } } } }));
    target.dispatchEvent(new CustomEvent(COMPANION_FIGURE_DRAG_EVENT, { detail: { workId: "work-1", x: "far", y: 20 } }));
    target.dispatchEvent(new CustomEvent(COMPANION_FIGURE_DRAG_EVENT, { detail: { workId: null, dropped: "work-1", fall: true } }));
    target.dispatchEvent(new CustomEvent(COMPANION_ANCHORS_EVENT, { detail: {
      figures: [{ workId: "work-1", anchor: { x: 5, y: 6, down: "top", covered: false, away: true }, label: "Away with the Safari window" }, { workId: "<x>" }],
      falling: ["work-1", "<x>"],
    } }));
    stopDrag();
    stopAnchors();
    target.dispatchEvent(new CustomEvent(COMPANION_FIGURE_DRAG_EVENT, { detail: { workId: null } }));
    expect(drags).toEqual([
      { workId: "work-1", x: 10, y: 20, mod: "alt", guide: { kind: "perch", spot: { x: 12, y: 30 }, from: { x: 0, y: 30 }, to: { x: 100, y: 30 }, horizontal: true } },
      { workId: "work-1", x: 10, y: 20, mod: null, guide: null },
      { workId: null, dropped: "work-1", fall: true },
    ]);
    expect(anchors).toEqual([{
      anchors: { "work-1": { anchor: { x: 5, y: 6, down: "top", covered: false, away: true }, label: "Away with the Safari window" } },
      falling: ["work-1"],
    }]);
  });
});

describe("window chase wire", () => {
  test("anchors carry the perch frame and the pending flag", () => {
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, down: "bottom", pending: true, frame: { x: 10, y: 20, w: 300, h: 200 } }))
      .toEqual({ x: 1, y: 2, down: "bottom", covered: false, away: false, pending: true, frame: { x: 10, y: 20, w: 300, h: 200 } });
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, frame: { x: 10, y: 20, w: -1, h: 200 } })?.frame).toBeNull();
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, pending: "yes" })).toEqual({ x: 1, y: 2, down: null, covered: false, away: false });
  });

  test("an anchor is squeezed only when the host says so", () => {
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, down: "bottom", attachment: "sit", squeezed: true })?.squeezed).toBe(true);
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, squeezed: "yes" })).toEqual({ x: 1, y: 2, down: null, covered: false, away: false });
  });

  test("an anchor carries the host's label ink only when it is dark or light", () => {
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, labelInk: "dark" })?.labelInk).toBe("dark");
    expect(parseCompanionFigureAnchor({ x: 1, y: 2, labelInk: "light" })?.labelInk).toBe("light");
    for (const labelInk of ["Dark", "grey", 0.4, null, undefined]) {
      expect(parseCompanionFigureAnchor({ x: 1, y: 2, labelInk })).toEqual({ x: 1, y: 2, down: null, covered: false, away: false });
    }
  });

  test("landing names only falling figures, window or edge", () => {
    const update = parseCompanionAnchors({
      figures: [],
      falling: ["work-1", "work-2"],
      landing: { "work-1": "window", "work-2": "floor", "work-3": "edge", "<x>": "edge" },
    })!;
    expect(update.falling).toEqual(["work-1", "work-2"]);
    expect(Object.fromEntries(update.landing)).toEqual({ "work-1": "window" });
    expect(parseCompanionAnchors({ figures: [], falling: ["work-1"] })!.landing.size).toBe(0);
  });

  test("leave event and the left reply", async () => {
    const target = installHost();
    const seen: number[] = [];
    const stop = onCompanionLeave((ms) => seen.push(ms));
    target.dispatchEvent(new CustomEvent(COMPANION_LEAVE_EVENT, { detail: { ms: 700 } }));
    target.dispatchEvent(new CustomEvent(COMPANION_LEAVE_EVENT, { detail: { ms: "soon" } }));
    stop();
    target.dispatchEvent(new CustomEvent(COMPANION_LEAVE_EVENT, { detail: { ms: 10 } }));
    expect(seen).toEqual([700, 700]);
    reply = () => null;
    reportCompanionLeft();
    await Promise.resolve();
    expect(posted.map((message) => message.method)).toEqual(["left"]);
  });
});

describe("Notch retract", () => {
  test("the retract event carries how long the slide has, and nothing answers it", () => {
    const target = installHost();
    const seen: number[] = [];
    const stop = onCompanionRetract((ms) => seen.push(ms));
    target.dispatchEvent(new CustomEvent(COMPANION_RETRACT_EVENT, { detail: { ms: 160 } }));
    target.dispatchEvent(new CustomEvent(COMPANION_RETRACT_EVENT, { detail: { ms: "soon" } }));
    stop();
    target.dispatchEvent(new CustomEvent(COMPANION_RETRACT_EVENT, { detail: { ms: 10 } }));
    expect(seen).toEqual([160, 160]);
    expect(posted).toEqual([]);
  });

  test("the hotkey's summon reaches the page until it unsubscribes", () => {
    const target = installHost();
    let heard = 0;
    const stop = onCompanionSummoned(() => { heard += 1; });
    target.dispatchEvent(new CustomEvent(COMPANION_SUMMONED_EVENT, { detail: {} }));
    stop();
    target.dispatchEvent(new CustomEvent(COMPANION_SUMMONED_EVENT, { detail: {} }));
    expect(heard).toBe(1);
  });
});

describe("Edge hold bridge", () => {
  test("accepts Edge, saves a per-pin legacy hold and explicit window-top attachment", () => {
    expect(parseCompanionFigureDefaults({ hold: "edge" }).hold).toBe("edge");
    const [fig] = parseCompanionFigures([{workId:"w",hold:"latch",windowTop:"hang",placement:{kind:"window",side:"top",t:.5},anchor:{x:200,y:28,down:"top",attachment:"hang"}}],[{workId:"w",machineId:null}]);
    expect(fig!.hold).toBe("latch"); expect(fig!.windowTop).toBe("hang"); expect(fig!.anchor!.attachment).toBe("hang");
    const [bad] = parseCompanionFigures([{workId:"w",hold:"bogus",windowTop:"bogus",placement:{kind:"window",side:"top",t:.5},anchor:{x:200,y:28,down:"top",attachment:"bogus"}}],[{workId:"w",machineId:null}]);
    expect(bad!.hold).toBeUndefined(); expect(bad!.windowTop).toBeUndefined(); expect(bad!.anchor!.attachment).toBeUndefined();
  });
  test("figure request validates Edge hold and window-top fields", async () => {
    installHost(); reply = () => ({pins:[]});
    await setCompanionFigure("work-1",{hold:"edge",windowTop:"hang"});
    await setCompanionFigure("work-1",{hold:"default",windowTop:"sit"});
    expect(posted.slice(-2).map(m=>m.params)).toEqual([{workId:"work-1",hold:"edge",windowTop:"hang"},{workId:"work-1",hold:"default",windowTop:"sit"}]);
    await expect(setCompanionFigure("work-1",{hold:"bogus" as never})).rejects.toThrow("Nothing to change.");
  });
});

describe("pointing at the window a jump brought forward", () => {
  const app = { pid: 4242, bundleId: "com.mitchellh.ghostty" };

  test("sends the app and the box the operator pressed", () => {
    installHost();
    noteCompanionPress({ left: 24, top: 600, width: 340, height: 40 });
    pointCompanionAt(app);
    expect(posted.at(-1)).toMatchObject({ method: "point", params: { pid: 4242, bundleId: "com.mitchellh.ghostty", x: 24, y: 600, width: 340, height: 40 } });
  });

  test("an old press is not where the jump came from", () => {
    installHost();
    noteCompanionPress({ left: 24, top: 600, width: 340, height: 40 }, Date.now() - 60_000);
    pointCompanionAt(app);
    expect(posted.at(-1)!.params).toEqual({ pid: 4242, bundleId: "com.mitchellh.ghostty" });
  });

  test("an empty box keeps the last good press", () => {
    installHost();
    noteCompanionPress({ left: 10, top: 20, width: 30, height: 40 });
    noteCompanionPress({ left: 0, top: 0, width: 0, height: 12 });
    noteCompanionPress({ left: Number.NaN, top: 0, width: 5, height: 5 });
    pointCompanionAt(app);
    expect(posted.at(-1)!.params).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });

  test("quiet outside the companion and for an app it cannot name", () => {
    (globalThis as { window?: unknown }).window = new EventTarget();
    pointCompanionAt(app);
    installHost();
    pointCompanionAt({ pid: 0, bundleId: "com.mitchellh.ghostty" });
    pointCompanionAt({ pid: 4242, bundleId: "" });
    pointCompanionAt({ pid: 1.5, bundleId: "com.mitchellh.ghostty" });
    expect(posted).toEqual([]);
  });
});

describe("pop-outs", () => {
  const app = { pid: 4242, bundleId: "com.mitchellh.ghostty" };
  const token = "0123456789abcdef0123456789abcdef";
  const clear = { left: 0, top: 0, width: 720, height: 520 };

  test("a pop-out sends its token and the box to keep it clear of", () => {
    installHost();
    noteCompanionPress({ left: 24, top: 600, width: 340, height: 40 });
    pointCompanionAt(app, { token, clear });
    expect(posted.at(-1)).toMatchObject({ method: "point", params: { pid: 4242, bundleId: "com.mitchellh.ghostty", x: 24, y: 600, popOut: token, clear: { x: 0, y: 0, width: 720, height: 520 } } });
  });

  test("a broken token drops the pop-out, a broken box only the box", () => {
    installHost();
    pointCompanionAt(app, { token: token.toUpperCase(), clear });
    expect(posted.at(-1)!.params).not.toHaveProperty("popOut");
    expect(posted.at(-1)!.params).not.toHaveProperty("clear");
    pointCompanionAt(app, { token, clear: { left: 0, top: 0, width: Number.NaN, height: 10 } });
    expect(posted.at(-1)!.params).toMatchObject({ popOut: token });
    expect(posted.at(-1)!.params).not.toHaveProperty("clear");
    for (const bad of ["", token.slice(1), `${token}0`, "g".repeat(32), 7, null]) expect(isPopOutToken(bad)).toBe(false);
    expect(isPopOutToken(token)).toBe(true);
  });

  test("the page tells the host before it opens one, and only in the companion", () => {
    (globalThis as { window?: unknown }).window = new EventTarget();
    noteCompanionPopOutOpening();
    expect(posted).toEqual([]);
    installHost();
    noteCompanionPopOutOpening();
    expect(posted.map((m) => [m.method, m.params])).toEqual([["popOutOpening", {}]]);
  });

  test("it is kept clear of the board and any panel open beside it", () => {
    expect(unionBoxes([])).toBeNull();
    expect(unionBoxes([{ left: 380, top: 300, width: 340, height: 260 }, { left: 24, top: 200, width: 330, height: 420 }, { left: 0, top: 0, width: 0, height: 9 }]))
      .toEqual({ left: 24, top: 200, width: 696, height: 420 });
    const boxes = [{ left: 380, top: 300, width: 340, height: 260 }, { left: 24, top: 200, width: 330, height: 420 }];
    const asked: string[] = [];
    const root = { querySelectorAll: (selector: string) => { asked.push(selector); return boxes.map((b) => ({ getBoundingClientRect: () => b })); } } as unknown as ParentNode;
    expect(companionKeepClear(root)).toEqual({ left: 24, top: 200, width: 696, height: 420 });
    expect(asked).toEqual([".arv-board, .tap-panel"]);
    expect(companionKeepClear(null)).toBeNull();
  });

  test("Done on its tab hands the page its token, and only a real one", () => {
    const host = installHost();
    const done: string[] = [];
    const stop = onCompanionPopOutDone((t) => done.push(t));
    host.dispatchEvent(new CustomEvent("scout:companion-popout", { detail: { popOut: token } }));
    host.dispatchEvent(new CustomEvent("scout:companion-popout", { detail: { popOut: "x; kill -9 1" } }));
    host.dispatchEvent(new CustomEvent("scout:companion-popout", { detail: null }));
    stop();
    host.dispatchEvent(new CustomEvent("scout:companion-popout", { detail: { popOut: token } }));
    expect(done).toEqual([token]);
  });
});
