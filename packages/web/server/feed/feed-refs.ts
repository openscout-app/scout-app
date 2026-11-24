/**
 * Pull request references and repository labels from a task. Only a turn's
 * identity groups tasks; a reference never joins two discussions.
 */

export type PullRef = { repo: string | null; number: number };

const PULL_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/gi;
/* "owner/repo#123": GitHub's own short form. Issues share it; the lookup keeps only pull requests. */
const PULL_SHORT = /(?<![\w./-])([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;
/* "PR #123", "PR 123", "pull request #123", or a bare "#123". Two digits at
   least, so a numbered list item ("#1") is not taken for one. */
const PULL_BARE = /(?:\b(?:PR|pull request)\s*#?|(?<![\w/&])#)(\d{2,6})\b/gi;

/** Pull requests a text names. A full URL carries its repository; a bare number gets `repo`, or null. */
export function pullRefs(text: string | null | undefined, repo: string | null = null): PullRef[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: PullRef[] = [];
  const add = (r: string | null, n: number) => {
    const key = `${r?.toLowerCase() ?? ""}#${n}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ repo: r ? r.toLowerCase() : null, number: n });
  };
  for (const match of text.matchAll(PULL_URL)) add(match[1]!, Number(match[2]));
  for (const match of text.matchAll(PULL_SHORT)) add(match[1]!, Number(match[2]));
  // A URL's or an "owner/name#N"'s own number would read again as a bare one.
  const stripped = text.replace(PULL_URL, " ").replace(PULL_SHORT, " ");
  for (const match of stripped.matchAll(PULL_BARE)) add(repo, Number(match[1]));
  return out;
}

/** "owner/name#123", lowercase: how the feed keys a pull request. */
export function pullKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}

/** Repositories a text names with a pull request (URL or owner/name#N), lowercase. */
export function namedRepos(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(PULL_URL), ...text.matchAll(PULL_SHORT)].map((m) => m[1]!.toLowerCase()))];
}

/** The last path segment. */
export function leaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/**
 * A linked worktree's name for its branch. Worktrees sit beside the main
 * checkout as `<repo>-<branch>`, so `project-feature` beside
 * `project` is `feature`. `mains` are the checkouts it may sit
 * beside; the longest name that fits wins. Null for a main checkout, or a
 * folder that does not follow the pattern.
 */
export function worktreeName(cwd: string | null | undefined, mains: readonly (string | null | undefined)[]): string | null {
  const here = leaf(cwd);
  if (!here) return null;
  let best: string | null = null;
  for (const main of mains) {
    const name = leaf(main);
    if (!name || name === here || !here.startsWith(`${name}-`) || here.length <= name.length + 1) continue;
    if (!best || name.length > best.length) best = name;
  }
  return best ? here.slice(best.length + 1) : null;
}
