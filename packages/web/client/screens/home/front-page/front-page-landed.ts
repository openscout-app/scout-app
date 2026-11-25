/* ──────────────────────────────────────────────────────────────────────────
   Landed today, for Home's right column: today's finished turns that
   produced something, newest first. A result is what the turn made to look
   at (a film, a screenshot, a page) or its outcome line; each row names the
   session that did it, with its harness mark.

   Read from the posts the Feed in the middle already holds (its "all" view),
   so it adds no read of its own. A post still running (a live lead), a
   routine review pass, or one that left neither an artifact nor a line is
   not a result and is left out. Pull requests are not part of it.

   Pure: no DOM, no clock of its own.
   ────────────────────────────────────────────────────────────────────────── */

import type { FeedDay, FeedLead, FeedPostHead } from "../../../../shared/api/feed.ts";
import type { Route } from "../../../lib/types.ts";
import { workingDay } from "../../feed/feed-store.ts";
import { homePost, type HomeAgent } from "./front-page-model.ts";

/** Rows the right column shows; the rest are counted under them. */
export const HOME_LANDED_SHOWN = 5;

/** What a turn made to look at, by kind and name. */
export type HomeArtifact = { kind: "Film" | "Screenshot" | "Page"; name: string };

export type HomeLandedRow = {
  id: string;
  at: number;
  title: string;
  /** The turn's outcome, one sentence; null when it left only an artifact. */
  outcome: string | null;
  artifact: HomeArtifact | null;
  /** The session that did it. */
  agent: HomeAgent | null;
  open: Route | null;
};

export type HomeLanded = { rows: HomeLandedRow[]; more: number };

export type LandedSource = { posts: ReadonlyMap<string, FeedPostHead>; days: readonly FeedDay[] };

export function artifactOf(lead: FeedLead): HomeArtifact | null {
  switch (lead.kind) {
    case "video": return { kind: "Film", name: lead.ref.name };
    case "visual": return { kind: "Screenshot", name: lead.ref.name };
    case "page": return { kind: "Page", name: lead.ref.path.split("/").filter(Boolean).at(-1) ?? lead.ref.path };
    default: return null;
  }
}

/** Today's results; null until the Feed has read its first page. */
export function landedToday(feed: LandedSource | null, nowMs: number, shown = HOME_LANDED_SHOWN): HomeLanded | null {
  if (!feed) return null;
  const today = workingDay(nowMs);
  const day = feed.days.find((d) => d.day === today);
  const rows: HomeLandedRow[] = [];
  for (const id of day ? [...day.ids, ...day.folded] : []) {
    const post = feed.posts.get(id);
    if (!post || post.day !== today || post.lead.kind === "live" || post.class === "routine") continue;
    const view = homePost(post);
    const artifact = artifactOf(post.lead);
    if (!artifact && !view.caption) continue;
    rows.push({ id: post.id, at: post.at, title: view.title, outcome: view.caption, artifact, agent: view.agent, open: view.open });
  }
  rows.sort((a, b) => b.at - a.at);
  return { rows: rows.slice(0, shown), more: Math.max(0, rows.length - shown) };
}
