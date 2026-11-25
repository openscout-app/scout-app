import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { PaneView } from "../../../components/PaneView.tsx";
import { focusCompanionInput } from "../../../lib/companion-host.ts";
import { requestUpdatedAge } from "../../requests/requests-model.ts";
import {
  canShowQuickTerminal,
  closeQuickTerminal,
  mountQuickTerminalHost,
  popupPlace,
  quickTerminal,
  subscribeQuickTerminal,
  type Box,
  type QuickTerminalOpen,
} from "./quick-terminal.ts";
import "./quick-terminal.css";

/** The pop-up's region for the host's pointer map. */
export const QUICK_TERMINAL_HIT = "quick-terminal";

/** The open pop-up, as it changes. */
export function useQuickTerminal(): QuickTerminalOpen | null {
  return useSyncExternalStore(subscribeQuickTerminal, quickTerminal, quickTerminal);
}

/** Whether this page draws the pop-up, as hosts mount and go: the quick terminal is offered only then. */
export function useQuickTerminalShown(): boolean {
  return useSyncExternalStore(subscribeQuickTerminal, canShowQuickTerminal, canShowQuickTerminal);
}

/**
 * Draws the quick terminal on this page (one at a time). While a host is
 * mounted, a session's tmux pane opens here instead of in a terminal app.
 */
export function QuickTerminalHost({ keepClear }: { keepClear: () => Box | null }) {
  const open = useQuickTerminal();
  useEffect(() => mountQuickTerminalHost(), []);
  // Closed, it stays drawn for its fade (QUICK_TERMINAL_LEAVE_MS), then goes.
  const [shown, setShown] = useState(open);
  if (open && open !== shown) setShown(open);
  const leaving = !open && shown;
  useEffect(() => {
    if (open || !shown) return;
    const timer = window.setTimeout(() => setShown(null), QUICK_TERMINAL_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [open, shown]);
  const drawn = open ?? shown;
  return drawn ? <QuickTerminalPopup key={drawn.key} open={drawn} leaving={Boolean(leaving)} keepClear={keepClear} /> : null;
}

/** How long a closed pop-up fades before it goes (matches .qtp.is-leaving). */
export const QUICK_TERMINAL_LEAVE_MS = 120;

function QuickTerminalPopup({ open, leaving, keepClear }: { open: QuickTerminalOpen; leaving: boolean; keepClear: () => Box | null }) {
  // Placed once, where it opened: it doesn't chase the board around.
  const [place] = useState(() => popupPlace(keepClear(), { width: window.innerWidth, height: window.innerHeight }));
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  // Opened: the pop-up takes the keys, so Jump in and Esc work at once.
  useEffect(() => {
    focusCompanionInput();
    ref.current?.querySelector<HTMLElement>(".scout-pane-terminal__toggle")?.focus({ preventScroll: true });
  }, []);
  const close = () => closeQuickTerminal(open.key);
  // Esc closes while watching; once jumped in, Esc is the pane's (⌘. jumps out first).
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.metaKey || e.altKey || e.ctrlKey) return;
    if ((e.target as Element | null)?.closest?.("[data-pane-joined='true']")) return;
    e.preventDefault();
    close();
  };
  const who = open.who ?? "The agent";
  return (
    <section
      ref={ref}
      className={leaving ? "qtp is-leaving" : "qtp"}
      data-hit={leaving ? undefined : QUICK_TERMINAL_HIT}
      aria-hidden={leaving || undefined}
      role="dialog"
      aria-label={`${who}'s terminal`}
      style={{ left: place.left, top: place.top, width: place.width, height: place.height }}
      onKeyDown={onKeyDown}
    >
      <header className="qtp__head">
        <span className="qtp__kind">{open.kind}</span>
        <span className="qtp__who">{who}{open.at ? ` · ${requestUpdatedAge(open.at, now)}` : ""}</span>
        <button type="button" className="qtp__close" onClick={close} title="Close · esc. Its session keeps running." aria-label="Close the terminal. Its session keeps running.">
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </header>
      <h3 className="qtp__title" title={open.title}>{open.title}</h3>
      <div className="qtp__pane">
        <PaneView pane={open.pane} who={open.who} lead fontSize={12} />
      </div>
    </section>
  );
}
