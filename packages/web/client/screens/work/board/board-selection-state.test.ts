import { expect, test } from "bun:test";
import type { Route } from "../../../lib/types.ts";
import { boardSelection, updateBoardSelection } from "./board-selection-state.ts";

const empty = { item: null, full: false };
const custom: Route = { view: "views", viewId: "my-work" };

test("custom-view boards select, toggle, expand and collapse locally without navigation", () => {
  const selected = updateBoardSelection(custom, empty, { type: "select", value: "work-one" });
  expect(selected.route).toBeUndefined();
  expect(boardSelection(custom, selected.local)).toEqual({ item: "work-one", full: false });
  const expanded = updateBoardSelection(custom, selected.local, { type: "expand" });
  expect(expanded.route).toBeUndefined();
  expect(expanded.local).toEqual({ item: "work-one", full: true });
  const collapsed = updateBoardSelection(custom, expanded.local, { type: "collapse" });
  expect(collapsed.local).toEqual(selected.local);
  const toggled = updateBoardSelection(custom, collapsed.local, { type: "select", value: (old) => old === "work-one" ? null : "work-one" });
  expect(toggled.local).toEqual(empty);
});

test("dedicated board keeps selection and expansion in the URL, preserving scope", () => {
  const route: Route = { view: "work", workId: "", board: true, boardItem: "work-one", machineId: "host" };
  expect(boardSelection(route, { item: "unrelated", full: true })).toEqual({ item: "work-one", full: false });
  const expanded = updateBoardSelection(route, empty, { type: "expand" });
  expect(expanded.route).toEqual({ ...route, boardFull: true });
  expect(expanded.local).toEqual(empty);
  const collapsed = updateBoardSelection(expanded.route!, empty, { type: "collapse" });
  expect(collapsed.route).toEqual({ ...route, boardFull: false });
  const closed = updateBoardSelection(expanded.route!, empty, { type: "select", value: null });
  expect(closed.route).toEqual({ ...route, boardItem: undefined, boardFull: false });
});

test("a board embedded on a work page still owns local selection", () => {
  const route: Route = { view: "work", workId: "parent" };
  const next = updateBoardSelection(route, empty, { type: "select", value: "child" });
  expect(next.route).toBeUndefined();
  expect(boardSelection(route, next.local).item).toBe("child");
});
