/**
 * Review: the pull requests behind the window, read from GitHub with gh. See shared/review-window.ts (ReviewGithub).
 *
 * Which pull requests. Each project the Review payload shows has GitHub remotes (upstream, then origin). Their pull
 * requests come from the list /swarm reads too (routes/swarm-pulls.ts: one `gh pr list --state all` per repository,
 * at most once a minute). A pull request belongs to the window when its head is a branch the window's commits or
 * worktrees are on (a fork's head only when that fork is one of the project's remotes), or a squash commit names its
 * number; and it is open, or it moved after the window opened.
 *
 * What of them. One `gh api graphql` query per repository reads their reviews, review threads, conversation, the
 * head commit's checks and their state changes, 8 pull requests to a query. A pull request's read is kept until the
 * list shows it changed (its updatedAt or its state); an open one's for 3 minutes at most, since checks move without
 * changing it.
 *
 * Bounds: 6 repositories (only projects with a branch or squash to match), 60 pull requests each, 4 queries of 8
 * each per build; text cleaned, clipped and budgeted; one build at a time, kept a minute. When gh is missing, signed out, offline or slow, the pulls are empty, or keep their
 * last read, and a warning says why. Read-only: `gh pr list`, GraphQL queries and `git config`; nothing that writes.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { execSystemFile } from "@openscout/runtime/system-probes";
import { execGit, type Git } from "./review-window.ts";
import { ghFailure, sharedSwarmPullsReader, type SwarmPullState } from "./routes/swarm-pulls.ts";
import type {
  ReviewCheckState, ReviewChecks, ReviewCommit, ReviewData, ReviewGithub, ReviewPull, ReviewPullEvent, ReviewPullReview,
  ReviewSaid, ReviewSaidRefs, ReviewThread,
} from "../shared/review-window.ts";

/* ---------- bounds ---------- */
export const REVIEW_GITHUB_REPOS = 6;
/** pull requests kept per repository; past the first 32 read this build, the rest keep their last read or show the list's state */
export const REVIEW_GITHUB_PULLS_PER_REPO = 60;
const PER_QUERY = 8;
const QUERIES_PER_REPO = 4;
const TTL = 60_000;
const OPEN_FRESH = 180_000;
const DETAIL_CACHE = 400;
const REMOTES_TTL = 600_000;
const QUERY_TIMEOUT = 12_000;
const QUERY_STDOUT = 16 * 1024 * 1024;
/** characters of text per build; past it, each body keeps its first line or so */
const TEXT_BUDGET = 1_500_000;
const CLIP = { pull: 1200, review: 1500, comment: 1500, thread: 1200, spent: 160 };
const SKIP_HEADS = new Set(["", "HEAD", "main", "master"]);

/* ---------- gh ---------- */
/** gh with these arguments; its stdout, or a throw that ghFailure() can name. */
export type Gh = (args: string[], opts: { timeoutMs: number; maxStdoutBytes: number }) => Promise<string>;

const execGh: Gh = async (args, opts) => (await execSystemFile("gh", args, {
  ...opts,
  maxStderrBytes: 64 * 1024,
  env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
})).stdout;

export type PullList = (repo: string) => Promise<{ pulls: SwarmPullState[]; warning: string | null }>;

/* ---------- remotes ---------- */
const GH_REMOTE = /^(?:git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/|https?:\/\/(?:[^@/\s]+@)?github\.com\/|git:\/\/github\.com\/)([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/u;

/** A remote URL → "owner/name", lowercase, when it is on github.com. */
export function githubRepoOf(url: string): string | null {
  const m = GH_REMOTE.exec(url.trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** `git config --get-regexp ^remote\..*\.url$` → the GitHub repositories of upstream, then origin. */
export function githubRemotes(out: string): string[] {
  const byName = new Map<string, string>();
  for (const l of out.split("\n")) {
    const m = /^remote\.(.+)\.url\s+(\S+)$/u.exec(l.trim());
    const repo = m ? githubRepoOf(m[2]!) : null;
    if (m && repo && !byName.has(m[1]!)) byName.set(m[1]!, repo);
  }
  return [...new Set([byName.get("upstream"), byName.get("origin")].filter((x): x is string => Boolean(x)))];
}

/* ---------- text ---------- */
/** GitHub markdown made fit to show as text: HTML comments, images and folded sections out, blank runs closed. */
export function cleanBody(s: string | null | undefined): string {
  let t = (s || "").replace(/\r\n/gu, "\n").replace(/<!--[\s\S]*?-->/gu, "");
  // a folded section keeps its summary, innermost first
  for (let k = 0; k < 20; k++) {
    const next = t.replace(/<details\b[^>]*>((?:(?!<details\b)[\s\S])*?)<\/details>/iu, (_, inner: string) => {
      const sum = /<summary\b[^>]*>([\s\S]*?)<\/summary>/iu.exec(inner);
      const label = sum ? sum[1]!.replace(/<[^>]+>/gu, "").trim() : "";
      return label ? `[folded: ${label}]` : "";
    });
    if (next === t) break;
    t = next;
  }
  t = t.replace(/<(picture|svg)\b[\s\S]*?<\/\1>/giu, "").replace(/<img\b[^>]*>/giu, "").replace(/!\[[^\]]*\]\([^)]*\)/gu, "");
  return t.replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export class Budget {
  constructor(public left: number) {}
  clip(s: string, max: number): { body: string; cut: number } {
    const cap = this.left > 0 ? max : CLIP.spent;
    const body = s.length > cap ? s.slice(0, cap) : s;
    this.left -= body.length;
    return { body, cut: s.length - body.length };
  }
}

/** An explicit verdict near the start of what an agent wrote: "approve", "changes", or "". */
export function verdictOf(text: string): string {
  const head = text.slice(0, 400);
  if (/\b(?:REQUEST(?:S|ED)?[ _]CHANGES|CHANGES[ _]REQUESTED)\b/u.test(head)) return "changes";
  if (/\bAPPROVE[SD]?\b/u.test(head)) return "approve";
  return "";
}

/* ---------- what a comment names ---------- */
/** What one project's window holds, for the names a comment quotes. */
export type Known = {
  project: string;
  /** sha, first 12 → Review commit id */
  commits: Map<string, string>;
  /** paths in the repository, by their last segment */
  paths: Map<string, string[]>;
  /** Scout agent ids */
  agents: Set<string>;
};

export function knownOf(data: ReviewData, project: string): Known {
  const commits = new Map<string, string>();
  for (const c of data.commits) if (c.repo === project) commits.set(c.id.slice(0, 12), c.id);
  const paths = new Map<string, string[]>(), seen = new Set<string>();
  const add = (key: string) => {
    if (!key.startsWith(project + ":")) return;
    const rel = key.slice(project.length + 1);
    if (!rel || seen.has(rel)) return;
    seen.add(rel);
    const leaf = rel.slice(rel.lastIndexOf("/") + 1);
    const list = paths.get(leaf);
    if (list) list.push(rel); else paths.set(leaf, [rel]);
  };
  for (const f of data.files) add(data.strs[f[2]] || "");
  for (const ch of data.changes) add(ch.key);
  const agents = new Set<string>();
  for (const a of data.actors) if (a[1] !== "person" && a[4] && a[4].length >= 8 && /[-.]/u.test(a[4])) agents.add(a[4]);
  return { project, commits, paths, agents };
}

function commitNamed(hex: string, k: Known): string | null {
  if (hex.length >= 12) return k.commits.get(hex.slice(0, 12)) ?? null;
  let hit: string | null = null;
  for (const [sha, id] of k.commits) if (sha.startsWith(hex)) { if (hit) return null; hit = id; }
  return hit;
}

function pathNamed(token: string, k: Known): string | null {
  const leaf = token.slice(token.lastIndexOf("/") + 1);
  const list = k.paths.get(leaf);
  if (!list) return null;
  // the token is the path, or ends with it (a URL, a worktree folder): the longest such path
  let best: string | null = null;
  for (const p of list) if ((token === p || token.endsWith("/" + p)) && (!best || p.length > best.length)) best = p;
  if (best) return best;
  // the token is the end of one path, and only one
  const ends = list.filter((p) => p.endsWith("/" + token));
  return ends.length === 1 ? ends[0]! : null;
}

/** The commits, files (with a line) and agents a comment names that the window has. */
export function refsOf(text: string, k: Known): ReviewSaidRefs | undefined {
  const t = text.slice(0, 8000);
  const commits = new Set<string>();
  for (const m of t.matchAll(/[0-9a-f]{7,}/gu)) {
    // "exact head<sha>" runs a hex word into the sha: a long run is tried by its last 40, then its first 40
    const run = m[0];
    for (const x of run.length > 40 ? [run.slice(-40), run.slice(0, 40)] : [run]) {
      const id = commitNamed(x, k);
      if (id) { commits.add(id); break; }
    }
    if (commits.size >= 12) break;
  }
  const files = new Map<string, number>();
  for (const m of t.matchAll(/(?:[\w.@~+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]{1,8}(?:(?::|#L)(\d{1,6}))?/gu)) {
    const token = m[0].replace(/(?::|#L)\d+$/u, "");
    const rel = pathNamed(token, k);
    if (!rel) continue;
    const key = `${k.project}:${rel}`, line = m[1] ? Number(m[1]) : 0;
    if (!files.has(key) || (!files.get(key) && line)) files.set(key, line);
    if (files.size >= 12) break;
  }
  const agents = new Set<string>();
  if (k.agents.size) {
    for (const m of t.matchAll(/[A-Za-z0-9][\w.:@-]{6,80}/gu)) {
      const id = m[0].replace(/[.:-]+$/u, "");
      if (k.agents.has(id)) agents.add(id);
      if (agents.size >= 8) break;
    }
  }
  if (!commits.size && !files.size && !agents.size) return undefined;
  return {
    ...(commits.size ? { commits: [...commits] } : {}),
    ...(files.size ? { files: [...files].map(([key, line]) => ({ key, line })) } : {}),
    ...(agents.size ? { agents: [...agents] } : {}),
  };
}

/* ---------- which pull requests ---------- */
export type Candidate = { repo: string; project: string; list: SwarmPullState; primary: boolean };

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const isOpen = (p: SwarmPullState) => p.state === "open" || p.state === "draft";

/**
 * A project's pull requests that belong to the window. `repos` are its GitHub repositories, upstream first: a squash
 * commit's number is read against the first, a head against all of them.
 */
export function selectPulls(input: {
  project: string;
  repos: string[];
  lists: ReadonlyMap<string, readonly SwarmPullState[]>;
  heads: ReadonlySet<string>;
  numbers: ReadonlySet<number>;
  from: number;
  cap?: number;
}): { picked: Candidate[]; dropped: Map<string, number> } {
  const owners = new Set(input.repos.map((r) => r.split("/")[0]!));
  const picked: Candidate[] = [], dropped = new Map<string, number>();
  input.repos.forEach((repo, ri) => {
    const mine: Candidate[] = [];
    for (const p of input.lists.get(repo) ?? []) {
      const byHead = input.heads.has(p.head) && (!p.cross || owners.has(p.headOwner));
      const byNumber = ri === 0 && input.numbers.has(p.number);
      if (!byHead && !byNumber) continue;
      const moved = ms(p.updatedAt) >= input.from || ms(p.mergedAt ?? p.closedAt) >= input.from;
      if (!isOpen(p) && !moved && !byNumber) continue;
      mine.push({ repo, project: input.project, list: p, primary: ri === 0 });
    }
    mine.sort((a, b) => Number(isOpen(b.list)) - Number(isOpen(a.list)) || (ms(b.list.updatedAt) || 0) - (ms(a.list.updatedAt) || 0));
    const cap = input.cap ?? REVIEW_GITHUB_PULLS_PER_REPO;
    if (mine.length > cap) dropped.set(repo, mine.length - cap);
    picked.push(...mine.slice(0, cap));
  });
  return { picked, dropped };
}

/** The branches and squash numbers of one project's window: what a pull request must match to belong. */
export function projectHeads(data: ReviewData, project: string): { heads: Set<string>; numbers: Set<number> } {
  const heads = new Set<string>(), numbers = new Set<number>();
  const mainBranch = data.wts.find((w) => w[0] === project && w[1] === "main")?.[4] || "";
  for (const c of data.commits) {
    if (c.repo !== project) continue;
    if (c.branch) heads.add(c.branch);
    for (const n of [c.merged, c.mergedAs]) if (n && /^\d{1,7}$/u.test(n)) numbers.add(Number(n));
  }
  for (const w of data.wts) if (w[0] === project && w[4]) heads.add(w[4]);
  for (const h of [...heads]) if (SKIP_HEADS.has(h) || h === mainBranch) heads.delete(h);
  return { heads, numbers };
}

/* ---------- GraphQL ---------- */
type GActor = { __typename?: string; login?: string | null; slug?: string | null } | null;
type GConn<T> = { totalCount?: number; nodes?: (T | null)[] | null } | null;
type GComment = { author?: GActor; body?: string | null; createdAt?: string | null; url?: string | null; diffHunk?: string | null; originalCommit?: { oid?: string } | null };
type GContext = { __typename?: string; name?: string; status?: string; conclusion?: string | null; detailsUrl?: string | null; startedAt?: string | null; completedAt?: string | null; context?: string; state?: string; targetUrl?: string | null; createdAt?: string | null };
export type GPull = {
  number?: number; createdAt?: string | null; body?: string | null; author?: GActor;
  additions?: number; deletions?: number; changedFiles?: number;
  reviewDecision?: string | null; mergeable?: string | null;
  reviewRequests?: GConn<{ requestedReviewer?: GActor }>;
  commits?: GConn<{ commit?: { oid?: string } | null }>;
  tip?: GConn<{ commit?: { oid?: string; statusCheckRollup?: { state?: string; contexts?: GConn<GContext> } | null } | null }>;
  reviews?: GConn<{ author?: GActor; state?: string; submittedAt?: string | null; body?: string | null; url?: string | null; comments?: { totalCount?: number } | null }>;
  reviewThreads?: GConn<{ path?: string; line?: number | null; startLine?: number | null; originalLine?: number | null; originalStartLine?: number | null; diffSide?: string | null; isResolved?: boolean; isOutdated?: boolean; subjectType?: string | null; comments?: GConn<GComment> }>;
  comments?: GConn<GComment>;
  timelineItems?: GConn<{ __typename?: string; createdAt?: string | null; actor?: GActor; requestedReviewer?: GActor; previousRefName?: string | null; currentRefName?: string | null }>;
};

const ACTOR = "__typename login";
const REVIEWER = "__typename ... on User { login } ... on Bot { login } ... on Team { slug } ... on Mannequin { login }";
const PULL_FIELDS = `fragment P on PullRequest {
  number createdAt body author { ${ACTOR} } additions deletions changedFiles reviewDecision mergeable
  reviewRequests(first: 10) { nodes { requestedReviewer { ${REVIEWER} } } }
  commits(last: 100) { totalCount nodes { commit { oid } } }
  tip: commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 40) { totalCount nodes { __typename
    ... on CheckRun { name status conclusion detailsUrl startedAt completedAt }
    ... on StatusContext { context state targetUrl createdAt } } } } } } }
  reviews(last: 30) { totalCount nodes { author { ${ACTOR} } state submittedAt body url comments { totalCount } } }
  reviewThreads(last: 40) { totalCount nodes { path line startLine originalLine originalStartLine diffSide isResolved isOutdated subjectType
    comments(first: 8) { totalCount nodes { author { ${ACTOR} } body createdAt url diffHunk originalCommit { oid } } } } }
  comments(last: 30) { totalCount nodes { author { ${ACTOR} } body createdAt url } }
  timelineItems(last: 50, itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, REVIEW_REQUESTED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_CHANGED_EVENT]) {
    nodes { __typename
      ... on ReadyForReviewEvent { createdAt actor { ${ACTOR} } }
      ... on ConvertToDraftEvent { createdAt actor { ${ACTOR} } }
      ... on MergedEvent { createdAt actor { ${ACTOR} } }
      ... on ClosedEvent { createdAt actor { ${ACTOR} } }
      ... on ReopenedEvent { createdAt actor { ${ACTOR} } }
      ... on ReviewRequestedEvent { createdAt actor { ${ACTOR} } requestedReviewer { ${REVIEWER} } }
      ... on HeadRefForcePushedEvent { createdAt actor { ${ACTOR} } }
      ... on BaseRefChangedEvent { createdAt actor { ${ACTOR} } previousRefName currentRefName } } }
}`;

/** One query for n pull requests of one repository: numbers and names go in as variables, never into the text. */
export function pullsQuery(n: number): string {
  const vars = Array.from({ length: n }, (_, i) => `$p${i}: Int!`).join(", ");
  const sel = Array.from({ length: n }, (_, i) => `p${i}: pullRequest(number: $p${i}) { ...P }`).join(" ");
  return `${PULL_FIELDS}\nquery($o: String!, $n: String!, ${vars}) { viewer { login } rateLimit { remaining } repository(owner: $o, name: $n) { ${sel} } }`;
}

export function pullsQueryArgs(repo: string, numbers: readonly number[]): string[] {
  const [owner, name] = repo.split("/");
  return ["api", "graphql", "-f", `query=${pullsQuery(numbers.length)}`, "-f", `o=${owner}`, "-f", `n=${name}`,
    ...numbers.flatMap((x, i) => ["-F", `p${i}=${x}`])];
}

export type PullsAnswer = { me: string; remaining: number | null; pulls: Map<number, GPull> };

export function parsePullsAnswer(stdout: string): PullsAnswer | null {
  let parsed: { data?: { viewer?: { login?: string }; rateLimit?: { remaining?: number }; repository?: Record<string, GPull | null> | null } };
  try { parsed = JSON.parse(stdout); } catch { return null; }
  const d = parsed?.data;
  if (!d || typeof d !== "object") return null;
  const pulls = new Map<number, GPull>();
  for (const p of Object.values(d.repository ?? {})) if (p && typeof p.number === "number") pulls.set(p.number, p);
  return { me: typeof d.viewer?.login === "string" ? d.viewer.login : "", remaining: typeof d.rateLimit?.remaining === "number" ? d.rateLimit.remaining : null, pulls };
}

/* ---------- one pull request ---------- */
const nodes = <T>(c: GConn<T> | undefined): T[] => (c?.nodes ?? []).filter((x): x is T => x != null);
const who = (a: GActor | undefined) => ({ by: a?.login || a?.slug || "ghost", bot: a?.__typename === "Bot" || /\[bot\]$/u.test(a?.login || "") });
const sha12 = (oid: string | undefined) => (oid || "").slice(0, 12);

const DECISION: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "required" };
const MERGEABLE: Record<string, string> = { MERGEABLE: "clean", CONFLICTING: "conflict" };
const REVIEW_STATE: Record<string, ReviewPullReview["state"]> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", COMMENTED: "commented", DISMISSED: "dismissed" };
const EVENT: Record<string, ReviewPullEvent["kind"]> = {
  ReadyForReviewEvent: "ready", ConvertToDraftEvent: "draft", MergedEvent: "merged", ClosedEvent: "closed", ReopenedEvent: "reopened",
  ReviewRequestedEvent: "requested", HeadRefForcePushedEvent: "pushed", BaseRefChangedEvent: "base",
};
const ROLLUP: Record<string, ReviewChecks["state"]> = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "pending", EXPECTED: "pending" };
const CHECK_ORDER: Record<ReviewCheckState, number> = { fail: 0, pending: 1, cancelled: 2, pass: 3, skip: 4 };

function checkState(c: GContext): ReviewCheckState {
  if (c.__typename === "StatusContext") {
    const s = c.state || "";
    return s === "SUCCESS" ? "pass" : s === "PENDING" || s === "EXPECTED" ? "pending" : "fail";
  }
  if (c.status && c.status !== "COMPLETED") return "pending";
  const k = c.conclusion || "";
  if (k === "SUCCESS") return "pass";
  if (k === "NEUTRAL" || k === "SKIPPED") return "skip";
  if (k === "CANCELLED") return "cancelled";
  return "fail";
}

/** A read pull request (GraphQL), as the window shows it. `known` maps what its text names; times are from `from`. */
export function pullFromGraph(
  base: { id: string; repo: string; project: string; list: SwarmPullState },
  g: GPull | null,
  ctx: { from: number; known: Known; budget: Budget },
): ReviewPull {
  const { list } = base, { from, known, budget } = ctx;
  const sec = (iso: string | null | undefined) => { const t = ms(iso); return Number.isFinite(t) ? Math.round((t - from) / 1000) : null; };
  const said = (c: GComment | { author?: GActor; body?: string | null; url?: string | null }, at: string | null | undefined, max: number): ReviewSaid => {
    const text = cleanBody(c.body), refs = refsOf(text, known);
    return { ...who(c.author), t: sec(at) ?? 0, ...budget.clip(text, max), url: c.url || "", ...(refs ? { refs } : {}), says: verdictOf(text) };
  };
  const ended = list.state === "merged" ? sec(list.mergedAt ?? list.closedAt) : list.state === "closed" ? sec(list.closedAt) : null;
  const pull: ReviewPull = {
    id: base.id, repo: base.repo, number: list.number, project: base.project, title: list.title, url: list.url, state: list.state,
    ...who(g?.author), head: list.head, base: list.base, fork: list.cross ? list.headOwner : "", stackedOn: list.stackedOn,
    opened: sec(g?.createdAt ?? list.createdAt) ?? sec(list.updatedAt) ?? 0, ended, updated: sec(list.updatedAt) ?? 0,
    body: "", cut: 0, wts: [], commits: [], commitCount: 0, add: 0, del: 0, files: 0,
    decision: "", mergeable: "", requested: [], checks: null, reviews: [], threads: [], comments: [], events: [],
    more: { reviews: 0, threads: 0, comments: 0 }, read: false,
  };
  // not read this time: the list's state and times only; who opened it is not known
  if (!g) { pull.by = ""; pull.bot = false; return pull; }
  pull.read = true;
  Object.assign(pull, budget.clip(cleanBody(g.body), CLIP.pull));
  pull.commitCount = g.commits?.totalCount ?? 0;
  pull.add = g.additions ?? 0; pull.del = g.deletions ?? 0; pull.files = g.changedFiles ?? 0;
  pull.decision = DECISION[g.reviewDecision || ""] ?? "";
  pull.mergeable = MERGEABLE[g.mergeable || ""] ?? "";
  pull.requested = nodes(g.reviewRequests).map((r) => r.requestedReviewer?.login || r.requestedReviewer?.slug || "").filter(Boolean);
  const tip = nodes(g.tip)[0]?.commit, roll = tip?.statusCheckRollup;
  if (roll && ROLLUP[roll.state || ""]) {
    const runs = nodes(roll.contexts).map((c) => ({
      name: c.name || c.context || "", state: checkState(c), url: c.detailsUrl || c.targetUrl || "",
      t: sec(c.completedAt ?? c.startedAt ?? c.createdAt),
    })).sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state]);
    pull.checks = { state: ROLLUP[roll.state || ""]!, sha: sha12(tip?.oid), runs: runs.slice(0, 20), total: roll.contexts?.totalCount ?? runs.length };
  }
  const reviews = nodes(g.reviews).filter((r) => REVIEW_STATE[r.state || ""]);
  pull.reviews = reviews.map((r) => ({ ...said(r, r.submittedAt, CLIP.review), state: REVIEW_STATE[r.state || ""]!, n: r.comments?.totalCount ?? 0 }));
  pull.threads = nodes(g.reviewThreads).filter((th) => th.path).map((th): ReviewThread => {
    const cs = nodes(th.comments), first = cs[0], sha = sha12(first?.originalCommit?.oid);
    const hunk = (first?.diffHunk || "").split("\n").slice(-6).join("\n").slice(-600);
    return {
      key: `${base.project}:${th.path}`, path: th.path!, line: th.line ?? null, start: th.startLine ?? null,
      oline: th.originalLine ?? null, ostart: th.originalStartLine ?? null, side: th.diffSide === "LEFT" ? "L" : "R",
      commit: (sha && known.commits.get(sha)) || "", sha, resolved: Boolean(th.isResolved), outdated: Boolean(th.isOutdated),
      file: th.subjectType === "FILE", hunk,
      comments: cs.map((c) => said(c, c.createdAt, CLIP.thread)),
      more: Math.max(0, (th.comments?.totalCount ?? cs.length) - cs.length),
    };
  });
  pull.comments = nodes(g.comments).map((c) => said(c, c.createdAt, CLIP.comment));
  pull.events = nodes(g.timelineItems).filter((e) => EVENT[e.__typename || ""]).map((e) => {
    const kind = EVENT[e.__typename || ""]!;
    const ev: ReviewPullEvent = { t: sec(e.createdAt) ?? 0, kind, ...who(e.actor) };
    if (kind === "requested") ev.what = e.requestedReviewer?.login || e.requestedReviewer?.slug || "";
    if (kind === "base") { ev.what = e.currentRefName || ""; ev.was = e.previousRefName || ""; }
    return ev;
  });
  pull.more = {
    reviews: Math.max(0, (g.reviews?.totalCount ?? 0) - nodes(g.reviews).length),
    threads: Math.max(0, (g.reviewThreads?.totalCount ?? 0) - nodes(g.reviewThreads).length),
    comments: Math.max(0, (g.comments?.totalCount ?? 0) - nodes(g.comments).length),
  };
  return pull;
}

/**
 * Ties one project's pull requests to the window's commits and worktrees. Each commit goes to one pull request, the
 * one with the best claim on it:
 * 1. a squash names its number;
 * 2. GitHub lists its sha, on a pull request whose head is the commit's branch;
 * 3. GitHub lists its sha elsewhere: the pull request with the fewest commits, since a fork's pull request against
 *    its own stale main lists hundreds of commits that are other pull requests';
 * 4. no sha matches (a rebase or force-push changed it): its branch, the first pull request on it still open when the
 *    commit was made. Never for a squash: git can reach main's squashes through any branch made after them.
 */
export function joinProject(data: ReviewData, pulls: ReviewPull[], oids: ReadonlyMap<string, ReadonlySet<string>>, primary: ReadonlySet<string>): void {
  if (!pulls.length) return;
  const project = pulls[0]!.project;
  const mine = data.commits.filter((c) => c.repo === project);
  const of = new Map<ReviewPull, Set<string>>(pulls.map((p) => [p, new Set<string>()]));
  for (const c of mine) {
    let best: ReviewPull | null = null, rank = Infinity;
    for (const p of pulls) {
      const squash = primary.has(p.repo) && (c.mergedAs === String(p.number) || c.merged === String(p.number));
      const sha = oids.get(p.id)?.has(c.id.slice(0, 12));
      const r = squash ? 0 : sha && c.branch && p.head === c.branch ? 1 : sha ? 2 + p.commitCount / 1e6 : Infinity;
      if (r < rank) { rank = r; best = p; }
    }
    if (!best && c.branch && !c.merged) {
      best = pulls.filter((p) => p.head === c.branch && (p.ended ?? Infinity) >= c.t - 600)
        .sort((a, b) => (a.ended ?? Infinity) - (b.ended ?? Infinity))[0] ?? null;
    }
    if (best) of.get(best)!.add(c.id);
  }
  const byId = new Map<string, ReviewCommit>(mine.map((c) => [c.id, c]));
  for (const p of pulls) {
    p.commits = mine.filter((c) => of.get(p)!.has(c.id)).map((c) => c.id);
    // a fork's head counts too: selectPulls kept only forks that are this project's remotes
    const folders = new Set<string>();
    for (const w of data.wts) if (w[0] === project && w[2] && w[4] && w[4] === p.head) folders.add(w[2]);
    for (const id of p.commits) { const w = data.wts[byId.get(id)?.w ?? -1]; if (w?.[2]) folders.add(w[2]); }
    p.wts = [...folders];
  }
}

/* ---------- the service ---------- */
export type ReviewGithubOptions = {
  review: { data(days: number): Promise<ReviewData> };
  /** every recent pull request of a repository; default the list /swarm reads (routes/swarm-pulls.ts) */
  list?: PullList;
  gh?: Gh;
  git?: Git;
  home?: string;
  now?: () => number;
};

type Detail = { fp: string; at: number; g: GPull };

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await f(items[i++]!); }));
}

/** The reasons that say gh itself cannot read GitHub: one warning for all repositories. */
const WHOLE = new Set(["gh is not installed", "gh is not signed in", "GitHub could not be reached", "GitHub's rate limit is used up"]);

export function createReviewGithubService(options: ReviewGithubOptions) {
  const gh = options.gh ?? execGh, git = options.git ?? execGit, home = options.home ?? homedir(), now = options.now ?? Date.now;
  const list: PullList = options.list ?? ((repo) => sharedSwarmPullsReader().list(repo));
  const remotes = new Map<string, { at: number; p: Promise<string[]> }>();
  const details = new Map<string, Detail>();
  const cache = new Map<number, { at: number; p: Promise<ReviewGithub> }>();
  let tail: Promise<unknown> = Promise.resolve();
  let me = "";

  const abs = (p: string) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);
  const remotesOf = (main: string): Promise<string[]> => {
    const hit = remotes.get(main);
    if (hit && now() - hit.at < REMOTES_TTL) return hit.p;
    const p = git(main, ["config", "--get-regexp", "^remote\\..*\\.url$"], { timeout: 2000 }).then((out) => githubRemotes(out || ""));
    remotes.set(main, { at: now(), p });
    return p;
  };

  /** Reads the pull requests whose last read is stale; a repository whose query fails keeps what it had. */
  async function readDetails(repo: string, picks: Candidate[], warnings: string[], rate: { low: number | null }) {
    const fpOf = (c: Candidate) => `${c.list.updatedAt}|${c.list.state}`;
    const stale = picks.filter((c) => {
      const d = details.get(`${repo}#${c.list.number}`);
      return !d || d.fp !== fpOf(c) || (isOpen(c.list) && now() - d.at >= OPEN_FRESH);
    });
    // the first of them by priority (open first, then the latest moved); later builds reach the rest
    for (let q = 0; q < QUERIES_PER_REPO && q * PER_QUERY < stale.length; q++) {
      const chunk = stale.slice(q * PER_QUERY, (q + 1) * PER_QUERY);
      let answer: PullsAnswer | null = null;
      try {
        answer = parsePullsAnswer(await gh(pullsQueryArgs(repo, chunk.map((c) => c.list.number)), { timeoutMs: QUERY_TIMEOUT, maxStdoutBytes: QUERY_STDOUT }));
        if (!answer) throw new Error("not a GraphQL answer");
      } catch (error) {
        warnings.push(`${repo}: reviews and comments unavailable: ${ghFailure(error)}`);
        return;
      }
      if (answer.me) me = answer.me;
      if (answer.remaining != null) rate.low = Math.min(rate.low ?? Infinity, answer.remaining);
      for (const c of chunk) {
        const g = answer.pulls.get(c.list.number);
        if (g) details.set(`${repo}#${c.list.number}`, { fp: fpOf(c), at: now(), g });
      }
    }
    const left = stale.length - QUERIES_PER_REPO * PER_QUERY;
    if (left > 0) warnings.push(`${repo}: ${left} pull requests wait for a later read`);
    while (details.size > DETAIL_CACHE) details.delete(details.keys().next().value!);
  }

  async function build(days: number): Promise<ReviewGithub> {
    const data = await options.review.data(days);
    const warnings: string[] = [];
    const busy = new Map<string, number>();
    for (const c of data.commits) busy.set(c.repo, (busy.get(c.repo) || 0) + 1);
    const projects = Object.keys(data.projects).sort((a, b) => (busy.get(b) || 0) - (busy.get(a) || 0) || a.localeCompare(b));

    /* each project's GitHub repositories, the busiest projects first; a project with no branch or squash to match has none to read */
    const want = new Map(projects.map((project) => [project, projectHeads(data, project)]));
    const matchable = projects.filter((project) => want.get(project)!.heads.size || want.get(project)!.numbers.size);
    const byProject = new Map<string, string[]>(), owner = new Map<string, string>();
    await pool(matchable, 4, async (project) => { byProject.set(project, await remotesOf(abs(data.projects[project]!))); });
    let capped = 0;
    for (const project of matchable) {
      const kept: string[] = [];
      for (const repo of byProject.get(project) ?? []) {
        if (owner.has(repo)) continue;
        if (owner.size >= REVIEW_GITHUB_REPOS) { capped++; continue; }
        owner.set(repo, project);
        kept.push(repo);
      }
      byProject.set(project, kept);
    }
    if (capped) warnings.push(`pull requests are read for the ${REVIEW_GITHUB_REPOS} busiest repositories only`);

    /* the lists, then the pull requests that belong */
    const lists = new Map<string, SwarmPullState[]>(), failed = new Map<string, string>();
    await pool([...owner.keys()], 4, async (repo) => {
      const r = await list(repo);
      lists.set(repo, r.pulls);
      if (r.warning) failed.set(repo, r.warning.startsWith(repo + ": ") ? r.warning.slice(repo.length + 2) : r.warning);
    });
    const reasons = new Set(failed.values());
    if (failed.size && failed.size === owner.size && reasons.size === 1 && WHOLE.has([...reasons][0]!)) warnings.push(`${[...reasons][0]}: pull requests are not shown`);
    else for (const [repo, why] of failed) warnings.push(`${repo}: ${why}`);

    const picks: Candidate[] = [];
    for (const project of projects) {
      const repos = byProject.get(project) ?? [];
      if (!repos.length) continue;
      const { heads, numbers } = want.get(project)!;
      const { picked, dropped } = selectPulls({ project, repos, lists, heads, numbers, from: data.from });
      picks.push(...picked);
      for (const [repo, n] of dropped) warnings.push(`${repo}: ${n} more pull requests not read`);
    }

    /* their reviews, threads, conversation, checks and state changes */
    const rate = { low: null as number | null };
    const byRepo = new Map<string, Candidate[]>();
    for (const c of picks) { const l = byRepo.get(c.repo); if (l) l.push(c); else byRepo.set(c.repo, [c]); }
    await pool([...byRepo], 2, ([repo, cs]) => readDetails(repo, cs, warnings, rate));
    if (rate.low != null && rate.low < 250) warnings.push(`GitHub's rate limit is low: ${rate.low} points left this hour`);

    /* as the window shows them */
    const budget = new Budget(TEXT_BUDGET), knowns = new Map<string, Known>();
    const pulls: ReviewPull[] = [], oids = new Map<string, Set<string>>();
    for (const c of picks) {
      const known = knowns.get(c.project) ?? knownOf(data, c.project);
      knowns.set(c.project, known);
      const id = `${c.repo}#${c.list.number}`, g = details.get(id)?.g ?? null;
      pulls.push(pullFromGraph({ id, repo: c.repo, project: c.project, list: c.list }, g, { from: data.from, known, budget }));
      if (g) oids.set(id, new Set(nodes(g.commits).map((n) => sha12(n.commit?.oid)).filter(Boolean)));
    }
    const primary = new Set([...byProject.values()].map((r) => r[0]).filter((x): x is string => Boolean(x)));
    for (const project of projects) joinProject(data, pulls.filter((p) => p.project === project), oids, primary);
    pulls.sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));

    const repos = [...owner].map(([repo, project]) => ({ project, repo, read: !failed.has(repo) }));
    return { from: data.from, at: now(), me, repos, pulls, warnings };
  }

  /** One build at a time; each day count's answer is kept a minute. */
  function get(days: number): Promise<ReviewGithub> {
    const hit = cache.get(days);
    if (hit && now() - hit.at < TTL) return hit.p;
    const p = tail.then(() => build(days), () => build(days));
    tail = p.catch(() => undefined);
    cache.set(days, { at: now(), p });
    p.catch(() => { if (cache.get(days)?.p === p) cache.delete(days); });
    return p;
  }

  return {
    /** the pull requests behind the window, joined to the Review payload of the same day count */
    data: get,
    json: async (days: number) => JSON.stringify(await get(days)),
  };
}
export type ReviewGithubService = ReturnType<typeof createReviewGithubService>;
