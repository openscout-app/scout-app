/**
 * Changes (Projects › Changes) — /repos and /repo-diff on one fixed page.
 *
 * The diff being read is the page. Beside it, the worktree list (a narrow
 * rail of state dots until expanded into the full Repos table) and the
 * selected worktree's details: its state with the Ask composer, the pull
 * requests, and its repository's worktrees. Two layouts and one switch
 * between them (changes-layout.ts); nothing else on the page moves, resizes
 * or reconfigures.
 *
 * Data:   the shared Repo Watch read (use-repo-watch.ts) and the panels'
 *         own reads, unchanged: each part below is the Repos view's module,
 *         drawn in a fixed place instead of on the grid.
 * Opens:  a worktree: /repos?root= (replaced); its diff: /repo-diff?path=.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "../../lib/types.ts";
import type { RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { shortPath } from "../../scout/repo-watch/ui.ts";
import { FOLLOW_PAGE } from "../views/modules/follow-page.ts";
import { prsModule } from "../views/modules/prs.tsx";
import { repoDiffModule } from "../views/modules/repo-diff.tsx";
import { repoWorktreeModule } from "../views/modules/repo-worktree.tsx";
import { diffRoute, listRepoTarget, selectRoute } from "../views/modules/repos-panel.ts";
import { worktreesModule } from "../views/modules/worktrees.tsx";
import {
  CHANGES_LAYOUTS,
  LAYOUT_KEY,
  LIST_KEY,
  parseLayout,
  parseListOpen,
  thinGroups,
  thinReading,
  type ChangesLayout,
} from "./changes-layout.ts";
import { pageRepoTarget } from "./repos-model.ts";
import { ReposScreen } from "./ReposScreen.tsx";
import { repoPagePick, repoWatchStore, useRepoSelection } from "./use-repo-watch.ts";
import "../views/views.css";
import "../views/modules/repos.css";
import "./changes-page.css";

type Navigate = (route: Route, options?: { replace?: boolean }) => void;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts this visit */
  }
}

function useStoredChoice<T>(key: string, parse: (raw: string | null) => T, serialize: (value: T) => string) {
  const [value, setValue] = useState<T>(() => parse(readStored(key)));
  const set = useCallback((next: T) => {
    setValue(next);
    writeStored(key, serialize(next));
  }, [key, serialize]);
  return [value, set] as const;
}

const layoutString = (value: ChangesLayout) => value;
const listString = (open: boolean) => (open ? "open" : "thin");
const noConfig = () => {};

export function ChangesPage({ route, navigate }: { route: Extract<Route, { view: "repos" | "repo-diff" }>; navigate: Navigate }) {
  const [layout, setLayout] = useStoredChoice(LAYOUT_KEY, parseLayout, layoutString);
  const [listOpen, setListOpen] = useStoredChoice(LIST_KEY, parseListOpen, listString);

  // every part reads the page the way the Repos view's panels did
  const follow = useMemo(() => ({ root: FOLLOW_PAGE }), []);
  const followProject = useMemo(() => ({ project: FOLLOW_PAGE }), []);
  const part = { route, navigate, setConfig: noConfig };

  const details = (
    <div className="chg-details" aria-label="Details">
      <section className="chg-section">
        <h2 className="chg-sectionHead">Worktree</h2>
        <repoWorktreeModule.Component instanceId="changes-worktree" config={follow} {...part} />
      </section>
      <section className="chg-section">
        <h2 className="chg-sectionHead">Pull requests</h2>
        <prsModule.Component instanceId="changes-prs" config={followProject} {...part} />
      </section>
      <section className="chg-section">
        <h2 className="chg-sectionHead">Repository</h2>
        <worktreesModule.Component instanceId="changes-worktrees" config={followProject} {...part} />
      </section>
    </div>
  );

  return (
    <div className="chg" data-layout={layout} data-list={listOpen ? "open" : "thin"}>
      <ChangesBar route={route} layout={layout} onLayout={setLayout} />
      <div className="chg-body">
        <aside className="chg-side">
          <ChangesList route={route} navigate={navigate} open={listOpen} onOpen={setListOpen} />
        </aside>
        <div className="chg-work">
          <main className="chg-main" aria-label="Diff">
            <repoDiffModule.Component instanceId="changes-diff" config={follow} {...part} />
          </main>
          {layout === "wide" ? <section className="chg-band">{details}</section> : null}
        </div>
        {layout === "classic" ? <aside className="chg-detailPane">{details}</aside> : null}
      </div>
    </div>
  );
}

/** The page's one line: what is open, Refresh, and the layout switch. */
function ChangesBar({ route, layout, onLayout }: { route: Route; layout: ChangesLayout; onLayout: (layout: ChangesLayout) => void }) {
  const target = useMemo(() => pageRepoTarget(route), [route]);
  const selection = useRepoSelection(target);
  const { refreshing, scanMorePending, refreshedAt } = selection.watch;
  const worktree = selection.worktree;
  const branch = worktree?.branch.name ?? (worktree?.branch.detached ? "detached" : null);
  const receipt = refreshedAt == null ? null : `Fresh ${new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  return (
    <div className="chg-bar">
      <div className="chg-barOpen">
        {worktree ? (
          <>
            <span className="chg-barName" title={worktree.path}>{shortPath(worktree.path)}</span>
            {branch ? <span className="chg-barBranch">{branch}</span> : null}
            {worktree.diff.branchShortstat ? <span className="chg-barStat">{worktree.diff.branchShortstat}</span> : null}
          </>
        ) : (
          <span className="chg-barName chg-dim">No worktree picked</span>
        )}
      </div>
      <button
        type="button"
        className="chg-btn"
        onClick={() => void repoWatchStore.refresh()}
        disabled={refreshing || scanMorePending}
      >
        {refreshing ? "Scanning…" : "Refresh"}
      </button>
      {receipt ? <span className="chg-receipt">{receipt}</span> : null}
      <div className="chg-switch" role="group" aria-label="Layout">
        {CHANGES_LAYOUTS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === layout}
            title={option.title}
            onClick={() => onLayout(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A 16px chevron: right to expand the list, left to collapse it. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25">
      <path d={open ? "M10 4 6 8l4 4" : "M6 4l4 4-4 4"} />
    </svg>
  );
}

/** The worktree list: a narrow rail of state dots by default, the full Repos table when expanded. */
function ChangesList({ route, navigate, open, onOpen }: { route: Route; navigate: Navigate; open: boolean; onOpen: (open: boolean) => void }) {
  const target = useMemo(() => listRepoTarget(route, undefined), [route]);
  const selection = useRepoSelection(target);
  const { snapshot, phase, error } = selection.watch;
  const selectedId = selection.worktree?.id ?? null;
  const groups = useMemo(() => thinGroups(snapshot), [snapshot]);
  const count = groups.reduce((n, group) => n + group.rows.length, 0);

  // the open worktree stays in view in the rail, wherever the sort puts it
  const railRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open || !selectedId) return;
    railRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, selectedId, count]);

  const onSelect = useCallback((worktree: Pick<RepoWatchWorktree, "id" | "path">) => {
    repoPagePick.set(worktree.id);
    const dest = selectRoute(route, worktree.path);
    if (dest) navigate(dest.to, { replace: dest.replace });
  }, [navigate, route]);
  const onViewDiff = useCallback((path: string) => navigate(diffRoute(path)), [navigate]);
  const panel = useMemo(() => ({ target, onSelect, onViewDiff }), [target, onSelect, onViewDiff]);

  if (open) {
    return (
      <div className="chg-list">
        <div className="chg-listHead">
          <h2 className="chg-sectionHead">Worktrees{count ? <span className="chg-count">{count}</span> : null}</h2>
          <button type="button" className="chg-btn chg-iconBtn" aria-expanded="true" title="Back to the rail" aria-label="Collapse the worktree list" onClick={() => onOpen(false)}>
            <Chevron open />
          </button>
        </div>
        <div className="chg-table vw-repos vw-repos-list">
          <ReposScreen navigate={navigate} panel={panel} displayMenu={false} />
        </div>
      </div>
    );
  }

  const quiet = !snapshot
    ? phase === "error" ? `Couldn't read Repo Watch: ${error ?? "no snapshot"}` : "Reading repositories…"
    : count === 0 ? "No repos in the last scan. Expand for the steps to rescan." : null;

  return (
    <div className="chg-list">
      <button
        type="button"
        className="chg-railExpand"
        aria-expanded="false"
        aria-label={`Expand the worktree list (${count})`}
        title="Expand: every worktree with churn, drift, agents, sessions, pull requests and scan coverage"
        onClick={() => onOpen(true)}
      >
        <Chevron open={false} />
        {count ? <span className="chg-railCount">{count}</span> : null}
      </button>
      {quiet ? (
        <div className="chg-railQuiet" title={quiet} aria-label={quiet} role="status">…</div>
      ) : (
        <nav ref={railRef} className="chg-rail" aria-label="Worktrees">
          {groups.map((group) => (
            <div key={group.id} className="chg-railGroup" role="group" aria-label={group.name}>
              {group.rows.map((row) => {
                const reading = thinReading(row);
                const label = [`${group.name} / ${row.name}`, row.branch, reading || "clean", row.agents ? `${row.agents} agent${row.agents === 1 ? "" : "s"}` : null]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="chg-railRow"
                    data-state={row.state}
                    aria-current={row.id === selectedId ? "true" : undefined}
                    aria-label={label}
                    title={label}
                    onClick={() => onSelect(row)}
                  >
                    <span className="chg-dot" aria-hidden="true" />
                    {row.changed ? <span className="chg-railCount" aria-hidden="true">{row.changed}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}

export default ChangesPage;
