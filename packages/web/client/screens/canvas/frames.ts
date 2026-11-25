/*
 * Canvas, grouped by work: sessions that worked in the same checkout sit together under it, so one piece of work
 * reads as one group however many sessions took part and however the asks were worded.
 *
 * The checkout is on the record (each session's newest call names its project and worktree), so the grouping is
 * exact. Sessions in a project's main checkout are usually unrelated one-off tasks, not one piece of work: they are
 * left over, and the scene puts them last.
 */
import type { CanvasAgent } from "../../../shared/canvas.ts";

export type Frame = {
  /** the checkout the sessions worked in: its worktree name, with the project when the canvas shows several */
  title: string;
  /** indexes into the canvas's agents, newest first */
  agents: number[];
};

const MAIN = "main";

/**
 * The checkouts the sessions worked in, newest work first, and the sessions on a main checkout left over. `agents` is
 * the canvas's whole list, so indexes hold; null entries (outside the project shown or hidden) are skipped.
 */
export function framesByWork(
  agents: readonly (Pick<CanvasAgent, "project" | "worktree" | "lastAt"> | null)[],
): { frames: Frame[]; rest: number[] } {
  const byTree = new Map<string, { project: string; worktree: string; agents: number[] }>();
  const rest: number[] = [];
  const projects = new Set<string>();
  agents.forEach((a, i) => {
    if (!a) return;
    projects.add(a.project);
    if (!a.worktree || a.worktree === MAIN) { rest.push(i); return; }
    const key = `${a.project}\u0000${a.worktree}`;
    const f = byTree.get(key);
    if (f) f.agents.push(i); else byTree.set(key, { project: a.project, worktree: a.worktree, agents: [i] });
  });
  const at = (i: number) => agents[i]?.lastAt ?? 0;
  const byRecent = (x: number, y: number) => at(y) - at(x);
  const several = projects.size > 1;
  const frames = [...byTree.values()]
    .map((f) => ({ title: several ? `${f.project} · ${f.worktree}` : f.worktree, agents: f.agents.sort(byRecent) }))
    .sort((a, b) => at(b.agents[0]) - at(a.agents[0]));
  return { frames, rest: rest.sort(byRecent) };
}
