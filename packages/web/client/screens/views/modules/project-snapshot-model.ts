/**
 * Projects › Overview: the pure reads behind the snapshot panel (project-snapshot.tsx), so they test without a DOM.
 * Every count here is computed from a read; a read that failed stays null and the panel says so.
 */
import type { CanvasData, CanvasItem } from "../../../../shared/canvas.ts";
import type { ProjectSnapshot, ProjectSnapshotPullRequest } from "../../../../shared/project-snapshot.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import type { RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import type { SessionItem } from "./projects-model.ts";

/** A path with the home directory as "~" and no trailing slash, so "~/dev/x" and "/example/me/dev/x" compare. */
const homeForm = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~").replace(/\/+$/, "");

const within = (path: string, root: string) => {
  const p = homeForm(path);
  const r = homeForm(root);
  return p === r || p.startsWith(`${r}/`);
};

/**
 * The open requests that belong to this project: a permission asked inside one of its roots, or a request from an
 * agent or conversation that one of its sessions carries. Oldest first, since the oldest has waited longest.
 */
export function requestsForProject(
  items: readonly OperatorAttentionItem[],
  roots: readonly string[],
  sessions: readonly Pick<SessionItem, "agentId" | "conversationId">[],
): OperatorAttentionItem[] {
  const agents = new Set(sessions.map((s) => s.agentId).filter((id): id is string => Boolean(id)));
  const conversations = new Set(sessions.map((s) => s.conversationId).filter((id): id is string => Boolean(id)));
  return items
    .filter((item) => {
      const root = item.permission?.projectRoot;
      if (root && roots.some((r) => within(root, r))) return true;
      if (item.agentId && agents.has(item.agentId)) return true;
      return Boolean(item.conversationId && conversations.has(item.conversationId));
    })
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/** Live sessions first, newest first; then the most recent quiet ones, up to `limit` rows in all. */
export function workingRows(items: readonly SessionItem[], limit = 4): { rows: SessionItem[]; live: number } {
  const byNewest = [...items].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const live = byNewest.filter((item) => item.group !== "recent");
  const quiet = byNewest.filter((item) => item.group === "recent");
  return { rows: [...live, ...quiet].slice(0, Math.max(limit, live.length)), live: live.length };
}

/** Open pull requests split for the In review pane: ready ones (newest first) and the count of drafts. */
export function reviewRows(prs: readonly ProjectSnapshotPullRequest[]): { ready: ProjectSnapshotPullRequest[]; drafts: number } {
  const ready = prs.filter((pr) => !pr.isDraft).sort((a, b) => b.createdAt - a.createdAt);
  return { ready, drafts: prs.length - ready.length };
}

/** Lines added and removed across merges. */
export function churn(rows: readonly { additions: number; deletions: number }[]): { additions: number; deletions: number } {
  return rows.reduce((sum, row) => ({ additions: sum.additions + row.additions, deletions: sum.deletions + row.deletions }), { additions: 0, deletions: 0 });
}

/**
 * The canvas items one project holds. The canvas names a project by its repository's folder ("demo-app"), which
 * may not be the project's own folder ("openscout"), and files an item under the agent that made it; so an item is
 * this project's when its agent's project is one of `names`.
 */
export function canvasForProject(data: CanvasData | null, names: readonly string[]): { images: CanvasItem[]; total: number; shown: number; name: string | null } | null {
  if (!data) return null;
  const wanted = new Set(names);
  const items = data.items.filter((item) => wanted.has(data.agents[item.agent]?.project ?? ""));
  const images = items.filter((item) => item.kind === "image").sort((a, b) => b.at - a.at);
  const name = names.find((n) => data.projects.some((project) => project.name === n)) ?? null;
  return { images, total: items.length, shown: items.filter((item) => item.how === "shown").length, name };
}

/** What the worktrees pane says about the project's checkouts: how many, and how many hold uncommitted work. */
export function worktreeCounts(worktrees: readonly RepoWatchWorktree[]): { total: number; uncommitted: number; withSession: number } {
  return {
    total: worktrees.length,
    uncommitted: worktrees.filter((wt) => wt.status.changedFiles > 0).length,
    withSession: worktrees.filter((wt) => wt.sessions.length > 0).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The line over the page when the project root's own checkout of the default branch has drifted: commits that are
 * not on origin, or uncommitted files. A feature branch checked out there is ordinary work, so it raises nothing.
 */
export function checkoutAlert(snapshot: Pick<ProjectSnapshot, "main" | "checkout"> | null): string | null {
  const checkout = snapshot?.checkout;
  const main = snapshot?.main;
  if (!checkout || !main || !checkout.branch) return null;
  const mainBranch = main.ref.replace(/^origin\//, "");
  if (checkout.branch !== mainBranch) return null;
  const parts: string[] = [];
  if (checkout.ahead > 0) parts.push(`${plural(checkout.ahead, "commit", "commits")} that ${checkout.ahead === 1 ? "is" : "are"} not on ${main.ref}`);
  if (checkout.uncommitted > 0) parts.push(plural(checkout.uncommitted, "uncommitted file", "uncommitted files"));
  if (!parts.length) return null;
  return `Your checkout of ${mainBranch} has ${parts.join(", and ")}`;
}

/** Bytes as GiB with one decimal under 100, whole above. */
export function gib(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value < 100 ? value.toFixed(1) : Math.round(value).toString();
}

/** Free space below this share of the disk is worth a warning. */
export const LOW_DISK_SHARE = 0.05;
