/**
 * One thread -> one post: its class, lead, outcome and caption and score.
 * Pure. Called by the slot writer, never the Feed reader.
 */
import type {
  FeedForYou,
  FeedLead,
  FeedPicture,
  FeedPostDetail,
  FeedPostHead,
  FeedPr,
  FeedSettled,
  FeedUpdate,
  WebFeedPull,
  WebFeedTask,
} from "../../shared/api/feed.ts";
import { dayKey } from "./days.ts";
import { changeOf, chooseLead, leadsFor } from "./leads.ts";
import { MAX_LEAD_PULLS, slotId, taskBranch, taskPulls, taskRepo, turnPulls, type LinkContext } from "./links.ts";
import { prImagePath } from "./pr-image.ts";
import { directQuestion, selectionScore, type Candidate, type Outcome } from "./score.ts";
import { agentOf, clip, feedLine, firstSentence, isReviewPass, operatorLine, postBody, taskTitle, toPr } from "./text.ts";
import { plainTextExcerpt } from "../../shared/plain-excerpt.ts";

/** An operator-attention queue item, joined to a post by its work or conversation. */
export type FeedAttention = { id: string; workId: string | null; conversationId: string | null; label: string; detail?: string | null };

export type PostContext = LinkContext & {
  originHost: string;
  /** The repository most pull requests come from: its numbers go without a prefix. */
  mainRepo: string | null;
  attentionByKey: ReadonlyMap<string, FeedAttention>;
  /** Unmerged local branches, as "repo:branch". */
  localBranches: ReadonlySet<string>;
};

/** A finished thread before the writer applies its stored summary. */
export type BuiltPost = {
  head: Omit<FeedPostHead, "version" | "selected">;
  detail: Omit<FeedPostDetail, "version" | "diff">;
  candidate: Candidate;
  /** The task the post leads with, for its files and its diff. */
  leadTask: string;
};

const MAX_HEAD_PRS = 6;

function leaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

/** The ask in plain words: the work item's title is the request the agent got. */
function askedOf(title: string): string | null {
  const plain = plainTextExcerpt(title, 2000).trim();
  return plain ? clip(plain, 600) : null;
}

function threadName(tasks: readonly WebFeedTask[], ctx: PostContext): string | null {
  for (const task of tasks) {
    const branch = taskBranch(task, ctx.repos);
    if (branch) return branch.replace(/^(?:feat|fix|chore|feed|study|docs)\//, "");
  }
  const parent = tasks.find((t) => t.parentTitle)?.parentTitle;
  return parent ? taskTitle(parent, 60) : null;
}

function forYouOf(tasks: readonly WebFeedTask[], pulls: readonly WebFeedPull[], ctx: PostContext): FeedForYou | null {
  for (const task of tasks) {
    const hit = ctx.attentionByKey.get(`work:${task.id}`);
    if (hit) return { reason: "attention", label: hit.label, ...(hit.detail ? { detail: hit.detail } : {}) };
  }
  const draft = pulls.find((p) => p.state === "draft");
  if (draft) return { reason: "draft", label: `Draft ${draft.repo.split("/")[1] ?? draft.repo}#${draft.number} awaits review` };
  if (pulls.length === 0) {
    for (const task of tasks) {
      const repo = taskRepo(task, ctx.repos);
      const branch = taskBranch(task, ctx.repos);
      if (repo && branch && ctx.localBranches.has(`${repo}:${branch}`)) return { reason: "local_branch", label: `Left on ${branch}, no pull request` };
    }
  }
  return null;
}

/**
 * A turn handed back, settled by its own pull requests: merged when none is
 * open and at least one merged, closed when all of them closed unmerged.
 * Null while one is open or a draft, or when the turn has none.
 */
export function settledBy(pulls: readonly WebFeedPull[], mainRepo: string | null): FeedSettled | null {
  if (!pulls.length || pulls.some((p) => p.state === "open" || p.state === "draft")) return null;
  const merged = pulls.filter((p) => p.state === "merged");
  const by = merged.length ? merged : pulls;
  const times = by.map((p) => p.at).filter((t): t is number => t !== null);
  return { state: merged.length ? "merged" : "closed", prs: by.map((p) => toPr(p, mainRepo).label), at: times.length ? Math.max(...times) : null };
}

/* A picture's alt or file name that says it is the 1440 desktop capture. */
const DESKTOP = /\b1440\b/;

/* A picture's alt or file name that says it shows the state before the change. */
const BEFORE = /\bbefore\b/i;

/**
 * The turn's lead picture from its pull requests' descriptions: the 1440 capture when there is one, else the first
 * that is not a "before" shot (a description often opens with the old state), else the first.
 */
export function pullPicture(pulls: readonly WebFeedPull[]): FeedPicture | null {
  const all = pulls.flatMap((p) => (p.images ?? []).map((image, index) => ({ pull: p, image, index })));
  const says = (x: (typeof all)[number], word: RegExp) => word.test(x.image.alt) || word.test(x.image.url.split("/").pop() ?? "");
  const pick = all.find((x) => says(x, DESKTOP)) ?? all.find((x) => !says(x, BEFORE)) ?? all[0];
  return pick ? { src: prImagePath(pick.pull.key, pick.index), alt: pick.image.alt } : null;
}

/** What an own post says after its title, clipped; null when the title already says it all. */
function restAfterTitle(words: string, title: string): string | null {
  const head = title.replace(/…$/, "");
  if (!words.startsWith(head)) return null;
  const rest = words.slice(head.length).replace(/^[.!?]?\s*/, "").trim();
  return rest ? clip(rest, 280) : null;
}

function outcomeKind(artifact: FeedLead, lead: WebFeedTask): Outcome {
  if (artifact.kind === "page") {
    if (lead.studies.some(study => study.path === artifact.ref.path)) return "study";
    if (lead.document?.path === artifact.ref.path) return lead.document.kind;
    return /\.(?:pptx?|key)$/i.test(artifact.ref.path) ? "deck" : "file";
  }
  return artifact.kind === "text" || artifact.kind === "live" ? "result" : artifact.kind;
}

/**
 * The post for a thread, or null when nothing on it has finished (a thread
 * that is only running shows on the live channel, not as a post).
 */
export function buildPost(thread: readonly WebFeedTask[], ctx: PostContext): BuiltPost | null {
  const finished = thread.filter((t) => t.state !== "working").sort((a, b) => b.finishedAt - a.finishedAt || (a.id < b.id ? -1 : 1));
  if (!finished.length) return null;
  const newest = finished[0]!;
  const lead = newest;

  const keysByTask = new Map(thread.map((t) => [t.id, taskPulls(t, ctx)]));
  const prKeys = [...new Set(finished.flatMap((t) => keysByTask.get(t.id) ?? []))];
  // A roll-up names many pull requests; only a thread's own ones (few) say what it shipped.
  const currentKeys = turnPulls(lead, ctx);
  const ownKeys = currentKeys.slice(0, MAX_LEAD_PULLS);
  const ownPulls = ownKeys.map((key) => ctx.pulls.get(key)).filter((p): p is WebFeedPull => Boolean(p));
  const prs: FeedPr[] = prKeys.map((key) => ctx.pulls.get(key)).filter((p): p is WebFeedPull => Boolean(p)).map((p) => toPr(p, ctx.mainRepo));

  const leads: FeedLead[] = leadsFor(lead, thread);
  const chosen = chooseLead(leads);
  const line = finished.map((t) => operatorLine(t.operator)).find(Boolean) ?? null;
  const posted = lead.agentPost ?? null;
  // A post the agent wrote on its own is the whole turn; one joined to a task describes that task's outcome.
  const own = Boolean(posted && lead.id.startsWith("agentpost:"));
  // A branch or a draft is the task's to hand back; an own post never says "push it".
  const forYou = own ? null : forYouOf(finished, ownPulls, ctx);
  const running = thread.some((t) => t.state === "working");
  // The newest turn: the operator asked for it (not an agent under their name), the agent answered, and the operator has not written since.
  const handedBack = !running && newest.operatorAsked && !newest.askedByAgent && newest.replyId !== null && newest.operator === null;
  // What the turn made, as GitHub has it now: once its pull requests all merged or closed, it no longer waits.
  const mine = currentKeys.map((key) => ctx.pulls.get(key)).filter((p): p is WebFeedPull => Boolean(p));
  const settled = handedBack ? settledBy(mine, ctx.mainRepo) : null;
  const backToYou = handedBack && !settled;
  const picture = pullPicture(mine);
  const steering = forYou?.reason === "attention";
  const operatorAsked = lead.operatorAsked && !lead.askedByAgent;
  const routine = !steering && !line && !operatorAsked && finished.every(isReviewPass);
  const cls: FeedPostHead["class"] = steering ? "for_you" : routine ? "routine" : "landed";
  const replied = Boolean(lead.replyId && lead.reply?.trim());
  const answered = replied && directQuestion(lead.title);
  // Code-only is a diversity bucket, not a visual lead. The displayed change
  // can disappear or change size/state without moving the turn in the Feed.
  // A turn whose pull request shows a screenshot is something to look at: the
  // stream leads with that picture (client feed-store shownLead), so it ranks as
  // one rather than folding under the one-diff-a-day limit.
  const outcome = chosen.kind === "text" && picture ? "visual" : chosen.kind === "text" && ownPulls.length ? "diff" : outcomeKind(chosen, lead);
  const signal = selectionScore({ outcome, answered, replied, steering, reviewed: Boolean(line), operatorAsked, routine, milestone: Boolean(posted?.milestone) });

  const presented = lead.presentation.status === "current" ? lead.presentation : null;
  // Plain words: a path reads as its name and a commit hash goes (shared/plain-line.ts).
  const postWords = posted ? feedLine(posted.text) : "";
  const outcomeLine = firstSentence(feedLine(lead.reply ?? ""), 160)?.replace(/\.$/, "");
  const title = own ? taskTitle(postWords, 160)
    : (presented?.title || postWords) ? taskTitle(feedLine(presented?.title || postWords), 160)
    : outcomeLine || taskTitle(feedLine(ownPulls[0]?.title || "No outcome recorded"), 160);
  const caption = own ? restAfterTitle(postWords, title) : taskTitle(feedLine(lead.title), 200) || null;
  // An own post's detail repeats its words only when the title and caption cut them short.
  const shown = `${title.replace(/…$/, "")} ${caption?.replace(/…$/, "") ?? ""}`.replace(/\s+/g, "").length;
  const body = own ? postBody(shown >= postWords.replace(/\s+/g, "").length - 2 ? null : posted!.text) : postBody(lead.reply);

  const agents: ReturnType<typeof agentOf>[] = [];
  for (const task of finished) {
    const agent = agentOf(task);
    if (!agents.some((a) => a.name === agent.name)) agents.push(agent);
  }
  const leadAgent = agentOf(lead);

  const id = slotId(ctx.originHost, lead);
  const replies = new Set([lead.replyId]);
  const earlier: FeedUpdate[] = finished.filter(t => {
    if (t === lead || (t.replyId && replies.has(t.replyId))) return false;
    replies.add(t.replyId);
    return true;
  }).map((t) => ({
    id: t.id,
    at: t.finishedAt,
    title: firstSentence(feedLine(t.reply ?? ""), 120) ?? taskTitle(feedLine(t.title), 120),
    agent: agentOf(t),
    prs: (keysByTask.get(t.id) ?? []).map((key) => ctx.pulls.get(key)).filter((p): p is WebFeedPull => Boolean(p)).map((p) => toPr(p, ctx.mainRepo)),
  }));

  const projectKey = taskRepo(lead, ctx.repos) ?? lead.projectRoot;
  return {
    candidate: { ...signal, id, at: newest.finishedAt, project: projectKey, agent: lead.ownerId, session: lead.sessionId, routine, agentPost: own ? { milestone: Boolean(posted?.milestone) } : null },
    head: {
      id,
      day: dayKey(newest.finishedAt),
      at: newest.finishedAt,
      class: cls,
      reviewed: line !== null,
      score: signal.base,
      title,
      caption,
      writtenBy: postWords ? "agent" : presented ? "presentation" : "reply",
      line,
      agent: leadAgent,
      others: agents.filter((a) => a.name !== leadAgent.name).length,
      thread: threadName(finished, ctx),
      state: lead.state === "review" ? "review" : "done",
      lead: chosen,
      change: changeOf(ownPulls),
      joined: [],
      prs: currentKeys.slice(0,MAX_HEAD_PRS).map(k => toPr(ctx.pulls.get(k)!,ctx.mainRepo)),
      prCount: prs.length,
      forYou,
      backToYou,
      settled,
      picture,
      updates: earlier.length,
      workId: lead.id,
      conversationId: lead.conversationId,
      owner: { agentId: lead.ownerId, sessionId: lead.sessionId, cwd: lead.cwd ?? lead.projectRoot },
      study: lead.studies.find((s) => s.href)?.href ?? null,
      project: leaf(projectKey),
      agentPost: posted ? { milestone: posted.milestone, links: posted.links, own } : null,
    },
    detail: {
      id,
      // An own post was asked of nobody: its words are the post.
      asked: own ? null : askedOf(lead.title),
      branch: taskBranch(lead, ctx.repos),
      body,
      earlier,
      prs,
      leads,
      agents,
      posterCandidates: lead.studies.filter((s) => !s.poster).map((s) => s.path),
    },
    leadTask: lead.id,
  };
}
