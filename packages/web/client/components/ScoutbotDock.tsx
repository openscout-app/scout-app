import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { usePersistentBoolean } from "../lib/persistent-state.ts";
import { scoutbotRequestMarkKey, useScoutbotMarks } from "../lib/scoutbot-marks.ts";
import { isScoutbotShortcut, scoutbotShortcutAria, scoutbotShortcutLabel } from "../lib/scoutbot-shortcut.ts";
import type { OperatorAttentionItem } from "../lib/types.ts";
import { NAV_DESTINATIONS } from "../scout/nav-destinations.ts";
import { useScout } from "../scout/Provider.tsx";
import { useScoutbotPagePanelClaimed } from "../scout/scoutbot/page-panel-claim.ts";
import { ScoutbotPanel } from "../scout/scoutbot/ScoutbotPanel.tsx";
import { useScoutbotState, type ScoutbotActivity } from "../scout/scoutbot/ScoutbotStateContext.tsx";
import { ScoutbotFigure } from "../screens/companion/Scoutbot.tsx";
import { useRequestRows } from "../screens/requests/use-request-rows.ts";
import { useContextMenu, type MenuItem } from "./ContextMenu.tsx";
import { ScoutbotNextStack, scoutbotNextWho } from "./ScoutbotNextStack.tsx";
import { ScoutbotThinking } from "./ScoutbotThinking.tsx";

import "./scoutbot-dock.css";

/** Shared with every ScoutbotPanel: collapsed is the sheet closed. */
const COLLAPSED_KEY = "openscout.scoutbot.collapsed";
const MARK_HIDDEN_KEY = "openscout.scoutbot.mark-hidden";

const SHORTCUT_LABEL = scoutbotShortcutLabel();
const SHORTCUT_ARIA = scoutbotShortcutAria();

function activityLine(activity: ScoutbotActivity): string | null {
  switch (activity) {
    case "listening":
      return "Scoutbot is listening";
    case "thinking":
    case "briefing":
      return "Scoutbot is thinking";
    case "speaking":
      return "Scoutbot is speaking";
    default:
      return null;
  }
}

const askingWho = scoutbotNextWho;

/**
 * Scoutbot in the corner of every page: its face stands on the status bar's
 * top line, and a click or ⌘/ raises a sheet. The sheet leads with what is
 * next (ScoutbotNextStack), then the Scoutbot thread.
 * The sheet is the panel's one home in the shell. Where a page draws its own
 * panel (Voice, the Local Live call), the dock steps aside.
 */
export function ScoutbotDock() {
  const { route, navigate } = useScout();
  const { state, actions } = useScoutbotState();
  const [collapsed, setCollapsed] = usePersistentBoolean(COLLAPSED_KEY, true);
  const [markHidden, setMarkHidden] = usePersistentBoolean(MARK_HIDDEN_KEY, false);
  const { live } = useRequestRows();
  const showContextMenu = useContextMenu();
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const elsewhere = useScoutbotPagePanelClaimed();
  const open = !elsewhere && !collapsed;
  const [marks, mark] = useScoutbotMarks();
  const isHeld = useCallback(
    (item: OperatorAttentionItem) => marks[scoutbotRequestMarkKey(item)] === "held",
    [marks],
  );
  // A row set aside with Not now stops the face looking up for it too.
  const asking = live.find((item) => !isHeld(item)) ?? null;
  const page = NAV_DESTINATIONS.find((destination) => destination.active(route))?.label ?? null;
  const busy = activityLine(state.activity);
  const thinking = state.activity === "thinking" || state.activity === "briefing";

  const openSheet = useCallback(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && !sheetRef.current?.contains(active)
      ? active
      : null;
    // Opens the panel and focuses its composer.
    actions.triggerAskState();
  }, [actions]);

  const closeSheet = useCallback(() => {
    setCollapsed(true);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected) back.focus();
  }, [setCollapsed]);

  const toggle = useCallback(() => {
    // Where the page draws its own panel, the shortcut goes to that one.
    if (elsewhere) {
      actions.triggerAskState();
      return;
    }
    if (open) closeSheet();
    else openSheet();
  }, [actions, closeSheet, elsewhere, open, openSheet]);

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    // Capture, so a page's own "/" handler never sees ⌘/.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isScoutbotShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const onSheetKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    closeSheet();
  };

  const openMenu = (event: ReactMouseEvent) => {
    const items: MenuItem[] = [
      { kind: "action", label: "Start fresh", onSelect: () => actions.startNewChat() },
      {
        kind: "action",
        label: state.voice.replies ? "Turn voice replies off" : "Turn voice replies on",
        onSelect: () => actions.toggleVoiceReplies(),
      },
      {
        kind: "action",
        label: "Settings and usage",
        onSelect: () => navigate({ view: "settings", section: "scoutbot" }),
      },
      { kind: "separator" },
      markHidden
        ? { kind: "action", label: "Keep in the corner", onSelect: () => setMarkHidden(false) }
        : { kind: "action", label: `Hide until ${SHORTCUT_LABEL}`, onSelect: () => setMarkHidden(true) },
    ];
    showContextMenu(event, items);
  };

  const pill = open
    ? "Hide Scoutbot"
    : asking
      ? `${askingWho(asking)} is asking`
      : thinking ? "Ask Scoutbot" : busy ?? "Ask Scoutbot";
  // Hidden from the corner, the mark still shows while the sheet is open, so
  // its menu can bring it back.
  const markShown = !markHidden || open;

  if (elsewhere) return null;

  return (
    <>
      <div
        ref={sheetRef}
        className="sbd-sheet"
        role="dialog"
        aria-label={page ? `Scoutbot on ${page}` : "Scoutbot"}
        hidden={!open}
        onKeyDown={onSheetKeyDown}
      >
        {open ? (
          <ScoutbotNextStack
            items={live}
            onOpen={(item) => navigate({ view: "requests", requestId: item.id })}
            onOpenAll={() => navigate({ view: "requests" })}
            isHeld={isHeld}
            onHold={(item) => mark(scoutbotRequestMarkKey(item), "held")}
          />
        ) : null}
        <div className="sbd-thread">
          <ScoutbotPanel
            fill
            askPlaceholder={page ? `Ask about ${page}` : undefined}
            heading={(
              <span className="sbd-heading">
                <span className="sbd-heading__name">Scoutbot</span>
                {page ? <span className="sbd-heading__page">on {page}</span> : null}
              </span>
            )}
          />
        </div>
      </div>
      {markShown ? (
        <button
          type="button"
          className="sbd-mark"
          data-open={open ? "" : undefined}
          data-busy={busy && !open && (!thinking || asking !== null) ? "" : undefined}
          aria-label={open ? "Hide Scoutbot" : asking ? `${askingWho(asking)} is asking. Open Scoutbot` : thinking ? "Scoutbot is thinking. Open Scoutbot" : "Ask Scoutbot"}
          aria-expanded={open}
          aria-keyshortcuts={SHORTCUT_ARIA}
          onClick={toggle}
          onContextMenu={openMenu}
        >
          <span className="sbd-pill" aria-hidden="true">
            {pill}
            <kbd>{SHORTCUT_LABEL}</kbd>
          </span>
          <span className="sbd-face">
            {thinking && !open && !asking ? <ScoutbotThinking size={36} decorative /> : <ScoutbotFigure look="graphite" mood={asking && !open ? "ask" : "rest"} size={36} />}
          </span>
        </button>
      ) : null}
    </>
  );
}
