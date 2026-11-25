import { describe, expect, test } from "bun:test";
import type { ClaudeSessionRecord } from "@openscout/runtime";
import type { SessionFocusResult, SessionSteerAvailability } from "../shared/api/session-steer.ts";
import { findRefPane, findSessionPane, nativeSessionRefs, revealSession, type SessionPaneDeps, type SessionRevealDeps, type TmuxHostSession } from "./session-reveal.ts";

const record = (over: Partial<ClaudeSessionRecord>): ClaudeSessionRecord => ({
  pid: 1, sessionId: "native-a", cwd: "/work", startedAt: 1, procStart: "start", kind: null, entrypoint: null,
  version: null, tmux: null, name: null, nameSource: null, ...over,
});
const failed = (code: string, over: Partial<SessionFocusResult> = {}): SessionFocusResult => ({ ok: false, code, reason: `reason:${code}`, target: null, ...over });
const detached = failed("tmux_detached", { detached: { socket: "/tmp/tmux-501/default", session: "session-x" } });

function deps(calls: string[], over: Partial<SessionRevealDeps> & { host?: TmuxHostSession | null } = {}): SessionRevealDeps {
  const { host, ...rest } = over;
  return {
    records: async () => [record({ sessionId: "native-a", tmux: { session: "session-x", window: "@4", pane: "%4" } })],
    machine: async () => "node-1",
    focus: async (ref) => { calls.push(`focus ${ref}`); return { ok: true, code: "focus_requested", reason: "selected", target: null }; },
    tmuxSession: async (name) => { calls.push(`tmux ${name}`); return host === undefined ? null : host; },
    open: async (argv, cwd) => { calls.push(`open ${argv.join(" ")} @ ${cwd}`); return { app: "Ghostty" }; },
    ...rest,
  };
}

describe("nativeSessionRefs", () => {
  test("bridges a runtime tmux session id to Claude's native id, newest first, once each", () => {
    const refs = nativeSessionRefs([
      record({ sessionId: "old", startedAt: 1, tmux: { session: "session-x", window: null, pane: null } }),
      record({ sessionId: "new", startedAt: 5, tmux: { session: "session-x", window: null, pane: null } }),
      record({ sessionId: "new", startedAt: 4, tmux: { session: "session-x", window: null, pane: null } }),
      record({ sessionId: "other", tmux: { session: "session-y", window: null, pane: null } }),
    ], "session-x");
    expect(refs.map((entry) => entry.ref)).toEqual(["session:claude:new", "session:claude:old"]);
  });

  test("matches a native id directly", () => {
    expect(nativeSessionRefs([record({ sessionId: "abc" })], "abc")).toEqual([{ ref: "session:claude:abc", cwd: "/work" }]);
  });
});

describe("revealSession", () => {
  test("a live window wins and nothing is opened", async () => {
    const calls: string[] = [];
    expect(await revealSession("session-x", deps(calls))).toMatchObject({ ok: true, rung: "window" });
    expect(calls).toEqual(["focus session:claude:native-a"]);
  });

  test("a verified detached tmux session opens a terminal on exactly that session and socket", async () => {
    const calls: string[] = [];
    const result = await revealSession("session-x", deps(calls, { focus: async () => detached }));
    expect(result).toEqual({ ok: true, rung: "attached", app: "Ghostty", reason: "Opened Ghostty attached to session-x." });
    expect(calls).toEqual(["open tmux -S /tmp/tmux-501/default attach-session -t =session-x @ /work"]);
  });

  test("a focus that selected but could not raise the app is reported, not doubled with a second terminal", async () => {
    const calls: string[] = [];
    const result = await revealSession("session-x", deps(calls, { focus: async () => failed("native_activation_required") }));
    expect(result).toEqual({ ok: false, code: "native_activation_required", reason: "reason:native_activation_required" });
    expect(calls).toEqual([]);
  });

  // Review of #1541: terminal_unavailable means a client IS attached, in an app Scout couldn't identify.
  test("an attached session with an unidentified app gets no second client", async () => {
    const calls: string[] = [];
    const result = await revealSession("session-x", deps(calls, { focus: async () => failed("terminal_unavailable"), host: { session: "session-x", socket: null, cwd: "/work", attached: false } }));
    expect(result).toMatchObject({ ok: false, code: "terminal_unavailable" });
    expect(calls.filter((call) => call.startsWith("open"))).toEqual([]);
  });

  // Review of #1541: a stale record's tmux name may have been reused by another session.
  test("a gone process never attaches by its record's tmux name", async () => {
    const calls: string[] = [];
    const result = await revealSession("native-a", deps(calls, {
      focus: async () => failed("not_live"),
      tmuxSession: async (name) => { calls.push(`tmux ${name}`); return name === "session-x" ? { session: "session-x", socket: null, cwd: "/other", attached: false } : null; },
    }));
    expect(result).toEqual({ ok: false, code: "not_live", reason: "reason:not_live" });
    expect(calls).toEqual(["tmux native-a"]);
  });

  test("a gone process whose request id is itself a detached tmux session attaches to it", async () => {
    const calls: string[] = [];
    const result = await revealSession("session-x", deps(calls, { focus: async () => failed("not_live"), host: { session: "session-x", socket: "/s", cwd: "/work", attached: false } }));
    expect(result).toMatchObject({ ok: true, rung: "attached" });
    expect(calls.at(-1)).toBe("open tmux -S /s attach-session -t =session-x @ /work");
  });

  test("with no Claude record a detached tmux session named by the request is attached", async () => {
    const calls: string[] = [];
    const result = await revealSession("session-z", deps(calls, { records: async () => [], host: { session: "session-z", socket: null, cwd: "/r", attached: false } }));
    expect(result).toMatchObject({ ok: true, rung: "attached" });
    expect(calls).toEqual(["tmux session-z", "open tmux attach-session -t =session-z @ /r"]);
  });

  test("with no Claude record an attached tmux session is reported, not given a second client", async () => {
    const calls: string[] = [];
    const result = await revealSession("session-z", deps(calls, { records: async () => [], host: { session: "session-z", socket: null, cwd: "/r", attached: true } }));
    expect(result).toMatchObject({ ok: false, code: "attached_unverified" });
    expect(calls).toEqual(["tmux session-z"]);
  });

  test("nothing to focus or attach starts nothing", async () => {
    const calls: string[] = [];
    expect(await revealSession("session-z", deps(calls, { records: async () => [] }))).toMatchObject({ ok: false, code: "not_found" });
    expect(calls).toEqual(["tmux session-z"]);
  });

  test("a background session opens on its own attach command, and nothing else is tried", async () => {
    const calls: string[] = [];
    const result = await revealSession("native-a", deps(calls, {
      focus: async () => failed("background_job"),
      openAttached: async (ref, machine) => { calls.push(`attach ${ref} on ${machine}`); return { ok: true, code: "opened", reason: "Opened in Ghostty.", app: "Ghostty" }; },
    }));
    expect(result).toEqual({ ok: true, rung: "attached", app: "Ghostty", reason: "Opened in Ghostty." });
    expect(calls).toEqual(["attach session:claude:native-a on node-1"]);
  });

  test("a background session that could not be opened says why", async () => {
    const result = await revealSession("native-a", deps([], {
      focus: async () => failed("background_job"),
      openAttached: async () => { throw new Error("no terminal app"); },
    }));
    expect(result).toEqual({ ok: false, code: "open_failed", reason: "no terminal app" });
  });

  test("an open failure is reported", async () => {
    const result = await revealSession("session-x", deps([], { focus: async () => detached, open: async () => { throw new Error("no terminal app"); } }));
    expect(result).toEqual({ ok: false, code: "open_failed", reason: "no terminal app" });
  });
});

describe("revealSession pop-outs", () => {
  const ghostty = { app: "Ghostty", bundleId: "com.mitchellh.ghostty", pid: 77 };
  const terminal = { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 77 };

  test("a detached tmux attach is marked as a pop-out, and the answer names it for Done", async () => {
    const marks: (string | undefined)[] = [];
    const result = await revealSession("session-x", deps([], {
      focus: async () => detached,
      popOutToken: () => "po_tmux",
      open: async (_argv, _cwd, popOut) => { marks.push(popOut); return ghostty; },
    }));
    expect(marks).toEqual(["po_tmux"]);
    expect(result).toEqual({
      ok: true, rung: "attached", app: "Ghostty", reason: "Opened Ghostty attached to session-x.",
      popOut: "po_tmux", machine: "node-1", sessionRef: "session:claude:native-a", terminal,
    });
  });

  test("a tmux session found only by the request's id is a pop-out too", async () => {
    const result = await revealSession("session-z", deps([], {
      records: async () => [],
      host: { session: "session-z", socket: null, cwd: "/r", attached: false },
      popOutToken: () => "po_host",
      open: async () => ghostty,
    }));
    expect(result).toMatchObject({ ok: true, rung: "attached", popOut: "po_host", machine: "node-1", sessionRef: "session-z" });
  });

  test("a background session's pop-out comes back from its own open", async () => {
    const result = await revealSession("native-a", deps([], {
      focus: async () => failed("background_job"),
      openAttached: async () => ({ ok: true, code: "opened", reason: "Opened in Ghostty.", app: "Ghostty", popOut: "po_job", terminal }),
    }));
    expect(result).toEqual({
      ok: true, rung: "attached", app: "Ghostty", reason: "Opened in Ghostty.",
      popOut: "po_job", machine: "node-1", sessionRef: "session:claude:native-a", terminal,
    });
  });

  test("without the host's id the window still opens, unmarked, since Done could not close it", async () => {
    const marks: (string | undefined)[] = [];
    const result = await revealSession("session-z", deps([], {
      machine: async () => null,
      records: async () => [],
      host: { session: "session-z", socket: null, cwd: "/r", attached: false },
      popOutToken: () => "po_never",
      open: async (_argv, _cwd, popOut) => { marks.push(popOut); return ghostty; },
    }));
    expect(marks).toEqual([undefined]);
    expect(result).toEqual({ ok: true, rung: "attached", app: "Ghostty", reason: "Opened Ghostty attached to session-z." });
  });
});

describe("findSessionPane", () => {
  const inTmux = (address: string, tty: string | null = "/dev/ttys004"): SessionSteerAvailability => ({
    available: true, code: "ready", reason: "ready",
    target: { pid: 9, processStart: "s", host: "tmux", address, tty },
  });
  const sessions: Record<string, TmuxHostSession> = {
    work: { session: "work", attached: true, socket: "/tmp/tmux-501/default", cwd: "/work" },
    "session-x": { session: "session-x", attached: false, socket: "/tmp/tmux-501/default", cwd: "/x" },
  };
  function paneDeps(calls: string[], over: Partial<SessionPaneDeps> = {}): SessionPaneDeps {
    return {
      records: async () => [record({ sessionId: "native-a", tmux: { session: "session-x", window: "@4", pane: "%4" } })],
      machine: async () => "node-1",
      inspect: async (ref) => { calls.push(`inspect ${ref}`); return inTmux("%7"); },
      paneOf: async (id) => { calls.push(`pane ${id}`); return id === "%7" ? { session: "work", tty: "/dev/ttys004" } : null; },
      tmuxSession: async (name) => { calls.push(`tmux ${name}`); return sessions[name] ?? null; },
      ...over,
    };
  }

  test("the session its process runs in, proved by the pane's tty, attached or not; nothing is opened or focused", async () => {
    const calls: string[] = [];
    expect(await findSessionPane("session-x", paneDeps(calls))).toEqual({ ok: true, pane: { backend: "tmux", sessionName: "work" }, attached: true, cwd: "/work" });
    expect(calls).toEqual(["inspect session:claude:native-a", "pane %7", "tmux work"]);
  });

  test("a pane whose tty is not the process's own is another server's: not trusted", async () => {
    const calls: string[] = [];
    const result = await findSessionPane("other", paneDeps(calls, {
      records: async () => [record({ sessionId: "native-a", tmux: { session: "other", window: null, pane: null } })],
      paneOf: async () => ({ session: "work", tty: "/dev/ttys999" }),
    }));
    expect(result).toEqual({ ok: false, code: "no_pane", reason: "This session isn't in a tmux session Scout can show here." });
    expect(calls).not.toContain("tmux work");
  });

  test("with no live tmux process, the request's runtime id as an exact tmux session name stands in", async () => {
    const calls: string[] = [];
    const result = await findSessionPane("session-x", paneDeps(calls, { inspect: async () => ({ available: false, code: "not_live", reason: "gone", target: null }) }));
    expect(result).toMatchObject({ ok: true, pane: { sessionName: "session-x" }, attached: false });
  });

  test("a session in Herdr, Orca or a plain terminal tab has no pane here", async () => {
    const calls: string[] = [];
    const herdr: SessionSteerAvailability = { available: true, code: "ready", reason: "ready", target: { pid: 9, processStart: "s", host: "herdr", address: "s/p1", tty: null } };
    const result = await findSessionPane("native-a", paneDeps(calls, { records: async () => [record({ sessionId: "native-a" })], inspect: async () => herdr }));
    expect(result.ok).toBe(false);
    expect(calls).not.toContain("pane s/p1");
  });

  describe("by a session's ref (the quick terminal)", () => {
    test("the proved pane's session, inspected on the host it names", async () => {
      const calls: string[] = [];
      const seen: string[] = [];
      const result = await findRefPane("session:codex:t1", "node-1", paneDeps(calls, {
        inspect: async (ref, machine) => { seen.push(`${ref}@${machine}`); return inTmux("%7"); },
      }));
      expect(result).toMatchObject({ ok: true, pane: { backend: "tmux", sessionName: "work" } });
      expect(seen).toEqual(["session:codex:t1@node-1"]);
    });

    test("no tty proof, no pane: a ref never falls back to a tmux name", async () => {
      const calls: string[] = [];
      const foreign = await findRefPane("session-x", "node-1", paneDeps(calls, { paneOf: async () => ({ session: "work", tty: "/dev/ttys999" }) }));
      expect(foreign.ok).toBe(false);
      // Another host's session: inspect refuses it, so nothing is read off this tmux.
      const remote = await findRefPane("session-x", "node-2", paneDeps(calls, {
        inspect: async () => ({ available: false, code: "remote_refused", reason: "another machine", target: null }),
      }));
      expect(remote.ok).toBe(false);
      expect(calls.filter((c) => c.startsWith("tmux "))).toEqual([]);
    });
  });
});
