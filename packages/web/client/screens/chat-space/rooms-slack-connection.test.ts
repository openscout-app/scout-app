import { describe, expect, test } from "bun:test";
import type { SlackConnectionStatus } from "./slack-chat-api.ts";
import { disconnectSlackConnection, readSlackConnection, type SlackConnectionTransport } from "./rooms-slack-connection.ts";

const connected: SlackConnectionStatus = { connected: true, source: "oauth", oauthConfigured: true, scopes: [], teamName: "Example" };
const disconnected: SlackConnectionStatus = { connected: false, source: null, oauthConfigured: true, scopes: [] };

function fake(options: { disconnect?: Error; status?: Error } = {}) {
  const calls: string[] = [];
  const transport: SlackConnectionTransport = {
    async disconnect() {
      calls.push("disconnect");
      if (options.disconnect) throw options.disconnect;
      return { ok: true };
    },
    async status(next) {
      calls.push(`status ${next}`);
      if (options.status) throw options.status;
      return disconnected;
    },
  };
  return { transport, calls };
}

describe("Slack connection in Rooms", () => {
  test("a failed disconnect names the failure and does not re-read the status", async () => {
    const { transport, calls } = fake({ disconnect: new Error("Slack refused.") });
    expect(await disconnectSlackConnection(transport, connected, "/rooms?source=all")).toEqual({ ok: false, error: "Slack refused." });
    expect(calls).toEqual(["disconnect"]);
  });

  test("a disconnect reports the status read for the current address", async () => {
    const { transport, calls } = fake();
    expect(await disconnectSlackConnection(transport, connected, "/rooms?source=all&provider=slack"))
      .toEqual({ ok: true, status: disconnected });
    expect(calls).toEqual(["disconnect", "status /rooms?source=all&provider=slack"]);
  });

  test("a disconnect that worked stays a success when the follow-up read fails", async () => {
    const { transport } = fake({ status: new Error("offline") });
    const outcome = await disconnectSlackConnection(transport, connected, "/rooms");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status.connected).toBe(false);
    expect(outcome.status.oauthConfigured).toBe(true);
    expect(outcome.status.error).toContain("Slack was disconnected");
  });

  test("neither call rejects, so a click handler cannot leak an unhandled rejection", async () => {
    const { transport } = fake({ disconnect: new Error("x"), status: new Error("y") });
    await expect(disconnectSlackConnection(transport, connected, "/rooms")).resolves.toMatchObject({ ok: false });
    await expect(readSlackConnection(transport, "/rooms")).resolves.toMatchObject({ connected: false, error: "y" });
  });
});
