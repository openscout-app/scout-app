import { worktreeName } from "./feed-refs.ts";

/** Each project root's repository: the one its replies name most. A worktree that named none takes its checkout's. */
export function reposByRoot(named: ReadonlyMap<string, { root: string | null; repos: readonly string[] }>): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const { root, repos } of named.values()) {
    if (!root) continue;
    for (const repo of repos) {
      const byRepo = counts.get(root) ?? new Map<string, number>();
      byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1);
      counts.set(root, byRepo);
    }
  }
  const out: Record<string, string> = {};
  for (const [root, byRepo] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[root] = [...byRepo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  }
  const mains = Object.keys(out);
  for (const { root } of named.values()) {
    if (!root || out[root]) continue;
    const main = mains.filter((candidate) => worktreeName(root, [candidate]) !== null).sort((a, b) => b.length - a.length)[0];
    if (main) out[root] = out[main]!;
  }
  return out;
}
