/**
 * In flight — every worktree with work on it, across every repo, one line each.
 *
 * Shows:  newest activity first, one line per worktree holding uncommitted
 *         changes, an open or draft PR, or someone on it: project / branch
 *         (project dim), the PR as "#n open" or "#n draft" (or "no PR"), a
 *         churn bar with +add −del (or "clean"), drift ↑ahead ↓behind (or
 *         "even"; underlined when far behind), and who is on it (the first
 *         name, +N) or "quiet <age>". Up to twelve lines, then "+N more".
 * Data:   the shared Repo Watch read (screens/repos/use-repo-watch.ts):
 *         /api/repo-watch every 10s while visible, warm from the last scan,
 *         for every repo it found; open PRs from /api/repo-prs for one
 *         checkout per repo, every 2 min, the same gh read the Repos list
 *         makes. Who is on a worktree is Repo Watch's attachment: agents the
 *         broker reports a state for, and harness sessions by their cwd.
 * Scope:  none; it reads every repo.
 * Opens:  a line: its diff (/repo-diff?path=), or Repos (/repos?root=) when
 *         there is nothing to diff; "+N more" and Repos in the head: /repos.
 */
import { useMemo } from "react";
import { repoPrPaths } from "../../repos/repos-model.ts";
import { useRepoPullRequests, useRepoWatch } from "../../repos/use-repo-watch.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import {
  churnWidth,
  driftLabel,
  IN_FLIGHT_CAP,
  inFlightRows,
  inFlightSummary,
  whoLabel,
  type InFlightRow,
} from "./in-flight-model.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "./in-flight.css";

function Churn({ churn }: { churn: InFlightRow["churn"] }) {
  if (!churn.files) return <span className="vw-if-dim">clean</span>;
  const total = churn.add + churn.del;
  return (
    <span className="vw-if-churn" title={`${churn.files} file${churn.files === 1 ? "" : "s"} · +${churn.add} −${churn.del}`}>
      <span className="vw-if-bar" style={{ width: churnWidth(churn.add, churn.del) }}>
        <i style={{ width: `${total ? Math.round((churn.add / total) * 100) : 0}%` }} />
      </span>
      <span className="vw-if-num">
        +{churn.add} −{churn.del}
      </span>
    </span>
  );
}

function PrCell({ pr }: { pr: InFlightRow["pr"] }) {
  if (!pr) return <span className="vw-if-dim">no PR</span>;
  return (
    <span className="vw-if-pr" title={pr.title}>
      #{pr.number} <em>{pr.state}</em>
    </span>
  );
}

function Line({ row, now, navigate }: { row: InFlightRow; now: number; navigate: ModuleProps["navigate"] }) {
  const drift = driftLabel(row.ahead, row.behind);
  const opensDiff = row.opens.view === "repo-diff";
  return (
    <li>
      <button
        type="button"
        className={`vw-if-row${row.live ? " is-live" : ""}`}
        title={`${row.path}\n${opensDiff ? "Open its diff" : "Open in Repos"}`}
        onClick={() => navigate(row.opens)}
      >
        <span className="vw-if-where">
          <span className="vw-if-dim">{row.project} /</span> {row.branch}
        </span>
        <PrCell pr={row.pr} />
        <Churn churn={row.churn} />
        <span className={drift.far ? "vw-if-drift is-far" : drift.text === "even" ? "vw-if-dim" : "vw-if-drift"} title={drift.far ? "far behind its upstream" : undefined}>
          {drift.text}
        </span>
        <span className="vw-if-who" title={row.on.join("\n") || undefined}>
          {whoLabel(row, now)}
        </span>
      </button>
    </li>
  );
}

function InFlight({ navigate }: ModuleProps) {
  const { snapshot, phase, error } = useRepoWatch();
  const paths = useMemo(() => (snapshot ? repoPrPaths(snapshot) : []), [snapshot]);
  const prs = useRepoPullRequests(paths);
  const rows = useMemo(() => inFlightRows(snapshot, prs.data?.pullRequests), [snapshot, prs.data]);
  const shown = rows.slice(0, IN_FLIGHT_CAP);
  const more = rows.length - shown.length;
  const now = snapshot?.generatedAt ?? Date.now();
  if (!snapshot) return <Quiet>{phase === "error" ? `Couldn't read Repo Watch: ${error ?? "no snapshot"}` : "Reading repositories…"}</Quiet>;
  return (
    <div className="vw-if">
      <ModuleHead>
        <span className="hud-grid-count">{rows.length}</span>
        <button type="button" className="vw-chip" title="Every repo and worktree in Repos" onClick={() => navigate({ view: "repos" })}>
          Repos
        </button>
      </ModuleHead>
      {rows.length === 0 ? (
        <Quiet>Nothing in flight: no uncommitted work, open PRs or agents on any worktree.</Quiet>
      ) : (
        <>
          <div className="vw-if-line">{inFlightSummary(rows)} · newest first</div>
          <ul className="vw-if-rows">
            {shown.map((row) => (
              <Line key={row.id} row={row} now={now} navigate={navigate} />
            ))}
          </ul>
          {more > 0 ? (
            <button type="button" className="vw-if-more" onClick={() => navigate({ view: "repos" })}>
              +{more} more in Repos
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export const inFlightWorktreesModule = defineModule({
  type: "worktrees-in-flight",
  title: "Worktrees in flight",
  blurb: "Every worktree with work on it, across every repo: branch, PR, diff, drift and who is on it",
  docs: {
    shows: "One line per worktree with uncommitted changes, an open or draft PR, or someone on it, newest first: project / branch, PR, churn, drift, who is on it or how long it has been quiet. Twelve, then +N more.",
    data: "The shared Repo Watch read (/api/repo-watch, 10s) for every repo; /api/repo-prs for one checkout per repo, 2 min, shared with the Repos list.",
    opens: "A line: its diff (/repo-diff?path=), or Repos when there is nothing to diff; +N more and Repos: /repos.",
  },
  size: { w: 7, h: 14 },
  // project / branch, PR and who; churn and drift drop out narrow
  minSize: { w: 4, h: 5 },
  fit: true,
  Component: InFlight,
});
