/**
 * Sessions — a project's sessions, grouped by whose turn it is.
 *
 * Shows:  Your turn · In flight · Recent, each row the work line, the agent's
 *         harness coin and name, branch, a live tag, age and context %.
 *         Recent folds after its first rows. A project with no sessions lists
 *         its agent threads, as the project page did.
 *         With no project chosen, every project's sessions, each row with
 *         its /project.
 * Data:   useProjectsInbox(), the shared Projects loop: conversations, fleet
 *         and the harness sessions tail discovery finds. No request of its own.
 * Scope:  Project, by slug ("This page's project" follows /projects/:slug);
 *         Harness. On the Projects view ?harness= wins over the panel's own.
 * Opens:  a click selects the row on its project's page (/projects/:slug/
 *         sessions/:ref, or ?select= for an agent), which the Session panel
 *         follows; double-click or Enter opens it: the session on its page,
 *         an agent thread's conversation, session or profile. On the
 *         Projects page ↑/↓ move the selection and the preview follows;
 *         double-click, Enter or ⌘-click (a new tab) open the session's own
 *         page; with nothing chosen it selects the newest live session (else
 *         the newest); the last row is the Sessions page.
 *
 * Keys: j/k or the arrows move the cursor and Enter opens it, while focus is
 * inside this panel, and on the Projects view also while nothing has focus,
 * the way the page's list took them. Never while typing, never with a
 * modifier (the grid's Shift/Alt+arrows), never from another panel. One per
 * view: it holds the page's cursor, and two would both answer a key.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { routePath } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";
import { ProjectRowsSkeleton, ProjectSurfaceState, ThreadRow } from "../../projects/ProjectsInbox.tsx";
import { projectsZeroPreviewEnabled } from "../../projects/ProjectsScreen.tsx";
import { isSessionSelected, isThreadSelected } from "../../projects/projects-inbox-model.ts";
import { useProjectsInbox } from "../../projects/useProjectsInbox.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import {
  defaultPreviewItem,
  inboxRoute,
  isProjectsPage,
  itemFullRoute,
  itemOpenRoute,
  itemSelectRoute,
  listOwnsKey,
  nextCursor,
  pageHasSelection,
  sessionItems,
  sessionSections,
  type SessionItem,
} from "./projects-model.ts";
import {
  isModifiedClick,
  openRouteInNewTab,
  projectScope,
  usePanelProject,
  useProjectsPage,
  useSyntheticSessionRedirect,
} from "./projects-shared.tsx";
import { optionsFrom } from "./shared.tsx";
import "./projects.css";

const isTyping = (el: Element | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

/** The Sessions page, the list's last row. */
const ALL_SESSIONS: Route = { view: "sessions" };

/** Focusable controls that own their Enter; a session row is one too, but opens itself. */
const PANEL_CONTROLS = "button, a[href], select, summary, [role='button'], [role='menuitem'], [role='option'], [role='tab']";

function ProjectSessions({ route, navigate, config }: ModuleProps) {
  const { model, nowMs, loading, error, page, hasData } = useProjectsPage(route);
  useSyntheticSessionRedirect(route);
  const own = isProjectsPage(route);
  const { slug } = usePanelProject(route, config.project, model);
  const harness = (own && route.view === "agents-v2" && route.harness) || config.harness || "";
  const zero = projectsZeroPreviewEnabled();

  const items = useMemo(() => (zero ? [] : sessionItems(model, slug, harness)), [harness, model, slug, zero]);
  const [unfolded, setUnfolded] = useState(false);
  const { sections, flat, folded } = useMemo(() => sessionSections(items, unfolded), [items, unfolded]);

  const { root, keyScope } = usePanelKeyScope();
  const [cursor, setCursor] = useState(-1);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // rows skip re-rendering while their own data holds (ThreadRow is memo'd), so their handlers read these
  const latest = useRef({ flat, page });
  latest.current = { flat, page };
  const isSelected = (item: SessionItem) =>
    own && (item.kind === "session" ? isSessionSelected(item, page, model.sessions) : isThreadSelected(item, page, model.threads));
  // the cursor starts on the row the page previews, so ↑ and ↓ go on from it
  const selectedAt = own ? flat.findIndex(isSelected) : -1;
  const at = cursor >= 0 ? cursor : selectedAt;
  // on the Projects page a click previews in place, so double-click and Enter go to the row's own page
  const openRoute = (item: SessionItem) => (own ? itemFullRoute(item, page) : itemOpenRoute(item, page));

  useEffect(() => {
    setCursor(-1);
    setUnfolded(false);
  }, [slug, harness]);

  // the Projects page never opens empty: with nothing chosen, the newest live session (else the newest)
  // only once the loop's read has settled, so a partial first read never picks a stale row
  const preselect = own && slug && !loading && hasData && !pageHasSelection(route) ? defaultPreviewItem(items) : null;
  useEffect(() => {
    if (preselect) navigate(itemSelectRoute(preselect, page), { replace: true });
  }, [preselect?.id, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const active = document.activeElement;
      const panel = keyScope();
      const owns = listOwnsKey({
        inside: Boolean(panel && event.target instanceof Node && panel.contains(event.target)),
        idle: !active || active === document.body,
        own,
        typing: isTyping(active),
        modified: event.shiftKey || event.altKey || event.metaKey || event.ctrlKey,
      });
      if (!owns || flat.length === 0) return;
      const moved = nextCursor(event.key, at, flat.length);
      if (moved != null) {
        event.preventDefault();
        setCursor(moved);
        // on the Projects page the preview follows the cursor; each step replaces the last, so Back skips them
        const item = flat[moved];
        if (own && item) navigate(itemSelectRoute(item, page), { replace: true });
        return;
      }
      if (event.key !== "Enter") return;
      // a row with focus opens itself; else the cursor's row, else the first
      const focusedId = active instanceof HTMLElement ? active.dataset.pjRow : undefined;
      // Enter on another control (Scope, Full view) is that control's
      if (!focusedId && active instanceof HTMLElement && active.matches(PANEL_CONTROLS)) return;
      const target = (focusedId && flat.find((item) => item.id === focusedId)) || flat[at < 0 ? 0 : at];
      if (!target) return;
      event.preventDefault();
      navigate(openRoute(target));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [at, flat, keyScope, navigate, own, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const target = cursor >= 0 ? flat[cursor] : undefined;
    if (target) rows.current.get(target.id)?.scrollIntoView({ block: "nearest" });
  }, [cursor, flat]);

  const initialLoading = loading && !hasData && !zero;
  const select = (id: string, event?: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }) => {
    const { flat: now, page: here } = latest.current;
    const item = now.find((entry) => entry.id === id);
    if (!item) return;
    // ⌘-click: the row's own page in a new tab, this page left as it is
    if (own && event && isModifiedClick(event)) {
      openRouteInNewTab(itemFullRoute(item, here));
      return;
    }
    setCursor(now.indexOf(item));
    // selects on the row's project page: in place on the Projects view, into it from anywhere else
    navigate(itemSelectRoute(item, here));
  };
  const open = (id: string) => {
    const { flat: now, page: here } = latest.current;
    const item = now.find((entry) => entry.id === id);
    if (item) navigate(own ? itemFullRoute(item, here) : itemOpenRoute(item, here));
  };
  let index = -1;
  return (
    <div className="vw-pj vw-pj-sessions s-pi" ref={root}>
      <div className="pi-threads">
        {initialLoading ? <ProjectRowsSkeleton /> : null}
        {!initialLoading &&
          sections.map((section) => (
            <div key={section.group}>
              <div className="pi-sectionHead" data-tone={section.group}>
                <span className="pi-sectionLabel">{section.label}</span>
                <span className="pi-sectionCount">{section.total}</span>
              </div>
              {section.items.map((item) => (
                <ThreadRow
                  key={item.id}
                  thread={item}
                  crossProject={!slug}
                  selected={isSelected(item)}
                  cursor={cursor === ++index}
                  nowMs={nowMs}
                  onSelect={(event) => select(item.id, event)}
                  onOpen={() => open(item.id)}
                  rowRef={(el) => {
                    if (el) {
                      el.dataset.pjRow = item.id;
                      rows.current.set(item.id, el);
                    } else rows.current.delete(item.id);
                  }}
                />
              ))}
            </div>
          ))}
        {!initialLoading && folded > 0 ? (
          <button type="button" className="vw-pj-more" onClick={() => setUnfolded(true)}>
            Show older
          </button>
        ) : null}
        {own && slug && !initialLoading && items.length > 0 ? (
          <a
            className="vw-pj-more"
            href={routePath(ALL_SESSIONS)}
            title="Every session on the Sessions page; it does not filter by project yet"
            onClick={(event) => {
              if (isModifiedClick(event)) return;
              event.preventDefault();
              navigate(ALL_SESSIONS);
            }}
          >
            All sessions
          </a>
        ) : null}
        {!initialLoading && items.length === 0 ? (
          error && !hasData ? (
            <ProjectSurfaceState tone="error" title="Projects unavailable" detail={error} />
          ) : loading && !zero ? (
            <div className="pi-empty">Loading…</div>
          ) : slug && !harness ? (
            <ProjectSurfaceState
              title="No sessions here yet."
              detail="Start Claude Code, Codex or another harness in this project and its sessions show up here."
            />
          ) : (
            <ProjectSurfaceState title={harness ? "No sessions on this harness." : "No sessions yet."} />
          )
        ) : null}
      </div>
    </div>
  );
}

const harnessScope: ModuleScope = {
  key: "harness",
  allLabel: "Any harness",
  useOptions: () => {
    const { route } = useScout();
    const { model } = useProjectsInbox(inboxRoute(route));
    return optionsFrom([...model.sessions, ...model.threads], (item) => item.harness?.toLowerCase());
  },
};

export const projectSessionsModule = defineModule({
  type: "project-sessions",
  title: "Sessions",
  blurb: "A project's sessions by whose turn it is: Your turn, In flight, Recent",
  docs: {
    shows: "Sessions in Your turn · In flight · Recent (folded after its first rows) with agent, harness, branch, live tag, age and context; agent threads when a project has none; every project's when none is chosen.",
    data: "useProjectsInbox(), the shared Projects loop; no request of its own.",
    opens: "Click selects on the project's page (the Session panel follows); double-click or Enter opens the session, conversation or agent.",
  },
  size: { w: 4, h: 16 },
  minSize: { w: 3, h: 6 },
  // the page's cursor and keys are one of a kind
  maxPerView: 1,
  scopes: [projectScope, harnessScope],
  Component: ProjectSessions,
});
