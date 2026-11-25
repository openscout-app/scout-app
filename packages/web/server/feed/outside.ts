/**
 * Outside conversation as Feed posts: the Slack conversations the operator
 * took part in over the last week, each with its newest messages, who spoke
 * last and when, and whether it waits on the operator or on the other side.
 *
 * `outsideThreads` is pure. `OutsideReader` reads Slack through the
 * operator's connected account at most every two minutes, and only when
 * asked. It reads the conversations with the newest messages: a light probe
 * learns each conversation's newest message, a bounded number per read, and
 * keeps it for a while. A read that fails keeps the last answer and waits
 * before it tries Slack again.
 */
import type { FeedOutside, FeedOutsideMessage, FeedOutsideThread } from "../../shared/api/feed-sources.ts";
import { dayKey } from "./days.ts";

export const OUTSIDE_LOOKBACK_MS = 7 * 86_400_000;
export const OUTSIDE_MAX_THREADS = 12;
const SHOWN_MESSAGES = 6;
const TEXT_MAX = 600;
const READ_FRESH_MS = 120_000;
/** After a failed read, how long to wait before Slack is read again (or longer, when Slack says so). */
export const OUTSIDE_FAILED_BACKOFF_MS = 5 * 60_000;
/** Conversations read in full per read, newest first: twice the threads shown, since some are left out. */
export const OUTSIDE_MAX_CONVERSATIONS = 24;
/** Conversations probed for their newest message per read, and how long a probe holds. */
export const OUTSIDE_PROBES_PER_READ = 40;
const PROBE_FRESH_MS = 15 * 60_000;
const PER_CONVERSATION = 12;
/** A thread is read in pages of REPLY_PAGE replies, at most REPLY_PAGES of them. */
const REPLY_PAGE = 200;
const REPLY_PAGES = 5;
const CONCURRENCY = 4;
/** Slack's own accounts: Slackbot, and the one that posts install and admin notices. Neither is a person. */
const SLACK_SYSTEM = new Set(["USLACKBOT", "USLACK"]);

/** The parts of a Slack message this reads (server/slack-client-service.ts SlackChatMessage). */
export type OutsideMessageInput = {
  id: string;
  actorId: string;
  actorName?: string;
  body: string;
  /** The message's text as Markdown; Slack's rich messages leave `body` empty and carry it here. */
  editBody?: string;
  createdAt: number;
  class: "operator" | "agent" | "system";
  mentions?: ReadonlyArray<{ actorId: string }>;
  externalUrl?: string;
  threadSummary?: { count: number; lastActiveAt: number };
};

function textOf(m: OutsideMessageInput): string {
  return (m.body.trim() ? m.body : m.editBody ?? "").trim();
}

export type OutsideConversationInput = {
  id: string;
  title: string;
  kind: "direct" | "group_direct" | "channel";
  messages: readonly OutsideMessageInput[];
};

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TEXT_MAX ? `${flat.slice(0, TEXT_MAX - 1).trimEnd()}…` : flat;
}

export function outsideThreads(input: {
  workspace: string;
  viewerId: string;
  conversations: readonly OutsideConversationInput[];
  now: number;
  max?: number;
}): FeedOutsideThread[] {
  const since = input.now - OUTSIDE_LOOKBACK_MS;
  const out: FeedOutsideThread[] = [];
  for (const conversation of input.conversations) {
    // Slack's own accounts post reminders and notices as users, not bots; they are not conversation.
    const messages = conversation.messages
      .filter((m) => m.class !== "system" && !SLACK_SYSTEM.has(m.actorId) && m.createdAt >= since && textOf(m))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const last = messages.at(-1);
    if (!last) continue;
    const mine = (m: OutsideMessageInput) => m.actorId === input.viewerId;
    // Notes to yourself (your own direct conversation, or a channel only you wrote in) are not a conversation.
    if (messages.every(mine)) {
      const others = conversation.messages.some((m) => m.class !== "system" && !SLACK_SYSTEM.has(m.actorId) && !mine(m));
      if (!others) continue;
    }
    const namesMe = (m: OutsideMessageInput) => Boolean(m.mentions?.some((x) => x.actorId === input.viewerId));
    const direct = conversation.kind !== "channel";
    const tookPart = messages.some(mine);
    // A person writing to you directly, or naming you, counts even before you answer; an app's greeting does not.
    const reachedMe = messages.some((m) => !mine(m) && (namesMe(m) || (direct && m.class === "operator")));
    if (!tookPart && !reachedMe) continue;
    const waiting: FeedOutsideThread["waiting"] = mine(last)
      ? "them"
      : namesMe(last) || (direct && last.class === "operator") ? "you" : null;
    const shown = messages.slice(-SHOWN_MESSAGES);
    out.push({
      id: `slack:${conversation.id}`,
      source: "slack",
      workspace: input.workspace,
      channel: { id: conversation.id, title: conversation.title, kind: conversation.kind },
      url: last.externalUrl ?? null,
      at: last.createdAt,
      day: dayKey(last.createdAt),
      last: { who: last.actorName ?? last.actorId, operator: mine(last), at: last.createdAt },
      waiting,
      messages: shown.map((m): FeedOutsideMessage => ({
        id: m.id,
        who: m.actorName ?? m.actorId,
        operator: mine(m),
        bot: m.class === "agent",
        at: m.createdAt,
        text: clip(textOf(m)),
      })),
      earlier: messages.length - shown.length,
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, input.max ?? OUTSIDE_MAX_THREADS);
}

/** What the reader needs from the Slack client (server/slack-client-service.ts). */
export type OutsideSlack = {
  bootstrap(): Promise<{
    viewer: { actorId: string };
    source: { name: string };
    channels: ReadonlyArray<{ id: string; title: string; kind: string }>;
  }>;
  /** The newest messages, oldest first. */
  recent(channelId: string, limit?: number): Promise<OutsideMessageInput[]>;
  /** A thread's root and replies, oldest first, a page of `limit` at a time. */
  context(channelId: string, messageId: string, cursor?: string, limit?: number): Promise<{ messages: OutsideMessageInput[]; nextCursor?: string | null }>;
};

/** A message's newest moment: its own, or its thread's newest reply. */
function newestOf(messages: readonly OutsideMessageInput[]): number {
  return messages.reduce((at, m) => Math.max(at, m.createdAt, m.threadSummary?.lastActiveAt ?? 0), 0);
}

async function pooled<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) out.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(run)));
  return out;
}

/**
 * A thread's replies, newest last. Slack pages them oldest first, so read on
 * to the last page: at most REPLY_PAGES pages of REPLY_PAGE replies, which
 * reaches the newest reply in any thread of up to a thousand.
 */
async function threadReplies(slack: OutsideSlack, channelId: string, rootId: string): Promise<OutsideMessageInput[]> {
  const out: OutsideMessageInput[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < REPLY_PAGES; page += 1) {
    const result = await slack.context(channelId, rootId, cursor, REPLY_PAGE);
    out.push(...result.messages);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return out;
}

/** The newest messages, with the replies of the newest thread that is busier than the conversation around it. */
async function conversationMessages(slack: OutsideSlack, channelId: string): Promise<OutsideMessageInput[]> {
  const top = await slack.recent(channelId, PER_CONVERSATION);
  const newestTop = top.reduce((at, m) => Math.max(at, m.createdAt), 0);
  const root = [...top].reverse().find((m) => m.threadSummary && m.threadSummary.count > 0 && m.threadSummary.lastActiveAt > newestTop - 1);
  if (!root) return top;
  const replies = await threadReplies(slack, channelId, root.id).catch((error) => tolerateConversationMiss(error, []));
  const byId = new Map(top.map((m) => [m.id, m]));
  for (const reply of replies) if (!byId.has(reply.id)) byId.set(reply.id, reply);
  return [...byId.values()];
}

/** Conversation-local misses are tolerable; account-wide failures must stop the read. */
function tolerateConversationMiss<T>(error: unknown, fallback: T): T {
  const e = error as { status?: number; code?: string };
  if (e?.status === 429 || e?.status === 401 || e?.status === 403 || notConnected(error)
    || ["ratelimited", "invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "missing_scope"].includes(e?.code ?? "")) {
    throw error;
  }
  return fallback;
}

function notConnected(error: unknown): boolean {
  const e = error as { status?: number; code?: string };
  return e?.code === "not_connected" || e?.status === 503;
}

function retryAfterMs(error: unknown): number {
  const seconds = (error as { retryAfterSeconds?: number })?.retryAfterSeconds;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : 0;
}

const KIND_ORDER: Record<string, number> = { direct: 0, group_direct: 1, channel: 2 };

export class OutsideReader {
  private held: { at: number; value: FeedOutside } | null = null;
  private reading: Promise<FeedOutside> | null = null;
  /** Not before this time after a failed read. */
  private retryAt = 0;
  /** Each conversation's newest message as last seen (0: none; null: the probe failed), and when it was probed. */
  private readonly newest = new Map<string, { at: number | null; seenAt: number }>();

  constructor(private readonly slack: OutsideSlack | null, private readonly now: () => number = Date.now) {}

  read(): Promise<FeedOutside> {
    if (!this.slack) return Promise.resolve({ connected: false, threads: [] });
    const now = this.now();
    if (this.held && now - this.held.at < READ_FRESH_MS) return Promise.resolve(this.held.value);
    if (now < this.retryAt) return Promise.resolve(this.held?.value ?? { connected: true, threads: [] });
    if (this.reading) return this.reading;
    this.reading = this.readSlack(this.slack).finally(() => { this.reading = null; });
    return this.reading;
  }

  /**
   * Which conversations to read in full: probe the ones not seen lately, a
   * bounded number per read (never probed first, then the longest unprobed),
   * then take the newest. A conversation whose newest message is not known
   * yet comes after every one known to be recent, direct conversations
   * first, so with many active conversations a quiet-looking one can take
   * one more read to rank by its time.
   */
  private async choose<C extends { id: string; kind: string }>(slack: OutsideSlack, channels: readonly C[], since: number): Promise<C[]> {
    const now = this.now();
    const stale = channels
      .filter((c) => { const seen = this.newest.get(c.id); return !seen || now - seen.seenAt >= PROBE_FRESH_MS; })
      .sort((a, b) => (this.newest.get(a.id)?.seenAt ?? -1) - (this.newest.get(b.id)?.seenAt ?? -1) || KIND_ORDER[a.kind]! - KIND_ORDER[b.kind]!)
      .slice(0, OUTSIDE_PROBES_PER_READ);
    await pooled(stale, async (c) => {
      // A probe that fails keeps what was known (or nothing), marked as probed so it waits its turn again.
      const at = await slack.recent(c.id, 1).then(newestOf).catch((error) => tolerateConversationMiss(error, this.newest.get(c.id)?.at ?? null));
      this.newest.set(c.id, { at, seenAt: now });
    });
    const rank = (c: { id: string; kind: string }) => this.newest.get(c.id)?.at ?? undefined;
    return channels
      .filter((c) => { const at = rank(c); return at === undefined || at >= since; })
      .sort((a, b) => {
        const x = rank(a), y = rank(b);
        if (x !== undefined && y !== undefined) return y - x;
        if (x !== undefined) return -1;
        if (y !== undefined) return 1;
        return KIND_ORDER[a.kind]! - KIND_ORDER[b.kind]!;
      })
      .slice(0, OUTSIDE_MAX_CONVERSATIONS);
  }

  private async readSlack(slack: OutsideSlack): Promise<FeedOutside> {
    try {
      const boot = await slack.bootstrap();
      const since = this.now() - OUTSIDE_LOOKBACK_MS;
      const channels = boot.channels.filter((c) => c.kind in KIND_ORDER);
      const chosen = await this.choose(slack, channels, since);
      const conversations = await pooled(chosen, async (c): Promise<OutsideConversationInput> => {
        const messages = await conversationMessages(slack, c.id).catch((error) => tolerateConversationMiss(error, []));
        if (messages.length) this.newest.set(c.id, { at: newestOf(messages), seenAt: this.now() });
        return { id: c.id, title: c.title, kind: c.kind as OutsideConversationInput["kind"], messages };
      });
      const value: FeedOutside = {
        connected: true,
        threads: outsideThreads({ workspace: boot.source.name, viewerId: boot.viewer.actorId, conversations, now: this.now() }),
      };
      this.held = { at: this.now(), value };
      this.retryAt = 0;
      return value;
    } catch (error) {
      if (notConnected(error)) {
        const value: FeedOutside = { connected: false, threads: [] };
        this.held = { at: this.now(), value };
        return value;
      }
      // A rate limit or a revoked token: keep the last answer and wait before reading Slack again.
      this.retryAt = this.now() + Math.max(OUTSIDE_FAILED_BACKOFF_MS, retryAfterMs(error));
      console.warn("[feed] slack", error instanceof Error ? error.message : error);
      return this.held?.value ?? { connected: true, threads: [] };
    }
  }
}
