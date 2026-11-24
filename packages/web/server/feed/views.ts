/** Read-side selection. Only ranking facts travel through the selector; no
 * runtime records, reply bodies, file checks or model reads on this path. */
import type { FeedDay, FeedHome, FeedRank } from "../../shared/api/feed.ts";
import { DAY_TOP, selectPosts, type Candidate } from "./score.ts";
import { dayKey, previousDay } from "./days.ts";

export type SlotRank = {
  id: string;
  day: string;
  at: number;
  reviewed: number;
  placement: string;
  state: string;
  candidate: string;
};
export type RankedSlot = Omit<SlotRank, "candidate"> & { candidate: Candidate };
export function rankDays(rows: RankedSlot[], ranking?: Record<string, FeedRank>): FeedDay[] {
  const days = new Map<string, RankedSlot[]>();
  for (const row of rows) {
    if (!days.has(row.day)) days.set(row.day, []);
    days.get(row.day)!.push(row);
  }
  return [...days].map(([day, members]) => {
    const { shown, folded } = selectPosts(
      members.map((row) => row.candidate),
      DAY_TOP,
    );
    if (ranking) for (const { id, ...reason } of [...shown, ...folded]) ranking[id] = reason;
    return { day, at: members[0]!.at, ids: shown.map((p) => p.id), folded: folded.map((p) => p.id) };
  });
}
export function homeSlots(rows: RankedSlot[], now: number, ranking?: Record<string, FeedRank>): FeedHome {
  const today = dayKey(now),
    yesterday = previousDay(today);
  const recent = rows.filter((p) => p.day === today || p.day === yesterday);
  const waiting = rows.filter((p) => p.placement === "for_you");
  const attention = selectPosts(
    waiting.map((p) => p.candidate),
    waiting.length,
    false,
  ).shown;
  const back = recent.filter((p) => p.placement === "back_to_you");
  const shipped = recent.filter((p) => p.placement === "landed");
  const taken = new Set([...waiting, ...back, ...shipped].map((row) => row.candidate.session).filter(Boolean));
  const highlights = selectPosts(
    recent
      .filter((p) => p.placement === "stream" && !p.candidate.routine && p.state !== "closed" && !taken.has(p.candidate.session))
      .map((p) => p.candidate),
    4,
    false,
  ).shown;
  if (ranking) {
    for (const row of back)
      ranking[row.id] = {
        kind: row.candidate.kind,
        score: row.candidate.base,
        why: "Back to you: newest first, not scored for placement",
      };
    for (const { id, ...reason } of [...attention, ...highlights]) ranking[id] = reason;
  }
  return {
    forYou: attention.map((p) => p.id),
    backToYou: back.map((p) => p.id),
    shipped: shipped.map((p) => p.id),
    landed: highlights.map((p) => p.id),
    running: [],
  };
}
