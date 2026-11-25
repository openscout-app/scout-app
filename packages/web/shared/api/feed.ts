/**
 * The Feed's contract. One canonical feed is computed on the server
 * (server/feed/table.ts); the Feed page and Home render views of it.
 *
 *   GET /api/feed?view=all|reviewed|following|home&cursor=<day>&since=<version>
 *     -> FeedResponse, or 304 when nothing changed since <version>
 *   GET /api/feed/post/:id      -> FeedPostDetail  (the ask, body, earlier updates, all PRs, diff)
 *   GET /api/feed/slots?since=<version> -> unranked host-local slots, including removals, or 304
 *   GET /api/feed/live?since=   -> FeedLive, or 304 (running sessions, versioned)
 *   GET /api/feed/asset/:id     -> the bytes of an image or video a lead names
 *
 * The list carries heads only. Bodies, the per-file diff and video load on view.
 * Post ids are stable, so a client patches in place.
 * server/feed/DESIGN.md has the blocks, the cost model and the contract.
 */
import type { FeedMove } from "./feed-moves.ts";

/* ── sources: what the server reads, never sent whole ──────────────────── */

export type WebFeedShow = {
  id: string;
  itemId: string;
  name: string;
  kind: "image" | "video" | "document" | "other";
  mediaType: string;
  caption: string | null;
  at: number;
};

/** A derived `presentation` record (arach/scout#193), read only while it names the item's current version. */
export type WebFeedPresentation = {
  status: "current" | "stale" | "missing";
  title: string | null;
  caption: string | null;
};

/** An image or video file the reply names, checked on disk. */
export type WebFeedMedia = { path: string; kind: "image" | "video" };

/** A study page the reply names, with its poster on disk when one exists. */
export type WebFeedStudy = { path: string; href: string | null; poster: string | null };

/** An agent's own post (`scout post`), on its own turn or joined to the task it was about. */
export type WebFeedAgentPost = {
  id: string;
  text: string;
  milestone: boolean;
  links: FeedLink[];
  at: number;
};

export type FeedLink = { url: string; title: string | null };

export type WebFeedTask = {
  id: string;
  title: string;
  /** "working" is a task still running; it appears on /live, not as a finished turn. */
  state: "done" | "review" | "working";
  /** The operator accepted the work (acceptanceState "accepted"). Core never sets it yet. */
  accepted: boolean;
  /** The operator asked for it (requestedById). */
  operatorAsked: boolean;
  /** The folder the ask was sent from (its message's senderContext.cwd), when it recorded one. */
  askedFrom: string | null;
  /**
   * The ask came under the operator's name from a session working in a
   * project checkout: an agent asking another (a review, a verification),
   * not the operator's own request. Core does not record who sent an ask
   * made "as" the operator, so this is read from where it was sent.
   */
  askedByAgent: boolean;
  ownerId: string | null;
  ownerName: string | null;
  /** The owner's harness, from its newest endpoint. */
  harness: string | null;
  /** The session recorded on this turn's invocation, not the owner's current endpoint. */
  sessionId: string | null;
  conversationId: string | null;
  parentId: string | null;
  parentTitle: string | null;
  /** The owner's main checkout. */
  projectRoot: string | null;
  /** Where the owner worked: a linked worktree, or the main checkout. */
  cwd: string | null;
  /** The worktree's branch, when the endpoint recorded one. */
  branch: string | null;
  createdAt: number;
  updatedAt: number;
  /** When the final reply arrived, or when the task last changed. */
  finishedAt: number;
  /** The owner's reply to this turn: its id, and its text, capped. */
  replyId: string | null;
  reply: string | null;
  /** The operator's first message after the final reply. */
  operator: { id: string | null; text: string; at: number } | null;
  presentation: WebFeedPresentation;
  shows: WebFeedShow[];
  media: WebFeedMedia[];
  studies: WebFeedStudy[];
  /** A delivered document named in the reply and checked on disk. Never served by the media route. */
  document?: { path: string; kind: "file" | "deck" } | null;
  /** The agent's own post: the whole turn for a post no task covers, else the newest one joined to this task. */
  agentPost?: WebFeedAgentPost | null;
};

export type WebFeedPull = {
  /** "owner/name#123", lowercase. */
  key: string;
  repo: string;
  number: number;
  state: "open" | "draft" | "merged" | "closed";
  title: string;
  url: string;
  head: string;
  at: number | null;
  additions: number | null;
  deletions: number | null;
  /** Files the pull request changes, as GitHub counts them; null from an older read. */
  files: number | null;
  /** The screenshots its description shows, first few; absent from an older read. */
  images?: { alt: string; url: string }[];
};

/* ── the contract ──────────────────────────────────────────────────────── */

export type FeedViewId = "all" | "reviewed" | "following" | "home";

/** What a post shows first. A diff is never one: it is the change's size, on the head's meta line. */
export type FeedLeadKind = "video" | "visual" | "live" | "page" | "text";

export type FeedDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  /** "tests", "routes", "migrations", "ui", "docs", or null. */
  area: string | null;
};

export type FeedDiffStat = {
  additions: number;
  deletions: number;
  files: number;
  /** The largest few files. */
  top: FeedDiffFile[];
  /** Areas the change touches, most lines first. */
  areas: string[];
  /** The commit the stat was read at; the cache key. */
  sha: string | null;
};

export type FeedLead =
  | { kind: "video"; ref: { asset: string; name: string; caption: string | null; source: "show" | "reply" } }
  | { kind: "visual"; ref: { asset: string; name: string; caption: string | null; source: "show" | "reply" | "study" | "pull" } }
  | { kind: "live"; ref: { workId: string; sessionId: string | null } }
  | { kind: "page"; ref: { path: string; href: string | null } }
  | { kind: "text"; ref: null };

/** The size of what a post's work changed: its strongest pull request, as GitHub counts it. */
export type FeedChange = { pull: string; files: number | null; additions: number | null; deletions: number | null };

export type FeedPr = {
  key: string;
  /** "#1950" in the feed's main repository, "scout#204" elsewhere. */
  label: string;
  title: string;
  state: WebFeedPull["state"];
  url: string;
};

export type FeedAgent = { name: string; harness: string | null };

/**
 * For you: work handed back to the operator. Attention is a queue item on the
 * thread's work or conversation; a draft is an open draft pull request; a
 * local branch is an unmerged branch with no pull request.
 */
export type FeedForYou = { reason: "attention" | "draft" | "local_branch"; label: string };

export type FeedPostHead = {
  /** Host-scoped slot key: <origin>:thread:<session>, <origin>:work:<work> or <origin>:post:<publication>. */
  id: string;
  /** The projection sequence that last changed this head. */
  version: number;
  /** The working day, "2026-11-16"; a day turns over at 4am. */
  day: string;
  at: number;
  class: "for_you" | "landed" | "routine";
  /** The operator's own words are on it. Without them it is "Agent, not reviewed". */
  reviewed: boolean;
  /** Among its day's top few; the rest fold. */
  selected: boolean;
  /** Intrinsic points; debug=rank adds recency and the repeat costs at selection. */
  score: number;
  /** Outcome: the kept turn summary or a recorded outcome. */
  title: string;
  /** The original ask, or the rest of a standalone publication. */
  caption: string | null;
  writtenBy: "presentation" | "reply" | "agent";
  line: { text: string; at: number } | null;
  /**
   * The operator's latest move on it from the Feed or Home (shared/api/feed-moves.ts),
   * kept by the web server across restarts and rebuilds. Absent when there was none.
   */
  move?: FeedMove | null;
  agent: FeedAgent;
  /** Everyone else on the thread. */
  others: number;
  thread: string | null;
  state: "done" | "review";
  lead: FeedLead;
  /** The change's size, for one quiet meta line; the per-file diff is only in the detail. */
  change: FeedChange | null;
  /**
   * Code-only posts folded under this one: the posts just before it in its
   * day, from the same known session, with no separate artifact or question.
   * Newest first. Their heads come in the same response; the day lists only this one.
   */
  joined: string[];
  /** The thread's pull requests, the first few; `prCount` has them all. */
  prs: FeedPr[];
  prCount: number;
  forYou: FeedForYou | null;
  /**
   * Back to you: the session's turn ended on work the operator asked for, it
   * replied, the operator has not written on it since, and nothing on the
   * thread is running. It waits for the operator's next move.
   */
  backToYou: boolean;
  /**
   * Back to you, settled by what happened next: the turn's own pull requests
   * (its branch's, else the ones its reply names, else its ask's) have all
   * merged or closed since. A merged turn shows in Landed, not Back to you; a
   * closed one leaves Home. Absent when the turn has no pull request, or one
   * of them is still open.
   */
  settled?: FeedSettled | null;
  /** The first screenshot in the turn's own pull request descriptions, served by /api/feed/pr-image; absent when none. */
  picture?: FeedPicture | null;
  /** Earlier tasks folded under this one. */
  updates: number;
  workId: string;
  conversationId: string | null;
  /** Where a reaction to the lead task goes: its owner, the owner's harness session and folder. */
  owner: FeedOwner;
  /** The lead task's study page, when the reply names one that opens. */
  study: string | null;
  /**
   * The agent wrote this post itself (`scout post`), or wrote on this task's
   * turn. Its words are the post's; links open from the detail.
   */
  agentPost?: { milestone: boolean; links: FeedLink[]; own: boolean } | null;
  /**
   * The project: the repository of the owner's checkout (a linked worktree
   * counts as its checkout's), else the
   * checkout's folder. Read from where the owner worked, not from the runtime.
   */
  project: string | null;
};

export type FeedSettled = {
  state: "merged" | "closed";
  /** The pull requests that settled it, by label ("#1993", "scout#208"). */
  prs: string[];
  /** When the last of them merged or closed, as GitHub records it. */
  at: number | null;
};

export type FeedPicture = { src: string; alt: string };

export type FeedOwner = { agentId: string | null; sessionId: string | null; cwd: string | null };

export type FeedDay = {
  day: string;
  at: number;
  /** Selected posts, in rank order. */
  ids: string[];
  /** The rest of the day, folded into one quiet row, in rank order. */
  folded: string[];
};

export type FeedHome = {
  /** Work handed back, attention first; each post shows here and nowhere else on Home. */
  forYou: string[];
  /**
   * Finished turns waiting for the operator's next move (FeedPostHead.backToYou),
   * today's and yesterday's, newest first; a post with a question on it stays in forYou.
   */
  backToYou: string[];
  /** Up to four ranked highlights from today and yesterday, excluding turns already placed above. */
  landed: string[];
  /**
   * Turns that were back to you until their pull requests merged
   * (FeedPostHead.settled), today's and yesterday's, newest first. Home shows
   * them in Landed. Absent on an older server.
   */
  shipped?: string[];
  /** Reserved for live posts. Running turns are separate at /api/feed/live. */
  running: string[];
};

export type FeedSize = { posts: number; days: number; reviewed: number };

export type FeedRankKind = "video" | "visual" | "study" | "deck" | "file" | "diff" | "result" | "answer" | "steering";
export type FeedRank = { kind: FeedRankKind; score: number; why: string };

export type FeedResponse = {
  /** Only on debug=rank: the explanation at the point the selector picked each post. */
  ranking?: Record<string, FeedRank>;
  version: number;
  generatedAt: number;
  view: FeedViewId;
  /** true: `posts` is every post in `days`; false: only those changed since `since`. */
  full: boolean;
  posts: FeedPostHead[];
  /** Posts gone since `since` (merged into another thread, reopened, or aged out). */
  removed: string[];
  days: FeedDay[];
  /** The oldest day of this page; pass it back as `cursor` for older days. Null at the end. */
  cursor: string | null;
  size: FeedSize;
  home: FeedHome | null;
  /** Views the data supports; "following" is left out until something records follows. */
  views: FeedViewId[];
};

export type FeedUpdate = {
  id: string;
  at: number;
  title: string;
  agent: FeedAgent;
  prs: FeedPr[];
};

export type FeedBody = {
  landed: string;
  checks: string | null;
  next: string | null;
  open: string | null;
};

export type FeedPostDetail = {
  id: string;
  version: number;
  /** What the lead task was asked to do, in plain words, capped. */
  asked: string | null;
  /** The branch the lead task worked on, when its endpoint recorded one. */
  branch: string | null;
  body: FeedBody;
  earlier: FeedUpdate[];
  prs: FeedPr[];
  /** Every lead the post could take, strongest first. */
  leads: FeedLead[];
  /** The lead pull request's per-file stat; null when there is none or GitHub could not say. */
  diff: FeedDiffStat | null;
  agents: FeedAgent[];
  /** Studies named without a capture: candidates for a derived `poster` record. */
  posterCandidates: string[];
};

export type FeedLiveSession = {
  workId: string;
  postId: string | null;
  title: string;
  agent: FeedAgent;
  /** The owner's newest words in the task's conversation, one or two sentences. */
  snippet: string | null;
  at: number;
  version: number;
};

export type FeedLive = { version: number; sessions: FeedLiveSession[] };

/**
 * GET /api/feed/summaries?posts=<id,id>: each post's newest turn in two
 * lines, written once per turn by the cheap model (server/turn-summary.ts).
 * A post is null until its summary exists, and stays null when the model
 * had nothing to say or failed; the reader keeps the words it has.
 */
export type FeedTurnSummary = {
  /** The turn it is of: a newer turn on the thread gets its own. */
  turnId: string;
  /** Where the work stands, with the specific result or snag. */
  gist: string;
  /** The operator's next move, or null when the turn waits on nothing. */
  ask: string | null;
  /** What the turn needs from the operator, by kind; absent from a summary written before needs. */
  need?: FeedNeed;
};

/**
 * What a turn needs from the operator, as the summary reads it:
 *   decision  pick one of a few short options; `live` is the one already
 *             shipped by default, when the work went one way without an answer
 *   review    look at one thing (the ask says what and where)
 *   question  a free answer (the ask is the question)
 *   none      nothing: the turn does not belong in Back to you
 */
export type FeedNeed =
  | { kind: "decision"; options: string[]; live: string | null }
  | { kind: "review" }
  | { kind: "question" }
  | { kind: "none" };

export type FeedSummaries = {
  summaries: Record<string, FeedTurnSummary | null>;
  /** Some are still being written: read again shortly. */
  pending: boolean;
  /** False when the server has no model path: nothing will ever be written. */
  available: boolean;
};
