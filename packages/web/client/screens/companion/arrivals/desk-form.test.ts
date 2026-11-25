import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../../node_modules/react/index.js");
mock.module("react", () => React);
const { formOf, getDefaultDeskForm, getDeskForms, prune, setDefaultDeskForm, setDeskForm } = await import("./desk-form.ts");

type Store = typeof import("./desk-form.ts");
let loads = 0;
/** The store as a fresh page load reads it: its own module, so nothing cached. */
const reload = async () => (await import(`./desk-form.ts?load=${++loads}`)) as Store;

/** A page's localStorage, for as long as `run` takes. */
async function withStorage(seed: Record<string, string>, run: (storage: Map<string, string>) => Promise<void>): Promise<void> {
  const storage = new Map(Object.entries(seed));
  const scope = globalThis as { window?: unknown };
  const before = scope.window;
  scope.window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    },
  };
  try {
    await run(storage);
  } finally {
    if (before === undefined) delete scope.window;
    else scope.window = before;
  }
}

// No window here: every storage read and write throws, and the store still holds the choice.
test("the store: strip by default, a pick per pin, cleared, pruned, and the default", () => {
  expect(getDefaultDeskForm()).toBe("strip");
  expect(formOf("a")).toBe("strip");
  setDeskForm("a", "figure");
  setDeskForm("b", "figure");
  expect(formOf("a")).toBe("figure");
  setDeskForm("a", null);
  expect(formOf("a")).toBe("strip");
  prune(["c"]);
  expect(getDeskForms()).toEqual({});
  setDefaultDeskForm("figure");
  expect(formOf("a")).toBe("figure");
  setDeskForm("a", "strip");
  expect(formOf("a")).toBe("strip");
  setDefaultDeskForm("strip");
  setDeskForm("a", null);
});

test("picks and the default are kept in page storage and read back on the next load", async () => {
  await withStorage({}, async (storage) => {
    const page = await reload();
    page.setDeskForm("a", "figure");
    page.setDefaultDeskForm("figure");
    expect(JSON.parse(storage.get("scout:companion:desk-forms-v2")!)).toEqual({ a: "figure" });
    expect(storage.get("scout:companion:desk-form")).toBe("figure");

    const next = await reload();
    expect(next.getDeskForms()).toEqual({ a: "figure" });
    expect(next.getDefaultDeskForm()).toBe("figure");
    expect(next.formOf("b")).toBe("figure");
  });
});

test("an agent on the desk keeps the form it landed as across a new default and a reload", async () => {
  await withStorage({}, async (storage) => {
    const page = await reload();
    page.land(["a"]);
    page.setDefaultDeskForm("figure");
    expect(page.formOf("a")).toBe("strip");
    expect(page.formOf("b")).toBe("figure");
    page.prune(["b"]);
    expect(JSON.parse(storage.get("scout:companion:desk-forms-landed")!)).toEqual({});
    page.land(["b"]);
    const next = await reload();
    expect(next.getLandedDeskForms()).toEqual({ b: "figure" });
    // A landing is not a pick of its own: the agent's picks stay empty.
    expect(next.getDeskForms()).toEqual({});
  });
});

test("a project pick reaches its agents already on the desk; this agent's own pick still wins", async () => {
  await withStorage({}, async () => {
    const page = await reload();
    page.land(["a", "b"]);
    page.setDeskForm("b", "strip");
    page.setProjectDeskForm("openscout", "figure");
    expect(page.formOf("a", "openscout")).toBe("figure");
    expect(page.formOf("b", "openscout")).toBe("strip");
    expect(page.formOf("a", "hudson")).toBe("strip");
    page.setProjectDeskForm("openscout", null);
    expect(page.formOf("a", "openscout")).toBe("strip");
  });
});

test("unreadable storage reads as no picks and the strip default", async () => {
  await withStorage({ "scout:companion:desk-forms-v2": "{not json", "scout:companion:desk-form": "banner" }, async () => {
    const page = await reload();
    expect(page.getDeskForms()).toEqual({});
    expect(page.getDefaultDeskForm()).toBe("strip");
  });
});

test("picks kept before the strip default are left behind, so every agent starts over as a strip", async () => {
  await withStorage({ "scout:companion:desk-forms": JSON.stringify({ a: "figure" }) }, async () => {
    const page = await reload();
    expect(page.getDeskForms()).toEqual({});
    expect(page.formOf("a")).toBe("strip");
  });
});
