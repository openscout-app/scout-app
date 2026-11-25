/**
 * Project, Thread, Changes, Branches, Diff — the Projects page around one
 * choice: look at the project by its sessions, or by its worktrees.
 *
 * Shows:  Project (project-nav): a thin line naming the project, with the way
 *         back to picking one; then two heads, Sessions (newest live first) and
 *         Worktrees (open pull requests, then active branches, then a count of
 *         the quiet ones). The open head is the page's choice; by worktrees,
 *         the worktrees lead and the open pull requests follow. Thread
 *         (project-thread): the selected session's thread and composer, with
 *         nothing stacked above it. Changes
 *         (session-changes): the selected session's worktree, its branch and
 *         PR, churn, changed files and a file's diff in place. Branches
 *         (project-branches): the pull requests and branches, or the one
 *         picked: who made it and its files (the page picks the newest
 *         active branch when nothing is). Diff (project-diff): that file.
 * Data:   useProjectsInbox(), the shared Projects loop (sessions and threads);
 *         the shared Repo Watch read (pollCodeSnapshot, 30s) for worktrees,
 *         changed files, diff stats and attached sessions; the page
 *         project's open PRs (usePageProjectPrs, one read per page). No panel
 *         polls on its own. Joins: a session's worktree by workspace root,
 *         then by the sessions Repo Watch attaches, then by branch; a PR's
 *         worktree by its head branch.
 * Scope:  Project, by slug ("This page's project" follows /projects/:slug);
 *         the other three follow the page's selection.
 * Opens:  a Sessions row selects the session (/projects/:slug/sessions/:ref)
 *         and the page draws Session beside Changes; a PR or branch selects
 *         it (?pr= or ?worktree=) and the page draws Branches beside Diff; a
 *         file sets ?file=. Double-click opens the session's page, the PR on
 *         GitHub, or the branch's diff; ⌘-click opens a new tab.
 *         composedViewFor picks the composition from the route (pageLooksBy).
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { HarnessCoin } from "../../../components/HarnessCoin.tsx";
import { timeAgo } from "../../../lib/time.ts";
import type { Route } from "../../../lib/types.ts";
import type { RepoPullRequestItem } from "../../../scout/repo-watch/api.ts";
import type { RepoWatchSnapshot, RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import { codeRouteFor, findWorktree } from "../../code/code-browser-model.ts";
import { fetchRepoDiffSnapshot } from "../../../scout/repo-diff/cache.ts";
import { RepoDiffViewerLazy } from "../../../scout/repo-diff/RepoDiffViewerLazy.tsx";
import type { RepoDiffFileStatus, RepoDiffLayer, RepoDiffLayerKind } from "../../../scout/repo-diff/types.ts";
import { prefetchFilePreview } from "../../code/code-preview.ts";
import { pollCodeSnapshot, useCodeSnapshot } from "../../code/code-snapshot.ts";
import { shortHomePath } from "../../projects/project-overview-helpers.ts";
import { ProjectsThreadAside } from "../../projects/ProjectsThreadAside.tsx";
import { SessionRefScreen } from "../../sessions/SessionRefScreen.tsx";
import {
  findInboxSession,
  isSessionSelected,
  isThreadSelected,
  sessionsForProject,
  type InboxSession,
} from "../../projects/projects-inbox-model.ts";
import { splitChangedPath } from "./code-panel-model.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { usePageProjectPrs, usePageProjectRoots } from "./prs.tsx";
import {
  defaultPreviewItem,
  itemFullRoute,
  itemSelectRoute,
  lookByRoute,
  pageHasSelection,
  pageLooksBy,
  pageSessionRef,
  parseShortstat,
  previewFileRoute,
  previewRoute,
  sessionFileRoute,
  sessionFullRoute,
  sessionItems,
  type ProjectsPageRoute,
  type SessionItem,
} from "./projects-model.ts";
import { isModifiedClick, openRouteInNewTab, projectScope, usePanelProject, useProjectsPage, useSyntheticSessionRedirect } from "./projects-shared.tsx";
import { Quiet } from "./shared.tsx";
import "../../code/code-screen.css";
import "./code-panels.css";
import "./projects.css";
import "./project-look.css";

const DAY = 24 * 60 * 60 * 1000;

/* ── the page's data: checkouts, and the joins ── */

/** Every checkout of the page project's repositories, from the shared Repo Watch read: main first, then newest. */
export function useProjectCheckouts(route: Route) {
  useEffect(() => pollCodeSnapshot(30_000), []);
  const snapshot = useCodeSnapshot();
  const { roots } = usePageProjectRoots(route);
  const worktrees = useMemo(() => {
    const repos = (snapshot?.projects ?? []).filter((repo) => roots.some((root) => root === repo.root || repo.worktrees.some((wt) => wt.path === root)));
    return repos
      .flatMap((repo) => repo.worktrees)
      .filter((wt) => !wt.isBare)
      .sort((a, b) => Number(b.branch.isMain) - Number(a.branch.isMain) || (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0));
  }, [roots, snapshot]);
  return { snapshot, worktrees };
}

/** A path with the home directory as "~" and no trailing slash: sessions report "~/dev/x", Repo Watch "/example/me/dev/x". */
export const homeForm = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~").replace(/\/+$/, "");

/** The checkout a session works in: its workspace root (or the checkout holding it), the session Repo Watch attaches, then its branch. */
export function worktreeOfSession(session: Pick<InboxSession, "workspaceRoot" | "sessionId" | "branch">, worktrees: readonly RepoWatchWorktree[]): RepoWatchWorktree | null {
  const at = session.workspaceRoot ? homeForm(session.workspaceRoot) : null;
  if (at) {
    const exact = worktrees.find((wt) => homeForm(wt.path) === at);
    if (exact) return exact;
    const holding = worktrees.filter((wt) => at.startsWith(`${homeForm(wt.path)}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    if (holding) return holding;
  }
  if (session.sessionId) {
    const attached = worktrees.find((wt) => wt.sessions.some((ref) => ref.id === session.sessionId));
    if (attached) return attached;
  }
  return session.branch ? worktrees.find((wt) => wt.branch.name === session.branch) ?? null : null;
}

const prOfWorktree = (wt: RepoWatchWorktree | null, prs: readonly RepoPullRequestItem[] | null) =>
  wt?.branch.name ? prs?.find((pr) => pr.headRefName === wt.branch.name) ?? null : null;

const worktreeOfPr = (pr: RepoPullRequestItem | null, worktrees: readonly RepoWatchWorktree[], snapshot: RepoWatchSnapshot | null) =>
  pr ? worktrees.find((wt) => wt.branch.name === pr.headRefName) ?? (snapshot?.projects ?? []).flatMap((repo) => repo.worktrees).find((wt) => wt.branch.name === pr.headRefName) ?? null : null;

/** A checkout worth a row without asking: main, one with changes or a session, or one committed to in the last two days. */
const isActive = (wt: RepoWatchWorktree, nowMs: number) =>
  wt.branch.isMain || wt.status.changedFiles > 0 || wt.sessions.length > 0 || (wt.lastCommitAt != null && nowMs - wt.lastCommitAt < 2 * DAY);

const branchLabel = (wt: RepoWatchWorktree) => wt.branch.name ?? (wt.branch.detached ? "detached head" : wt.name);

/** The page's selection on the worktrees side: the PR, and the checkout its files are read from. */
function useSelectedChange(route: ProjectsPageRoute) {
  const { snapshot, worktrees } = useProjectCheckouts(route);
  const { pullRequests, error } = usePageProjectPrs(route);
  const pr = route.pr ? pullRequests?.find((item) => item.number === route.pr) ?? null : null;
  const wt = route.worktree ? worktrees.find((item) => item.path === route.worktree) ?? findWorktree(snapshot, route.worktree)?.worktree ?? null : worktreeOfPr(pr, worktrees, snapshot);
  return { snapshot, worktrees, pullRequests, error, pr, wt };
}

function Churn({ stat }: { stat: string | null | undefined }) {
  const n = parseShortstat(stat);
  if (!n || n.add + n.del === 0) return null;
  return (
    <span className="vw-pl-churn">
      <b className="pi-projectWorktreeAdd">+{n.add}</b>
      <b className="pi-projectWorktreeDel">−{n.del}</b>
    </span>
  );
}

const newTab = (event: MouseEvent, route: Route) => {
  if (!isModifiedClick(event)) return false;
  openRouteInNewTab(route);
  return true;
};

/* ── Project: the choice, and what it opens ── */

function ProjectNav({ route, navigate, config }: ModuleProps) {
  const { model, nowMs, page, loading, hasData } = useProjectsPage(route);
  useSyntheticSessionRedirect(route);
  const { slug, project } = usePanelProject(route, config.project, model);
  const by = pageLooksBy(route);
  const items = useMemo(() => sessionItems(model, slug, ""), [model, slug]);
  const ordered = useMemo(
    () => [...items].sort((a, b) => Number(b.group !== "recent") - Number(a.group !== "recent") || b.lastActivityAt - a.lastActivityAt),
    [items],
  );
  const live = items.filter((item) => item.group !== "recent").length;
  const { snapshot, worktrees } = useProjectCheckouts(route);
  const { pullRequests } = usePageProjectPrs(route);
  const prs = useMemo(() => [...(pullRequests ?? [])].sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "")), [pullRequests]);
  const active = useMemo(() => worktrees.filter((wt) => isActive(wt, nowMs)), [nowMs, worktrees]);
  const quiet = worktrees.filter((wt) => !isActive(wt, nowMs)).length;

  // looking by sessions never opens empty: the newest live session (else the newest), once the read has settled
  const preselect = by === "sessions" && slug && !loading && hasData && !pageHasSelection(route) ? defaultPreviewItem(items) : null;
  useEffect(() => {
    if (preselect) navigate(itemSelectRoute(preselect, page), { replace: true });
  }, [preselect?.id, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  // looking by worktrees never opens empty either: the newest active branch other than main, else main
  const firstCheckout = by === "worktrees" && slug && snapshot && !page.pr && !page.worktree ? (active.find((wt) => !wt.branch.isMain) ?? active[0] ?? null) : null;
  useEffect(() => {
    if (firstCheckout) navigate(previewRoute(page, { worktree: firstCheckout.path }), { replace: true });
  }, [firstCheckout?.path, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // the project list with none picked: every project's sessions; a pick opens its project by sessions
  if (!slug) {
    return (
      <div className="vw-pl-nav s-pi">
        <div className="vw-pl-group"><span>Every project's sessions</span><b>{items.length || ""}</b></div>
        {ordered.map((item) => (
          <button key={item.id} type="button" className="vw-pl-node" title={item.work || item.agentName} onClick={() => navigate(itemSelectRoute(item, page))} onDoubleClick={() => navigate(itemFullRoute(item, page))}>
            <HarnessCoin harness={item.harness} size={16} />
            <span className="vw-pl-label">{item.work || item.agentName}</span>
            <span className="vw-pl-age">/{item.projectTitle}</span>
            <span className="vw-pl-age">{timeAgo(item.lastActivityAt, nowMs)}</span>
          </button>
        ))}
        {loading && !hasData ? <div className="vw-pl-quiet">Reading sessions…</div> : null}
      </div>
    );
  }
  const selected = (item: SessionItem) =>
    item.kind === "session" ? isSessionSelected(item, page, model.sessions) : isThreadSelected(item, page, model.threads);
  const liveOn = (wt: RepoWatchWorktree | null) =>
    wt ? sessionsForProject(model.sessions, slug).filter((s) => s.group !== "recent" && worktreeOfSession(s, worktrees) === wt) : [];

  return (
    <div className="vw-pl-nav s-pi">
      <div className="vw-pl-crumb">
        <button type="button" className="vw-pl-back" onClick={() => navigate({ view: "agents-v2", indexView: "projects" })} title="Pick another project">
          <Chevron open={false} back />
          Projects
        </button>
        <button type="button" className="vw-pl-overview" onClick={() => navigate({ view: "agents-v2", projectSlug: slug })} title="This project's Overview">
          <b title={project?.root ?? undefined}>{project?.title ?? slug}</b>
        </button>
      </div>
      <button type="button" className="vw-pl-branch" data-open={by === "sessions" || undefined} onClick={() => by !== "sessions" && navigate(lookByRoute(page, "sessions"))}>
        <Chevron open={by === "sessions"} />
        <b>Sessions</b>
        <em>{hasData ? (live ? `${live} live` : items.length) : ""}</em>
      </button>
      {by === "sessions" ? (
        <div className="vw-pl-items" role="list">
          {loading && !hasData ? <div className="vw-pl-quiet">Reading sessions…</div> : null}
          {ordered.map((item) => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className="vw-pl-node"
              data-selected={selected(item) || undefined}
              title={item.work || item.agentName}
              onClick={(event) => newTab(event, itemFullRoute(item, page)) || navigate(itemSelectRoute(item, page))}
              onDoubleClick={() => navigate(itemFullRoute(item, page))}
            >
              <HarnessCoin harness={item.harness} size={16} />
              <span className="vw-pl-label">{item.work || item.agentName}</span>
              {item.group !== "recent" ? <span className="pi-rowLiveTag">live</span> : null}
              <span className="vw-pl-age">{timeAgo(item.lastActivityAt, nowMs)}</span>
            </button>
          ))}
          {!loading && items.length === 0 ? <div className="vw-pl-quiet">No sessions in this project yet.</div> : null}
        </div>
      ) : null}
      <button type="button" className="vw-pl-branch" data-open={by === "worktrees" || undefined} onClick={() => by !== "worktrees" && navigate(lookByRoute(page, "worktrees"))}>
        <Chevron open={by === "worktrees"} />
        <b>Worktrees</b>
        <em>{snapshot ? active.length : ""}</em>
      </button>
      {by === "worktrees" ? (
        <div className="vw-pl-items" role="list">
          {!snapshot ? <div className="vw-pl-quiet">Reading worktrees…</div> : null}
          {active.map((wt) => {
            const pr = prOfWorktree(wt, pullRequests);
            return (
              <button
                key={wt.path}
                type="button"
                role="listitem"
                className="vw-pl-node"
                data-selected={page.worktree === wt.path || (pr !== null && page.pr === pr.number) || undefined}
                title={wt.path}
                onClick={(event) => newTab(event, { view: "repo-diff", path: wt.path }) || navigate(previewRoute(page, { worktree: wt.path }))}
                onDoubleClick={() => navigate({ view: "repo-diff", path: wt.path })}
              >
                <span className="vw-pl-label vw-pl-mono">{branchLabel(wt)}</span>
                {pr ? <span className="vw-pl-prTag">#{pr.number}</span> : null}
                <Coins sessions={liveOn(wt)} size={14} />
                <span className="vw-pl-age">{wt.lastCommitAt ? timeAgo(wt.lastCommitAt, nowMs) : ""}</span>
              </button>
            );
          })}
          {quiet > 0 ? <div className="vw-pl-quiet">{quiet} more worktrees with nothing recent</div> : null}
          <div className="vw-pl-group"><span>Pull requests</span><b>{pullRequests ? prs.length : "…"}</b></div>
          {prs.map((pr) => {
            const wt = worktreeOfPr(pr, worktrees, snapshot);
            return (
              <button
                key={pr.number}
                type="button"
                role="listitem"
                className="vw-pl-node"
                data-selected={(page.pr === pr.number && !page.worktree) || undefined}
                title={`#${pr.number} ${pr.title}${wt ? "" : " (not checked out here)"}`}
                onClick={() => navigate(previewRoute(page, { pr: pr.number }))}
                onDoubleClick={() => window.open(pr.url, "_blank", "noopener")}
              >
                <span className="vw-pl-pr">#{pr.number}</span>
                <span className="vw-pl-label">{pr.title}</span>
                <Coins sessions={liveOn(wt)} size={14} />
                <span className="vw-pl-age">{pr.updatedAt ? timeAgo(Date.parse(pr.updatedAt), nowMs) : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open, back }: { open: boolean; back?: boolean }) {
  return (
    <svg className="vw-pl-chev" data-open={open || undefined} data-back={back || undefined} width={10} height={10} viewBox="0 0 16 16" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── the changed files of one checkout, and a file's diff ── */

/** What a worktree's branch changed: from its merge-base to HEAD, then staged, then not yet staged. */
const BRANCH_LAYERS: RepoDiffLayerKind[] = ["branch", "staged", "unstaged"];

const STATUS_LETTER: Record<RepoDiffFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  conflict: "U",
  unknown: "?",
};

export type BranchFile = { path: string; status: RepoDiffFileStatus; add: number; del: number };

/** One row per file across the layers: lines summed, the newest layer's status. */
export function branchFiles(layers: readonly Pick<RepoDiffLayer, "files">[]): BranchFile[] {
  const byPath = new Map<string, BranchFile>();
  for (const layer of layers) {
    for (const file of layer.files) {
      const path = file.newPath ?? file.oldPath;
      if (!path) continue;
      const seen = byPath.get(path);
      byPath.set(path, { path, status: file.status, add: (seen?.add ?? 0) + (file.additions ?? 0), del: (seen?.del ?? 0) + (file.deletions ?? 0) });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** A checkout's branch files, read again when Repo Watch sees its branch or working tree move. */
function useBranchFiles(wt: RepoWatchWorktree | null): { files: BranchFile[] | null; error: string | null } {
  const key = wt ? `${wt.path}\0${wt.diff.branchShortstat ?? ""}\0${wt.status.changedFiles}` : "";
  const [read, setRead] = useState<{ key: string; files: BranchFile[] | null; error: string | null }>({ key: "", files: null, error: null });
  useEffect(() => {
    if (!wt) return;
    let live = true;
    fetchRepoDiffSnapshot(wt.path, BRANCH_LAYERS, { tier: "summary" }).then(
      (record) => live && setRead({ key, files: branchFiles(record.snapshot.layers), error: null }),
      (e: unknown) => live && setRead({ key, files: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep the last list while a newer read is on its way, so the rows do not blink
  return read.key === key || (read.files && wt && read.key.startsWith(`${wt.path}\0`)) ? { files: read.files, error: read.error } : { files: null, error: null };
}

function ChangedFiles({
  wt,
  files,
  error,
  file,
  onFile,
}: {
  wt: RepoWatchWorktree;
  files: BranchFile[] | null;
  error: string | null;
  file: string | null;
  onFile: (path: string | null) => void;
}) {
  if (!files) return <Quiet>{error ? `Couldn't read ${branchLabel(wt)}: ${error}` : `Reading ${branchLabel(wt)}…`}</Quiet>;
  if (files.length === 0) return <Quiet>Nothing changed on {branchLabel(wt)}.</Quiet>;
  return (
    <div className="vw-code-changeList" role="list" aria-label="Changed files" data-open={file ? "" : undefined}>
      {files.map((change) => {
        const { dir, name } = splitChangedPath(change.path);
        const open = file === change.path;
        return (
          <button
            key={change.path}
            type="button"
            role="listitem"
            className="s-code-node"
            data-selected={open || undefined}
            title={open ? `${change.path} · click again to close its diff` : `${change.path} · ${change.status}`}
            onClick={() => onFile(open ? null : change.path)}
          >
            <span className="s-code-nodeName">
              {dir ? <span className="vw-code-dir">{dir}</span> : null}
              {name}
            </span>
            <span className="vw-pl-fileChurn">
              {change.add ? <b>+{change.add}</b> : null}
              {change.del ? <i>−{change.del}</i> : null}
            </span>
            <span className="vw-code-letter">{STATUS_LETTER[change.status]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One file of a worktree's branch, as the diff viewer draws it. */
function BranchDiff({ root, file }: { root: string; file: string }) {
  return <RepoDiffViewerLazy key={`${root}/${file}`} path={root} layers={BRANCH_LAYERS} files={[file]} title={file} className="vw-pl-rd" />;
}

/* ── Changes: what the selected session's worktree changed ── */

function SessionChanges({ route, navigate }: ModuleProps) {
  const { model, page } = useProjectsPage(route);
  const ref = pageSessionRef(route);
  const session = useMemo(() => (ref ? findInboxSession(model.sessions, { ...page, sessionId: ref }) : null), [model.sessions, page, ref]);
  const { snapshot, worktrees } = useProjectCheckouts(route);
  const { pullRequests } = usePageProjectPrs(route);
  const wt = session ? worktreeOfSession(session, worktrees) : null;
  const { files, error } = useBranchFiles(wt);
  if (!ref) return <Quiet>Pick a session and what its worktree changed shows here.</Quiet>;
  if (!session) return <Quiet>This thread has no session with a worktree to read.</Quiet>;
  if (!wt) {
    return (
      <Quiet>
        {!snapshot
          ? "Reading changes…"
          : `This session works outside the checkouts Repo Watch reads${session.workspaceRoot ? ` (${shortHomePath(session.workspaceRoot)})` : ""}, so its changes are not known here.`}
      </Quiet>
    );
  }
  const pr = prOfWorktree(wt, pullRequests);
  const file = page.file ?? null;
  const toChange = () => navigate(pr ? previewRoute(page, { pr: pr.number }) : previewRoute(page, { worktree: wt.path }));
  return (
    <div className="vw-code-changes vw-pj-preview">
      <ModuleHead>
        {files ? <span className="hud-grid-count">{files.length}</span> : null}
        <button
          type="button"
          className="vw-chip"
          onClick={() => navigate(file ? codeRouteFor(snapshot, wt.path, `${wt.path}/${file}`) : { view: "repo-diff", path: wt.path })}
          title={file ? "Open this file in Files" : "Open this worktree's diff"}
        >
          Open full
        </button>
      </ModuleHead>
      <div className="vw-code-meta">
        <button type="button" className="vw-pl-link" onClick={toChange} title="Look at this change by worktrees">
          {branchLabel(wt)}
        </button>
        {pr ? <button type="button" className="vw-pl-link" onClick={toChange}>#{pr.number}{pr.isDraft ? " draft" : ""}</button> : null}
        <Churn stat={wt.diff.branchShortstat} />
      </div>
      <ChangedFiles wt={wt} files={files} error={error} file={file} onFile={(path) => navigate(sessionFileRoute(page, path), { replace: true })} />
      {file ? (
        <div className="vw-pj-previewDiff">
          <BranchDiff root={wt.path} file={file} />
        </div>
      ) : null}
    </div>
  );
}

/* ── Branches: the summary, or one change ── */

function Branches({ route, navigate }: ModuleProps) {
  const { model, nowMs, page } = useProjectsPage(route);
  const { slug } = usePanelProject(route, "@route", model);
  const { snapshot, worktrees, pullRequests, error, pr, wt } = useSelectedChange(page);
  const sessions = useMemo(() => (slug ? sessionsForProject(model.sessions, slug) : []), [model.sessions, slug]);
  const madeBy = (target: RepoWatchWorktree | null) => (target ? sessions.filter((s) => worktreeOfSession(s, worktrees) === target) : []);
  const { files, error: filesError } = useBranchFiles(page.pr || page.worktree ? wt : null);

  if (!page.pr && !page.worktree) {
    const prs = [...(pullRequests ?? [])].sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
    const branches = worktrees.filter((item) => isActive(item, nowMs) && !prOfWorktree(item, pullRequests));
    const quiet = worktrees.filter((item) => !isActive(item, nowMs)).length;
    const coins = (target: RepoWatchWorktree | null) => <Coins sessions={madeBy(target)} size={16} />;
    return (
      <div className="vw-pl-summary s-pi">
        <div className="vw-pl-sectionHead"><span>Pull requests</span><b>{pullRequests ? prs.length : ""}</b></div>
        {!pullRequests ? <div className="vw-pl-quiet">{error ? `Couldn't read pull requests: ${error}` : "Reading pull requests…"}</div> : null}
        {pullRequests && prs.length === 0 ? <div className="vw-pl-quiet">No open pull requests.</div> : null}
        {prs.map((item) => {
          const checkout = worktreeOfPr(item, worktrees, snapshot);
          return (
            <button key={item.number} type="button" className="vw-pl-tr" onClick={() => navigate(previewRoute(page, { pr: item.number }))} onDoubleClick={() => window.open(item.url, "_blank", "noopener")}>
              <span className="vw-pl-pr">#{item.number}</span>
              <span className="vw-pl-trTitle"><b>{item.title}</b><em>{item.headRefName}</em></span>
              <span className="vw-pl-trState">{item.isDraft ? "draft" : "open"}</span>
              <span className="vw-pl-trBy">{coins(checkout)}</span>
              <span className="vw-pl-trChurn">{checkout ? <Churn stat={checkout.diff.branchShortstat} /> : <i>not checked out here</i>}</span>
              <span className="vw-pl-age">{item.updatedAt ? timeAgo(Date.parse(item.updatedAt), nowMs) : ""}</span>
            </button>
          );
        })}
        <div className="vw-pl-sectionHead"><span>Branches</span><b>{snapshot ? branches.length : ""}</b></div>
        {!snapshot ? <div className="vw-pl-quiet">Reading worktrees…</div> : null}
        {branches.map((item) => (
          <button key={item.path} type="button" className="vw-pl-tr" onClick={() => navigate(previewRoute(page, { worktree: item.path }))} onDoubleClick={() => navigate({ view: "repo-diff", path: item.path })}>
            <span className="vw-pl-pr" />
            <span className="vw-pl-trTitle"><b className="vw-pl-mono">{branchLabel(item)}</b><em>{shortHomePath(item.path)}</em></span>
            <span className="vw-pl-trState">{item.status.changedFiles > 0 ? `${item.status.changedFiles} file${item.status.changedFiles === 1 ? "" : "s"}` : "clean"}</span>
            <span className="vw-pl-trBy">{coins(item)}</span>
            <span className="vw-pl-trChurn"><Churn stat={item.diff.branchShortstat} /></span>
            <span className="vw-pl-age">{item.lastCommitAt ? timeAgo(item.lastCommitAt, nowMs) : ""}</span>
          </button>
        ))}
        {quiet > 0 ? <div className="vw-pl-quiet">{quiet} more worktrees with nothing recent</div> : null}
      </div>
    );
  }

  const by = madeBy(wt);
  return (
    <div className="vw-code-changes vw-pj-preview">
      <ModuleHead>
        {files ? <span className="hud-grid-count">{files.length}</span> : null}
        <button
          type="button"
          className="vw-chip"
          onClick={() => (pr ? window.open(pr.url, "_blank", "noopener") : wt ? navigate({ view: "repo-diff", path: wt.path }) : undefined)}
          disabled={!pr && !wt}
          title={pr ? "Open this pull request on GitHub" : "Open this worktree's diff"}
        >
          Open full
        </button>
      </ModuleHead>
      <div className="vw-pj-previewHead">
        <span className="vw-pj-previewTitle" title={pr?.title ?? wt?.path}>
          {pr ? <><span className="vw-dim">#{pr.number}</span> {pr.title}</> : wt ? branchLabel(wt) : page.pr ? `#${page.pr}` : ""}
        </span>
        <span className="vw-dim vw-ell">
          {pr ? (pr.baseRefName ? `${pr.headRefName} → ${pr.baseRefName}` : pr.headRefName) : wt ? shortHomePath(wt.path) : ""}
          {pr?.isDraft ? " · draft" : ""}
          {pr?.author ? ` · ${pr.author}` : ""}
          {pr?.updatedAt ? ` · ${timeAgo(Date.parse(pr.updatedAt), nowMs)}` : ""}
        </span>
        {wt ? <Churn stat={wt.diff.branchShortstat} /> : null}
      </div>
      {page.pr && !pr ? (
        <Quiet>{error ? `Couldn't read pull requests: ${error}` : pullRequests ? `#${page.pr} is not an open pull request here.` : "Reading pull requests…"}</Quiet>
      ) : null}
      <div className="vw-pl-sectionHead"><span>Made by</span><b>{by.length || ""}</b></div>
      {by.length ? (
        by.map((s) => (
          <button key={s.id} type="button" className="vw-pl-node" onClick={() => navigate(itemSelectRoute(s, page))} title="Look at this session">
            <HarnessCoin harness={s.harness} size={16} />
            <span className="vw-pl-label">{s.work || s.agentName}</span>
            {s.group !== "recent" ? <span className="pi-rowLiveTag">live</span> : null}
            <span className="vw-pl-age">{timeAgo(s.lastActivityAt, nowMs)}</span>
          </button>
        ))
      ) : (
        <div className="vw-pl-quiet">{wt ? "No session in this project has worked here." : "Not checked out on this host, so no session here made it."}</div>
      )}
      <div className="vw-pl-sectionHead"><span>Changed files</span><b>{files ? files.length : ""}</b></div>
      {wt ? (
        <ChangedFiles wt={wt} files={files} error={filesError} file={page.file ?? null} onFile={(path) => navigate(previewFileRoute(page, path), { replace: true })} />
      ) : pr ? (
        <Quiet>No checkout of {pr.headRefName} on this host, so its files are not read here. Open full shows it on GitHub.</Quiet>
      ) : !snapshot ? (
        <Quiet>Reading changes…</Quiet>
      ) : (
        <Quiet>Repo Watch does not list this checkout yet.</Quiet>
      )}
    </div>
  );
}

/* ── Diff: the picked file of the picked change ── */

function Diff({ route, navigate }: ModuleProps) {
  const { page } = useProjectsPage(route);
  const { snapshot, wt } = useSelectedChange(page);
  const file = page.file ?? null;
  if (!page.pr && !page.worktree) return <Quiet>Pick a pull request or a branch, then a file, and its diff opens here.</Quiet>;
  if (!wt) return <Quiet>No checkout here to read a diff from.</Quiet>;
  if (!file) return <Quiet>Pick a changed file and its diff opens here.</Quiet>;
  const abs = `${wt.path}/${file}`;
  const { name } = splitChangedPath(file);
  return (
    <div className="vw-pl-diff">
      <ModuleHead beside={<span className="vw-dim vw-ell" title={file}>{name}</span>}>
        <button type="button" className="vw-chip" onClick={() => navigate(codeRouteFor(snapshot, wt.path, abs))} title="Open this file in Files">
          Open in Files
        </button>
        <button type="button" className="vw-chip" onClick={() => navigate(previewFileRoute(page, null), { replace: true })} title="Close this diff">
          Close
        </button>
      </ModuleHead>
      <BranchDiff root={wt.path} file={file} />
    </div>
  );
}

/** The sessions behind a row, live first: three coins, then a count of the rest. */
function Coins({ sessions, size }: { sessions: readonly InboxSession[]; size: number }) {
  const shown = [...sessions].sort((a, b) => Number(b.group !== "recent") - Number(a.group !== "recent") || b.lastActivityAt - a.lastActivityAt).slice(0, 3);
  const more = sessions.length - shown.length;
  return (
    <>
      {shown.map((s) => <HarnessCoin key={s.id} harness={s.harness} size={size} className={s.group !== "recent" ? "vw-pl-liveCoin" : undefined} />)}
      {more > 0 ? <span className="vw-pl-more">+{more}</span> : null}
    </>
  );
}

/* ── Thread: what the session says ── */

function ProjectThread({ route, navigate }: ModuleProps) {
  const { model, page } = useProjectsPage(route);
  const ref = pageSessionRef(route);
  const session = useMemo(() => (ref ? findInboxSession(model.sessions, { ...page, sessionId: ref }) : null), [model.sessions, page, ref]);
  if (!ref && route.view === "agents-v2" && route.selectedAgentId) {
    return (
      <div className="vw-pj vw-pj-peek">
        <ProjectsThreadAside route={page} navigate={navigate} />
      </div>
    );
  }
  if (!ref) return <Quiet>Pick a session and its thread opens here.</Quiet>;
  return (
    <div className="vw-pl-thread s-pi">
      <ModuleHead>
        <button type="button" className="vw-chip" onClick={(event) => newTab(event, sessionFullRoute(session, ref)) || navigate(sessionFullRoute(session, ref))} title="Open this session on its own page">
          Open full
        </button>
      </ModuleHead>
      <main className="pi-sessionDetail" aria-label="Session thread">
        <div className="pi-sessionContent">
          <SessionRefScreen key={ref} sessionRef={ref} navigate={navigate} showObserveRail={false} showObserveHeader={false} showSessionSummary={false} />
        </div>
      </main>
    </div>
  );
}

/* ── the modules ── */

export const projectNavModule = defineModule({
  type: "project-nav",
  title: "Project",
  blurb: "Look at a project by its sessions or by its worktrees; the choice drives the page",
  docs: {
    shows: "Sessions (newest live first) or Worktrees (open pull requests, then active branches), one open at a time.",
    data: "useProjectsInbox(); the shared Repo Watch read (30s); the project's open PRs (one read per page).",
    opens: "A session, PR or branch selects it on the page; double-click opens its own page; the heads switch the page between sessions and worktrees.",
  },
  size: { w: 3, h: 36 },
  minSize: { w: 2, h: 10 },
  maxPerView: 1,
  scopes: [projectScope],
  Component: ProjectNav,
});

export const projectThreadModule = defineModule({
  type: "project-thread",
  title: "Thread",
  blurb: "The selected session's thread, read and answered in place",
  docs: {
    shows: "The session's turns, its work folded under each, and the composer; nothing stacked above it. An agent the page peeks (?select=): its card.",
    data: "The session by ref (SessionRefScreen's lookup); its row from useProjectsInbox().",
    opens: "Open full: the session's own page (⌘-click: a new tab).",
  },
  size: { w: 4, h: 36 },
  minSize: { w: 3, h: 10 },
  maxPerView: 1,
  Component: ProjectThread,
});

export const sessionChangesModule = defineModule({
  type: "session-changes",
  title: "Changes",
  blurb: "What the selected session's worktree changed, with a file's diff in place",
  docs: {
    shows: "The session's worktree: branch, its PR, +/- and changed files; the picked file's diff below.",
    data: "The shared Repo Watch read (30s); the session from useProjectsInbox(); the project's open PRs.",
    opens: "The branch or PR: that change, by worktrees; a file: its diff here (?file=); Open full: Files, or the worktree's diff.",
  },
  size: { w: 5, h: 36 },
  minSize: { w: 3, h: 8 },
  Component: SessionChanges,
});

export const projectBranchesModule = defineModule({
  type: "project-branches",
  title: "Worktree",
  blurb: "The worktree or pull request the page picked: who made it and its changed files",
  docs: {
    shows: "The one picked: its head (branch, PR, +/-), the sessions that made it and its changed files. With nothing to pick, every open PR and active branch.",
    data: "The shared Repo Watch read (30s); the project's open PRs; sessions from useProjectsInbox().",
    opens: "A row picks it (?pr= or ?worktree=); a session in Made by opens it by sessions; a file opens its diff in Diff (?file=).",
  },
  size: { w: 4, h: 36 },
  minSize: { w: 3, h: 8 },
  Component: Branches,
});

export const projectDiffModule = defineModule({
  type: "project-diff",
  title: "Diff",
  blurb: "The diff of the file picked in the page's pull request or branch",
  docs: {
    shows: "One file's diff against its branch's merge-base, with what is staged and not yet staged.",
    data: "The branch's diff for that file (/api/repo-diff/worktree: merge-base to HEAD, staged, unstaged), from the checkout the page picked.",
    opens: "Open in Files: the file; Close: the change's file list.",
  },
  size: { w: 5, h: 36 },
  minSize: { w: 3, h: 8 },
  Component: Diff,
});
