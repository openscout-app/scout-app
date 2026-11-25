import type { Route, TailDiscoverySnapshot } from "../../../lib/types.ts";
import type { ModuleConfig, ModuleScopeOption } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * Where a Tail or Alerts panel takes its filter from. Pure, so the rules test
 * without a DOM (tail-panel-model.test.ts).
 *
 * On its own Ops page (Tail on /ops/tail, Alerts on /ops/issues) the panel the
 * view ships with follows the page (`q: "@route"`): the URL's ?q= and, on
 * Tail, the follow ids (?flightId ?invocationId ?conversationId ?workId
 * ?sessionId ?targetAgentId) resolved to a harness session, exactly as
 * OpsScreen does. It keeps the page's chrome and keys. Anywhere else (Watch,
 * Comms, /views/:id, or a panel added beside it) it keeps its own filter in
 * `config.q`, binds keys only inside its panel, and never moves the page.
 */

/** Tail is mode "tail"; Alerts is TailView's "issues" variant on mode "issues". */
export type TailPanelKind = "tail" | "issues";

/** The setting that holds a panel's filter: the Tail URL's own name. */
export const TAIL_FILTER_KEY = "q";

/** Is this the panel's own Ops page? Bare /ops is Control (mode "mission"). */
export function onTailPage(route: Route, kind: TailPanelKind): boolean {
  return route.view === "ops" && (route.mode ?? "mission") === kind;
}

export type TailPanelPlan =
  /** The page's panel: the URL's filter (and follow ids on Tail), page keys. */
  | { follows: "page" }
  /** An own filter ("" = every session), keys only while focus is in the panel. */
  | { follows: "own"; q: string };

export function tailPanelPlan(route: Route, kind: TailPanelKind, config: ModuleConfig): TailPanelPlan {
  const q = config[TAIL_FILTER_KEY] ?? "";
  if (q === FOLLOW_PAGE && onTailPage(route, kind)) return { follows: "page" };
  // "This page's filter" off the page: the page has none to give
  return { follows: "own", q: q === FOLLOW_PAGE ? "" : q.trim() };
}

/** Where "Open full" goes from a panel with its own filter. */
export function tailFullRoute(kind: TailPanelKind, q: string): Route {
  // the Alerts URL has no ?q=, so its filter stays with the panel
  return kind === "tail" && q ? { view: "ops", mode: "tail", tailQuery: q } : { view: "ops", mode: kind };
}

/**
 * The filter picker's choices, from what the tail is watching: each
 * transcript's project, then each harness. TailView matches a filter as a
 * substring of the event's project, cwd, session and harness, so these
 * values narrow the stream the way a typed filter does.
 */
export function tailScopeOptions(discovery: TailDiscoverySnapshot | null): ModuleScopeOption[] {
  if (!discovery) return [];
  const projects = new Set<string>();
  for (const t of discovery.transcripts ?? []) if (t.project?.trim()) projects.add(t.project.trim());
  const harnesses = new Set<string>();
  for (const t of discovery.transcripts ?? []) if (t.source?.trim()) harnesses.add(t.source.trim());
  for (const p of discovery.processes ?? []) if (p.source?.trim()) harnesses.add(p.source.trim());
  const byName = (a: string, b: string) => a.localeCompare(b);
  const options: ModuleScopeOption[] = [...projects].sort(byName).map((value) => ({ value, label: value }));
  for (const value of [...harnesses].sort(byName)) {
    if (!projects.has(value)) options.push({ value, label: `${value} sessions` });
  }
  return options;
}
