/** Latest touch of every eligible distinct file, newest first; viewport size is not a limit. */
export function recentFiles<T extends { file?: string }>(events: readonly T[], upto: number, eligible: (event: T) => boolean): T[] {
  const rows: T[] = [], seen = new Set<string>();
  for (let i = upto - 1; i >= 0; i--) {
    const e = events[i]!;
    if (!e.file || seen.has(e.file) || !eligible(e)) continue;
    seen.add(e.file); rows.push(e);
  }
  return rows;
}
