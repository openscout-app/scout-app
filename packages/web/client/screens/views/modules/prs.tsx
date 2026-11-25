/**
 * Pull requests — open PRs across the projects your agents work in.
 *
 * Shows:  number, title, head → base branch, last update. Drafts dimmed.
 *         A failed read says so, with Retry.
 *         On /repos and /repo-diff, following the page: the Repos page's
 *         list, every repo's PRs grouped by the selected worktree (its
 *         branch, its repo, the rest), each with its actions.
 * Data:   GET /api/repo-prs (gh on the server) for this machine's agent
 *         project roots, busiest first, up to 12, every 2 minutes. Following
 *         the page: the page project's checkouts (root, worktrees, session
 *         workspaces) from the shared Projects loop instead; on the Repos
 *         routes, each repo's checkout from the shared Repo Watch read, one
 *         gh read shared with the Repos list.
 * Scope:  Project: one repo only, or "This page's project": on
 *         /projects/:slug every checkout of it; on /repos and /repo-diff
 *         every repo, grouped by the selected worktree.
 * Opens:  the PR on GitHub, in a new tab. On the Projects page a click
 *         previews the PR in the Session panel (?pr=); ↑/↓ move it;
 *         double-click, Enter or ⌘-click open it on GitHub; the last row is
 *         the repo's pull requests on GitHub. On the Repos routes a PR's menu:
 *         GitHub, copy, check out, select its worktree (/repos?root=), its
 *         diff (/repo-diff?path=), assign for review (then /follow).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import { fetchRepoPullRequests, type RepoPullRequestItem, type RepoPullRequestSnapshot } from "../../../scout/repo-watch/api.ts";
import { timeAgo } from "../../../lib/time.ts";
import { agentScopes } from "./agents.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { useLocalProjects } from "./projects.tsx";
import { canonicalSlug, isProjectsPage, pageProjectSlug, previewRoute, projectRoots, type ProjectsPageRoute } from "./projects-model.ts";
import { isModifiedClick, useProjectsPage } from "./projects-shared.tsx";
import { isReposRoute } from "./repos-panel.ts";
import { ReposPullRequests } from "./repos-prs.tsx";
import { Quiet, usePolled } from "./shared.tsx";

function PullRequests(props: ModuleProps) {
  if (props.config.project === FOLLOW_PAGE && isReposRoute(props.route)) return <ReposPullRequests {...props} />;
  return props.config.project === FOLLOW_PAGE ? <PageProjectPrs {...props} /> : <LocalPrs root={props.config.project ?? ""} />;
}

function LocalPrs({ root }: { root: string }) {
  // gh runs on this machine, so only this machine's checkouts; busiest first (the server reads at most 12)
  const local = useLocalProjects();
  const roots = root ? [root] : local.rows.map((r) => r.root);
  const key = roots.join("\n");
  if (!local.ready) return <Quiet>Reading projects…</Quiet>;
  if (!roots.length) return <Quiet>No projects to read.</Quiet>;
  return <PrList key={key} roots={roots} />;
}

/*
 * One PR read per project, shared: the list publishes what it reads, and the
 * Projects page's preview reads the same snapshot instead of asking gh again.
 */
const prReads = new Map<string, RepoPullRequestSnapshot>();
const prListeners = new Set<() => void>();
function publishPrs(key: string, snapshot: RepoPullRequestSnapshot) {
  if (prReads.get(key) === snapshot) return;
  prReads.set(key, snapshot);
  for (const listener of prListeners) listener();
}
function subscribePrs(listener: () => void) {
  prListeners.add(listener);
  return () => prListeners.delete(listener);
}

/** The roots the page's project reads PRs from: every checkout of it, up to 12 (the server's cap). */
export function usePageProjectRoots(route: ModuleProps["route"]) {
  const { model, loading, hasData } = useProjectsPage(route);
  const slug = canonicalSlug(model, pageProjectSlug(route));
  const roots = useMemo(() => (slug ? projectRoots(model, slug).slice(0, 12) : []), [model, slug]);
  return { slug, roots, reading: loading && !hasData };
}

/** The page project's open PRs, from the list's read; reads once itself when the list has not yet. */
export function usePageProjectPrs(route: ModuleProps["route"]): { pullRequests: RepoPullRequestItem[] | null; error: string | null } {
  const { roots } = usePageProjectRoots(route);
  const key = roots.join("\n");
  const snapshot = useSyncExternalStore(subscribePrs, () => prReads.get(key) ?? null, () => null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!key || prReads.has(key)) return;
    let live = true;
    fetchRepoPullRequests(roots).then(
      (read) => live && publishPrs(key, read),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { pullRequests: snapshot?.pullRequests ?? null, error };
}

/** The page's project, every checkout of it; a page with no project reads them all. */
function PageProjectPrs({ route, navigate }: ModuleProps) {
  const { page } = useProjectsPage(route);
  const { slug, roots, reading } = usePageProjectRoots(route);
  if (!slug) return <LocalPrs root="" />;
  if (!roots.length) return <Quiet>{reading ? "Reading projects…" : "This project has no checkout to read."}</Quiet>;
  // on the Projects page a click previews the PR in place; elsewhere a row is the PR on GitHub
  const browse = isProjectsPage(route) ? { page, navigate } : undefined;
  return <PrList key={roots.join("\n")} roots={roots} browse={browse} />;
}

type Browse = { page: ProjectsPageRoute; navigate: ModuleProps["navigate"] };

function PrList({ roots, browse }: { roots: string[]; browse?: Browse }) {
  // Retry remounts the read, so it starts over at once
  const [epoch, setEpoch] = useState(0);
  return <PrRows key={epoch} roots={roots} browse={browse} onRetry={() => setEpoch((n) => n + 1)} />;
}

const openPr = (pr: RepoPullRequestItem) => window.open(pr.url, "_blank", "noopener");

/** The repo's pull requests on GitHub, for the list's last row ("" when the URL is not a GitHub PR's). */
function allPrsUrl(pr: RepoPullRequestItem | undefined): string {
  const match = pr?.url.match(/^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/);
  return match ? `${match[1]}/pulls` : "";
}

function PrRows({ roots, onRetry, browse }: { roots: string[]; onRetry: () => void; browse?: Browse }) {
  const { data, error } = usePolled(() => fetchRepoPullRequests(roots), 120_000);
  useEffect(() => {
    if (data) publishPrs(roots.join("\n"), data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) {
    if (!error) return <Quiet>Reading pull requests…</Quiet>;
    return (
      <div className="vw-quiet">
        Couldn't read pull requests.{" "}
        <button type="button" className="vw-chip" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (!data.pullRequests.length) return <Quiet>{data.paths.length ? "No open pull requests." : (data.warnings[0] ?? "No open pull requests.")}</Quiet>;
  const prs = data.pullRequests;
  const selected = browse?.page.pr ?? null;
  const select = (pr: RepoPullRequestItem, replace = false) => browse?.navigate(previewRoute(browse.page, { pr: pr.number }), { replace });
  // a plain click previews in place; ⌘, Ctrl, Shift or a middle click is the link's own (a new tab)
  const onClick = (event: MouseEvent, pr: RepoPullRequestItem) => {
    if (!browse || isModifiedClick(event)) return;
    event.preventDefault();
    select(pr);
  };
  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!browse || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-pr]");
    const at = row ? prs.findIndex((pr) => String(pr.number) === row.dataset.pr) : -1;
    if (event.key === "Enter" && at >= 0) {
      event.preventDefault();
      openPr(prs[at]!);
      return;
    }
    const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
    const next = step ? prs[Math.max(0, Math.min(prs.length - 1, at + step))] : undefined;
    if (!next) return;
    event.preventDefault();
    select(next, true);
    event.currentTarget.querySelector<HTMLElement>(`[data-pr="${next.number}"]`)?.focus();
  };
  const all = allPrsUrl(prs[0]);
  return (
    <ul className="vw-rows" onKeyDown={onKey}>
      {prs.map((pr) => (
        <li key={pr.id}>
          <a
            className={`vw-row vw-row--pr${pr.isDraft ? " is-draft" : ""}`}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-pr={pr.number}
            data-selected={(browse && selected === pr.number) || undefined}
            aria-current={(browse && selected === pr.number) || undefined}
            onClick={(event) => onClick(event, pr)}
            onDoubleClick={browse ? () => openPr(pr) : undefined}
            title={`${pr.repo} #${pr.number}${pr.isDraft ? " · draft" : ""}${pr.author ? ` · ${pr.author}` : ""}`}
          >
            <span className="vw-dim vw-num">#{pr.number}</span>
            <span className="vw-strong vw-ell">{pr.title}</span>
            <span className="vw-dim vw-ell" title={`${pr.headRefName} → ${pr.baseRefName}`}>
              {pr.baseRefName ? `${pr.headRefName} → ${pr.baseRefName}` : pr.headRefName}
            </span>
            <span className="vw-dim vw-num">{pr.updatedAt ? timeAgo(Date.parse(pr.updatedAt)) : ""}</span>
          </a>
        </li>
      ))}
      {browse && all ? (
        <li>
          <a className="vw-pj-more" href={all} target="_blank" rel="noreferrer">
            All pull requests
          </a>
        </li>
      ) : null}
    </ul>
  );
}

export const prsModule = defineModule({
  type: "prs",
  title: "Pull requests",
  blurb: "Open PRs across your agents' projects, or every checkout of this page's project",
  docs: {
    shows: "Open PRs: number, title, head → base, last update; drafts dimmed. On the Repos routes, every repo's PRs grouped by the selected worktree.",
    data: "/api/repo-prs via gh, every 2 min; the page project's checkouts from the shared Projects loop when following the page; on the Repos routes, one read shared with the Repos list.",
    opens: "The PR on GitHub; on the Repos routes its menu: select its worktree, its diff, assign for review.",
  },
  size: { w: 6, h: 9 },
  minSize: { w: 3, h: 4 },
  scopes: agentScopes.filter((s) => s.key === "project"),
  Component: PullRequests,
});
