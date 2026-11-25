import type { FlightSessionTrace, Route } from "../../../lib/types.ts";
import { resolveFlightSessionId } from "../../sessions/flight-observe.ts";
import type { SessionBoardRow } from "../../sessions/session-board-model.ts";
import type { SessionDensity, SessionFilter, SessionSelection } from "../../sessions/slot-deck.ts";
import type { ModuleConfig, ModuleScopeOption } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { optionsFrom, pathLabels } from "./labels.ts";

/*
 * The Sessions view's rules, without React: which session a Session thread
 * shows, which one a Session board marks, where a row goes, how a session is
 * kept as a setting, and what the scopes offer. session-board.tsx and
 * session-thread.tsx read these; sessions-view.test.ts holds them.
 *
 * The slot deck's ideas, as panels (design/studio views/sessions-place.tsx):
 * a slot's primitive is the module (Session board; Session thread), its
 * identity is the scope (a board's filter; a thread that follows the page or
 * the board beside it, or is pinned to one session), and a preset is a saved
 * view.
 */

export type SessionsRoute = Extract<Route, { view: "sessions" }>;

/** A board's own pick (state), and a thread's session (its scope). */
export const SESSION_KEY = "session";
/** Set to "@route" by the shipped view: the board's rows write the page's session. */
export const BOARD_FOLLOW_KEY = "follow";

/** Drawn on /sessions, /sessions/:ref or /flights/:id/observe, where the URL is the selection. */
export function onSessionsPage(route: Route): route is SessionsRoute {
  return route.view === "sessions";
}

// ── A session, kept as a setting ─────────────────────────────────────────

/**
 * One session as a scope value: its ref, the machine it runs on when the
 * selection names one (`session:codex:abc?machineId=mini`), and the host
 * page label when the session stays on that host (`session:codex:abc?host=mini`).
 * "" = none. This string is a panel setting, not the page URL.
 */
export function encodeSessionPin(selection: SessionSelection | null | undefined): string {
  if (!selection?.sessionRef) return "";
  const params = new URLSearchParams();
  if (selection.machineId) params.set("machineId", selection.machineId);
  if (selection.hostLabel) params.set("host", selection.hostLabel);
  const query = params.toString();
  return query ? `${selection.sessionRef}?${query}` : selection.sessionRef;
}

/** The session a scope value names, or null ("" or "@route" name none). */
export function decodeSessionPin(value: string | null | undefined): SessionSelection | null {
  const text = value?.trim();
  if (!text || text === FOLLOW_PAGE) return null;
  const at = text.indexOf("?");
  if (at < 0) return { sessionRef: text };
  const sessionRef = text.slice(0, at);
  if (!sessionRef) return null;
  const params = new URLSearchParams(text.slice(at + 1));
  const machineId = params.get("machineId")?.trim() || undefined;
  const hostLabel = params.get("host")?.trim() || undefined;
  return {
    sessionRef,
    ...(machineId ? { machineId } : {}),
    ...(hostLabel ? { hostLabel } : {}),
  };
}

export function sameSession(a: SessionSelection | null | undefined, b: SessionSelection | null | undefined): boolean {
  return encodeSessionPin(a) === encodeSessionPin(b);
}

// ── The page ─────────────────────────────────────────────────────────────

/**
 * The session the page names: /sessions/:ref, or on a flight page ?session=
 * when the flight has it, else the flight's latest session (a ?session= the
 * flight no longer lists is kept, so an aged-out link still opens). null on
 * bare /sessions and anywhere else.
 */
export function pageRequestedRef(route: Route, trace: readonly FlightSessionTrace[] = []): string | null {
  if (!onSessionsPage(route)) return null;
  if (route.flightId) return resolveFlightSessionId([...trace], route.sessionId);
  return route.sessionId?.trim() || null;
}

/** The page's session as a selection. A host path names that host. Else ?machineId=, as the slot screen opened it. */
export function pageSelection(route: Route, requested: string | null): SessionSelection | null {
  if (!onSessionsPage(route) || !requested) return null;
  const hostLabel = route.hostLabel?.trim();
  if (hostLabel) return { sessionRef: requested, hostLabel };
  return { sessionRef: requested, ...(route.machineId ? { machineId: route.machineId } : {}) };
}

/** The flight page's ?compare= session, on the page's host or machine. */
export function pageCompare(route: Route): SessionSelection | null {
  if (!onSessionsPage(route) || !route.compareSessionId) return null;
  const hostLabel = route.hostLabel?.trim();
  if (hostLabel) return { sessionRef: route.compareSessionId, hostLabel };
  return { sessionRef: route.compareSessionId, ...(route.machineId ? { machineId: route.machineId } : {}) };
}

/**
 * A session's own page. A host label is /sessions/hosts/<label>/<ref>.
 * Otherwise the machine rides along as ?machineId= when the session runs on
 * another machine, or when the page already names it. A session on this
 * machine clears a carried scope, which would otherwise narrow every page
 * after it. `machineId` is always set, so the router clears rather than
 * carries.
 */
export function sessionPageRoute(route: Route, selection: SessionSelection, localNodeId: string | null): SessionsRoute {
  const hostLabel = selection.hostLabel?.trim();
  if (hostLabel) return { view: "sessions", sessionId: selection.sessionRef, hostLabel, machineId: undefined };
  const current = "machineId" in route && route.machineId ? route.machineId : undefined;
  const wanted = selection.machineId;
  const machineId = !wanted ? undefined
    : wanted === current ? wanted
    : localNodeId && wanted === localNodeId ? undefined
    : wanted;
  return { view: "sessions", sessionId: selection.sessionRef, machineId };
}

// ── Session board ────────────────────────────────────────────────────────

/**
 * "route": the Sessions view's own board on a Sessions page; its rows write
 * the page's session. "own": anywhere else, or a board added without it; it
 * keeps its pick in settings and never moves the page.
 */
export type BoardMode = "route" | "own";

export function boardMode(config: ModuleConfig, route: Route): BoardMode {
  return onSessionsPage(route) && config[BOARD_FOLLOW_KEY] === FOLLOW_PAGE ? "route" : "own";
}

const SHOWS = ["working", "asks", "from_agents", "working_asks"] as const;

/** The filter a board's scopes make. Unset is every session. */
export function boardFilter(config: ModuleConfig): SessionFilter {
  const show = SHOWS.find((value) => value === config.show) ?? "all";
  return {
    scope: show,
    ...(config.project ? { project: config.project } : {}),
    ...(config.machine ? { machine: config.machine } : {}),
    ...(config.harness ? { harness: config.harness } : {}),
  };
}

export type BoardLayout = "list" | "cards" | "lanes";

export function boardLayout(config: ModuleConfig): BoardLayout {
  return config.layout === "cards" || config.layout === "lanes" ? config.layout : "list";
}

/**
 * The row a board marks before anyone picks: the one it marked last while
 * that row is still shown, else the first. Held so the thread beside it does
 * not jump as sessions start and stop.
 */
export function stickyFirst(previous: string | null, keys: readonly string[]): string | null {
  if (previous && keys.includes(previous)) return previous;
  return keys[0] ?? null;
}

/**
 * The session a board marks. On its own page: the page's session, or with
 * none (bare /sessions) the first row it shows, as the slot screen selected
 * it. A flight page's board marks only the flight's session. Off the page:
 * its own pick, or the first row.
 */
export function boardCurrent(input: {
  mode: BoardMode;
  route: Route;
  page: SessionSelection | null;
  own: SessionSelection | null;
  auto: SessionSelection | null;
}): SessionSelection | null {
  if (input.mode === "route") {
    return onSessionsPage(input.route) && input.route.flightId ? input.page : input.page ?? input.auto;
  }
  return input.own ?? input.auto;
}

/**
 * Where a board row goes. The Sessions view's own board writes the page's
 * session: in place on /sessions and /sessions/:ref (Back leaves Sessions, as
 * the slot screen's picks did), and as a new entry from a flight page (Back
 * returns to the flight). Any other board keeps the pick for the Session
 * thread beside it; with none on the view, the row opens the session's page.
 */
export function boardOpen(input: {
  route: Route;
  mode: BoardMode;
  selection: SessionSelection;
  followed: boolean;
  localNodeId: string | null;
}): { navigate: Route; replace: boolean } | { pick: string } {
  const { route, mode, selection, followed, localNodeId } = input;
  const inPlace = onSessionsPage(route) && !route.flightId;
  if (mode === "route") return { navigate: sessionPageRoute(route, selection, localNodeId), replace: inPlace };
  if (followed) return { pick: encodeSessionPin(selection) };
  return { navigate: sessionPageRoute(route, selection, localNodeId), replace: inPlace };
}

/** A board's Open full: its marked session's page, or /sessions. None for the page's own board. */
export function boardOpenFull(mode: BoardMode, route: Route, current: SessionSelection | null, localNodeId: string | null): Route | null {
  if (mode === "route") return null;
  return current ? sessionPageRoute(route, current, localNodeId) : { view: "sessions" };
}

// ── Session thread ───────────────────────────────────────────────────────

/**
 * Where a Session thread's session comes from:
 *   page:   it follows the page on a Sessions page that names a session
 *           (/sessions/:ref, or any flight page: a flight's session comes
 *           from the flight, never from a board's pick);
 *   pick:   unset, or following the page anywhere else (bare /sessions
 *           included): the latest pick of a Session board beside it;
 *   pinned: one session, kept with the panel.
 */
export type ThreadSource = "page" | "pick" | "pinned";

export function threadSource(route: Route, value: string | undefined, requested: string | null): ThreadSource {
  if (value === FOLLOW_PAGE && onSessionsPage(route) && (route.flightId || requested)) return "page";
  if (!value || value === FOLLOW_PAGE) return "pick";
  return "pinned";
}

export type PanelSession = { selection: SessionSelection | null; source: ThreadSource };

/** A thread's session, from its scope value, the page's session and the latest board pick. */
export function panelSession(route: Route, value: string | undefined, requested: string | null, picked: string | null): PanelSession {
  const source = threadSource(route, value, requested);
  if (source === "page") return { selection: pageSelection(route, requested), source };
  if (source === "pick") return { selection: decodeSessionPin(picked), source };
  return { selection: decodeSessionPin(value), source };
}

/** Desk (the default) keeps the delivery log and context beside the thread when the panel is wide. */
export function threadDensity(config: ModuleConfig): SessionDensity {
  return config.layout === "reading" || config.layout === "sheet" ? config.layout : "desk";
}

/** Open full is offered unless the panel already is the page's thread. */
export function threadOffersOpenFull(route: Route, shown: PanelSession): boolean {
  if (!shown.selection) return false;
  if (!onSessionsPage(route)) return true;
  if (shown.source !== "pinned") return false;
  return !(route.sessionId && !route.flightId && sameSession(pageSelection(route, route.sessionId), shown.selection));
}

/** Pin is offered on a following thread that shows a session: it holds that one as the page moves on. */
export function threadOffersPin(shown: PanelSession): boolean {
  return shown.source !== "pinned" && Boolean(shown.selection);
}

/** What a thread with nothing to show says. "" = nothing (a flight page's bar already says why). */
export function threadEmptyLine(source: ThreadSource): string {
  switch (source) {
    case "page":
      return "";
    case "pick":
      return "Pick a session in a Session board beside this panel, or pin one from Scope.";
    case "pinned":
      return "Pick a session from Scope.";
  }
}

// ── Scope choices ────────────────────────────────────────────────────────

export const SHOW_OPTIONS: readonly ModuleScopeOption[] = [
  { value: "working", label: "Working" },
  { value: "asks", label: "Waiting on you" },
  { value: "from_agents", label: "From agents" },
  { value: "working_asks", label: "Working or waiting" },
];

export const BOARD_LAYOUT_OPTIONS: readonly ModuleScopeOption[] = [
  { value: "cards", label: "Cards" },
  { value: "lanes", label: "Lanes" },
];

export const THREAD_LAYOUT_OPTIONS: readonly ModuleScopeOption[] = [
  { value: "reading", label: "Reading" },
  { value: "sheet", label: "Sheet" },
];

type OptionRow = Pick<SessionBoardRow, "project" | "machine" | "machineName" | "harness">;

/** Every project on the board, by a name that tells two worktrees apart. */
export function projectOptions(rows: readonly OptionRow[]): ModuleScopeOption[] {
  const roots = optionsFrom(rows, (row) => row.project).map((option) => option.value);
  const labels = pathLabels(roots);
  return roots.map((root) => ({ value: root, label: labels.get(root) ?? root }));
}

/** Every machine on the board, by name; a row with no machine is "This machine". */
export function machineOptions(rows: readonly OptionRow[]): ModuleScopeOption[] {
  const names = new Map<string, string>();
  for (const row of rows) {
    const id = row.machine ?? "local";
    if (!names.has(id) || (row.machineName && names.get(id) === id)) names.set(id, row.machineName ?? row.machine ?? "This machine");
  }
  return [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function harnessOptions(rows: readonly OptionRow[]): ModuleScopeOption[] {
  return optionsFrom(rows, (row) => row.harness);
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The Session scope's choices: the board's sessions, most recently active first. */
export function sessionOptions(
  rows: readonly Pick<SessionBoardRow, "selection" | "title" | "harness" | "machine" | "machineName" | "lastActiveAt">[],
  limit = 40,
): ModuleScopeOption[] {
  const out: ModuleScopeOption[] = [];
  const seen = new Set<string>();
  const byRecent = [...rows].sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  for (const row of byRecent) {
    const value = encodeSessionPin(row.selection);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const where = row.machineName ?? (row.machine ? null : "This machine");
    out.push({ value, label: [clip(row.title, 48), row.harness, where].filter(Boolean).join(" · ") });
    if (out.length >= limit) break;
  }
  return out;
}
