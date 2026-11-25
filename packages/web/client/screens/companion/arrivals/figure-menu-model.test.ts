import { expect, test } from "bun:test";

import { figureMenuItems, stepMenu, type FigureMenuFacts } from "./figure-menu-model.ts";

const bare: FigureMenuFacts = {
  canReply: false, ask: null, interrupt: false, stop: null, openSession: false, focus: null,
  copyAttach: false, openThread: false, openWork: false, pr: false, copyRef: null,
};
const keys = (f: FigureMenuFacts) => figureMenuItems(f).map((g) => g.map((i) => i.key));

test("with nothing backed, the menu is Show latest, Details and the way back", () => {
  expect(keys(bare)).toEqual([["latest"], ["details", "home"]]);
  expect(figureMenuItems(bare)[1]![0]).toEqual({ key: "details", label: "Details", hint: "⌘I" });
});

test("a live session offers Reply, Interrupt, its ways in and its ref, in a native menu's groups", () => {
  const f = { ...bare, canReply: true, interrupt: true, openSession: true, focus: "Open in Ghostty", pr: true, copyRef: "session" as const };
  expect(keys(f)).toEqual([["reply", "interrupt"], ["open-session", "focus", "open-pr"], ["details", "copy-ref", "home"]]);
  expect(figureMenuItems(f)[1]![1]!.label).toBe("Open in Ghostty");
});

test("an open request puts its own answers first; the approve is the one accent", () => {
  const f = { ...bare, canReply: true, ask: { options: [], decisions: [{ label: "Allow once", go: true }, { label: "Deny", go: false }], dismiss: "Dismiss", reveal: true } };
  const talk = figureMenuItems(f)[0]!;
  expect(talk.map((i) => i.label)).toEqual(["Reply", "Allow once", "Deny", "Dismiss", "Go to the session that asked"]);
  expect(talk.filter((i) => i.go).map((i) => i.label)).toEqual(["Allow once"]);
  expect(talk.filter((i) => i.request).length).toBe(3);
  // Its own terminal is already a way in: no second jump to the same place.
  expect(figureMenuItems({ ...f, focus: "Open in herdr" })[0]!.map((i) => i.key)).not.toContain("reveal");
});

test("a question's options are its answers", () => {
  const f = { ...bare, ask: { options: ["main", "release"], decisions: [], dismiss: null, reveal: false } };
  expect(figureMenuItems(f)[0]!.map((i) => i.key)).toEqual(["latest", "answer:0", "answer:1"]);
});

test("Stop work asks once before it cancels, naming who it was asked of", () => {
  const f = { ...bare, openWork: true, openThread: true, stop: "devon", copyRef: "work" as const };
  const stop = figureMenuItems(f)[0]!.find((i) => i.key === "stop")!;
  expect(stop.confirm).toBe("Cancel the ask to devon?");
  expect(keys(f)[1]).toEqual(["open-thread", "open-work"]);
  expect(figureMenuItems(f)[2]![1]!.label).toBe("Copy work id");
});

test("a board row leads with Bring out, keeps Details, and offers Back to the board only once it is out", () => {
  const row = { ...bare, canReply: true, bringOut: true, home: false };
  expect(keys(row)).toEqual([["bring-out"], ["reply"], ["details"]]);
  expect(figureMenuItems(row)[0]![0]!.label).toBe("Bring out");
  expect(keys({ ...row, bringOut: false, home: true })).toEqual([["reply"], ["details", "home"]]);
});

test("Clear all requests sits with the request, after its own answers", () => {
  const f = { ...bare, clearAll: 3, ask: { options: [], decisions: [{ label: "Deny", go: false }], dismiss: "Dismiss", reveal: false } };
  expect(figureMenuItems(f)[0]!.map((i) => i.key)).toEqual(["latest", "decide:0", "dismiss", "clear-all"]);
  expect(figureMenuItems(f)[0]!.at(-1)!.label).toBe("Clear all requests…");
  expect(keys({ ...bare, clearAll: 0 })[0]).toEqual(["latest"]);
});

test("↑ and ↓ wrap at either end", () => {
  expect(stepMenu(-1, 4, 1)).toBe(0);
  expect(stepMenu(-1, 4, -1)).toBe(3);
  expect(stepMenu(3, 4, 1)).toBe(0);
  expect(stepMenu(0, 4, -1)).toBe(3);
  expect(stepMenu(0, 0, 1)).toBe(-1);
});
