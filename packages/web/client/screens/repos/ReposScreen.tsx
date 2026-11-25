import { hostFetch } from "../../lib/hosts/host-fleet.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import type { Route } from "../../lib/types.ts";
import { EmptyState } from "../../components/EmptyState.tsx";
import type { RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import RepoWatchTable from "../../scout/repo-watch/RepoWatchTable.tsx";
import RepoWatchDrift from "../../scout/repo-watch/RepoWatchDrift.tsx";
import {
  clearRepoWatchSelection,
  publishRepoWatchSelection,
} from "../../scout/repo-watch/selection-bridge.ts";
import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { RepoDiffViewerLazy } from "../../scout/repo-diff/RepoDiffViewerLazy.tsx";
import { prefetchRepoDiffSnapshots } from "../../scout/repo-diff/cache.ts";
import { ReposOpenPullRequests } from "./ReposOpenPullRequests.tsx";
import { TONES, useReposDisplay, VIEWS } from "./repos-display.ts";
import {
  findById,
  openPullRequestStatTitle,
  prefetchWorktreePaths,
  repoPrPaths,
  type RepoTarget,
} from "./repos-model.ts";
import { repoWatchStore, useRepoPullRequests, useRepoSelection } from "./use-repo-watch.ts";

const DIFF_WARMUP_LIMIT = 12;

/** The Repos view's list panel: the host owns the selection and the diff; its Pull requests panel lists the PRs. */
export type ReposPanelProps = {
  /** What the list selects: the URL on the Repos routes, the panel's own setting elsewhere. */
  target: RepoTarget;
  onSelect: (worktree: RepoWatchWorktree) => void;
  onViewDiff: (path: string) => void;
};

/**
 * Repo Watch / State of Repos (SCO-061) — the live web view.
 *
 * Polls `GET /api/repo-watch` and renders the Fleet Table: every repo and
 * worktree on the machine in one operator-console panel — repos grouped with an
 * indented worktree tree, churn / drift / agents per row, sorted so unfinished
 * work floats to the top. The `--studio-*` / `--status-*` tokens are supplied by
 * `.repo-watch-scope` (see scout/repo-watch/repo-watch.css); the table itself
 * carries its own warm operator-console palette scoped to `.rw-table`.
 */

// SCO-083: Repos lives under Projects, not Ops — no OpsSubnav. Keep the s-ops
// body scroll shell so the sticky context panel still has a scroll container.
function ReposOpsShell({
  panel = false,
  children,
}: {
  navigate: (route: Route) => void;
  /** In a panel the panel body scrolls; no page shell. */
  panel?: boolean;
  children?: ReactNode;
}) {
  if (panel) return <div className="rw-panel-shell">{children}</div>;
  return (
    <div className="s-ops">
      <div className="s-ops-body" style={{ overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

function RepoWatchEmptyNextSteps({ error }: { error?: string | null }) {
  return (
    <div className="rw-empty-next">
      <p className="rw-empty-copy">
        Repos is waiting on the local Scout Services layer. Restart the broker
        from the menu bar app, then rescan.
      </p>
      <ol className="rw-empty-steps">
        <li>
          Click <span className="rw-empty-action-name">Restart broker</span> to
          hand off to the menu bar app.
        </li>
        <li>
          Wait for Scout Services to report the broker online.
        </li>
        <li>
          If nothing opens, run <code>scout doctor</code> and follow the repair
          command it prints.
        </li>
      </ol>
      {error ? <p className="rw-empty-error">{error}</p> : null}
    </div>
  );
}

export function ReposScreen({
  navigate,
  focusRoot = null,
  machineId,
  panel,
  displayMenu = true,
}: {
  navigate: (route: Route, options?: { replace?: boolean }) => void;
  /** Absolute project root to pre-select (deep link from a project surface). */
  focusRoot?: string | null;
  /** The page's ?machineId=, kept when a row replaces ?root=. */
  machineId?: string;
  /** Drawn as the Repos view's list panel instead of the whole page. */
  panel?: ReposPanelProps;
  /** The Display menu (table or drift, tone). Off on the Changes page, which always draws the table. */
  displayMenu?: boolean;
}) {
  // One Repo Watch read for the page (repo-watch-store.ts): a warm start from
  // the last snapshot this session read, a 10s poll while visible, the budget
  // and empty-scan rules, Refresh with its receipt, and Scan more.
  const pageTarget = useMemo<RepoTarget>(
    () => ({ root: focusRoot, mode: "page", leads: true, writes: true }),
    [focusRoot],
  );
  const selection = useRepoSelection(panel?.target ?? pageTarget);
  const { snapshot, phase, error, depth: scanDepth, refreshing, scanMorePending, refreshedAt } = selection.watch;
  const selectedId = selection.worktree?.id ?? null;

  // Tone + view persist to localStorage and are shared by every Repos surface
  // (repos-display.ts); they reach the table and the context pane through the
  // `.rw-scope` wrapper (which carries the tone palette vars).
  const display = useReposDisplay();
  const { setTone, setView } = display;
  const tone = display.tone;
  const view = displayMenu ? display.view : "table";
  const [serviceRestartPending, setServiceRestartPending] = useState(false);
  const [serviceRestartError, setServiceRestartError] = useState<string | null>(null);
  // SCO-065: the worktree path whose diff is open in the slide-in viewer.
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const select = useCallback((id: string) => {
    const worktree = findById(snapshot, id).worktree;
    if (!worktree) return;
    if (panel) {
      panel.onSelect(worktree);
      return;
    }
    // The URL holds the selection, so a link shares it (replaced, like a toggle)
    selection.pick(id);
    navigate({ view: "repos", root: worktree.path, ...(machineId ? { machineId } : {}) }, { replace: true });
  }, [machineId, navigate, panel, selection.pick, snapshot]);
  const viewDiff = panel ? panel.onViewDiff : setDiffPath;

  useEffect(() => {
    if (!snapshot || snapshot.projects.length === 0) return;
    prefetchRepoDiffSnapshots(
      prefetchWorktreePaths(snapshot, selectedId),
      undefined,
      { limit: DIFF_WARMUP_LIMIT },
    );
  }, [snapshot, selectedId]);

  // Open PRs for every repo's checkout, one gh read shared with the Pull
  // requests panel (repo-prs-store.ts).
  const pullRequestPaths = useMemo(
    () => snapshot ? repoPrPaths(snapshot) : [],
    [snapshot],
  );
  const prs = useRepoPullRequests(pullRequestPaths);
  const pullRequests = prs.data;
  const openPullRequestTitle = useMemo(
    () => openPullRequestStatTitle(pullRequests),
    [pullRequests],
  );
  const refreshReceipt = refreshedAt == null ? null : `Fresh ${new Date(refreshedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;

  // The worktree CONTEXT panel lives in the app's global right Inspector rail
  // (see scout/inspector/ReposInspector.tsx). Publish the live selection there
  // rather than re-fetching the snapshot in the rail; clear it on unmount. The
  // Repos view has no inspector: its Worktree panel reads the selection itself.
  useEffect(() => {
    if (panel) return;
    publishRepoWatchSelection({
      worktree: selection.worktree,
      project: selection.project,
      generatedAt: snapshot?.generatedAt ?? 0,
      tone,
    });
  }, [panel, selection.worktree, selection.project, snapshot?.generatedAt, tone]);

  useEffect(() => (panel ? undefined : clearRepoWatchSelection), [panel]);

  const scanMore = useCallback(() => {
    void repoWatchStore.scanMore();
  }, []);

  const scanNow = useCallback(() => {
    void repoWatchStore.refresh();
  }, []);

  const restartBrokerFromMenu = useCallback(async () => {
    if (serviceRestartPending) return;
    setServiceRestartPending(true);
    setServiceRestartError(null);

    try {
      const response = await hostFetch("/api/scout-services/restart-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "broker" }),
      });
      if (!response.ok) {
        throw new Error(`Scout Services link failed (${response.status})`);
      }
      const data = await response.json() as { url?: string };
      if (!data.url?.startsWith("scout://services/restart/")) {
        throw new Error("Scout Services link was not returned.");
      }
      window.location.assign(data.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setServiceRestartError(`${message} Run scout doctor if the menu app did not open.`);
    } finally {
      setServiceRestartPending(false);
    }
  }, [serviceRestartPending]);

  if (phase === "loading") {
    return (
      <ReposOpsShell navigate={navigate} panel={!!panel}>
        <div className="repo-watch-scope" style={{ padding: "24px" }}>
          <EmptyState
            title="Scanning repositories…"
            body="Reading worktree state from the broker."
          />
        </div>
      </ReposOpsShell>
    );
  }

  if (phase === "error" && !snapshot) {
    return (
      <ReposOpsShell navigate={navigate} panel={!!panel}>
        <div className="repo-watch-scope" style={{ padding: "24px" }}>
          <EmptyState
            className="sys-state-card-error"
            title="Couldn’t load Repo Watch"
            body={error ?? "The broker did not return a snapshot."}
            action={
              <button
                type="button"
                className="s-btn"
                onClick={() => void repoWatchStore.retry()}
              >
                Retry
              </button>
            }
          />
        </div>
      </ReposOpsShell>
    );
  }

  if (snapshot && snapshot.projects.length === 0) {
    return (
      <ReposOpsShell navigate={navigate} panel={!!panel}>
        <div className="repo-watch-scope" style={{ padding: "24px" }}>
          <EmptyState
            title="Scout Services need attention"
            body={<RepoWatchEmptyNextSteps error={serviceRestartError} />}
            action={
              <>
                <button
                  type="button"
                  className="s-btn s-btn-primary"
                  onClick={() => void restartBrokerFromMenu()}
                  disabled={serviceRestartPending}
                >
                  {serviceRestartPending ? "Opening…" : "Restart broker"}
                </button>
                <button
                  type="button"
                  className="s-btn"
                  onClick={scanNow}
                  disabled={refreshing || scanMorePending}
                >
                  {refreshing ? "Scanning…" : "Scan again"}
                </button>
                <button
                  type="button"
                  className="s-btn"
                  onClick={scanMore}
                  disabled={refreshing || scanMorePending}
                >
                  {scanMorePending ? "Scanning…" : "Scan more"}
                </button>
              </>
            }
          />
        </div>
      </ReposOpsShell>
    );
  }

  if (!snapshot) return <ReposOpsShell navigate={navigate} panel={!!panel} />;

  return (
    <ReposOpsShell navigate={navigate} panel={!!panel}>
    <div className="repo-watch-scope">
      <div className={"rw-scope tone-" + tone}>
        <div className="rw-page-shell">
          {/* Refresh is the primary action; view/tone live in a minor display menu. */}
          <div className="rw-toolbar">
            <button
              type="button"
              className="rw-refresh-main"
              onClick={scanNow}
              disabled={refreshing || scanMorePending}
            >
              <RefreshCw
                size={14}
                aria-hidden="true"
                className={refreshing ? "rw-refresh-spin" : undefined}
              />
              <span>{refreshing ? "Scanning" : "Refresh"}</span>
            </button>
            {refreshReceipt ? (
              <span className="rw-refresh-receipt">{refreshReceipt}</span>
            ) : null}
            {displayMenu ? (
            <details className="rw-display-menu">
              <summary aria-label="Display options">
                <SlidersHorizontal size={14} aria-hidden="true" />
                <span>Display</span>
              </summary>
              <div className="rw-display-panel">
                <div className="rw-display-row">
                  <span className="rw-display-label">View</span>
                  <div className="rw-tone" role="group" aria-label="View">
                    {VIEWS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={v === view ? "on" : ""}
                        aria-pressed={v === view}
                        onClick={() => setView(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rw-display-row">
                  <span className="rw-display-label">Tone</span>
                  <div className="rw-tone" role="group" aria-label="Console tone">
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={t === tone ? "on" : ""}
                        aria-pressed={t === tone}
                        onClick={() => setTone(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </details>
            ) : null}
          </div>
          {/* The worktree CONTEXT panel now lives in the global Inspector rail
              (scout/inspector/ReposInspector.tsx), so the table/drift view fills
              the full content width here. */}
          <div className="min-w-0">
            {view === "drift" ? (
              <RepoWatchDrift
                snapshot={snapshot}
                selectedId={selectedId}
                onSelect={select}
              />
            ) : (
              <>
                <RepoWatchTable
                  snapshot={snapshot}
                  selectedId={selectedId}
                  onSelect={select}
                  onViewDiff={viewDiff}
                  scanDepth={scanDepth}
                  scanMorePending={scanMorePending}
                  onScanMore={scanMore}
                  openPullRequestCount={pullRequests?.pullRequests.length ?? null}
                  openPullRequestTitle={openPullRequestTitle}
                />
                {panel ? null : (
                  <ReposOpenPullRequests
                    snapshot={pullRequests}
                    loading={prs.loading}
                    error={prs.error}
                    selectedProject={selection.project}
                    selectedWorktree={selection.worktree}
                    repoSnapshot={snapshot}
                    onSelectWorktree={select}
                    onOpenDiff={setDiffPath}
                    navigate={navigate}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* SCO-065 — the diff viewer slides in from the right. Lazy-loaded inside
          the panel so Pierre/Shiki only import when a row's "diff" is clicked. */}
      {panel ? null : (
      <SlidePanel
        open={diffPath != null}
        onClose={() => setDiffPath(null)}
        side="right"
        owner="openscout.repos-diff-viewer"
        resizable
        defaultSize={840}
        maxSize={1280}
        minSize={420}
        ariaLabel="Worktree diff"
      >
      {(dismiss) => <>
        {diffPath != null ? (
          <RepoDiffViewerLazy
            key={diffPath}
            path={diffPath}
            onClose={dismiss}
            onOpenAsPage={() => {
              if (diffPath) {
                navigate({ view: "repo-diff", path: diffPath });
                setDiffPath(null);
              }
            }}
          />
        ) : null}
        </>}
    </SlidePanel>
      )}
    </div>
    </ReposOpsShell>
  );
}

export default ReposScreen;
