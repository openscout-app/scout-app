/** Plain helpers for module labels and picker options. No React, so they test without a DOM. */

/** Sorted, de-duplicated picker options from any list. */
export function optionsFrom<T>(items: readonly T[], pick: (item: T) => string | null | undefined, label?: (value: string) => string) {
  const seen = new Set<string>();
  for (const item of items) {
    const v = pick(item);
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: label ? label(value) : value }));
}

/** Last path segment, for showing a project root as a name. */
export function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Short, distinct names for a set of paths: the last segment, or as many
 * trailing segments as it takes to tell two apart (worktrees of one repo).
 */
export function pathLabels(paths: readonly string[]): Map<string, string> {
  const parts = new Map(paths.map((p) => [p, p.replace(/\/+$/, "").split("/").filter(Boolean)]));
  const out = new Map<string, string>();
  for (const [path, segs] of parts) {
    let n = 1;
    const clash = (k: number) =>
      [...parts].some(([other, o]) => other !== path && o.slice(-k).join("/") === segs.slice(-k).join("/"));
    while (n < segs.length && clash(n)) n++;
    out.set(path, segs.slice(-n).join("/") || path);
  }
  return out;
}
