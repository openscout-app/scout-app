import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HarnessMark } from "./FeedHarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { routePath } from "../../lib/router.ts";
import { routeEmbeddedNavigation } from "../../surfaces/embed-navigation.ts";
import { forwardScoutbotUiActionToNativeHost } from "../../lib/scoutbot.ts";
import { NativeAreaScreen, scoutSurface } from "./NativeAreaScreen.tsx";
import { sendDirection } from "./PostActions.tsx";
import { feedPath } from "./feed-store.ts";
import { isNotModified } from "./post-parts.tsx";

afterEach(() => mock.restore());

describe("local Feed embed boundary", () => {
  test("the Mac Feed surface renders the stream, not an example post", () => {
    expect(scoutSurface.embed).toEqual({ path: "/embed/feed", profile: "macos.feed", hosts: { macos: true } });
    const html = renderToStaticMarkup(<NativeAreaScreen navigate={() => {}} />);
    expect(html).toContain('class="s-feed"');
    expect(html).toContain('aria-label="Loading Feed"');
    expect(html).not.toContain("data-post-id=");
  });

  test("harness marks show names as text rather than logos", () => {
    for (const [harness, label] of [
      ["anthropic", "Claude"], ["openai", "Codex"], ["xai", "Grok"],
      ["moonshot", "Kimi"], ["cognition", "Devin"], ["vertex", "Gemini"],
      ["Google Antigravity CLI", "Google Antigravity"], ["cursor", "Cursor"],
      ["github", "GitHub"], ["oc", "OpenCode"], ["sourcegraph", "Amp"],
      ["oh-my-pi", "Pi"], ["custom-harness", "custom-harness"],
    ]) {
      const html = renderToStaticMarkup(<HarnessMark harness={harness} />);
      expect(html).toContain(`>${label}</span>`);
      expect(html).not.toContain("<svg");
    }
    expect(renderToStaticMarkup(<HarnessMark harness=" " />)).toBe("");
  });

  test("compact harness monograms have the full accessible name", () => {
    const html = renderToStaticMarkup(<HarnessMark harness="codex" compact />);
    expect(html).toContain('aria-label="Codex"');
    expect(html).toContain(">CX</span>");
  });

  test("an unchanged version is still distinguishable from a failed read", async () => {
    const read = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));
    const path = feedPath("reviewed", { since: 8 });
    const unchanged = await api(path).then(() => false, isNotModified);
    expect(read.mock.calls[0]![0]).toBe("/api/feed?view=reviewed&since=8");
    expect(unchanged).toBe(true);
  });

  test("a reply targets the named session and reports the runtime's receipt", async () => {
    const post = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      ok: true, sessionId: "s-1", delivery: "in_place", location: "test pane",
    }));
    const receipt = await sendDirection({ to: "session", sessionId: "s-1", harness: "codex", cwd: null }, "  Keep the label.  ", "Agent");
    const [path, init] = post.mock.calls[0]!;
    expect(path).toBe("/api/sessions/reply");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: "s-1", harness: "codex", body: "Keep the label.", source: "scout-web", clientMessageId: expect.any(String),
    });
    expect(receipt).toContain("test pane");
  });

  test("a successor uses the work id; a refused write is not a success", async () => {
    const post = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Work is closed" }, { status: 409 }));
    await expect(sendDirection({ to: "successor", workId: "w/1" }, "Follow up", "Agent")).rejects.toThrow("Work is closed");
    const [path, init] = post.mock.calls[0]!;
    expect(path).toBe("/api/work/w%2F1/continue");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ body: "Follow up", requestId: expect.stringMatching(/^feed-/) });
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a discussion link opens in the native host first and still has a web destination", () => {
    const route = { view: "conversation", conversationId: "thread/1" } as const;
    const postMessage = mock(() => {});
    const fallback = mock(() => {});
    routeEmbeddedNavigation(route, fallback, action => forwardScoutbotUiActionToNativeHost(action, {
      webkit: { messageHandlers: { scoutNativeUI: { postMessage } } },
    }));
    expect(postMessage).toHaveBeenCalledWith({ kind: "ui-action", action: { type: "navigate", route } });
    expect(fallback).not.toHaveBeenCalled();
    routeEmbeddedNavigation(route, fallback, action => forwardScoutbotUiActionToNativeHost(action, {}));
    expect(fallback).toHaveBeenCalledWith(route);
    expect(routePath(route)).toBe("/c/thread%2F1");
  });
});
