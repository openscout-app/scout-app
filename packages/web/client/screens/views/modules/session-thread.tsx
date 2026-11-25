/**
 * Session thread — one session, read and answered in place.
 *
 * Shows:  the session's header (harness, title, and Request, Working,
 *         Loading, Unavailable or Idle), its turns (what was said to it, the
 *         work folded under each turn, what it said), an open request with
 *         its answers, the files it changed (Review changes), and the
 *         composer: Send, or Stop while it works. The session's details (its
 *         figures, changed files and what was sent) go to a Session details
 *         panel beside it when there is one (the Sessions view docks one on
 *         its right); else, and for a pinned session, Desk draws them beside
 *         the thread once the panel is 760px wide. On a flight page, the
 *         flight's bar (its state, Session and
 *         Compare) above; with ?compare= the two sessions side by side, or
 *         stacked in a narrow panel. Terminal: the terminal that already
 *         runs the session (the surface the hop controls find for it, else
 *         its Scout agent's own terminal, as the Terminals page draws it),
 *         in the thread's place, observed; Take over lasts
 *         until the session changes, and a reload opens on the thread. It is
 *         offered only when that terminal is found (else its chip says why),
 *         never for two compared sessions, and nothing starts one. Head:
 *         Thread, Terminal (and Observe, Take over while it shows), Pin,
 *         Unpin, Open full.
 * Data:   the session by ref (/api/session-ref/:ref, again on its broker and
 *         tail events), its touched files, the live delivery check
 *         (/steer, every 10s) and, on Desk, the delivery log (/steer/audit,
 *         every 10s); its board row from the shared board read
 *         (screens/sessions/session-board-store.ts); on a flight page the
 *         flight's record (one read per flight). For Terminal, this host's
 *         terminals (/api/terminal-sessions with discovered ones, every 15s,
 *         the read every hop control shares), the roster (useScout().agents)
 *         and the terminal relay, keyed by the panel, once it shows.
 * Scope:  Session: "This page's session" follows /sessions/:ref (with its
 *         ?machineId=) and a flight page's session; on bare /sessions and
 *         anywhere else, the pick of a Session board beside it. Unset shows
 *         that pick everywhere; or one session, pinned. Layout: Desk (unset),
 *         Reading, Sheet.
 * Opens:  Review changes: the session's diff (/repo-diff); a request's
 *         links where they point; Open full: /sessions/:ref. Pin keeps this
 *         session here as the page moves on; Unpin follows again.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { useSessionTerminalTarget } from "../../../components/SessionHopMenu.tsx";
import { warmTerminalSessionInventory } from "../../../lib/session-terminal-hop.ts";
import { resolveAgentTerminalSurface } from "../../../lib/terminal-relay.ts";
import type { OperatorAttentionItem, Route } from "../../../lib/types.ts";
import { SessionSlot } from "../../sessions/SessionSlot.tsx";
import { SessionsFlightBar } from "../../sessions/SessionsFlightBar.tsx";
import { rowMatchesSelection, type SessionBoardRow } from "../../sessions/session-board-model.ts";
import type { SessionSelection } from "../../sessions/slot-deck.ts";
import { useFlightRecord } from "../../sessions/use-flight-record.ts";
import { useSessionBoard, useSessionBoardRows } from "../../sessions/use-session-board.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { TerminalContent } from "../../terminal/Terminal.tsx";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { sessionPicks } from "./session-picks.ts";
import {
  sessionTerminalAgent,
  sessionTerminalHasModes,
  sessionTerminalHints,
  sessionTerminalKey,
  sessionTerminalOffer,
  sessionTerminalRoute,
  sessionTerminalStep,
  type SessionTerminal as SessionTerminalShown,
} from "./session-terminal-model.ts";
import type { TerminalMode } from "./terminal-target-model.ts";
import {
  SESSION_KEY,
  THREAD_LAYOUT_OPTIONS,
  encodeSessionPin,
  onSessionsPage,
  pageCompare,
  pageRequestedRef,
  panelSession,
  sessionOptions,
  sessionPageRoute,
  threadDensity,
  threadEmptyLine,
  threadOffersOpenFull,
  threadOffersPin,
  threadSource,
} from "./sessions-view-model.ts";
import { Quiet } from "./shared.tsx";
import "../../sessions/sessions-slots.css";
import "./sessions-panels.css";

const NO_ITEMS: OperatorAttentionItem[] = [];

function SessionThreadPanel({ instanceId, route, navigate, config, setConfig }: ModuleProps) {
  const board = useSessionBoard();
  const value = config[SESSION_KEY];
  const page = onSessionsPage(route) ? route : null;
  // a flight's session comes from the flight, read once for everything on the page
  const flightId = value === FOLLOW_PAGE ? page?.flightId : undefined;
  const flight = useFlightRecord(flightId);
  const requested = pageRequestedRef(route, flight.flight?.sessions ?? []);

  // showing picks: count in, so a board off its page keeps its picks for this panel
  const source = threadSource(route, value, requested);
  useEffect(() => (source === "pick" ? sessionPicks.follow() : undefined), [source]);
  const picked = useSyncExternalStore(sessionPicks.subscribe, sessionPicks.latest, sessionPicks.latest);
  const shown = panelSession(route, value, requested, picked);
  const compare = shown.source === "page" ? pageCompare(route) : null;
  const density = threadDensity(config);
  const requests = board.requests.state?.items ?? NO_ITEMS;

  const pinChips = (
    <>
      {threadOffersPin(shown) && (
        <button type="button" className="vw-chip" onClick={() => setConfig({ [SESSION_KEY]: encodeSessionPin(shown.selection) })} title="Keep this session here as the page moves on">
          Pin
        </button>
      )}
      {shown.source === "pinned" && (
        <button type="button" className="vw-chip" onClick={() => setConfig({ [SESSION_KEY]: FOLLOW_PAGE })} title="Follow the page's session again">
          Unpin
        </button>
      )}
      {threadOffersOpenFull(route, shown) && shown.selection && (
        <button type="button" className="vw-chip" onClick={() => navigate(sessionPageRoute(route, shown.selection!, board.localNodeId))} title="Open this session on its own page">
          Open full
        </button>
      )}
    </>
  );
  const bar = page && flightId && shown.source === "page"
    ? <SessionsFlightBar route={{ ...page, flightId }} flight={flight} requested={requested} navigate={navigate} />
    : null;

  if (!shown.selection) {
    const line = shown.source === "pick" && board.loading ? "Reading sessions…" : threadEmptyLine(shown.source);
    return <div className="vw-session-thread"><ModuleHead>{pinChips}</ModuleHead>{bar}{line && <Quiet>{line}</Quiet>}</div>;
  }
  const slot = (selection: SessionSelection, inspector: boolean, key: string, details = false) => (
    <SessionSlot
      key={key}
      selection={selection}
      density={density}
      inspector={inspector}
      details={details}
      row={board.rows.find((row) => rowMatchesSelection(row, selection))}
      requests={requests}
      navigate={navigate}
      localNodeId={board.localNodeId}
    />
  );
  const thread = (
    <div className="vw-session-thread-split" data-compare={compare ? "true" : undefined}>
      {/* the page's (or picked) session puts its details in a Session details panel docked beside it, when there is one; a pinned thread keeps its own */}
      <div className="vw-session-thread-pane">{slot(shown.selection, density === "desk", encodeSessionPin(shown.selection), shown.source !== "pinned")}</div>
      {compare && <div className="vw-session-thread-pane" aria-label="Compared session">{slot(compare, false, `compare:${encodeSessionPin(compare)}`)}</div>}
    </div>
  );
  // two sessions compared have no one terminal to show
  if (compare) return <div className="vw-session-thread"><ModuleHead>{pinChips}</ModuleHead>{bar}{thread}</div>;
  return (
    <ShownSession
      selection={shown.selection}
      row={board.rows.find((row) => rowMatchesSelection(row, shown.selection!))}
      localNodeId={board.localNodeId}
      relayScope={instanceId}
      navigate={navigate}
      pinChips={pinChips}
      bar={bar}
      thread={thread}
    />
  );
}

/**
 * One session on screen: its thread, or the terminal that already runs it
 * (a found surface, else its agent's own terminal). Terminal is offered only
 * when that terminal exists, and opens observing;
 * Take over and the Terminal view itself belong to this session, so another
 * session, a reload or a return opens on the thread. Nothing here starts a
 * terminal.
 */
function ShownSession({ selection, row, localNodeId, relayScope, navigate, pinChips, bar, thread }: {
  selection: SessionSelection;
  row: SessionBoardRow | undefined;
  localNodeId: string | null;
  relayScope: string;
  navigate: (route: Route) => void;
  pinChips: ReactNode;
  bar: ReactNode;
  thread: ReactNode;
}) {
  const over = encodeSessionPin(selection);
  const { agents } = useScout();
  const { target, resolved } = useSessionTerminalTarget(sessionTerminalHints(selection, row));
  const agent = sessionTerminalAgent(agents, selection, row);
  const offer = sessionTerminalOffer({
    resolved,
    target,
    agent: agent && { id: agent.id, hasTerminal: Boolean(resolveAgentTerminalSurface(agent)) },
    selection,
    localNodeId,
  });
  const [held, setHeld] = useState<{ over: string; mode: TerminalMode } | null>(null);
  useEffect(() => {
    if (held && held.over !== over) setHeld(null);
  }, [held, over]);
  // a terminal that ends shows the thread again; the Terminal chip then says why
  const terminal = held?.over === over && offer.available ? { shown: offer.terminal, mode: held.mode } : null;
  const show = (mode: TerminalMode) => setHeld({ over, mode });

  return (
    <div className="vw-session-thread">
      <ModuleHead>
        <button type="button" className="vw-chip" aria-pressed={!terminal} onClick={() => setHeld(null)} title="Read and answer this session">
          Thread
        </button>
        <button
          type="button"
          className="vw-chip"
          aria-pressed={Boolean(terminal)}
          aria-disabled={offer.available ? undefined : true}
          onMouseEnter={() => warmTerminalSessionInventory()}
          onClick={() => offer.available && !terminal && show("observe")}
          title={offer.available ? "Watch the terminal this session runs in, read-only" : offer.reason}
        >
          Terminal
        </button>
        {terminal && sessionTerminalHasModes(terminal.shown) && (
          <>
            <button type="button" className="vw-chip" aria-pressed={terminal.mode === "observe"} onClick={() => show("observe")} title="Watch, read-only">
              Observe
            </button>
            <button type="button" className="vw-chip" aria-pressed={terminal.mode === "takeover"} onClick={() => show("takeover")} title="Type into this terminal, until you leave this session">
              Take over
            </button>
          </>
        )}
        {pinChips}
      </ModuleHead>
      {bar}
      {terminal ? (
        <SessionTerminal
          terminal={terminal.shown}
          mode={terminal.mode}
          onMode={show}
          onBack={() => (terminal.mode === "takeover" ? show("observe") : setHeld(null))}
          navigate={navigate}
          relayScope={relayScope}
        />
      ) : thread}
    </div>
  );
}

/** The session's terminal in the thread's place, drawn as the Terminals page draws it, on the panel's own relay. */
function SessionTerminal({ terminal, mode, onMode, onBack, navigate, relayScope }: {
  terminal: SessionTerminalShown;
  mode: TerminalMode;
  onMode: (mode: TerminalMode) => void;
  onBack: () => void;
  navigate: (route: Route) => void;
  relayScope: string;
}) {
  const shown = sessionTerminalRoute(terminal, mode);
  const latest = useRef({ navigate, onMode, terminal });
  latest.current = { navigate, onMode, terminal };
  const local = useCallback((next: Route) => {
    const step = sessionTerminalStep(next, latest.current.terminal);
    if (step.to === "page") latest.current.navigate(next);
    else latest.current.onMode(step.mode);
  }, []);
  // The full page's back pill goes back in history, which here would leave
  // the page; in the panel it ends a takeover, else returns to the thread.
  const keepBackInPanel = (e: MouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest(".s-back-pill")) return;
    e.preventDefault();
    e.stopPropagation();
    onBack();
  };
  return (
    <div className="vw-session-terminal" onClickCapture={keepBackInPanel}>
      {/* which terminal, not how it is watched: a mode change keeps it mounted */}
      <TerminalContent key={sessionTerminalKey(terminal)} route={shown} navigate={local} relayScope={relayScope} />
    </div>
  );
}

/** Session, by pin: "This page's session" follows /sessions/:ref and a flight's session; unset shows the board's pick. */
const sessionScope: ModuleScope = {
  key: SESSION_KEY,
  allLabel: "Picked in a Session board",
  followsPage: "This page's session",
  useOptions: () => {
    const rows = useSessionBoardRows();
    return useMemo(() => sessionOptions(rows), [rows]);
  },
};

const layoutScope: ModuleScope = {
  key: "layout",
  allLabel: "Desk",
  useOptions: () => THREAD_LAYOUT_OPTIONS,
};

export const sessionThreadModule = defineModule({
  type: "session-thread",
  title: "Session",
  blurb: "One session, read and answered in place: its turns, requests, changes and composer, or the terminal it runs in",
  docs: {
    shows: "Header and state, the turns with their work folded, an open request, the files changed, and the composer (Send, or Stop while it works); Desk adds the delivery log and context when wide. On a flight page, its bar and the compared session. Terminal: the terminal that already runs the session, observed until Take over, offered only when found.",
    data: "/api/session-ref/:ref on its events, touched files, /steer and /steer/audit every 10s; its row from the shared board read; the flight's record on a flight page; for Terminal, /api/terminal-sessions every 15s, useScout().agents, and the terminal relay once it shows.",
    opens: "Review changes: /repo-diff; Open full: /sessions/:ref. Pin keeps the session as the page moves on.",
  },
  size: { w: 8, h: 20 },
  // the header, a turn and the composer still fit
  minSize: { w: 4, h: 12 },
  scopes: [sessionScope, layoutScope],
  Component: SessionThreadPanel,
});
