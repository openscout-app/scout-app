import type { Context, Hono } from "hono";
import { hiddenBy } from "../../shared/api/feed-hides.ts";
import type { HideStore } from "../feed/hides.ts";
import { mountFeedHideRoutes } from "./feed-hides.ts";
import type { MoveStore } from "../feed/moves.ts";
import { mountFeedMoveRoutes } from "./feed-moves.ts";
import { stat } from "node:fs/promises";
import { execSystemFile } from "@openscout/runtime/system-probes";
import { queryFeedWork, type FeedRead } from "../db/feed.ts";
import { runtimeShowSource, SHOW_ID, type RuntimeShow, type ShowSource } from "../canvas-shows.ts";
import { runtimePostSource, type PostSource, type RuntimePost } from "../feed/agent-posts.ts";
import { byteRange, videoType } from "../canvas.ts";
import { sharedSwarmPullsReader, SWARM_PULLS_MAX_REPOS, type SwarmPullsReader, type SwarmPullState } from "./swarm-pulls.ts";
import { namedRepos, pullRefs, worktreeName, type PullRef } from "../../shared/feed-refs.ts";
import type { FeedDiffStat, FeedPostDetail, FeedViewId, WebFeedPull, WebFeedShow, WebFeedTask } from "../../shared/api/feed.ts";
import { FeedTable, FEED_WINDOW_MS } from "../feed/table.ts";
import { readNamedPulls } from "../feed/pulls.ts";
import { startFeedWriter } from "../feed/writer.ts";
import { checkMediaFile, insideCheckout, mediaKind, replyDocument, replyMedia, replyStudies } from "../feed/files.ts";
import { parseGhPullFiles } from "../feed/diff.ts";
import type { FeedAttention } from "../feed/post.ts";
import { activityGrid } from "../feed/activity.ts";
import { OutsideReader, type OutsideSlack } from "../feed/outside.ts";
import { quotaCrossings, type QuotaGaugeInput } from "../feed/quota-events.ts";
import type { FeedSources } from "../../shared/api/feed-sources.ts";
import type { ForYouResponse } from "../../shared/api/for-you.ts";
import type { OperatorAttentionItem } from "../core/attention/operator-attention-state.ts";
import { postSource, requestSource, type BranchStat, type ForYouSource } from "../feed/for-you/source.ts";
import { ForYouDigester } from "../feed/for-you/service.ts";
import { memoryDigestStore } from "../feed/for-you/store.ts";
import { type TurnSummaries } from "../turn-summary.ts";
import type { FeedSummaries } from "../../shared/api/feed.ts";
import { createPrImageReader } from "../feed/pr-image.ts";

/*
 * The Feed's server: a disposable SQLite projection and its writer.
 *
 *   GET /api/feed?view=all|reviewed|following|home&cursor=<day>&since=<version>
 *   GET /api/feed/post/:id
 *   GET /api/feed/live?since=<version>
 *   GET /api/feed/slots?since=<version>  (unranked host-local changes, including removals)
 *   GET /api/feed/asset/:id
 *   GET /api/feed/sources       (Slack threads, quota warnings, the week by project)
 *   GET /api/feed/for-you
 *   GET /api/feed/summaries?posts=<id,id>   (each post's newest turn in two lines)
 *
 * Readers only wait for the first build of a missing projection. The writer
 * polls changed runtime records and reconciles external state in the background.
 */

/** Shows, attention and local branches are context: read at most this often. */
const CONTEXT_FRESH_MS = 30_000;
/** Past CONTEXT_FRESH_MS, a held read this young answers at once while the next is read behind it. */
const CONTEXT_STALE_MS = 5 * 60_000;
/** A changed-since read starts this far before the last one, so a row written mid-read is not missed. */
const MARK_SLACK_MS = 5_000;
const FEED_MAX_SHOW_ROOTS = 12;
/** A show counts toward a task from just before it opened until shortly after its reply. */
const SHOW_LEAD_MS = 60_000;
const SHOW_TAIL_MS = 10 * 60_000;
const DIFF_CACHE = 200;
/** Posts one summaries read may name. */
const SUMMARY_IDS_MAX = 40;

const VIEWS: readonly FeedViewId[] = ["all", "reviewed", "following", "home"];

export type FeedRouteDeps = {
  /** Canonical id of this projecting runtime (GET /v1/node). */
  originHost: () => Promise<string | null>;
  projectionPath?: string;
  /** An observer refreshes its cache on demand, not on an idle timer. */
  refreshOnRead?: boolean;
  brokerUrl?: () => string;
  shows?: ShowSource;
  /** Agent posts (`scout post`), read from the runtime's post store. */
  posts?: PostSource;
  pulls?: SwarmPullsReader;
  namedPulls?: typeof readNamedPulls;
  query?: (read: FeedRead) => ReturnType<typeof queryFeedWork> | Promise<ReturnType<typeof queryFeedWork>>;
  /** The operator-attention queue, reduced to what joins a post. */
  attention?: () => Promise<FeedAttention[]>;
  /**
   * The operator-attention queue, whole. When given, the feed's attention is
   * read from it, and For you draws its request cards from the same read.
   */
  requests?: () => Promise<OperatorAttentionItem[]>;
  /** What the operator hid. Every read leaves hidden items out (server/feed/hides.ts). */
  hides?: HideStore;
  /** The operator's latest move on each post, from the Feed or Home (server/feed/moves.ts). Posts carry it. */
  moves?: MoveStore;
  /** Turn summaries by the cheap model (server/turn-summary.ts). Without them, /api/feed/summaries answers with none. */
  summaries?: TurnSummaries | null;
  /** For you's classifier and digests (server/feed/for-you). Without it, /api/feed/for-you draws from the rules. */
  digester?: ForYouDigester;
  /** A local branch's commits and lines ahead of the default branch. */
  branchStat?: (root: string, branch: string) => Promise<BranchStat | null>;
  /** Unmerged local branches of a checkout. */
  localBranches?: (root: string) => Promise<string[]>;
  /** A pull request's per-file stat. */
  pullFiles?: (repo: string, number: number) => Promise<FeedDiffStat | null>;
  /** The operator's connected Slack account, for outside threads. */
  slack?: OutsideSlack | null;
  /** The service budgets' gauges with their stored history, for quota warnings. */
  budgets?: () => Promise<{ gauges: readonly QuotaGaugeInput[] }>;
  now?: () => number;
};

/* ── pure assembly helpers ─────────────────────────────────────────────── */

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

/** Shows that fall inside a task's run, by its owner or its session: the newest version of each item. */
export function showsForTask(task: WebFeedTask, shows: readonly RuntimeShow[]): WebFeedShow[] {
  const newest = new Map<string, RuntimeShow>();
  for (const show of shows) {
    if (!SHOW_ID.test(show.id)) continue;
    // Session evidence takes precedence: another session of this agent did not make this turn's artifact.
    const ownerMatches = task.sessionId && show.sessionId ? task.sessionId === show.sessionId : show.agentId === task.ownerId;
    const mine = ownerMatches
      && show.createdAt >= task.createdAt - SHOW_LEAD_MS
      && show.createdAt <= task.finishedAt + SHOW_TAIL_MS;
    if (!mine) continue;
    const held = newest.get(show.itemId);
    if (!held || show.createdAt > held.createdAt) newest.set(show.itemId, show);
  }
  return [...newest.values()].sort((a, b) => b.createdAt - a.createdAt).map((show) => ({
    id: show.id,
    itemId: show.itemId,
    name: show.sourcePath.split("/").filter(Boolean).at(-1) ?? show.sourcePath,
    kind: show.kind,
    mediaType: show.mediaType,
    caption: show.caption?.trim() || null,
    at: show.createdAt,
  }));
}

export function feedPull(pull: SwarmPullState): WebFeedPull {
  const at = Date.parse(pull.mergedAt ?? pull.closedAt ?? pull.updatedAt ?? pull.createdAt ?? "");
  return {
    key: pull.key, repo: pull.repo, number: pull.number, state: pull.state, title: pull.title, url: pull.url, head: pull.head,
    at: Number.isFinite(at) ? at : null, additions: pull.additions ?? null, deletions: pull.deletions ?? null,
    files: pull.changedFiles ?? null,
    images: pull.images ?? [],
  };
}

/** The attention queue's items, as the feed joins them: by work item and by conversation. */
export function attentionForFeed(items: ReadonlyArray<{ id: string; kind?: string; title: string; conversationId: string | null; ready?: { workId: string | null }; actions?: ReadonlyArray<{ recordId?: string; recordKind?: string }> }>): FeedAttention[] {
  // A failed or interrupted ask is a notice, not something the operator answers: it never marks a post as waiting.
  return items.filter((item) => item.kind !== "ask").map((item) => {
    const fromAction = item.actions?.find((a) => a.recordKind === "work_item" && a.recordId)?.recordId ?? null;
    const fromId = item.id.startsWith("work_item:") ? item.id.slice("work_item:".length) : null;
    // A Ready task names its work item itself.
    const fromReady = item.ready?.workId ?? null;
    return {
      id: item.id, workId: fromAction ?? fromId ?? fromReady, conversationId: item.conversationId,
      label: item.kind === "ready" ? "Ready" : "Waiting on you",
      ...(item.kind === "ready" ? {} : { detail: item.title }),
    };
  });
}

export function parseView(raw: string | undefined): FeedViewId {
  return VIEWS.includes(raw as FeedViewId) ? raw as FeedViewId : "all";
}

export function parseSince(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/* ── the service ───────────────────────────────────────────────────────── */

type Timed<T> = { at: number; value: T };

export class FeedService {
  readonly table: FeedTable;
  private quotaReading: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private nextReadRefresh = 0;
  private stopWriter?: () => void;
  private stopping = false;
  private originReady?: Promise<void>;
  private roots = new Map<string, number>();
  private shows = new Map<string, Timed<RuntimeShow[]>>();
  private attention: Timed<FeedAttention[]> | null = null;
  private requests: Timed<OperatorAttentionItem[]> | null = null;
  /** The attention queue read on its way, shared by every caller. */
  private requestsRead: Promise<OperatorAttentionItem[]> | null = null;
  private branchStats = new Map<string, Timed<BranchStat | null>>();
  private branchStatReads = new Map<string, Promise<BranchStat | null>>();
  private rulesOnly: ForYouDigester | null = null;
  private branches = new Map<string, Timed<string[]>>();
  private diffs = new Map<string, FeedDiffStat | null>();

  constructor(private readonly deps: FeedRouteDeps) {
    this.table = new FeedTable({ path: deps.projectionPath, summaries: deps.summaries });
  }

  /** Reads may serve the last snapshot offline. New writes must first verify the runtime's identity. */
  private identifyWriter(): Promise<void> {
    return this.originReady ??= this.deps.originHost().then(host => {
      if (!host) throw new Error("Cannot identify the Feed's origin host from /v1/node");
      this.table.bindOrigin(host);
    }).catch(error => { this.originReady = undefined; throw error; });
  }

  start() {
    this.stopWriter ??= startFeedWriter(() => {
      void this.refreshQuota().catch(error => console.warn("[feed] quota", error));
      return this.refresh();
    });
  }

  refreshQuota(): Promise<void> {
    if (!this.deps.budgets || this.now() - this.table.quotaMark < 60_000) return Promise.resolve();
    return this.quotaReading ??= this.identifyWriter().then(() => this.deps.budgets!()).then(({ gauges }) => {
      this.table.writeQuota(quotaCrossings(gauges), this.now());
    }).finally(() => { this.quotaReading = null; });
  }
  async stop() {
    this.stopWriter?.();
    this.stopping = true;
    try { await Promise.allSettled([this.refreshing, this.quotaReading]); } finally { this.table.close(); }
  }

  /** A valid projection survives a process restart. Never wait for GitHub or
   * runtime catch-up on its read path. */
  ready() {
    const mark = this.table.mark;
    const now = this.now();
    if (mark === null || mark < now - FEED_WINDOW_MS) return this.refresh();
    if (this.deps.refreshOnRead && !this.stopping && mark < now - 30_000 && now >= this.nextReadRefresh) {
      this.nextReadRefresh = now + 30_000;
      void this.refresh().catch(error => console.warn("[feed] observer refresh", error));
    }
    return Promise.resolve();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * Write the operator's hides and moves into the projection now, from its stored inputs: no runtime read, so
   * neither waits on a pass already under way. A file not yet written takes them on its first pass.
   */
  applyMarks(): void {
    if ((!this.deps.hides && !this.deps.moves) || this.table.mark === null) return;
    this.table.apply({ context: this.marks(this.now()) });
  }

  private marks(now: number) {
    return { hides: this.deps.hides?.list(now) ?? [], moves: this.deps.moves?.list(now) ?? [] };
  }

  /** Serialize writers, including a first read that meets an empty file. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    await this.identifyWriter();
    const now = this.now();
    const windowStart = now - FEED_WINDOW_MS;
    const mark = this.table.mark;
    const rebuild = mark === null || mark < windowStart;
    const read: FeedRead = rebuild
      ? { mode: "window", since: windowStart, limit: -1 }
      : { mode: "changed", mark: mark - MARK_SLACK_MS, since: windowStart, limit: -1 };
    const { tasks, gone } = await (this.deps.query ?? queryFeedWork)(read);
    const kept = tasks.filter(t => (t.state === "working" ? t.updatedAt : t.finishedAt) >= windowStart);
    for (const task of tasks) if ((task.state === "working" ? task.updatedAt : task.finishedAt) < windowStart) gone.push(task.id);
    const named = this.table.namedInputs(windowStart);
    for (const task of kept) {
      const words = task.title + "\n" + (task.reply ?? "");
      named.set(task.id, { root: task.projectRoot, repos: namedRepos(words), refs: pullRefs(words) });
    }
    for (const id of gone) named.delete(id);
    const repos = reposByRoot(named);
    this.roots.clear();
    for (const { root } of named.values()) if (root) this.roots.set(root, (this.roots.get(root) ?? 0) + 1);

    const [upsert, posts, pulls, attention, localBranches] = await Promise.all([
      this.enrich(kept, Object.keys(repos), windowStart),
      this.readPosts(windowStart),
      this.readPulls(named, repos),
      this.readAttention(),
      this.readLocalBranches(repos),
    ]);
    const { requests } = this.table.apply({ upsert, posts, remove: gone, context: { repos, pulls, attention, localBranches, ...this.marks(now) }, mark: now, expireBefore: windowStart });
    // Only new/changed final replies can commission prose. Rebuilds and context-only edits cannot.
    if (!rebuild && this.deps.summaries) this.deps.summaries.read(requests, (id, key) => {
      if (!this.stopping) this.table.summaryReady(id, key);
    });
  }

  /** Shows, reply-named media and study posters: the file checks the projection never repeats on read. */
  private async enrich(tasks: WebFeedTask[], mains: string[], since: number): Promise<WebFeedTask[]> {
    const showsByRoot = await this.readShows(since);
    return Promise.all(tasks.map(async (task) => {
      const shows = task.projectRoot ? showsForTask(task, showsByRoot.get(task.projectRoot) ?? []) : [];
      const roots = [...new Set([task.cwd, task.projectRoot, ...mains].filter((r): r is string => Boolean(r)))];
      const [media, studies, document, askedByAgent] = await Promise.all([
        replyMedia(task.reply),
        replyStudies(task.reply, roots),
        replyDocument(task.reply, task.cwd ?? task.projectRoot),
        task.operatorAsked && task.askedFrom ? insideCheckout(task.askedFrom) : Promise.resolve(false),
      ]);
      return { ...task, shows, media, studies, document, askedByAgent };
    }));
  }

  private async readPosts(windowStart: number): Promise<RuntimePost[]> {
    if (!this.deps.posts) return [];
    return this.deps.posts.list(Math.max(windowStart, this.table.postMark)).catch(error => {
      console.warn("[feed] posts", error instanceof Error ? error.message : error);
      return [];
    });
  }

  private async readShows(since: number): Promise<Map<string, RuntimeShow[]>> {
    const out = new Map<string, RuntimeShow[]>();
    if (!this.deps.shows) return out;
    const busiest = [...this.roots.entries()].sort((a, b) => b[1] - a[1]).slice(0, FEED_MAX_SHOW_ROOTS).map(([root]) => root);
    const now = this.now();
    await Promise.all(busiest.map(async (root) => {
      const held = this.shows.get(root);
      if (held && now - held.at < CONTEXT_FRESH_MS) { out.set(root, held.value); return; }
      const value = await this.deps.shows!.list(root, since).catch((error) => {
        console.warn("[feed] shows", root, error instanceof Error ? error.message : error);
        return held?.value ?? [];
      });
      this.shows.set(root, { at: now, value });
      out.set(root, value);
    }));
    return out;
  }

  private namedPullsAt = 0;
  private async readPulls(named: Map<string, { root: string | null; repos: string[]; refs: PullRef[] }>, repos: Record<string, string>): Promise<WebFeedPull[]> {
    if (!this.deps.pulls) return [];
    // Don't let an alphabetically early, one-off reference displace the
    // operator's most active repository from the shared reader's budget.
    const counts = new Map<string, number>();
    for (const { repos: refs } of named.values()) for (const repo of refs) counts.set(repo, 1 + (counts.get(repo) ?? 0));
    const chosen = [...new Set([...Object.values(repos), ...counts.keys()])]
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)).slice(0, SWARM_PULLS_MAX_REPOS);
    const wanted = new Map<string, Set<number>>();
    for (const { root, refs } of named.values()) for (const ref of refs) {
      const repo = ref.repo ?? (root && repos[root]);
      if (!repo) continue;
      if (!wanted.has(repo)) wanted.set(repo, new Set());
      wanted.get(repo)!.add(ref.number);
    }
    const prior = this.table.context.pulls;
    const fetchNamed = this.deps.namedPulls && this.now() - this.namedPullsAt >= 60_000 ? this.deps.namedPulls : null;
    if (fetchNamed) this.namedPullsAt = this.now();
    const reads = await Promise.all(chosen.map(async repo => {
      const read = await this.deps.pulls!.list(repo).catch(() => null);
      // A failed lookup is not an unmerge.
      const facts = new Map(prior.filter(p => p.repo === repo && (read?.warning || !read || wanted.get(repo)?.has(p.number))).map(p => [p.number, p]));
      const listed = new Set<number>();
      for (const p of read?.pulls ?? []) { facts.set(p.number, feedPull(p)); listed.add(p.number); }
      if (fetchNamed) {
        const missing = [...(wanted.get(repo) ?? [])].filter(n => !listed.has(n) && facts.get(n)?.state !== "merged");
        for (const p of await fetchNamed(repo, missing)) facts.set(p.number, feedPull(p));
      }
      return [...facts.values()].sort((a, b) => b.number - a.number);
    }));
    return reads.flat();
  }

  /**
   * The attention queue, whole, read at most every half minute. Older than that, a queue under CONTEXT_STALE_MS
   * answers at once and the next is read behind it (For you then says `pending`), since reading it captures every pane.
   */
  async readRequests(): Promise<OperatorAttentionItem[]> {
    if (!this.deps.requests) return [];
    const held = this.requests;
    const age = held ? this.now() - held.at : Infinity;
    if (held && age < CONTEXT_FRESH_MS) return held.value;
    if (held && age < CONTEXT_STALE_MS) {
      void this.rereadRequests();
      return held.value;
    }
    return this.rereadRequests();
  }

  private rereadRequests(): Promise<OperatorAttentionItem[]> {
    this.requestsRead ??= this.deps.requests!()
      .catch(() => this.requests?.value ?? [])
      .then((value) => {
        this.requests = { at: this.now(), value };
        return value;
      })
      .finally(() => { this.requestsRead = null; });
    return this.requestsRead;
  }

  private async readAttention(): Promise<FeedAttention[]> {
    if (this.deps.requests) return attentionForFeed(await this.readRequests());
    if (!this.deps.attention) return [];
    const now = this.now();
    if (this.attention && now - this.attention.at < CONTEXT_FRESH_MS) return this.attention.value;
    const value = await this.deps.attention().catch(() => this.attention?.value ?? []);
    this.attention = { at: now, value };
    return value;
  }

  private async readLocalBranches(repos: Record<string, string>): Promise<string[]> {
    if (!this.deps.localBranches) return [];
    const now = this.now();
    const out: string[] = [];
    await Promise.all(Object.entries(repos).map(async ([root, repo]) => {
      // Worktrees share their checkout's branches: read each repository once, from its shortest root.
      if (Object.keys(repos).some((other) => other !== root && repos[other] === repo && other.length < root.length)) return;
      const held = this.branches.get(root);
      let names = held && now - held.at < CONTEXT_FRESH_MS ? held.value : null;
      if (!names) {
        names = await this.deps.localBranches!(root).catch(() => held?.value ?? []);
        this.branches.set(root, { at: now, value: names });
      }
      for (const name of names) out.push(`${repo}:${name}`);
    }));
    return out.sort();
  }

  /** A local branch's stat for its push card, read at most every half minute. */
  private async readBranchStat(root: string, branch: string): Promise<BranchStat | null> {
    if (!this.deps.branchStat) return null;
    const key = `${root}\0${branch}`;
    const now = this.now();
    const held = this.branchStats.get(key);
    if (held && now - held.at < CONTEXT_FRESH_MS) return held.value;
    let read = this.branchStatReads.get(key);
    if (!read) {
      read = this.deps.branchStat(root, branch)
        .catch(() => held?.value ?? null)
        .then((value) => {
          this.branchStats.set(key, { at: this.now(), value });
          return value;
        })
        .finally(() => this.branchStatReads.delete(key));
      this.branchStatReads.set(key, read);
    }
    // A held stat answers while the next is read behind it.
    if (held && now - held.at < CONTEXT_STALE_MS) return held.value;
    return read;
  }

  /**
   * For you as cards: the attention queue's requests, then the posts Home
   * hands back, each read by the rules and joined with its kept digest.
   * Never waits on a model.
   */
  async forYou(): Promise<ForYouResponse> {
    await this.ready();
    const now = this.now();
    const requests = await this.readRequests();
    const heads = this.table.handbackHeads();
    const posts = await Promise.all(heads.map(async (head): Promise<ForYouSource | null> => {
      if (head.forYou?.reason === "draft") {
        const draft = head.prs.find((p) => p.state === "draft");
        return postSource(head, { diff: draft ? await this.diff(draft.key) : null });
      }
      if (head.forYou?.reason === "local_branch") {
        const branch = /^Left on (.+), no pull request$/.exec(head.forYou.label)?.[1];
        const root = head.owner?.cwd ?? null;
        return postSource(head, { branch: branch && root ? await this.readBranchStat(root, branch) : null });
      }
      return postSource(head);
    }));
    // Ready is not read as an ask: its card would call it a question. Home draws it as Ready, with Continue and Hold.
    const sources = [...requests.filter((r) => r.kind !== "ready").map(requestSource), ...posts.filter((p): p is ForYouSource => Boolean(p))];
    const digester = this.deps.digester ?? (this.rulesOnly ??= new ForYouDigester({ model: null, store: memoryDigestStore() }));
    const { cards, pending } = digester.cards(sources);
    // A queue read behind the one these cards came from: the page reads again shortly, as it does for a digest.
    return { generatedAt: now, cards, pending: pending || this.requestsRead !== null, model: { available: digester.available } };
  }

  /** A list read never commissions a summary, not even after a format reset. */
  async summaries(ids: readonly string[]): Promise<FeedSummaries> {
    const summaries = this.deps.summaries;
    if (!summaries) return { summaries: {}, pending: false, available: false };
    await this.ready();
    const requests = ids.flatMap(id => this.table.request(id) ?? []);
    return { summaries: Object.fromEntries(requests.map(r => [r.postId, this.table.summary(r.postId)])), pending: summaries.pending(requests), available: true };
  }

  /** The per-file stat of a pull request, read once per head commit (a merged one never changes). */
  async diff(key: string): Promise<FeedDiffStat | null> {
    const pull = this.table.pull(key);
    if (!pull || !this.deps.pullFiles) return null;
    const cacheKey = `${key}@${pull.state === "merged" ? "merged" : pull.at ?? ""}`;
    if (this.diffs.has(cacheKey)) return this.diffs.get(cacheKey)!;
    const stat = await this.deps.pullFiles(pull.repo, pull.number).catch(() => null);
    this.diffs.set(cacheKey, stat);
    if (this.diffs.size > DIFF_CACHE) this.diffs.delete(this.diffs.keys().next().value!);
    return stat;
  }
}

/* ── default sources ───────────────────────────────────────────────────── */

async function ghPullFiles(repo: string, number: number): Promise<FeedDiffStat | null> {
  const result = await execSystemFile("gh", ["pr", "view", String(number), "--repo", repo, "--json", "files,headRefOid"], {
    timeoutMs: 15_000,
    maxStdoutBytes: 2 * 1024 * 1024,
    maxStderrBytes: 64 * 1024,
  });
  return parseGhPullFiles(result.stdout);
}

/** Commits and lines a branch holds that the default branch does not. */
export async function gitBranchStat(root: string, branch: string): Promise<BranchStat | null> {
  if (!/^[\w./-]+$/.test(branch) || branch.startsWith("-")) return null;
  const run = (args: string[]) => execSystemFile("git", ["-C", root, ...args], { timeoutMs: 5_000, maxStdoutBytes: 64 * 1024, maxStderrBytes: 16 * 1024 }).catch(() => null);
  for (const base of ["origin/main", "main", "origin/master"]) {
    const count = await run(["rev-list", "--count", `${base}..refs/heads/${branch}`]);
    if (!count) continue;
    const short = await run(["diff", "--shortstat", `${base}...refs/heads/${branch}`]);
    const text = short?.stdout ?? "";
    const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
    return { commits: Number(count.stdout.trim()) || 0, additions: num(/(\d+) insertion/), deletions: num(/(\d+) deletion/) };
  }
  return null;
}

async function gitUnmergedBranches(root: string): Promise<string[]> {
  for (const base of ["origin/main", "main", "origin/master"]) {
    const result = await execSystemFile("git", ["-C", root, "for-each-ref", `--no-merged=${base}`, "--format=%(refname:short)", "refs/heads"], {
      timeoutMs: 5_000,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 16 * 1024,
    }).catch(() => null);
    if (result) return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

/* ── routes ────────────────────────────────────────────────────────────── */

function notModified(c: Context, version: number): Response {
  return c.body(null, 304, { "cache-control": "no-store", "x-feed-version": String(version) });
}

export function mountFeedRoutes(app: Hono, deps: FeedRouteDeps): FeedService {
  const service = new FeedService({
    ...deps,
    shows: deps.shows ?? (deps.brokerUrl ? runtimeShowSource(deps.brokerUrl) : undefined),
    posts: deps.posts ?? (deps.brokerUrl ? runtimePostSource(deps.brokerUrl) : undefined),
    namedPulls: deps.namedPulls ?? (deps.pulls ? undefined : readNamedPulls),
    pulls: deps.pulls ?? sharedSwarmPullsReader(),
    localBranches: deps.localBranches ?? gitUnmergedBranches,
    branchStat: deps.branchStat ?? gitBranchStat,
    pullFiles: deps.pullFiles ?? ghPullFiles,
  });
  const now = () => (deps.now ?? Date.now)();
  const outside = new OutsideReader(deps.slack ?? null, now);
  // A hide or an undo is written into the projection at once, so the next read already leaves it out.
  if (deps.hides) mountFeedHideRoutes(app, deps.hides, now, async () => service.applyMarks());
  // A move is written into the projection at once too, so the next read shows it on its post.
  if (deps.moves) mountFeedMoveRoutes(app, deps.moves, now, async () => service.applyMarks());

  // Home's and the Feed's other reads, in one answer. Each part is empty when its source has nothing.
  app.get("/api/feed/sources", async (c) => {
    try {
      const [slack] = await Promise.all([
        outside.read(),
        service.table.quotaMark ? undefined : service.refreshQuota().catch(() => {}),
        service.ready(),
      ]);
      const at = now();
      const hides = new Map((deps.hides?.list(at) ?? []).map((h) => [h.id, h.at]));
      const body: FeedSources = {
        generatedAt: at,
        outside: slack && hides.size ? { ...slack, threads: slack.threads.filter((t) => !hiddenBy(hides, t.id, t.at)) } : slack,
        quota: service.table.quota(at).filter((e) => !hiddenBy(hides, e.id, e.crossedAt)),
        activity: activityGrid(service.table.activityPosts(), at),
      };
      return c.json(body, 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[feed] sources", error);
      return c.json({ error: "could not read the feed's sources" }, 500);
    }
  });

  // A host-local pull, not a ranked page: includes older days, all kinds and removals.
  app.get("/api/feed/slots", async (c) => {
    const raw = c.req.query("since");
    const since = parseSince(raw);
    if (raw !== undefined && since === null) return c.json({ error: "since must be a nonnegative integer" }, 400);
    try {
      await service.ready();
      const batch = service.table.pullSlots(since, now());
      return batch ? c.json(batch, 200, { "cache-control": "no-store" }) : notModified(c, service.table.version);
    } catch (error) {
      console.error("[feed] slots", error);
      return c.json({ error: "could not read Feed slots" }, 500);
    }
  });

  app.get("/api/feed", async (c) => {
    const view = parseView(c.req.query("view"));
    const since = parseSince(c.req.query("since"));
    const cursorRaw = c.req.query("cursor");
    const cursor = cursorRaw && DAY_KEY.test(cursorRaw) ? cursorRaw : null;
    try {
      await service.ready();
      const res = service.table.response(view, { since, cursor, now: now(), debug: c.req.query("debug") === "rank" });
      if (!res) return notModified(c, service.table.version);
      return c.json(res, 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[feed]", error);
      return c.json({ error: "could not read the feed" }, 500);
    }
  });

  app.get("/api/feed/post/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await service.ready();
      const detail = service.table.detail(id);
      if (!detail) return c.json({ error: "no such post" }, 404);
      // The per-file diff is read only here, for the expanded post: the change's pull request.
      const pull = service.table.head(id)?.change?.pull ?? null;
      const body: FeedPostDetail = { ...detail, diff: pull ? await service.diff(pull) : null };
      return c.json(body, 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[feed] post", error);
      return c.json({ error: "could not read the post" }, 500);
    }
  });

  app.get("/api/feed/for-you", async (c) => {
    try {
      return c.json(await service.forYou(), 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[feed] for-you", error);
      return c.json({ error: "could not read For you" }, 500);
    }
  });

  app.get("/api/feed/summaries", async (c) => {
    const ids = [...new Set((c.req.query("posts") ?? "").split(",").map((id) => id.trim()).filter(Boolean))].slice(0, SUMMARY_IDS_MAX);
    try {
      return c.json(await service.summaries(ids), 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[feed] summaries", error);
      return c.json({ error: "could not read the summaries" }, 500);
    }
  });

  // A screenshot from a pull request's description, by its place there; only the stored reference is served.
  const prImages = createPrImageReader();
  app.get("/api/feed/pr-image", async (c) => {
    const key = c.req.query("pull") ?? "";
    const index = Number(c.req.query("i"));
    const image = Number.isInteger(index) && index >= 0 ? service.table.pull(key)?.images?.[index] : undefined;
    const read = image ? prImages(image.url) : null;
    if (!read) return c.json({ error: "no such picture" }, 404);
    if ("redirect" in read) return c.redirect(read.redirect, 302);
    try {
      const bytes = await read.bytes;
      return new Response(bytes, { headers: { "content-type": read.type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
    } catch {
      return c.json({ error: "could not read the picture" }, 502);
    }
  });

  app.get("/api/feed/live", async (c) => {
    try {
      await service.ready();
      const live = service.table.live(parseSince(c.req.query("since")));
      if (!live) return notModified(c, service.table.version);
      return c.json(live, 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[feed] live", error);
      return c.json({ error: "could not read running sessions" }, 500);
    }
  });

  app.get("/api/feed/asset/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f]{16}$/.test(id)) return c.body(null, 404);
    const named = service.table.file(id);
    // Checked again now: the file may have moved since the writer saw it.
    const real = named ? await checkMediaFile(named) : null;
    if (!real) return c.body(null, 404);
    const info = await stat(real);
    const kind = mediaKind(real);
    const ext = real.slice(real.lastIndexOf(".") + 1).toLowerCase();
    const type = kind === "video" ? videoType(real) ?? "application/octet-stream" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    const headers: Record<string, string> = {
      "content-type": type,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
    };
    const range = byteRange(c.req.header("range"), info.size);
    if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${info.size}` } });
    if (range) {
      return new Response(Bun.file(real).slice(range.start, range.end + 1), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${info.size}`, "content-length": String(range.end - range.start + 1) },
      });
    }
    return new Response(Bun.file(real), { headers: { ...headers, "content-length": String(info.size) } });
  });

  return service;
}
