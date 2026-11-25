/*
 * What the operator can do with a post, derived from its state. Pure, so the
 * Feed, Home's For you band and the tests share it.
 *
 * Every action goes through the runtime or an ask; the runtime stays the only
 * writer. Nothing here merges or pushes: shipping and pushing ask the agent,
 * which lands the work with its own local checks.
 *
 * A failed run would offer Retry once the runtime has `work_retry`
 * (arach/scout#204). Until then it is not offered.
 */
import type { FeedDiffStat, FeedPostDetail, FeedPostHead, FeedPr } from "../../../shared/api/feed.ts";
import { reactionMessage, type ReactionKind } from "../canvas/reactions.ts";

export type PrimaryAction =
  | { kind: "review_draft"; label: string; href: string; pr: FeedPr }
  | { kind: "push"; label: string }
  | { kind: "ship"; label: string; pr: FeedPr }
  | { kind: "open_study"; label: string; href: string };

/**
 * The post's one obvious move, or null. In order: a draft pull request to
 * review, work left on a local branch to push, a ready pull request to ship,
 * a study to open.
 *
 * "Ready" means open and not a draft. Pull requests here carry no check
 * state (hosted CI does not run), so the Ship it message asks the agent to
 * run its local checks before it lands the change.
 */
export function primaryAction(post: FeedPostHead): PrimaryAction | null {
  const draft = post.prs.find((p) => p.state === "draft");
  if (draft) return { kind: "review_draft", label: "Review the draft", href: `${draft.url.replace(/\/+$/, "")}/files`, pr: draft };
  if (post.forYou?.reason === "local_branch") return { kind: "push", label: "Push it" };
  const ready = post.prs.find((p) => p.state === "open");
  if (ready) return { kind: "ship", label: "Ship it", pr: ready };
  const study = post.study ?? (post.lead.kind === "page" ? post.lead.ref.href : null);
  if (study) return { kind: "open_study", label: "Open the study", href: study };
  return null;
}

/** Where a reaction goes: the owner's harness session when there is one, else a successor ask on the work. */
export type ReactRoute =
  | { to: "session"; sessionId: string; harness: string | null; cwd: string | null }
  | { to: "successor"; workId: string };

export type OpenTarget =
  | { kind: "session"; label: string; sessionId: string }
  | { kind: "pr"; label: string; href: string }
  | { kind: "study"; label: string; href: string };

export type PostActionSet = {
  primary: PrimaryAction | null;
  /** A successor task for the same agent. */
  continue: boolean;
  /** Scoutbot answers from the post; the agent is not asked. */
  ask: boolean;
  react: ReactRoute;
  /** Done and Drop move the work item. They apply to work in review; finished work is already settled. */
  done: boolean;
  drop: boolean;
  open: OpenTarget[];
};

export function reactRoute(post: FeedPostHead): ReactRoute {
  const sessionId = post.owner.sessionId?.trim();
  return sessionId ? { to: "session", sessionId, harness: post.agent.harness, cwd: post.owner.cwd } : { to: "successor", workId: post.workId };
}

export function postActions(post: FeedPostHead): PostActionSet {
  const primary = primaryAction(post);
  const inReview = post.state === "review";
  const open: OpenTarget[] = [];
  if (post.owner.sessionId) open.push({ kind: "session", label: "Session", sessionId: post.owner.sessionId });
  const pr = post.prs[0];
  if (pr) open.push({ kind: "pr", label: pr.label, href: pr.url });
  const study = post.study ?? (post.lead.kind === "page" ? post.lead.ref.href : null);
  if (study) open.push({ kind: "study", label: "Study", href: study });
  // An agent's own post has no task to continue: a reply goes to its session as the next turn, or nowhere.
  const continues = post.agentPost?.own ? Boolean(post.owner.sessionId) : true;
  return { primary, continue: continues, ask: true, react: reactRoute(post), done: inReview, drop: inReview, open };
}

/* ── the messages an action sends ───────────────────────────────────────── */

const quoted = (title: string) => `"${title.length > 140 ? `${title.slice(0, 139)}…` : title}"`;

export function pushMessage(post: FeedPostHead): string {
  return [
    `From the operator, sent from the Feed, on ${quoted(post.title)}.`,
    "This work is on a local branch with no pull request. Push the branch and open a pull request for it.",
    "Run your local checks first and put the commands and their results in the pull request. Do not merge it.",
  ].join("\n\n");
}

export function reactMessage(kind: ReactionKind, post: FeedPostHead, note = ""): string {
  const ship = kind === "ship" ? primaryAction(post) : null;
  const target = ship?.kind === "ship"
    ? { what: `pull request ${ship.pr.label}`, path: quoted(ship.pr.title) }
    : { what: "your work", path: quoted(post.title) };
  const landing = kind === "ship" ? "Run your local checks, then land it the way this repository lands changes." : "";
  return reactionMessage(kind, target, [landing, note].filter(Boolean).join(" "), "the Feed");
}

/** The question context Scoutbot answers from: the post, the task and the files changed. */
export function askAboutPost(question: string, post: FeedPostHead, detail: FeedPostDetail | null) {
  const body = detail?.body;
  const content = [
    post.title,
    post.caption,
    body?.landed && `Landed: ${body.landed}`,
    body?.checks && `Checks: ${body.checks}`,
    body?.next && `Next: ${body.next}`,
    body?.open && `Open: ${body.open}`,
    post.prs.length ? `Pull requests: ${post.prs.map((p) => `${p.label} ${p.state} (${p.title})`).join("; ")}` : null,
  ].filter(Boolean).join("\n");
  return {
    question: question.replace(/\s+/g, " ").trim(),
    artifact: { what: "post", path: quoted(post.title), content, contentKind: "text" as const },
    agent: { name: post.agent.name, harness: post.agent.harness ?? "", state: post.state, said: post.caption ?? post.title, files: diffFiles(detail?.diff ?? null) },
  };
}

function diffFiles(diff: FeedDiffStat | null): string[] {
  return (diff?.top ?? []).map((f) => `${f.path} (+${f.additions} -${f.deletions})`);
}

/* ── the keys ──────────────────────────────────────────────────────────── */

export type FeedCommand = "next" | "prev" | "open" | "primary" | "continue" | "ask" | "react" | "done" | "drop" | "hide" | "undo";

const KEYS: Record<string, FeedCommand> = {
  j: "next", ArrowDown: "next", k: "prev", ArrowUp: "prev", Enter: "open",
  p: "primary", c: "continue", a: "ask", r: "react", d: "done", x: "drop", h: "hide", u: "undo",
};

/** The command a plain key press runs; modified keys belong to the shell. */
export function feedCommand(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): FeedCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return KEYS[event.key] ?? null;
}

/** The key that runs each action, shown as a hint on hover or focus. */
export const ACTION_KEY: Partial<Record<FeedCommand, string>> = { primary: "p", continue: "c", ask: "a", react: "r", done: "d", drop: "x", hide: "h" };

/** Whether the post allows a command; navigation and undo always do. */
export function allows(actions: PostActionSet, command: FeedCommand): boolean {
  switch (command) {
    case "primary": return actions.primary !== null;
    case "continue": return actions.continue;
    case "ask": return actions.ask;
    case "react": return true;
    case "done": return actions.done;
    case "drop": return actions.drop;
    default: return true;
  }
}

/** The work move Done and Drop make; the default lifecycle's Dropped station needs a reason. */
export function moveFor(command: "done" | "drop"): { to: "done" | "dropped"; note: string } {
  return command === "done"
    ? { to: "done", note: "Marked done from the Feed." }
    : { to: "dropped", note: "Dropped from the Feed." };
}
