import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { builtAssets, isNewerBuild, loadedAssets, pageLooksIdle, watchCompanionBuild } from "./companion-build.ts";

const page = (entry: string, chunk: string, css: string) => `<!doctype html>
<html><head>
  <script src="/api/bootstrap.js"></script>
  <script type="module" crossorigin src="/assets/${entry}.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/${chunk}.js">
  <link rel="stylesheet" crossorigin href="/assets/${css}.css">
</head><body><div id="root"></div></body></html>`;

const OLD = page("companion-Cx72mi1X", "companion-host-LDhaiF_F", "companion-n5BWBp4W");
const NEW = page("companion-B_F2V0fs", "companion-host-LDhaiF_F", "companion-n5BWBp4W");
const DEV = `<script src="/api/bootstrap.js"></script><script type="module" src="/companion/main.tsx"></script>`;

/** A document reduced to what the watch reads. */
function fakeDoc(refs: string[], busy: string[] = [], active: { tagName?: string; isContentEditable?: boolean } | null = null) {
  return {
    querySelectorAll: () => refs.map((ref) => ({
      getAttribute: (name: string) => (name === (ref.endsWith(".css") ? "href" : "src") ? ref : null),
    })) as unknown as NodeListOf<Element>,
    querySelector: (selector: string) => (busy.some((b) => selector.split(", ").includes(b)) ? {} : null),
    activeElement: active,
  };
}

const OLD_REFS = ["/api/bootstrap.js", "/assets/companion-Cx72mi1X.js", "http://127.0.0.1:43120/assets/companion-host-LDhaiF_F.js", "/assets/companion-n5BWBp4W.css"];

describe("which build a companion page belongs to", () => {
  test("a served page names its entry, preloads and styles", () => {
    expect(builtAssets(OLD)).toEqual([
      "/assets/companion-Cx72mi1X.js",
      "/assets/companion-host-LDhaiF_F.js",
      "/assets/companion-n5BWBp4W.css",
    ]);
    expect(builtAssets(DEV)).toEqual([]);
  });

  test("the document's own assets are read by path, whatever origin they carry", () => {
    expect([...loadedAssets(fakeDoc(OLD_REFS))]).toEqual([
      "/assets/companion-Cx72mi1X.js",
      "/assets/companion-host-LDhaiF_F.js",
      "/assets/companion-n5BWBp4W.css",
    ]);
  });

  test("a new entry is a newer build; the same page, or one with more lazy preloads, is not", () => {
    const loaded = loadedAssets(fakeDoc(OLD_REFS));
    expect(isNewerBuild(builtAssets(NEW), loaded)).toBe(true);
    expect(isNewerBuild(builtAssets(OLD), loaded)).toBe(false);
    loaded.add("/assets/FigureTalk-Q1w2e3r4.js");
    expect(isNewerBuild(builtAssets(OLD), loaded)).toBe(false);
  });

  test("the dev server or an error page never counts", () => {
    expect(isNewerBuild(builtAssets(DEV), loadedAssets(fakeDoc(OLD_REFS)))).toBe(false);
    expect(isNewerBuild(builtAssets(NEW), loadedAssets(fakeDoc(["/companion/main.tsx"])))).toBe(false);
    expect(isNewerBuild(builtAssets("<h1>502</h1>"), loadedAssets(fakeDoc(OLD_REFS)))).toBe(false);
  });
});

describe("when the companion page may reload", () => {
  test("not while a card, menu, summary, held or pointed figure is on screen", () => {
    expect(pageLooksIdle(fakeDoc([]))).toBe(true);
    for (const busy of [".ce-placed.is-open", ".ce-placed.is-dragging", ".ce-placed.is-pointed", '[data-hit^="popover"]', '[data-hit="figure-menu"]', '[data-hit^="hover:"]']) {
      expect(pageLooksIdle(fakeDoc([], [busy]))).toBe(false);
    }
  });

  test("not while a field has focus", () => {
    expect(pageLooksIdle(fakeDoc([], [], { tagName: "BODY" }))).toBe(true);
    expect(pageLooksIdle(fakeDoc([], [], { tagName: "TEXTAREA" }))).toBe(false);
    expect(pageLooksIdle(fakeDoc([], [], { tagName: "input" }))).toBe(false);
    expect(pageLooksIdle(fakeDoc([], [], { tagName: "DIV", isContentEditable: true }))).toBe(false);
  });
});

describe("following the served build", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
  let stops: Array<() => void> = [];
  beforeEach(() => { stops = []; });
  afterEach(() => { for (const stop of stops) stop(); });

  function memory() {
    const kept = new Map<string, string>();
    return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  }

  test("the same build: no reload", async () => {
    let reloads = 0;
    stops.push(watchCompanionBuild({ doc: fakeDoc(OLD_REFS), readServed: async () => OLD, reload: () => { reloads += 1; }, checkEveryMs: 5, memory: memory() }));
    await tick();
    expect(reloads).toBe(0);
  });

  test("a newer build reloads once the page is idle", async () => {
    let reloads = 0;
    let busy = true;
    stops.push(watchCompanionBuild({
      doc: fakeDoc(OLD_REFS), readServed: async () => NEW, reload: () => { reloads += 1; },
      isBusy: () => busy, checkEveryMs: 5, idleEveryMs: 5, memory: memory(),
    }));
    await tick();
    expect(reloads).toBe(0);
    busy = false;
    await tick();
    expect(reloads).toBe(1);
    await tick();
    expect(reloads).toBe(1);
  });

  test("a build this page already reloaded for is not reloaded for again", async () => {
    const kept = memory();
    let reloads = 0;
    stops.push(watchCompanionBuild({ doc: fakeDoc(OLD_REFS), readServed: async () => NEW, reload: () => { reloads += 1; }, checkEveryMs: 5, memory: kept }));
    await tick();
    expect(reloads).toBe(1);
    stops.push(watchCompanionBuild({ doc: fakeDoc(OLD_REFS), readServed: async () => NEW, reload: () => { reloads += 1; }, checkEveryMs: 5, memory: kept }));
    await tick();
    expect(reloads).toBe(1);
  });

  test("an unreadable served page changes nothing", async () => {
    let reloads = 0;
    stops.push(watchCompanionBuild({ doc: fakeDoc(OLD_REFS), readServed: async () => null, reload: () => { reloads += 1; }, checkEveryMs: 5, memory: memory() }));
    await tick();
    expect(reloads).toBe(0);
  });
});
