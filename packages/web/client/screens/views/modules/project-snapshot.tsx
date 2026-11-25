/**
 * Overview — a project at a glance, and the way into each of its pages.
 *
 * Shows:  the project's name, root, host and where main is; a line when the
 *         root's own checkout of main has drifted; five counts (waiting on
 *         you, working now, pull requests, landed in 24 hours, canvas); then
 *         Waiting on you over Working now, In review over Landed, and Canvas
 *         over a quiet Sessions and worktrees module with the host's free disk.
 * Data:   GET /api/project-snapshot (main, the root's checkout, open and
 *         merged pull requests, disk; 60s); the shared Projects loop
 *         (sessions); the shared Repo Watch read (worktrees, 30s); the open
 *         requests store; the canvas read (/api/ops/canvas, two days, when
 *         Canvas is on). Every count is computed from those reads.
 * Scope:  Project, by slug ("This page's project" follows /projects/:slug).
 * Opens:  a request opens it in Requests; a session selects it by sessions; a
 *         pull request previews it by worktrees; a merge opens on GitHub; By
 *         sessions and By worktrees switch the page's look; the drift line
 *         opens Changes for the root; Canvas opens the project's canvas.
 *         ⌘-click opens a new tab.
 */
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { CanvasData, CanvasItem } from "../../../../shared/canvas.ts";
import type { ProjectSnapshot } from "../../../../shared/project-snapshot.ts";
import { HarnessCoin } from "../../../components/HarnessCoin.tsx";
import { api } from "../../../lib/api.ts";
import { isCanvasEnabled } from "../../../lib/feature-flags.ts";
import { timeAgo, timeAgoWithSuffix } from "../../../lib/time.ts";
import type { Route } from "../../../lib/types.ts";
import { useOperatorRequests } from "../../../lib/use-operator-requests.ts";
import { shortHomePath } from "../../projects/project-overview-helpers.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { useProjectCheckouts } from "./project-look.tsx";
import {
  LOW_DISK_SHARE,
  canvasForProject,
  checkoutAlert,
  churn,
  gib,
  requestsForProject,
  reviewRows,
  workingRows,
  worktreeCounts,
} from "./project-snapshot-model.ts";
import { itemSelectRoute, lookByRoute, previewRoute, sessionItems } from "./projects-model.ts";
import { isModifiedClick, openRouteInNewTab, projectScope, usePanelProject, useProjectsPage } from "./projects-shared.tsx";
import { Quiet, baseName } from "./shared.tsx";
import "./project-snapshot.css";

const SNAPSHOT_EVERY_MS = 60_000;
const CANVAS_EVERY_MS = 120_000;
const CANVAS_DAYS = 2;

/** The project's snapshot, read again every minute while the page is visible; keeps the last good read through a failure. */
function useProjectSnapshot(root: string | null) {
  const [read, setRead] = useState<{ root: string; snapshot: ProjectSnapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return;
    let live = true;
    const load = () =>
      api<ProjectSnapshot>(`/api/project-snapshot?path=${encodeURIComponent(root)}`).then(
        (snapshot) => live && (setRead({ root, snapshot }), setError(null)),
        (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    void load();
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), SNAPSHOT_EVERY_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [root]);
  return { snapshot: read && read.root === root ? read.snapshot : null, error };
}

/** The canvas read, when Canvas is on; null while it reads or when it is off. */
function useCanvas(enabled: boolean) {
  const [data, setData] = useState<CanvasData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => api<CanvasData>(`/api/ops/canvas?days=${CANVAS_DAYS}`, { cache: "no-store" }).then((d) => live && setData(d), () => undefined);
    void load();
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), CANVAS_EVERY_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [enabled]);
  return data;
}

const canvasFile = (path: string) => `/api/ops/canvas-file?p=${encodeURIComponent(path)}&as=raw`;
const n = (value: number) => value.toLocaleString("en-US");

function Arrow() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden className="vw-ps-arrow">
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Go = (route: Route, event: MouseEvent) => void;

function Pane({ title, count, to, onTo, quiet, children }: { title: string; count?: number | null; to?: string; onTo?: (event: MouseEvent) => void; quiet?: boolean; children: ReactNode }) {
  return (
    <section className="vw-ps-pane" data-quiet={quiet || undefined}>
      <div className="vw-ps-paneHead">
        <span className="vw-ps-paneTitle">{title}</span>
        {count ? <span className="vw-ps-paneCount">{n(count)}</span> : null}
        {to && onTo ? (
          <button type="button" className="vw-ps-paneGo" onClick={onTo}>
            {to} <Arrow />
          </button>
        ) : null}
      </div>
      <div className="vw-ps-paneBody">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="vw-ps-empty">{children}</p>;
}

function Churn({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="vw-ps-churn">
      <b>+{n(additions)}</b> <i>−{n(deletions)}</i>
    </span>
  );
}

function ProjectSnapshotPanel({ route, navigate, config }: ModuleProps) {
  const { model, nowMs, page, loading, hasData } = useProjectsPage(route);
  const { slug, project } = usePanelProject(route, config.project, model);
  const { snapshot: repoWatch, worktrees } = useProjectCheckouts(route);
  // git and gh read the project's main checkout, once Repo Watch names it: a project whose root only holds its
  // repos has no git of its own. The canvas and the page head keep the project's own folder.
  const mainCheckout = worktrees.find((wt) => wt.branch.isMain)?.path ?? null;
  const root = repoWatch ? (mainCheckout ?? project?.root ?? null) : null;
  const folder = project?.root ?? null;
  const { snapshot, error } = useProjectSnapshot(root);
  const requests = useOperatorRequests();
  const canvasOn = isCanvasEnabled();
  const canvasData = useCanvas(canvasOn);

  const sessions = useMemo(() => sessionItems(model, slug, ""), [model, slug]);
  const threads = useMemo(() => (slug ? model.threads.filter((thread) => thread.projectSlug === slug) : []), [model.threads, slug]);
  const roots = useMemo(() => {
    const all = [folder, root, ...worktrees.map((wt) => wt.path), ...(project?.worktrees ?? []).map((wt) => wt.root)];
    return [...new Set(all.filter((r): r is string => Boolean(r)))];
  }, [folder, project, root, worktrees]);
  const waiting = useMemo(() => requestsForProject(requests.state?.items ?? [], roots, [...sessions, ...threads]), [requests.state, roots, sessions, threads]);
  const working = useMemo(() => workingRows(sessions), [sessions]);
  const review = useMemo(() => reviewRows(snapshot?.pullRequests ?? []), [snapshot]);
  const canvasNames = useMemo(
    () => [...new Set([...worktrees.filter((wt) => wt.branch.isMain).map((wt) => baseName(wt.path)), ...(folder ? [baseName(folder)] : [])])],
    [folder, worktrees],
  );
  const canvas = useMemo(() => canvasForProject(canvasData, canvasNames), [canvasData, canvasNames]);
  const checkouts = worktreeCounts(worktrees);

  const go: Go = (to, event) => (isModifiedClick(event) ? openRouteInNewTab(to) : navigate(to));
  const bySessions = (event: MouseEvent) => go(lookByRoute(page, "sessions"), event);
  const byWorktrees = (event: MouseEvent) => go(lookByRoute(page, "worktrees"), event);
  const toChanges = (event: MouseEvent) => go({ view: "repos", ...(root ? { root } : {}) }, event);
  const toCanvas = (event: MouseEvent) => go({ view: "canvas", ...(canvas?.name ? { project: canvas.name } : {}) }, event);
  const toRequests = (event: MouseEvent) => go({ view: "requests" }, event);
  const openUrl = (url: string) => window.open(url, "_blank", "noopener");

  if (!slug) return <Quiet>Pick a project to see its overview.</Quiet>;
  if (!project) return <Quiet>{loading && !hasData ? "Reading projects…" : "This project is not on this host."}</Quiet>;

  const alert = checkoutAlert(snapshot);
  const merged = snapshot?.merged ?? null;
  const prs = snapshot?.pullRequests ?? null;
  const landed = merged ? churn(merged) : null;
  const disk = snapshot?.disk ?? null;
  const freeShare = disk && disk.totalBytes > 0 ? disk.availableBytes / disk.totalBytes : null;
  const oldest = waiting[0] ?? null;
  const readingSnapshot = !snapshot && !error;
  const unread = (what: string) => (readingSnapshot ? "Reading…" : `Could not read ${what}.`);

  const cells: { label: string; value: number | null; detail: string; onClick: (event: MouseEvent) => void; hot?: boolean }[] = [
    {
      label: "Waiting on you",
      value: waiting.length,
      detail: oldest ? `oldest ${timeAgo(oldest.updatedAt, nowMs)}` : "nothing to answer",
      onClick: toRequests,
      hot: waiting.length > 0,
    },
    {
      label: "Working now",
      value: working.live,
      detail: sessions.length ? `${n(sessions.length)} ${sessions.length === 1 ? "session" : "sessions"} in this project` : "no sessions yet",
      onClick: bySessions,
    },
    {
      label: "Pull requests",
      value: prs ? prs.length : null,
      detail: prs ? (prs.length ? `${n(review.ready.length)} ready, ${n(review.drafts)} ${review.drafts === 1 ? "draft" : "drafts"}` : "none open") : unread("pull requests"),
      onClick: byWorktrees,
    },
    {
      label: "Landed in 24 hours",
      value: merged ? merged.length : null,
      detail: merged ? (merged.length && landed ? `+${n(landed.additions)} −${n(landed.deletions)} on main` : "nothing merged") : unread("merges"),
      onClick: toChanges,
    },
  ];
  if (canvasOn) {
    cells.push({
      label: "Canvas",
      value: canvas ? canvas.total : null,
      detail: canvas ? (canvas.total ? (canvas.shown ? `${n(canvas.shown)} shown on purpose` : `in the last ${CANVAS_DAYS} days`) : "nothing made yet") : "Reading…",
      onClick: toCanvas,
    });
  }

  return (
    <div className="vw-ps">
      <header className="vw-ps-head">
        <h2 className="vw-ps-title">{project.title}</h2>
        <div className="vw-ps-subline">
          <span>{shortHomePath(folder ?? root)}</span>
          {snapshot ? (
            <>
              <span className="vw-ps-dot" />
              <span>{snapshot.host}</span>
            </>
          ) : null}
          {snapshot?.main ? (
            <>
              <span className="vw-ps-dot" />
              <span title={snapshot.main.subject}>
                {snapshot.main.ref.replace(/^origin\//, "")} at <code>{snapshot.main.sha}</code>, {timeAgoWithSuffix(snapshot.main.at, nowMs)}
              </span>
            </>
          ) : null}
        </div>
        {alert ? (
          <button type="button" className="vw-ps-alert" onClick={toChanges}>
            <span className="vw-ps-alertMark" />
            <span className="vw-ps-alertText">{alert}</span>
            <span className="vw-ps-alertGo">
              Changes <Arrow />
            </span>
          </button>
        ) : null}
      </header>

      <div className="vw-ps-glance">
        {cells.map((cell) => (
          <button key={cell.label} type="button" className="vw-ps-cell" data-hot={cell.hot || undefined} onClick={cell.onClick}>
            <span className="vw-ps-cellLabel">{cell.label}</span>
            <span className="vw-ps-cellValue">{cell.value == null ? "—" : n(cell.value)}</span>
            <span className="vw-ps-cellDetail">{cell.detail}</span>
          </button>
        ))}
      </div>

      <div className="vw-ps-grid">
        <div className="vw-ps-col">
          <Pane title="Waiting on you" count={waiting.length} to="Requests" onTo={toRequests}>
            {waiting.length === 0 ? (
              <Empty>Nothing here waits on you. Questions and approvals from this project's agents land here first.</Empty>
            ) : (
              waiting.slice(0, 5).map((item) => (
                <button key={item.id} type="button" className="vw-ps-row" onClick={(event) => go({ view: "requests", requestId: item.id }, event)}>
                  <span className="vw-ps-rowText">
                    <span className="vw-ps-rowTitle">{item.title}</span>
                    <span className="vw-ps-rowMeta">{item.summary ?? item.agentName ?? item.sourceLabel}</span>
                  </span>
                  <span className="vw-ps-age">{timeAgo(item.updatedAt, nowMs)}</span>
                </button>
              ))
            )}
          </Pane>
          <Pane title="Working now" count={working.live} to="By sessions" onTo={bySessions}>
            {sessions.length === 0 ? (
              <Empty>No agent has worked here yet. A session started in this folder shows up here while it runs.</Empty>
            ) : (
              <>
                {working.live === 0 ? <div className="vw-ps-quietLine">No agent is working right now. Last active:</div> : null}
                {working.rows.map((item) => (
                  <button key={item.id} type="button" className="vw-ps-row" data-live={item.group !== "recent" || undefined} onClick={(event) => go(itemSelectRoute(item, page), event)}>
                    <HarnessCoin harness={item.harness} size={18} />
                    <span className="vw-ps-rowText">
                      <span className="vw-ps-rowTitle">{item.work || item.agentName}</span>
                      {item.branch ? <span className="vw-ps-rowMeta">{item.branch}</span> : null}
                    </span>
                    {item.group !== "recent" ? <span className="vw-ps-liveDot" aria-label="working" /> : null}
                    <span className="vw-ps-age">{timeAgo(item.lastActivityAt, nowMs)}</span>
                  </button>
                ))}
              </>
            )}
          </Pane>
        </div>

        <div className="vw-ps-col">
          <Pane title="In review" count={prs?.length} to="By worktrees" onTo={byWorktrees}>
            {!prs ? (
              <Empty>{unread("this project's pull requests")}</Empty>
            ) : prs.length === 0 ? (
              <Empty>No pull requests are open from this project.</Empty>
            ) : (
              <>
                {review.ready.slice(0, 4).map((pr) => (
                  <button key={pr.number} type="button" className="vw-ps-row" onClick={(event) => go(previewRoute(page, { pr: pr.number }), event)}>
                    <span className="vw-ps-rowText">
                      <span className="vw-ps-rowTitle">
                        <span className="vw-ps-ref">#{pr.number}</span>
                        {pr.title}
                      </span>
                      <span className="vw-ps-rowMeta">
                        <Churn additions={pr.additions} deletions={pr.deletions} />
                        {pr.mergeable === "CONFLICTING" ? <span> · conflicts with main</span> : null}
                        {pr.reviewDecision === "APPROVED" ? <span> · approved</span> : null}
                        {pr.reviewDecision === "CHANGES_REQUESTED" ? <span> · changes requested</span> : null}
                      </span>
                    </span>
                    <span className="vw-ps-age">{timeAgo(pr.createdAt, nowMs)}</span>
                  </button>
                ))}
                {review.ready.length > 4 || review.drafts > 0 ? (
                  <button type="button" className="vw-ps-fold" onClick={byWorktrees}>
                    {[review.ready.length > 4 ? `${n(review.ready.length - 4)} more ready` : null, review.drafts > 0 ? `${n(review.drafts)} ${review.drafts === 1 ? "draft" : "drafts"}` : null]
                      .filter(Boolean)
                      .join(", ")}{" "}
                    <Arrow />
                  </button>
                ) : null}
              </>
            )}
          </Pane>
          <Pane title="Landed" count={merged?.length} to="Changes" onTo={toChanges}>
            {!merged ? (
              <Empty>{unread("this project's merges")}</Empty>
            ) : merged.length === 0 ? (
              <Empty>Nothing has merged to main in the last 24 hours.</Empty>
            ) : (
              merged.slice(0, 5).map((merge) => (
                <button key={merge.number} type="button" className="vw-ps-row" title="Open on GitHub" onClick={() => openUrl(merge.url)}>
                  <span className="vw-ps-rowText">
                    <span className="vw-ps-rowTitle">
                      <span className="vw-ps-ref">#{merge.number}</span>
                      {merge.title}
                    </span>
                    <span className="vw-ps-rowMeta">
                      <Churn additions={merge.additions} deletions={merge.deletions} />
                    </span>
                  </span>
                  <span className="vw-ps-age">{timeAgo(merge.mergedAt, nowMs)}</span>
                </button>
              ))
            )}
          </Pane>
        </div>

        <div className="vw-ps-col">
          {canvasOn ? (
            <Pane title="Canvas" count={canvas?.total} to="Workspace" onTo={toCanvas}>
              {!canvas ? (
                <Empty>Reading…</Empty>
              ) : canvas.total === 0 ? (
                <Empty>Pictures, captures and pages that agents make or show in this project collect here.</Empty>
              ) : (
                <>
                  {canvas.images.length ? (
                    <div className="vw-ps-thumbs">
                      {canvas.images.slice(0, 4).map((item: CanvasItem) => (
                        <button key={item.key} type="button" className="vw-ps-thumb" onClick={toCanvas} title={item.caption ?? item.name}>
                          <img src={canvasFile(item.path)} alt={item.caption ?? item.name} loading="lazy" />
                          <span className="vw-ps-thumbCap">
                            <span>{item.name}</span>
                            <span className="vw-ps-age">{timeAgo(item.at, nowMs)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="vw-ps-quietLine">
                    {n(canvas.total)} {canvas.total === 1 ? "item" : "items"} in the last {CANVAS_DAYS} days
                    {canvas.shown ? `, ${n(canvas.shown)} shown on purpose` : ""}
                  </div>
                </>
              )}
            </Pane>
          ) : null}
          <Pane title="Sessions and worktrees" quiet>
            <div className="vw-ps-struct">
              <span className="vw-ps-structMain">
                {n(sessions.length)} {sessions.length === 1 ? "session" : "sessions"}
              </span>
              <span className="vw-ps-structMeta">{n(working.live)} working</span>
              <button type="button" className="vw-ps-structGo" onClick={bySessions}>
                By sessions <Arrow />
              </button>
            </div>
            <div className="vw-ps-struct">
              <span className="vw-ps-structMain">
                {n(checkouts.total)} {checkouts.total === 1 ? "worktree" : "worktrees"}
              </span>
              <span className="vw-ps-structMeta">
                {checkouts.total === 0 ? "none read yet" : `${n(checkouts.uncommitted)} with uncommitted work, ${n(checkouts.withSession)} with a session`}
              </span>
              <button type="button" className="vw-ps-structGo" onClick={byWorktrees}>
                By worktrees <Arrow />
              </button>
            </div>
            <div className="vw-ps-struct">
              {disk && freeShare != null ? (
                <>
                  <span className="vw-ps-structMain">{gib(disk.availableBytes)} GiB free</span>
                  <span className="vw-ps-structMeta" data-warn={freeShare < LOW_DISK_SHARE || undefined}>
                    {Math.round(freeShare * 100)}% of {snapshot?.host ?? "this host"}'s disk
                  </span>
                </>
              ) : (
                <span className="vw-ps-structMeta">{readingSnapshot ? "Reading disk…" : "Could not read the disk."}</span>
              )}
            </div>
            {error ? <div className="vw-ps-quietLine">Could not read this project's snapshot: {error}</div> : null}
            {snapshot?.warnings.length ? <div className="vw-ps-quietLine">{snapshot.warnings.join(" · ")}</div> : null}
          </Pane>
        </div>
      </div>
    </div>
  );
}

export const projectSnapshotModule = defineModule({
  type: "project-snapshot",
  title: "Overview",
  blurb: "A project at a glance: what waits on you, what is working, what is in review and what landed",
  docs: {
    shows: "The project's head and drift line, five counts, then Waiting on you, Working now, In review, Landed, Canvas, and its sessions, worktrees and disk.",
    data: "/api/project-snapshot (60s); useProjectsInbox(); the shared Repo Watch read (30s); the requests store; /api/ops/canvas when Canvas is on.",
    opens: "Each pane opens the page that holds its detail: Requests, the page by sessions or by worktrees, Changes, Canvas, or GitHub for a merge.",
  },
  size: { w: 12, h: 36 },
  minSize: { w: 4, h: 12 },
  maxPerView: 1,
  scopes: [projectScope],
  Component: ProjectSnapshotPanel,
});
