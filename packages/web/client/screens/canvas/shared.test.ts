import { expect, test } from "bun:test";
import { sharedItem, sharedMissing, type SharedEntry } from "./shared.ts";

function entry(listedIds: string[]): SharedEntry {
  return {
    key: "artifact:show:item", at: 1, changed: true,
    copy: { kind: "material", layer: "canvas", title: "Shot", summary: null, at: 1, state: "image", ref: { path: "show:old" }, revision: "1" },
    live: { key: "artifact:show:item", path: "show:new", name: "shot.png", kind: "image", agent: 0, at: 2, mt: 2, how: "shown", shown: { id: "new", itemId: "item", source: "/shot.png", listedIds, versions: listedIds.length } },
  };
}

test("an evicted shared version falls back to the newest listed version and keeps the change note", () => {
  const x = entry(["new"]);
  expect(sharedItem(x)).toBe(x.live!);
  expect(sharedMissing(x)).toBe(false);
  expect(x.changed).toBe(true);
});

test("a shared item is missing when every version has gone", () => {
  const x = { ...entry([]), live: null };
  expect(sharedMissing(x)).toBe(true);
  expect(sharedItem(x).path).toBe("show:old");
});

test("a still-listed shared version keeps its snapshot", () => {
  const x = entry(["old", "new"]);
  expect(sharedMissing(x)).toBe(false);
  expect(sharedItem(x).path).toBe("show:old");
  expect(sharedItem(x).mt).toBe(1);
  expect(sharedItem(x).shown?.source).toBe("/shot.png");
  expect(sharedItem(x).shown?.id).toBe("old");
});
