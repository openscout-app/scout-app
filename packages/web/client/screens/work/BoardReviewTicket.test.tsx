import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { BoardReviewTicketRecord } from "./BoardReviewTicket.tsx";
// @ts-expect-error Runtime path avoids the repository's React type-only alias.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Runtime path avoids the repository's React type-only alias.
const ReactDOM = await import("../../../node_modules/react-dom/client.js");
mock.module("react", () => React);
const { useBoardReviewTicket } = await import("./BoardReviewTicket.tsx");

const workId = "work-manual-review-one";
const pending: BoardReviewTicketRecord = {
  workId, state: "review", acceptanceState: "pending",
  input: { source: "board", id: "task-a", version: "4" },
  artifact: { kind: "git", ref: "/projects/example", revision: "df4270cb41ba87f5bd7193484afb33769b73d715" },
  routine: { id: "reviewer", version: 2 },
  target: { kind: "project_path", projectPath: "/projects/example", harness: "codex" },
};
const base = "/api/manual-review/board-tickets/";
const originals = new Map<string, PropertyDescriptor | undefined>();
let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
let value: ReturnType<typeof useBoardReviewTicket>;
let tick: () => void;
let intervalSpy: ReturnType<typeof spyOn> | undefined;
let clearSpy: ReturnType<typeof spyOn> | undefined;

function globalValue(key: string, replacement: unknown) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: replacement });
}

function mount(fetcher: (input: string, init?: RequestInit) => Promise<Response> | Response) {
  const win = Object.assign(new EventTarget(), { HTMLIFrameElement: class {} });
  const doc = Object.assign(new EventTarget(), { nodeType: 9, defaultView: win, activeElement: null,
    visibilityState: "visible", documentElement: { namespaceURI: "http://www.w3.org/1999/xhtml" } });
  const container = Object.assign(new EventTarget(), { nodeType: 1, tagName: "DIV", nodeName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, textContent: "" });
  globalValue("window", win);
  globalValue("document", doc);
  globalValue("IS_REACT_ACT_ENVIRONMENT", true);
  globalValue("fetch", fetcher);
  intervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
    tick = callback;
    return 123;
  }) as typeof setInterval);
  clearSpy = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  root = ReactDOM.createRoot(container as unknown as Element);
}

function Probe({ id }: { id: string }) {
  value = useBoardReviewTicket(id);
  return null;
}

async function step(action: () => void) {
  await React.act(async () => {
    action();
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

const render = (id: string) => step(() => root!.render(React.createElement(Probe, { id })));

afterEach(async () => {
  if (root) await React.act(async () => root!.unmount());
  root = undefined;
  intervalSpy?.mockRestore();
  clearSpy?.mockRestore();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

test("polls until review; explicitly accepts once, and does not assume a lost response succeeded", async () => {
  let next = { ...pending, state: "waiting" };
  let losePost!: (reason: Error) => void;
  const requests: string[] = [];
  mount((path, init) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/accept")) {
      expect(init?.body).toBeUndefined();
      return new Promise<Response>((_, reject) => { losePost = reject; });
    }
    return Response.json(next);
  });
  await render(workId);
  expect(value.canAccept).toBe(false);
  await step(value.accept);
  next = pending;
  await step(tick);
  expect(value.canAccept).toBe(true);
  await step(() => { value.accept(); value.accept(); });
  expect(value.saving).toBe(true);
  expect(value.ticket?.acceptanceState).toBe("pending");
  next = { ...pending, state: "done", acceptanceState: "accepted" };
  await step(() => losePost(new Error("response lost")));
  expect(value.ticket).toEqual(next);
  expect(value.canAccept).toBe(false);
  expect(clearSpy).toHaveBeenCalledWith(123);
  await step(tick);
  expect(requests).toEqual([
    `GET ${base}${workId}`, `GET ${base}${workId}`, `POST ${base}${workId}/accept`, `GET ${base}${workId}`,
  ]);
});

test("ignores an old work read, retries read errors, and hides the section on 404", async () => {
  let finishOld!: (response: Response) => void;
  const other = "work-manual-review-two";
  let calls = 0;
  mount(path => {
    calls++;
    if (path === base + workId) return new Promise<Response>(resolve => { finishOld = resolve; });
    return new Response(null, { status: calls === 2 ? 503 : 404 });
  });
  await render("ordinary-work");
  expect(calls).toBe(0);
  await render(workId);
  await render(other);
  expect(value.error).toBeTruthy();
  await step(() => finishOld(Response.json(pending)));
  expect(value.ticket).toBeNull();
  await step(value.refresh);
  expect(value.hidden).toBe(true);
  await step(tick);
  expect(calls).toBe(3);
});

test("keeps the definitive conflict reason and stops refreshing after a forbidden read", async () => {
  let forbidden = false;
  let calls = 0;
  const reason = "The reviewer has not submitted a result for this ticket.";
  mount((path) => {
    calls++;
    if (path.endsWith("/accept")) return Response.json({ code: "board_review_not_ready", error: reason }, { status: 409 });
    if (forbidden) return Response.json({ error: "operator_only", detail: "Open this ticket on the connected host." }, { status: 403 });
    return Response.json(pending);
  });
  await render(workId);
  await step(value.accept);
  expect(value.notice).toBe(reason);
  forbidden = true;
  await step(tick);
  expect(value.error).toBe("Open this ticket on the connected host.");
  expect(value.canAccept).toBe(false);
  expect(clearSpy).toHaveBeenCalledWith(123);
  await step(tick);
  expect(calls).toBe(4);
});
