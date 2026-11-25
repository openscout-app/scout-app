import { describe, expect, test } from "bun:test";
import {
  bufferPtyOutput,
  buildTmuxAttachArgs,
  clampObserverDimensions,
  connectionSizing,
  followsTmuxWindow,
  isValidMultiplexerName,
} from "./terminal-relay-session.ts";

describe("terminal relay multiplexer session names", () => {
  test("accepts the full generated name of an existing tmux session", () => {
    const sessionName = "relay-arc-opus-beautification-master-arachs-mac-mini-local-claude";

    expect(sessionName).toHaveLength(65);
    expect(isValidMultiplexerName(sessionName)).toBe(true);
  });

  test("rejects names that are unsafe to pass to a multiplexer", () => {
    expect(isValidMultiplexerName("")).toBe(false);
    expect(isValidMultiplexerName("-starts-with-a-dash")).toBe(false);
    expect(isValidMultiplexerName("contains spaces")).toBe(false);
    expect(isValidMultiplexerName("contains/slashes")).toBe(false);
  });
});

describe("tmux relay attach arguments", () => {
  test("makes observe clients read-only and excludes them from size arbitration", () => {
    expect(buildTmuxAttachArgs("relay-agent-1-claude", "observe"))
      .toEqual(["-u", "attach", "-r", "-t", "relay-agent-1-claude"]);
  });

  test("keeps takeover clients writable", () => {
    expect(buildTmuxAttachArgs("relay-agent-1-claude", "takeover"))
      .toEqual(["-u", "attach", "-t", "relay-agent-1-claude"]);
  });

  test("keeps a following guest writable but out of size arbitration", () => {
    expect(buildTmuxAttachArgs("relay-agent-1-claude", "takeover", "follow"))
      .toEqual(["-u", "attach", "-f", "ignore-size", "-t", "relay-agent-1-claude"]);
  });

  test("an observer stays read-only whatever its sizing", () => {
    expect(buildTmuxAttachArgs("relay-agent-1-claude", "observe", "follow"))
      .toEqual(["-u", "attach", "-r", "-t", "relay-agent-1-claude"]);
  });
});

describe("tmux window sizing", () => {
  test("observers and following guests take the window's size; owners and takeovers set it", () => {
    expect(followsTmuxWindow({ backend: "tmux", controlMode: "observe", sizing: "own" })).toBe(true);
    expect(followsTmuxWindow({ backend: "tmux", controlMode: "takeover", sizing: "follow" })).toBe(true);
    expect(followsTmuxWindow({ backend: "tmux", controlMode: "takeover", sizing: "own" })).toBe(false);
    expect(followsTmuxWindow({ backend: "tmux", controlMode: "owner", sizing: "own" })).toBe(false);
    expect(followsTmuxWindow({ backend: "pty", controlMode: "takeover", sizing: "follow" })).toBe(false);
  });

  test("a connection follows only when its URL asks for it", () => {
    expect(connectionSizing("/?agentId=a&sizing=follow")).toBe("follow");
    expect(connectionSizing("/?sizing=own")).toBe("own");
    expect(connectionSizing("/?agentId=a")).toBe("own");
    expect(connectionSizing("/")).toBe("own");
    expect(connectionSizing(undefined)).toBe("own");
  });
});

describe("tmux observer viewport", () => {
  test("uses the requested grid when it fits inside the tmux window", () => {
    expect(clampObserverDimensions(
      { cols: 120, rows: 40 },
      { cols: 164, rows: 82 },
    )).toEqual({ cols: 120, rows: 40 });
  });

  test("caps a larger observer to the authoritative tmux grid", () => {
    expect(clampObserverDimensions(
      { cols: 183, rows: 90 },
      { cols: 164, rows: 82 },
    )).toEqual({ cols: 164, rows: 82 });
  });
});

describe("tmux relay initial output", () => {
  test("preserves output emitted before the session handler is ready", () => {
    let emit: ((data: string) => void) | null = null;
    const attachOutput = bufferPtyOutput({
      onData(handler) {
        emit = handler;
        return { dispose() {} };
      },
    });
    const received: string[] = [];

    emit?.("initial frame");
    attachOutput((data) => received.push(data));
    emit?.("live update");

    expect(received).toEqual(["initial frame", "live update"]);
  });
});
