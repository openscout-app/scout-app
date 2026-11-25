import { afterEach, describe, expect, mock, test } from "bun:test";

// @ts-expect-error Runtime path avoids the repository's React type-only alias.
const React = await import("../../node_modules/react/index.js");
// @ts-expect-error Runtime path avoids the repository's React type-only alias.
const ReactDOM = await import("../../node_modules/react-dom/client.js");
mock.module("react", () => React);
const { activeThreadDropTarget, useThreadDropTarget } = await import("./thread-drop-target.ts");

type Stage = (files: File[], verb?: string) => number;

const originals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(key: string, value: unknown) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
let root: ReturnType<typeof ReactDOM.createRoot> | undefined;

function mount() {
  // Null-rendering hook probes, with a minimal in-memory React DOM host.
  const win = Object.assign(new EventTarget(), { HTMLIFrameElement: class {} });
  const doc = Object.assign(new EventTarget(), { nodeType: 9, defaultView: win, activeElement: null, documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" } });
  const container = Object.assign(new EventTarget(), { nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, textContent: "" });
  globalValue("window", win); globalValue("document", doc); globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  root = ReactDOM.createRoot(container as unknown as Element);
}

function Thread({ stage }: { stage: Stage | null }) {
  useThreadDropTarget(stage);
  return null;
}

async function show(threads: Array<{ key: string; stage: Stage | null }>) {
  await React.act(async () => {
    root!.render(threads.map(({ key, stage }) => React.createElement(Thread, { key, stage })));
  });
}

afterEach(async () => {
  if (root) { await React.act(async () => root!.unmount()); root = undefined; }
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

describe("thread drop target", () => {
  const file = new File(["# a"], "a.md", { type: "text/markdown" });

  test("files go to the newest open thread, and back to the one under it when it closes", async () => {
    mount();
    const first: string[] = [];
    const second: string[] = [];
    const stageFirst: Stage = (files, verb) => (first.push(`${verb}:${files[0]?.name}`), files.length);
    const stageSecond: Stage = (files, verb) => (second.push(`${verb}:${files[0]?.name}`), files.length);

    expect(activeThreadDropTarget()).toBeNull();
    await show([{ key: "first", stage: stageFirst }]);
    await show([{ key: "first", stage: stageFirst }, { key: "second", stage: stageSecond }]);

    expect(activeThreadDropTarget()?.stage([file], "Dropped")).toBe(1);
    expect(second).toEqual(["Dropped:a.md"]);
    expect(first).toEqual([]);

    await show([{ key: "first", stage: stageFirst }]);
    expect(activeThreadDropTarget()?.stage([file], "Pasted")).toBe(1);
    expect(first).toEqual(["Pasted:a.md"]);

    await show([]);
    expect(activeThreadDropTarget()).toBeNull();
  });

  test("a thread that can't take files right now is not a target", async () => {
    mount();
    await show([{ key: "read-only", stage: null }]);
    expect(activeThreadDropTarget()).toBeNull();
  });

  test("a new stage function takes effect without re-registering", async () => {
    mount();
    const seen: string[] = [];
    await show([{ key: "t", stage: () => (seen.push("old"), 1) }]);
    await show([{ key: "t", stage: () => (seen.push("new"), 1) }]);

    activeThreadDropTarget()?.stage([file]);
    expect(seen).toEqual(["new"]);
  });
});
