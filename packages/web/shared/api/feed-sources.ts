/**
 * The Feed's other sources: what is not a finished task, read beside the
 * engine and served together for Home and the Feed.
 *
 *   GET /api/feed/sources -> FeedSources
 *
 * - outside: Slack conversations the operator took part in, with who spoke
 *   last and when (server/feed/outside.ts).
 * - quota: each time a provider window passed 90%, from the service budgets'
 *   stored history (server/feed/quota-events.ts).
 * - activity: posts in the Feed per day and project over the last week, split
 *   by harness (server/feed/activity.ts).
 *
 * Each part is empty, never filled in, when its source has nothing.
 */

export type FeedOutsideMessage = {
  id: string;
  who: string;
  /** Written by the operator (the connected Slack account). */
  operator: boolean;
  /** Written by a Slack app or bot. */
  bot: boolean;
  at: number;
  text: string;
};

export type FeedOutsideThread = {
  /** "slack:<channel id>". */
  id: string;
  source: "slack";
  /** The Slack workspace's name. */
  workspace: string;
  channel: { id: string; title: string; kind: "direct" | "group_direct" | "channel" };
  /** The conversation in Slack. */
  url: string | null;
  /** The newest message's time. */
  at: number;
  /** The working day of `at`, "2026-11-16"; a day turns over at 4am. */
  day: string;
  last: { who: string; operator: boolean; at: number };
  /**
   * "you": a person spoke last in a direct conversation, or the last message names you.
   * "them": you spoke last and nobody has answered.
   */
  waiting: "you" | "them" | null;
  /** The newest messages, oldest first. */
  messages: FeedOutsideMessage[];
  /** Older messages read but not sent. */
  earlier: number;
};

export type FeedOutside = {
  /** False when no Slack account is connected; the section is then left out. */
  connected: boolean;
  threads: FeedOutsideThread[];
};

export type FeedQuotaEvent = {
  /** "<origin>:quota:<provider>:<window>:<reset time>". */
  id: string;
  provider: string;
  label: string;
  /** The window's own label: "7d", "5h". */
  window: string;
  threshold: number;
  /** The first reading at or past the threshold. */
  crossedAt: number;
  day: string;
  peak: number;
  peakAt: number;
  /** When that window reset. */
  resetAt: number;
  /** The window's length, null when the provider gives none and its label does not say. */
  windowMs: number | null;
  /** The first reading that found the window used up, when one did. */
  ranOutAt: number | null;
  /** The readings of that window, [time, fill], oldest first. */
  points: Array<[number, number]>;
  /** The provider's current reading of the same window, when there is one. */
  now: { fill: number; resetAt: number } | null;
};

export type FeedActivityRow = {
  project: string;
  /** One entry per day in `days`: posts that day, by harness. */
  cells: Array<Record<string, number>>;
  total: number;
};

export type FeedActivity = {
  /** The last seven working days, oldest first. */
  days: string[];
  rows: FeedActivityRow[];
};

export type FeedSources = {
  generatedAt: number;
  outside: FeedOutside;
  quota: FeedQuotaEvent[];
  activity: FeedActivity;
};
