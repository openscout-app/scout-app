/**
 * A proportional diff: lines added and removed per file, the largest few, and
 * the areas the change touches. Pure; the route reads the files from GitHub
 * once per head commit and caches the stat by that SHA.
 */
import type { FeedDiffFile, FeedDiffStat } from "../../shared/api/feed.ts";

export const DIFF_TOP_FILES = 5;

const AREAS: ReadonlyArray<readonly [string, RegExp]> = [
  ["tests", /(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/|(?:^|\/)tests?\/)/i],
  ["migrations", /(?:(?:^|\/)migrations?\/|\.sql$)/i],
  ["routes", /(?:(?:^|\/)routes?\/|router\.[a-z]+$)/i],
  ["docs", /(?:\.mdx?$|(?:^|\/)docs\/)/i],
  ["ui", /(?:\.(?:tsx|jsx|css|swift|xib|storyboard)$|(?:^|\/)(?:client|components|screens|views)\/)/i],
];

export function fileArea(path: string): string | null {
  for (const [name, pattern] of AREAS) if (pattern.test(path)) return name;
  return null;
}

export function diffStat(files: ReadonlyArray<{ path: string; additions: number; deletions: number }>, sha: string | null): FeedDiffStat {
  const all: FeedDiffFile[] = files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, area: fileArea(f.path) }));
  const lines = (f: FeedDiffFile) => f.additions + f.deletions;
  const byArea = new Map<string, number>();
  for (const f of all) if (f.area) byArea.set(f.area, (byArea.get(f.area) ?? 0) + lines(f));
  return {
    additions: all.reduce((n, f) => n + f.additions, 0),
    deletions: all.reduce((n, f) => n + f.deletions, 0),
    files: all.length,
    top: [...all].sort((a, b) => lines(b) - lines(a) || a.path.localeCompare(b.path)).slice(0, DIFF_TOP_FILES),
    areas: [...byArea.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
    sha,
  };
}

/** `gh pr view --json files,headRefOid` output, as a stat. */
export function parseGhPullFiles(stdout: string): FeedDiffStat | null {
  let parsed: { files?: Array<{ path?: unknown; additions?: unknown; deletions?: unknown }>; headRefOid?: unknown };
  try { parsed = JSON.parse(stdout); } catch { return null; }
  if (!Array.isArray(parsed.files)) return null;
  const files = parsed.files
    .filter((f) => typeof f.path === "string")
    .map((f) => ({ path: f.path as string, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 }));
  return diffStat(files, typeof parsed.headRefOid === "string" ? parsed.headRefOid : null);
}
