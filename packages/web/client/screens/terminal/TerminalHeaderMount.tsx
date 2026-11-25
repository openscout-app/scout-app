import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

export const SCOUT_TERMINAL_HEADER_SLOT_ID = "scout-terminal-header-slot";

/**
 * The Terminals screen's three header pieces: workspace tabs, the find field
 * and the actions. A host that lays them out itself (the basic build's
 * toolbar) provides these slots; everywhere else they render in the screen's
 * own bar. The app's top row never takes them: it stays the shell's.
 */
export const SCOUT_TERMINAL_HEADER_SLOT_IDS = {
  crumb: "scout-terminal-header-crumb-slot",
  search: "scout-terminal-header-search-slot",
  actions: SCOUT_TERMINAL_HEADER_SLOT_ID,
} as const;

export type TerminalHeaderSlot = keyof typeof SCOUT_TERMINAL_HEADER_SLOT_IDS;

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function findTerminalHeaderHost(slot: TerminalHeaderSlot): HTMLElement | null {
  return typeof document === "undefined"
    ? null
    : document.getElementById(SCOUT_TERMINAL_HEADER_SLOT_IDS[slot]);
}

/**
 * Put a workspace control in its host slot when the host provides one;
 * otherwise render it in place, in the screen's bar.
 */
export function TerminalHeaderMount({
  slot = "actions",
  children,
}: {
  slot?: TerminalHeaderSlot;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(() => findTerminalHeaderHost(slot));

  useBrowserLayoutEffect(() => {
    setHost(findTerminalHeaderHost(slot));
  }, [slot]);

  const connectedHost = host?.isConnected ? host : null;
  return connectedHost
    ? createPortal(children, connectedHost)
    : (
        <div
          className={`s-term-inline-header s-term-inline-header--${slot}`}
          data-scout-terminal-header-fallback={slot}
        >
          {children}
        </div>
      );
}
