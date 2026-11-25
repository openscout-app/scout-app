/*
 * Canvas, discussing: threads about parts of an artifact, kept where they are about.
 *
 * The anchor is what makes it a discussion of the artifact rather than a chat beside it. For an Arc diagram it is
 * a place: the chapter (view) and the boxes the thread is about, one, several, or none for the whole chapter. It
 * travels with every message as context, so the agent answering can open the same chapter and look at the same boxes.
 *
 * Three agents can answer, and one does at a time. They differ in what they know and in who sees the question:
 *  - the author, the session that showed the artifact: it knows why it is drawn that way and can change it. The
 *    question is typed into its session (POST /api/sessions/reply), which resumes it when it has ended.
 *  - a project agent, another live session in the artifact's project: a second opinion that checks the drawing
 *    against the code, without the author's stake in it.
 *  - Scoutbot, which answers from what the canvas already shows (as Ask does, ask.ts). The author never sees it.
 *
 * Routing comes from the show record (agent, session, project), never from the message text.
 */
import type { ChannelMemberView, ChatMessage } from "../chat-space/chat-api.ts";
import { fallbackMember } from "../chat-space/chat-space-model.ts";

export type DiscussArcView = { id: string; title?: string; caption?: string; nodes?: string[]; connectors?: string[] };

export type DiscussArc = {
  /** the diagram's context file, relative to the diagram: what an agent reads behind the drawing */
  context?: string;
  nodeData: Record<string, { name: string; subtitle?: string }>;
  connectors: { id?: string; from: string; to: string }[];
  views?: DiscussArcView[];
};

/** Where a thread is: a chapter (null for the whole diagram) and the boxes it is about. No boxes: the whole chapter. */
export type DiscussPlace = { viewId: string | null; nodeIds: readonly string[] };

export type DiscussAnchor = {
  /** the artifact's path, as the show recorded it */
  path: string;
  viewId: string | null;
  viewTitle: string | null;
  /** the boxes the thread is about, in the chapter; empty for the whole chapter */
  nodeIds: string[];
  nodeNames: string[];
  /** the boxes the chapter shows, by name */
  inView: string[];
  /** the arrows into, out of and between those boxes, as "A -> B" */
  links: string[];
  /** the diagram's context file, from the repository root; null when the diagram has none */
  contextPath: string | null;
};

const nodeName = (arc: DiscussArc, id: string) => arc.nodeData[id]?.name ?? id;

/**
 * Where a diagram's context file is, from the repository root. The diagram names it relative to itself. A pointer that
 * is absolute, a URL, not markdown, or climbs out of the repository is refused rather than followed.
 */
export function diagramContextPath(diagramPath: string, ref: string | undefined): string | null {
  if (!ref || ref.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(ref) || !ref.endsWith(".md")) return null;
  const parts = diagramPath.split("/").slice(0, -1);
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length) parts.pop();
    else return null;
  }
  return parts.join("/");
}

/** The anchor for a place. An unknown chapter or a box outside the chapter is dropped, not kept as a guess. */
export function discussAnchor(arc: DiscussArc, path: string, place: DiscussPlace): DiscussAnchor {
  const view = place.viewId ? arc.views?.find((v) => v.id === place.viewId) ?? null : null;
  const nodeIds = [...new Set(place.nodeIds)].filter((id) => arc.nodeData[id] && (!view?.nodes || view.nodes.includes(id)));
  const touches = (id: string) => nodeIds.includes(id);
  const links = arc.connectors
    .filter((c) => touches(c.from) || touches(c.to))
    .filter((c) => !view?.connectors || !c.id || view.connectors.includes(c.id))
    .map((c) => `${nodeName(arc, c.from)} -> ${nodeName(arc, c.to)}`);
  return {
    path,
    viewId: view?.id ?? null,
    viewTitle: view?.title ?? null,
    nodeIds,
    nodeNames: nodeIds.map((id) => nodeName(arc, id)),
    inView: (view?.nodes ?? Object.keys(arc.nodeData)).map((id) => nodeName(arc, id)),
    links,
    contextPath: diagramContextPath(path, arc.context),
  };
}

/** The boxes, as a label reads them: one name, up to three names, or a count. */
export function boxesLabel(names: readonly string[]): string | null {
  if (!names.length) return null;
  return names.length <= 3 ? names.join(", ") : `${names.length} boxes`;
}

/** How the anchor reads in a tag: "Panel chat › UI actions", "Panel chat", or "Whole diagram". */
export function anchorLabel(anchor: Pick<DiscussAnchor, "viewTitle" | "nodeNames">): string {
  const parts = [anchor.viewTitle, boxesLabel(anchor.nodeNames)].filter(Boolean);
  return parts.length ? parts.join(" › ") : "Whole diagram";
}

/* ── who answers ──────────────────────────────────────────────────────────── */

/** The show, as routing needs it. */
export type DiscussShow = { agentId: string; sessionId?: string; harness?: string; projectRoot: string; worktree: string };

/** A session that could answer: from the session inventory. */
export type DiscussPeer = { agentId: string; name: string; harness: string; sessionId: string | null; live: boolean; projectRoot: string; worktree: string };

export type DiscussRouteKind = "author" | "project" | "scoutbot";

export type DiscussRoute = {
  kind: DiscussRouteKind;
  /** the answering agent's actor id, as the thread's roster keys it */
  actorId: string;
  /** who answers, by name */
  who: string;
  harness: string | null;
  sessionId: string | null;
  /** one line on why this route, or why not */
  reason: string;
  /** whether the answering agent's own session sees the question */
  seen: "in its session" | "only here";
  available: boolean;
};

export const SCOUTBOT_NAME = "Scoutbot";
/** Scoutbot's agent id (lib/scoutbot.ts DEFAULT_SCOUTBOT_AGENT_ID). */
export const SCOUTBOT_ACTOR_ID = "scoutbot";
/** The operator's actor id in a chat thread. */
export const OPERATOR_ACTOR_ID = "owner";

/**
 * The three routes for a show, and which one a new thread starts on.
 *
 * The author is preferred while its session is live. When it has ended, a live project agent is preferred, since
 * resuming the author is slow; the author stays one tap away. Scoutbot is always available, and is the start only
 * when no session could take the question.
 */
export function discussRoutes(show: DiscussShow, peers: readonly DiscussPeer[], authorName: string): { routes: DiscussRoute[]; start: DiscussRouteKind } {
  const author = peers.find((p) => p.agentId === show.agentId && (!show.sessionId || p.sessionId === show.sessionId))
    ?? peers.find((p) => p.agentId === show.agentId)
    ?? null;
  const sessionId = show.sessionId ?? author?.sessionId ?? null;
  const authorLive = Boolean(author?.live);
  const project = peers
    .filter((p) => p.live && p.agentId !== show.agentId && p.projectRoot === show.projectRoot)
    .sort((a, b) => Number(b.worktree === show.worktree) - Number(a.worktree === show.worktree))[0] ?? null;

  const routes: DiscussRoute[] = [
    {
      kind: "author",
      actorId: show.agentId,
      who: author?.name ?? authorName,
      harness: show.harness ?? author?.harness ?? null,
      sessionId,
      reason: !sessionId
        ? "Showed this, but its session is not known."
        : authorLive ? "Showed this. Its session is open." : "Showed this. Its session has ended; asking resumes it.",
      seen: "in its session",
      available: Boolean(sessionId),
    },
    project
      ? {
        kind: "project", actorId: project.agentId, who: project.name, harness: project.harness, sessionId: project.sessionId,
        reason: project.worktree === show.worktree ? "Working in the same worktree." : "Working in the same project.",
        seen: "in its session", available: Boolean(project.sessionId),
      }
      : { kind: "project", actorId: "", who: "No project agent", harness: null, sessionId: null, reason: "No other session is live in this project.", seen: "in its session", available: false },
    { kind: "scoutbot", actorId: SCOUTBOT_ACTOR_ID, who: SCOUTBOT_NAME, harness: null, sessionId: null, reason: "Answers from what the canvas shows. The author does not see it.", seen: "only here", available: true },
  ];
  const start: DiscussRouteKind = authorLive && sessionId ? "author"
    : project?.sessionId ? "project"
    : sessionId ? "author"
    : "scoutbot";
  return { routes, start };
}

/* ── what the agent receives ──────────────────────────────────────────────── */

/**
 * The message an agent's session receives: where the operator is looking, the file behind the diagram, then their
 * own words. The anchor is written out because a session reads text; the route itself never comes from this text.
 * The context file is pointed to, not pasted: the agent reads it, and its sections stay the one source.
 */
export function discussMessage(anchor: DiscussAnchor, said: string, where = "the Canvas"): string {
  const words = said.replace(/\s+/g, " ").trim();
  if (!words) throw new Error("A discussion message needs the operator's words.");
  const one = anchor.nodeNames.length === 1;
  return [
    `Question from the operator, sent from ${where}, about ${anchorLabel(anchor)} in ${anchor.path}`,
    ...(anchor.viewTitle ? [`The chapter shows: ${anchor.inView.join(", ")}.`] : []),
    ...(anchor.links.length ? [`${one ? anchor.nodeNames[0] : "These boxes"} connect${one ? "s" : ""}: ${anchor.links.join("; ")}.`] : []),
    ...(anchor.contextPath ? [contextLine(anchor.contextPath, anchor.nodeNames)] : []),
    `In their words: ${words}`,
  ].join("\n\n");
}

const listed = (names: readonly string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const contextLine = (path: string, names: readonly string[]) =>
  `Behind this diagram: ${path}. Read it before you answer.${names.length ? ` Its Boxes section gives the state and code of ${listed(names)}.` : ""}`;

/* ── the file behind the diagram ──────────────────────────────────────────── */

/*
 * A diagram's context file is markdown its author writes beside it: what the diagram is for, where it stands (branch,
 * commit, what is proposed), how it was worked out, and a section per box. Each box section is a "### <box name>"
 * under "## Boxes", with a "State:" line and a "Code:" line of backticked paths, each plain or as a list item. The rest
 * is prose for the reader.
 */

export const CONTEXT_STATES = ["in use", "changing", "proposed", "retired"] as const;
export type ContextState = (typeof CONTEXT_STATES)[number];

export type DiagramContextBox = { name: string; state: ContextState | null; code: string[]; body: string };
export type DiagramContext = { title: string | null; summary: string | null; boxes: DiagramContextBox[] };

const isContextState = (value: string): value is ContextState => (CONTEXT_STATES as readonly string[]).includes(value);

/** The parts of a context file the canvas uses. A state outside the four reads as null, not as a guess. */
export function readDiagramContext(markdown: string): DiagramContext {
  let title: string | null = null;
  const summary: string[] = [];
  let summaryDone = false;
  let section: string | null = null;
  let box: DiagramContextBox | null = null;
  const boxes: DiagramContextBox[] = [];
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const [, hashes, text] = heading;
      if (hashes.length === 1) title ??= text;
      else if (hashes.length === 2) section = text;
      box = hashes.length === 3 && section === "Boxes" ? { name: text, state: null, code: [], body: "" } : null;
      if (box) boxes.push(box);
      if (hashes.length > 1 || summary.length) summaryDone = true;
      continue;
    }
    if (box) {
      const state = /^(?:[-*]\s+)?State:\s*(.+?)\.?\s*$/.exec(line);
      if (state) {
        const value = state[1].toLowerCase();
        box.state = isContextState(value) ? value : null;
      } else if (/^(?:[-*]\s+)?Code:/.test(line)) {
        box.code = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      } else {
        box.body = `${box.body}\n${line}`;
      }
      continue;
    }
    if (title !== null && !summaryDone) {
      if (line.trim()) summary.push(line.trim());
      else if (summary.length) summaryDone = true;
    }
  }
  return { title, summary: summary.length ? summary.join(" ") : null, boxes: boxes.map((b) => ({ ...b, body: b.body.trim() })) };
}

/** A box's section, matched by the name the diagram draws. */
export const contextBox = (context: DiagramContext | null, name: string) => context?.boxes.find((b) => b.name === name) ?? null;

/* ── threads on the canvas ────────────────────────────────────────────────── */

/*
 * A discussion lives where it is about. A thread on one box is a circle pinned to that box; on a group, a rectangle
 * around the boxes with the circle on it; on the whole chapter, a circle in the canvas's top right. The circle carries
 * a badge with the replies the operator has not read. The side pane is the full record of every thread.
 *
 * Each message is an ordinary chat message, drawn with the chat surface's own Turn (screens/chat-space/ChatBits.tsx).
 * The place belongs to the thread, never to a message's text. An answer that points to another place carries it in
 * its metadata.
 */

export type DiscussThread = {
  id: string;
  place: DiscussPlace;
  messages: readonly ChatMessage[];
  /** the operator has read everything up to this time */
  readAt: number;
};

export type DiscussPlaceKind = "chapter" | "box" | "group";

export const placeKind = (place: DiscussPlace): DiscussPlaceKind =>
  place.nodeIds.length === 0 ? "chapter" : place.nodeIds.length === 1 ? "box" : "group";

export const samePlace = (a: DiscussPlace, b: DiscussPlace) =>
  a.viewId === b.viewId && a.nodeIds.length === b.nodeIds.length && a.nodeIds.every((id) => b.nodeIds.includes(id));

/** The replies the viewer has not read: what the badge counts. The viewer's own messages never count. */
export function unreadReplies(thread: DiscussThread, viewerActorId: string): number {
  return thread.messages.filter((m) => m.actorId !== viewerActorId && m.createdAt > thread.readAt).length;
}

/** The thread with everything in it read. */
export function readThread(thread: DiscussThread): DiscussThread {
  const last = thread.messages.at(-1)?.createdAt ?? thread.readAt;
  return last > thread.readAt ? { ...thread, readAt: last } : thread;
}

/** The threads drawn on a chapter: its own, plus those on the whole diagram. */
export function threadsOnChapter(threads: readonly DiscussThread[], viewId: string | null): DiscussThread[] {
  return threads.filter((t) => t.place.viewId === viewId || t.place.viewId === null);
}

/** The threads grouped by chapter, chapters in the order their first thread started; the whole diagram is null. */
export function threadsByChapter(threads: readonly DiscussThread[]): { viewId: string | null; threads: DiscussThread[] }[] {
  const groups: { viewId: string | null; threads: DiscussThread[] }[] = [];
  for (const thread of threads) {
    const group = groups.find((g) => g.viewId === thread.place.viewId);
    if (group) group.threads.push(thread);
    else groups.push({ viewId: thread.place.viewId, threads: [thread] });
  }
  return groups;
}

/**
 * Ways to begin a thread, by what it is about: plain questions the operator can edit before sending. They name no
 * box, because the place already travels with the message.
 */
export function discussStarters(kind: DiscussPlaceKind): string[] {
  if (kind === "box") return ["Why is it drawn this way?", "Does this match the code?", "What depends on it?"];
  if (kind === "group") return ["How do these work together?", "Does this match the code?"];
  return ["What does this chapter leave out?", "Does this match the code?"];
}

/** Where an answer points: another place in the diagram, kept in the message's metadata. */
export type DiscussMarks = { pointsTo: DiscussPlace };

export const DISCUSS_METADATA_KEY = "canvasDiscuss";

export function discussMetadata(marks: DiscussMarks): Record<string, unknown> {
  return { [DISCUSS_METADATA_KEY]: marks };
}

const readPlace = (value: unknown): DiscussPlace | null => {
  if (!value || typeof value !== "object") return null;
  const { viewId, nodeIds } = value as Record<string, unknown>;
  if (!(viewId === null || typeof viewId === "string")) return null;
  if (!Array.isArray(nodeIds) || !nodeIds.every((id) => typeof id === "string")) return null;
  return { viewId, nodeIds };
};

/** The marks on a message, or null when it carries none or they are malformed. */
export function readDiscussMarks(metadata: Record<string, unknown> | undefined): DiscussMarks | null {
  const raw = metadata?.[DISCUSS_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const pointsTo = readPlace((raw as Record<string, unknown>).pointsTo);
  return pointsTo ? { pointsTo } : null;
}

/** The thread's roster: the operator and every route that can answer, keyed as the chat surface keys members. */
export function discussMembers(routes: readonly DiscussRoute[]): ChannelMemberView[] {
  const operator: ChannelMemberView = { ...fallbackMember(OPERATOR_ACTOR_ID, "You"), kind: "person" };
  return [
    operator,
    ...routes
      .filter((r) => r.available && r.actorId)
      .map((r) => ({ ...fallbackMember(r.actorId, r.who), kind: "agent", ...(r.harness ? { harness: r.harness } : {}) })),
  ];
}
