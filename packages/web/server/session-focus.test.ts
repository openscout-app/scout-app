import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createSessionSteering, type InPlaceRuntime, type SessionSteeringDeps } from "./session-steering.ts";
import { mountSessionSteerRoutes } from "./routes/session-steer.ts";
import { installScoutApiMiddleware } from "./server-core.ts";
import type { SessionFocusBinding } from "./session-terminal.ts";
const start = "Thu Oct 15 12:00:00 2026";
const ref = "session:claude:exact";
const terminal = () => ({ descriptor: { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 30 }, appStart: start });
function fixture(overrides: Partial<SessionSteeringDeps> = {}, runtimeOverrides: Partial<InPlaceRuntime> = {}) {
  const focused: SessionFocusBinding[] = [];
  let typed = 0;
  const runtime: InPlaceRuntime = {
    readProcessHostEnv: async () => ({ TERM_PROGRAM: "herdr", HERDR_SESSION: "live", HERDR_PANE_ID: "w1:p2" }),
    innermostProcessHost: () => ({ host: "herdr", session: "live", paneId: "w1:p2" }),
    processHostLocations: () => [], resolveInPlaceOrder: () => ["herdr", "orca", "tmux", "terminal"],
    codexThreadHolderPids: async () => [], codexThreadHeldByChatGPTApp: async () => false,
    readOrcaAgents: async () => [], isScoutBackgroundCopy: () => false,
    deliverInPlace: async () => { typed++; return { ok: true }; },
    ...runtimeOverrides,
  };
  const deps: SessionSteeringDeps = {
    runtime, machine: async () => "here",
    records: async () => [{ pid: 10, procStart: start, sessionId: "exact", cwd: "/repo", startedAt: null, kind: "interactive", entrypoint: "cli", version: null, tmux: null, name: null, nameSource: null, recordPath: "/10.json" }],
    process: async (pid) => ({ pid, parent: 1, start, tty: "ttys001", foreground: true }),
    self: async () => ({ pids: [], ttys: [], hosts: [] }),
    herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { agent: "claude", value: "exact" }, agentStatus: "blocked" }] }] }] }) as never,
    tmux: async () => null, terminal: async () => terminal(), windowTitle: async () => null,
    focus: async (binding) => { focused.push(binding); return { ok: true, code: "focus_requested", reason: "test focus accepted", target: binding.target }; },
    ...overrides,
  };
  const steering = createSessionSteering(deps);
  return { steering, deps, focused, typed: () => typed };
}
test.skipIf(process.platform !== "darwin")("blocked and nonforeground sessions expose a verified terminal and independent focus capability", async () => {
  for (const foreground of [true, false]) {
    const f = fixture({ process: async (pid) => ({ pid, parent: 1, start, tty: "ttys001", foreground }) });
    const inspection = await f.steering.inspect(ref, "here");
    expect(inspection).toMatchObject({ available: false, code: foreground ? "session_blocked" : "not_foreground",
      target: { host: "herdr", address: "live/w1:p2", terminal: { app: "Ghostty" } }, focus: { available: true } });
    expect((await f.steering.focus(ref, "here")).ok).toBe(true);
    expect(f.focused).toHaveLength(1);
    expect(f.typed()).toBe(0);
  }
});
test("a Scout background copy still exposes its verified tmux location, without guessing a GUI", async () => {
  const f = fixture({
    records: async () => [{ ...await fixture().deps.records().then((r) => r[0]!), tmux: { session: "live", window: "@1", pane: "%7" } }],
    tmux: async () => ({ socket: "/exact/socket", pid: 10, tty: "ttys001", pane: "%7", session: "live" }),
    terminal: async () => ({ descriptor: { app: null, bundleId: null, appPid: null, attached: false }, clients: [] }),
  }, {
    readProcessHostEnv: async () => ({ TERM_PROGRAM: "tmux", TMUX: "/exact/socket,22,0", TMUX_PANE: "%7" }),
    innermostProcessHost: () => ({ host: "tmux", pane: "%7" }), isScoutBackgroundCopy: () => true,
  });
  expect(await f.steering.inspect(ref, "here")).toMatchObject({ available: false, code: "background_copy",
    target: { host: "tmux", address: "%7", terminal: { attached: false } }, focus: { available: false, code: "tmux_detached" } });
  expect(await f.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "tmux_detached", attach: "tmux -S '/exact/socket' attach -t 'live'" });
  expect(f.focused).toHaveLength(0);
});

test.skipIf(process.platform !== "darwin")("ref, machine, uniqueness and birth guards remain mandatory for focus", async () => {
  for (const [request, machine, expected] of [
    ["exact", "here", "invalid_session"], [ref, "elsewhere", "remote_refused"], [ref, null, "machine_unverified"],
  ] as const) {
    const f = fixture();
    expect(await f.steering.focus(request, machine)).toMatchObject({ ok: false, code: expected });
    expect(f.focused).toHaveLength(0);
  }
  const stale = fixture({ process: async (pid) => ({ pid, parent: 1, start: "new birth", tty: "ttys001", foreground: true }) });
  expect(await stale.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "not_live" });
  const ambiguous = fixture({ records: async () => {
    const records = await fixture().deps.records(); return [...records, { ...records[0]!, pid: 11 }];
  } });
  expect(await ambiguous.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "ambiguous" });
});
test.skipIf(process.platform !== "darwin")("changed process, app birth, or topology before focus performs no actuator call", async () => {
  let reads = 0;
  const switched = fixture({ records: async () => {
    const records = await fixture().deps.records();
    return ++reads === 1 ? records : [{ ...records[0]!, pid: 11 }];
  } });
  expect(await switched.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "binding_changed" });
  expect(switched.focused).toHaveLength(0);
  const appReused = fixture({ process: async (pid) => ({ pid, parent: 1, start: pid === 30 ? "new app birth" : start, tty: "ttys001", foreground: true }) });
  expect(await appReused.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "binding_changed" });
  expect(appReused.focused).toHaveLength(0);
  let topology = 0;
  const changed = fixture({ herdr: async () => (++topology === 1
    ? { running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact" }, agentStatus: "working" }] }] }] }
    : { running: false, workspaces: [] }) as never });
  expect(await changed.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "binding_changed" });
  expect(changed.focused).toHaveLength(0);
});

test("GUI discovery errors do not revoke an otherwise valid input binding", async () => {
  const f = fixture({ terminal: async () => { throw Error("plist unavailable"); }, herdr: async () => ({ running: true,
    workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact" }, agentStatus: "working" }] }] }] }) as never });
  expect(await f.steering.inspect(ref, "here")).toMatchObject({ available: true, target: { terminal: { appPid: null } },
    focus: { available: false, code: process.platform === "darwin" ? "terminal_unavailable" : "unsupported" } });
});
test.skipIf(process.platform !== "darwin")("focus route is operator/origin protected and accepts no client-supplied host coordinates", async () => {
  const f = fixture(), app = new Hono();
  installScoutApiMiddleware(app, "focus-test", { authToken: "operator-test" });
  mountSessionSteerRoutes(app, { steering: f.steering });
  const url = "http://localhost/api/session-ref/" + encodeURIComponent(ref) + "/focus";
  const headers = { authorization: "Bearer operator-test", origin: "http://localhost", "content-type": "application/json" };
  expect((await app.request(url, { method: "POST" })).status).toBe(401);
  expect((await app.request(url, { method: "POST", headers: { ...headers, origin: "https://evil.test" }, body: '{"machine":"here"}' })).status).toBe(403);
  const response = await app.request(url, { method: "POST", headers, body: '{"machine":"here","target":{"pid":999,"address":"other","terminal":{"bundleId":"evil"}}}' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, target: { pid: 10, address: "live/w1:p2" } });
  expect(f.focused).toHaveLength(1);
  expect(f.typed()).toBe(0);
});

test.skipIf(process.platform !== "darwin")("changed attached-client identity or socket invalidates a tmux focus binding", async () => {
  const base = await fixture().deps.records();
  let terminalReads = 0;
  const clientChanged = fixture({
    records: async () => [{ ...base[0]!, tmux: { session: "live", pane: "%7", window: "@1" } }],
    tmux: async () => ({ socket: "/socket", pid: 10, tty: "ttys001", pane: "%7", session: "live" }),
    terminal: async () => ({ ...terminal(), descriptor: { ...terminal().descriptor, attached: true },
      clients: [{ pid: 20, start: ++terminalReads === 1 ? start : "a new client", tty: "ttys009" }] }),
  }, {
    readProcessHostEnv: async () => ({ TERM_PROGRAM: "tmux", TMUX: "/socket,1,0", TMUX_PANE: "%7" }),
    innermostProcessHost: () => ({ host: "tmux", pane: "%7" }),
  });
  expect(await clientChanged.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "binding_changed" });
  expect(clientChanged.focused).toHaveLength(0);
  let pass = 0;
  const socketChanged = fixture({
    records: async () => [{ ...base[0]!, tmux: { session: "live", pane: "%7", window: "@1" } }],
    tmux: async (_pane, socket) => ({ socket: socket!, pid: 10, tty: "ttys001", pane: "%7", session: "live" }),
  }, {
    readProcessHostEnv: async () => ({ TERM_PROGRAM: "tmux", TMUX: "/socket-" + (++pass) + ",1,0", TMUX_PANE: "%7" }),
    innermostProcessHost: () => ({ host: "tmux", pane: "%7" }),
  });
  expect(await socketChanged.steering.focus(ref, "here")).toMatchObject({ ok: false, code: "binding_changed" });
  expect(socketChanged.focused).toHaveLength(0);
});
test("a tmux nobody is attached to opens on the probed socket and session, not on anything the client sends", async () => {
  const opened: Array<[string[], string | null]> = [];
  const base = await fixture().deps.records();
  const f = fixture({
    records: async () => [{ ...base[0]!, tmux: { session: "live", window: "@1", pane: "%7" } }],
    tmux: async () => ({ socket: "/exact/socket", pid: 10, tty: "ttys001", pane: "%7", session: "live" }),
    terminal: async () => ({ descriptor: { app: null, bundleId: null, appPid: null, attached: false }, clients: [] }),
    openTerminal: async (argv, cwd) => { opened.push([argv, cwd]); return { app: "Terminal" }; },
  }, {
    readProcessHostEnv: async () => ({ TERM_PROGRAM: "tmux", TMUX: "/exact/socket,22,0", TMUX_PANE: "%7" }),
    innermostProcessHost: () => ({ host: "tmux", pane: "%7" }),
  });
  expect(await f.steering.openTerminal(ref, "here")).toMatchObject({ ok: true, app: "Terminal" });
  expect(opened).toEqual([[["tmux", "-S", "/exact/socket", "attach", "-t", "live"], "/repo"]]);
});
test("a background session opens in a pane of Scout's own, on the record's job id, and nothing else does", async () => {
  const started: Array<[string[], string | null, string]> = [];
  const base = await fixture().deps.records();
  const startPane = async (argv: string[], cwd: string | null, popOut: string) => { started.push([argv, cwd, popOut]); return "scout-popout-" + popOut.slice(0, 12); };
  const bg = fixture({
    records: async () => [{ ...base[0]!, kind: "bg", jobId: "job-42", name: "cleanup" }],
    terminal: async () => ({ descriptor: { app: null, bundleId: null, appPid: null }, appStart: null }) as never,
    popOutToken: () => "a".repeat(32),
    startPane,
  }, { readProcessHostEnv: async () => ({}), innermostProcessHost: () => null as never });
  expect(await bg.steering.openPane(ref, "here")).toMatchObject({ ok: true, popOut: "a".repeat(32), pane: { backend: "tmux", sessionName: "scout-popout-aaaaaaaaaaaa" } });
  expect(started).toEqual([[["claude", "attach", "job-42"], "/repo", "a".repeat(32)]]);
  // A session a window already shows has no attach of its own to start.
  const live = fixture({ startPane });
  expect(await live.steering.openPane(ref, "here")).toMatchObject({ ok: false, code: "not_background" });
  expect(started).toHaveLength(1);
});
