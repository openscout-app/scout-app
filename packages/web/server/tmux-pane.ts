/**
 * Reads of the default tmux server (the one the terminal relay attaches to),
 * for the companion's quick terminal: a session by exact name, and the
 * session and tty a pane id belongs to. The reads create, attach and resize
 * nothing. The one write, startPopOutPane, starts a background session's
 * attach in a tmux session of Scout's own, so the quick terminal can show it.
 */
import { execSystemFile } from "@openscout/runtime/system-probes";
import { TMUX_PANE_ID, type TmuxHostSession } from "./session-reveal.ts";
import { attachShellLine, isPopOutToken, markedAttach } from "./local-terminal-open.ts";

/** A pop-out's tmux session: named for its token, so it never takes another session's name. */
export function popOutSessionName(token: string): string {
  return `scout-popout-${token.slice(0, 12)}`;
}

/** The quick terminal's size in cells: its pop-up at 12px (POPUP in quick-terminal.ts). */
export const POP_OUT_SIZE = { columns: 96, rows: 24 } as const;

/**
 * Starts an attach command (`claude attach <job>`) detached, in a new tmux
 * session on the default server, marked as pop-out `token` (markedAttach) so
 * closeLocalTerminalPopOut hangs it up; the session ends when the attach
 * does. Through the login shell, as a terminal app runs it, so `claude` is on
 * its PATH. Resolves the tmux session's name.
 */
export async function startPopOutPane(argv: readonly string[], cwd: string | null, token: string, env: NodeJS.ProcessEnv = process.env,
  size: { columns: number; rows: number } = POP_OUT_SIZE): Promise<string> {
  if (!isPopOutToken(token)) throw new Error("the pop-out token is malformed");
  if (argv.length === 0) throw new Error("the session has no attach command");
  const name = popOutSessionName(token);
  const shell = env.SHELL?.trim() || "/bin/zsh";
  await execSystemFile("tmux", ["-u", "new-session", "-d", "-s", name,
    "-x", String(size.columns), "-y", String(size.rows),
    shell, "-lc", attachShellLine(markedAttach(argv, token), cwd)], { timeoutMs: 4_000, maxStdoutBytes: 4096 });
  return name;
}

/**
 * Ends a pop-out's own tmux session, if it is still there, hanging up what
 * runs in it: the attach, or the login shell still on its way to it. Only the
 * session named for this token (exact match), never another. Resolves whether
 * one was ended.
 */
export async function endPopOutPane(token: string): Promise<boolean> {
  if (!isPopOutToken(token)) return false;
  try {
    await execSystemFile("tmux", ["kill-session", "-t", `=${popOutSessionName(token)}`], { timeoutMs: 2_000, maxStdoutBytes: 4096 });
    return true;
  } catch {
    return false;
  }
}

/** The tmux session with exactly this name on the default server, or null. */
export async function tmuxSessionNamed(name: string): Promise<TmuxHostSession | null> {
  // -u: without a UTF-8 locale tmux prints the tabs as "_" (see session-steering.ts readTmux).
  const { stdout } = await execSystemFile("tmux", ["-u", "list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{socket_path}\t#{session_path}"],
    { timeoutMs: 2_000, maxStdoutBytes: 256 * 1024 });
  const row = stdout.split("\n").map((line) => line.split("\t")).find(([session]) => session === name);
  return row ? { session: name, attached: Number(row[1]) > 0, socket: row[2] || null, cwd: row[3] || null } : null;
}

/** The session and tty of a pane (`%N`) on the default server, or null. */
export async function tmuxPaneOf(paneId: string): Promise<{ session: string; tty: string | null } | null> {
  if (!TMUX_PANE_ID.test(paneId)) return null;
  const { stdout } = await execSystemFile("tmux", ["-u", "display-message", "-p", "-t", paneId, "#{session_name}\t#{pane_tty}"],
    { timeoutMs: 2_000, maxStdoutBytes: 4096 });
  const [session, tty] = stdout.trim().split("\t");
  return session ? { session, tty: tty || null } : null;
}
