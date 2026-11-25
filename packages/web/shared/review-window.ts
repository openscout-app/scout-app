/**
 * Review: what the agents did in a window, read by time, by artifact and by worktree.
 *
 * Built on the server (server/review-window.ts) from the World payload, git, and the files as they are now.
 * Read by the Review screen (client/screens/review). A file has a current state; its only past versions are its
 * commits. Nothing is rebuilt between commits.
 *
 * Paths in this payload are home-relative ("~/…"). Times are seconds from `from`.
 */

/** What a touched or committed file holds now. The text head or image is fetched on demand from /api/ops/review-file. */
export type ReviewCurrent = {
  /** where it was read: the worktree that touched it, or the project's main checkout when that worktree is gone */
  path: string;
  /** seconds from `from`; -1 when gone */
  mt: number;
  /** worktree index the copy was read from, -1 when unknown */
  w: number;
  gone?: boolean;
  image?: boolean;
  /** outside the folders previews may read (world-files.ts): listed, never served */
  closed?: boolean;
};

export type ReviewSession = {
  sid: string;
  /** the full session id, as the harness and the session route name it */
  id?: string;
  h: string;
  /** actor index of the Scout agent this session served, -1 when none */
  agent: number;
  turns: [number, number][];
  colds: [number, number][];
  errs: [number, number, number, number][];
};

export type ReviewCommit = {
  id: string;
  repo: string;
  t: number;
  subj: string;
  branch: string;
  /** PR number on a GitHub squash commit */
  merged: string;
  /** PR number a branch commit landed as */
  mergedAs?: string;
  /** session index, -1 when no session in the record made it */
  s: number;
  /** worktree index: where it was made, else the worktree on its branch, else the main checkout */
  w: number;
  /** "commit" when a session ran git commit, "edits" when matched by its edits, "" when unknown */
  how: string;
};

export type ReviewJudge = { score: number; why: string; key: number; quiet: number[] };

export type ReviewChange = {
  id: string;
  /** commit id */
  c: string;
  /** artifact key: "<project>:<path in repo>" */
  key: string;
  path: string;
  add: number;
  del: number;
  isNew: boolean;
  isGone: boolean;
  kind: string;
  hunks: number;
  shape: number;
  shapeWhy: string;
  patch: string;
  /** lines of patch not kept */
  cut: number;
  j?: ReviewJudge;
};

/** [opened, closed|-1, state, requester actor, target actor, task str, error str, kind, session|-1] */
export type ReviewAsk = [number, number, string, number, number, number, number, string, number];

export type ReviewData = {
  from: number;
  now: number;
  host: string;
  days: number;
  kinds: string[];
  strs: string[];
  /**
   * [project, worktree name ("main" for the main checkout), folder ("~/…", "" when unknown), 1 when the folder is gone,
   * the branch it has checked out ("" when detached, gone or unknown)]. The branch is how a pull request finds its
   * worktree (ReviewPull.wts).
   */
  wts: [string, string, string, 0 | 1, string?][];
  /** project → its main checkout ("~/…") */
  projects: Record<string, string>;
  /** [path str, worktree, artifact key str] */
  files: [number, number, number][];
  /** [secs, session, kind, tool str, worktree, file, target str, added, removed], sorted by time */
  calls: number[][];
  sessions: ReviewSession[];
  /** [name, kind, project, harness, Scout agent id] */
  actors: [string, string, string, string, string][];
  asks: ReviewAsk[];
  commits: ReviewCommit[];
  changes: ReviewChange[];
  /** artifact key → current state */
  current: Record<string, ReviewCurrent>;
  /** JSON [artifact key, worktree index] → current copy, with no sibling fallback. */
  currentByWorktree?: Record<string, ReviewCurrent>;
};

/** The head of a text file as it is now: GET /api/ops/review-file?p=…&as=head */
export type ReviewFileHead = { path: string; head: string; lines: number; mt: number };

/** A text file's source as it is now, for the code pane: GET /api/ops/review-file?p=…&as=text. `cut` counts the lines not sent. */
export type ReviewFileText = { path: string; text: string; lines: number; cut: number; mt: number };

/* ---------- GitHub: the pull requests behind the window ---------- */

/**
 * GET /api/ops/review-github?days=N (server/review-github.ts): the pull requests behind this window's branches and
 * commits, with their reviews, review threads, conversation, checks and state changes, read from GitHub with `gh`.
 *
 * It joins the Review payload by that payload's own stable keys, never by index: project names (`projects`),
 * worktree folders (`wts[i][2]`), Review commit ids (`ReviewCommit.id`), artifact keys (`ReviewChange.key`) and
 * Scout agent ids (`actors[i][4]`). Times are seconds from `from`, the `from` of the Review build it was joined to;
 * `reviewGithubShift` moves them onto a build with another `from`. Text is GitHub markdown written by people and
 * bots: show it as text, never as HTML.
 */
export type ReviewGithub = {
  from: number;
  /** when it was assembled, ms */
  at: number;
  /** the login gh reads as. Its comments are the operator's, or an agent's that used the operator's gh. "" when unknown */
  me: string;
  /** each project's GitHub repositories, upstream first, and whether its pull requests could be read */
  repos: { project: string; repo: string; read: boolean }[];
  pulls: ReviewPull[];
  /** what could not be read, one line each: gh missing, signed out, offline, a repository that failed */
  warnings: string[];
};

export type ReviewPullState = "open" | "draft" | "merged" | "closed";

export type ReviewPull = {
  /** "owner/name#N" */
  id: string;
  /** "owner/name" on GitHub, lowercase */
  repo: string;
  number: number;
  /** the Review project it belongs to */
  project: string;
  title: string;
  url: string;
  state: ReviewPullState;
  /** who opened it */
  by: string;
  bot: boolean;
  /** its branch, and the branch it merges into */
  head: string;
  base: string;
  /** the owner of the head branch's repository when that is another repository (a fork's pull request), else "" */
  fork: string;
  /** the open pull request this one is stacked on: the one whose head is its base */
  stackedOn: number | null;
  /** seconds from `from`, negative before the window */
  opened: number;
  /** when it merged or closed, null while open */
  ended: number | null;
  updated: number;
  /** its description, cleaned and clipped (ReviewSaid) */
  body: string;
  cut: number;
  /** worktree folders, as `wts[i][2]`, that have its branch checked out or made its commits */
  wts: string[];
  /** the Review commits that are its commits: matched by sha, else by branch when a rebase changed the sha */
  commits: string[];
  /** its commits on GitHub, including the ones the window does not show */
  commitCount: number;
  add: number;
  del: number;
  files: number;
  /** GitHub's review decision: "approved", "changes", "required", or "" when the repository asks for none */
  decision: string;
  /** "clean", "conflict", or "" while GitHub has not worked it out */
  mergeable: string;
  /** reviewers asked who have not answered: logins, or team slugs */
  requested: string[];
  /** the head commit's checks, null when it has none */
  checks: ReviewChecks | null;
  reviews: ReviewPullReview[];
  /** review threads, each on one file and line */
  threads: ReviewThread[];
  /** the conversation: comments on the pull request itself */
  comments: ReviewSaid[];
  /** state changes; the opening is `opened` */
  events: ReviewPullEvent[];
  /** what GitHub holds beyond what was read */
  more: { reviews: number; threads: number; comments: number };
  /** false when its reviews and comments could not be read this time (see warnings): the lists above are empty */
  read: boolean;
};

/** Something someone wrote on a pull request. */
export type ReviewSaid = {
  by: string;
  bot: boolean;
  t: number;
  /** markdown, with HTML comments, images and folded sections taken out, clipped */
  body: string;
  /** characters not sent */
  cut: number;
  url: string;
  /** what it names that the window shows; absent when nothing */
  refs?: ReviewSaidRefs;
  /**
   * An explicit verdict near its start, as agents write them in comments ("review APPROVE", "REQUEST CHANGES"):
   * "approve", "changes", or "". Read from the text: a review's own `state` is GitHub's.
   */
  says: string;
};

/** Things a comment names, kept only when the window has them. */
export type ReviewSaidRefs = {
  /** Review commit ids, from the commit shas it quotes */
  commits?: string[];
  /** artifact keys, from the repository paths it quotes; `line` 0 when none was given */
  files?: { key: string; line: number }[];
  /** Scout agent ids it names, as `actors[i][4]` */
  agents?: string[];
};

export type ReviewPullReview = ReviewSaid & {
  state: "approved" | "changes" | "commented" | "dismissed";
  /** comments it left in threads */
  n: number;
};

export type ReviewThread = {
  /** artifact key, "<project>:<path>" */
  key: string;
  path: string;
  /** the line in the pull request's head, null when outdated or about the whole file; `start` opens a range */
  line: number | null;
  start: number | null;
  /** the line where it was written, in `commit`'s version of the file */
  oline: number | null;
  ostart: number | null;
  /** "R" on the new side, "L" on a removed line */
  side: "L" | "R";
  /** the commit it was written on: a Review commit id when the window has it, else "" */
  commit: string;
  /** that commit's sha, first 12 */
  sha: string;
  resolved: boolean;
  outdated: boolean;
  /** about the whole file, not a line */
  file: boolean;
  /** the last lines of the diff it was written on */
  hunk: string;
  comments: ReviewSaid[];
  /** replies not read */
  more: number;
};

export type ReviewPullEvent = {
  t: number;
  kind: "ready" | "draft" | "merged" | "closed" | "reopened" | "requested" | "pushed" | "base";
  by: string;
  bot: boolean;
  /** the reviewer asked ("requested"), or the new base ("base") */
  what?: string;
  /** the old base ("base") */
  was?: string;
};

export type ReviewCheckState = "pass" | "fail" | "pending" | "skip" | "cancelled";

export type ReviewChecks = {
  /** GitHub's roll-up for the head commit */
  state: "pass" | "fail" | "pending";
  /** the head commit's sha, first 12 */
  sha: string;
  /** failing first, then pending; at most 20 */
  runs: { name: string; state: ReviewCheckState; url: string; t: number | null }[];
  total: number;
};

/** One moment of a pull request, for a timeline: its opening, its state changes, its reviews and its comments. */
export type ReviewMoment = {
  t: number;
  kind: "opened" | ReviewPullEvent["kind"] | ReviewPullReview["state"] | "comment";
  by: string;
  bot: boolean;
  /** where it came from, and its index there (-1 for the opening) */
  src: "pull" | "events" | "reviews" | "comments";
  i: number;
};

/**
 * A pull request's moments, in time order. Threads are not moments of their own: every thread comment belongs to a
 * review, so the review marks the time and the thread marks the file and line.
 */
export function reviewPullMoments(p: ReviewPull): ReviewMoment[] {
  const out: ReviewMoment[] = [{ t: p.opened, kind: "opened", by: p.by, bot: p.bot, src: "pull", i: -1 }];
  p.events.forEach((e, i) => out.push({ t: e.t, kind: e.kind, by: e.by, bot: e.bot, src: "events", i }));
  p.reviews.forEach((r, i) => out.push({ t: r.t, kind: r.state, by: r.by, bot: r.bot, src: "reviews", i }));
  p.comments.forEach((c, i) => out.push({ t: c.t, kind: "comment", by: c.by, bot: c.bot, src: "comments", i }));
  return out.sort((a, b) => a.t - b.t || (a.src === "pull" ? -1 : b.src === "pull" ? 1 : 0));
}

/** Seconds to add to a ReviewGithub time to place it on a Review payload whose `from` differs. */
export function reviewGithubShift(gh: Pick<ReviewGithub, "from">, data: Pick<ReviewData, "from">): number {
  return Math.round((gh.from - data.from) / 1000);
}

export const REVIEW_HEAD_LINES = 40;
export const REVIEW_TEXT_LINES = 10_000;
export const REVIEW_DAYS_DEFAULT = 2;
export const REVIEW_DAYS_MAX = 7;

const IMG = /\.(png|jpe?g|gif|webp)$/i;
const DOC = /\.(md|mdx|txt|html)$/i;
const TEST = /(\.test\.|\.spec\.|(^|\/)tests?\/|Tests?\/)/;
const GEN = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Package\.resolved)$|llms-full\.txt$|\.snap$|(^|\/)dist\/|\.generated\.|\.min\.(js|css)$|\.pbxproj$/;

export const isReviewImage = (p: string) => IMG.test(p);
export const isReviewDoc = (p: string) => DOC.test(p);
export const isReviewGenerated = (p: string) => GEN.test(p);

/** What kind of file a path is, for ranking and filters. */
export function kindOfPath(p: string): string {
  if (GEN.test(p)) return "generated";
  if (IMG.test(p)) return "image";
  if (TEST.test(p)) return "test";
  if (DOC.test(p)) return "doc";
  if (/\.(css|scss)$/i.test(p)) return "style";
  if (/\.(json|ya?ml|toml|plist|xcconfig|entitlements)$/i.test(p)) return "config";
  return "code";
}

/** An artifact key → its project (null outside any repo) and its path in that project. */
export function splitArtKey(key: string): { repo: string | null; rel: string } {
  if (key.startsWith("~") || key.startsWith("/")) return { repo: null, rel: key.replace(/^~\//, "") };
  const i = key.indexOf(":");
  return i > 0 ? { repo: key.slice(0, i), rel: key.slice(i + 1) } : { repo: null, rel: key };
}
