/**
 * A pane a permission prompt was caught on, embedded where the prompt is shown.
 *
 * Watching is a read-only tmux client that takes the pane's size. Jumping in is
 * a writer that still takes the pane's size (`sizing=follow`): the relay attaches
 * it with tmux's ignore-size flag, never resizes the window and never creates a
 * missing session. Jumping out closes only that client, so the pane is handed
 * back as it was to whoever else is attached.
 */
export type PaneMode = "watch" | "joined";

export type PaneTarget = { backend: "tmux"; sessionName: string };

/** The relay socket for a pane: a joined guest asks the relay to follow the pane's size, never set it. */
export function paneRelayUrl(base: string, mode: PaneMode): string {
  if (mode !== "joined") return base;
  return `${base}${base.includes("?") ? "&" : "?"}sizing=follow`;
}

/** How long the relay keeps a pane's client once the companion lets go: long enough to ride out a blip. */
export const PANE_RELEASE_MS = 1_000;

/** The relay session for a pane. Never resumed: every attach is a fresh tmux client with a full redraw. */
export function paneRelayOptions(pane: PaneTarget, mode: PaneMode) {
  return {
    backend: pane.backend,
    tmuxSession: pane.sessionName,
    // The relay never starts a command for a pane it only joins; a shell is the harmless placeholder.
    agent: "shell",
    controlMode: mode === "joined" ? "takeover" : "observe",
    orphanTTL: PANE_RELEASE_MS,
  } as const;
}

/** The line above the pane: whose it is, and whether keys reach it. */
export function paneLine(mode: PaneMode, who: string | null): string {
  const pane = who ? `${who}'s pane` : "the pane";
  return mode === "joined" ? `Your keys go to ${pane}` : `Watching ${pane}`;
}

/** Jump out from the keyboard: a shortcut a terminal never receives, so it takes nothing from the pane. */
export function isJumpOutKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === ".";
}
