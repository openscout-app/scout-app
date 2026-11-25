import { describe, expect, test } from "bun:test";
import type { Route } from "../../../lib/types.ts";
import {
  columnNote,
  frameLook,
  isGridPanelKey,
  panelModuleType,
  placeColumns,
  sourcePick,
  teamPick,
  worldSource,
  worldTeam,
  worldYieldsKey,
  type KeyFacts,
} from "./world-panels-model.ts";

const both = { left: true, right: true };

describe("where the World's columns draw", () => {
  test("each column is out while the view has a panel for it", () => {
    expect(placeColumns({ full: false, columns: both })).toEqual({ left: "out", right: "out" });
    expect(placeColumns({ full: false, columns: { left: true, right: false } })).toEqual({ left: "out", right: "in" });
    expect(placeColumns({ full: false, columns: { left: false, right: false } })).toEqual({ left: "in", right: "in" });
  });

  test("in full view the HUD draws whole, both columns in its frame", () => {
    expect(placeColumns({ full: true, columns: both })).toEqual({ left: "in", right: "in" });
  });

  test("both out: the engine's one-column frame, and the HUD's breakpoints off", () => {
    expect(frameLook({ left: "out", right: "out" })).toEqual({ slotted: true, outLeft: false, outRight: false, container: false });
  });

  test("one out: the frame keeps the other column, and its breakpoints read the panel", () => {
    expect(frameLook({ left: "out", right: "in" })).toEqual({ slotted: false, outLeft: true, outRight: false, container: true });
    expect(frameLook({ left: "in", right: "out" })).toEqual({ slotted: false, outLeft: false, outRight: true, container: true });
  });

  test("both in: the page's own frame", () => {
    expect(frameLook({ left: "in", right: "in" })).toEqual({ slotted: false, outLeft: false, outRight: false, container: true });
  });

  test("a column panel says why it is empty, and nothing once its column is there", () => {
    expect(columnNote({ stage: false, ready: false, place: "in", side: "left" })).toContain("Add World");
    expect(columnNote({ stage: true, ready: true, place: "in", side: "right" })).toContain("full view");
    expect(columnNote({ stage: true, ready: false, place: "out", side: "left" })).toBe("Waiting for the World panel.");
    expect(columnNote({ stage: true, ready: true, place: "out", side: "left" })).toBeNull();
  });
});

describe("which keys the HUD leaves alone", () => {
  const facts = (over: Partial<KeyFacts>): KeyFacts => ({
    key: " ",
    shift: false,
    alt: false,
    meta: false,
    ctrl: false,
    ownRoute: true,
    focusModule: null,
    inWorld: false,
    inView: false,
    onControl: false,
    onPanelFrame: false,
    ...over,
  });

  test("on Ops › World the HUD keeps its page-wide keys, nothing focused", () => {
    expect(worldYieldsKey(facts({}))).toBe(false);
    expect(worldYieldsKey(facts({ key: "Escape" }))).toBe(false);
  });

  test("focus in another panel: the key is that panel's", () => {
    expect(worldYieldsKey(facts({ focusModule: "tail", inView: true }))).toBe(true);
    expect(worldYieldsKey(facts({ focusModule: "terminal", inView: true, key: "j" }))).toBe(true);
  });


test("docked separators retain arrows and Space outside World markup and panels", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter", "Tab"])
    expect(worldYieldsKey(facts({ key, inWorld: false, inView: true, focusModule: null, onSeparator: true, onControl: true }))).toBe(true);
});

  test("focus inside a World panel: the HUD's", () => {
    for (const focusModule of ["world-stage", "world-readouts", "world-details"]) {
      expect(worldYieldsKey(facts({ focusModule, inView: true, inWorld: true, key: "j" })), focusModule).toBe(false);
    }
    // the panel body the click landed on (outside the HUD's markup, not a control)
    expect(worldYieldsKey(facts({ focusModule: "world-stage", inView: true, key: " " }))).toBe(false);
  });

  test("a World panel's own frame keeps esc, f, e, the moves and Tab for the grid", () => {
    const frame = { focusModule: "world-stage", inView: true, onPanelFrame: true };
    for (const key of ["Escape", "f", "e", "Tab"]) expect(worldYieldsKey(facts({ ...frame, key })), key).toBe(true);
    expect(worldYieldsKey(facts({ ...frame, key: "ArrowLeft", shift: true }))).toBe(true);
    expect(worldYieldsKey(facts({ ...frame, key: "ArrowDown", alt: true }))).toBe(true);
    // the rest still drive the world from there: play, scrub
    expect(worldYieldsKey(facts({ ...frame, key: " " }))).toBe(false);
    expect(worldYieldsKey(facts({ ...frame, key: "ArrowLeft" }))).toBe(false);
  });

  test("Enter and Space press a control in a panel's head or the view's bar; Tab moves on", () => {
    const head = { focusModule: "world-stage", inView: true, onControl: true };
    expect(worldYieldsKey(facts({ ...head, key: "Enter" }))).toBe(true);
    expect(worldYieldsKey(facts({ ...head, key: " " }))).toBe(true);
    expect(worldYieldsKey(facts({ ...head, key: "Tab" }))).toBe(true);
    expect(worldYieldsKey(facts({ inView: true, onControl: true, key: " " }))).toBe(true);
    // a chip inside the HUD is the HUD's, as on the page
    expect(worldYieldsKey(facts({ ...head, inWorld: true, key: " " }))).toBe(false);
  });

  test("the shell around the page keeps today's behaviour: the HUD reads its keys", () => {
    expect(worldYieldsKey(facts({ onControl: true, key: " " }))).toBe(false);
  });

  test("off Ops › World the HUD reads keys only with focus in a World panel", () => {
    expect(worldYieldsKey(facts({ ownRoute: false }))).toBe(true);
    expect(worldYieldsKey(facts({ ownRoute: false, onControl: true }))).toBe(true);
    expect(worldYieldsKey(facts({ ownRoute: false, focusModule: "world-details", inView: true, inWorld: true, key: "j" }))).toBe(false);
  });

  test("the grid's own keys", () => {
    const k = (key: string, mods: Partial<KeyFacts> = {}) => isGridPanelKey({ key, shift: false, alt: false, meta: false, ctrl: false, ...mods });
    expect(k("f")).toBe(true);
    expect(k("f", { meta: true })).toBe(false);
    expect(k("F", { shift: true })).toBe(false);
    expect(k("ArrowUp")).toBe(false);
    expect(k("ArrowUp", { shift: true })).toBe(true);
  });

  test("reads a panel's module from its class", () => {
    expect(panelModuleType("hud-grid-panel vw-panel vw-panel--world-stage is-focus")).toBe("world-stage");
    expect(panelModuleType("hud-grid-panel")).toBeNull();
  });
});

describe("source and dataset", () => {
  const world = (over: Partial<Extract<Route, { view: "ops" }>> = {}) => ({ view: "ops", mode: "week", ...over }) as Route;
  const elsewhere = { view: "views", viewId: "ops-world" } as unknown as Route;

  test("on Ops › World they are the page's ?source= and ?data=", () => {
    expect(worldSource(world(), { source: "live" })).toBe("week");
    expect(worldSource(world({ source: "otlp" }), {})).toBe("otlp");
    expect(worldTeam(world({ dataset: "team" }), {})).toBe(true);
    expect(worldTeam(world(), { data: "team" })).toBe(false);
  });

  test("anywhere else they are the panel's own", () => {
    expect(worldSource(elsewhere, {})).toBe("week");
    expect(worldSource(elsewhere, { source: "live" })).toBe("live");
    expect(worldSource(elsewhere, { source: "nonsense" })).toBe("week");
    expect(worldTeam(elsewhere, { data: "team" })).toBe(true);
  });

  test("a source switch rewrites the page in place, keeping the rest of it", () => {
    expect(sourcePick(world({ dataset: "team" }), "live")).toEqual({ kind: "page", route: world({ dataset: "team", source: "live" }), replace: true });
    expect(sourcePick(world({ source: "live" }), "week")).toEqual({ kind: "page", route: world({ source: undefined }), replace: true });
  });

  test("the DATA chip opens the other dataset as a new page, as the screen's reload did", () => {
    expect(teamPick(world(), true)).toEqual({ kind: "page", route: world({ dataset: "team" }), replace: false });
    expect(teamPick(world({ dataset: "team" }), false)).toEqual({ kind: "page", route: world({ dataset: undefined }), replace: false });
  });

  test("off the page a pick changes the panel's settings and never the page", () => {
    expect(sourcePick(elsewhere, "otlp")).toEqual({ kind: "config", patch: { source: "otlp" } });
    expect(sourcePick(elsewhere, "week")).toEqual({ kind: "config", patch: { source: "" } });
    expect(teamPick(elsewhere, true)).toEqual({ kind: "config", patch: { data: "team" } });
    expect(teamPick(elsewhere, false)).toEqual({ kind: "config", patch: { data: "" } });
  });
});
