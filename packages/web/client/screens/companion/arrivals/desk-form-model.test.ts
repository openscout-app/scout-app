import { expect, test } from "bun:test";

import { DEFAULT_FIGURE_DEFAULTS, type CompanionFigure } from "../../../lib/companion-host.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import {
  DEFAULT_DESK_FORM,
  deskFigureHold,
  deskFormOf,
  deskFormResolve,
  deskPin,
  deskSpot,
  figureCardState,
  figureSay,
  keepDeskForms,
  landDeskForms,
  parseDeskForm,
  parseDeskForms,
  withDeskForm,
} from "./desk-form-model.ts";

const pin = (patch: Partial<CompanionFigure> = {}): CompanionFigure => ({
  workId: "session:s1", size: null, motion: null, hidden: false, label: "On the desk",
  placement: { kind: "free", x: 0.5, y: 0.5 },
  anchor: { x: 400, y: 300, down: null, covered: false, away: false },
  ...patch,
});

test("an agent lands as a strip unless the operator picked otherwise", () => {
  expect(DEFAULT_DESK_FORM).toBe("strip");
  expect(parseDeskForm(null)).toBe("strip");
  expect(parseDeskForm("banner")).toBe("strip");
  expect(parseDeskForm("strip")).toBe("strip");
  expect(deskFormOf({}, "a", DEFAULT_DESK_FORM)).toBe("strip");
  expect(deskFormOf({}, "a", "strip")).toBe("strip");
  // Inherited keys are not picks.
  expect(deskFormOf({}, "constructor", "figure")).toBe("figure");
});

test("a pick is set per pin, and cleared back to the default", () => {
  const set = withDeskForm({}, "a", "strip");
  expect(set).toEqual({ a: "strip" });
  expect(deskFormOf(set, "a", "figure")).toBe("strip");
  expect(deskFormOf(set, "b", "figure")).toBe("figure");
  expect(withDeskForm(set, "a", "strip")).toBe(set);
  expect(withDeskForm(set, "a", "figure")).toEqual({ a: "figure" });
  const cleared = withDeskForm(set, "a", null);
  expect(cleared).toEqual({});
  expect(withDeskForm(cleared, "a", null)).toBe(cleared);
});

test("picks for pins the host let go of are pruned", () => {
  const forms = { a: "strip", b: "figure", c: "strip" } as const;
  expect(keepDeskForms(forms, ["a", "c", "z"])).toEqual({ a: "strip", c: "strip" });
  expect(keepDeskForms(forms, ["a", "b", "c"])).toBe(forms);
  expect(keepDeskForms(forms, [])).toEqual({});
});

test("an agent on the desk keeps the form it landed as; a later default changes only new landings", () => {
  const landed = landDeskForms({ a: "figure" }, ["a", "b"], "strip");
  expect(landed).toEqual({ a: "figure", b: "strip" });
  // The default moves on; b keeps what it landed as, c lands as the new one.
  expect(landDeskForms(landed, ["a", "b", "c"], "figure")).toEqual({ a: "figure", b: "strip", c: "figure" });
  expect(landDeskForms(landed, ["a", "b"], "figure")).toBe(landed);
  // An inherited key is not a pick: it lands too.
  expect(deskFormOf(landDeskForms({}, ["constructor"], "strip"), "constructor", "figure")).toBe("strip");
});

test("unreadable storage reads as no picks", () => {
  expect(parseDeskForms(null)).toEqual({});
  expect(parseDeskForms("{not json")).toEqual({});
  expect(parseDeskForms("[\"strip\"]")).toEqual({});
  expect(parseDeskForms("\"strip\"")).toEqual({});
  expect(parseDeskForms(JSON.stringify({ a: "strip", b: "banner", c: 3, d: "figure" }))).toEqual({ a: "strip", d: "figure" });
});

test("a placed pin is drawn at its anchor; a hidden, home or away one is not", () => {
  expect(deskSpot(pin(), undefined, null)).toMatchObject({ x: 400, y: 300, down: null, covered: false });
  expect(deskSpot(pin({ hidden: true }), undefined, null)).toBeNull();
  expect(deskSpot(pin({ placement: { kind: "home" } }), undefined, null)).toBeNull();
  expect(deskSpot(pin(), { x: 1, y: 2, down: "top", covered: false, away: true }, null)).toBeNull();
  // A live update that lost the spot wins over the state's anchor.
  expect(deskSpot(pin(), null, null)).toBeNull();
  expect(deskSpot(pin(), { x: 10, y: 20, down: "top", covered: true, away: false }, null)).toMatchObject({ x: 10, y: 20, down: "top", covered: true });
});

test("a pin the host is dragging is drawn upright at the pointer, even a home pin pulled off the board", () => {
  const drag = { workId: "session:s1", x: 640, y: 480 };
  expect(deskSpot(pin({ placement: { kind: "home" }, anchor: null }), null, drag)).toEqual({ x: 640, y: 480, down: null, covered: false });
  expect(deskSpot(pin(), undefined, drag)).toEqual({ x: 640, y: 480, down: null, covered: false });
  expect(deskSpot(pin({ placement: { kind: "home" } }), undefined, { ...drag, workId: "other" })).toBeNull();
});

test("the desk draws a pin by its spot, the overlay and its form", () => {
  const view = { state: "waiting" as const, overlay: true, open: false, form: "figure" as const };
  expect(deskPin(pin(), undefined, null, view)).toEqual({ at: expect.objectContaining({ x: 400, y: 300 }), form: "figure", dragging: false });
  expect(deskPin(pin(), undefined, null, { ...view, form: "strip" })?.form).toBe("strip");
  // The overlay off hides it, unless it asks or is open.
  expect(deskPin(pin(), undefined, null, { ...view, overlay: false })).toBeNull();
  expect(deskPin(pin(), undefined, null, { ...view, overlay: false, state: "asking" })).not.toBeNull();
  expect(deskPin(pin(), undefined, null, { ...view, overlay: false, open: true })).not.toBeNull();
});

test("a row pulled off the board is drawn at the pointer in the form it lands as, overlay or not", () => {
  const home = pin({ placement: { kind: "home" }, anchor: null });
  const view = { state: "waiting" as const, overlay: false, open: false, form: "strip" as const };
  expect(deskPin(home, null, null, { ...view, overlay: true })).toBeNull();
  expect(deskPin(home, null, { workId: "session:s1", x: 640, y: 480 }, view)).toEqual({
    at: { x: 640, y: 480, down: null, covered: false }, form: "strip", dragging: true,
  });
  expect(deskPin(home, null, { workId: "other", x: 640, y: 480 }, { ...view, overlay: true })).toBeNull();
});

test("an LED figure holds an edge with the latch; a character keeps its edge pose", () => {
  const edge = { ...DEFAULT_FIGURE_DEFAULTS, hold: "edge" as const };
  expect(deskFigureHold(pin(), edge, "milo", true)).toBe("latch");
  expect(deskFigureHold(pin({ hold: "edge" }), { ...edge, hold: "iso" }, "milo", true)).toBe("latch");
  expect(deskFigureHold(pin({ hold: "iso" }), edge, "milo", true)).toBe("iso");
  expect(deskFigureHold(pin(), edge, "milo", false)).toBe("edge");
  expect(deskFigureHold(pin(), edge, "unknown", false)).toBe("iso");
});

test("the board's state reads as the figure's", () => {
  expect(figureCardState("asking")).toBe("question");
  expect(figureCardState("working")).toBe("working");
  expect(figureCardState("waiting")).toBe("waiting");
  expect(figureCardState("ended")).toBe("done");
});

test("an LED banner speaks only while the agent asks: the ask, else its line", () => {
  const request = { kind: "question", title: "Ship it?", permission: null, summary: null } as unknown as OperatorAttentionItem;
  expect(figureSay({ state: "asking", request, now: "line" })).toBe("asks Ship it?");
  expect(figureSay({ state: "asking", request: null, now: "May I push?" })).toBe("May I push?");
  expect(figureSay({ state: "working", request: null, now: "Building" })).toBeUndefined();
  expect(figureSay({ state: "waiting", request, now: "line" })).toBeUndefined();
});

test("a pin's form: its own pick, its project's, the default it landed as, then the default", () => {
  const choice = { agents: { a: "figure" as const }, projects: { openscout: "figure" as const }, landed: { b: "strip" as const, c: "strip" as const }, fallback: "figure" as const };
  expect(deskFormResolve(choice, { id: "a", project: "hudson" })).toEqual({ form: "figure", from: "agent" });
  // A project pick reaches a pin already on the desk; a new default does not.
  expect(deskFormResolve(choice, { id: "b", project: "openscout" })).toEqual({ form: "figure", from: "project" });
  expect(deskFormResolve(choice, { id: "c", project: "hudson" })).toEqual({ form: "strip", from: "landed" });
  expect(deskFormResolve(choice, { id: "d", project: null })).toEqual({ form: "figure", from: "default" });
});
