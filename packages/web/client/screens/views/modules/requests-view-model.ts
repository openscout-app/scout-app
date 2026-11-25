import { fullTimestamp, timeAgo } from "../../../lib/time.ts";
import type { OperatorAttentionItem, Route } from "../../../lib/types.ts";
import { requestKind } from "../../requests/requests-model.ts";
import type { ModuleConfig, ModuleScopeOption } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * The Requests view's rules, without React: where a Requests panel keeps its
 * selection, which request a Request panel shows, and the routes they move
 * to. requests.tsx and request.tsx read these; requests-view.test.ts holds
 * them.
 *
 * On /requests the list the view ships with follows the page
 * (`follow: "@route"`): the URL's ?request= is its selection, written with
 * replace, and the Request panel beside it (`request: "@route"`) draws that
 * request with its decisions. With no ?request= the page shows its first
 * open request, so the operator lands on something to answer. Anywhere else a
 * Requests panel keeps its own pick in its settings (`request`, state) and
 * hands it to a Request panel on the same view that follows picks
 * (request-picks.ts); with none there, or with the list lifted into full
 * view, the pick opens under its row. It never moves another view; only Open
 * full goes to /requests.
 */

/** A Requests panel follows the Requests page when set to FOLLOW_PAGE. */
export const REQUESTS_FOLLOW_KEY = "follow";
/** The request a Requests panel last picked: live state, so a reload selects it again. */
export const REQUESTS_PICK_KEY = "request";
/** One request kind ("Approval", "Permission request", "Ask"); "" = every kind. */
export const REQUESTS_KIND_KEY = "kind";
/** A Request panel's request: FOLLOW_PAGE, "" (the first open one), or one request's id. */
export const REQUEST_SCOPE_KEY = "request";

/**
 * The Requests route with its selection. Typed here with `requestId` so this
 * reads the same before and after the router carries ?request= (lib/types.ts).
 */
type RequestsRoute = Extract<Route, { view: "requests" }> & { requestId?: string };

/** The page is the Requests page. */
export function onRequestsPage(route: Route): boolean {
  return route.view === "requests";
}

/** The request the Requests page names (?request=), "" = none. */
export function pageRequestId(route: Route): string {
  if (route.view !== "requests") return "";
  return (route as RequestsRoute).requestId?.trim() ?? "";
}

/** /requests with this request open ("" or null = none: the first open one shows). */
export function requestsRoute(requestId?: string | null): Route {
  const next: RequestsRoute = { view: "requests", ...(requestId ? { requestId } : {}) };
  return next;
}

// ── The list ────────────────────────────────────────────────────────────────

export type RequestsPanelMode = "route" | "own";

/** "route": the URL holds this panel's selection. "own": its settings do. */
export function requestsPanelMode(config: ModuleConfig, route: Route): RequestsPanelMode {
  return onRequestsPage(route) && config[REQUESTS_FOLLOW_KEY] === FOLLOW_PAGE ? "route" : "own";
}

/** The request a list has picked: the page's on its own route, else its own. "" = none. */
export function listSelection(config: ModuleConfig, route: Route): string {
  return requestsPanelMode(config, route) === "route" ? pageRequestId(route) : config[REQUESTS_PICK_KEY]?.trim() ?? "";
}

/**
 * The row a list marks: its pick; with none, the first row when a Request
 * panel beside it follows picks (that panel shows the first open request, so
 * the list says which one it is).
 */
export function listMarked(selection: string, followed: boolean, rows: readonly Pick<OperatorAttentionItem, "id">[]): string {
  if (selection) return selection;
  return followed ? rows[0]?.id ?? "" : "";
}

/**
 * Where a pick opens. "inline": under its row, when no Request panel on the
 * view follows picks, or the list is lifted into full view (which hides that
 * panel). "beside": in that panel.
 */
export function pickOpens(where: { followed: boolean; full: boolean }): "inline" | "beside" {
  return where.followed && !where.full ? "beside" : "inline";
}

/**
 * What a click on a row does.
 *   url:  the page's selection to write (replace), or null to leave the URL.
 *         On /requests a list that follows the page writes it, so the Request
 *         panel that follows the page shows the pick; a list with its own
 *         pick, or any list elsewhere, never moves the page.
 *   pick: the panel's own pick to keep in its settings ("" clears it), or
 *         null when the URL is its selection.
 * A click on the row already open under itself closes it; beside a Request
 * panel a click always selects (there is nothing to close).
 */
export function listClick(
  route: Route,
  mode: RequestsPanelMode,
  id: string,
  selection: string,
  opens: "inline" | "beside",
): { url: Route | null; pick: string | null } {
  const next = opens === "inline" && selection === id ? "" : id;
  // a list with its own pick never moves the page's, even on /requests
  const url = mode !== "own" && onRequestsPage(route) ? requestsRoute(next) : null;
  return { url, pick: mode === "own" ? next : null };
}

/** Open full is for a panel that is not the page: /requests with its pick open. */
export function offersOpenFull(route: Route): boolean {
  return !onRequestsPage(route);
}

/** The kinds a Requests panel can narrow to, in the page's words. */
export const REQUEST_KIND_OPTIONS: readonly ModuleScopeOption[] = [
  { value: "Approval", label: "Approvals" },
  { value: "Permission request", label: "Permission requests" },
  { value: "Ask", label: "Asks" },
];

/** The page's note on what a request's time means. */
export const REQUEST_UPDATE_NOTE = "The source supplies update times, not when waiting began. Request history is not available.";

/** A row's age, and its tooltip: the source's last update, never when waiting began. */
export function rowAge(updatedAt: number, now: number): { label: string; title: string } {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return { label: "", title: "The source supplied no update time." };
  return { label: timeAgo(updatedAt, now), title: `Updated ${fullTimestamp(updatedAt)}. ${REQUEST_UPDATE_NOTE}` };
}

/** The rows of one kind ("" = every row). */
export function rowsOfKind<T extends OperatorAttentionItem>(rows: readonly T[], kind: string | undefined): readonly T[] {
  return kind ? rows.filter((item) => requestKind(item) === kind) : rows;
}

// ── The Request panel ───────────────────────────────────────────────────────

/**
 * Where a Request panel's request comes from:
 *   page:   it follows the page on /requests, so the URL's ?request=;
 *   pick:   it follows the page anywhere else, so the latest pick of a
 *           Requests panel beside it;
 *   first:  nothing named (no ?request=, no pick, or no choice made), so the
 *           first open request in the list;
 *   pinned: one request, kept with the panel.
 */
export type RequestSource = "page" | "pick" | "first" | "pinned";

export type PanelRequest = {
  /** "" = nothing to show: no open requests (or a pinned one is not chosen). */
  id: string;
  source: RequestSource;
  /** Follows the page on its own route and the URL names it: Clear returns the page to its first request. */
  own: boolean;
};

/** A Request panel's request, from its scope value, the page, the picks beside it and the rows. */
export function panelRequest(
  route: Route,
  value: string | undefined,
  picked: string | null,
  rows: readonly Pick<OperatorAttentionItem, "id">[],
): PanelRequest {
  const first = rows[0]?.id ?? "";
  if (value === FOLLOW_PAGE) {
    if (onRequestsPage(route)) {
      const named = pageRequestId(route);
      return named ? { id: named, source: "page", own: true } : { id: first, source: "first", own: false };
    }
    return picked ? { id: picked, source: "pick", own: false } : { id: first, source: "first", own: false };
  }
  if (!value) return { id: first, source: "first", own: false };
  return { id: value, source: "pinned", own: false };
}

/** Open full is offered unless the panel already is the page's request. */
export function requestOffersOpenFull(route: Route, shown: PanelRequest): boolean {
  return Boolean(shown.id) && !(onRequestsPage(route) && (shown.source === "page" || shown.source === "first"));
}

/** The Request scope's choices: every open request, by title and who asked. */
export function requestOptions(rows: readonly OperatorAttentionItem[]): ModuleScopeOption[] {
  return rows.map((item) => ({
    value: item.id,
    label: `${item.title} · ${item.agentName ?? item.agentId ?? "agent not supplied"}`,
  }));
}

/**
 * What a Request panel with nothing to show, or a request no longer open, says.
 * An empty queue gets no line here: the list beside it already says so once.
 */
export function requestEmptyLine(source: RequestSource, missing: boolean): string | null {
  if (missing) {
    return source === "pinned"
      ? "This item isn't open any more. Unpin to show the first Inbox item."
      : "This item isn't open any more. It was answered or withdrawn at its source.";
  }
  return null;
}
