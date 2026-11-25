import type { Route } from "../../../lib/types.ts";
import { briefingRoute, type BriefingSummary } from "../../briefings/briefings-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * The Briefings view's rules, without React: which briefing a Briefing panel
 * shows, where a row in a Briefings panel goes, and what the scope offers.
 * briefings.tsx and briefing.tsx read these; briefings-view.test.ts holds them.
 */

/** Drawn on /briefings or /briefings/:id, where the URL is the selection. */
export function isBriefingsRoute(route: Route): boolean {
  return route.view === "briefings";
}

/** The briefing the page is on: /briefings/:id. "" on the archive and anywhere else. */
export function pageBriefingId(route: Route): string {
  return route.view === "briefings" ? route.briefingId ?? "" : "";
}

/**
 * Where a Briefing panel's briefing comes from:
 *   page:   it follows the page on /briefings, so the URL's /briefings/:id;
 *   pick:   it follows the page anywhere else, so the latest pick of a
 *           Briefings panel beside it (there is no page briefing there);
 *   latest: no choice made, so the newest briefing in the archive;
 *   pinned: one briefing, kept with the panel.
 */
export type BriefingSource = "page" | "pick" | "latest" | "pinned";

export type PanelBriefing = {
  /** "" = nothing to show yet: the panel says how to pick one. */
  id: string;
  source: BriefingSource;
  /** Follows the page on its own route: Close returns the page to the archive. */
  own: boolean;
};

/** A panel's briefing, from its scope value, the page, the picks beside it and the archive. */
export function panelBriefing(route: Route, value: string | undefined, picked: string | null, latest: string | null): PanelBriefing {
  if (value === FOLLOW_PAGE) {
    return isBriefingsRoute(route)
      ? { id: pageBriefingId(route), source: "page", own: true }
      : { id: picked ?? "", source: "pick", own: false };
  }
  if (!value) return { id: latest ?? "", source: "latest", own: false };
  return { id: value, source: "pinned", own: false };
}

/** Open full is offered unless the panel already is the page's briefing. */
export function offersOpenFull(route: Route, shown: PanelBriefing): boolean {
  return Boolean(shown.id) && !(isBriefingsRoute(route) && pageBriefingId(route) === shown.id);
}

/**
 * Where a row in a Briefings panel goes. On /briefings the URL is the
 * selection: the row opens /briefings/:id and Back returns. Anywhere else the
 * panel keeps its own pick, shown by the Briefing panel beside it that
 * follows picks; with none on the view the row opens the briefing's page.
 */
export function listOpen(route: Route, id: string, followed: boolean): { navigate: Route } | { pick: string } {
  if (isBriefingsRoute(route) || !followed) return { navigate: briefingRoute(id) };
  return { pick: id };
}

/** The row a Briefings panel marks: the page's briefing on /briefings, its own pick elsewhere. */
export function listCurrent(route: Route, pick: string | undefined): string {
  return isBriefingsRoute(route) ? pageBriefingId(route) : pick ?? "";
}

/** Where a list's Open full goes: its pick's page, or the archive. */
export function listOpenFull(pick: string | undefined): Route {
  return briefingRoute(pick || undefined);
}

const optionDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The Briefing scope's choices: the archive, newest first, by title and when (titles repeat). */
export function briefingOptions(items: readonly BriefingSummary[] | null, limit = 50): { value: string; label: string }[] {
  return (items ?? []).slice(0, limit).map((item) => ({
    value: item.id,
    label: `${item.title || item.id} · ${optionDate(item.preparedAt)}`,
  }));
}

/** What a Briefing panel with nothing to show says. */
export function briefingEmptyLine(source: BriefingSource): string {
  switch (source) {
    case "page":
      return "Pick a briefing in Briefings and it opens here.";
    case "pick":
      return "Pick a briefing in Briefings beside this panel, or pin one from Scope.";
    case "latest":
      return "No briefings yet. Scoutbot files one here each time it prepares a fleet brief, on Home or in a tour.";
    case "pinned":
      return "Pick a briefing from Scope.";
  }
}
