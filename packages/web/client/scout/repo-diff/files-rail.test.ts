import { describe, expect, test } from "bun:test";

import { buildFileTree, compactFileTree, fileNameBreaks, type FileEntry } from "./FilesRail.tsx";
import { SPLIT_MIN_WIDTH, splitFitsWidth } from "./model.ts";
import type { RepoDiffFile } from "./types.ts";

function entry(path: string, index: number): FileEntry {
  const slash = path.lastIndexOf("/");
  return {
    file: { status: "modified", newPath: path } as unknown as RepoDiffFile,
    index,
    key: path,
    display: path,
    name: path.slice(slash + 1),
    dir: slash < 0 ? "" : path.slice(0, slash),
    renamed: false,
  };
}

describe("files rail tree", () => {
  test("folds folders that hold only one folder", () => {
    const tree = compactFileTree(buildFileTree([
      entry("apps/macos/Sources/Scout/ScoutRootView.swift", 0),
      entry("apps/macos/Sources/Scout/Companion.swift", 1),
      entry("packages/web/client/a.ts", 2),
      entry("packages/web/server/b.ts", 3),
    ]));
    const top = [...tree.children.values()];
    expect(top.map((node) => node.name)).toEqual(["apps/macos/Sources/Scout", "packages/web"]);
    // the folded node keeps the deepest path, the key a folder collapses by
    expect(top[0]!.path).toBe("apps/macos/Sources/Scout");
    expect(top[0]!.files.map((file) => file.name)).toEqual(["ScoutRootView.swift", "Companion.swift"]);
    expect([...top[1]!.children.values()].map((node) => node.name)).toEqual(["client", "server"]);
  });
});

describe("file name breaks", () => {
  test("break between words, never inside one or before the extension", () => {
    expect(fileNameBreaks("ScoutRootView.swift")).toEqual(["Scout", "Root", "View.swift"]);
    expect(fileNameBreaks("repo-diff.css")).toEqual(["repo-", "diff.css"]);
    expect(fileNameBreaks("bun.lock").join("")).toBe("bun.lock");
  });
});

describe("split room", () => {
  test("split needs the minimum surface width; unmeasured keeps the choice", () => {
    expect(splitFitsWidth(0)).toBe(true);
    expect(splitFitsWidth(SPLIT_MIN_WIDTH - 1)).toBe(false);
    expect(splitFitsWidth(SPLIT_MIN_WIDTH)).toBe(true);
  });
});
