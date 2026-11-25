/**
 * Session board — every session Scout can see, the live ones marked; pick one
 * to read it in the Session thread beside it.
 *
 * Shows:  as a List, rows under their project: harness, what the session is
 *         about, Working, Waiting or its age, and who runs it (and who started
 *         it, when another session did). A subagent listed with its parent
 *         session folds into the parent's row as a count, and the head counts
 *         the rows it shows. As Cards, also the project, machine
 *         and model; as Lanes, each session's Agent Lanes card with its last
 *         12 observed steps.
 *         The marked row is the session the thread beside it shows. Head: the
 *         count, Refresh, and Open full off the Sessions page. Quiet states:
 *         reading, no sessions yet, nothing in this scope, and a line when
 *         some sources failed (the last good reads stay).
 * Data:   one board read for the window, however many panels draw it
 *         (screens/sessions/session-board-store.ts): /api/sessions,
 *         /api/conversations?limit=250, /api/tail/discover and
 *         /api/tail/recent?limit=1000 every 15s while the page is visible,
 *         once per second of broker data events, and on Refresh; live tail
 *         events as they land; requests from the shared requests store. On a
 *         flight page, the flight's record (one read per flight).
 * Scope:  Follows: "This page's session" (the Sessions view ships its
 *         board so) marks the page's session and a pick writes it, on a
 *         Sessions page only; unset, the board keeps its own pick as state
 *         (`session`) and never moves the page. Show (Working · Requests ·
 *         From agents · Working or requests), Project, Machine, Harness, and
 *         Layout (List · Cards · Lanes).
 * Opens:  on a Sessions page, the session (/sessions/:ref in place; from a
 *         flight page as a new entry, so Back returns to the flight).
 *         Anywhere else, the Session thread beside it that shows picks, or
 *         the session's page when none does. Open full: the marked
 *         session's page, or /sessions.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { SessionBoardMembers } from "../../sessions/SessionBoardMembers.tsx";
import { foldSubagentRows, sessionProjectGroups, matchesSessionFilter, rowMatchesSelection, type SessionBoardRow } from "../../sessions/session-board-model.ts";
import { useFlightRecord } from "../../sessions/use-flight-record.ts";
import { useSessionBoard, useSessionBoardRows } from "../../sessions/use-session-board.ts";
import { defineModule, type ModuleProps, type ModuleScope, type ModuleScopeOption } from "./contract.ts";
import { ModuleHead, ModuleStrip } from "./ModuleHead.tsx";
import { useHarnessStrip } from "../../../scout/sidebar/HarnessStrip.tsx";
import { sessionPicks } from "./session-picks.ts";
import {
  BOARD_FOLLOW_KEY,
  BOARD_LAYOUT_OPTIONS,
  SESSION_KEY,
  SHOW_OPTIONS,
  boardCurrent,
  boardFilter,
  boardLayout,
  boardMode,
  boardOpen,
  boardOpenFull,
  decodeSessionPin,
  encodeSessionPin,
  harnessOptions,
  machineOptions,
  onSessionsPage,
  pageRequestedRef,
  pageSelection,
  projectOptions,
  stickyFirst,
} from "./sessions-view-model.ts";
import { Quiet } from "./shared.tsx";
import "../../sessions/sessions-slots.css";
import "./sessions-panels.css";

const NO_OPTIONS: readonly ModuleScopeOption[] = [];
/** The folded strip is a jump list: the sessions that need you or move, then the latest. */
const STRIP_LIMIT = 16;

/** The strip's order: waiting on you, then working, then newest; the marked one always shows. */
export function stripRows(rows: readonly SessionBoardRow[], isCurrent: (row: SessionBoardRow) => boolean, limit = STRIP_LIMIT): SessionBoardRow[] {
  const rank = (row: SessionBoardRow) => (row.asks ? 0 : row.working ? 1 : 2);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  const shown = sorted.slice(0, limit);
  const current = sorted.find(isCurrent);
  if (current && !shown.includes(current)) shown[shown.length - 1] = current;
  return shown;
}

function SessionBoardPanel({ instanceId, route, navigate, config, setConfig }: ModuleProps) {
  const board = useSessionBoard();
  const mode = boardMode(config, route);
  // the page's own board on a flight page marks the flight's session
  const flightId = mode === "route" && onSessionsPage(route) ? route.flightId : undefined;
  const flight = useFlightRecord(flightId);
  const requested = mode === "route" ? pageRequestedRef(route, flight.flight?.sessions ?? []) : null;

  const { show, project, machine, harness } = config;
  const filter = useMemo(() => boardFilter({ show: show ?? "", project: project ?? "", machine: machine ?? "", harness: harness ?? "" }), [show, project, machine, harness]);
  const layout = boardLayout(config);
  const members = useMemo(() => board.rows.filter((row) => matchesSessionFilter(row, filter)), [board.rows, filter]);
  // what it lists: a subagent beside its parent folds into the parent's row
  const listed = useMemo(() => {
    const { rows } = foldSubagentRows(members);
    return layout === "list" ? sessionProjectGroups(rows).flatMap((group) => group.sessions) : rows;
  }, [members, layout]);

  // before anyone picks, the first row it shows, held while that row stays
  const auto = useRef<string | null>(null);
  auto.current = stickyFirst(auto.current, listed.map((row) => row.key));
  const autoRow = listed.find((row) => row.key === auto.current) ?? null;

  const own = decodeSessionPin(config[SESSION_KEY]);
  const current = boardCurrent({ mode, route, page: pageSelection(route, requested), own, auto: autoRow?.selection ?? null });
  const currentPin = encodeSessionPin(current);

  // what it marks is what a Session thread beside it that shows picks shows
  useEffect(() => {
    sessionPicks.publish(instanceId, currentPin);
  }, [instanceId, currentPin]);
  useEffect(() => () => sessionPicks.withdraw(instanceId), [instanceId]);
  const followed = useSyncExternalStore(sessionPicks.subscribe, sessionPicks.followed, sessionPicks.followed);

  const open = (row: SessionBoardRow) => {
    const to = boardOpen({ route, mode, selection: row.selection, followed, localNodeId: board.localNodeId });
    if ("navigate" in to) {
      navigate(to.navigate, { replace: to.replace });
      return;
    }
    setConfig({ [SESSION_KEY]: to.pick });
    sessionPicks.publish(instanceId, to.pick, true);
  };

  const openFull = boardOpenFull(mode, route, current, board.localNodeId);
  // Folded to a side, the panel shows its sessions as harness marks, a label on hover.
  const strip = useHarnessStrip();
  const isCurrent = (row: SessionBoardRow) => rowMatchesSelection(row, current);
  const stripCells = (
    <ModuleStrip>
      {stripRows(listed, isCurrent).map((row) => strip.cell({
        id: row.key,
        title: row.title,
        harness: row.harness,
        // a project can arrive as its folder's path; the label names the folder
        project: row.project?.split("/").filter(Boolean).pop() ?? null,
        state: row.asks ? "waiting" : row.working ? "working" : null,
        current: isCurrent(row),
      }, () => open(row)))}
      {strip.label}
    </ModuleStrip>
  );
  const head = (
    <ModuleHead>
      {listed.length > 0 && (
        <span className="hud-grid-count" title={`${listed.length} sessions`}>{listed.length}</span>
      )}
      {openFull && (
        <button type="button" className="vw-chip" onClick={() => navigate(openFull)} title="Open Sessions on its own page">
          Open full
        </button>
      )}
      <button type="button" className="vw-chip" disabled={board.reading} onClick={() => void board.refresh()} title="Read every session source again">
        <RefreshCw size={10} /> {board.reading ? "Reading…" : "Refresh"}
      </button>
    </ModuleHead>
  );

  const notice = board.error || board.requests.error;
  if (board.loading && board.rows.length === 0) {
    return <>{head}{stripCells}<Quiet>Reading sessions…</Quiet></>;
  }
  return (
    <div className="vw-session-board">
      {head}
      {stripCells}
      {notice && <p className="vw-session-notice" role="status">{notice}</p>}
      <div className={`s-session-board s-session-board--${layout === "cards" ? "cards" : "list"}`}>
        <SessionBoardMembers
          rows={members}
          lanes={layout === "lanes"}
          grouped={layout === "list"}
          now={board.now}
          isCurrent={(row) => rowMatchesSelection(row, current)}
          onSelect={open}
          empty={board.rows.length === 0
            ? "No sessions yet. They show here as harnesses start them."
            : "No sessions in this panel's scope. Change it from Scope."}
        />
      </div>
    </div>
  );
}

/** Follows: on a Sessions page, mark the page's session and write picks to it; unset, keep its own pick. */
const followScope: ModuleScope = {
  key: BOARD_FOLLOW_KEY,
  allLabel: "Its own pick",
  followsPage: "This page's session",
  useOptions: () => NO_OPTIONS,
};

const showScope: ModuleScope = {
  key: "show",
  allLabel: "All sessions",
  useOptions: () => SHOW_OPTIONS,
};

const projectScope: ModuleScope = {
  key: "project",
  allLabel: "All projects",
  useOptions: () => {
    const rows = useSessionBoardRows();
    return useMemo(() => projectOptions(rows), [rows]);
  },
};

const machineScope: ModuleScope = {
  key: "machine",
  allLabel: "All machines",
  useOptions: () => {
    const rows = useSessionBoardRows();
    return useMemo(() => machineOptions(rows), [rows]);
  },
};

const harnessScope: ModuleScope = {
  key: "harness",
  allLabel: "All harnesses",
  useOptions: () => {
    const rows = useSessionBoardRows();
    return useMemo(() => harnessOptions(rows), [rows]);
  },
};

const layoutScope: ModuleScope = {
  key: "layout",
  allLabel: "List",
  useOptions: () => BOARD_LAYOUT_OPTIONS,
};

export const sessionBoardModule = defineModule({
  type: "session-board",
  title: "Sessions",
  blurb: "Every session Scout can see, live ones marked; pick one to read it beside",
  docs: {
    shows: "A row per session: harness, title, Working or Request, project and who started it; Cards add machine and model, Lanes the Agent Lanes card. Count, Refresh, Open full.",
    data: "One board read for the window: /api/sessions, /api/conversations, /api/tail/discover and /api/tail/recent every 15s while visible, per second of broker events, and live tail events.",
    opens: "On a Sessions page, /sessions/:ref; elsewhere the Session thread beside it, or the session's page when none shows picks.",
  },
  size: { w: 4, h: 16 },
  // the head and three rows still fit
  minSize: { w: 3, h: 6 },
  scopes: [followScope, showScope, projectScope, machineScope, harnessScope, layoutScope],
  // off a Sessions page, the session it last picked: kept so a reload marks it again
  state: [SESSION_KEY],
  Component: SessionBoardPanel,
});
