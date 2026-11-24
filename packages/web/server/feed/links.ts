/** Turn identity and PR metadata. Only turn identity joins records. */
import type { WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";
import { pullKey, pullRefs, worktreeName } from "./feed-refs.ts";

/** Limit the PR metadata promoted out of a roll-up. Never used for grouping. */
export const MAX_LEAD_PULLS = 3;

export type LinkContext = {
  pulls: ReadonlyMap<string, WebFeedPull>;
  /** Pull requests by "repo:branch". */
  pullsByBranch: ReadonlyMap<string, readonly string[]>;
  /** Each project root's GitHub repository. */
  repos: Readonly<Record<string, string>>;
};

export function linkContext(pulls: readonly WebFeedPull[], repos: Record<string, string>): LinkContext {
  const byKey = new Map(pulls.map((p) => [p.key, p]));
  const byBranch = new Map<string, string[]>();
  for (const pull of [...pulls].sort((a,b) => (b.at ?? 0) - (a.at ?? 0) || a.key.localeCompare(b.key))) {
    const key = `${pull.repo}:${pull.head}`;
    byBranch.set(key, [...(byBranch.get(key) ?? []), pull.key]);
  }
  return { pulls: byKey, pullsByBranch: byBranch, repos };
}

/** Checkouts a root may be a worktree of: any, unless both name a repository and they differ (`project` is not a worktree of `scout`). */
export function sameRepoMains(root: string | null, repos: Readonly<Record<string, string>>): string[] {
  const mine = root ? repos[root] : undefined;
  return Object.keys(repos).filter((main) => !mine || repos[main] === mine);
}

/** The branch a task worked on: the endpoint's own record, else its worktree's name. Never "main". */
export function taskBranch(task: Pick<WebFeedTask, "branch" | "cwd" | "projectRoot">, repos: Readonly<Record<string, string>>): string | null {
  const recorded = task.branch && task.branch !== "main" && task.branch !== "master" ? task.branch : null;
  return recorded ?? worktreeName(task.cwd ?? task.projectRoot, sameRepoMains(task.projectRoot, repos));
}

export function taskRepo(task: Pick<WebFeedTask, "projectRoot">, repos: Readonly<Record<string, string>>): string | null {
  return task.projectRoot ? repos[task.projectRoot] ?? null : null;
}

/** The pull requests a task is linked to, known to GitHub: the ones its ask or reply names, and the ones on its branch. */
export function taskPulls(task: WebFeedTask, ctx: LinkContext): string[] {
  const repo = taskRepo(task, ctx.repos);
  const keys = new Set<string>();
  // The ask names the PR a review is for; the reply names the PRs a build opened.
  for (const ref of pullRefs(`${task.title}\n${task.reply ?? ""}`, repo)) if (ref.repo) keys.add(pullKey(ref.repo, ref.number));
  const branch = taskBranch(task, ctx.repos);
  if (branch && repo) for (const key of ctx.pullsByBranch.get(`${repo}:${branch}`) ?? []) keys.add(key);
  return [...keys].filter((key) => ctx.pulls.has(key));
}

/**
 * The pull requests a turn made, most certain first: the ones on its branch,
 * else the ones its reply names, else the ones its ask names. The ask often
 * names earlier work only as context ("after the earlier review"), so it is the last resort.
 */
export function turnPulls(task: WebFeedTask, ctx: LinkContext): string[] {
  const repo = taskRepo(task, ctx.repos);
  const known = (keys: Iterable<string>) => [...new Set(keys)].filter((key) => ctx.pulls.has(key));
  const branch = taskBranch(task, ctx.repos);
  const onBranch = branch && repo ? known(ctx.pullsByBranch.get(`${repo}:${branch}`) ?? []) : [];
  if (onBranch.length) return onBranch;
  const named = (text: string | null) => known(pullRefs(text ?? "", repo).flatMap((ref) => (ref.repo ? [pullKey(ref.repo, ref.number)] : [])));
  const replied = named(task.reply);
  return replied.length ? replied : named(task.title);
}

export function hostKey(originHost: string, localKey: string): string {
  // Escape the host segment so even a node id containing ':' cannot collide.
  return `${encodeURIComponent(originHost)}:${localKey}`;
}

/** Distinct agent publications stand alone, even when they have the same author session. */
export function slotId(originHost: string, task: WebFeedTask): string {
  if (task.id.startsWith("agentpost:")) return hostKey(originHost, `post:${task.id.slice("agentpost:".length)}`);
  return hostKey(originHost, task.sessionId ? `thread:${task.sessionId}` : `work:${task.id}`);
}
