/**
 * Agent posts: what agents wrote for the Feed themselves (`scout post`, MCP
 * `post`), read from the runtime's post store (GET /v1/posts). A show no post
 * carries comes back as a post too, its caption as the text.
 *
 * A post becomes a turn of its own, so it ranks, sizes and opens like any
 * other post. When a task's run covers it (same session, else same owner, by
 * time), it joins that task instead: the task's post shows its file and the
 * agent's own words, and one piece of work never shows twice.
 */
import type { WebFeedAgentPost, WebFeedShow, WebFeedTask } from "../../shared/api/feed.ts";
export const SHOW_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The runtime's post record (ScoutPost in @openscout/protocol), as far as the Feed reads it. */
export type RuntimePost = {
  id: string;
  source: "post" | "show";
  author: { agentId: string; sessionId?: string; harness?: string; name?: string; nodeId: string };
  projectRoot?: string;
  project?: string;
  worktree?: string;
  branch?: string;
  text: string;
  links?: Array<{ url: string; title?: string }>;
  file?: { showId: string; kind: "image" | "video" | "document" | "other"; mediaType: string; byteSize: number; name: string };
  milestone?: boolean;
  createdAt: number;
};

/** A post counts toward a task from just before the task opened until shortly after its reply, like a show. */
export const POST_LEAD_MS = 60_000;
export const POST_TAIL_MS = 10 * 60_000;

export const AGENT_POST_PREFIX = "agentpost:";

export function agentPostOf(post: RuntimePost): WebFeedAgentPost {
  return {
    id: post.id,
    text: post.text.trim(),
    milestone: Boolean(post.milestone),
    links: (post.links ?? []).filter((link) => /^https?:\/\//i.test(link.url)).map((link) => ({ url: link.url, title: link.title ?? null })),
    at: post.createdAt,
  };
}

export function postShow(post: RuntimePost): WebFeedShow | null {
  const file = post.file;
  if (!file || !SHOW_ID.test(file.showId)) return null;
  return { id: file.showId, itemId: file.showId, name: file.name, kind: file.kind, mediaType: file.mediaType, caption: post.text.trim() || null, at: post.createdAt };
}

/** Whether a task's run covers a post: session evidence first, else the owner. */
export function taskCoversPost(task: WebFeedTask, post: RuntimePost): boolean {
  if (task.id.startsWith(AGENT_POST_PREFIX)) return false;
  const owner = task.sessionId && post.author.sessionId ? task.sessionId === post.author.sessionId : task.ownerId === post.author.agentId;
  return owner && post.createdAt >= task.createdAt - POST_LEAD_MS && post.createdAt <= task.finishedAt + POST_TAIL_MS;
}

/** A post no task covers, as a finished turn of its own. */
export function taskFromPost(post: RuntimePost): WebFeedTask {
  // A show shown without a caption reads by its file's name.
  const text = post.text.trim() || post.file?.name || "Shared a file";
  const show = postShow(post);
  return {
    id: `${AGENT_POST_PREFIX}${post.id}`,
    title: text,
    state: "done",
    accepted: false,
    operatorAsked: false,
    askedFrom: null,
    askedByAgent: false,
    ownerId: post.author.agentId,
    ownerName: post.author.name ?? null,
    harness: post.author.harness ?? null,
    sessionId: post.author.sessionId ?? null,
    conversationId: null,
    parentId: null,
    parentTitle: null,
    projectRoot: post.projectRoot ?? null,
    cwd: post.worktree ?? post.projectRoot ?? null,
    branch: post.branch ?? null,
    createdAt: post.createdAt,
    updatedAt: post.createdAt,
    finishedAt: post.createdAt,
    replyId: `${AGENT_POST_PREFIX}${post.id}`,
    reply: text,
    operator: null,
    presentation: { status: "missing", title: null, caption: null },
    shows: show ? [show] : [],
    media: [],
    studies: [],
    document: null,
    agentPost: agentPostOf(post),
  };
}

/**
 * Join posts to the tasks that cover them. A task takes the newest post's
 * words and every post's file; the rest stand alone. Pure.
 */
export function placePosts(tasks: readonly WebFeedTask[], posts: readonly RuntimePost[]): { tasks: WebFeedTask[]; alone: RuntimePost[] } {
  const byTask = new Map<string, RuntimePost[]>();
  const alone: RuntimePost[] = [];
  for (const post of posts) {
    // The newest covering task: a later turn is what the post was about.
    const task = tasks.filter((t) => t.state !== "working" && taskCoversPost(t, post)).sort((a, b) => b.finishedAt - a.finishedAt || a.id.localeCompare(b.id))[0];
    if (task) byTask.set(task.id, [...(byTask.get(task.id) ?? []), post]);
    else alone.push(post);
  }
  const placed = tasks.map((task) => {
    const mine = byTask.get(task.id);
    if (!mine) return task;
    const newest = [...mine].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0]!;
    const shows = [...task.shows];
    for (const post of mine) {
      const show = postShow(post);
      if (show && !shows.some((s) => s.id === show.id)) shows.push(show);
    }
    return { ...task, shows: shows.sort((a, b) => b.at - a.at), agentPost: agentPostOf(newest) };
  });
  return { tasks: placed, alone };
}
