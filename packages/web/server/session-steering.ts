import { requestScoutBrokerJson } from "@openscout/runtime/broker-api";
import { resolveBrokerSocketPathForBaseUrl } from "@openscout/runtime/broker-process-manager";
import type { AgentEndpoint } from "@openscout/protocol";
import { hostname } from "node:os";
import { readClaudeSessionRecords, type ClaudeSessionRecord } from "@openscout/runtime";
import { execSystemFile, readHerdrTopology } from "@openscout/runtime/system-probes";
import { readScoutBrokerHealth, resolveScoutBrokerUrl } from "./core/broker/service.ts";
import { createTerminalDiscovery, focusSessionTerminal, sessionFocusCapability,
  type SessionProcess, type TmuxPaneBinding, type TerminalConnection, type SessionFocusBinding } from "./session-terminal.ts";
import { closeLocalTerminalPopOut, isPopOutToken, newPopOutToken, openLocalTerminalAttach } from "./local-terminal-open.ts";
import { endPopOutPane, startPopOutPane } from "./tmux-pane.ts";
import { answerBackgroundPrompt, backgroundPromptDeps, type BackgroundPromptDeps } from "./background-prompt.ts";
import type { SessionAnswerPromptResult, SessionPromptDecision, SessionFocusResult, SessionOpenPaneResult, SessionOpenPlaceResult, SessionSteerAvailability, SessionSteerTarget, SessionSteerTerminalTarget } from "../shared/api/session-steer.ts";

// Terminal input requires ONE birth-checked process and an exact live host.
// Background input instead requires the broker's existing native owner and its
// incarnation/turn token. Neither path can resume, fork or launch a session.
type HostEnv = Partial<Record<"TERM_PROGRAM" | "HERDR_SESSION" | "HERDR_PANE_ID" | "ORCA_TERMINAL_HANDLE" | "ORCA_PANE_KEY" | "ORCA_WORKTREE_ID" | "TMUX" | "TMUX_PANE", string>>;
type HostLocation = { host: "herdr"; session: string; paneId: string }
  | { host: "orca"; terminalHandle: string; paneKey: string | null; worktreeId: string | null }
  | { host: "tmux"; pane: string };
type HerdrPane = { session: string; paneId: string; status: string | null };
type OrcaAgent = { paneKey: string; agentType: string | null; state: "working" | "blocked" | "waiting" | "done" | "unknown"; worktreeId: string; worktreePath: string | null; lastAssistantMessage: string | null };
type Process = SessionProcess;
type Binding = { sessionId: string; harness: "claude" | "codex"; target: SessionSteerTerminalTarget; tmux: TmuxPaneBinding | null; focusBinding?: SessionFocusBinding; record: ClaudeSessionRecord | null; host: HostLocation | null; herdr: HerdrPane | null; orca: OrcaAgent[] };
type NativeObservation = { state: string; sessionId?: string; token?: string; turnId?: string; steer?: boolean };
type BrokerBinding = { kind: "broker"; endpointId: string; sessionId: string; token: string; action: "revive" | "steer"; target: Extract<SessionSteerTarget, { host: "broker" }> };
type Bound = { available: true; binding: Binding | BrokerBinding } | { available: false; code: string; reason: string; target: SessionSteerTarget | null; focus?: SessionSteerAvailability["focus"] };

// The interface is the runtime API in PR #1236. Keep that implementation in
// runtime; this layer only restricts its discovery and records operator input.
export type InPlaceRuntime = {
  readProcessHostEnv(pid: number): Promise<HostEnv>;
  innermostProcessHost(env: HostEnv): HostLocation | null;
  processHostLocations(env: HostEnv): HostLocation[];
  // The runtime also orders a Claude session's Scout channel ("channel"); no candidate here is one, so it matches none.
  resolveInPlaceOrder(): Array<SessionSteerTerminalTarget["host"] | "channel">;
  codexThreadHolderPids(id: string): Promise<number[]>;
  codexThreadHeldByChatGPTApp(id: string): Promise<boolean>;
  readOrcaAgents(): Promise<OrcaAgent[]>;
  isScoutBackgroundCopy(record: ClaudeSessionRecord): boolean;
  deliverInPlace(input: { sessionId: string; harness: string; body: string }, deps: {
    findHerdrPane: () => Promise<HerdrPane | null>;
    findClaudeRecord: () => Promise<ClaudeSessionRecord | null>;
    codexThreadPids: () => Promise<number[]>;
    locateProcess: () => Promise<HostLocation | null>;
    codexHeldByApp: () => Promise<boolean>;
    readOrcaAgents: () => Promise<OrcaAgent[]>;
    ttyForPid: () => Promise<string | null>;
    selfTty: () => Promise<string | null>;
    self: HostLocation[];
    order: Array<SessionSteerTerminalTarget["host"] | "channel">;
  }): Promise<{ ok: boolean; code?: string }>;
};

export type SessionSteeringDeps = {
  runtime: InPlaceRuntime;
  broker: <T>(path: string, body?: unknown) => Promise<T>;
  machine: () => Promise<string | null>;
  records: () => Promise<ClaudeSessionRecord[]>;
  process: (pid: number) => Promise<Process | null>;
  self: () => Promise<{ pids: number[]; ttys: string[]; hosts: HostLocation[] }>;
  herdr: (session: string) => ReturnType<typeof readHerdrTopology>;
  tmux: (pane: string, socket?: string) => Promise<TmuxPaneBinding | null>;
  terminal?: (session: Process, tmux: TmuxPaneBinding | null) => Promise<TerminalConnection>;
  focus?: (binding: SessionFocusBinding) => Promise<SessionFocusResult>;
  /** The window or tab title a GUI terminal shows for a tty (Lattices' terminal inventory); null when it can't say. */
  windowTitle?: (tty: string, app: string) => Promise<string | null>;
  /** Opens an attach command (`claude attach <job>`, tmux attach) in the operator's terminal app, marked as pop-out `popOut`; resolves the app. */
  openTerminal?: (argv: string[], cwd: string | null, popOut: string) => Promise<{ app: string; bundleId?: string; pid?: number }>;
  /** Starts an attach command in a tmux session of Scout's own, marked as pop-out `popOut` (startPopOutPane); resolves its name. */
  startPane?: (argv: string[], cwd: string | null, popOut: string) => Promise<string>;
  /** Hangs up a pop-out's attach (closeLocalTerminalPopOut); resolves how many processes it signalled. */
  closePopOut?: (popOut: string) => Promise<number>;
  /** A fresh pop-out token (newPopOutToken). */
  popOutToken?: () => string;
  /** Opens a `codex://threads/<id>` link in the ChatGPT app. */
  openUrl?: (url: string) => Promise<void>;
  /** A background session's attach, screen, keys and transcript, for answerPrompt (backgroundPromptDeps). */
  promptDeps?: (cwd: string | null, sessionId: string) => BackgroundPromptDeps;
};
const refused = (code: string, reason: string, target: SessionSteerTarget | null = null): Extract<Bound, { available: false }> => ({ available: false, code, reason, target });
const normalize = (s: string) => s.trim().replace(/\s+/gu, " ");
const ttyName = (s: string) => !s || s === "??" || s === "?" ? null : s.replace(/^\/dev\//u, "");

/** One process by pid, as the terminal discovery walks it; null once it exited. */
export async function readProcess(pid: number): Promise<Process | null> {
  try {
    const { stdout } = await execSystemFile("ps", ["-p", String(pid), "-o", "ppid=,tty=,pgid=,tpgid=,lstart=,comm="], {
      timeoutMs: 2_000, maxStdoutBytes: 2048, env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
    });
    const columns = /^(\d+)\s+(\S+)\s+(\d+)\s+(-?\d+)\s+(\w+\s+\w+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/u.exec(stdout.trim());
    if (!columns) return null;
    const [, parent, tty, pgid, tpgid, start, command] = columns;
    return { pid, parent: Number(parent), tty: ttyName(tty!), foreground: Number(pgid) > 0 && pgid === tpgid, start: start!, command };
  } catch (error) {
    if ((error as { exitCode?: number }).exitCode === 1) return null;
    throw error;
  }
}

async function caller(runtime: InPlaceRuntime) {
  const pids: number[] = [], ttys: string[] = [];
  const hosts = runtime.processHostLocations(process.env as HostEnv);
  let pid = process.pid;
  for (let depth = 0; depth < 16 && pid > 1; depth++) {
    pids.push(pid);
    const processInfo = await readProcess(pid);
    if (!processInfo) break;
    if (processInfo.tty) ttys.push(processInfo.tty);
    hosts.push(...runtime.processHostLocations(await runtime.readProcessHostEnv(pid)));
    pid = processInfo.parent;
  }
  return { pids, ttys, hosts };
}

/**
 * The title a GUI terminal shows for a tty, from Lattices' terminal inventory
 * (it already holds the terminal apps' automation grants). Read-only.
 */
async function readWindowTitle(tty: string, app: string): Promise<string | null> {
  const { stdout } = await execSystemFile("lattices", ["call", "terminals.list", JSON.stringify({ refresh: true })], { timeoutMs: 3_000, maxStdoutBytes: 512 * 1024 });
  const parsed = JSON.parse(stdout) as unknown;
  const rows = Array.isArray(parsed) ? parsed : (parsed as { result?: unknown })?.result;
  if (!Array.isArray(rows)) return null;
  const want = tty.replace(/^\/dev\//u, "");
  const row = rows.find((r) => r && typeof r === "object" && typeof (r as { tty?: unknown }).tty === "string"
    && (r as { tty: string }).tty.replace(/^\/dev\//u, "") === want) as { app?: unknown; tabTitle?: unknown; windowTitle?: unknown } | undefined;
  if (!row || (typeof row.app === "string" && row.app.toLowerCase() !== app.toLowerCase())) return null;
  const title = typeof row.tabTitle === "string" && row.tabTitle.trim() ? row.tabTitle : typeof row.windowTitle === "string" ? row.windowTitle : null;
  return title?.replace(/\s+/gu, " ").trim().slice(0, 160) || null;
}

async function readTmux(pane: string, socket?: string) {
  if (!/^%\d+$/u.test(pane)) return null;
  // -u: launchd starts the web server without a UTF-8 locale, and tmux then
  // prints the tabs as "_", so the fields would never split and every tmux pane
  // would read as unverified (runtime claude-session-records.ts does the same).
  const { stdout } = await execSystemFile("tmux", ["-u", ...(socket ? ["-S", socket] : []), "display-message", "-p", "-t", pane,
    "#{socket_path}\t#{pane_pid}\t#{pane_tty}\t#{pane_id}\t#{session_name}"], { timeoutMs: 2_000, maxStdoutBytes: 4096 });
  const [observedSocket, pid, tty, actualPane, session] = stdout.trim().split("\t");
  return observedSocket && Number(pid) > 0 && actualPane === pane && session ? { socket: observedSocket, pid: Number(pid), tty: ttyName(tty), pane, session } : null;
}

export function createSessionSteering(overrides: Partial<SessionSteeringDeps> = {}) {
  const loadRuntime = async (): Promise<InPlaceRuntime> => overrides.runtime ?? await import("@openscout/runtime/in-place");
  const deps: Omit<SessionSteeringDeps, "runtime"> = {
    broker: (path, body) => {
      const url = resolveScoutBrokerUrl();
      return requestScoutBrokerJson(url, path, { socketPath: resolveBrokerSocketPathForBaseUrl(url),
        ...(body === undefined ? {} : { method: "POST", body }) });
    },
    machine: async () => (await readScoutBrokerHealth()).nodeId,
    records: readClaudeSessionRecords, process: readProcess, self: async () => caller(await loadRuntime()),
    herdr: (session) => readHerdrTopology(session, { maxAgeMs: 0 }), tmux: readTmux,
    windowTitle: readWindowTitle,
    openTerminal: async (argv, cwd, popOut) => await openLocalTerminalAttach(argv, { cwd, popOut }),
    startPane: (argv, cwd, popOut) => startPopOutPane(argv, cwd, popOut),
    // A terminal app's pop-out by its marked processes; the quick terminal's also by its own tmux session,
    // which catches a close that comes before the login shell has reached the attach.
    closePopOut: async (popOut) => (await closeLocalTerminalPopOut(popOut)) + (await endPopOutPane(popOut) ? 1 : 0),
    popOutToken: newPopOutToken,
    openUrl: async (url) => { await execSystemFile("open", [url], { timeoutMs: 5_000 }); },
    ...overrides,
  };

  // This primitive only addresses an already-owned native session. Unlike ask
  // dispatch or ensure-online it cannot launch, resume, connect or fork one.
  async function bindBroker(sessionId: string, harness: string, local: string): Promise<Bound | null> {
    const { endpoints } = await deps.broker<{ endpoints: AgentEndpoint[] }>("/v1/endpoints");
    const candidates = endpoints.filter(e => e.nodeId === local && e.harness === harness
      && e.metadata?.externalSessionId === sessionId && e.metadata?.placement === "background"
      && !e.pane && !["offline", "stopped", "superseded"].includes(e.state)
      && e.metadata?.staleLocalRegistration !== true
      && (e.transport === "codex_app_server" || e.transport === "claude_stream_json" || e.transport.endsWith("_acp")));
    if (!candidates.length) return null;
    if (candidates.length !== 1) return refused("ambiguous", "More than one broker endpoint owns this session.");
    const endpoint = candidates[0]!;
    const observed = await deps.broker<NativeObservation>("/v1/native-session-attention", { endpointId: endpoint.id });
    if (observed.sessionId !== sessionId || !observed.token) return null;
    // "revive" is this primitive's name for a new TURN on an already-owned
    // live connection, not session resume. Native owners validate the token
    // synchronously and never ensure-online, load a thread or spawn here.
    const action = observed.state === "idle" ? "revive"
      : observed.state === "active" && observed.steer && observed.turnId ? "steer" : null;
    if (!action) return null;
    return { available: true, binding: { kind: "broker", endpointId: endpoint.id, sessionId, token: observed.token, action,
      target: { host: "broker", endpointId: endpoint.id, transport: endpoint.transport } } };
  }

  async function bind(ref: string, machine: string | null, purpose: "steer" | "focus" = "steer"): Promise<Bound> {
    try {
      const local = await deps.machine();
      if (!local || !machine) return refused("machine_unverified", "The session's machine is not verified.");
      if (machine !== local) return refused("remote_refused", "This session runs on another machine. Open it there to send to it.");
      const exact = /^session:([a-z][a-z0-9_-]{0,31}):([A-Za-z0-9_-][A-Za-z0-9._-]{0,199})$/u.exec(ref);
      if (!exact) return refused("invalid_session", "An exact native session reference is required.");
      // Steering never depends on a terminal. Claude and Codex can also be
      // typed into the terminal that holds them; every other harness is sent
      // to through the runtime that owns its session.
      if (exact[1] !== "claude" && exact[1] !== "codex") {
        if (purpose === "focus") return refused("no_terminal", "This session has no window to bring forward.");
        return await bindBroker(exact[2]!, exact[1]!, local)
          ?? refused("not_owned", "Scout isn't running this session, so nothing can be sent to it.");
      }
      const match = exact;
      let runtime: InPlaceRuntime;
      try { runtime = await loadRuntime(); }
      catch { return refused("in_place_unavailable", "This installation does not have the in-place session runtime."); }
      const harness = match[1] as "claude" | "codex", sessionId = match[2]!;
      const records = harness === "claude" ? (await deps.records()).filter((r) => r.sessionId === sessionId) : [];
      if (harness === "codex" && await runtime.codexThreadHeldByChatGPTApp(sessionId)) {
        return refused("native_app_refused", "This thread is held by the native app; no verified process-addressed input path is available.");
      }
      const pids = [...new Set(harness === "claude" ? records.map((r) => r.pid) : await runtime.codexThreadHolderPids(sessionId))];
      const terminals = createTerminalDiscovery(deps.process);
      const live = (await Promise.all(pids.map(terminals.process))).filter((p): p is Process => p !== null);
      if (live.some((p) => records.some((r) => r.pid === p.pid && !r.procStart))) return refused("unverified_process", "A live candidate has no process birth evidence; its session ownership is unverified.");
      const matches = live.filter((p) => harness === "codex" || records.some((r) => r.pid === p.pid && r.procStart && normalize(r.procStart) === normalize(p.start)));
      // Broker-owned background sessions have no terminal and cannot be focused.
      if (purpose === "steer" && !matches.length && !live.some(p => p.tty)) {
        const broker = await bindBroker(sessionId, harness, local);
        if (broker) return broker;
      }
      if (!matches.length) return refused("not_live", "No birth-verified live process holds this session. Nothing will be resumed or started.");
      if (matches.length !== 1) return refused("ambiguous", "More than one live process holds this session.");
      const processInfo = matches[0]!;
      const record = records.find((r) => r.pid === processInfo.pid && r.procStart && normalize(r.procStart) === normalize(processInfo.start)) ?? null;
      const own = purpose === "steer" ? await deps.self() : { pids: [], ttys: [], hosts: [] };
      if (purpose === "steer" && !processInfo.tty && !own.pids.includes(processInfo.pid)) {
        const broker = await bindBroker(sessionId, harness, local);
        if (broker) return broker;
      }
      const env = await runtime.readProcessHostEnv(processInfo.pid);
      const host = runtime.innermostProcessHost(env);
      const ownHost = host && own.hosts.some((h) => host.host === "herdr" && h.host === "herdr" ? host.session === h.session && host.paneId === h.paneId
        : host.host === "orca" && h.host === "orca" ? host.terminalHandle === h.terminalHandle
        : host.host === "tmux" && h.host === "tmux" && host.pane === h.pane);
      const selfTarget = own.pids.includes(processInfo.pid) || Boolean(processInfo.tty && own.ttys.includes(processInfo.tty)) || ownHost;
      const unavailable = (code: string, reason: string): Bound => selfTarget
        ? refused("self_target", "The target is the web server's own process or terminal.")
        : purpose === "steer" && code === "host_unavailable" && (!processInfo.tty || !processInfo.foreground)
          ? refused("not_foreground", "The session has no verified foreground terminal process.")
          : refused(code, reason);
      let blocked: string | null = null;
      const candidates: Binding[] = [];
      const base = { sessionId, harness, record, host, herdr: null, orca: [], tmux: null };
      // Claude's background sessions run on a pty its own host holds: no window shows them.
      const job = record?.kind === "bg" && record.jobId ? { id: record.jobId, name: record.name } : null;
      const target = (kind: SessionSteerTerminalTarget["host"], address: string): SessionSteerTerminalTarget => ({ pid: processInfo.pid, processStart: processInfo.start, host: kind, address, tty: processInfo.tty, ...(job ? { job } : {}) });
      if (host?.host === "herdr") {
        const topology = await deps.herdr(host.session);
        const panes = topology?.running ? topology.workspaces.flatMap((w) => w.tabs.flatMap((t) => t.panes)).filter((p) => p.agentSession?.value === sessionId && (!p.agentSession.agent || p.agentSession.agent === harness)) : [];
        if (panes.length !== 1 || panes[0]?.paneId !== host.paneId) return unavailable("host_unverified", "Herdr does not uniquely confirm this session in its process's pane.");
        const pane = panes[0]!;
        if (pane.agentStatus === "blocked") blocked = "Answer the session's approval prompt first.";
        candidates.push({ ...base, target: target("herdr", `${host.session}/${host.paneId}`), herdr: { session: host.session, paneId: host.paneId, status: pane.agentStatus } });
      } else if (host?.host === "orca") {
        const agents = (await runtime.readOrcaAgents()).filter((a) => a.paneKey === host.paneKey);
        if (!host.paneKey || agents.length !== 1) return unavailable("host_unverified", "Orca does not uniquely confirm the process's terminal.");
        if (["blocked", "waiting", "unknown"].includes(agents[0]!.state)) blocked = "Orca can't take input while the session is blocked or unverified.";
        candidates.push({ ...base, target: target("orca", host.terminalHandle), orca: agents });
      }
      if (env.TMUX && env.TMUX_PANE) {
        // Runtime sends on the default tmux socket. Prove that it is this
        // process's socket, not a similarly numbered pane on another server.
        const pane = await deps.tmux(env.TMUX_PANE, purpose === "focus" ? env.TMUX.split(",")[0] : undefined);
        if (!pane || pane.socket !== env.TMUX.split(",")[0] || pane.tty !== processInfo.tty) return unavailable("tmux_unverified", "The runtime's default tmux socket/pane does not match this process.");
        let ancestor: Process | null = processInfo;
        for (let i = 0; i < 16 && ancestor && ancestor.pid !== pane.pid; i++) ancestor = await terminals.process(ancestor.parent);
        if (!ancestor || ancestor.pid !== pane.pid) return unavailable("tmux_unverified", "The tmux pane does not contain this session's process.");
        // Codex's in-place API intentionally doesn't dispatch bare tmux ids,
        // but a verified tmux location can still be focused without typing.
        if (purpose === "focus" || (harness === "claude" && record?.tmux?.pane === pane.pane && record.tmux.session === pane.session)) {
          candidates.push({ ...base, tmux: pane, target: target("tmux", pane.pane) });
        }
      }
      if (!host && !env.TMUX && processInfo.tty && (harness === "claude" || purpose === "focus")) {
        candidates.push({ ...base, target: target("terminal", processInfo.tty) });
      }
      const selected = runtime.resolveInPlaceOrder().map((kind) => candidates.find((c) => c.target.host === kind)).find(Boolean);
      if (!selected) return unavailable("host_unavailable", "No verified terminal host holds this process.");
      const terminal = await (deps.terminal
        ? deps.terminal(processInfo, selected.tmux)
        : terminals.resolve(processInfo, selected.tmux)).catch(() => ({ descriptor: { app: null, bundleId: null, appPid: null } }));
      if (selected.target.host === "terminal" && terminal.descriptor.app && terminal.descriptor.bundleId && processInfo.tty && deps.windowTitle) {
        const window = await deps.windowTitle(processInfo.tty, terminal.descriptor.app).catch(() => null);
        if (window) terminal.descriptor = { ...terminal.descriptor, window };
      }
      selected.target = { ...selected.target, terminal: terminal.descriptor };
      selected.focusBinding = { target: selected.target, terminal, tmux: selected.tmux,
        herdr: selected.herdr, orcaHandle: selected.target.host === "orca" && host?.host === "orca" ? host.terminalHandle : null };
      if (purpose === "focus") return { available: true, binding: selected };
      const deny = (code: string, reason: string): Bound => ({
        ...refused(code, reason, selected.target), focus: sessionFocusCapability(selected.focusBinding!),
      });
      if (record && runtime.isScoutBackgroundCopy(record)) return deny("background_copy", "This process is a Scout background copy, not the operator's live session.");
      if (own.pids.includes(processInfo.pid) || (processInfo.tty && own.ttys.includes(processInfo.tty)) || ownHost
        || (selected.tmux && own.hosts.some((h) => h.host === "tmux" && h.pane === selected.tmux!.pane))) {
        return deny("self_target", "The target is the web server's own process or terminal.");
      }
      if (!processInfo.tty || !processInfo.foreground) return deny("not_foreground", "The session has no verified foreground terminal process.");
      // Terminal input is typed into a window. A Claude background session's tty
      // belongs to Claude's own pty host: no window shows it, so nothing can type into it.
      if (selected.target.host === "terminal" && selected.target.job && !terminal.descriptor.bundleId) {
        return deny("no_window", "This is a background session. No window shows it, so nothing can type into it here. Open it in a terminal to answer.");
      }
      if (blocked) return deny("session_blocked", blocked);
      return { available: true, binding: selected };
    } catch {
      return refused("probe_failed", "Live process or host verification failed. Nothing was sent.");
    }
  }

  const available = (binding: Binding | BrokerBinding): SessionSteerAvailability => "kind" in binding
    ? { available: true, code: "ready", reason: `Sends into the running session on ${hostname()}.`, target: binding.target }
    : { focus: binding.focusBinding ? sessionFocusCapability(binding.focusBinding) : undefined, available: true, code: "ready", reason: `Types into ${binding.target.host} on ${hostname()}.`, target: binding.target };
  const sending = new Set<string>();
  return {
    async inspect(ref: string, machine: string | null): Promise<SessionSteerAvailability> {
      const result = await bind(ref, machine);
      if (result.available) return available(result.binding);
      // Focus has no default-socket/foreground/input policy. Reuse exactly the
      // same binder when input-only rules prevented a location from surfacing.
      if (!result.target && ["tmux_unverified", "host_unavailable"].includes(result.code)) {
        const location = await bind(ref, machine, "focus");
        if (location.available && !("kind" in location.binding) && location.binding.focusBinding) {
          return { ...result, target: location.binding.target, focus: sessionFocusCapability(location.binding.focusBinding) };
        }
      }
      return result;
    },
    async focus(ref: string, machine: string | null): Promise<SessionFocusResult> {
      try {
        const first = await bind(ref, machine, "focus");
        if (!first.available) return { ok: false, code: first.code, reason: first.reason, target: first.target };
        if ("kind" in first.binding || !first.binding.focusBinding) return { ok: false, code: "host_unavailable", reason: "No focus binding.", target: null };
        const capability = sessionFocusCapability(first.binding.focusBinding);
        if (!capability.available) return { ok: false, code: capability.code, reason: capability.reason, attach: capability.attach, detached: capability.detached, target: first.binding.target };
        const current = await bind(ref, machine, "focus");
        if (!current.available || "kind" in current.binding || !current.binding.focusBinding) {
          return { ok: false, code: "binding_changed", reason: "The process or terminal changed before focus. Nothing was selected.", target: null };
        }
        if (JSON.stringify(first.binding.focusBinding) !== JSON.stringify(current.binding.focusBinding)) {
          return { ok: false, code: "binding_changed", reason: "The process, client, socket or app changed before focus. Nothing was selected.", target: null };
        }
        // Last birth check after all topology/app probes. Each request has fresh
        // caches; no PID, client or app from a previous request is trusted.
        const pins = [
          { pid: current.binding.target.pid, start: current.binding.target.processStart },
          ...(current.binding.focusBinding.terminal.clients ?? []),
          { pid: current.binding.focusBinding.terminal.descriptor.appPid!, start: current.binding.focusBinding.terminal.appStart! },
        ];
        for (const pin of pins) {
          const observed = await deps.process(pin.pid);
          if (!observed || normalize(observed.start) !== normalize(pin.start)) {
            return { ok: false, code: "binding_changed", reason: "A process exited or was reused before focus. Nothing was selected.", target: null };
          }
        }
        return await (deps.focus ?? focusSessionTerminal)(current.binding.focusBinding);
      } catch {
        return { ok: false, code: "focus_unconfirmed", reason: "Terminal focus was not confirmed. Nothing was retried.", target: null };
      }
    },
    /**
     * A session no window shows, opened in the operator's terminal app on its
     * attach command: `claude attach <job>` for a Claude background session,
     * tmux attach for a tmux nobody is attached to. The command comes from the
     * verified binding (the record's job id, the probed socket and session),
     * never from the client.
     */
    async openTerminal(ref: string, machine: string | null): Promise<SessionOpenPlaceResult> {
      try {
        const bound = await bind(ref, machine, "focus");
        if (!bound.available) return { ok: false, code: bound.code, reason: bound.reason };
        if ("kind" in bound.binding) return { ok: false, code: "not_attachable", reason: "A runtime-owned session has no terminal to open." };
        const cwd = bound.binding.record?.cwd ?? null;
        const job = bound.binding.target.job;
        const detached = bound.binding.focusBinding ? sessionFocusCapability(bound.binding.focusBinding).detached : undefined;
        const argv = job ? ["claude", "attach", job.id]
          : detached ? ["tmux", "-S", detached.socket, "attach", "-t", detached.session]
          : null;
        if (!argv) return { ok: false, code: "not_attachable", reason: "A window already shows this session, or it has no attach command." };
        const popOut = (deps.popOutToken ?? newPopOutToken)();
        const opened = await deps.openTerminal!(argv, cwd, popOut);
        const terminal = opened.bundleId && opened.pid ? { app: opened.app, bundleId: opened.bundleId, appPid: opened.pid } : undefined;
        return { ok: true, code: "opened", reason: `Opened in ${opened.app}.`, app: opened.app, popOut, ...(terminal ? { terminal } : {}) };
      } catch (error) {
        return { ok: false, code: "open_failed", reason: error instanceof Error ? error.message : "The terminal could not be opened." };
      }
    },
    /**
     * A background session in the companion's quick terminal: its attach
     * (`claude attach <job>`, from the verified binding, never the client)
     * started in a tmux session of Scout's own, which the pop-up shows.
     * closeTerminal with the returned pop-out hangs the attach up; the
     * session keeps running. Only a background session: one already in a
     * tmux pane is shown as it is (the /pane route), with no new process.
     */
    async openPane(ref: string, machine: string | null): Promise<SessionOpenPaneResult> {
      try {
        const bound = await bind(ref, machine, "focus");
        if (!bound.available) return { ok: false, code: bound.code, reason: bound.reason };
        if ("kind" in bound.binding) return { ok: false, code: "not_attachable", reason: "A runtime-owned session has no terminal to open." };
        const job = bound.binding.target.job;
        if (!job) return { ok: false, code: "not_background", reason: "Only a background session opens in a pane of Scout's own." };
        const popOut = (deps.popOutToken ?? newPopOutToken)();
        const sessionName = await (deps.startPane ?? startPopOutPane)(["claude", "attach", job.id], bound.binding.record?.cwd ?? null, popOut);
        return { ok: true, code: "opened", reason: "Opened in the quick terminal.", pane: { backend: "tmux", sessionName }, popOut };
      } catch (error) {
        return { ok: false, code: "open_failed", reason: error instanceof Error ? error.message : "The terminal could not be opened." };
      }
    },
    /**
     * A background session's permission prompt, answered from the card: the
     * job comes from the verified binding, never the client, and the client
     * names only the call it was shown (its toolUseId) and Yes or No. The key
     * goes out only while the attach's screen shows that same call
     * (answerBackgroundPrompt); otherwise nothing is sent.
     */
    async answerPrompt(ref: string, machine: string | null, toolUseId: unknown, decision: unknown): Promise<SessionAnswerPromptResult> {
      if (typeof toolUseId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(toolUseId)) return { ok: false, code: "invalid_call", reason: "Name the call the card showed.", sent: false };
      if (decision !== "approve" && decision !== "deny") return { ok: false, code: "invalid_decision", reason: "Choose Yes or No.", sent: false };
      const key = JSON.stringify([machine, ref]);
      if (sending.has(key)) return { ok: false, code: "busy", reason: "Something is already being sent to this session.", sent: false };
      sending.add(key);
      try {
        const bound = await bind(ref, machine, "focus");
        if (!bound.available) return { ok: false, code: bound.code, reason: bound.reason, sent: false };
        if ("kind" in bound.binding || bound.binding.harness !== "claude") return { ok: false, code: "not_background", reason: "Only a Claude background session is answered this way.", sent: false };
        const job = bound.binding.target.job;
        if (!job) return { ok: false, code: "not_background", reason: "Only a background session is answered this way.", sent: false };
        const cwd = bound.binding.record?.cwd ?? null;
        const sessionId = bound.binding.sessionId;
        return await answerBackgroundPrompt({ sessionId, jobId: job.id, cwd, toolUseId, decision: decision as SessionPromptDecision },
          (deps.promptDeps ?? backgroundPromptDeps)(cwd, sessionId));
      } catch {
        return { ok: false, code: "probe_failed", reason: "Live process verification failed. Nothing was sent.", sent: false };
      } finally { sending.delete(key); }
    },
    /**
     * Done on a pop-out openTerminal made: its attach is hung up and its
     * window closes; the session keeps running. Only this host's pop-outs,
     * and only by the token openTerminal returned.
     */
    async closeTerminal(machine: string | null, popOut: unknown): Promise<SessionOpenPlaceResult> {
      if (!isPopOutToken(popOut)) return { ok: false, code: "invalid_pop_out", reason: "That is not a pop-out Scout opened." };
      try {
        const local = await deps.machine();
        if (!local || machine !== local) return { ok: false, code: "machine_unverified", reason: "Pop-outs close on the host that opened them." };
        const closed = await deps.closePopOut!(popOut);
        return closed > 0 ? { ok: true, code: "closed", reason: "Closed." } : { ok: false, code: "gone", reason: "That terminal is already closed." };
      } catch {
        return { ok: false, code: "close_failed", reason: "The terminal could not be closed." };
      }
    },
    /** A Codex thread the ChatGPT app holds, opened there. Only when the binder itself finds the app holding it. */
    async openThread(ref: string, machine: string | null): Promise<SessionOpenPlaceResult> {
      try {
        const bound = await bind(ref, machine, "focus");
        const threadId = /^session:codex:([A-Za-z0-9_-][A-Za-z0-9._-]{0,199})$/u.exec(ref)?.[1];
        if (bound.available || bound.code !== "native_app_refused" || !threadId) {
          return bound.available || ["native_app_refused", "invalid_session"].includes(bound.code)
            ? { ok: false, code: "not_app_thread", reason: "The ChatGPT app does not hold this thread." }
            : { ok: false, code: bound.code, reason: bound.reason };
        }
        await deps.openUrl!(`codex://threads/${threadId}`);
        return { ok: true, code: "opened", reason: "Opened in the ChatGPT app.", app: "ChatGPT" };
      } catch (error) {
        return { ok: false, code: "open_failed", reason: error instanceof Error ? error.message : "The ChatGPT app could not be opened." };
      }
    },
    async steer(ref: string, machine: string | null, text: string, beforeDelivery: (target: SessionSteerTarget) => Promise<void>): Promise<SessionSteerAvailability> {
      const key = JSON.stringify([machine, ref]);
      if (sending.has(key)) return refused("busy", "A message is already being sent to this session.");
      sending.add(key);
      try {
        const first = await bind(ref, machine);
        if (!first.available) return first;
        const current = await bind(ref, machine);
        if (!current.available) return current;
        const binding = current.binding;
        const brokerChanged = ("kind" in first.binding || "kind" in binding) && JSON.stringify(first.binding) !== JSON.stringify(binding);
        if (brokerChanged || JSON.stringify(first.binding.target) !== JSON.stringify(binding.target)) return refused("binding_changed", "The process binding changed. Nothing was sent.", first.binding.target);
        if ("kind" in binding && Buffer.byteLength(text, "utf8") > 4096) return refused("input_too_long", "Broker live input is limited to 4096 UTF-8 bytes. Nothing was sent.", binding.target);
        try { await beforeDelivery(binding.target); }
        catch { return refused("audit_unavailable", "The message could not be recorded. Nothing was sent.", binding.target); }
        try {
          if ("kind" in binding) {
            // Audit fsync may outlive a turn or endpoint. Rebind afterwards;
            // terminal ownership appearing now also prevents broker dispatch.
            const final = await bind(ref, machine);
            if (!final.available || !("kind" in final.binding) || JSON.stringify(final.binding) !== JSON.stringify(binding)) {
              return refused("binding_changed", "The live broker session changed before input dispatch. Nothing was sent.", binding.target);
            }
            const result = await deps.broker<{ accepted: boolean }>("/v1/native-session-attention", {
              endpointId: binding.endpointId, sessionId: binding.sessionId, token: binding.token, action: binding.action, prompt: text,
            });
            return result.accepted ? { ...available(binding), code: "accepted", reason: "Input accepted by the running session; harness consumption is not confirmed." }
              : refused("delivery_unconfirmed", "Input was not confirmed. Check the live session before trying again.", binding.target);
          }
          const runtime = await loadRuntime();
          // The host probes and durable intent can take time. Read ownership
          // again AFTER them, immediately before entering the pinned dispatcher.
          const appNow = binding.harness === "codex" && await runtime.codexThreadHeldByChatGPTApp(binding.sessionId);
          const currentRecords = binding.harness === "claude" ? (await deps.records()).filter((r) => r.sessionId === binding.sessionId) : [];
          const currentPids = [...new Set(binding.harness === "claude" ? currentRecords.map((r) => r.pid) : await runtime.codexThreadHolderPids(binding.sessionId))];
          const otherLive = await Promise.all(currentPids.filter((pid) => pid !== binding.target.pid).map(deps.process));
          const anotherOwner = otherLive.some((p) => p && (binding.harness === "codex" || currentRecords.some((r) => r.pid === p.pid
            && (!r.procStart || normalize(r.procStart) === normalize(p.start)))));
          const stillOwned = !appNow && !anotherOwner && currentPids.includes(binding.target.pid) && (binding.harness === "codex"
            || currentRecords.some((r) => r.pid === binding.target.pid && r.procStart && normalize(r.procStart) === normalize(binding.target.processStart)));
          const processNow = await deps.process(binding.target.pid);
          if (!stillOwned || !processNow || normalize(processNow.start) !== normalize(binding.target.processStart)
            || processNow.tty !== binding.target.tty || !processNow.foreground) {
            return refused("binding_changed", "The process exited or changed before input dispatch. Nothing was sent.", binding.target);
          }
          const result = await runtime.deliverInPlace({ sessionId: binding.sessionId, harness: binding.harness, body: text }, {
            // Restrict EVERY discovery path to the one freshly verified binding.
            // Runtime host failure is final; no fallback, fork, or native app UI.
            findHerdrPane: async () => binding.herdr,
            findClaudeRecord: async () => binding.harness === "claude" ? binding.record : null,
            codexThreadPids: async () => binding.harness === "codex" ? [binding.target.pid] : [],
            locateProcess: async () => binding.host,
            codexHeldByApp: async () => false,
            readOrcaAgents: async () => binding.orca,
            ttyForPid: async () => binding.target.tty,
            selfTty: async () => null, self: [], order: [binding.target.host],
          });
          return result.ok ? { ...available(binding), code: "accepted", reason: "Input accepted by the live host; harness consumption is not confirmed." }
            : refused("delivery_unconfirmed", "Input was not confirmed. Check the live session before trying again.", binding.target);
        } catch {
          // Child-process exceptions can echo argv, including the body. Do not
          // persist or return them, and never retry a potentially accepted send.
          return refused("delivery_unconfirmed", "Input was not confirmed. Check the live session before trying again.", binding.target);
        }
      } finally { sending.delete(key); }
    },
  };
}
export type SessionSteering = ReturnType<typeof createSessionSteering>;
