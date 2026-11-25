/**
 * Session — one session, read in place: what it did, then the transcript.
 *
 * Shows:  the masthead (work headline, live state, agent · harness · model ·
 *         branch · started · duration · turn · ref, and the terminal hop
 *         actions), the glance (turns, tools, edits, files, context, tokens,
 *         and the project's other threads), then the session's transcript or
 *         conversation. When the page peeks an agent (?select=), that agent's
 *         card: status, headline, readouts, and Open · Observe · Clear.
 *         Head: Open full, and Clear (or Unpin when pinned to one).
 * Data:   the session's observe data or conversation (SessionRefScreen's
 *         lookup, by ref); its row from useProjectsInbox(), the shared
 *         Projects loop.
 * Scope:  Session, by ref. "This page's session" follows
 *         /projects/:slug/sessions/:ref (and ?select= for a peek); pick one
 *         from recent sessions to pin it.
 * Opens:  Open full: the session's own page (its conversation, or
 *         /sessions/:ref); the hop actions: its terminal; a thread: its
 *         conversation or agent; Clear: the page without a selection.
 *         On the Projects page it previews a PR (?pr=) or a worktree
 *         (?worktree=) the same way: what it is, its changed files from Repo
 *         Watch (a PR's through its branch's checkout here), and the picked
 *         file's diff (?file=). Open full: the PR on GitHub, the worktree's
 *         diff, or Files on the picked file.
 */
import { useEffect, useMemo } from "react";
import type { Route } from "../../../lib/types.ts";
import { timeAgo } from "../../../lib/time.ts";
import type { RepoWatchSnapshot } from "../../../scout/repo-watch/types.ts";
import { codeRouteFor, diffBadge, findWorktree } from "../../code/code-browser-model.ts";
import { CodeDiffPane } from "../../code/CodeDiffPane.tsx";
import { prefetchFilePreview } from "../../code/code-preview.ts";
import { pollCodeSnapshot, useCodeSnapshot } from "../../code/code-snapshot.ts";
import { ProjectsThreadAside } from "../../projects/ProjectsThreadAside.tsx";
import { SelectedSessionMain } from "../../projects/ProjectsInbox.tsx";
import { findInboxSession, threadsForProject } from "../../projects/projects-inbox-model.ts";
import { useProjectsInbox } from "../../projects/useProjectsInbox.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE, scopeValue } from "./panel-scope.ts";
import { moreChanges, splitChangedPath } from "./code-panel-model.ts";
import { usePageProjectPrs, usePageProjectRoots } from "./prs.tsx";
import {
  clearSelectionRoute,
  inboxRoute,
  isProjectsPage,
  pagePreview,
  pageSessionRef,
  previewFileRoute,
  recentSessionOptions,
  sessionFullRoute,
  type PagePreview,
  type ProjectsPageRoute,
} from "./projects-model.ts";
import { useProjectsPage, useSyntheticSessionRedirect } from "./projects-shared.tsx";
import { Quiet } from "./shared.tsx";
import "../../code/code-screen.css";
import "./code-panels.css";
import "./projects.css";

function Session({ route, navigate, config, setConfig }: ModuleProps) {
  const { model, nowMs, page } = useProjectsPage(route);
  useSyntheticSessionRedirect(route);
  const following = config.session === FOLLOW_PAGE;
  const ref = scopeValue(config.session, pageSessionRef(route));
  // a pinned session resolves anywhere; a followed one inside the page's project
  const at: ProjectsPageRoute = useMemo(
    () => (ref ? { ...(following ? page : inboxRoute(route)), sessionId: ref } : page),
    [following, page, ref, route],
  );
  const session = useMemo(() => (ref ? findInboxSession(model.sessions, at) : null), [at, model.sessions, ref]);
  const slug = at.projectSlug ?? session?.projectSlug ?? null;
  const threads = useMemo(() => (slug ? threadsForProject(model.threads, slug) : []), [model.threads, slug]);
  const clear = () => (following ? navigate(clearSelectionRoute(page)) : setConfig({ session: "" }));
  // the Projects page previews a PR or a worktree here too (?pr=, ?worktree=)
  const preview = following ? pagePreview(route) : null;
  if (preview) return <PreviewPane key={preview.kind === "pr" ? `pr:${preview.number}` : preview.path} preview={preview} route={route} page={page} navigate={navigate} />;

  if (ref) {
    return (
      <div className="vw-pj vw-pj-session s-pi">
        <ModuleHead>
          <button type="button" className="vw-chip" onClick={() => navigate(sessionFullRoute(session, ref))} title="Open this session on its own page">
            Open full
          </button>
          {(!following || isProjectsPage(route)) && (
            <button type="button" className="vw-chip" onClick={clear} title={following ? "Clear the page's selection" : "Stop showing this session"}>
              {following ? "Clear" : "Unpin"}
            </button>
          )}
        </ModuleHead>
        <SelectedSessionMain key={ref} session={session} sessionRef={ref} threads={threads} route={at} navigate={navigate} nowMs={nowMs} />
      </div>
    );
  }
  // the page peeks an agent: its card, with Open · Observe · Clear
  if (following && isProjectsPage(route) && route.selectedAgentId) {
    return (
      <div className="vw-pj vw-pj-peek">
        <ProjectsThreadAside route={page} navigate={navigate} />
      </div>
    );
  }
  return <Quiet>{following ? "Pick a session in Sessions and it opens here." : "Pick a session from Scope, or follow this page's."}</Quiet>;
}

/** The checkout of a branch, preferring the project's own: where a PR's files can be read on this host. */
function branchCheckout(snapshot: RepoWatchSnapshot | null, branch: string, roots: readonly string[]): string | null {
  const found = (snapshot?.projects ?? []).flatMap((project) => project.worktrees).filter((wt) => wt.branch.name === branch);
  const inside = (path: string) => roots.some((root) => path === root || path.startsWith(`${root}/`));
  return (found.find((wt) => inside(wt.path)) ?? found[0])?.path ?? null;
}

/**
 * A PR or a worktree, previewed in place: what it is, its changed files, and
 * the diff of the file picked. Open full goes to its own page: the PR on
 * GitHub, the worktree's diff, or Files on the picked file.
 */
function PreviewPane({ preview, route, page, navigate }: { preview: PagePreview; route: Route; page: ProjectsPageRoute; navigate: ModuleProps["navigate"] }) {
  // one shared poll however many Code panels read it
  useEffect(() => pollCodeSnapshot(30_000), []);
  const snapshot = useCodeSnapshot();
  const { pullRequests, error } = usePageProjectPrs(route);
  const { roots } = usePageProjectRoots(route);
  const pr = preview.kind === "pr" ? pullRequests?.find((item) => item.number === preview.number) ?? null : null;
  const root = preview.kind === "worktree" ? preview.path : pr ? branchCheckout(snapshot, pr.headRefName, roots) : null;
  const active = findWorktree(snapshot, root);
  const status = active?.worktree.status ?? null;
  const files = status?.files ?? [];
  const more = status ? moreChanges(status.changedFiles, files.length) : 0;
  const branch = pr?.headRefName ?? active?.worktree.branch.name ?? (active?.worktree.branch.detached ? "a detached head" : null);
  const file = root && preview.file ? `${root}/${preview.file}` : null;
  const diffRoute: Route | null = root ? { view: "repo-diff", path: root } : null;

  const openFull = () => {
    if (file && root) navigate(codeRouteFor(snapshot, root, file));
    else if (preview.kind === "pr") {
      if (pr) window.open(pr.url, "_blank", "noopener");
    } else if (diffRoute) navigate(diffRoute);
  };
  const fullTitle = file ? "Open this file in Files" : preview.kind === "pr" ? "Open this pull request on GitHub" : "Open this worktree's diff";

  return (
    <div className="vw-code-changes vw-pj-preview">
      <ModuleHead>
        {status ? <span className="hud-grid-count">{status.changedFiles}</span> : null}
        <button type="button" className="vw-chip" onClick={openFull} disabled={preview.kind === "pr" && !pr && !file} title={fullTitle}>
          Open full
        </button>
        <button type="button" className="vw-chip" onClick={() => navigate(clearSelectionRoute(page))} title="Clear the page's selection">
          Clear
        </button>
      </ModuleHead>
      {preview.kind === "pr" ? (
        pr ? (
          <div className="vw-pj-previewHead">
            <span className="vw-pj-previewTitle" title={pr.title}>
              <span className="vw-dim">#{pr.number}</span> {pr.title}
            </span>
            <span className="vw-dim vw-ell">
              {pr.baseRefName ? `${pr.headRefName} → ${pr.baseRefName}` : pr.headRefName}
              {pr.isDraft ? " · draft" : ""}
              {pr.author ? ` · ${pr.author}` : ""}
              {pr.updatedAt ? ` · ${timeAgo(Date.parse(pr.updatedAt))}` : ""}
            </span>
          </div>
        ) : (
          <Quiet>{error ? `Couldn't read pull requests: ${error}` : pullRequests ? `#${preview.number} is not an open pull request here.` : "Reading pull requests…"}</Quiet>
        )
      ) : null}
      {active && status ? (
        <>
          <div className="vw-code-meta">
            {branch ? <span className="vw-code-branch">{branch}</span> : null}
            {active.worktree.diff.branchShortstat ? <span className="s-code-headStat">{active.worktree.diff.branchShortstat}</span> : null}
          </div>
          {files.length > 0 ? (
            <div className="vw-code-changeList" role="list" aria-label="Changed files" data-open={file ? "" : undefined}>
              {files.map((change) => {
                const path = `${root}/${change.path}`;
                const { dir, name } = splitChangedPath(change.path);
                const open = preview.file === change.path;
                return (
                  <button
                    key={change.path}
                    type="button"
                    role="listitem"
                    className="s-code-node"
                    data-selected={open || undefined}
                    title={open ? `${change.path} · click again to close its diff` : `${change.path} · ${change.status}`}
                    onClick={() => navigate(previewFileRoute(page, open ? null : change.path))}
                    onMouseEnter={() => prefetchFilePreview(path)}
                  >
                    <span className="s-code-nodeName">
                      {dir ? <span className="vw-code-dir">{dir}</span> : null}
                      {name}
                    </span>
                    <span className="vw-code-letter">{diffBadge(change.status)}</span>
                  </button>
                );
              })}
              {more > 0 && diffRoute ? (
                <button type="button" className="vw-code-more" onClick={() => navigate(diffRoute)}>
                  +{more} more in the diff
                </button>
              ) : null}
            </div>
          ) : (
            <Quiet>Clean{branch ? ` on ${branch}` : ""}.</Quiet>
          )}
          {file && root ? (
            <div className="vw-pj-previewDiff">
              <CodeDiffPane key={file} root={root} file={file} />
            </div>
          ) : null}
        </>
      ) : preview.kind === "pr" && pr && !root ? (
        <Quiet>No checkout of {pr.headRefName} on this host, so its files are not read here. Open full shows it on GitHub.</Quiet>
      ) : root && !snapshot ? (
        <Quiet>Reading changes…</Quiet>
      ) : root ? (
        <Quiet>Repo Watch doesn't list this checkout yet, so its changes aren't known here.</Quiet>
      ) : null}
    </div>
  );
}

const sessionScope: ModuleScope = {
  key: "session",
  allLabel: "No session",
  followsPage: "This page's session",
  useOptions: () => {
    const { route } = useScout();
    const { model } = useProjectsInbox(inboxRoute(route));
    return useMemo(() => recentSessionOptions(model), [model]);
  },
};

export const sessionModule = defineModule({
  type: "session",
  title: "Session",
  blurb: "One session in place: what it did, its glance, then the transcript",
  docs: {
    shows: "The session's masthead, glance and transcript; an agent's card with Open, Observe and Clear when the page peeks one.",
    data: "The session's observe data or conversation (by ref); its row from useProjectsInbox().",
    opens: "Open full: the session's own page; hop actions: its terminal; Clear: the page without a selection.",
  },
  size: { w: 5, h: 16 },
  minSize: { w: 4, h: 8 },
  scopes: [sessionScope],
  Component: Session,
});
