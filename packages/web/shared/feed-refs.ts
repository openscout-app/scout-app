/**
 * What a finished task's reply names: pull requests and studies. Shared by the
 * Feed route, which looks the pull requests up, and the Feed model, which
 * threads tasks by them.
 */

export type PullRef = { repo: string | null; number: number };

const PULL_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/gi;
/* "arach/scout#195": GitHub's own short form. Issues share it; the lookup keeps only pull requests. */
const PULL_SHORT = /(?<![\w./-])([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;
/* "PR #1950", "PR 1950", "pull request #1950", or a bare "#1950". Two digits at
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

/* A page, not a file: "/studies/x" on its own or after an origin, never inside a path ("public/studies/x.png"). */
const STUDY_LINK = /(?:(https?:\/\/[^\s/<>()`'"]+)|(?<![\w./-]))(\/studies\/[a-z0-9][a-z0-9-]*)(?![\w.-]*\.[a-z]{2,4}\b)/gi;

export type StudyLink = { path: string; href: string | null };

/** Studio study pages a text names ("/studies/team-feed-live"), each once, in order, with the address the text gave. */
export function studyLinks(text: string | null | undefined): StudyLink[] {
  if (!text) return [];
  const out = new Map<string, StudyLink>();
  for (const match of text.matchAll(STUDY_LINK)) {
    const path = match[2]!;
    const href = match[1] ? `${match[1]}${path}` : null;
    const held = out.get(path);
    if (!held) out.set(path, { path, href });
    else if (!held.href && href) held.href = href;
  }
  return [...out.values()];
}

/** The last path segment. */
export function leaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/**
 * A linked worktree's name for its branch. Worktrees sit beside the main
 * checkout as `<repo>-<branch>`, so `demo-app-slack-interop` beside
 * `demo-app` is `slack-interop`. `mains` are the checkouts it may sit
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
