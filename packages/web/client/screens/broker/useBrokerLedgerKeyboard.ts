import { useCallback, useEffect, useRef, useState } from "react";
import { isEditableTarget, isModalShortcutContext, nextListIndex } from "../../lib/keyboard-nav-core.ts";
import {
  initialLedgerFocusState,
  ledgerFocusClamp,
  ledgerFocusMove,
  ledgerFocusTrack,
  ledgerActivationInPanel,
  ledgerKeyInPanel,
  shouldPullLedgerFocus,
  type LedgerFocusState,
} from "./ledger-focus-core.ts";

type UseBrokerLedgerKeyboardInput = {
  enabled: boolean;
  rowCount: number;
  onActivateRow: (index: number) => void;
  onClearSelection?: () => void;
  /**
   * In a view panel: keys bind while focus is inside `element` (the panel),
   * and with `idle` also while nothing on the page holds focus — on
   * /dispatch, where the ledger is the page. A key another handler already
   * took, or one with a modifier (the panel's own ⇧/⌥+arrows), passes by.
   * Absent: anywhere the Dispatch page is drawn, as on the full screen.
   */
  scope?: { element: () => HTMLElement | null; idle: boolean };
};

function keyIsForPanel(event: KeyboardEvent, scope: NonNullable<UseBrokerLedgerKeyboardInput["scope"]>): boolean {
  return ledgerKeyInPanel(event, {
    panel: scope.element(),
    active: document.activeElement,
    body: document.body,
    idle: scope.idle,
  });
}

function activationIsForRow(event: KeyboardEvent, scope: NonNullable<UseBrokerLedgerKeyboardInput["scope"]>): boolean {
  const target = event.target;
  return ledgerActivationInPanel({
    target,
    panel: scope.element(),
    body: document.body,
    inRow: target instanceof Element && Boolean(target.closest(".dsp-row")),
  });
}

// Focus policy — why intent is a numbered request rather than a flag — is
// documented on the protocol itself in ledger-focus-core.ts, where it is
// testable without a DOM.
export function useBrokerLedgerKeyboard({
  enabled,
  rowCount,
  onActivateRow,
  onClearSelection,
  scope,
}: UseBrokerLedgerKeyboardInput) {
  const [focusState, setFocusState] = useState<LedgerFocusState>(initialLedgerFocusState);
  const focusedIndex = focusState.index;
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const consumedFocusRequestRef = useRef(initialLedgerFocusState.request);

  const moveFocus = useCallback((next: number | ((current: number) => number)) => {
    setFocusState((current) => (
      ledgerFocusMove(current, typeof next === "function" ? next(current.index) : next)
    ));
  }, []);

  const setFocusedIndex = useCallback((next: number | ((current: number) => number)) => {
    setFocusState((current) => (
      ledgerFocusTrack(current, typeof next === "function" ? next(current.index) : next)
    ));
  }, []);

  useEffect(() => {
    if (!shouldPullLedgerFocus(focusState, consumedFocusRequestRef.current)) return;
    consumedFocusRequestRef.current = focusState.request;
    if (focusState.index < 0) return;
    const node = rowRefs.current.get(focusState.index);
    node?.scrollIntoView({ block: "nearest" });
    node?.focus();
  }, [focusState]);

  useEffect(() => {
    setFocusState((current) => ledgerFocusClamp(current, rowCount));
  }, [rowCount]);

  const registerRowRef = useCallback((index: number, node: HTMLElement | null) => {
    if (node) rowRefs.current.set(index, node);
    else rowRefs.current.delete(index);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (event: KeyboardEvent) => {
      if (scope ? !keyIsForPanel(event, scope) : !document.querySelector(".sys-broker-page")) return;
      if (isEditableTarget(event.target) || isModalShortcutContext()) return;
      if (rowCount === 0) return;

      if (event.key === "Escape") {
        // a panel takes Esc first, below, so it never also leaves full view
        if (onClearSelection && !scope) {
          event.preventDefault();
          onClearSelection();
          setFocusedIndex(-1);
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        moveFocus((current) => nextListIndex(current, rowCount, 1));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        moveFocus((current) => nextListIndex(current, rowCount, -1));
        return;
      }
      if (event.key === "Home" || (event.key === "g" && !event.shiftKey)) {
        event.preventDefault();
        moveFocus(0);
        return;
      }
      if (event.key === "End" || event.key === "G") {
        event.preventDefault();
        moveFocus(rowCount - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        if (scope && !activationIsForRow(event, scope)) return;
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        event.preventDefault();
        moveFocus(index);
        onActivateRow(index);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, focusedIndex, moveFocus, onActivateRow, onClearSelection, rowCount, scope, setFocusedIndex]);

  // In a panel, Esc closes the open dispatch before anything else sees it:
  // taken in the capture phase, so the grid keeps its full view and the
  // panel keeps focus. With no dispatch open it passes by untouched.
  useEffect(() => {
    if (!scope || !onClearSelection) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !keyIsForPanel(event, scope)) return;
      if (isEditableTarget(event.target) || isModalShortcutContext()) return;
      event.preventDefault();
      onClearSelection();
      setFocusedIndex(-1);
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [onClearSelection, scope, setFocusedIndex]);

  const getRowFocusProps = useCallback((index: number) => ({
    tabIndex: focusedIndex === index ? 0 as const : -1 as const,
    ref: (node: HTMLElement | null) => registerRowRef(index, node),
    onFocus: () => setFocusedIndex(index),
  }), [focusedIndex, registerRowRef, setFocusedIndex]);

  return { focusedIndex, setFocusedIndex, getRowFocusProps };
}
