import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedCapabilitiesProvider, FeedItem, FeedStream, type FeedCapabilities } from "./index.ts";
import type { FeedPostHead, FeedResponse } from "../../../shared/api/feed.ts";

const post: FeedPostHead = {
  id: "review-1", version: 1, day: "2026-11-16", at: 1794830400000,
  class: "for_you", state: "review", title: "Fix the sidebar", caption: "It fits now.",
  writtenBy: "reply", line: null, reviewed: false, selected: true, score: 1,
  agent: { name: "Ada", harness: "codex" }, others: 0, thread: null,
  lead: { kind: "text", ref: null }, change: null, joined: [],
  prs: [{ key: "o/r#1", label: "#1", title: "Fix the sidebar", url: "https://github.com/o/r/pull/1", state: "open" }],
  prCount: 1, forYou: { reason: "attention", label: "Review this" }, backToYou: true, updates: 0,
  workId: "work/1", conversationId: "chat/1", owner: { agentId: "ada", sessionId: "turn/1", cwd: null },
  study: null, project: null,
};

const response: FeedResponse = {
  version: 1, generatedAt: post.at, view: "all", full: true, posts: [post], removed: [],
  days: [{ day: post.day, at: post.at, ids: [post.id], folded: [] }],
  cursor: null, size: { posts: 1, days: 1, reviewed: 0 }, home: null, views: ["all"],
};

test("one FeedStream switches between read-only and full actions without a rebuild", async () => {
  const window = new Window({ url: "https://example.test/embed/feed" });
  const sockets: Socket[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    readonly closed = Promise.withResolvers<void>();
    constructor(readonly url: string) {
      super();
      sockets.push(this);
      setTimeout(() => {
        this.readyState = Socket.OPEN;
        this.dispatchEvent(new Event("open"));
      }, 0);
    }
    send() {}
    close() {
      this.readyState = Socket.CLOSED;
      this.dispatchEvent(new Event("close"));
      this.closed.resolve();
    }
  }
  const globals = {
    window, document: window.document, location: window.location, WebSocket: Socket,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: Parameters<typeof fetch>[0]) => String(input).startsWith("/api/feed?")
      ? Response.json(response)
      : new Response(null, { status: 404 }),
  };
  const restoreGlobals = Object.keys(globals).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    return () => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
  });
  let unmount: (() => void) | undefined;
  try {
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(window.document.body as unknown as HTMLElement);
    unmount = () => root.unmount();
    const navigate = () => {};
    const draw = (capabilities: Partial<FeedCapabilities>) => act(async () => {
      root.render(<FeedStream sources={null} navigate={navigate} capabilities={capabilities} />);
    });
    const buttons = () => [...window.document.querySelectorAll(".fd-moves button")].map(node => node.textContent);

    await draw({ readOnly: true });
    const chat = window.document.querySelector('a[href="/c/chat%2F1?workId=work%2F1"]');
    expect(chat?.textContent).toBe("Open in Chat");
    expect(buttons()).toEqual([]);
    expect(window.document.querySelector(".fd-handoff a")?.textContent).toBe("Get Scout ↗");
    expect(sockets).toHaveLength(0);

    await draw({ readOnly: false });
    expect(buttons()).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Continue/), expect.stringMatching(/^Ship it/), expect.stringMatching(/^Hide/),
    ]));
    expect(window.document.querySelector('a[href="/sessions/turn%2F1"]')?.textContent).toBe("Session");
    expect(window.document.querySelector(".fd-handoff")).toBeNull();
    expect(sockets.map(socket => socket.url)).toEqual(["wss://example.test/ws/events"]);

    await draw({ readOnly: true, handoff: { label: "Open the app", href: "/get-app", detail: "Continue there." } });
    expect(buttons()).toEqual([]);
    expect(window.document.querySelector(".fd-handoff a")?.getAttribute("href")).toBe("/get-app");
    expect(window.document.querySelector(".fd-handoff span")?.textContent).toBe("Continue there.");
    expect(window.document.querySelector(".fd-handoff a")?.textContent).toBe("Open the app");
    await sockets[0]!.closed.promise;
    expect(sockets[0]?.readyState).toBe(Socket.CLOSED);

    await draw({ readOnly: true, handoff: null });
    expect(window.document.querySelector(".fd-handoff")).toBeNull();
  } finally {
    await act(async () => unmount?.());
    await window.happyDOM.close();
    for (const restore of restoreGlobals) restore();
  }
});

test("a standalone FeedItem inherits its provider and a closer override wins", () => {
  const item = <FeedItem post={post} navigate={() => {}} />;
  const html = renderToStaticMarkup(
    <FeedCapabilitiesProvider capabilities={{ readOnly: true }}>
      <section>{item}</section>
      <FeedCapabilitiesProvider capabilities={{ readOnly: false }}>{item}</FeedCapabilitiesProvider>
    </FeedCapabilitiesProvider>,
  );
  expect(html.match(/Open in Chat/g)).toHaveLength(1);
  expect(html.match(/>Continue/g)).toHaveLength(1);
  expect(html.match(/>Ship it/g)).toHaveLength(1);
  expect(html.match(/>Hide/g)).toHaveLength(1);
});
