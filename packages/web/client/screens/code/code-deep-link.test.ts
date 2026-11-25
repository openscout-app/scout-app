import { describe, expect, test } from "bun:test";
import {
  formatScoutCodeDeepLink,
  matchRootForAbsolutePath,
  parseScoutCodeDeepLink,
} from "./code-deep-link.ts";

describe("parseScoutCodeDeepLink", () => {
  test("parses scout://{project}/{path}", () => {
    expect(parseScoutCodeDeepLink("scout://openscout/packages/web/foo.ts")).toEqual({
      project: "openscout",
      path: "packages/web/foo.ts",
    });
  });

  test("parses project-only links and query fields", () => {
    expect(parseScoutCodeDeepLink("scout://openscout?wt=comms&line=12&endLine=20")).toEqual({
      project: "openscout",
      wt: "comms",
      line: 12,
      endLine: 20,
    });
  });

  test("parses absolute scout:///path", () => {
    expect(parseScoutCodeDeepLink("scout:///example/workstation-user/dev/openscout/foo.ts")).toEqual({
      root: "/example/workstation-user/dev/openscout/foo.ts",
      file: "/example/workstation-user/dev/openscout/foo.ts",
    });
  });

  test("parses scout://file/ absolute form", () => {
    expect(parseScoutCodeDeepLink("scout://file/example/workstation-user/dev/openscout/foo.ts?line=3")).toEqual({
      root: "/example/workstation-user/dev/openscout/foo.ts",
      file: "/example/workstation-user/dev/openscout/foo.ts",
      line: 3,
    });
  });

  test("parses legacy scout://code/... and absolute query form", () => {
    expect(parseScoutCodeDeepLink("scout://code/openscout/README.md")).toEqual({
      project: "openscout",
      path: "README.md",
    });
    expect(parseScoutCodeDeepLink("scout://code?root=/tmp/repo&file=/tmp/repo/a.ts")).toEqual({
      root: "/tmp/repo",
      file: "/tmp/repo/a.ts",
    });
  });

  test("accepts bare absolute and home paths", () => {
    expect(parseScoutCodeDeepLink("/example/workstation-user/dev/openscout")).toEqual({
      root: "/example/workstation-user/dev/openscout",
      file: "/example/workstation-user/dev/openscout",
    });
    expect(parseScoutCodeDeepLink("~/dev/openscout/foo.ts")).toEqual({
      root: "~/dev/openscout/foo.ts",
      file: "~/dev/openscout/foo.ts",
    });
  });

  test("rejects other scout hosts", () => {
    expect(parseScoutCodeDeepLink("scout://terminal?session=x")).toBeNull();
    expect(parseScoutCodeDeepLink("scout://open")).toBeNull();
    expect(parseScoutCodeDeepLink("not-a-link")).toBeNull();
  });
});

describe("formatScoutCodeDeepLink", () => {
  test("formats project-relative links", () => {
    expect(formatScoutCodeDeepLink({
      project: "openscout",
      path: "packages/web/foo.ts",
      line: 12,
    })).toBe("scout://openscout/packages/web/foo.ts?line=12");
  });

  test("formats absolute file links", () => {
    expect(formatScoutCodeDeepLink({
      file: "/example/workstation-user/dev/openscout/foo.ts",
    })).toBe("scout:///example/workstation-user/dev/openscout/foo.ts");
  });

  test("round-trips project form", () => {
    const original = {
      project: "openscout",
      path: "a/b c/d.ts",
      wt: "comms",
      line: 4,
      endLine: 9,
    };
    expect(parseScoutCodeDeepLink(formatScoutCodeDeepLink(original))).toEqual(original);
  });
});

describe("matchRootForAbsolutePath", () => {
  const roots = [
    "/example/workstation-user/dev/openscout",
    "/example/workstation-user/dev/openscout-worktrees/comms",
    "/example/workstation-user/dev/talkie",
  ];

  test("picks the longest matching root", () => {
    expect(matchRootForAbsolutePath(
      "/example/workstation-user/dev/openscout-worktrees/comms/Sources/App.swift",
      roots,
    )).toEqual({
      root: "/example/workstation-user/dev/openscout-worktrees/comms",
      file: "/example/workstation-user/dev/openscout-worktrees/comms/Sources/App.swift",
    });
  });

  test("returns null file when the path is exactly a root", () => {
    expect(matchRootForAbsolutePath("/example/workstation-user/dev/talkie", roots)).toEqual({
      root: "/example/workstation-user/dev/talkie",
      file: null,
    });
  });

  test("returns null when no root matches", () => {
    expect(matchRootForAbsolutePath("/tmp/other", roots)).toBeNull();
  });
});
