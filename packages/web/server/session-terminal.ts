import { basename, join } from "node:path";
import { execSystemFile } from "@openscout/runtime/system-probes";
import type { SessionFocusResult, SessionSteerTerminalTarget, SessionTerminal } from "../shared/api/session-steer.ts";

export type SessionProcess = { pid: number; parent: number; start: string; tty: string | null; foreground: boolean; command?: string };
export type TmuxPaneBinding = { socket: string; pid: number; tty: string | null; pane: string; session: string };
export type TerminalConnection = {
  descriptor: SessionTerminal;
  appStart?: string;
  /** Every selected client is re-observed on the next bind. Never use the tmux server's ancestors. */
  clients?: Array<{ pid: number; start: string; tty: string | null }>;
};
export type SessionFocusBinding = {
  target: SessionSteerTerminalTarget;
  terminal: TerminalConnection;
  tmux: TmuxPaneBinding | null;
  herdr: { session: string; paneId: string } | null;
  orcaHandle: string | null;
};
export type TerminalExec = typeof execSystemFile;
const unknownTerminal = (): SessionTerminal => ({ app: null, bundleId: null, appPid: null });
const normalizeTty = (tty: string) => tty.replace(/^\/dev\//u, "");

/** Per-bind caches only: no stale pid -> app association survives another request. */
export function createTerminalDiscovery(
  readProcess: (pid: number) => Promise<SessionProcess | null>,
  exec: TerminalExec = execSystemFile,
) {
  let deadline: number | null = null;
  const processes = new Map<number, Promise<SessionProcess | null>>();
  const apps = new Map<string, Promise<TerminalConnection>>();
  const bundles = new Map<string, Promise<{ app: string; bundleId: string; executable?: string; agent: boolean } | null>>();
  const processAt = (pid: number) => {
    let value = processes.get(pid);
    if (!value) { value = readProcess(pid); processes.set(pid, value); }
    return value;
  };
  async function bundle(path: string) {
    let pending = bundles.get(path);
    if (!pending) {
      pending = (async () => {
        try {
          const { stdout } = await exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(path, "Contents/Info.plist")], { timeoutMs: 2000, maxStdoutBytes: 64 * 1024 });
          const info = JSON.parse(stdout);
          if (info.LSBackgroundOnly === true || info.LSBackgroundOnly === "YES") return null;
          if (typeof info.CFBundleIdentifier !== "string" || !/^[A-Za-z0-9.-]+$/u.test(info.CFBundleIdentifier)) return null;
          return { app: String(info.CFBundleDisplayName ?? info.CFBundleName ?? basename(path, ".app")), bundleId: info.CFBundleIdentifier,
            executable: typeof info.CFBundleExecutable === "string" ? info.CFBundleExecutable : undefined,
            agent: [true, 1, "1", "YES", "true"].includes(info.LSUIElement) };
        } catch { return null; }
      })();
      bundles.set(path, pending);
    }
    return pending;
  }
  /** A process running a bundle's main executable: that bundle, or null. */
  async function appOf(running: SessionProcess) {
    // Only a bundle's main MacOS executable, not a CLI merely shipped
    // somewhere inside ChatGPT.app/Resources, identifies its GUI owner.
    const match = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/u.exec(running.command ?? "");
    if (!match || match[1]!.includes(".app/")) return null;
    const info = await bundle(match[1]!);
    return info && (!info.executable || basename(running.command!) === info.executable) ? info : null;
  }
  /**
   * A windowless helper (LSUIElement) draws nothing; its app does. Rex hosts
   * every shell in "Rex Server" (com.superlogical.rex.server) while the
   * windows belong to Rex (com.superlogical.rex). The owner is the running
   * app whose bundle id the helper's extends by one part, checked again by
   * its own executable, or null.
   */
  async function ownerOf(helper: string): Promise<TerminalConnection | null> {
    const owner = helper.slice(0, helper.lastIndexOf("."));
    if (!owner.includes(".")) return null;
    let stdout: string;
    try {
      ({ stdout } = await exec("/usr/bin/lsappinfo", ["info", "-only", "pid", "-app", owner], { timeoutMs: 2000, maxStdoutBytes: 1024 }));
    } catch { return null; }
    // lsappinfo prints `pid = 41695` on its own line; the quoted `"pid"=41695` form reads too
    const pid = Number(/"?\bpid"?\s*=\s*(\d+)/u.exec(stdout)?.[1]);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const running = await processAt(pid);
    const info = running ? await appOf(running) : null;
    if (!running || !info || info.agent || info.bundleId !== owner) return null;
    return { descriptor: { app: info.app, bundleId: info.bundleId, appPid: running.pid }, appStart: running.start };
  }
  async function walk(pid: number): Promise<TerminalConnection> {
    const first = await processAt(pid);
    if (!first) return { descriptor: unknownTerminal() };
    const key = pid + ":" + first.start;
    let pending = apps.get(key);
    if (!pending) {
      pending = (async () => {
        let current: SessionProcess | null = first;
        const seen = new Set<number>();
        for (let depth = 0; current && current.pid > 1 && depth < 24; depth++) {
          if (seen.has(current.pid) || (deadline !== null && Date.now() > deadline)) break;
          seen.add(current.pid);
          const info = await appOf(current);
          if (info) {
            const owner = info.agent ? await ownerOf(info.bundleId) : null;
            return owner ?? { descriptor: { app: info.app, bundleId: info.bundleId, appPid: current.pid }, appStart: current.start };
          }
          if (current.parent <= 1) break;
          current = await processAt(current.parent);
        }
        return { descriptor: unknownTerminal() };
      })();
      apps.set(key, pending);
    }
    return pending;
  }
  return {
    process: processAt,
    async resolve(session: SessionProcess, tmux: TmuxPaneBinding | null): Promise<TerminalConnection> {
      deadline ??= Date.now() + 4000;
      if (!tmux) return walk(session.pid);
      // Exact proven socket AND session. No global/default-server client guess.
      let stdout: string;
      try {
        // -u: without a UTF-8 locale tmux prints the tab as "_" (see readTmux).
        ({ stdout } = await exec("tmux", ["-u", "-S", tmux.socket, "list-clients", "-t", "=" + tmux.session, "-F", "#{client_pid}\t#{client_tty}"], { timeoutMs: 2000, maxStdoutBytes: 16 * 1024 }));
      } catch { return { descriptor: unknownTerminal() }; }
      const lines = stdout.trim().split("\n").filter(Boolean);
      if (!lines.length) return { descriptor: { ...unknownTerminal(), attached: false }, clients: [] };
      if (lines.length > 16) return { descriptor: { ...unknownTerminal(), attached: true } };
      const candidates: TerminalConnection[] = [];
      const clients: NonNullable<TerminalConnection["clients"]> = [];
      for (const line of lines) {
        if (deadline !== null && Date.now() > deadline) break;
        const [rawPid, tty] = line.split("\t");
        const pid = Number(rawPid);
        if (!Number.isInteger(pid) || pid <= 0 || !tty) continue;
        const client = await processAt(pid);
        if (!client || !client.tty || normalizeTty(client.tty) !== normalizeTty(tty)) continue;
        clients.push({ pid, start: client.start, tty: client.tty });
        candidates.push(await walk(pid));
      }
      // Distinct apps/unknown clients are ambiguous: don't raise an arbitrary app.
      const identities = new Set(candidates.map((entry) => JSON.stringify([entry.descriptor.appPid, entry.appStart])));
      if (!clients.length || clients.length !== lines.length || identities.size !== 1 || !candidates[0]?.descriptor.bundleId) {
        return { descriptor: { ...unknownTerminal(), attached: true }, clients };
      }
      return { ...candidates[0], descriptor: { ...candidates[0]!.descriptor, attached: true }, clients };
    },
  };
}

export function sessionFocusCapability(binding: SessionFocusBinding): { available: boolean; code: string; reason: string; attach?: string; detached?: { socket: string; session: string } } {
  if (binding.tmux && binding.terminal.descriptor.attached === false) {
    const quote = (value: string) => "'" + value.replace(/'/gu, "'\\''") + "'";
    return { available: false, code: "tmux_detached", reason: "No terminal client is attached. Nothing was opened.",
      attach: "tmux -S " + quote(binding.tmux.socket) + " attach -t " + quote(binding.tmux.session),
      detached: { socket: binding.tmux.socket, session: binding.tmux.session } };
  }
  if (binding.target.host === "terminal" && binding.target.job && !binding.terminal.descriptor.bundleId) {
    return { available: false, code: "background_job", reason: "A background session: no window shows it. Open it in a terminal to see it." };
  }
  if (process.platform !== "darwin") return { available: false, code: "unsupported", reason: "GUI terminal focus is implemented for macOS only." };
  if (!binding.terminal.descriptor.bundleId || !binding.terminal.descriptor.appPid || !binding.terminal.appStart) {
    return { available: false, code: "terminal_unavailable", reason: "No unique running GUI terminal app was verified." };
  }
  return { available: true, code: "ready", reason: "The live terminal can be selected and its app activated." };
}

const ITERM_SELECT = `on run argv
  set targetTTY to item 1 of argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is targetTTY then
            select s
            select t
            set index of w to 1
            activate
            return "selected"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "No session has the verified tty"
end run`;
const TERMINAL_SELECT = `on run argv
  set targetTTY to item 1 of argv
  tell application id "com.apple.Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is targetTTY then
          set selected tab of w to t
          set index of w to 1
          activate
          return "selected"
        end if
      end repeat
    end repeat
  end tell
  error "No tab has the verified tty"
end run`;

// Bundle activation (open -b / application id) can raise the wrong instance.
// AppKit through JXA addresses the already-running, birth-checked PID and never launches.
const ACTIVATE_PID = `ObjC.import("AppKit");
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (ObjC.unwrap(app.bundleIdentifier) !== argv[1] || app.terminated) throw new Error("App binding changed");
  return app.activateWithOptions(0) ? "activation-requested" : "activation-denied";
}`;

/** Only verified server-side bindings reach this actuator; never client-supplied coordinates. */
export async function focusSessionTerminal(binding: SessionFocusBinding, exec: TerminalExec = execSystemFile): Promise<SessionFocusResult> {
  const capability = sessionFocusCapability(binding);
  if (!capability.available) return { ok: false, code: capability.code, reason: capability.reason, attach: capability.attach, detached: capability.detached, target: binding.target };
  const bundleId = binding.terminal.descriptor.bundleId!;
  let selected = false;
  try {
    if (binding.herdr) {
      await exec(process.env.OPENSCOUT_HERDR_BIN?.trim() || "herdr", ["--session", binding.herdr.session, "agent", "focus", binding.herdr.paneId], { timeoutMs: 2000 });
      selected = true;
    } else if (binding.tmux) {
      await exec("tmux", ["-S", binding.tmux.socket, "select-window", "-t", binding.tmux.pane], { timeoutMs: 2000 });
      selected = true;
      await exec("tmux", ["-S", binding.tmux.socket, "select-pane", "-t", binding.tmux.pane], { timeoutMs: 2000 });
    } else if (binding.orcaHandle) {
      const { resolveOrcaBin } = await import("@openscout/runtime/in-place");
      const bin = await resolveOrcaBin();
      if (!bin) return { ok: false, code: "unsupported", reason: "The Orca CLI is unavailable.", target: binding.target };
      const { stdout } = await exec(bin, ["terminal", "switch", "--terminal", binding.orcaHandle, "--json"], { timeoutMs: 8000, maxStdoutBytes: 64 * 1024 });
      if (JSON.parse(stdout)?.ok !== true) throw new Error("Orca did not confirm switching");
      selected = true;
    }
    // For tmux, match the ATTACHED CLIENT tty, never the pane's slave tty.
    const tty = binding.tmux ? binding.terminal.clients?.[0]?.tty : binding.target.tty;
    const script = bundleId === "com.googlecode.iterm2" ? ITERM_SELECT : bundleId === "com.apple.Terminal" ? TERMINAL_SELECT : null;
    if (script && tty) {
      const { stdout } = await exec("/usr/bin/osascript", ["-e", script, "/dev/" + normalizeTty(tty)], { timeoutMs: 4000, maxStdoutBytes: 1024 });
      if (stdout.trim() !== "selected") throw new Error("Tab selection unconfirmed");
      return { ok: true, code: "focus_requested", reason: "The matching tty was selected and app activation requested.", target: binding.target, precision: binding.target.host === "terminal" ? "tty" : "pane", selected: true, activation: "requested" };
    }
    try {
      const { stdout } = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", ACTIVATE_PID, String(binding.terminal.descriptor.appPid), bundleId], { timeoutMs: 4000, maxStdoutBytes: 1024 });
      if (stdout.trim() !== "activation-requested") throw new Error("Activation not accepted");
    } catch {
      return { ok: false, code: "native_activation_required", reason: "The running app could not be activated from this process. The native companion can activate the exact appPid with NSRunningApplication.activate.",
        target: binding.target, selected, nativeActivation: { appPid: binding.terminal.descriptor.appPid!, bundleId } };
    }
    return { ok: true, code: "focus_requested", reason: binding.orcaHandle
      ? "The Orca terminal tab switch was accepted and app activation requested."
      : selected ? "The live pane was selected and app activation requested. This app has no verified tty/window selector."
      : "App activation requested only; no tty/tab/window selection is supported for this app.",
      target: binding.target, precision: binding.orcaHandle ? "tab" : selected ? "pane" : "app", selected, activation: "requested" };
  } catch {
    return { ok: false, code: "focus_unconfirmed", reason: selected
      ? "The host accepted a selection, but GUI focus was not confirmed. Nothing was retried."
      : "Terminal focus was not confirmed. Nothing was retried.",
      target: binding.target, selected };
  }
}
