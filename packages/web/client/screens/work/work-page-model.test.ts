import { describe, expect, test } from "bun:test";
import type { WorkDetail } from "../../lib/types.ts";
import { BELOW_SHARE_DEFAULT, belowShareAfterDrag, defaultWorkTab, parseBelowShare, workDetailTabs } from "./work-page-model.ts";

const detail = (patch: Partial<WorkDetail>) => ({
  state: "waiting",
  allFlights: [{}, {}],
  timeline: [{}, {}, {}],
  inventory: { materials: [{}] },
  ...patch,
}) as unknown as WorkDetail;

describe("the work page's detail pane", () => {
  test("has Flight, Timeline, Tail and Files, in that order", () => {
    expect(workDetailTabs(null).map((t) => t.id)).toEqual(["flight", "timeline", "tail", "files"]);
  });

  test("counts flights, events and files once the work item is read", () => {
    expect(workDetailTabs(null).map((t) => t.count)).toEqual([null, null, null, null]);
    expect(workDetailTabs(detail({})).map((t) => t.count)).toEqual([2, 3, null, 1]);
    expect(workDetailTabs(detail({ inventory: undefined })).map((t) => t.count)).toEqual([2, 3, null, null]);
  });

  test("opens on the tail while the item runs, and on the timeline otherwise", () => {
    expect(defaultWorkTab(detail({ state: "working" }))).toBe("tail");
    expect(defaultWorkTab(detail({ state: "review" }))).toBe("timeline");
    expect(defaultWorkTab(null)).toBe("timeline");
  });
});

describe("the split between the work item and its detail, below", () => {
  test("reads a remembered split, and the shipped one when nothing usable was saved", () => {
    expect(parseBelowShare("0.6")).toBe(0.6);
    expect(parseBelowShare(null)).toBe(BELOW_SHARE_DEFAULT);
    expect(parseBelowShare("wide")).toBe(BELOW_SHARE_DEFAULT);
    expect(parseBelowShare("2")).toBe(0.85);
  });

  test("moves with the seam and keeps both parts in view", () => {
    expect(belowShareAfterDrag(0.5, 800, 80)).toBe(0.6);
    expect(belowShareAfterDrag(0.5, 800, -80)).toBe(0.4);
    expect(belowShareAfterDrag(0.5, 800, -2000)).toBe(0.15);
    expect(belowShareAfterDrag(0.5, 800, 2000)).toBe(0.85);
    expect(belowShareAfterDrag(0.5, 0, 80)).toBe(0.5);
  });
});
