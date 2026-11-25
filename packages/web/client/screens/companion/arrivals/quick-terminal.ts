/**
 * The quick terminal, in the companion: a session's tmux pane in a pop-up of
 * the companion's own, beside the board, instead of a terminal app window.
 * Opened for a permission request ("Go to session") or for any session the
 * board shows (Quick terminal, ⌘T). It opens watching (read-only, at the
 * pane's size); Jump in lets keys through and Jump out hands the pane back
 * (PaneTerminal). Closing it closes only Scout's own client: the session and
 * anyone else attached to it carry on as they were. No terminal app is
 * started. A background session has no pane, so the runtime host starts its
 * attach in a tmux session of Scout's own (`release` hangs it up when the
 * pop-up goes); a session already in a pane gets no new process.
 *
 * One pop-up at a time. It is drawn by the page that mounts a host
 * (QuickTerminalHost, on the board's layer); without one, nothing offers it
 * and the ways in open a terminal app as before.
 */
import type { PaneTarget } from "../../../components/pane-terminal-model.ts";

export type QuickTerminalOpen = {
  /** What it was opened for (a request id, a session ref): a close may name it. */
  key: string;
  /** The header's first word: "Permission request", "Session". */
  kind: string;
  pane: PaneTarget;
  /** The agent, for the header and the pane's own line. */
  who: string | null;
  /** What it asked, or what the session is about, one line. */
  title: string;
  /** When it asked or last moved (ms). */
  at: number | null;
  /** A pop-up Scout started a process for: hangs that process up once the pop-up goes, however it goes. */
  release?: () => void;
};

let current: QuickTerminalOpen | null = null;
/** Drops the open pop-up, releasing what it started. */
function drop(): void {
  const gone = current;
  current = null;
  gone?.release?.();
}
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

export function quickTerminal(): QuickTerminalOpen | null {
  return current;
}

/** Hears a pop-up open or close, and a host mount or go. */
export function subscribeQuickTerminal(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Whether a page here draws the pop-up: only then is a session's terminal offered in it. */
export function canShowQuickTerminal(): boolean {
  return hosts > 0;
}

/** A host is drawn while mounted. Returns the unmount. */
export function mountQuickTerminalHost(): () => void {
  hosts += 1;
  if (hosts === 1) emit();
  return () => {
    hosts -= 1;
    if (hosts === 0) { drop(); emit(); }
  };
}

/** Show a session's terminal, in place of any other. */
export function showQuickTerminal(open: QuickTerminalOpen): void {
  if (current !== open) drop();
  current = open;
  emit();
}

/** Close the pop-up (only the one opened for `key`, when named). */
export function closeQuickTerminal(key?: string): void {
  if (!current || (key && current.key !== key)) return;
  drop();
  emit();
}

// ── where it stands ──────────────────────────────────────────────────────

export type Box = { left: number; top: number; right: number; bottom: number };

/** The pop-up's size: wide enough for a terminal's lines, never past the screen. */
export const POPUP = { WIDTH: 720, HEIGHT: 460, GAP: 12, INSET: 12 } as const;

/**
 * Where the pop-up stands, in page points: beside what it must keep clear of
 * (the board and any panel open by it), on the side with more room, its foot
 * level with the board's; on top of it, centred, when neither side has room.
 * With nothing to keep clear of, in the middle of the screen.
 */
export function popupPlace(clear: Box | null, view: { width: number; height: number }, size: { width: number; height: number } = { width: POPUP.WIDTH, height: POPUP.HEIGHT }): { left: number; top: number; width: number; height: number } {
  const width = Math.min(size.width, view.width - POPUP.INSET * 2);
  const height = Math.min(size.height, view.height - POPUP.INSET * 2);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  if (!clear) {
    return { left: Math.round((view.width - width) / 2), top: Math.round((view.height - height) / 2), width, height };
  }
  const roomLeft = clear.left - POPUP.GAP - POPUP.INSET;
  const roomRight = view.width - clear.right - POPUP.GAP - POPUP.INSET;
  const left = roomLeft >= roomRight
    ? (roomLeft >= width ? clear.left - POPUP.GAP - width : null)
    : (roomRight >= width ? clear.right + POPUP.GAP : null);
  const top = clamp(clear.bottom - height, POPUP.INSET, view.height - POPUP.INSET - height);
  return {
    left: Math.round(left ?? clamp((view.width - width) / 2, POPUP.INSET, view.width - POPUP.INSET - width)),
    top: Math.round(top),
    width,
    height,
  };
}
