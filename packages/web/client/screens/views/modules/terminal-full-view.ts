/*
 * ⌘⇧B on a composed view. On a full-bleed terminal page the shortcut gave the
 * terminal the whole screen (the shell hid its rails). A composition has no
 * rails to hide; the shortcut lifts the terminal's panel to the grid's full
 * view instead, or brings it back, the way the panel's ⤢ does. This file only
 * picks the panel; the grid owns full view (HudGrid's requestFullView). The
 * choice is pure, so it tests without a DOM.
 */

/** Modules that draw a terminal: one shell, one running terminal, the workspace deck. */
export const TERMINAL_PANEL_TYPES = ["terminal", "terminal-session", "terminal-workspace"] as const;

export type PanelFacts = {
  /** In full view now. */
  full: boolean;
  /** Holds the focused element: the terminal being typed into, or its head. */
  focused: boolean;
  /** Draws a live terminal (an xterm) now. */
  live: boolean;
  /** Is a terminal module, live or still picking. */
  terminal: boolean;
};

/**
 * Which panel the shortcut toggles, by its index, or -1 for none (the shell
 * then leaves the key alone). A terminal panel in full view goes back. Else
 * the terminal panel holding focus, else the first one drawing a live
 * terminal, else the first terminal module. A non-terminal panel in full view
 * gives way to the terminal.
 */
export function panelToLift(panels: readonly PanelFacts[]): number {
  const isTerminal = (p: PanelFacts) => p.terminal || p.live;
  const full = panels.findIndex((p) => p.full && isTerminal(p));
  if (full >= 0) return full;
  const pick = (test: (p: PanelFacts) => boolean) => panels.findIndex((p) => isTerminal(p) && test(p));
  for (const index of [pick((p) => p.focused), pick((p) => p.live), pick(() => true)]) {
    if (index >= 0) return index;
  }
  return -1;
}

/** The facts of one grid panel, read from the DOM the grid and CompositionHost draw. */
export function panelFacts(el: Element, active: Element | null): PanelFacts {
  return {
    full: el.classList.contains("is-full"),
    focused: !!active && el.contains(active),
    live: !!el.querySelector(".xterm"),
    terminal: TERMINAL_PANEL_TYPES.some((type) => el.classList.contains(`vw-panel--${type}`)),
  };
}

/** The grid panel ⌘⇧B lifts on this page, or null when none draws a terminal. */
export function terminalPanelToLift(root: ParentNode, active: Element | null): HTMLElement | null {
  const panels = Array.from(root.querySelectorAll<HTMLElement>(".hud-grid-panel[data-panel]"));
  return panels[panelToLift(panels.map((el) => panelFacts(el, active)))] ?? null;
}
