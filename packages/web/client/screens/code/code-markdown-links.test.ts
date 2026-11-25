import { describe, expect, test } from "bun:test";
import { fenceExtension, rawFileUrlFor, resolveMarkdownTarget } from "./code-markdown-links.ts";

describe("links and images in a Markdown file", () => {
  const file = "/repo/docs/guide/README.md";

  test("a relative path resolves from the file's folder", () => {
    expect(resolveMarkdownTarget(file, "setup.md")).toEqual({ kind: "file", path: "/repo/docs/guide/setup.md" });
    expect(resolveMarkdownTarget(file, "./img/shot.png")).toEqual({ kind: "file", path: "/repo/docs/guide/img/shot.png" });
    expect(resolveMarkdownTarget(file, "../../AGENTS.md#rules")).toEqual({ kind: "file", path: "/repo/AGENTS.md" });
    expect(resolveMarkdownTarget(file, "my%20notes.md")).toEqual({ kind: "file", path: "/repo/docs/guide/my notes.md" });
  });

  test("anchors stay on the page and schemes open outside", () => {
    expect(resolveMarkdownTarget(file, "#install")).toEqual({ kind: "anchor" });
    expect(resolveMarkdownTarget(file, "https://example.com/x.png")).toEqual({ kind: "external" });
    expect(resolveMarkdownTarget(file, "mailto:someone@example.com")).toEqual({ kind: "external" });
    expect(resolveMarkdownTarget(file, "//cdn.example.com/a.png")).toEqual({ kind: "external" });
  });

  test("an image loads from the raw route, encoded per segment", () => {
    expect(rawFileUrlFor("/repo/docs/my shot.png")).toBe("/api/file/raw/repo/docs/my%20shot.png");
  });

  test("fence names map to a grammar the reader knows", () => {
    expect(fenceExtension("TypeScript")).toBe("ts");
    expect(fenceExtension("bash")).toBe("bash");
    expect(fenceExtension("swift")).toBe("swift");
  });
});
