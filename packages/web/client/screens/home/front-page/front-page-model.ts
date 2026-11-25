/* ──────────────────────────────────────────────────────────────────────────
   Home's front page: the typed view it renders, mapped from the feed
   engine's Home view (GET /api/feed?view=home).

   The engine decides what shows: For you (work handed back, attention first),
   Landed (the best four over today and yesterday by lead strength, rank and
   time) and the Feed's size. This file only maps those heads into the rows
   Home draws, and puts the runtime's open requests at the top of For you.

   A field the engine does not provide is absent, never filled in.
   Pure: no DOM, no clock of its own.
   ────────────────────────────────────────────────────────────────────────── */

import { plainLine } from "../../../../shared/plain-line.ts";
import { questionWhy, requestWhy, turnWhy, type HomeWhy } from "./home-why.ts";
import type { FeedForYou, FeedHome, FeedLead, FeedPostHead, FeedPr, FeedSize } from "../../../../shared/api/feed.ts";
import type { OperatorAttentionItem, Route } from "../../../lib/types.ts";
import { requestsRoute } from "../../views/modules/requests-view-model.ts";
import { isReadyRequest } from "../../requests/requests-model.ts";
import { currentWindowFill, isQuotaGauge, quotaWindows, usageWindow, type ServiceGauge } from "../quota-gauge.ts";
import { formatResetChip } from "../quota-reset.ts";
import { isGeneratedSessionName } from "../../../lib/harness-session-title.ts";

export type HomeLead =
  | { kind: "video"; src: string; caption: string | null }
  | { kind: "visual"; src: string; caption: string | null }
  | { kind: "page"; label: string; href: string | null }
  | { kind: "text" };

export type HomeRef = { label: string; state: FeedPr["state"]; url: string };

export type HomeAgent = { name: string; harness: string | null };

/** A pull request's size, when the engine read it. */
export type HomeSize = { additions: number; deletions: number };

export type HomePost = {
  id: string;
  at: number;
  title: string;
  /** One sentence for the reader. Null when the work left none. */
  caption: string | null;
  project: string | null;
  agent: HomeAgent | null;
  refs: HomeRef[];
  lead: HomeLead;
  size: HomeSize | null;
  /** Where the post opens in Scout: its conversation. */
  open: Route | null;
};

/** A row in For you: a request from the runtime's queue, or a post the engine handed back. */
export type HomeForYou =
  | (HomePost & { source: "request"; ask: { label: string; route: Route }; item: OperatorAttentionItem; why: HomeWhy })
  | (HomePost & { source: "post"; post: FeedPostHead; reason: FeedForYou; why: HomeWhy });

/**
 * What a finished turn produced, as Home leads with it: a picture, a clip or
 * a page. A change is never the artifact; its size is the post's quiet
 * `size`. `href` opens it; null when nothing opens.
 */
export type HomeArtifact =
  | { kind: "visual" | "video"; src: string; caption: string | null; href: string }
  | { kind: "page"; label: string; href: string | null };

/**
 * A session back to you: its turn ended on work you asked for, it answered,
 * and nothing has been said or started on it since. Led by what it produced;
 * a pull request is one of its references, not its headline.
 */
export type HomeTurn = HomePost & {
  post: FeedPostHead;
  artifact: HomeArtifact | null;
  /** The session the turn ran in, to open it; null when the runtime did not record one. */
  sessionId: string | null;
  /** The turn's identity: a newer turn on the same thread comes back again. */
  turnKey: string;
  /** Why it waits on you: a turn to steer, or its draft, open pull request or unpushed branch. */
  why: HomeWhy;
};

/** What /api/feed?view=home answers with that Home reads. */
export type HomeFeed = { posts: readonly FeedPostHead[]; home: FeedHome | null; size: FeedSize };

export type HomeView = {
  forYou: HomeForYou[];
  /** Finished turns back to you, newest first. */
  backToYou: HomeTurn[];
  /** Turns that were back to you until their pull requests merged, newest first: Landed shows them. */
  shipped: HomeTurn[];
  landed: HomePost[];
  /** The Feed's size; null before the first read. */
  feed: FeedSize | null;
};

export const HOME_FOR_YOU_LIMIT = 4;

function leaf(path: string | null): string | null {
  if (!path) return null;
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

/** The first sentence of a text, for a one-line caption. */
export function firstSentence(text: string, max = 220): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const match = /^(.+?[.!?])(?=\s|$)/.exec(flat);
  const sentence = match?.[1] ?? flat;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/* An id the runtime minted (an invocation, flight, message, ask or work id):
   "inv-request-4306…", "flight-9c2…", "f-mw3k…". Always carries a digit. */
const RUNTIME_ID = /\b(?:inv|flight|flt|f|msg|ask|work)(?:-[a-z]+)*-[a-z0-9]*\d[a-z0-9]*/i;
const BARE_ID = /^[0-9a-f]{8,}(?:-[0-9a-f]{4,})*$/i;
/* A Scout session's own id, as a card or harness names it: "session-mwk08za6-wf2ea5-relay-agent", "Session Mwjmvsub 5l4ad5". */
const SESSION_ID = /\bsession[-_ ](?=[a-z0-9]*\d)[a-z0-9]{6,}[-_ ][a-z0-9]{5,}\b/i;
/* "[ask:f-…]", "[answered]": routing tags a line can open with. */
const ENVELOPE = /^\s*(?:\[[a-z_-]+(?::[^\]]+)?\]\s*)+/i;
/* "Previous task inv-request-4306… (completed):": the runtime's note on what a successor follows. */
const PREVIOUS_TASK = /^\s*previous task\s+\S+\s*(?:\([^)]*\))?\s*:?\s*/i;
/* "[ask:msg-request-…]" or "[answered]" anywhere in a line. */
const TAG = /\[[a-z_-]+(?::[^\]\s]+)?\]\s*/gi;

/**
 * A line of an agent's or the runtime's words with the plumbing taken out: routing tags, the
 * "Previous task … (completed):" preface, and ids the runtime minted. The words are kept as written.
 */
export function readableLine(text: string | null | undefined): string | null {
  let flat = (text ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) flat = flat.replace(PREVIOUS_TASK, "").replace(ENVELOPE, "");
  flat = flat.replace(TAG, "").replace(/\s+/g, " ").trim();
  return /\p{L}{2}/u.test(flat) ? flat : null;
}

/* Words a harness or the runtime puts where a title would go, saying nothing about the work. */
const PLACEHOLDER = /^(?:pasted (?:content|text)(?: #?\d+)?|request|untitled|new (?:session|chat|conversation|task))$/i;
/* A harness's own prompt when it resumes a session: not what the work is about. */
const HARNESS_PROMPT = /^(?:continue from where you left off|this session is being continued|caveat: the messages below)/i;

/**
 * A title a person would read, or null. Refuses runtime ids (anywhere in the
 * line), bare hashes, bracketed record kinds and placeholders such as
 * "Pasted content", or the launch name Scout gives a harness
 * ("claude-a.main.studio-relay-agent"), so the caller falls back to the next
 * name it has.
 */
export function readableTitle(text: string | null | undefined): string | null {
  const flat = (text ?? "").replace(ENVELOPE, "").replace(/\s+/g, " ").trim();
  if (!flat || /^\[[^\]]*\]$/.test(flat) || !/\p{L}{2}/u.test(flat)) return null;
  if (RUNTIME_ID.test(flat) || BARE_ID.test(flat) || SESSION_ID.test(flat) || isGeneratedSessionName(flat)) return null;
  if (PLACEHOLDER.test(flat.replace(/[\s.:…]+$/u, "")) || HARNESS_PROMPT.test(flat)) return null;
  return flat;
}

/** A lead Home can draw: a picture or film, a study page, or none. A live lead reads as text. */
export function homeLead(lead: FeedLead): HomeLead {
  switch (lead.kind) {
    case "video": return { kind: "video", src: lead.ref.asset, caption: lead.ref.caption };
    case "visual": return { kind: "visual", src: lead.ref.asset, caption: lead.ref.caption };
    case "page": return { kind: "page", label: lead.ref.path, href: lead.ref.href };
    default: return { kind: "text" };
  }
}

function sizeOf(post: FeedPostHead): HomeSize | null {
  const change = post.change;
  if (!change || change.additions == null || change.deletions == null) return null;
  return { additions: change.additions, deletions: change.deletions };
}

/** The project a post belongs to: its pull request's repository, else the folder its owner works in. */
function projectOf(post: FeedPostHead): string | null {
  if (post.project) return post.project;
  const repo = post.prs[0]?.key.split("#")[0];
  return leaf(repo ?? null) ?? leaf(post.owner.cwd);
}

/**
 * A post's title: the engine's, unless it is an id or a placeholder; then the
 * work's name (its branch, parent task or pull request); then the reply's
 * first sentence, which then stops being the caption too.
 */
function postWords(post: FeedPostHead, project: string | null): { title: string; caption: string | null } {
  const caption = readableTitle(post.caption) ? post.caption : null;
  const title = readableTitle(post.title) ?? readableTitle(post.thread);
  if (title) return { title, caption };
  if (caption) return { title: caption, caption: null };
  return { title: readableTitle(post.forYou?.label) ?? (project ? `Work in ${project}` : "Work"), caption: null };
}

export function homePost(post: FeedPostHead): HomePost {
  const project = projectOf(post);
  return {
    id: post.id,
    at: post.at,
    ...postWords(post, project),
    project,
    agent: post.agent.name ? { name: post.agent.name, harness: post.agent.harness } : null,
    refs: post.prs.map((pr) => ({ label: pr.label, state: pr.state, url: pr.url })),
    lead: homeLead(post.lead),
    size: sizeOf(post),
    open: post.conversationId ? { view: "conversation", conversationId: post.conversationId } : null,
  };
}

/** The work item a request is about, as the engine joins them (server/routes/feed.ts attentionForFeed). */
function requestWork(item: OperatorAttentionItem): string | null {
  const fromAction = item.actions?.find((a) => a.recordKind === "work_item" && a.recordId)?.recordId ?? null;
  return fromAction ?? (item.id.startsWith("work_item:") ? item.id.slice("work_item:".length) : null) ?? item.ready?.workId ?? null;
}

function leafName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/** The artifact a turn leads with, from the engine's lead; null when the turn made none. */
export function turnArtifact(post: FeedPostHead): HomeArtifact | null {
  const lead = post.lead;
  switch (lead.kind) {
    case "visual":
    case "video":
      return { kind: lead.kind, src: lead.ref.asset, caption: lead.ref.caption, href: lead.ref.asset };
    case "page":
      return { kind: "page", label: leafName(lead.ref.path), href: lead.ref.href };
    default:
      if (post.study) return { kind: "page", label: leafName(post.study), href: post.study };
      // No picture of its own: the screenshot its pull request shows, opening the pull request.
      if (post.picture) return { kind: "visual", src: post.picture.src, caption: post.picture.alt || null, href: post.prs[0]?.url ?? post.picture.src };
      return null;
  }
}

export function homeTurn(post: FeedPostHead): HomeTurn {
  return {
    ...homePost(post),
    post,
    artifact: turnArtifact(post),
    sessionId: post.owner.sessionId,
    turnKey: `${post.id}@${post.at}`,
    why: turnWhy(post),
  };
}

/**
 * Whether a request waits on the operator. A failed or interrupted ask (kind "ask") is a notice
 * about work, not a question: it stays on the Requests page and never leads For you.
 */
export function waitsOnOperator(item: Pick<OperatorAttentionItem, "kind">): boolean {
  return item.kind !== "ask";
}

/** A request already in For you stands for the post it is about. */
export function requestCovers(item: OperatorAttentionItem, post: FeedPostHead): boolean {
  // Ready stands for the task's turn whatever the post is waiting on: Continue or Hold is the move.
  if (item.kind === "ready" && item.ready) {
    if (item.conversationId && item.conversationId === post.conversationId) return true;
    return Boolean(item.ready.workId) && item.ready.workId === post.workId;
  }
  if (post.forYou?.reason !== "attention") return false;
  if (item.conversationId && item.conversationId === post.conversationId) return true;
  return requestWork(item) === post.workId;
}

/** A terminal's rules and frames (runs of box-drawing characters) are layout, not words. */
const BOX_RULE = /[\u2500-\u257F]{2,}/gu;

function requestRow(item: OperatorAttentionItem): HomeForYou {
  if (isReadyRequest(item)) return readyRow(item);
  const summary = item.summary ? firstSentence(plainLine(item.summary.replace(BOX_RULE, " "))) : null;
  const title = readableTitle(item.title ? plainLine(item.title) : null);
  return {
    id: `request:${item.id}`,
    at: item.updatedAt,
    title: title ?? readableTitle(summary) ?? (item.agentName ? `An ask from ${item.agentName}` : "An ask"),
    caption: title && readableTitle(summary) ? summary : null,
    project: null,
    agent: item.agentName ? { name: item.agentName, harness: null } : null,
    refs: [],
    lead: { kind: "text" },
    size: null,
    open: requestsRoute(item.id),
    ask: { label: "Answer", route: requestsRoute(item.id) },
    source: "request",
    item,
    why: requestWhy(item),
  };
}

/** A Ready task: "<agent> is ready", the agent's summary line under it; Continue and Hold are its moves. */
function readyRow(item: OperatorAttentionItem & { ready: NonNullable<OperatorAttentionItem["ready"]> }): HomeForYou {
  const summary = readableLine(plainLine(item.ready.summary.replace(BOX_RULE, " ")));
  const open = item.actions.find((a) => a.kind === "open" && a.route)?.route ?? requestsRoute(item.id);
  return {
    id: `request:${item.id}`,
    at: item.ready.at,
    title: plainLine(item.title),
    caption: summary || null,
    project: null,
    agent: item.agentName ? { name: item.agentName, harness: null } : null,
    refs: [],
    lead: { kind: "text" },
    size: null,
    open,
    ask: { label: "Open", route: open },
    source: "request",
    item,
    why: requestWhy(item),
  };
}

/**
 * Home's view. For you leads with the runtime's open requests, newest first,
 * then the engine's handed-back posts in its order, leaving out a post a
 * request already stands for. Landed is the engine's, in its order.
 */
export function homeView(feed: HomeFeed | null, opts: { requests?: readonly OperatorAttentionItem[] } = {}): HomeView {
  const items = (opts.requests ?? []).filter(waitsOnOperator).sort((a, b) => b.updatedAt - a.updatedAt);
  const requests = items.map(requestRow);
  if (!feed?.home) return { forYou: requests.slice(0, HOME_FOR_YOU_LIMIT), backToYou: [], shipped: [], landed: [], feed: feed?.size ?? null };

  const byId = new Map(feed.posts.map((p) => [p.id, p]));
  const heads = (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  const handedBack = heads(feed.home.forYou)
    .filter((post) => post.forYou && !items.some((item) => requestCovers(item, post)))
    .map((post): HomeForYou => ({ ...homePost(post), source: "post", post, reason: post.forYou!, why: post.forYou!.reason === "attention" ? questionWhy(post) : turnWhy(post) }));

  // A turn a request already stands for is answered there; the engine's list may be absent on an older server.
  const backToYou = heads(feed.home.backToYou ?? [])
    .filter((post) => post.backToYou && !items.some((item) => requestCovers(item, post)))
    .map(homeTurn);

  return {
    forYou: [...requests, ...handedBack].slice(0, HOME_FOR_YOU_LIMIT),
    backToYou,
    shipped: heads(feed.home.shipped ?? []).map(homeTurn),
    landed: heads(feed.home.landed).map(homePost),
    feed: feed.size,
  };
}

/* ── The near-limit quota note ─────────────────────────────────────────── */

/** A subscription shows on Home only past this share of its window. */
export const HOME_QUOTA_NEAR = 0.85;

export type HomeQuotaNote = { id: string; label: string; percent: number; resets: string };

/**
 * The subscriptions near their limit, fullest first. Read from the window the
 * Cockpit's quota table shows; a window that rolled over, or that waits on its
 * first reading after a reset, is not near anything.
 */
export function nearLimitQuotas(gauges: readonly ServiceGauge[], now: Date): HomeQuotaNote[] {
  const notes: Array<HomeQuotaNote & { fill: number }> = [];
  for (const gauge of gauges) {
    if (!isQuotaGauge(gauge)) continue;
    const window = usageWindow(quotaWindows(gauge));
    if (!window || window.awaitingReset) continue;
    const fill = currentWindowFill(window, now);
    if (fill < HOME_QUOTA_NEAR) continue;
    notes.push({
      id: gauge.id,
      label: gauge.label,
      percent: Math.min(100, Math.round(fill * 100)),
      resets: formatResetChip(window.resetAt, now).label,
      fill,
    });
  }
  return notes.sort((a, b) => b.fill - a.fill).map(({ fill: _fill, ...note }) => note);
}

/* ── where a permission runs ───────────────────────────────────────────── */

/** The parts of an agent this reads (shared/api/web.ts WebAgent). */
export type PermissionAgent = { handle: string | null; project: string | null; projectRoot: string | null };

/**
 * Where a permission runs, as people say it: the project, then the agent's
 * alias ("demo-app · project-locke-22"). Never a raw id: an alias or name
 * that reads as one is left out. The project comes from the project's own
 * root, never the folder a command runs in: a command in
 * demo-app/packages/web still runs in demo-app. The command's folder
 * names the project only when nothing else does.
 */
export function permissionWhere(item: Pick<OperatorAttentionItem, "agentName" | "permission">, agent: PermissionAgent | null, cwd: string | null): string | null {
  const folder = item.permission?.projectRoot ?? agent?.projectRoot ?? cwd ?? null;
  const project = readableTitle(agent?.project) ?? readableTitle(folder?.replace(/\/+$/u, "").split("/").pop());
  const alias = [agent?.handle?.replace(/^@/u, ""), item.agentName].map(readableTitle).find((name) => name && name !== project) ?? null;
  const parts = [project, alias].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}
