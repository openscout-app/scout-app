import { afterEach, expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the React type-only alias.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the React type-only alias.
const ReactDOM = await import("../../../../node_modules/react-dom/client.js");
mock.module("react", () => React);
const { useReplyDraft } = await import("./TapInPanel.tsx");
const originals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
let value: ReturnType<typeof useReplyDraft>;
let saved = "";
function Probe({ settlement }: { settlement: number }) {
  value = useReplyDraft("first reply", (text) => { saved = text; }, settlement);
  return null;
}
async function render(settlement: number) {
  await React.act(async () => { root!.render(React.createElement(Probe, { settlement })); });
}
async function mount() {
  const win = Object.assign(new EventTarget(), { HTMLIFrameElement: class {} });
  const doc = Object.assign(new EventTarget(), { nodeType: 9, defaultView: win, activeElement: null, documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" } });
  const container = Object.assign(new EventTarget(), { nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, textContent: "" });
  globalValue("window", win); globalValue("document", doc); globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  root = ReactDOM.createRoot(container as unknown as Element);
  await render(0);
  await React.act(async () => { value.setHeld("first reply"); });
}
afterEach(async () => {
  if (root) await React.act(async () => { root!.unmount(); });
  root = undefined;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});
test("prompt closure releases an unconfirmed draft and its persisted figure copy", async () => {
  await mount();
  await render(1);
  expect(value.held).toBeNull(); expect(value.draft).toBe(""); expect(saved).toBe("");
});
test("prompt closure releases the lock without erasing a later edit", async () => {
  await mount();
  await React.act(async () => { value.setDraft("a later edit"); });
  await render(1);
  expect(value.held).toBeNull(); expect(value.draft).toBe("a later edit"); expect(saved).toBe("a later edit");
});
test("an unconfirmed result arriving after closure is settled too", async () => {
  await mount(); await render(1);
  await React.act(async () => { value.setDraft("first reply"); value.setHeld("first reply", 0); });
  expect(value.held).toBeNull(); expect(value.draft).toBe("");
});

test("historical prompt A closure does not settle an unrelated unconfirmed send B", async () => {
  await mount(); await render(1);
  await React.act(async () => { value.setDraft("unrelated B"); value.setHeld("unrelated B", 1); });
  expect(value.held).toBe("unrelated B"); expect(value.draft).toBe("unrelated B");
  await render(1);
  expect(value.held).toBe("unrelated B");
});
