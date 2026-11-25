import { afterEach, expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
import { DEFAULT_FIGURE_DEFAULTS, type CompanionFigure, type CompanionFigureAnchor } from "../../../lib/companion-host.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
const { DeskFigure, DeskPlates, FIGURE_LABEL_H, drawnSpot, figureEdges, figureMotionChoice } = await import("./DeskPlates.tsx");
const { deskFigureHold } = await import("./desk-form-model.ts");
const { deskPin, setDefaultDeskForm, setDeskForm } = await import("./desk-form.ts");
const { setDeskRestLine } = await import("./desk-rest.ts");
const { BOARD_CLEARANCE, FIGURE_LABEL_GAP, figureBox, figureLabelSpot, figureLabelWidth, figureSize, figureSlot } = await import("../figure-model.ts");
const { deskLabelText } = await import("./figure-labels.ts");
import type { FigureLook } from "../led-figure/figure-look-model.ts";

const thread: CornerThread = {
  id: "session:local:claude:s1", workId: null, conversationId: null, task: "Fix tests", handle: "claude", now: "All tests pass.",
  state: "waiting", at: 0, request: null, facts: [], harness: "claude", project: "openscout", branch: "main", pinId: "session:s1",
};
const figure: CompanionFigure = {
  workId: "session:s1", size: null, motion: null, hidden: false, label: "On the desk",
  placement: { kind: "free", displayID: 2, x: 0.5, y: 0.5 } as CompanionFigure["placement"],
  anchor: { x: 400, y: 300, down: null, covered: false, away: false },
};
const props = {
  threads: [thread], figureDefaults: null, cast: null, overlay: true, board: () => null, onDraft: () => {}, onLayout: () => {},
};
const desk = (figures: CompanionFigure[] | null) => renderToStaticMarkup(React.createElement(DeskPlates, { ...props, figures }));

afterEach(() => {
  setDeskForm("session:s1", null);
  setDefaultDeskForm("strip");
  setDeskRestLine(false);
});

test("an attached agent lands on the desk as a strip by default", () => {
  const markup = desk([figure]);
  expect(markup).toContain("arv-plate");
  expect(markup).toContain('data-placed="session:s1"');
  expect(markup).toContain('data-hit="plate:session:s1"');
  expect(markup).not.toContain("ce-placed");
});

test("an agent picked as a figure draws as one", () => {
  setDeskForm("session:s1", "figure");
  const markup = desk([figure]);
  expect(markup).toContain('class="ce-placed');
  expect(markup).toContain('data-placed="session:s1"');
  expect(markup).toContain('data-hit="plate:session:s1"');
  expect(markup).toContain('data-ax="400"');
  expect(markup).not.toContain("arv-plate");
});

test("at rest a strip is its name and state; its latest line only when the board's settings ask for it", () => {
  setDefaultDeskForm("figure");
  setDeskForm("session:s1", "strip");
  const markup = desk([figure]);
  expect(markup).not.toContain("ce-placed");
  expect(markup).toContain('data-placed="session:s1"');
  expect(markup).toContain('data-hit="plate:session:s1"');
  expect(markup).toContain("arv-plate__st is-waiting");
  expect(markup).not.toContain("All tests pass.");
  // No chrome at rest: the way back is in its menu and its settings.
  expect(markup).not.toContain("Back to the board");
  expect(markup).not.toContain("arv-plate__icon");
  setDeskRestLine(true);
  expect(desk([figure])).toContain("All tests pass.");
});

test("an asking strip says what it asks, whatever the rest line", () => {
  const asking: CornerThread = { ...thread, state: "asking", now: "May I push?" };
  const markup = renderToStaticMarkup(React.createElement(DeskPlates, { ...props, threads: [asking], figures: [figure] }));
  expect(markup).toContain("May I push?");
  expect(markup).toContain("arv-plate__st is-asking");
});

// Before the desk keeps it (land, after the draw), an agent with no pick is drawn as it lands.
test("an agent with no pick lands as the board's Land as; its own pick wins", () => {
  setDefaultDeskForm("strip");
  expect(desk([figure])).toContain("arv-plate");
  setDeskForm("session:s1", "figure");
  expect(desk([figure])).toContain("ce-placed");
});

test("a covered figure gives its clicks to the window in front", () => {
  setDeskForm("session:s1", "figure");
  const markup = desk([{ ...figure, anchor: { ...figure.anchor!, covered: true } }]);
  expect(markup).toContain("is-covered");
  expect(markup).not.toContain("data-hit=");
});

test("a home pin is not on the desk until the host drags it; then it is drawn at the pointer by its feet", () => {
  const home: CompanionFigure = { ...figure, placement: { kind: "home" }, anchor: null };
  expect(desk([home])).not.toContain("data-placed");

  // The desk's own decision for this pin (deskPin), then the figure it draws.
  const drag = { workId: "session:s1", x: 640, y: 480 };
  const pin = deskPin(home, null, drag, { state: thread.state, overlay: false, open: false, form: "figure" });
  expect(pin).toMatchObject({ form: "figure", dragging: true });
  const markup = renderToStaticMarkup(React.createElement(DeskFigure, {
    t: thread, figure: home, at: pin!.at, defaults: DEFAULT_FIGURE_DEFAULTS, cast: null, screen: { width: 1440, height: 900 }, reduced: false, dragging: pin!.dragging,
  }));
  const slot = figureSlot(DEFAULT_FIGURE_DEFAULTS.size);
  expect(markup).toContain('data-placed="session:s1"');
  expect(markup).toContain("is-dragging");
  // Dragging, the host holds the pointer: no hit region.
  expect(markup).not.toContain("data-hit=");
  expect(markup).toContain(`left:${640 - slot.width / 2}px`);
  expect(markup).toContain(`top:${480 - slot.height}px`);
});

test("an asking LED figure streams nothing above itself: its tile takes the accent, and its ask stays in its strip", () => {
  const asking: CornerThread = { ...thread, state: "asking", now: "May I push?" };
  const base = { t: asking, figure, at: figure.anchor!, defaults: DEFAULT_FIGURE_DEFAULTS, cast: null, screen: { width: 1440, height: 900 }, reduced: false };
  const markup = renderToStaticMarkup(React.createElement(DeskFigure, base));
  expect(markup).toContain("led-fig is-needs");
  expect(markup).not.toContain("led-fig__banner");
  expect(markup).not.toContain("May I push?");
});

test("a figure's settings offer its motion, and that motion for every figure only when it changes something", () => {
  const defaults = DEFAULT_FIGURE_DEFAULTS;
  expect(figureMotionChoice(figure, [figure], defaults)).toEqual({ motion: "full", everyFigure: null });
  // Its own motion differs from the default: it can be made everyone's.
  const calm = { ...figure, motion: "calm" as const };
  expect(figureMotionChoice(calm, [calm], defaults)).toEqual({ motion: "calm", everyFigure: "calm" });
  // Another figure moves its own way: making this one's motion everyone's still changes something.
  const still = { ...figure, workId: "session:s2", motion: "still" as const };
  expect(figureMotionChoice(figure, [figure, still], defaults).everyFigure).toBe("full");
});

test("figures and strips on the desk are regions of their own for the hover summary, with no tooltip", () => {
  for (const form of ["figure", "strip"] as const) {
    setDeskForm("session:s1", form);
    const markup = desk([figure]);
    expect(markup).toContain('data-hit="plate:session:s1"');
    expect(markup).not.toContain("Right-click for more.");
  }
});

test("a figure's label is its number alone, in the ink the host read under it, and its plate shows while the pointer is on it", () => {
  const base = { t: thread, figure, at: figure.anchor!, defaults: DEFAULT_FIGURE_DEFAULTS, cast: null, look: "led-initials" as const, screen: { width: 1440, height: 900 }, reduced: false, label: { project: "OS", code: "005" } };
  const markup = renderToStaticMarkup(React.createElement(DeskFigure, base));
  expect(markup).toContain('class="arv-figtag"');
  expect(markup).toContain(">005</span>");
  expect(markup).not.toContain("OS 005");
  // The label takes the pointer for its figure: on it is on the figure.
  expect(markup).toContain('data-hit="plate:session:s1" data-label-for="session:s1" aria-hidden="true"');
  expect(markup).not.toContain("is-pointed");
  const dark = renderToStaticMarkup(React.createElement(DeskFigure, { ...base, at: { ...base.at, labelInk: "dark" as const } }));
  expect(dark).toContain('class="arv-figtag is-ink-dark"');
  const light = renderToStaticMarkup(React.createElement(DeskFigure, { ...base, at: { ...base.at, labelInk: "light" as const } }));
  expect(light).toContain('class="arv-figtag"');
  expect(renderToStaticMarkup(React.createElement(DeskFigure, { ...base, pointed: true }))).toContain(" is-pointed");
  // Carried, it is under the host's pointer: no plate, and no region of its own.
  const carried = renderToStaticMarkup(React.createElement(DeskFigure, { ...base, pointed: true, dragging: true }));
  expect(carried).not.toContain("is-pointed");
  expect(carried).not.toContain("data-hit=");
});

const STATES = ["asking", "working", "waiting", "ended"] as const;
const footprint = (state: CornerThread["state"], look: FigureLook = "led-initials") => ({
  t: { ...thread, state }, figure, at: figure.anchor!, defaults: DEFAULT_FIGURE_DEFAULTS, cast: null, look,
  screen: { width: 1440, height: 900 }, reduced: false, label: { project: "OS", code: "005" },
});
/** The parts an LED figure at the shared anchor draws, from the figure model alone. */
function ledParts() {
  const { at, screen, label } = footprint("working");
  const size = figureSize(figure, DEFAULT_FIGURE_DEFAULTS);
  const slot = figureSlot(size);
  const held = figureBox(at, size, screen, deskFigureHold(figure, DEFAULT_FIGURE_DEFAULTS, undefined, true));
  const width = figureLabelWidth(deskLabelText(label));
  const tag = figureLabelSpot(held, at, size, { width, height: FIGURE_LABEL_H }, screen);
  return {
    slot: { left: held.left, top: held.top, right: held.left + slot.width, bottom: held.top + slot.height },
    label: { left: tag.left, top: tag.top, right: tag.left + width, bottom: tag.top + FIGURE_LABEL_H },
  };
}
type Edges = { left: number; top: number; right: number; bottom: number };
const holds = (outer: Edges, inner: Edges) =>
  outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;

test("an LED figure's footprint holds its slot and its label below it, the same in every state", () => {
  const parts = ledParts();
  // Below it: its top under the slot.
  expect(parts.label.top).toBeGreaterThan(parts.slot.top);
  const asking = figureEdges(footprint("asking"));
  for (const state of STATES) {
    const edges = figureEdges(footprint(state));
    expect(edges).toEqual(asking);
    expect(holds(edges, parts.slot)).toBe(true);
    expect(holds(edges, parts.label)).toBe(true);
  }
});

test("a character figure's footprint does not change with its state either", () => {
  const asking = figureEdges(footprint("asking", "character"));
  for (const state of STATES) expect(figureEdges(footprint(state, "character"))).toEqual(asking);
});

test("an LED figure kept clear of the board stays put when it starts or stops asking", () => {
  const { slot } = ledParts();
  // The board ends just above the figure's slot, inside its clearance.
  const cx = (slot.left + slot.right) / 2;
  const board = { left: cx - 60, top: slot.top - 80, right: cx + 60, bottom: slot.top - 2 };
  const spots = STATES.map((state) => drawnSpot(footprint(state), board));
  for (const spot of spots) expect(spot).toEqual(spots[0]);
  // It stepped clear, and the stepped footprint is outside the board's clearance.
  expect(spots[0]).not.toEqual(figure.anchor);
  for (const state of STATES) {
    const edges = figureEdges({ ...footprint(state), at: spots[0] });
    const clear = edges.right <= board.left - BOARD_CLEARANCE || edges.left >= board.right + BOARD_CLEARANCE
      || edges.bottom <= board.top - BOARD_CLEARANCE || edges.top >= board.bottom + BOARD_CLEARANCE;
    expect(clear).toBe(true);
  }
});

test("at the bottom edge of a 3440 x 1440 screen, a figure lifts to fit its number below it; the number never flips above", () => {
  const screen = { width: 3440, height: 1440 };
  const size = figureSize(figure, DEFAULT_FIGURE_DEFAULTS);
  const hold = deskFigureHold(figure, DEFAULT_FIGURE_DEFAULTS, undefined, true);
  const width = figureLabelWidth(deskLabelText({ project: "OS", code: "005" }));
  const drawn = (at: { x: number; y: number; down: CompanionFigureAnchor["down"] }) => {
    const held = figureBox(at, size, screen, hold);
    return { held, tag: figureLabelSpot(held, at, size, { width, height: FIGURE_LABEL_H }, screen) };
  };
  // Standing on the screen's bottom edge (held there, as 005 was), free with its feet on it, or holding a side down to it.
  for (const down of ["bottom", null, "left"] as const) {
    const input = { ...footprint("working"), screen, at: { ...figure.anchor!, x: 3000, y: 1440, down } };
    const at = drawnSpot(input, null);
    expect(at.x).toBe(3000);
    expect(at.y).toBeLessThan(1440);
    const { held, tag } = drawn(at);
    // Its number below its feet, whole on the screen.
    expect(tag.top).toBeGreaterThanOrEqual(held.bodyBottom + FIGURE_LABEL_GAP - 0.5);
    expect(tag.top + FIGURE_LABEL_H).toBeLessThanOrEqual(1440 - 2);
    if (down !== "left") {
      // Feet on the anchor: lifted by its number's room and no more.
      expect(tag.top + FIGURE_LABEL_H).toBe(1440 - 2);
      expect(at.y).toBe(1440 - FIGURE_LABEL_GAP - FIGURE_LABEL_H - 2);
    }
  }
  // With room below, a figure on an edge stays on it.
  const room = { ...footprint("working"), screen, at: { ...figure.anchor!, x: 3000, y: 1200, down: "bottom" as const } };
  expect(drawnSpot(room, null)).toEqual(room.at);
});

test("on the desk, a figure at the screen's bottom edge is drawn lifted with its number below it", () => {
  setDeskForm("session:s1", "figure");
  // Rendered without a window, the desk's screen is 1440 x 900.
  const low: CompanionFigure = {
    ...figure, placement: { kind: "edge", displayID: 2, edge: "bottom", t: 0.5 } as unknown as CompanionFigure["placement"],
    anchor: { x: 700, y: 900, down: "bottom", covered: false, away: false },
  };
  const markup = renderToStaticMarkup(React.createElement(DeskPlates, { ...props, figures: [low], labels: new Map([["session:s1", { project: "OS", code: "005" }]]) }));
  const slot = figureSlot(figureSize(low, DEFAULT_FIGURE_DEFAULTS));
  const lifted = 900 - FIGURE_LABEL_GAP - FIGURE_LABEL_H - 2;
  expect(markup).toContain(`top:${lifted - slot.height}px`);
  // The number sits under the slot, never above it.
  const tag = /class="arv-figtag[^"]*"[^>]*style="([^"]*)"/.exec(markup);
  expect(tag).not.toBeNull();
  const top = Number(/top:(-?[\d.]+)px/.exec(tag![1]!)![1]);
  expect(top).toBe(slot.height + FIGURE_LABEL_GAP);
});

test("the host reads the picture only under a settled label on the desk", () => {
  const base = { t: thread, figure, at: figure.anchor!, defaults: DEFAULT_FIGURE_DEFAULTS, cast: null, look: "led-initials" as const, screen: { width: 1440, height: 900 }, reduced: false, label: { project: "OS", code: "005" } };
  const render = (props: Partial<typeof base> & { dragging?: boolean; falling?: boolean }) =>
    renderToStaticMarkup(React.createElement(DeskFigure, { ...base, ...props }));
  expect(render({})).toContain('data-label-for="session:s1"');
  // On a window, carried, falling or covered: no read, so the light fallback.
  expect(render({ at: { ...base.at, frame: { x: 100, y: 200, w: 600, h: 400 } } })).not.toContain("data-label-for");
  expect(render({ dragging: true })).not.toContain("data-label-for");
  expect(render({ falling: true })).not.toContain("data-label-for");
  expect(render({ at: { ...base.at, covered: true } })).not.toContain("data-label-for");
});
