import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { HarnessMark } from "../../components/HarnessMark.tsx";
import {
  firstLine,
  foldVercelBoardConversation,
  vercelBoardPlanName,
  foldVercelBoardJobs,
  groupVercelBoardRuns,
  type VercelBoardChainStep,
  type VercelBoardJobState,
  type VercelBoardPost,
  type VercelBoardThreadEntry,
  type VercelBoardWho,
} from "../../../shared/vercel-board-jobs.ts";
import { vercelBoardHues, Who, type VercelBoardRoomState } from "./VercelBoardTasks.tsx";
import "./vercel-board-tasks.css";

/*
 * A Vercel Board room as a conversation: the channel's messages oldest first,
 * as Chat draws a room. Each task is a message from whoever posted it, with
 * how it stands on the message itself, and a thread of its claims, hand-offs
 * and replies under it. A plan's tasks arrive together, so they read as one
 * author's run of messages.
 *
 * It reads the same room data as the Tasks view (useVercelBoardRoom), and a
 * task keeps the same colour in both. Board text (tasks, results, replies) is
 * quoted source material, shown as plain text beside its author.
 */

const STATE_LABEL: Record<VercelBoardJobState, string> = {
  ready: "Ready",
  waiting: "Waiting",
  running: "Working",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  cancelled: "Canceled",
};

const VERB: Record<VercelBoardChainStep["kind"], string> = {
  created: "posted",
  planned: "planned",
  assigned: "assigned",
  claimed: "claimed",
  released: "released",
  expired: "lease expired",
  completed: "completed",
  failed: "failed",
  blocked: "blocked",
  unblocked: "unblocked",
  reopened: "reopened",
  canceled: "canceled",
};

function stepTone(kind: VercelBoardChainStep["kind"]): string {
  switch (kind) {
    case "claimed": case "assigned": return "run";
    case "completed": return "done";
    case "failed": return "fail";
    case "blocked": return "block";
    case "released": case "expired": return "back";
    default: return "quiet";
  }
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function dayOf(ms: number | null): string {
  return ms ? new Date(ms).toDateString() : "";
}

/** Same author, same plan, close in time: the next message carries on without its own head. */
const CONTINUE_MS = 5 * 60_000;

function continues(post: VercelBoardPost, previous: VercelBoardPost | undefined): boolean {
  if (!previous || !post.by || !previous.by || post.by.key !== previous.by.key) return false;
  if (dayOf(post.at) !== dayOf(previous.at)) return false;
  if (post.plan && post.plan === previous.plan) return true;
  return post.at !== null && previous.at !== null && post.at - previous.at < CONTINUE_MS;
}

function agentIdOf(who: VercelBoardWho): string | null {
  return who.key.startsWith("agent:") ? who.key.slice("agent:".length) : null;
}

function Face({ who, harnesses, size = 32 }: { who: VercelBoardWho | null; harnesses: Record<string, string>; size?: number }) {
  const agentId = who ? agentIdOf(who) : null;
  const harness = agentId ? harnesses[agentId] : undefined;
  return (
    <span className="vbc-face" data-kind={who?.kind ?? "board"} style={{ width: size, height: size }} aria-hidden>
      {harness ? <HarnessMark harness={harness} size={Math.round(size * 0.5)} title={null} /> : (who?.label ?? "B").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Board text, first line as the message and the rest under it. */
function PostText({ text, open, lead, trail }: { text: string; open: boolean; lead?: ReactNode; trail?: ReactNode }) {
  const [head, ...rest] = text.trim().split("\n");
  const body = rest.join("\n").trim();
  return (
    <div className="vbc-text">
      <p className="vbc-text-head">{lead}<span>{head}</span>{trail}</p>
      {body ? <p className="vbc-text-body" data-open={open || undefined}>{body}</p> : null}
    </div>
  );
}

function ThreadEntry({ entry, harnesses }: { entry: VercelBoardThreadEntry; harnesses: Record<string, string> }) {
  if (entry.kind === "reply") {
    const { reply } = entry;
    return (
      <li className="vbc-reply">
        <Face who={reply.by} harnesses={harnesses} size={20} />
        <div>
          <p className="vbc-reply-head">
            <span className="vbc-name" data-kind={reply.by?.kind}>{reply.by?.label ?? "Board"}</span>
            {reply.at ? <time className="vbc-time">{clock.format(reply.at)}</time> : null}
          </p>
          <p className="vbc-reply-text">{reply.text}</p>
        </div>
      </li>
    );
  }
  const { step } = entry;
  // a backfilled finish names the task's owner, not who did it
  const to = step.to && !(step.derived && (step.kind === "completed" || step.kind === "failed")) ? step.to : null;
  return (
    <li className="vbc-step" data-tone={stepTone(step.kind)}>
      <time className="vbc-time">{entry.at ? clock.format(entry.at) : ""}</time>
      <span className="vbc-step-verb"><i aria-hidden />{VERB[step.kind]}</span>
      <span className="vbc-step-who">
        {step.by ? <Who who={step.by} /> : null}
        {to ? <><span className="vbt-arrow" aria-label="to">→</span><Who who={to} /></> : null}
      </span>
    </li>
  );
}

function Post({ post, head, open, onToggle, hue, harnesses }: {
  post: VercelBoardPost;
  head: boolean;
  open: boolean;
  onToggle: () => void;
  hue: CSSProperties | undefined;
  harnesses: Record<string, string>;
}) {
  const job = post.job;
  const result = job?.resultText?.trim() || null;
  // Who holds it, when Board says. An unrecorded holder is the Tasks table's to note, not every message's.
  const holder = job?.to ?? null;
  // a finish the copy made up at backfill says no more than the result under it
  const thread = result ? post.thread.filter(entry => !(entry.kind === "step" && entry.step.derived && (entry.step.kind === "completed" || entry.step.kind === "failed"))) : post.thread;
  const threadSize = thread.length + (result ? 1 : 0);
  // the preview skips a result heading that only repeats the task
  const title = post.text.trim().split("\n")[0]!.trim().toLowerCase();
  const preview = result ? firstLine(result.split("\n").filter(line => line.replace(/^#+\s*/, "").trim().toLowerCase() !== title).join("\n"), 200) : null;
  const planName = vercelBoardPlanName(post.plan);
  // the step names the task where its text does not already; a step that is only the title adds nothing
  const showStep = Boolean(job && job.step !== job.title && !post.text.split("\n")[0]!.toLowerCase().includes(job.step.toLowerCase()));
  const threadLabel = post.replyCount
    ? `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}`
    : open ? "Hide" : result ? (job?.state === "failed" ? "Reason" : "Result") : "Thread";
  return (
    <article className="vbc-post" data-head={head || undefined} data-open={open || undefined} data-st={job?.state} style={hue}>
      <div className="vbc-gutter">
        {head ? <Face who={post.by} harnesses={harnesses} /> : post.at ? <time className="vbc-time vbc-hover-time">{clock.format(post.at)}</time> : null}
      </div>
      <div className="vbc-main">
        {head ? (
          <p className="vbc-head">
            <span className="vbc-name" data-kind={post.by?.kind}>{post.by?.label ?? "Board"}</span>
            {post.at ? <time className="vbc-time">{clock.format(post.at)}</time> : null}
            {planName ? <span className="vbc-plan">{planName}</span> : null}
          </p>
        ) : null}
        <PostText
          text={post.text}
          open={open}
          lead={job ? <i className="vbt-swatch" data-st={job.state} aria-hidden /> : undefined}
          trail={job ? (
            <span className="vbc-task">
              {showStep ? <span className="vbc-step-name">{job.step}</span> : null}
              <span className="vbt-state" data-st={job.state}><i aria-hidden />{STATE_LABEL[job.state]}</span>
              {holder ? <Who who={holder} harnesses={harnesses} /> : null}
            </span>
          ) : undefined}
        />
        {threadSize ? (
          <button type="button" className="vbc-thread-line" aria-expanded={open} onClick={onToggle}>
            <span className="vbc-thread-count">{threadLabel}</span>
            {!open && preview ? <span className="vbc-thread-preview" data-st={job?.state}>{preview}</span> : null}
          </button>
        ) : null}
        {open ? (
          <ol className="vbc-thread">
            {thread.map(entry => <ThreadEntry key={entry.id} entry={entry} harnesses={harnesses} />)}
            {result ? (
              <li className="vbc-result" data-st={job?.state}>
                <span className="vbc-result-label">{job?.state === "failed" ? "Reason" : "Result"}</span>
                <p>{result}</p>
              </li>
            ) : null}
          </ol>
        ) : null}
      </div>
    </article>
  );
}

/** A Board room's Conversation view. */
export function VercelBoardConversation({ room }: { room: VercelBoardRoomState }) {
  const { data, error } = room;
  const [open, setOpen] = useState<string | null>(null);
  const posts = useMemo(() => data ? foldVercelBoardConversation(data) : [], [data]);
  const hueOf = useMemo(() => vercelBoardHues(groupVercelBoardRuns(data ? foldVercelBoardJobs(data) : [])), [data]);

  if (!data) {
    if (room.unheld) return null;
    return <p className="vbc-notice" data-tone={error ? "error" : undefined}>{error ?? "Loading the board…"}</p>;
  }
  if (!posts.length) {
    return <p className="vbc-notice">No posts in {data.channel} yet.</p>;
  }
  return (
    <div className="vbc" role="list" aria-label={`Posts in ${data.channel}`}>
      {error ? <p className="vbc-notice vbc-stale">{error}</p> : null}
      {posts.map((post, index) => {
        const previous = posts[index - 1];
        const newDay = dayOf(post.at) !== dayOf(previous?.at ?? null);
        return (
          <div key={post.id} role="listitem" className="vbc-item">
            {newDay && post.at ? <div className="chat-day vbc-day"><span>{dayLabel.format(post.at)}</span></div> : null}
            <Post
              post={post}
              head={newDay || !continues(post, previous)}
              open={open === post.id}
              onToggle={() => setOpen(open === post.id ? null : post.id)}
              hue={post.job ? hueOf(post.id) : undefined}
              harnesses={data.harnesses}
            />
          </div>
        );
      })}
    </div>
  );
}
