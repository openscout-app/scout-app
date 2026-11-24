import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FeedResponse } from "../../shared/api/feed.ts";
import { NativeAreaScreen, scoutSurface } from "../screens/feed/NativeAreaScreen.tsx";
import { AppShell } from "./AppShell.tsx";
import { CONNECT_COMMAND, FeedEmptyState } from "./FeedEmptyState.tsx";
import { isShellPath, resolveShellRoute } from "./routes.ts";
import { RuntimeContext, readRuntimeInfo, statusFromResponse } from "./runtime.ts";
import { ScoutApp } from "./ScoutApp.tsx";
import { SCOUT_SURFACES } from "./surfaces.tsx";

const at = (path: string) => resolveShellRoute(new URL(path, "http://127.0.0.1:4173"));

describe("surface contract", () => {
  test("the shell registers Feed, Chat, Sessions, Board and Control, and only Feed is live", () => {
    expect(SCOUT_SURFACES.map(s => s.id)).toEqual(["feed", "chat", "sessions", "board", "control"]);
    expect(SCOUT_SURFACES.filter(s => s.status === "live").map(s => s.id)).toEqual(["feed"]);
    for (const surface of SCOUT_SURFACES) {
      expect(surface.route).toBe(`/${surface.id}`);
      expect(surface.description.length).toBeGreaterThan(0);
      expect(Boolean(surface.Component)).toBe(surface.status === "live");
    }
    // The registry and the Feed's own embed description name the same route.
    expect(SCOUT_SURFACES[0]!.embed).toEqual({ path: scoutSurface.embed.path, profile: scoutSurface.embed.profile });
  });

  test("/ and each surface route open the app; /embed/feed is the embed", () => {
    expect(at("/")).toEqual({ mode: "app", surface: "feed", view: "surface" });
    expect(at("/feed")).toEqual({ mode: "app", surface: "feed", view: "surface" });
    expect(at("/embed/feed")).toEqual({ mode: "embed", surface: "feed", view: "surface" });
    expect(at("/board")).toEqual({ mode: "app", surface: "board", view: "surface" });
    expect(at("/c/chat%2Fone?workId=w%261")).toEqual({ mode: "app", surface: "feed", view: "conversation", conversationId: "chat/one", workId: "w&1" });
    expect(at("/sessions/s%3Acodex%3Aturn")).toEqual({ mode: "app", surface: "feed", view: "session", sessionId: "s:codex:turn" });
    for (const path of ["/missing", "/embed/chat", "/feed/extra", "/sessions/a/b", "/c/%E0"]) expect(isShellPath(path)).toBe(false);
  });
});

describe("AppShell", () => {
  test("embed mode is exactly the documented mount: the theme wrapper and the surface, no chrome", () => {
    const navigate = () => {};
    const html = renderToStaticMarkup(<AppShell mode="embed" active="feed"><NativeAreaScreen navigate={navigate} /></AppShell>);
    expect(html).toBe(`<div class="scout-feed-embed" data-scout-theme="light">${renderToStaticMarkup(<NativeAreaScreen navigate={navigate} />)}</div>`);
    expect(html).not.toMatch(/<nav|<main|app-rail|Arriving next/);
  });

  test("app mode draws the rail: wordmark, runtime, all five surfaces with the current one marked", () => {
    const html = renderToStaticMarkup(<AppShell mode="app" active="feed"><p>content</p></AppShell>);
    expect(html).toContain('<nav class="app-rail" aria-label="Scout App">');
    expect(html).toContain(">Scout</a>");
    expect(html).toContain('class="app-runtime" data-status="connecting"');
    const links = [...html.matchAll(/<a class="app-surface" href="([^"]+)" data-status="(\w+)"( aria-current="page")?/g)];
    expect(links.map(m => [m[1], m[2], Boolean(m[3])])).toEqual([
      ["/feed", "live", true], ["/chat", "planned", false], ["/sessions", "planned", false],
      ["/board", "planned", false], ["/control", "planned", false],
    ]);
    expect(html.match(/aria-keyshortcuts="Alt\+\d"/g)).toHaveLength(5);
    expect(html).toContain("Arriving next");
    expect(html).toContain('<main id="app-main" class="app-main" tabindex="-1"><p>content</p></main>');
  });

  test("a planned surface says it is not built and shows no sample data", () => {
    const html = renderToStaticMarkup(<ScoutApp url={new URL("http://127.0.0.1:4173/control")} />);
    expect(html).toContain('href="/control" data-status="planned" aria-current="page"');
    expect(html).toContain("Not in this build yet");
    expect(html).not.toContain('class="s-feed"');
    expect(html).not.toContain("data-post-id=");
  });
});

describe("first run", () => {
  const render = (kind: "temporary" | "existing" | null) => renderToStaticMarkup(
    <RuntimeContext.Provider value={{ info: { url: kind ? "http://127.0.0.1:43110" : null, kind }, status: "connected" }}>
      <FeedEmptyState />
    </RuntimeContext.Provider>,
  );

  test("a new runtime explains what is read, how to connect your own, and what comes next", () => {
    const html = render("temporary");
    expect(html).toContain("Nothing finished yet.");
    expect(html).toContain("a new temporary Scout runtime at <code>http://127.0.0.1:43110</code>");
    expect(html).toContain('data-status="connected"');
    expect(html).toContain(`<code>${CONNECT_COMMAND}</code>`);
    expect(html).toContain("Chat, Sessions, Board and Control");
    expect(html).not.toContain("data-post-id=");
  });

  test("an existing runtime is not told to reconnect", () => {
    const html = render("existing");
    expect(html).toContain("your Scout runtime at");
    expect(html).not.toContain(CONNECT_COMMAND);
    expect(render(null)).toContain("the local Scout runtime.");
  });

  test("runtime meta is display-only and loopback-only", () => {
    const doc = (url: string, kind: string) => ({
      querySelector: (selector: string) => ({ content: selector.includes("url") ? url : kind }),
    }) as unknown as Document;
    expect(readRuntimeInfo(doc("http://127.0.0.1:43110", "temporary"))).toEqual({ url: "http://127.0.0.1:43110", kind: "temporary" });
    expect(readRuntimeInfo(doc("https://example.invalid", "other"))).toEqual({ url: null, kind: null });
    expect([200, 304, 503, 403].map(statusFromResponse)).toEqual(["connected", "connected", "unreachable", "unreachable"]);
  });
});

const empty: FeedResponse = {
  version: 1, generatedAt: 0, view: "all", full: true, posts: [], removed: [], days: [],
  cursor: null, size: { posts: 0, days: 0, reviewed: 0 }, home: null, views: ["all"],
};

async function inBrowser(path: string, run: (window: Window) => Promise<void>) {
  const window = new Window({ url: "http://127.0.0.1:4173" + path });
  const requests: string[] = [];
  const globals = {
    window, document: window.document, location: window.location, history: window.history,
    localStorage: window.localStorage, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: Parameters<typeof fetch>[0]) => {
      requests.push(String(input));
      return String(input).startsWith("/api/feed?") ? Response.json(empty) : new Response(null, { status: 404 });
    },
  };
  const restore = Object.keys(globals).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    return () => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
  });
  let unmount: (() => void) | undefined;
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(window.document.body as unknown as HTMLElement);
    unmount = () => root.unmount();
    await act(async () => {
      root.render(<ScoutApp url={new URL(window.location.href)} runtime={{ url: "http://127.0.0.1:43110", kind: "temporary" }} capabilities={{ readOnly: true }} />);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await run(window);
  } finally {
    await act(async () => unmount?.());
    await window.happyDOM.close();
    for (const undo of restore) undo();
  }
  return requests;
}

describe("routing in the browser", () => {
  test("/ opens the shell with the first-run guide in place of the bare empty line", async () => {
    const requests = await inBrowser("/", async window => {
      const doc = window.document;
      expect(doc.querySelector("nav.app-rail")).not.toBeNull();
      expect(doc.querySelector('.app-surface[aria-current="page"]')?.textContent).toBe("Feed");
      expect(doc.querySelector(".app-empty h2")?.textContent).toBe("Nothing finished yet.");
      expect(doc.querySelector(".app-command code")?.textContent).toBe(CONNECT_COMMAND);
      expect(doc.querySelector(".fd-empty")).toBeNull();
      expect(doc.querySelector(".app-runtime")?.getAttribute("data-status")).toBe("connected");

      // Option-3 opens Sessions without reloading the document.
      await act(async () => {
        doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "3", code: "Digit3", altKey: true, bubbles: true }));
      });
      expect(window.location.pathname).toBe("/sessions");
      expect(doc.querySelector('.app-surface[aria-current="page"]')?.textContent).toBe("Sessions");
      expect(doc.querySelector(".app-planned h1")?.textContent).toBe("Sessions");

      // The theme choice applies at once and survives a reload.
      await act(async () => { (doc.querySelector('.app-theme button:nth-child(3)') as unknown as HTMLButtonElement).click(); });
      expect(doc.querySelector(".app")?.getAttribute("data-scout-theme")).toBe("dark");
      expect(window.localStorage.getItem("scout-app.theme")).toBe("dark");
    });
    expect(requests.filter(r => r.startsWith("/api/feed?"))).not.toHaveLength(0);
  });

  test("/embed/feed stays chrome-free with the Feed's own empty line", async () => {
    await inBrowser("/embed/feed", async window => {
      const doc = window.document;
      expect(doc.querySelector("nav, main, .app-rail, .app-empty")).toBeNull();
      expect(doc.body.firstElementChild?.className).toBe("scout-feed-embed");
      expect(doc.querySelector(".fd-empty")?.textContent).toBe("Nothing finished yet.");
    });
  });
});
