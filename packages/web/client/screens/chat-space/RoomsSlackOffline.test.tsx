import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { SlackConnectionStatus } from "./slack-chat-api.ts";
import { RoomsSlackOffline } from "./RoomsSlackOffline.tsx";

// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");

const disconnected: SlackConnectionStatus = { connected: false, source: null, oauthConfigured: true, scopes: [] };

function draw(options: { connection?: SlackConnectionStatus; href?: string | null; list?: boolean } = {}) {
  return renderToStaticMarkup(createElement(RoomsSlackOffline, {
    connection: options.connection ?? disconnected,
    authorizationHref: options.href === undefined ? "/api/slack/client/oauth/authorize?next=%2Frooms" : options.href,
    hasChannel: true,
    checking: false,
    list: options.list ? createElement("nav", { "aria-label": "All channels" }) : undefined,
    onCheckAgain: () => {},
    onOpenScout: () => {},
  }));
}

describe("Slack address while Slack is not connected", () => {
  test("says Slack is not connected and offers the way in and the way to Scout", () => {
    const markup = draw();
    expect(markup).toContain("Slack is not connected");
    expect(markup).toContain('href="/api/slack/client/oauth/authorize?next=%2Frooms"');
    expect(markup).toContain("Go to Scout");
    expect(markup).not.toContain("Try again");
  });

  test("keeps the All channels list beside it", () => {
    expect(draw({ list: true })).toContain('aria-label="All channels"');
    expect(draw()).not.toContain('aria-label="All channels"');
  });

  test("does not offer a Connect button the server cannot honor, and shows a read failure", () => {
    const markup = draw({ href: null, connection: { ...disconnected, oauthConfigured: false, error: "Slack connection status could not be read." } });
    expect(markup).not.toContain("Connect Slack</a>");
    expect(markup).toContain("server environment");
    expect(markup).toContain("Slack connection status could not be read.");
  });
});
