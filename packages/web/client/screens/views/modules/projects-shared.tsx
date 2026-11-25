import { useEffect, useMemo, type MouseEvent } from "react";
import { routePath } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { setProjectScope } from "../../../scout/project-scope.ts";
import { useProjectsInbox } from "../../projects/useProjectsInbox.ts";
import type { ModuleScope } from "./contract.ts";
import { scopeValue } from "./panel-scope.ts";
import { canonicalSlug, inboxRoute, pageProjectSlug, pageRoute, syntheticSessionRedirect } from "./projects-model.ts";
import "./projects.css";

/*
 * What the Projects view's modules share: the one Projects loop, the page
 * they follow, and the Project scope. No module here polls on its own; every
 * panel reads useProjectsInbox, which is one ref-counted loop for the page.
 */

/** ⌘, Ctrl or Shift held, or not the main button: the click asks for a new tab, not the preview. */
export function isModifiedClick(event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "button">): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
}

/** A page of Scout in a new tab, as ⌘-click on a link would open it. */
export function openRouteInNewTab(route: Route): void {
  window.open(routePath(route), "_blank", "noopener");
}

/** The shared Projects loop for this page, and the page route panels build links on. */
export function useProjectsPage(route: Route) {
  const inbox = useProjectsInbox(inboxRoute(route));
  const aliases = inbox.model.projectAliases;
  const projects = inbox.model.projects;
  // canonical slug only changes when the projects or their aliases do
  const page = useMemo(() => pageRoute(route, inbox.model), [route, aliases, projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasData = projects.length > 0 || inbox.model.threads.length > 0 || inbox.model.sessions.length > 0;
  // The area's tabs carry the project this page shows (Changes opens its repo, Files its code).
  const slug = canonicalSlug(inbox.model, pageProjectSlug(route));
  const root = slug ? projects.find((entry) => entry.slug === slug)?.root ?? null : null;
  useEffect(() => {
    if (slug) setProjectScope({ slug, root });
  }, [slug, root]);
  return { ...inbox, page, hasData };
}

/** The project a panel shows, canonical: its own choice, or the page's when it follows the page. */
export function usePanelProject(route: Route, value: string | undefined, model: ReturnType<typeof useProjectsInbox>["model"]) {
  const slug = canonicalSlug(model, scopeValue(value, pageProjectSlug(route)));
  const project = slug ? model.projects.find((entry) => entry.slug === slug) ?? null : null;
  return { slug, project };
}

/**
 * The page's redirect for a native:process: session ref (it has no session to
 * show): to the project's Sessions, replacing the entry so Back does not
 * bounce. Both Sessions and Session call it; the first one to run wins.
 */
let redirecting: string | null = null;
export function useSyntheticSessionRedirect(route: Route) {
  const { navigate } = useScout();
  useEffect(() => {
    const to = syntheticSessionRedirect(route);
    if (!to || route.view !== "agents-v2" || redirecting === route.sessionId) return;
    redirecting = route.sessionId ?? null;
    queueMicrotask(() => {
      redirecting = null;
    });
    navigate(to, { replace: true });
  }, [navigate, route]);
}

/** The picker's options: every project the loop knows, by name. */
function useProjectOptions() {
  const { route } = useScout();
  const { model } = useProjectsInbox(inboxRoute(route));
  return useMemo(
    () => [...model.projects].sort((a, b) => a.title.localeCompare(b.title)).map((p) => ({ value: p.slug, label: `/${p.title}` })),
    [model.projects],
  );
}

/** Project, by slug: "This page's project" follows /projects/:slug. */
export const projectScope: ModuleScope = {
  key: "project",
  allLabel: "All projects",
  followsPage: "This page's project",
  useOptions: useProjectOptions,
};
