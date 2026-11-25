import { afterEach, expect, mock, test } from "bun:test";
// @ts-expect-error Load the React runtime rather than type-only aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Load the React runtime rather than type-only aliases.
const ReactDOM = await import("../../../../node_modules/react-dom/client.js");
mock.module("react", () => React);
let loads: Array<(value: unknown) => void> = [];
let sends = 0;
mock.module("../../../lib/api.ts", () => ({
  api: (path: string) => path === "/api/feed/for-you"
    ? new Promise((resolve) => { loads.push(resolve); })
    : ++sends === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({}),
}));
mock.module("../../../lib/broker-refresh.ts", () => ({ useBrokerRefresh: () => {} }));
mock.module("../../../lib/operator-requests-store.ts", () => ({ refreshRequests: () => Promise.resolve(), receiveRequests: () => {}, settleRequests: () => {}, holdRequest: () => {}, releaseRequest: () => {} }));
const { useForYouCards } = await import("./use-for-you-cards.ts");
const { useOptionReply } = await import("./ForYouCard.tsx");
const originals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(key: string, value: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
let cards: ReturnType<typeof useForYouCards>;
let option: ReturnType<typeof useOptionReply>;
function Probe() {
  cards = useForYouCards();
  option = useOptionReply("conversation", "message");
  return null;
}
async function render() {
  await React.act(async () => { root!.render(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
}
async function mount() {
  const win = Object.assign(new EventTarget(), { HTMLIFrameElement: class {} });
  const doc = Object.assign(new EventTarget(), { nodeType: 9, defaultView: win, activeElement: null, documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" } });
  const container = Object.assign(new EventTarget(), { nodeType: 1, tagName: "DIV", nodeName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, textContent: "" });
  globalValue("window", win); globalValue("document", doc); globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  root = ReactDOM.createRoot(container as unknown as Element);
  await render();
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

test("StrictMode effect cleanup/setup restores liveness; unmount ignores late reads", async () => {
  loads = [];
  await mount();
  expect(loads.length).toBe(2);
  await React.act(async () => { loads[1]!({ cards: [{ id: "verified" }], pending: false }); });
  expect(cards.has("verified")).toBe(true);
  await React.act(async () => { root!.unmount(); });
  root = undefined;
  await React.act(async () => { loads[0]!({ cards: [{ id: "late" }], pending: false }); });
  expect(cards.has("late")).toBe(false);
});

test("failed option reply clears chosen and permits retry", async () => {
  sends = 0;
  await mount();
  await React.act(async () => { option.pick("SQLite"); });
  expect(option.status.at).toBe("failed");
  expect(option.chosen).toBeNull();
  await React.act(async () => { option.pick("SQLite"); });
  expect(sends).toBe(2);
  expect(option.status.at).toBe("done");
  expect(option.chosen).toBe("SQLite");
});

test("native question cards render runtime approval and denial, not option replies", async () => {
  // @ts-expect-error Load the server runtime rather than type-only aliases.
  const { renderToStaticMarkup } = await import("../../../../node_modules/react-dom/server.node.js");
  const { ForYouCardView } = await import("./ForYouCard.tsx");
  const { requestSource } = await import("../../../../server/feed/for-you/source.ts");
  const item = {
    id: "permission:q", actions: [
      { kind: "approve", label: "Allow once", value: "once" },
      { kind: "deny", label: "Deny", value: "deny" },
    ],
    permission: {
      requestId: "q", version: "v", sessionId: "s", projectRoot: "/project",
      native: { tool: "AskUserQuestion", display: { questions: [{ question: "Database?", options: [{ label: "SQLite" }, { label: "Postgres" }] }] } },
    },
  } as unknown as import("../../../../server/core/attention/operator-attention-state").OperatorAttentionItem;
  const source = requestSource(item);
  if (source.rules.kind === null) throw new Error("Expected typed native facts");
  const card: import("../../../../shared/api/for-you.ts").ForYouCard = {
    id: source.id, kind: source.rules.kind, facts: source.rules.facts, digest: null,
    digestState: "none", classifiedBy: "rules", answer: source.answer,
  };
  const row = { source: "request", item: item as unknown as import("../../../lib/types.ts").OperatorAttentionItem, agent: null, open: null, project: null } as unknown as import("./front-page-model.ts").HomeForYou;
  const html = renderToStaticMarkup(React.createElement(ForYouCardView, { card, row, agentCell: null, navigate: () => {} }));
  expect(html).toContain(">Allow<");
  expect(html).toContain(">Deny<");
  expect(html).toContain("SQLite");
  expect(html).not.toContain("data-options");
});
