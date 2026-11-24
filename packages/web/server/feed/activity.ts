/**
 * The week by project: posts in the Feed per working day and project over
 * the last seven days, split by the lead agent's harness. Pure. A post's
 * project is the engine's (post.ts); a post without one is not counted.
 */
import type { FeedActivity, FeedActivityRow } from "../../shared/api/feed-sources.ts";
import { dayKey, previousDay } from "./days.ts";

export const ACTIVITY_DAYS = 7;

export type ActivityPost = { day: string; project: string | null; harness: string | null };

export function activityGrid(posts: readonly ActivityPost[], now: number, days = ACTIVITY_DAYS): FeedActivity {
  const keys: string[] = [dayKey(now)];
  while (keys.length < days) keys.unshift(previousDay(keys[0]!));
  const index = new Map(keys.map((d, i) => [d, i]));
  const rows = new Map<string, FeedActivityRow>();
  for (const post of posts) {
    const at = index.get(post.day);
    if (at === undefined) continue;
    const project = post.project;
    if (!project) continue;
    let row = rows.get(project);
    if (!row) rows.set(project, (row = { project, cells: keys.map(() => ({})), total: 0 }));
    const harness = post.harness ?? "other";
    row.cells[at]![harness] = (row.cells[at]![harness] ?? 0) + 1;
    row.total += 1;
  }
  return { days: keys, rows: [...rows.values()].sort((a, b) => b.total - a.total || a.project.localeCompare(b.project)) };
}
