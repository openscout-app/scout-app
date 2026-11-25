import { expect, test } from "bun:test";
import { createTerminalDiscovery, focusSessionTerminal, type SessionProcess, type SessionFocusBinding, type TerminalExec } from "./session-terminal.ts";

const start = "Thu Oct 15 12:00:00 2026";
const proc = (pid: number, parent: number, command?: string, tty = "ttys001"): SessionProcess =>
  ({ pid, parent, command, start, tty, foreground: true });
const pane = { socket: "/private/tmp/tmux-501/custom", pid: 10, tty: "ttys001", pane: "%7", session: "exact session" };
const plist = (bundleId = "com.mitchellh.ghostty") => JSON.stringify({ CFBundleIdentifier: bundleId, CFBundleName: "Ghostty" });
const done = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });
function executor(fn: (file: string, args: readonly string[]) => Promise<string> | string): TerminalExec {
  return (async (file, args) => done(await fn(file, args))) as TerminalExec;
}
const focusBinding = (host: "herdr" | "tmux" | "terminal" = "herdr", bundleId = "com.mitchellh.ghostty"): SessionFocusBinding => ({
  target: { host, address: host === "tmux" ? "%7" : host === "herdr" ? "live/w1:p2" : "ttys001", pid: 10, processStart: start, tty: "ttys001",
    terminal: { app: "Ghostty", bundleId, appPid: 30, ...(host === "tmux" ? { attached: true } : {}) } },
  terminal: { descriptor: { app: "Ghostty", bundleId, appPid: 30, ...(host === "tmux" ? { attached: true } : {}) }, appStart: start,
    ...(host === "tmux" ? { clients: [{ pid: 20, start, tty: "ttys009" }] } : {}) },
  herdr: host === "herdr" ? { session: "live", paneId: "w1:p2" } : null,
  tmux: host === "tmux" ? pane : null, orcaHandle: null,
});

test("walks the first GUI bundle, preserving spaced paths, and caches each pid/plist for a pass", async () => {
  const reads: number[] = [], calls: Array<[string, readonly string[]]> = [];
  const processes = [proc(10, 20), proc(11, 20), proc(20, 30), proc(30, 1, "/Applications/Ghostty Space.app/Contents/MacOS/ghostty")];
  const discovery = createTerminalDiscovery(async (pid) => { reads.push(pid); return processes.find((p) => p.pid === pid) ?? null; },
    executor((file, args) => { calls.push([file, args]); return plist(); }));
  const first = await discovery.resolve(processes[0]!, null), second = await discovery.resolve(processes[1]!, null);
  expect(first.descriptor).toEqual({ app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 30 });
  expect(second.appStart).toBe(start);
  expect(reads).toEqual([10, 20, 30, 11]);
  expect(calls).toHaveLength(1);
  expect(calls[0]![1].at(-1)).toBe("/Applications/Ghostty Space.app/Contents/Info.plist");
});

test("a CLI shipped inside ChatGPT.app is not its terminal's GUI owner", async () => {
  const discovery = createTerminalDiscovery(async (pid) => pid === 10
    ? proc(10, 30, "/Applications/ChatGPT.app/Contents/Resources/codex-cli/codex")
    : pid === 30 ? proc(30, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty") : null, executor(() => plist()));
  expect((await discovery.resolve(proc(10, 30), null)).descriptor.appPid).toBe(30);
});

test("a windowless helper resolves to the app that draws its windows", async () => {
  const helper = "/example/workstation-user/Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex";
  const rex = "/Applications/Rex Beta.app/Contents/MacOS/Rex";
  const processes = [proc(10, 20), proc(20, 915, "/usr/bin/login"), proc(915, 1, helper), proc(59327, 1, rex)];
  const plists: Record<string, object> = {
    [helper.replace(/MacOS\/rex$/u, "Info.plist")]: { CFBundleIdentifier: "com.superlogical.rex.server", CFBundleName: "Rex Server", CFBundleExecutable: "rex", LSUIElement: true },
    [rex.replace(/MacOS\/Rex$/u, "Info.plist")]: { CFBundleIdentifier: "com.superlogical.rex", CFBundleName: "Rex", CFBundleExecutable: "Rex" },
  };
  const asked: string[] = [];
  const exec = (lsappinfo: string) => executor((file, args) => {
    if (file === "/usr/bin/lsappinfo") { asked.push(String(args.at(-1))); return lsappinfo; }
    return JSON.stringify(plists[String(args.at(-1))] ?? {});
  });
  const read = async (pid: number) => processes.find((p) => p.pid === pid) ?? null;

  // what `lsappinfo info -only pid -app com.superlogical.rex` prints on macOS 27
  const lsappinfo = [
    "[ NULL ]  [ NULL ]  ",
    "    bundleID=[ NULL ] ",
    "    bundle path=[ NULL ] ",
    "    executable path=[ NULL ] ",
    "    pid = 59327 !cgsConnection !signalled type=[ NULL ]  flavor=[ NULL ]  Version=[ NULL ]  Arch=!!none ",
    "",
  ].join("\n");
  const found = await createTerminalDiscovery(read, exec(lsappinfo)).resolve(processes[0]!, null);
  expect(found.descriptor).toEqual({ app: "Rex", bundleId: "com.superlogical.rex", appPid: 59327 });
  expect(asked).toEqual(["com.superlogical.rex"]);
  expect((await createTerminalDiscovery(read, exec('"pid"=59327\n')).resolve(processes[0]!, null)).descriptor)
    .toEqual({ app: "Rex", bundleId: "com.superlogical.rex", appPid: 59327 });

  // No running owner, or a pid that is not that app: the helper stands, as before.
  const helperOnly = { app: "Rex Server", bundleId: "com.superlogical.rex.server", appPid: 915 };
  expect((await createTerminalDiscovery(read, exec("")).resolve(processes[0]!, null)).descriptor).toEqual(helperOnly);
  expect((await createTerminalDiscovery(read, exec('"pid"=20\n')).resolve(processes[0]!, null)).descriptor).toEqual(helperOnly);
});

test("ancestry cycles/depth are bounded and failed plist reads leave explicit unknowns", async () => {
  let reads = 0;
  const cyclic = createTerminalDiscovery(async (pid) => { reads++; return proc(pid, pid === 10 ? 11 : 10); });
  expect((await cyclic.resolve(proc(10, 11), null)).descriptor.bundleId).toBeNull();
  expect(reads).toBe(2);
  const deep = createTerminalDiscovery(async (pid) => { reads++; return proc(pid, pid + 1); });
  await deep.resolve(proc(10, 11), null);
  expect(reads).toBeLessThanOrEqual(27);
  const bad = createTerminalDiscovery(async (pid) => proc(pid, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"), executor(() => { throw Error("unreadable"); }));
  expect((await bad.resolve(proc(10, 1), null)).descriptor).toEqual({ app: null, bundleId: null, appPid: null });
});

test("tmux resolves the attached client's app and tty, never the server's ancestors", async () => {
  const reads: number[] = [], commands: Array<readonly string[]> = [];
  const processes = [proc(20, 30, "tmux", "ttys009"), proc(30, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty", "ttys009")];
  const discovery = createTerminalDiscovery(async (pid) => { reads.push(pid); return processes.find((p) => p.pid === pid) ?? null; },
    executor((file, args) => { commands.push(args); return file === "tmux" ? "20\t/dev/ttys009\n" : plist(); }));
  const result = await discovery.resolve(proc(10, 99), pane);
  expect(result.descriptor).toMatchObject({ appPid: 30, attached: true });
  expect(result.clients).toEqual([{ pid: 20, start, tty: "ttys009" }]);
  expect(reads).toEqual([20, 30]);
  expect(commands[0]).toEqual(["-u", "-S", pane.socket, "list-clients", "-t", "=exact session", "-F", "#{client_pid}\t#{client_tty}"]);
});

test("tmux detached, tty mismatch, and multiple different apps never guess a terminal", async () => {
  const detached = createTerminalDiscovery(async () => { throw Error("Must not walk the server"); }, executor(() => ""));
  expect((await detached.resolve(proc(10, 99), pane)).descriptor).toEqual({ app: null, bundleId: null, appPid: null, attached: false });
  const mismatch = createTerminalDiscovery(async (pid) => proc(pid, 1, undefined, "wrong"), executor(() => "20\tttys009"));
  expect((await mismatch.resolve(proc(10, 99), pane)).descriptor).toMatchObject({ appPid: null, attached: true });
  const multiple = createTerminalDiscovery(async (pid) => proc(pid, 1, "/Applications/App" + pid + ".app/Contents/MacOS/app", pid === 20 ? "ttys009" : "ttys010"),
    executor((file) => file === "tmux" ? "20\tttys009\n21\tttys010\n" : plist()));
  expect((await multiple.resolve(proc(10, 99), pane)).descriptor).toMatchObject({ appPid: null, attached: true });
});

test.skipIf(process.platform !== "darwin")("herdr selects the proven pane once, then requests app activation", async () => {
  const calls: Array<[string, readonly string[]]> = [];
  const result = await focusSessionTerminal(focusBinding(), executor((file, args) => { calls.push([file, args]); return file.endsWith("osascript") ? "activation-requested" : ""; }));
  expect(result).toMatchObject({ ok: true, precision: "pane", activation: "requested" });
  expect(calls[0]).toEqual(["herdr", ["--session", "live", "agent", "focus", "w1:p2"]]);
  expect(calls[1]![0]).toBe("/usr/bin/osascript");
  expect(calls[1]![1].slice(-2)).toEqual(["30", "com.mitchellh.ghostty"]);
  expect(calls[1]![1][3]).toContain("runningApplicationWithProcessIdentifier");
  expect(JSON.stringify(calls)).not.toContain("/usr/bin/open");
});

test.skipIf(process.platform !== "darwin")("tmux mutations pin the socket/window/pane, then match the CLIENT tty in iTerm", async () => {
  const calls: Array<[string, readonly string[]]> = [];
  const result = await focusSessionTerminal(focusBinding("tmux", "com.googlecode.iterm2"), executor((file, args) => { calls.push([file, args]); return file.endsWith("osascript") ? "selected\n" : ""; }));
  expect(result.ok).toBe(true);
  expect(calls[0]).toEqual(["tmux", ["-S", pane.socket, "select-window", "-t", "%7"]]);
  expect(calls[1]).toEqual(["tmux", ["-S", pane.socket, "select-pane", "-t", "%7"]]);
  expect(calls[2]![1].at(-1)).toBe("/dev/ttys009");
  expect(calls[2]![1][1]).toContain('tell application id "com.googlecode.iterm2"');
});

test("detached tmux returns a socket-pinned attach command and performs zero mutations", async () => {
  const binding = focusBinding("tmux");
  binding.terminal.descriptor.attached = false;
  let calls = 0;
  const result = await focusSessionTerminal(binding, executor(() => { calls++; return ""; }));
  expect(result).toMatchObject({ ok: false, code: "tmux_detached" });
  expect(result.attach).toBe("tmux -S '/private/tmp/tmux-501/custom' attach -t 'exact session'");
  expect(calls).toBe(0);
});

test.skipIf(process.platform !== "darwin")("plain Ghostty only activates the app, while Terminal selects by tty", async () => {
  const calls: Array<[string, readonly string[]]> = [];
  const exec = executor((file, args) => { calls.push([file, args]); return args.includes("JavaScript") ? "activation-requested" : file.endsWith("osascript") ? "selected" : ""; });
  expect(await focusSessionTerminal(focusBinding("terminal"), exec)).toMatchObject({ ok: true, precision: "app", selected: false });
  expect(calls).toHaveLength(1);
  expect(calls[0]![1].slice(-2)).toEqual(["30", "com.mitchellh.ghostty"]);
  calls.length = 0;
  expect(await focusSessionTerminal(focusBinding("terminal", "com.apple.Terminal"), exec)).toMatchObject({ ok: true, precision: "tty" });
  expect(calls[0]![1].at(-1)).toBe("/dev/ttys001");
  expect(calls[0]![1][1]).toContain("set selected tab of w to t");
});

test.skipIf(process.platform !== "darwin")("tab mismatch or partial activation failure is not retried or disguised as success", async () => {
  let calls = 0;
  const tty = await focusSessionTerminal(focusBinding("terminal", "com.apple.Terminal"), executor(() => { calls++; throw Error("private command args"); }));
  expect(tty).toMatchObject({ ok: false, code: "focus_unconfirmed", selected: false });
  expect(JSON.stringify(tty)).not.toContain("private");
  expect(calls).toBe(1);
  calls = 0;
  const partial = await focusSessionTerminal(focusBinding(), executor((file) => { calls++; if (file.endsWith("/osascript")) throw Error("denied"); return ""; }));
  expect(partial).toMatchObject({ ok: false, code: "native_activation_required", selected: true, nativeActivation: { appPid: 30 } });
  expect(calls).toBe(2);
});

test.skipIf(process.platform !== "darwin")("Orca switches only its verified runtime terminal handle before app activation", async () => {
  const binding = focusBinding();
  binding.target.host = "orca"; binding.herdr = null; binding.orcaHandle = "term_exact";
  const calls: Array<readonly string[]> = [];
  expect((await focusSessionTerminal(binding, executor((file, args) => { calls.push(args); return file.endsWith("/osascript") ? "activation-requested" : '{"ok":true}'; }))).ok).toBe(true);
  expect(calls[0]).toEqual(["terminal", "switch", "--terminal", "term_exact", "--json"]);
});

test("Electron helper bundles are skipped in favor of their running outer GUI app", async () => {
  const processes = [
    proc(10, 20, "/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper"),
    proc(20, 1, "/Applications/Orca.app/Contents/MacOS/Orca"),
  ];
  const discovery = createTerminalDiscovery(async (pid) => processes.find((p) => p.pid === pid) ?? null,
    executor(() => JSON.stringify({ CFBundleIdentifier: "ai.orca", CFBundleName: "Orca", CFBundleExecutable: "Orca" })));
  expect((await discovery.resolve(processes[0]!, null)).descriptor).toEqual({ app: "Orca", bundleId: "ai.orca", appPid: 20 });
});
