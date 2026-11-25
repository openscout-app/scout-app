import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";
import type { Agent } from "../../lib/types.ts";

// As in lib/terminal-relay.test.ts: the relay module reaches react through the
// api client, and the relative .js path keeps bun on the real react.
// @ts-expect-error -- untyped path import; the cast restores the types
const React = (await import("../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);
const { resolveAgentTerminalSurface, resolveTerminalRelayBinding, shouldBootstrapTakeover } = await import("../../lib/terminal-relay.ts");
const { takeoverRelayKey } = await import("./takeover-relay-key.ts");

/*
 * Taking over an agent with no terminal surface queues its resume command,
 * then connects the relay. The session the bootstrap clears has to be the one
 * the relay would reconnect to, or the command can land in the last pty.
 */

const bare = { id: "a1", name: "Ada", handle: null, transport: "bridge", harness: "codex", harnessSessionId: null, cwd: "/tmp/a1", projectRoot: "/tmp/a1" } as Agent;

const relayKey = (scope?: string) =>
  resolveTerminalRelayBinding({
    agentId: bare.id,
    agent: bare,
    terminalSurface: resolveAgentTerminalSurface(bare),
    relayUrl: "ws://relay",
    harness: bare.harness,
    cwd: bare.cwd,
    mode: "takeover",
    scope,
  }).relayStorageSessionKey;

describe("the takeover the bootstrap clears", () => {
  test("only an agent with no surface bootstraps a takeover", () => {
    expect(shouldBootstrapTakeover(bare, "takeover")).toBe(true);
    expect(resolveAgentTerminalSurface(bare)).toBeNull();
  });

  test("is the relay session the page connects to", () => {
    expect(takeoverRelayKey(bare.id)).toBe(relayKey());
    expect(takeoverRelayKey(bare.id, null)).toBe(relayKey());
  });

  test("is the relay session a panel connects to, by its scope", () => {
    expect(takeoverRelayKey(bare.id, "terminal-session")).toBe(relayKey("terminal-session"));
    expect(takeoverRelayKey(bare.id, "terminal-session")).not.toBe(relayKey());
  });

  test("is not the older name queueTakeover clears, which no relay uses now", () => {
    expect(takeoverRelayKey(bare.id)).not.toBe(`scout-takeover-${bare.id}`);
    expect(takeoverRelayKey(bare.id)).toBe("scout-takeover-a1-takeover");
  });
});
