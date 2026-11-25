import { afterEach, expect, mock, test } from "bun:test";
import { hostFleet } from "../../lib/hosts/host-fleet.ts";
// @ts-expect-error Runtime paths bypass the React type-only alias.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Runtime paths bypass the React type-only alias.
const JSX = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Runtime paths bypass the React type-only alias.
const ReactDOM = await import("../../../node_modules/react-dom/client.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => JSX);
const { BoardTaskReview } = await import("./BoardTaskReview.tsx");

// Minimal DOM host: React renders real elements; invoking the rendered button
// handler keeps this focused on component behavior rather than DOM delegation.
class ElementHost extends EventTarget {
  nodeType = 1;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  ownerDocument = doc;
  children: ElementHost[] = [];
  value = "";
  disabled = false;
  style = {};
  text = "";
  constructor(readonly nodeName: string) { super(); }
  get tagName() { return this.nodeName; }
  appendChild(node: ElementHost) { this.children.push(node); return node; }
  removeChild(node: ElementHost) { this.children = this.children.filter(child => child !== node); }
  insertBefore(node: ElementHost, before: ElementHost) { this.children.splice(this.children.indexOf(before), 0, node); }
  setAttribute(key: string) { if (key === "disabled") this.disabled = true; }
  removeAttribute(key: string) { if (key === "disabled") this.disabled = false; }
  set textContent(value: string) { this.text = value; this.children = []; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
  get options() { return this.children; }
}
const win = Object.assign(new EventTarget(), { HTMLIFrameElement: class {} });
const doc = Object.assign(new EventTarget(), {
  nodeType: 9, defaultView: win, activeElement: null, documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" },
  createElement: (tag: string) => new ElementHost(tag.toUpperCase()),
  createTextNode: (text: string) => Object.assign(new ElementHost("#text"), { nodeType: 3, text }),
});
const originals = new Map<string, PropertyDescriptor | undefined>();
let container: ElementHost;
let root: ReturnType<typeof ReactDOM.createRoot>;
let refusal: { error: string; code: string };
const posted: string[] = [];
const routine = { id: "reviewer", name: "Code review", version: 1, projectPath: "/repo", harness: "codex", enabled: true, connectionId: "fixture", channel: "work" };

function globalValue(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

async function step(action: () => void) {
  await React.act(async () => {
    action();
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

function elements(node: ElementHost): ElementHost[] {
  return [node, ...node.children.flatMap(elements)];
}

function button(label: string) {
  return elements(container).find(node => node.nodeName === "BUTTON" && node.textContent === label);
}

async function click(label: string) {
  const node = button(label)!;
  expect(node).toBeDefined();
  expect(node.disabled).toBe(false);
  const key = Object.keys(node).find(k => k.startsWith("__reactProps$"))!;
  await step(() => (Reflect.get(node, key) as { onClick: () => void }).onClick());
}

const render = (key = "first") => step(() => root.render(React.createElement(BoardTaskReview, {
  key, connectionId: "fixture", channel: "work", itemId: "task", snapshot: "snapshot", roomStale: false, hostId: "local",
})));

afterEach(async () => {
  await step(() => root.unmount());
  hostFleet.focus("local");
  hostFleet.forget("other");
  posted.length = 0;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("real task panel handles stale pins, refusal, uncertain dispatch, reload, and host change", async () => {
  const storage = new Map<string, string>();
  globalValue("window", Object.assign(win, { localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) } }));
  globalValue("document", doc);
  globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  globalValue("fetch", async (path: string, init?: RequestInit) => {
    if (path.includes("/board-routines")) return Response.json({ routines: [routine] });
    if (path.endsWith("/board-preview")) return Response.json({
      routine, input: { source: "board", id: "task", version: "3" },
      artifact: { kind: "git", ref: "/repo", revision: "commit" },
    });
    if (path.endsWith("/board-runs")) {
      posted.push(JSON.parse(String(init?.body)).requestId);
      return Response.json(refusal, { status: 409 });
    }
    if (path.includes("/occurrences")) return Response.json({ error: "Not found" }, { status: 404 });
    throw new Error(`Unexpected request: ${path}`);
  });
  container = new ElementHost("DIV");
  root = ReactDOM.createRoot(container as unknown as Element);
  await render();
  refusal = { code: "manual_review_preview_changed", error: "The Board item changed after the preview." };
  await click("Preview");
  await click("Run now");
  expect(container.textContent).toContain(refusal.error);
  expect(button("Run now")?.disabled).toBe(true);
  expect(button("Check run")).toBeUndefined();

  refusal = { code: "manual_review_dispatch_refused", error: "The reviewer could not start." };
  await click("Preview");
  await click("Run now");
  expect(posted[1]).toBe(posted[0]);
  expect(button("Check run")).toBeUndefined();

  refusal = { code: "manual_review_dispatch_unknown", error: "The result of dispatch is unknown." };
  await click("Preview");
  await click("Run now");
  expect(posted[2]).not.toBe(posted[1]);
  await click("Check run");
  expect(container.textContent).toContain("same request ID");
  await render("reload");
  await click("Preview");
  await click("Retry run");
  expect(posted[3]).toBe(posted[2]);

  await click("Preview");
  hostFleet.add({ id: "other", label: "Other host", fetch: () => { throw new Error("Wrong host"); }, eventSource: () => { throw new Error("Wrong host"); } });
  hostFleet.focus("other");
  await click("Retry run");
  expect(container.textContent).toContain("The active host changed");
  expect(posted).toHaveLength(4);
});
