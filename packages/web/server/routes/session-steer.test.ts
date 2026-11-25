import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeSessionRecord } from "@openscout/runtime";
import { deliverInPlace, type DeliverInPlaceDeps } from "@openscout/runtime/in-place";
import { createSessionSteerAudit } from "../session-steer-audit.ts";
import { createSessionSteering, type SessionSteering, type SessionSteeringDeps, type InPlaceRuntime } from "../session-steering.ts";
import { installScoutApiMiddleware } from "../server-core.ts";
import { mountSessionSteerRoutes } from "./session-steer.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const ref = "session:claude:exact-session", start = "Sat Oct 10 18:00:00 2026";
const headers = { authorization: "Bearer operator-test", "content-type": "application/json", origin: "http://localhost" };
const url = (machine = "here", sessionRef = ref) => `http://localhost/api/session-ref/${encodeURIComponent(sessionRef)}/steer?machine=${machine}`;
const record = (pid = 100): ClaudeSessionRecord => ({ pid, procStart: start, sessionId: "exact-session", cwd: "/repo", startedAt: null, kind: "interactive", entrypoint: "cli", version: null, tmux: null, name: null, nameSource: null, recordPath: `/records/${pid}.json` });

async function fixture(overrides: Partial<SessionSteeringDeps> = {}, runtimeOverrides: Partial<InPlaceRuntime> = {}) {
  const root = await mkdtemp(join(tmpdir(), "session-steer-")); roots.push(root);
  const log = join(root, "control/session-steer-audit.jsonl"), audit = createSessionSteerAudit(log);
  const sent: Parameters<InPlaceRuntime["deliverInPlace"]>[] = [];
  const runtime: InPlaceRuntime = {
    readProcessHostEnv: async () => ({}), innermostProcessHost: () => null, processHostLocations: () => [],
    resolveInPlaceOrder: () => ["herdr", "orca", "tmux", "terminal"],
    codexThreadHolderPids: async () => [], codexThreadHeldByChatGPTApp: async () => false,
    readOrcaAgents: async () => [], isScoutBackgroundCopy: () => false,
    deliverInPlace: async (...args) => { sent.push(args); return { ok: true }; }, ...runtimeOverrides,
  };
  const deps: SessionSteeringDeps = {
    broker: async <T,>() => ({ endpoints: [] }) as T,
    runtime, machine: async () => "here", records: async () => [record()],
    process: async (pid) => ({ pid, parent: 1, start, tty: "ttys002", foreground: true }),
    self: async () => ({ pids: [999], ttys: ["ttys001"], hosts: [] }),
    herdr: async () => { throw new Error("Unexpected Herdr probe"); }, tmux: async () => null,
    windowTitle: async () => null,
    ...overrides,
  };
  const steering = createSessionSteering(deps), app = new Hono();
  installScoutApiMiddleware(app, "steering-test", { authToken: "operator-test" });
  mountSessionSteerRoutes(app, { steering, audit, operator: () => "Arach" });
  const post = (text = "do this next", machine = "here", sessionRef = ref) => app.request(url(machine, sessionRef), { method: "POST", headers, body: JSON.stringify({ text, operator: "spoofed" }) });
  return { app, audit, log, sent, post, deps, steering };
}

test("bound: types verbatim into exactly the native process and appends one private metadata-only audit", async () => {
  const f = await fixture();
  const capability = await f.app.request(url(), { headers });
  expect(await capability.json()).toMatchObject({ available: true, target: { pid: 100, host: "terminal", address: "ttys002" } });
  expect(f.sent).toHaveLength(0);
  const text = "  body with é\nand a secret  ", response = await f.post(text);
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]![0]).toEqual({ sessionId: "exact-session", harness: "claude", body: text });
  const pinned = f.sent[0]![1];
  expect(pinned.order).toEqual(["terminal"]);
  expect(await pinned.findHerdrPane()).toBeNull();
  expect(await pinned.codexThreadPids()).toEqual([]);
  expect(await pinned.codexHeldByApp()).toBe(false);
  expect(await pinned.ttyForPid()).toBe("ttys002");
  expect(receipt.audit).toMatchObject({ operator: "Arach", sessionRef: ref, machine: "here", outcome: "accepted", textLength: text.length, target: { pid: 100, processStart: start } });
  const raw = await readFile(f.log, "utf8");
  expect(raw.trim().split("\n")).toHaveLength(2);
  expect(receipt.audit.textSha256).toBe(createHash("sha256").update(text).digest("hex"));
  expect(JSON.parse(raw.trim().split("\n")[1]!)).not.toHaveProperty("textSha256");
  expect(raw).not.toContain("secret"); expect(raw).not.toContain("spoofed");
  expect((await stat(f.log)).mode & 0o777).toBe(0o600);
  expect((await (await f.app.request(url().replace("/steer?", "/steer/audit?"), { headers })).json()).entries).toEqual([receipt.audit]);
});

test.each([
  ["ambiguous", { records: async () => [record(100), record(101)] }, "ambiguous"],
  ["missing", { records: async () => [] }, "not_live"],
  ["reused pid", { records: async () => [{ ...record(), procStart: "an earlier process" }] }, "not_live"],
  ["self tty", { self: async () => ({ pids: [999], ttys: ["ttys002"], hosts: [] }) }, "self_target"],
  ["self process", { self: async () => ({ pids: [100], ttys: [], hosts: [] }) }, "self_target"],
  ["no foreground process", { process: async (pid: number) => ({ pid, parent: 1, start, tty: "ttys002", foreground: false }) }, "not_foreground"],
] as const)("%s refuses and records exactly one attempt", async (_name, overrides, code) => {
  const f = await fixture(overrides);
  expect((await f.post()).status).toBe(409); expect(f.sent).toEqual([]);
  expect(await f.audit.read(ref, "here")).toMatchObject([{ outcome: "refused", code }]);
});

test("remote-refused even if the local machine has an identical native id", async () => {
  const f = await fixture({ records: async () => { throw new Error("Must not probe a local lookalike"); } });
  const response = await f.post("hello", "remote");
  expect(response.status).toBe(409);
  expect((await response.json()).audit.code).toBe("remote_refused");
  expect(await f.audit.read(ref, "remote")).toHaveLength(1);
  expect(await f.audit.read(ref, "here")).toEqual([]); expect(f.sent).toEqual([]);
});

const tmuxEnv = { TERM_PROGRAM: "tmux", TMUX: "/tmp/socket,77,0", TMUX_PANE: "%8" };
test("tmux uses only a matching default socket and birth-verified pane", async () => {
  const f = await fixture({ records: async () => [{ ...record(), tmux: { session: "live", pane: "%8", window: "@1" } }],
    tmux: async () => ({ socket: "/tmp/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }) },
  { readProcessHostEnv: async () => tmuxEnv, innermostProcessHost: () => ({ host: "tmux", pane: "%8" }) });
  expect((await f.post()).status).toBe(200); expect(f.sent[0]![1].order).toEqual(["tmux"]);
});
test("self-pane-refused even when the server has no tty", async () => {
  const f = await fixture({ self: async () => ({ pids: [999], ttys: [], hosts: [{ host: "tmux", pane: "%8" }] }) },
    { readProcessHostEnv: async () => tmuxEnv, innermostProcessHost: () => ({ host: "tmux", pane: "%8" }) });
  expect((await (await f.post()).json()).audit.code).toBe("self_target"); expect(f.sent).toEqual([]);
});
test("a similarly numbered pane on another tmux socket is not a target", async () => {
  const f = await fixture({ tmux: async () => ({ socket: "/different/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }) },
    { readProcessHostEnv: async () => tmuxEnv, innermostProcessHost: () => ({ host: "tmux", pane: "%8" }) });
  expect((await (await f.post()).json()).audit.code).toBe("tmux_unverified"); expect(f.sent).toEqual([]);
});

test("Herdr delivery is pinned to the pane that confirms the native session", async () => {
  const host = { host: "herdr" as const, session: "herdr-live", paneId: "w1:p2" };
  const f = await fixture({ herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact-session" }, agentStatus: "working" }] }] }] }) as never },
    { innermostProcessHost: () => host });
  expect((await f.post()).status).toBe(200);
  expect(f.sent[0]![1].order).toEqual(["herdr"]);
  expect(await f.sent[0]![1].findHerdrPane()).toEqual({ session: "herdr-live", paneId: "w1:p2", status: "working" });
});
test("Herdr duplicate session panes refuse instead of choosing the first", async () => {
  const f = await fixture({ herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: ["w1:p2", "w1:p3"].map((paneId) => ({ paneId, agentSession: { value: "exact-session" }, agentStatus: "working" })) }] }] }) as never },
    { innermostProcessHost: () => ({ host: "herdr", session: "herdr-live", paneId: "w1:p2" }) });
  expect((await (await f.post()).json()).audit.code).toBe("host_unverified"); expect(f.sent).toEqual([]);
});
test.each(["working", "waiting"] as const)("Codex Orca %s is bound or blocked without opening the native app", async (state) => {
  const f = await fixture({}, {
    codexThreadHolderPids: async () => [100],
    innermostProcessHost: () => ({ host: "orca", terminalHandle: "term_2", paneKey: "p2", worktreeId: "w1" }),
    readOrcaAgents: async () => [{ paneKey: "p2", state, agentType: "codex", worktreeId: "w1", worktreePath: "/repo", lastAssistantMessage: null }],
  });
  const response = await f.post("go", "here", "session:codex:exact-session");
  expect(response.status).toBe(state === "working" ? 200 : 409);
  expect(f.sent).toHaveLength(state === "working" ? 1 : 0);
  if (state === "working") expect(f.sent[0]![1].order).toEqual(["orca"]);
});
test("the configured host order chooses between verified bindings for the same process", async () => {
  const f = await fixture({
    records: async () => [{ ...record(), tmux: { session: "live", pane: "%8", window: "@1" } }],
    tmux: async () => ({ socket: "/tmp/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }),
    herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact-session" }, agentStatus: "working" }] }] }] }) as never,
  }, { readProcessHostEnv: async () => tmuxEnv,
    innermostProcessHost: () => ({ host: "herdr", session: "herdr-live", paneId: "w1:p2" }),
    resolveInPlaceOrder: () => ["tmux", "herdr", "orca", "terminal"],
  });
  expect((await f.post()).status).toBe(200); expect(f.sent[0]![1].order).toEqual(["tmux"]);
});
test("Codex native-app ownership and ambiguous holders refuse", async () => {
  const app = await fixture({}, { codexThreadHeldByChatGPTApp: async () => true });
  expect((await (await app.post("go", "here", "session:codex:exact-session")).json()).audit.code).toBe("native_app_refused");
  expect(app.sent).toEqual([]);
  const ambiguous = await fixture({}, { codexThreadHolderPids: async () => [100, 101] });
  expect((await (await ambiguous.post("go", "here", "session:codex:exact-session")).json()).audit.code).toBe("ambiguous");
  expect(ambiguous.sent).toEqual([]);
});
test("concurrent steers cannot interleave input into the same pane", async () => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const f = await fixture({}, { deliverInPlace: async () => { calls++; started(); await gate; return { ok: true }; } });
  const first = f.post("one"); await entered;
  expect((await (await f.post("two")).json()).audit.code).toBe("busy");
  release(); expect((await first).status).toBe(200); expect(calls).toBe(1);
  expect(await f.audit.read(ref, "here")).toHaveLength(2);
});

test("a changed process between verification and actuation is refused", async () => {
  let reads = 0;
  const f = await fixture({ records: async () => [record(++reads === 1 ? 100 : 101)] });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test("host failure is final, metadata-only, and never retried", async () => {
  let calls = 0;
  const f = await fixture({}, { deliverInPlace: async () => { calls++; throw new Error("argv includes TOP SECRET TEXT"); } });
  expect((await f.post("TOP SECRET TEXT")).status).toBe(409); expect(calls).toBe(1);
  const rows = await f.audit.read(ref, "here");
  expect(rows).toHaveLength(1); expect(rows[0]!.code).toBe("delivery_unconfirmed");
  expect(JSON.stringify(rows)).not.toContain("TOP SECRET");
});
test("invalid text is also audited, without actuation", async () => {
  const f = await fixture();
  expect((await f.post("   ")).status).toBe(400);
  expect((await f.post("a".repeat(32_001))).status).toBe(400);
  expect((await f.audit.read(ref, "here")).map((r) => r.textLength)).toEqual([32_001, 3]);
  expect(f.sent).toEqual([]);
});
test("unqualified refs and missing machine cannot guess an execution target", async () => {
  const f = await fixture();
  expect((await (await f.post("hi", "here", "exact-session")).json()).audit.code).toBe("invalid_session");
  expect((await (await f.post("hi", "")).json()).audit.code).toBe("machine_unverified");
  expect(f.sent).toEqual([]);
});
test("audit is append-only, newest-first, capped, and scoped to the exact session and machine", async () => {
  const f = await fixture();
  await f.post("one"); const before = await readFile(f.log, "utf8");
  await f.post("two"); await f.post("three", "remote"); await f.post("four", "here", "session:claude:another");
  expect((await readFile(f.log, "utf8")).startsWith(before)).toBe(true);
  expect(await f.audit.read(ref, "here", 1)).toMatchObject([{ textLength: 3, outcome: "accepted" }]);
  expect(await f.audit.read(ref, "here")).toHaveLength(2);
  expect(await f.audit.read("session:claude:another", "remote")).toEqual([]);
});
test("unavailable audit prevents typing", async () => {
  const f = await fixture(), app = new Hono();
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => { throw new Error("disk unavailable"); } } });
  expect((await app.request(url(), { method: "POST", body: JSON.stringify({ text: "no" }) })).status).toBe(503);
  expect(f.sent).toEqual([]);
});
test("operator gate and origin checks protect capability, read and write routes", async () => {
  const f = await fixture();
  for (const path of [url(), url().replace("/steer?", "/steer/audit?")]) {
    expect((await f.app.request(path)).status).toBe(401);
    expect((await f.app.request(path, { headers: { ...headers, origin: "https://evil.test" } })).status).toBe(403);
  }
  expect((await f.app.request(url(), { method: "POST", body: JSON.stringify({ text: "no" }) })).status).toBe(401);
  expect(f.sent).toEqual([]);
});

test("a process exit after host probing or after intent fsync prevents actuation", async () => {
  let reads = 0;
  const f = await fixture({ process: async (pid) => ++reads < 3 ? { pid, parent: 1, start, tty: "ttys002", foreground: true } : null });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed");
  expect(f.sent).toEqual([]); expect(await f.audit.read(ref, "here")).toMatchObject([{ outcome: "refused", code: "binding_changed" }]);
});
test("a session switched inside the same process is not steered", async () => {
  let reads = 0;
  const f = await fixture({ records: async () => [{ ...record(), sessionId: ++reads < 3 ? "exact-session" : "another-session" }] });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test.each([start, null])("a second holder appearing during audit fsync prevents actuation (birth: %s)", async (procStart) => {
  let reads = 0;
  const f = await fixture({ records: async () => ++reads < 3 ? [record()] : [record(), { ...record(101), procStart }] });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test("Codex native-app ownership appearing during audit fsync prevents actuation", async () => {
  let reads = 0;
  const f = await fixture({}, {
    codexThreadHeldByChatGPTApp: async () => ++reads >= 3,
    codexThreadHolderPids: async () => [100],
    innermostProcessHost: () => ({ host: "orca", terminalHandle: "term_2", paneKey: "p2", worktreeId: "w1" }),
    readOrcaAgents: async () => [{ paneKey: "p2", state: "working", agentType: "codex", worktreeId: "w1", worktreePath: "/repo", lastAssistantMessage: null }],
  });
  const response = await f.post("go", "here", "session:codex:exact-session");
  expect((await response.json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test("an unverified second native process cannot be silently ignored", async () => {
  const f = await fixture({ records: async () => [record(), { ...record(101), procStart: null }] });
  expect((await (await f.post()).json()).audit.code).toBe("unverified_process"); expect(f.sent).toEqual([]);
});
test("crash between intent and outcome folds to one Unconfirmed attempt after restart", async () => {
  const f = await fixture(); await f.post();
  const intent = JSON.parse((await readFile(f.log, "utf8")).split("\n")[0]!);
  const recoveryPath = `${f.log}.recovery`, sink = await createSessionSteerAudit(recoveryPath).open();
  await sink.append(intent); await sink.close(); // Crash: deliberately no outcome.
  const restarted = createSessionSteerAudit(recoveryPath);
  expect(await restarted.read(ref, "here")).toMatchObject([{ id: intent.entry.id, outcome: "unconfirmed", code: "dispatch_started" }]);
  expect(await restarted.read(ref, "here")).toHaveLength(1);
});
test("duplicate outcomes fold to the first and are flagged, never changing intent metadata", async () => {
  const f = await fixture(), receipt = await (await f.post()).json();
  const sink = await f.audit.open();
  await sink.append({ kind: "outcome", id: receipt.audit.id, outcome: "refused", code: "contradiction", reason: "late failure" }); await sink.close();
  const entries = await f.audit.read(ref, "here");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ ...receipt.audit, outcome: "accepted", duplicateOutcomes: 1 });
});
test("intent append failure prevents typing, not just failure to open the audit", async () => {
  const f = await fixture(), app = new Hono();
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => ({ append: async () => { throw new Error("full disk"); }, close: async () => {} }) } });
  expect((await app.request(url(), { method: "POST", body: JSON.stringify({ text: "no" }) })).status).toBe(503); expect(f.sent).toEqual([]);
});
test("outcome append failure preserves the synced intent as Unconfirmed and does not retry", async () => {
  const f = await fixture(), app = new Hono(); let appends = 0;
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => {
    const sink = await f.audit.open(); return { ...sink, append: async (row) => { if (++appends > 1) throw new Error("disk stopped"); await sink.append(row); } };
  } } });
  expect((await app.request(url(), { method: "POST", body: JSON.stringify({ text: "maybe sent" }) })).status).toBe(503);
  expect(f.sent).toHaveLength(1);
  expect(await f.audit.read(ref, "here")).toMatchObject([{ outcome: "unconfirmed", code: "dispatch_started" }]);
});
test("cleanup errors do not erase a durable accepted receipt or echo exception text", async () => {
  const f = await fixture(), app = new Hono();
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => {
    const sink = await f.audit.open(); return { ...sink, close: async () => { await sink.close(); throw new Error("private exception"); } };
  } } });
  const response = await app.request(url(), { method: "POST", body: JSON.stringify({ text: "hi" }) });
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("private exception");
  expect(f.sent).toHaveLength(1);
});

// Exercise the real upstream cascade, with every actuator replaced. This is
// contract verification, not live host input or a second discovery path.
async function runtimeContractFixture(harness: "claude" | "codex", host: "herdr" | "orca" | "tmux" | "terminal", mode: "accepted" | "failed" | "vanished" = "accepted") {
  const calls: string[] = [];
  const inputs: { target: unknown; body: string }[] = [];
  const actuator = (name: string) => async (target: unknown, body: string) => {
    calls.push(name);
    inputs.push({ target, body });
    if (mode === "failed") throw new Error("fixture host failure");
  };
  const actuators: DeliverInPlaceDeps = { promptHerdr: actuator("herdr"), promptOrca: actuator("orca"),
    promptTmux: actuator("tmux"), typeIntoTty: actuator("terminal"), typeIntoCodexApp: actuator("native-app"),
    askScoutApp: async () => { calls.push("native-app-socket"); return { ok: true, accessibility: "granted" }; },
    // The core types only into a composer it can prove empty; these fixture surfaces are.
    composerEmpty: async () => true };
  const f = await fixture({
    records: async () => [{ ...record(), tmux: host === "tmux" ? { session: "live", pane: "%8", window: "@1" } : null }],
    tmux: async () => ({ socket: "/tmp/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }),
    herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact-session" }, agentStatus: "working" }] }] }] }) as never,
  }, {
    codexThreadHolderPids: async () => [100],
    readProcessHostEnv: async () => host === "tmux" ? tmuxEnv : {},
    innermostProcessHost: () => host === "herdr" ? { host, session: "herdr-live", paneId: "w1:p2" }
      : host === "orca" ? { host, terminalHandle: "term_2", paneKey: "p2", worktreeId: "w1" }
      : host === "tmux" ? { host, pane: "%8" } : null,
    readOrcaAgents: async () => [{ paneKey: "p2", state: "working", agentType: harness, worktreeId: "w1", worktreePath: "/repo", lastAssistantMessage: null }],
    deliverInPlace: (input, pinned) => deliverInPlace(input, { ...pinned, ...actuators,
      ...(mode === "vanished" ? { locateProcess: async () => null } : {}) }),
  });
  return { ...f, calls, inputs, response: await f.post("  exact input\né  ", "here", `session:${harness}:exact-session`) };
}

test.each([
  ["claude", "herdr"], ["claude", "orca"], ["claude", "tmux"], ["claude", "terminal"],
  ["codex", "herdr"], ["codex", "orca"],
] as const)("real runtime contract: %s uses only its pinned %s actuator", async (harness, host) => {
  const f = await runtimeContractFixture(harness, host);
  expect(f.response.status).toBe(200); expect(f.calls).toEqual([host]);
  const target = host === "herdr" ? { session: "herdr-live", paneId: "w1:p2", status: "working" }
    : host === "orca" ? "term_2" : host === "tmux" ? "%8" : "ttys002";
  expect(f.inputs).toEqual([{ target, body: "  exact input\né  " }]);
  expect((await f.response.json()).audit).toMatchObject({ outcome: "accepted", target: { host, pid: 100 } });
});
test("real runtime contract: failed actuator never falls through to another host", async () => {
  const f = await runtimeContractFixture("claude", "orca", "failed");
  expect(f.response.status).toBe(409); expect(f.calls).toEqual(["orca"]);
  expect((await f.response.json()).audit.outcome).toBe("unconfirmed");
});
test("real runtime contract: missing pinned Codex host never opens the native app", async () => {
  const f = await runtimeContractFixture("codex", "orca", "vanished");
  expect(f.response.status).toBe(409); expect(f.calls).toEqual([]);
});

const nativeEndpoint = { id: "endpoint.live", agentId: "agent.live", nodeId: "here", harness: "codex", transport: "codex_app_server", state: "active", sessionId: "scout-session", metadata: { placement: "background", externalSessionId: "native-thread" } };
const nativeObservation = { state: "active", sessionId: "native-thread", token: "incarnation:turn", turnId: "turn", steer: true };
function nativeBroker() {
  const writes: unknown[] = [];
  let endpoints = [nativeEndpoint], observation = nativeObservation;
  const request = async <T,>(path: string, body?: unknown): Promise<T> => {
    if (path === "/v1/endpoints") return { endpoints } as T;
    if (path !== "/v1/native-session-attention") throw new Error(`Unexpected broker path ${path}`);
    if ((body as any)?.action) { writes.push(body); return { accepted: true, evidence: "codex_turn_steer_accepted" } as T; }
    return observation as T;
  };
  return { request, writes, endpoints: (next: typeof endpoints) => { endpoints = next; }, observe: (next: typeof observation) => { observation = next; } };
}

test("broker-owned running Codex session delivers verbatim through native owner and the same Sent audit", async () => {
  const broker = nativeBroker();
  const f = await fixture({ broker: broker.request });
  const nativeRef = "session:codex:native-thread";
  expect(await (await f.app.request(url("here", nativeRef), { headers })).json()).toMatchObject({ available: true, target: { host: "broker", endpointId: nativeEndpoint.id, transport: "codex_app_server" } });
  expect(broker.writes).toHaveLength(0);
  const receipt = await (await f.post("  exact input\n", "here", nativeRef)).json();
  expect(receipt).toMatchObject({ ok: true, audit: { outcome: "accepted", target: { host: "broker", endpointId: nativeEndpoint.id, transport: "codex_app_server" } } });
  expect(receipt.audit.reason).not.toContain(nativeEndpoint.id);
  expect(broker.writes).toEqual([{ endpointId: nativeEndpoint.id, sessionId: "native-thread", token: "incarnation:turn", action: "steer", prompt: "  exact input\n" }]);
  expect(f.sent).toHaveLength(0);
  expect(await f.audit.read(nativeRef, "here")).toHaveLength(1);
});

test("any harness the runtime owns is steered without a terminal; one it doesn't own is refused plainly", async () => {
  const broker = nativeBroker();
  broker.endpoints([{ ...nativeEndpoint, id: "endpoint.grok", harness: "grok", transport: "grok_acp", metadata: { placement: "background", externalSessionId: "grok-thread" } }]);
  broker.observe({ ...nativeObservation, sessionId: "grok-thread" });
  const f = await fixture({ broker: broker.request });
  const receipt = await (await f.post("steer grok", "here", "session:grok:grok-thread")).json();
  expect(receipt).toMatchObject({ ok: true, audit: { outcome: "accepted", target: { host: "broker", transport: "grok_acp" } } });
  expect(broker.writes).toEqual([{ endpointId: "endpoint.grok", sessionId: "grok-thread", token: "incarnation:turn", action: "steer", prompt: "steer grok" }]);
  expect(f.sent).toHaveLength(0);
  const unowned = await (await f.post("no owner", "here", "session:grok:other-thread")).json();
  expect(unowned.audit.code).toBe("not_owned");
  expect(broker.writes).toHaveLength(1);
});

test("terminal delivery keeps priority and remote pins never use a broker lookalike", async () => {
  const broker = nativeBroker();
  const f = await fixture({ broker: broker.request });
  await f.post();
  expect(f.sent).toHaveLength(1); expect(broker.writes).toHaveLength(0);
  expect((await f.post("no", "away", "session:codex:native-thread")).status).toBe(409);
  expect(broker.writes).toHaveLength(0);
});

test("native broker dispatch revalidates after audit, never revives or retries a changed turn", async () => {
  const broker = nativeBroker();
  const f = await fixture({ broker: broker.request });
  const result = await f.steering.steer("session:codex:native-thread", "here", "input", async () => {
    broker.observe({ ...nativeObservation, token: "new-turn" });
  });
  expect(result).toMatchObject({ available: false, code: "binding_changed" });
  expect(broker.writes).toHaveLength(0);
});

test("live app-server without a TTY uses the broker; a terminal holder never falls back", async () => {
  const broker = nativeBroker();
  const f = await fixture({ broker: broker.request, process: async pid => ({ pid, parent: 1, start, tty: null, foreground: false }) },
    { codexThreadHolderPids: async () => [100] });
  expect((await f.post("input", "here", "session:codex:native-thread")).status).toBe(200);
  expect(broker.writes).toHaveLength(1);
  const terminal = await fixture({ broker: broker.request }, { codexThreadHolderPids: async () => [100] });
  expect((await terminal.post("no host", "here", "session:codex:native-thread")).status).toBe(409);
  expect(broker.writes).toHaveLength(1);
});

test.each([
  ["remote", { ...nativeEndpoint, nodeId: "away" }],
  ["offline", { ...nativeEndpoint, state: "offline" }],
  ["retired", { ...nativeEndpoint, metadata: { ...nativeEndpoint.metadata, staleLocalRegistration: true } }],
  ["other execution", { ...nativeEndpoint, metadata: { ...nativeEndpoint.metadata, externalSessionId: "other-thread" } }],
  ["terminal transport", { ...nativeEndpoint, transport: "tmux" }],
  ["pane", { ...nativeEndpoint, pane: "%1" }],
] as const)("broker %s cannot accept input", async (_label, endpoint) => {
  const broker = nativeBroker(); broker.endpoints([endpoint]);
  const f = await fixture({ broker: broker.request });
  expect((await f.post("no", "here", "session:codex:native-thread")).status).toBe(409);
  expect(broker.writes).toHaveLength(0);
});

test.each(["gone", "unknown"])("broker %s is not revived, connected or resumed", async state => {
  const broker = nativeBroker(); broker.observe({ ...nativeObservation, state });
  const f = await fixture({ broker: broker.request });
  expect((await f.post("no", "here", "session:codex:native-thread")).status).toBe(409);
  expect(broker.writes).toHaveLength(0);
});

test("broker rejects duplicate endpoints, oversized native input and unavailable audit", async () => {
  const broker = nativeBroker(); broker.endpoints([nativeEndpoint, { ...nativeEndpoint, id: "second" }]);
  const f = await fixture({ broker: broker.request });
  expect((await f.post("no", "here", "session:codex:native-thread")).status).toBe(409);
  broker.endpoints([nativeEndpoint]);
  expect((await f.post("é".repeat(2049), "here", "session:codex:native-thread")).status).toBe(409);
  expect(await f.steering.steer("session:codex:native-thread", "here", "no", async () => { throw new Error("disk"); })).toMatchObject({ code: "audit_unavailable" });
  expect(broker.writes).toHaveLength(0);
});

test("broker exceptions are unconfirmed, redacted and never retried", async () => {
  const broker = nativeBroker(); let attempts = 0;
  const f = await fixture({ broker: async <T,>(path: string, body?: unknown): Promise<T> => {
    if ((body as any)?.action) { attempts++; throw new Error("secret body"); }
    return broker.request<T>(path, body);
  } });
  const receipt = await (await f.post("secret body", "here", "session:codex:native-thread")).json();
  expect(attempts).toBe(1);
  expect(receipt.audit).toMatchObject({ outcome: "unconfirmed", code: "delivery_unconfirmed" });
  const raw = await readFile(f.log, "utf8");
  expect(raw).not.toContain("secret body"); expect(raw).not.toContain("incarnation:turn");
});

test.each(["endpoint removed", "terminal appeared"])("broker refuses after audit when %s", async change => {
  const broker = nativeBroker(); let holders: number[] = [];
  const f = await fixture({ broker: broker.request }, { codexThreadHolderPids: async () => holders });
  expect(await f.steering.steer("session:codex:native-thread", "here", "no", async () => {
    if (change === "endpoint removed") broker.endpoints([]);
    else holders = [100];
  })).toMatchObject({ available: false, code: "binding_changed" });
  expect(broker.writes).toHaveLength(0); expect(f.sent).toHaveLength(0);
});

test("broker token rejection is final with one unconfirmed Sent receipt", async () => {
  const broker = nativeBroker(); let writes = 0;
  const f = await fixture({ broker: async <T,>(path: string, body?: unknown): Promise<T> => {
    if ((body as any)?.action) { writes++; return { accepted: false, evidence: "native_state_changed" } as T; }
    return broker.request<T>(path, body);
  } });
  const receipt = await (await f.post("no", "here", "session:codex:native-thread")).json();
  expect(receipt).toMatchObject({ ok: false, audit: { outcome: "unconfirmed", code: "delivery_unconfirmed" } });
  expect(writes).toBe(1); expect(f.sent).toHaveLength(0);
});

test.each([
  { ...nativeObservation, sessionId: "different-thread" },
  { ...nativeObservation, token: "" },
  { ...nativeObservation, steer: false },
  { ...nativeObservation, turnId: "" },
])("broker requires exact native identity and positive mid-turn capability %#", async observation => {
  const broker = nativeBroker(); broker.observe(observation);
  const f = await fixture({ broker: broker.request });
  expect((await f.post("no", "here", "session:codex:native-thread")).status).toBe(409);
  expect(broker.writes).toHaveLength(0);
});


test.each(["codex_app_server", "claude_stream_json"])("idle %s starts only a turn in the existing live native session", async transport => {
  const broker = nativeBroker();
  const harness = transport === "codex_app_server" ? "codex" : "claude";
  broker.endpoints([{ ...nativeEndpoint, harness, transport, state: "idle" }]);
  broker.observe({ ...nativeObservation, state: "idle", turnId: "", steer: false });
  const f = await fixture({ broker: broker.request, records: async () => [] });
  const ref = `session:${harness}:native-thread`;
  const ready = await (await f.app.request(url("here", ref), { headers })).json();
  expect(ready).toMatchObject({ available: true, reason: `Sends into the running session on ${require("node:os").hostname()}.`,
    target: { host: "broker", endpointId: nativeEndpoint.id, transport } });
  const receipt = await (await f.post("next turn", "here", ref)).json();
  expect(receipt).toMatchObject({ ok: true, audit: { outcome: "accepted", target: { host: "broker", endpointId: nativeEndpoint.id, transport } } });
  expect(broker.writes).toEqual([{ endpointId: nativeEndpoint.id, sessionId: "native-thread", token: "incarnation:turn", action: "revive", prompt: "next turn" }]);
  expect(f.sent).toHaveLength(0);
});

test("idle owner becoming active during audit cannot receive an unintended follow-up or steer", async () => {
  const broker = nativeBroker(); broker.observe({ ...nativeObservation, state: "idle", turnId: "", steer: false });
  const f = await fixture({ broker: broker.request });
  expect(await f.steering.steer("session:codex:native-thread", "here", "no", async () => broker.observe(nativeObservation)))
    .toMatchObject({ available: false, code: "binding_changed" });
  expect(broker.writes).toHaveLength(0);
});

test.skipIf(process.platform !== "darwin")("default process reader verifies the real ps birth timestamp before terminal policy", async () => {
  const { execSystemFile } = await import("@openscout/runtime/system-probes");
  const observed = await execSystemFile("ps", ["-p", String(process.pid), "-o", "lstart="], {
    timeoutMs: 2000, env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
  });
  const f = await fixture();
  const { process: _fixtureProcess, ...deps } = f.deps;
  const steering = createSessionSteering({
    ...deps, records: async () => [{ ...record(process.pid), procStart: observed.stdout.trim() }],
    self: async () => ({ pids: [], ttys: [], hosts: [] }),
  });
  const result = await steering.inspect(ref, "here");
  // The test runner usually has no foreground tty, which is a later gate.
  // A live process with matching birth evidence must not fail the birth gate.
  expect(result.code).not.toBe("not_live");
  expect(result.code).not.toBe("probe_failed");
  expect(["not_foreground", "ready"]).toContain(result.code);
  expect(f.sent).toEqual([]);
});

test("a Claude background session is never typed into; open-terminal attaches it by the record's own job id", async () => {
  const opened: Array<[string[], string | null, string]> = [];
  const token = "0123456789abcdef0123456789abcdef";
  const { app, post, sent } = await fixture({
    records: async () => [{ ...record(), kind: "bg", jobId: "6d2d72b9", name: "disk-cleanup-playbook" }],
    openTerminal: async (argv, cwd, popOut) => { opened.push([argv, cwd, popOut]); return { app: "Ghostty", bundleId: "com.mitchellh.ghostty", pid: 4242 }; },
    popOutToken: () => token,
  });
  const capability = await (await app.request(url(), { headers })).json();
  expect(capability).toMatchObject({ available: false, code: "no_window",
    target: { host: "terminal", tty: "ttys002", job: { id: "6d2d72b9", name: "disk-cleanup-playbook" } },
    focus: { available: false, code: "background_job" } });
  expect((await post("yes")).status).toBe(409);
  expect(sent).toHaveLength(0);
  const open = (body: unknown) => app.request(`http://localhost/api/session-ref/${encodeURIComponent(ref)}/open-terminal`, { method: "POST", headers, body: JSON.stringify(body) });
  const res = await open({ machine: "here", jobId: "spoofed", argv: ["sh", "-c", "spoofed"] });
  expect(res.status).toBe(200);
  // A pop-out: its token for Done, and the app that drew it, to place and point at.
  expect(await res.json()).toEqual({ ok: true, code: "opened", reason: "Opened in Ghostty.", app: "Ghostty", popOut: token,
    terminal: { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 4242 } });
  expect(opened).toEqual([[["claude", "attach", "6d2d72b9"], "/repo", token]]);
  expect((await open({ machine: "elsewhere" })).status).toBe(409);
  expect(opened).toHaveLength(1);
});

test("close-terminal hangs up a pop-out by its token, on this host only", async () => {
  const closed: string[] = [];
  const token = "0123456789abcdef0123456789abcdef";
  const { app } = await fixture({ closePopOut: async (popOut) => { closed.push(popOut); return popOut === token ? 2 : 0; } });
  const close = (body: unknown) => app.request(`http://localhost/api/session-ref/${encodeURIComponent(ref)}/close-terminal`, { method: "POST", headers, body: JSON.stringify(body) });
  const res = await close({ machine: "here", popOut: token });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, code: "closed" });
  expect(await (await close({ machine: "here", popOut: "f".repeat(32) })).json()).toMatchObject({ ok: false, code: "gone" });
  expect(await (await close({ machine: "elsewhere", popOut: token })).json()).toMatchObject({ ok: false, code: "machine_unverified" });
  // Anything but a token Scout minted never reaches the process table.
  for (const popOut of ["", "x; kill -9 1", token.toUpperCase(), 42, null]) {
    expect(await (await close({ machine: "here", popOut })).json()).toMatchObject({ ok: false, code: "invalid_pop_out" });
  }
  expect(closed).toEqual([token, "f".repeat(32)]);
});

test("open-terminal refuses a session a window already shows", async () => {
  const { app } = await fixture({ openTerminal: async () => { throw new Error("must not open"); } });
  const res = await app.request(`http://localhost/api/session-ref/${encodeURIComponent(ref)}/open-terminal`, { method: "POST", headers, body: JSON.stringify({ machine: "here" }) });
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe("not_attachable");
});

test("open-thread opens a Codex thread in the ChatGPT app only when the app holds it", async () => {
  const urls: string[] = [];
  const codexRef = "session:codex:019a-thread";
  const openThread = (app: Hono, sessionRef: string) => app.request(`http://localhost/api/session-ref/${encodeURIComponent(sessionRef)}/open-thread`, { method: "POST", headers, body: JSON.stringify({ machine: "here" }) });
  const held = await fixture({ openUrl: async (u) => { urls.push(u); } }, { codexThreadHeldByChatGPTApp: async () => true });
  const res = await openThread(held.app, codexRef);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, app: "ChatGPT" });
  expect(urls).toEqual(["codex://threads/019a-thread"]);
  const free = await fixture({ openUrl: async () => { throw new Error("must not open"); } });
  const refused = await openThread(free.app, codexRef);
  expect(refused.status).toBe(409);
  expect((await refused.json()).code).not.toBe("opened");
  expect((await (await openThread(free.app, ref)).json()).code).toBe("not_app_thread");
});

test("a GUI terminal's window title rides on the target", async () => {
  const titles: string[] = [];
  const { app } = await fixture({
    terminal: async () => ({ descriptor: { app: "Terminal", bundleId: "com.apple.Terminal", appPid: 9 }, appStart: start }),
    windowTitle: async (tty) => { titles.push(tty); return "disk-cleanup — claude"; },
  });
  const capability = await (await app.request(url(), { headers })).json();
  expect(capability.target.terminal).toMatchObject({ app: "Terminal", window: "disk-cleanup — claude" });
  expect(titles).toEqual(["ttys002"]);
});

test("pane: names the proved tmux session of a live session on its host, and says why not otherwise", async () => {
  const app = new Hono();
  installScoutApiMiddleware(app, "steering-test", { authToken: "operator-test" });
  const steering = {
    inspect: async (_ref: string, machine: string | null) => machine === "here"
      ? { available: true, code: "ready", reason: "ready", target: { pid: 9, processStart: "s", host: "tmux", address: "%3", tty: "/dev/ttys004" } }
      : { available: false, code: "remote_refused", reason: "another machine", target: null },
  } as unknown as SessionSteering;
  mountSessionSteerRoutes(app, {
    steering,
    pane: {
      paneOf: async (id) => (id === "%3" ? { session: "work", tty: "/dev/ttys004" } : null),
      tmuxSession: async (name) => (name === "work" ? { session: "work", attached: true, socket: null, cwd: "/repo" } : null),
    },
  });
  const pane = (machine?: string) => app.request(`http://localhost/api/session-ref/${encodeURIComponent(ref)}/pane`, {
    method: "POST", headers, body: JSON.stringify(machine ? { machine } : {}),
  });
  const here = await pane("here");
  expect(here.status).toBe(200);
  expect(await here.json()).toMatchObject({ ok: true, pane: { backend: "tmux", sessionName: "work" } });
  const there = await pane("elsewhere");
  expect(there.status).toBe(409);
  expect(await there.json()).toMatchObject({ ok: false, code: "no_pane" });
  expect((await pane()).status).toBe(400);
});
