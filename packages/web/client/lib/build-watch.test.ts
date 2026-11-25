import { describe, expect, test } from "bun:test";
import { entryAssets, isNewerBuild } from "./build-watch.ts";

const page = (entry: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script>`
  + `<link rel="modulepreload" href="/assets/vendor-aa.js"></head><body><div id="root"></div></body></html>`;

describe("build watch", () => {
  test("reads the hashed module entry and ignores dev entries and plain scripts", () => {
    expect(entryAssets(page("/assets/index-Abc123.js"))).toEqual(["/assets/index-Abc123.js"]);
    expect(entryAssets(page("/src/main.tsx"))).toEqual([]);
    expect(entryAssets(`<script src="/assets/legacy-1.js"></script>`)).toEqual([]);
    expect(entryAssets(`<script type=module src="http://127.0.0.1:43120/assets/index-Z.js?v=1">`)).toEqual(["/assets/index-Z.js"]);
  });

  test("a stylesheet-only rebuild still changes the asset list", () => {
    const html = (css: string) => `<script type="module" src="/assets/main-A.js"></script><link rel="stylesheet" crossorigin href="${css}">`;
    expect(entryAssets(html("/assets/main-1.css"))).toEqual(["/assets/main-A.js", "/assets/main-1.css"]);
    expect(isNewerBuild(entryAssets(html("/assets/main-1.css")), entryAssets(html("/assets/main-2.css")))).toBe(true);
    expect(entryAssets(`<link rel="icon" href="/favicon.svg"><link rel="modulepreload" href="/assets/v-1.js">`)).toEqual([]);
  });

  test("a different served entry is a newer build; the same, or nothing to compare, is not", () => {
    expect(isNewerBuild(["/assets/index-A.js"], ["/assets/index-B.js"])).toBe(true);
    expect(isNewerBuild(["/assets/index-A.js"], ["/assets/index-A.js"])).toBe(false);
    expect(isNewerBuild([], ["/assets/index-B.js"])).toBe(false);
    expect(isNewerBuild(["/assets/index-A.js"], [])).toBe(false);
  });
});
