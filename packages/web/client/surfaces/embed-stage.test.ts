import { describe, expect, test } from "bun:test";
import { nextEmbedStagePath } from "./embed-stage.ts";

const surfacePaths = new Set(["/embed/home", "/embed/search", "/embed/ops", "/embed/world"]);
const isSurfacePath = (pathname: string) => surfacePaths.has(pathname);

describe("embed stage path", () => {
  test("a different surface path takes over the document", () => {
    expect(nextEmbedStagePath("/embed/home", "/embed/search", isSurfacePath)).toBe("/embed/search");
  });

  test("two paths of one surface still switch, so Ops and Overview each mount fresh", () => {
    expect(nextEmbedStagePath("/embed/ops", "/embed/world", isSurfacePath)).toBe("/embed/world");
  });

  test("a full-app route handed off by the surface keeps it up", () => {
    expect(nextEmbedStagePath("/embed/home", "/sessions/abc", isSurfacePath)).toBe("/embed/home");
  });

  test("the same path changes nothing", () => {
    expect(nextEmbedStagePath("/embed/home", "/embed/home", isSurfacePath)).toBe("/embed/home");
  });
});
