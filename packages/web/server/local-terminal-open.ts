/**
 * Open a host attach command in the operator's real terminal app.
 *
 * This is the server-side counterpart of the macOS app's
 * `ScoutTerminalOpener`: same candidate apps, same per-app launch strategy,
 * same "shell line plus optional cd" payload. It exists so every client that
 * can show an agent/session — the web UI, the HUD, anything that can reach the
 * local API — can offer "hop into the real terminal" without re-implementing
 * the per-app incantations.
 *
 * Only macOS knows the launch vocabulary today; other platforms report
 * unsupported and the caller surfaces that honestly instead of pretending.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { execSystemFile } from "@openscout/runtime/system-probes";

export type LocalTerminalAppKind =
  | "terminal"
  | "ghostty"
  | "iterm"
  | "alacritty"
  | "hyper"
  | "unknown";

export type LocalTerminalApp = {
  name: string;
  path: string;
  kind: LocalTerminalAppKind;
};

export type LocalTerminalOpenResult = {
  app: string;
  /** The app that drew the window, when it is running and could be read: so a client can find, place and point at it. */
  bundleId?: string;
  pid?: number;
};

/**
 * A pop-out is a window Scout opened on an attach command. Its attach runs
 * with this variable set to the pop-out's token, so Done can hang up that
 * attach and nothing else: the token is in the environment of every process
 * the attach runs as, and in the argv of the shell that started it.
 */
export const POP_OUT_MARK = "OPENSCOUT_POPOUT";

export function newPopOutToken(): string {
  return randomBytes(16).toString("hex");
}

export function isPopOutToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}

/** The attach as the pop-out runs it: `env OPENSCOUT_POPOUT=<token> <argv>`. */
export function markedAttach(argv: readonly string[], token: string): string[] {
  return ["env", `${POP_OUT_MARK}=${token}`, ...argv];
}

/** Ordered exactly like the app: Ghostty wins when nothing is configured. */
const TERMINAL_APP_CANDIDATES: ReadonlyArray<readonly [string, string]> = [
  ["Ghostty", "/Applications/Ghostty.app"],
  ["Ghostty", `${homedir()}/Applications/Ghostty.app`],
  ["iTerm", "/Applications/iTerm.app"],
  ["iTerm", `${homedir()}/Applications/iTerm.app`],
  ["Alacritty", "/Applications/Alacritty.app"],
  ["Alacritty", `${homedir()}/Applications/Alacritty.app`],
  ["Hyper", "/Applications/Hyper.app"],
  ["Hyper", `${homedir()}/Applications/Hyper.app`],
  ["Terminal", "/System/Applications/Utilities/Terminal.app"],
  ["Terminal", "/Applications/Utilities/Terminal.app"],
];

export function identifyLocalTerminalApp(path: string): LocalTerminalAppKind {
  const name = path.replace(/\.app$/iu, "").split("/").pop()?.toLowerCase() ?? "";
  if (name === "terminal") return "terminal";
  if (name.includes("ghostty")) return "ghostty";
  if (name.includes("iterm")) return "iterm";
  if (name.includes("alacritty")) return "alacritty";
  if (name.includes("hyper")) return "hyper";
  return "unknown";
}

export function listLocalTerminalApps(env: NodeJS.ProcessEnv = process.env): LocalTerminalApp[] {
  const home = env.HOME ?? homedir();
  const seen = new Set<string>();
  const apps: LocalTerminalApp[] = [];
  for (const [name, path] of TERMINAL_APP_CANDIDATES) {
    const resolved = path.replace(homedir(), home);
    if (seen.has(resolved) || !existsSync(resolved)) continue;
    seen.add(resolved);
    apps.push({ name, path: resolved, kind: identifyLocalTerminalApp(resolved) });
  }
  return apps;
}

/**
 * `OPENSCOUT_TERMINAL_APP` pins the hop target app: an absolute `.app` path,
 * or a name matched against the installed candidates (case-insensitive).
 * Without it the first installed candidate wins — Terminal.app always exists
 * on macOS, so the preference list is ordered by intent, not by survival.
 */
export function preferredLocalTerminalApp(env: NodeJS.ProcessEnv = process.env): LocalTerminalApp | null {
  const configured = env.OPENSCOUT_TERMINAL_APP?.trim();
  const installed = listLocalTerminalApps(env);
  if (configured) {
    if (configured.endsWith(".app") && existsSync(configured)) {
      return { name: appNameFromPath(configured), path: configured, kind: identifyLocalTerminalApp(configured) };
    }
    const named = installed.find((app) => app.name.toLowerCase() === configured.toLowerCase());
    if (named) return named;
    // A configured path that is missing or a name nothing installed is a
    // configuration error; falling back silently would open somewhere the
    // operator did not ask for.
    return null;
  }
  return installed[0] ?? null;
}

function appNameFromPath(path: string): string {
  return path.replace(/\.app$/iu, "").split("/").pop() ?? path;
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

export function appleScriptEscape(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/** The one-line shell payload: `cd <cwd> && <argv>` when cwd is real. */
export function attachShellLine(argv: readonly string[], cwd?: string | null): string {
  const line = argv.map(shellQuote).join(" ");
  const dir = cwd?.trim();
  if (dir && existsSync(dir)) return `cd ${shellQuote(dir)} && ${line}`;
  return line;
}

function terminalAppScript(shellLine: string): string {
  return `tell application "Terminal"
  activate
  do script "${appleScriptEscape(shellLine)}"
end tell`;
}

function itermScript(shellLine: string): string {
  const escaped = appleScriptEscape(shellLine);
  return `tell application "iTerm"
  activate
  if (count of windows) = 0 then
    try
      create window with profile "OpenScout Herd"
    on error
      create window with default profile
    end try
  else
    tell current window
      try
        create tab with profile "OpenScout Herd"
      on error
        create tab with default profile
      end try
    end tell
  end if
  tell current session of current window
    write text "${escaped}"
  end tell
end tell`;
}

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";

/**
 * A new Ghostty window running `command` (Ghostty's `surface configuration`
 * record, from its sdef). `command` replaces the configured shell for that
 * one surface; the window closes when the attach client exits.
 */
export function ghosttyWindowScript(command: string): string {
  return `tell application id "${GHOSTTY_BUNDLE_ID}"
  activate
  set cfg to new surface configuration
  set command of cfg to "${appleScriptEscape(command)}"
  new window with configuration cfg
end tell`;
}

/** `is running` needs no Automation grant, unlike a `tell` block. */
async function isAppRunning(bundleId: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const result = await execSystemFile(
      "osascript",
      ["-e", `application id "${appleScriptEscape(bundleId)}" is running`],
      { timeoutMs: 2_000, env },
    );
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * The installed app an operator named, by kind (`ghostty`, `iterm`,
 * `terminal`, …) or by display name. Null when nothing installed matches —
 * the caller reports that rather than opening somewhere else.
 */
export function localTerminalAppForChoice(
  choice: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalTerminalApp | null {
  const wanted = choice.trim().toLowerCase();
  if (!wanted) return null;
  return listLocalTerminalApps(env).find((app) => app.kind === wanted || app.name.toLowerCase() === wanted) ?? null;
}

/**
 * GUI terminal processes must not be awaited — `execSystemFile` waits for exit
 * and a terminal stays alive for as long as its window is open. Spawn detached
 * and report the spawn event (or the spawn failure) instead.
 */
function spawnDetached(file: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<Error | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, [...args], { env, detached: true, stdio: "ignore" });
    } catch (error) {
      resolve(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    child.once("error", (error: Error) => resolve(error));
    child.once("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

async function runAppleScript(source: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execSystemFile("osascript", ["-e", source], { timeoutMs: 5_000, env });
}

/**
 * Open `argv` in the operator's terminal app. `app` overrides selection —
 * callers pass one only when the operator named it. Throws with a reason the
 * endpoint can hand back verbatim.
 */
export async function openLocalTerminalAttach(
  argv: readonly string[],
  options: {
    cwd?: string | null;
    env?: NodeJS.ProcessEnv;
    app?: LocalTerminalApp | null;
    platform?: NodeJS.Platform;
    /** Marks the attach as this pop-out's (markedAttach), so it can be closed later. */
    popOut?: string;
  } = {},
): Promise<LocalTerminalOpenResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("opening a local terminal app is wired for macOS only");
  }
  if (argv.length === 0) {
    throw new Error("the terminal surface has no attach command");
  }
  const env = options.env ?? process.env;
  const app = options.app !== undefined ? options.app : preferredLocalTerminalApp(env);
  if (!app) {
    throw new Error(
      env.OPENSCOUT_TERMINAL_APP?.trim()
        ? `configured terminal app ${env.OPENSCOUT_TERMINAL_APP} is not installed`
        : "no terminal app found",
    );
  }

  if (options.popOut !== undefined && !isPopOutToken(options.popOut)) {
    throw new Error("the pop-out token is malformed");
  }
  if (options.popOut) argv = markedAttach(argv, options.popOut);
  const shellLine = attachShellLine(argv, options.cwd);

  switch (app.kind) {
    case "terminal":
      await runAppleScript(terminalAppScript(shellLine), env);
      break;
    case "iterm":
      await runAppleScript(itermScript(shellLine), env);
      break;
    case "ghostty": {
      const shell = env.SHELL?.trim() || "/bin/zsh";
      // A running Ghostty (1.3+ ships an AppleScript dictionary) gets a new
      // window in the SAME instance. `open -na … -e` would start a second
      // Ghostty process with its own dock icon. Ghostty registers no URL
      // scheme, so there is no browser-side path; this runs server-side.
      // The AppleScript route can fail (older Ghostty, Automation permission
      // denied); the `-e` launch is the fallback and the cold-start path.
      if (await isAppRunning(GHOSTTY_BUNDLE_ID, env)) {
        try {
          await runAppleScript(ghosttyWindowScript(`${shellQuote(shell)} -lc ${shellQuote(shellLine)}`), env);
          break;
        } catch {
          // fall through to the CLI launch
        }
      }
      const failure = await spawnDetached("open", [
        "-na", app.path, "--args", "-e", shell, "-lc", shellLine,
      ], env);
      if (failure) throw failure;
      break;
    }
    case "alacritty": {
      const binary = join(app.path, "Contents", "MacOS", "alacritty");
      const executable = existsSync(binary) ? binary : app.path;
      const cwd = options.cwd?.trim();
      const args: string[] = cwd && existsSync(cwd) ? ["--working-directory", cwd] : [];
      const plainArgv = argv.every((arg) => !arg.includes(" ") && !arg.includes("="));
      if (plainArgv) {
        args.push("-e", ...argv);
      } else {
        const shell = env.SHELL?.trim() || "/bin/zsh";
        args.push("-e", shell, "-lc", shellLine);
      }
      const failure = await spawnDetached(executable, args, env);
      if (failure) throw failure;
      break;
    }
    case "hyper":
    case "unknown":
    default: {
      // No stable "run this command" API: command on the pasteboard, app open.
      await runAppleScript(`set the clipboard to "${appleScriptEscape(shellLine)}"`, env);
      const failure = await spawnDetached("open", ["-a", app.path], env);
      if (failure) throw failure;
      break;
    }
  }

  return { app: app.name, ...(await runningAppAt(app.path, env)) };
}

/** The bundle id in the app's Info.plist, or null when it can't be read. */
async function bundleIdAt(path: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await execSystemFile("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(path, "Contents", "Info.plist")], { timeoutMs: 2_000, env, maxStdoutBytes: 1024 });
    const bundleId = stdout.trim();
    return /^[A-Za-z0-9.-]+$/u.test(bundleId) ? bundleId : null;
  } catch {
    return null;
  }
}

/**
 * Whether the terminal app already runs, so a hop can go to an open terminal
 * instead of starting one. Asked of LaunchServices (`lsappinfo`), which reads
 * without launching anything or asking for Automation. An app whose identity
 * can't be read counts as running: the hop then opens it as before.
 */
export async function isLocalTerminalAppRunning(app: LocalTerminalApp, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const bundleId = await bundleIdAt(app.path, env);
  if (!bundleId) return true;
  try {
    const { stdout } = await execSystemFile("/usr/bin/lsappinfo", ["info", "-only", "pid", "-app", bundleId], { timeoutMs: 2_000, env, maxStdoutBytes: 1024 });
    // `"pid"=703` from a GUI session, `pid = 703` from one with no window server
    const pid = Number(/"?pid"?\s*=\s*(\d+)/u.exec(stdout)?.[1]);
    return Number.isInteger(pid) && pid > 1;
  } catch {
    return true;
  }
}

/** The bundle id and pid of the running app at `path`; empty when it can't be read (a cold start still launching). */
async function runningAppAt(path: string, env: NodeJS.ProcessEnv): Promise<{ bundleId?: string; pid?: number }> {
  const bundleId = await bundleIdAt(path, env);
  if (!bundleId) return {};
  try {
    const { stdout } = await execSystemFile("/usr/bin/lsappinfo", ["info", "-only", "pid", "-app", bundleId], { timeoutMs: 2_000, env, maxStdoutBytes: 1024 });
    const pid = Number(/"pid"=(\d+)/u.exec(stdout)?.[1]);
    return Number.isInteger(pid) && pid > 1 ? { bundleId, pid } : { bundleId };
  } catch {
    return { bundleId };
  }
}

/** Every process that carries a pop-out's token: in its environment (the attach) or its argv (the shell that ran it). */
export function popOutPids(listing: string, token: string, self = process.pid): number[] {
  if (!isPopOutToken(token)) return [];
  const mark = new RegExp(`(^|\\s)${POP_OUT_MARK}=${token}(\\s|$)`, "u");
  const pids: number[] = [];
  for (const line of listing.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (!match || !mark.test(match[2]!)) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid) && pid > 1 && pid !== self) pids.push(pid);
  }
  return pids;
}

/**
 * The pop-out processes that are its attach client (`claude attach <job>`,
 * `tmux … attach -t <session>`), the only ones Done may press past a hang-up.
 * Anything else carrying the token, such as a Claude daemon the attach
 * happened to start, is never signalled harder than a hang-up.
 */
export function popOutAttachPids(listing: string, token: string, self = process.pid): number[] {
  const marked = new Set(popOutPids(listing, token, self));
  const client = /^\s*(\d+)\s+(?:\S*\/)?(?:claude|tmux)\s+(?:-\S+\s+\S+\s+)*attach(?:-session)?\s/u;
  const pids: number[] = [];
  for (const line of listing.split("\n")) {
    const match = client.exec(line);
    if (match && marked.has(Number(match[1]))) pids.push(Number(match[1]));
  }
  return pids;
}

/**
 * Done on a pop-out: hang up its attach, as closing its window would. The
 * client exits, the shell that ran it ends, and the terminal app closes the
 * window; the session itself keeps running. Only processes carrying the
 * token are hung up. An attach client still there after a grace period is
 * terminated, then killed, so the window is left with nothing running and
 * the host can close it without the terminal asking first. Resolves how
 * many processes were hung up.
 */
export async function closeLocalTerminalPopOut(
  token: string,
  deps: {
    list?: () => Promise<string>;
    signal?: (pid: number, signal: NodeJS.Signals) => void;
    sleep?: (ms: number) => Promise<void>;
    graceMs?: number;
  } = {},
): Promise<number> {
  if (!isPopOutToken(token)) throw new Error("the pop-out token is malformed");
  const list = deps.list ?? (async () => (await execSystemFile("ps", ["-axwwE", "-o", "pid=,command="], { timeoutMs: 5_000, maxStdoutBytes: 16 * 1024 * 1024 })).stdout);
  const signal = deps.signal ?? ((pid: number, sig: NodeJS.Signals) => { process.kill(pid, sig); });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const graceMs = deps.graceMs ?? 1_500;
  const send = (pids: number[], sig: NodeJS.Signals) => {
    let sent = 0;
    for (const pid of pids) {
      try {
        signal(pid, sig);
        sent += 1;
      } catch {
        // Gone already, or not ours to signal (the terminal's login wrapper).
      }
    }
    return sent;
  };
  const closed = send(popOutPids(await list(), token), "SIGHUP");
  if (closed === 0) return 0;
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    let left = popOutAttachPids(await list(), token);
    for (let waited = 0; left.length > 0 && waited < graceMs; waited += 150) {
      await sleep(150);
      left = popOutAttachPids(await list(), token);
    }
    if (left.length === 0) break;
    send(left, sig);
  }
  return closed;
}
