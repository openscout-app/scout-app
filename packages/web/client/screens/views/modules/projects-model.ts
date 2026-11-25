import type { ProjectStateFilter, Route } from "../../../lib/types.ts";
import {
  groupItems,
  isSyntheticProcessSessionRef,
  normalizeProjectRootPath,
  resolveProjectSlug,
  sessionOpenRoute,
  sessionRouteRef,
  sessionSelectRoute,
  sessionsForProject,
  threadOpenRoute,
  threadSelectRoute,
  threadsForProject,
  type InboxSession,
  type InboxThread,
  type ProjectsInboxModel,
} from "../../projects/projects-inbox-model.ts";

/*
 * The Projects view's rules, pure so they test without a DOM. The modules
 * (projects, project, project-sessions, session, worktrees, project-agents,
 * and prs / agents when they follow the page) read the page through these.
 *
 * The view is drawn on the Projects routes themselves, so the URL holds every
 * selection: /projects?view=projects (the list), /projects/:slug and its
 * /sessions[/:ref] and /agents facets, with ?select= ?state= ?harness=
 * ?ephemeral=1 ?machineId=. A panel elsewhere keeps its choices in config.
 */

export type ProjectsPageRoute = Extract<Route, { view: "agents-v2" }>;
export type SessionItem = InboxThread | InboxSession;

/**
 * The Projects view's own routes: the project list and a project page with
 * its facets. Not /agents (the Agents feed) and not an agent profile
 * (/projects/:slug/agents/:id), which stay full-bleed. The same test as
 * nav-destinations' isProjectListRoute and composedViewFor's "projects".
 */
export function isProjectsPage(route: Route): route is ProjectsPageRoute {
  return route.view === "agents-v2" && !route.agentId && (Boolean(route.projectSlug) || route.indexView === "projects");
}

const machineOf = (route: Route): string | undefined => ("machineId" in route && route.machineId ? route.machineId : undefined);

/**
 * What the shared inbox loop reads: the page's machine and ?ephemeral=1, and
 * nothing a panel chooses. Every panel on one page passes the same two values,
 * so the loop's one-entry model cache holds instead of rebuilding per panel.
 */
export function inboxRoute(route: Route): ProjectsPageRoute {
  const machineId = machineOf(route);
  return {
    view: "agents-v2",
    ...(machineId ? { machineId } : {}),
    ...(route.view === "agents-v2" && route.showEphemeral ? { showEphemeral: true } : {}),
  };
}

/** The page's project, for a panel that follows the page ("" when the page has none). */
export function pageProjectSlug(route: Route): string | undefined {
  return route.view === "agents-v2" && !route.agentId ? route.projectSlug : undefined;
}

/**
 * The page's session, for a panel that follows the page. A synthetic
 * native:process: ref is no session: the page goes to Sessions instead
 * (syntheticSessionRedirect).
 */
export function pageSessionRef(route: Route): string | undefined {
  if (route.view !== "agents-v2" || route.agentId || !route.projectSlug) return undefined;
  return route.sessionId && !isSyntheticProcessSessionRef(route.sessionId) ? route.sessionId : undefined;
}

/** A panel's project ref (its own, or the page's) through folded worktree aliases, so an old slug lands on its project. */
export function canonicalSlug(model: ProjectsInboxModel, ref: string | null | undefined): string | null {
  if (!ref) return null;
  return resolveProjectSlug(model, ref) ?? ref;
}

/**
 * The route a panel reads selection from and builds links on. On the
 * Projects routes it is the page, with its slug made canonical; anywhere else
 * a bare Projects route on the page's machine, so a click lands in the view.
 */
export function pageRoute(route: Route, model: ProjectsInboxModel): ProjectsPageRoute {
  if (route.view !== "agents-v2") return inboxRoute(route);
  const slug = canonicalSlug(model, route.projectSlug);
  return slug && slug !== route.projectSlug ? { ...route, projectSlug: slug } : route;
}

/** The redirect the page makes for a native:process: ref: its project's Sessions, nothing selected. */
export function syntheticSessionRedirect(route: Route): ProjectsPageRoute | null {
  if (!isProjectsPage(route) || !route.projectSlug || !isSyntheticProcessSessionRef(route.sessionId)) return null;
  return { ...route, indexView: "sessions", sessionId: undefined, selectedAgentId: undefined };
}

/* ── the project list ── */

export function asStateFilter(value: string | undefined): ProjectStateFilter | undefined {
  return value === "needs" || value === "live" || value === "idle" ? value : undefined;
}

/** The list's lens on its own route: ?state=, replaced as the operator toggles it. */
export function withStateFilter(route: ProjectsPageRoute, filter: ProjectStateFilter | undefined): ProjectsPageRoute {
  const { stateFilter: _drop, ...rest } = route;
  return filter ? { ...rest, stateFilter: filter } : rest;
}

/** The list route, keeping the page's machine and ephemeral flag. */
export function allProjectsRoute(page: ProjectsPageRoute): ProjectsPageRoute {
  return {
    view: "agents-v2",
    indexView: "projects",
    ...(page.machineId ? { machineId: page.machineId } : {}),
    ...(page.showEphemeral ? { showEphemeral: true } : {}),
  };
}

/** Drop the page's selection (a session, or a peeked agent), keeping where it is. */
/** A project's page, keeping the page's machine and ephemeral flag. */
export function projectRoute(page: ProjectsPageRoute, slug: string): ProjectsPageRoute {
  return {
    view: "agents-v2",
    projectSlug: slug,
    ...(page.machineId ? { machineId: page.machineId } : {}),
    ...(page.showEphemeral ? { showEphemeral: true } : {}),
  };
}

/** A project with work in flight or a question waiting, as the all-projects head shows it. */
export type LiveProjectTile = {
  slug: string;
  title: string;
  /** The lead item's branch and line of work: the question when one waits, else the latest live work. */
  branch: string | null;
  work: string;
  /** Harnesses with live work here, lead first. */
  harnesses: string[];
  asking: boolean;
  lastActivityAt: number;
};

/** Projects that are asking or live, asking first, then the most recent. */
export function liveProjectTiles(model: ProjectsInboxModel, limit = 6): LiveProjectTile[] {
  const items: SessionItem[] = [...model.threads, ...model.sessions];
  const tiles: LiveProjectTile[] = [];
  for (const project of model.projects) {
    const asking = project.needs > 0;
    if (!asking && project.working === 0 && project.liveSessionCount === 0) continue;
    const live = items
      .filter((item) => item.projectSlug === project.slug && (item.working || item.needs))
      .sort((a, b) => Number(b.needs) - Number(a.needs) || b.lastActivityAt - a.lastActivityAt);
    const lead = live[0];
    tiles.push({
      slug: project.slug,
      title: project.title,
      branch: lead?.branch ?? null,
      work: lead?.work ?? "",
      harnesses: [...new Set(live.map((item) => item.harness).filter(Boolean))],
      asking,
      lastActivityAt: project.lastActivityAt,
    });
  }
  return tiles
    .sort((a, b) => Number(b.asking) - Number(a.asking) || b.lastActivityAt - a.lastActivityAt)
    .slice(0, limit);
}

export function clearSelectionRoute(page: ProjectsPageRoute): ProjectsPageRoute {
  return {
    view: "agents-v2",
    ...(page.projectSlug ? { projectSlug: page.projectSlug } : {}),
    ...(page.indexView ? { indexView: page.indexView } : {}),
    ...(page.machineId ? { machineId: page.machineId } : {}),
    ...(page.showEphemeral ? { showEphemeral: true } : {}),
  };
}

/* ── sessions ── */

/**
 * A panel's rows: the project's sessions (its agent threads when it has
 * none, as the page did), or every project's sessions when no project is
 * chosen. Narrowed to one harness when one is set.
 */
export function sessionItems(model: ProjectsInboxModel, slug: string | null, harness: string): SessionItem[] {
  let items: SessionItem[];
  if (slug) {
    const sessions = sessionsForProject(model.sessions, slug);
    items = sessions.length > 0 ? sessions : threadsForProject(model.threads, slug);
  } else {
    items = model.sessions.length > 0 ? model.sessions : model.threads;
  }
  const want = harness.trim().toLowerCase();
  return want ? items.filter((item) => item.harness.toLowerCase() === want) : items;
}

/** Rows in Your turn · In flight · Recent, and the same rows flat for the cursor. */
/** Recent rows a Sessions panel shows before the rest fold away. */
export const RECENT_SHOWN = 5;

/**
 * Sessions by whose turn it is. Your turn and In flight always show in full;
 * unless `unfolded`, Recent keeps its first rows and `folded` counts the rest.
 * `total` is each group's size before folding.
 */
export function sessionSections(items: SessionItem[], unfolded = true) {
  let folded = 0;
  const sections = groupItems(items).map((section) => {
    const total = section.items.length;
    if (unfolded || section.group !== "recent" || total <= RECENT_SHOWN) return { ...section, total };
    folded = total - RECENT_SHOWN;
    return { ...section, total, items: section.items.slice(0, RECENT_SHOWN) };
  });
  return { sections, flat: sections.flatMap((section) => section.items), folded };
}

const keepEphemeral = <T extends Route>(dest: T, page: ProjectsPageRoute): T =>
  page.showEphemeral && dest.view === "agents-v2" ? { ...dest, showEphemeral: true } : dest;

/**
 * Click: select the row on its own project's page. The row's project, never
 * the page's absence of one: a select with no project would build
 * /sessions/:ref or the Agents feed and leave the view.
 */
export function itemSelectRoute(item: SessionItem, page: ProjectsPageRoute): ProjectsPageRoute {
  const base: ProjectsPageRoute = { ...page, projectSlug: item.projectSlug };
  return keepEphemeral(item.kind === "session" ? sessionSelectRoute(item, base) : threadSelectRoute(item, base), page);
}

/** Double-click or Enter: a session opens on its project's page; an agent thread opens its conversation, session or profile. */
export function itemOpenRoute(item: SessionItem, page: ProjectsPageRoute): Route {
  const base: ProjectsPageRoute = { ...page, projectSlug: item.projectSlug };
  return keepEphemeral(item.kind === "session" ? sessionOpenRoute(item, base) : threadOpenRoute(item, base), page);
}

/**
 * A row's own page, from the Projects page, where a click already previews it
 * in place: a session's conversation or /sessions/:ref; an agent thread's
 * conversation, session or profile.
 */
export function itemFullRoute(item: SessionItem, page: ProjectsPageRoute): Route {
  if (item.kind !== "session") return itemOpenRoute(item, page);
  const ref = sessionRouteRef(item);
  return ref ? sessionFullRoute(item, ref) : itemOpenRoute(item, page);
}

/* ── the page's preview: one session, PR or worktree at a time ── */

/** What the Projects page previews in its Session panel, from the URL. */
export type PagePreview =
  | { kind: "pr"; number: number; file: string | null }
  | { kind: "worktree"; path: string; file: string | null };

export function pagePreview(route: Route): PagePreview | null {
  if (!isProjectsPage(route) || !route.projectSlug || route.sessionId) return null;
  if (route.pr) return { kind: "pr", number: route.pr, file: route.file ?? null };
  if (route.worktree) return { kind: "worktree", path: route.worktree, file: route.file ?? null };
  return null;
}

/** True when the page shows something in its preview: a session, a peeked agent, a PR or a worktree. */
export function pageHasSelection(route: Route): boolean {
  return route.view === "agents-v2" && Boolean(route.sessionId || route.selectedAgentId || route.pr || route.worktree);
}

/** Preview a PR or a worktree in place: the session or agent selection gives way. */
export function previewRoute(page: ProjectsPageRoute, pick: { pr: number } | { worktree: string }): ProjectsPageRoute {
  const { indexView, ...base } = clearSelectionRoute(page);
  return { ...base, ...(indexView && indexView !== "sessions" ? { indexView } : {}), ...pick };
}

/** A file in the previewed PR or worktree, or none to go back to its list. */
export function previewFileRoute(page: ProjectsPageRoute, file: string | null): ProjectsPageRoute {
  const { file: _drop, ...rest } = page;
  return file && (page.pr || page.worktree) ? { ...rest, file } : rest;
}

/* ── look by: the page's first choice ── */

/**
 * How the Projects page looks at its project: by its sessions (what agents
 * say, beside what their worktree changed), or by its worktrees (pull
 * requests and branches, then one change and its diff). A PR or worktree
 * selection is the worktrees side; ?by=worktrees is that side with nothing
 * picked yet, as ?by=sessions is the sessions side. With neither, the page is
 * the project's Overview, its snapshot. composedViewFor draws one composition
 * per side.
 */
export type LookBy = "sessions" | "worktrees";

export function pageLooksBy(route: Route): LookBy {
  return route.view === "agents-v2" && route.projectSlug && (route.pr || route.worktree || route.by === "worktrees") ? "worktrees" : "sessions";
}

/** The page looking by sessions or by worktrees, with nothing picked. */
export function lookByRoute(page: ProjectsPageRoute, by: LookBy): ProjectsPageRoute {
  const { indexView, ...base } = clearSelectionRoute(page);
  return { ...base, ...(indexView && indexView !== "sessions" ? { indexView } : {}), by };
}

/** A file the selected session's worktree changed, or none to close its diff. */
export function sessionFileRoute(page: ProjectsPageRoute, file: string | null): ProjectsPageRoute {
  const { file: _drop, ...rest } = page;
  return file && page.sessionId ? { ...rest, file } : rest;
}

/** "3 files changed, 80 insertions(+), 32 deletions(-)" as numbers; null when git gave none. */
export function parseShortstat(stat: string | null | undefined): { files: number; add: number; del: number } | null {
  if (!stat) return null;
  const n = (re: RegExp) => Number(re.exec(stat)?.[1] ?? 0);
  const files = n(/(\d+) files? changed/);
  const add = n(/(\d+) insertions?\(\+\)/);
  const del = n(/(\d+) deletions?\(-\)/);
  return files || add || del ? { files, add, del } : null;
}

/**
 * The row the page opens on when nothing is selected: the newest live
 * session, else the newest one. Agent threads stand in when the project has
 * no sessions, as the list does.
 */
export function defaultPreviewItem(items: readonly SessionItem[]): SessionItem | null {
  const newest = (list: readonly SessionItem[]) =>
    list.reduce<SessionItem | null>((best, item) => (!best || item.lastActivityAt > best.lastActivityAt ? item : best), null);
  // live as the list shows it: Your turn or In flight
  return newest(items.filter((item) => item.group !== "recent")) ?? newest(items);
}

/** The session's own page, full-bleed: its conversation or /sessions/:ref. */
export function sessionFullRoute(session: InboxSession | null, ref: string): Route {
  return session?.route ?? { view: "sessions", sessionId: ref };
}

/** Recent sessions as picker options, for a Session panel pinned to one. */
export function recentSessionOptions(model: ProjectsInboxModel, limit = 40): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  const byRecent = [...model.sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  for (const session of byRecent) {
    const value = sessionRouteRef(session);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const work = session.work.length > 48 ? `${session.work.slice(0, 47)}…` : session.work;
    out.push({ value, label: `/${session.projectTitle} · ${session.agentName}${work ? ` · ${work}` : ""}` });
    if (out.length >= limit) break;
  }
  return out;
}

/* ── keys ── */

/**
 * Whether the Sessions list takes a key. Always while focus is inside its
 * panel; on the view's own route also while nothing has focus (the page was
 * this list). Never while typing, and never with a modifier: Shift/Alt+arrows
 * move and size panels, and Enter on a focused button elsewhere is that
 * button's.
 */
export function listOwnsKey(input: { inside: boolean; idle: boolean; own: boolean; typing: boolean; modified: boolean }): boolean {
  if (input.typing || input.modified) return false;
  return input.inside || (input.own && input.idle);
}

/** j/k and the arrows move the cursor; null for any other key. */
export function nextCursor(key: string, cursor: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown" || key === "j") return cursor < 0 ? 0 : Math.min(count - 1, cursor + 1);
  if (key === "ArrowUp" || key === "k") return cursor < 0 ? 0 : Math.max(0, cursor - 1);
  return null;
}

/* ── roots: Pull requests and Agents scope by path ── */

/**
 * Every checkout of a project, root first: its root, its worktrees, and the
 * workspaces its sessions and threads ran in. Pull requests read these (gh,
 * at most 12); Agents match an agent's projectRoot against them.
 */
export function projectRoots(model: ProjectsInboxModel, slug: string): string[] {
  const project = model.projects.find((entry) => entry.slug === slug) ?? null;
  const candidates = [
    project?.root ?? null,
    ...(project?.worktrees ?? []).map((worktree) => worktree.root),
    ...sessionsForProject(model.sessions, slug).flatMap((session) => [session.projectRoot, session.workspaceRoot]),
    ...threadsForProject(model.threads, slug).flatMap((thread) => [thread.projectRoot, thread.workspaceRoot]),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of candidates) {
    if (!root) continue;
    const key = normalizeProjectRootPath(root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

/** Whether a path is one of a project's checkouts (home-relative or absolute alike). */
export function rootIn(roots: readonly string[], path: string | null | undefined): boolean {
  if (!path) return false;
  const key = normalizeProjectRootPath(path);
  return roots.some((root) => normalizeProjectRootPath(root) === key);
}
