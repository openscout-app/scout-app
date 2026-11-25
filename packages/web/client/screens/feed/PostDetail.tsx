/*
 * A Feed item at its detailed size (L): everything about the turn, organized
 * around the post, so the operator rarely has to leave the stream for the
 * session or the diff. The item's head and actions stay where they are
 * (FeedItem.tsx); this draws what opens under them.
 *
 *   Artifacts        the other things the turn made: pictures and films whole, a page, the running output
 *                    (the post's own lead shows whole above, uncropped: feed.css)
 *   Outcome          what landed, the checks, what is next, what is open
 *   Asked            what the operator asked, when it says more than the title
 *   Steps            the turn's steps in brief, read from the session
 *   Files changed    each edited file's diff, folded on its own; the pull request's size
 *   More updates     the code-only posts folded under this one, as compact items
 *   In the session   its last lines the post does not already say, and a box to steer the agent
 *   How it got here  the thread's earlier turns, this turn, what you said after
 *   Links            pull requests, the commit, the branch, the thread, the session, the task, a link
 *
 * It reads GET /api/feed/post/:id and the owner's session when the item
 * opens, never with the stream.
 */
import { useState, type MouseEvent, type ReactNode } from "react";
import "./post-detail.css";
import { routePath } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import type { FeedLead, FeedPostDetail, FeedPostHead, FeedPr } from "../../../shared/api/feed.ts";
import { ChangeLine, clock, DiffBars, G, Glyph, LiveLead, Mark, PageLead, PrChip, RouteLink, STATE_LABEL, useMissingPicture, type Navigate } from "./post-parts.tsx";
import { dayDate, shownLead } from "./feed-store.ts";
import { FileDiffs, LastLines, StepsBrief, useSessionRead, type SessionReadState } from "./post-session.tsx";
import { newLines } from "./post-session-model.ts";

const MAX_ARTIFACTS = 6;

/** The time, with the day when it is not today. */
function when(ts: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return clock(ts);
  const d = new Date(ts);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${dayDate(key)}, ${clock(ts)}`;
}

function leaf(path: string | null): string | null {
  if (!path) return null;
  return path.replace(/\/+$/, "").split("/").pop() || null;
}

/** Every lead worth looking at, strongest first: pictures, films, a page, running output. */
export function artifactsOf(head: FeedPostHead, detail: FeedPostDetail | null): FeedLead[] {
  const leads = detail?.leads.length ? detail.leads : [head.lead];
  const seen = new Set<string>();
  const out: FeedLead[] = [];
  for (const lead of leads) {
    const key = leadKey(lead);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(lead);
  }
  return out.slice(0, MAX_ARTIFACTS);
}

function Artifact({ lead }: { lead: FeedLead }) {
  const [missing, onError] = useMissingPicture(lead.kind === "visual" ? lead.ref.asset : null);
  switch (lead.kind) {
    case "visual":
      if (missing) return null;
      return (
        <figure className="pd-figure">
          <a className="pd-media" href={lead.ref.asset} target="_blank" rel="noreferrer" title="Open the full picture">
            <img src={lead.ref.asset} alt={lead.ref.caption ?? lead.ref.name} decoding="async" onError={onError} />
          </a>
          <figcaption className="pd-figcaption">{lead.ref.caption ?? lead.ref.name}</figcaption>
        </figure>
      );
    case "video":
      return (
        <figure className="pd-figure">
          <div className="pd-media">
            <video src={lead.ref.asset} controls playsInline preload="metadata" aria-label={lead.ref.caption ?? lead.ref.name} />
          </div>
          <figcaption className="pd-figcaption">{lead.ref.caption ?? lead.ref.name}</figcaption>
        </figure>
      );
    case "page": return <PageLead path={lead.ref.path} href={lead.ref.href} />;
    case "live": return <LiveLead workId={lead.ref.workId} />;
    default: return null;
  }
}

function leadKey(lead: FeedLead): string | null {
  switch (lead.kind) {
    case "video": case "visual": return lead.ref.asset;
    case "page": return lead.ref.path;
    case "live": return `live:${lead.ref.workId}`;
    default: return null;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pd-section" aria-label={title}>
      <h3 className="pd-sectionHead">{title}</h3>
      {children}
    </section>
  );
}

function Outcome({ detail }: { detail: FeedPostDetail }) {
  const { landed, checks, next, open } = detail.body;
  if (!landed && !checks && !next && !open) return null;
  return (
    <Section title="Outcome">
      {landed ? <p className="pd-landed">{landed}</p> : null}
      {checks || next || open ? (
        <dl className="pd-facts">
          {checks ? <><dt>Checks</dt><dd>{checks}</dd></> : null}
          {next ? <><dt>Next</dt><dd>{next}</dd></> : null}
          {open ? <><dt>Open</dt><dd>{open}</dd></> : null}
        </dl>
      ) : null}
    </Section>
  );
}

/** What the operator asked. The title is often its first sentence; it shows only when it says more. */
function askedOf(head: FeedPostHead, detail: FeedPostDetail): string | null {
  const trim = (t: string) => t.replace(/[.\s]+$/, "");
  return detail.asked && trim(detail.asked) !== trim(head.title) ? detail.asked : null;
}

/** The turn's story, oldest first: earlier turns on the thread, this one, and what you said after. */
function Story({ head, detail }: { head: FeedPostHead; detail: FeedPostDetail }) {
  const earlier = [...detail.earlier].sort((a, b) => a.at - b.at);
  if (!earlier.length && !head.line) return null;
  return (
    <Section title="How it got here">
      <ol className="pd-story">
        {earlier.map((u) => (
          <li key={u.id} className="pd-step">
            <span className="pd-stepWhen">{when(u.at)}</span>
            <span className="pd-stepText">{u.title}</span>
            <span className="pd-stepMeta">
              <Mark agent={u.agent} /><span>{u.agent.name}</span>
              {u.prs.map((pr) => <span key={pr.key}>· {pr.label} {STATE_LABEL[pr.state]}</span>)}
            </span>
          </li>
        ))}
        <li className="pd-step">
          <span className="pd-stepWhen">{when(head.at)}</span>
          <span className="pd-stepText">{head.agentPost?.own ? "Posted this" : head.state === "review" ? "Finished this turn and handed it back for review" : "Finished this turn"}</span>
          <span className="pd-stepMeta"><Mark agent={head.agent} /><span>{head.agent.name}</span></span>
        </li>
        {head.line ? (
          <li className="pd-step">
            <span className="pd-stepWhen">{when(head.line.at)}</span>
            <span className="pd-stepText">You said: {head.line.text}</span>
          </li>
        ) : null}
      </ol>
    </Section>
  );
}

/** The thread's pull requests, all of them once the detail is read. */
function pullsOf(head: FeedPostHead, detail: FeedPostDetail | null): FeedPr[] {
  return detail?.prs.length ? detail.prs : head.prs;
}

/** The pull request the diff is read from: the change's, else the first. */
function leadPull(head: FeedPostHead, prs: readonly FeedPr[]): FeedPr | null {
  const key = head.change?.pull ?? null;
  return (key ? prs.find((p) => p.key === key) : undefined) ?? prs[0] ?? null;
}

/** A link to the stream with this post open; a plain click copies it. */
function CopyLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const href = routePath({ view: "inbox", post: id });
  const copy = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void navigator.clipboard?.writeText(new URL(href, window.location.href).toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }, () => {});
  };
  return <a className="pd-ref" href={href} onClick={copy}>{copied ? "Copied" : "Copy a link to this post"}</a>;
}

/** Where the post leads: the entry points, each one click away. */
function EntryPoints({ head, detail, navigate }: { head: FeedPostHead; detail: FeedPostDetail; navigate: Navigate }) {
  const prs = pullsOf(head, detail);
  const lead = leadPull(head, prs);
  const sha = detail.diff?.sha ?? null;
  const sessionRoute: Route | null = head.owner.sessionId ? { view: "sessions", sessionId: head.owner.sessionId } : null;
  const folder = leaf(head.owner.cwd);
  return (
    <Section title="Links">
      <dl className="pd-refs">
        {prs.length ? (
          <>
            <dt>{prs.length === 1 ? "Pull request" : "Pull requests"}</dt>
            <dd className="pd-chips">{prs.map((pr) => <PrChip key={pr.key} pr={pr} />)}</dd>
          </>
        ) : null}
        {sha && lead ? (
          <>
            <dt>Commit</dt>
            <dd><a className="pd-ref pd-mono" href={`${lead.url.replace(/\/+$/, "")}/commits/${sha}`} target="_blank" rel="noreferrer" title={sha}>{sha.slice(0, 7)}</a></dd>
          </>
        ) : null}
        {head.agentPost?.links.length ? (
          <>
            <dt>{head.agentPost.links.length === 1 ? "Link" : "Links"}</dt>
            <dd className="pd-chips">{head.agentPost.links.map((link) => <a key={link.url} className="pd-ref pd-wrap" href={link.url} target="_blank" rel="noreferrer">{link.title ?? link.url.replace(/^https?:\/\//, "")}</a>)}</dd>
          </>
        ) : null}
        {detail.branch ? <><dt>Branch</dt><dd className="pd-mono pd-wrap">{detail.branch}</dd></> : null}
        {folder ? <><dt>Folder</dt><dd className="pd-mono pd-wrap" title={head.owner.cwd ?? undefined}>{folder}</dd></> : null}
        {head.study ? <><dt>Study</dt><dd><a className="pd-ref" href={head.study} target="_blank" rel="noreferrer">Open the study</a></dd></> : null}
        {head.conversationId ? <><dt>Thread</dt><dd><RouteLink className="pd-ref" route={{ view: "conversation", conversationId: head.conversationId }} navigate={navigate}>Open the thread</RouteLink></dd></> : null}
        {sessionRoute ? <><dt>Session</dt><dd><RouteLink className="pd-ref" route={sessionRoute} navigate={navigate}>Open the session</RouteLink></dd></> : null}
        {head.agentPost?.own ? null : <><dt>Task</dt><dd><RouteLink className="pd-ref" route={{ view: "work", workId: head.workId }} navigate={navigate}>Open the task</RouteLink></dd></>}
        {detail.agents.length > 1 ? (
          <>
            <dt>Agents</dt>
            <dd className="pd-agents">{detail.agents.map((a) => <span key={a.name} className="pd-agent"><Mark agent={a} />{a.name}</span>)}</dd>
          </>
        ) : null}
        <dt>Link</dt><dd><CopyLink id={head.id} /></dd>
      </dl>
    </Section>
  );
}

/**
 * The files the turn changed. From the session, each file's diff folds on its
 * own; without one, the pull request's per-file sizes fold behind its size.
 */
function FilesChanged({ stat, pull, session }: { stat: FeedPostDetail["diff"]; pull: FeedPr | null; session: SessionReadState }) {
  const [open, setOpen] = useState(false);
  const files = session.files?.list ?? [];
  if (!files.length && !stat) return null;
  const all = stat && pull && (files.length ? stat.files > files.length : stat.files > stat.top.length) ? (
    <a className="pd-ref pd-small" href={`${pull.url.replace(/\/+$/, "")}/files`} target="_blank" rel="noreferrer">All {stat.files} files on GitHub</a>
  ) : null;
  return (
    <Section title="Files changed">
      {files.length ? (
        <>
          {stat ? <span className="pd-small pd-fileStat"><ChangeLine change={stat} />{stat.areas.length ? <span>{stat.areas.join(", ")}</span> : null}</span> : null}
          <FileDiffs files={files} />
          {session.files?.from === "trace" ? <span className="pd-small">Previews from the session trace, a few lines each.</span> : null}
          {all}
        </>
      ) : stat ? (
        <>
          <button type="button" className="pd-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="pd-foldIcon" data-open={open || undefined}><Glyph d={G.chevron} size={11} /></span>
            <ChangeLine change={stat} />
            {stat.areas.length ? <span className="pd-small">{stat.areas.join(", ")}</span> : null}
          </button>
          {open ? <DiffBars stat={stat} /> : null}
          {open ? all : null}
        </>
      ) : null}
    </Section>
  );
}

/**
 * What opens under an item's head at L. `leadShown`: the item already draws
 * its lead above (whole, once open), so it is not drawn again. `more`: the
 * code-only posts folded under this one, drawn by the item as compact items.
 */
export function PostDetail({ post, detail, navigate, leadShown, more = null }: { post: FeedPostHead; detail: FeedPostDetail | null; navigate: Navigate; leadShown: boolean; more?: ReactNode }) {
  const session = useSessionRead(post, detail?.diff?.sha ?? null);
  if (!detail) return <div className="fd-loading fd-loading--inline" role="status" aria-label="Loading"><span aria-hidden /><span aria-hidden /></div>;
  const pull = leadPull(post, pullsOf(post, detail));
  const shownKey = leadShown ? leadKey(shownLead(post)) : null;
  const others = artifactsOf(post, detail).filter((lead) => leadKey(lead) !== shownKey);
  const asked = askedOf(post, detail);
  const read = session.read;
  // The session's last lines, less what the outcome already says.
  const last = read ? newLines(read.last, [detail.body.landed, detail.body.checks, detail.body.next, detail.body.open, post.caption]) : [];
  return (
    <div className="pd">
      {others.length ? (
        <Section title={shownKey ? "More from this turn" : "What it made"}>
          <div className="pd-artifacts">{others.map((lead, i) => <Artifact key={i} lead={lead} />)}</div>
        </Section>
      ) : null}
      <Outcome detail={detail} />
      {asked ? <Section title="Asked"><p className="pd-asked">{asked}</p></Section> : null}
      {session.reading ? <div className="fd-loading fd-loading--inline" role="status" aria-label="Reading the session"><span aria-hidden /><span aria-hidden /></div> : null}
      {read?.steps.length ? <Section title="Steps"><StepsBrief steps={read.steps} more={read.moreSteps} /></Section> : null}
      <FilesChanged stat={detail.diff} pull={pull} session={session} />
      {more ? <Section title="More updates">{more}</Section> : null}
      {last.length ? <Section title="Since then in the session"><LastLines lines={last} /></Section> : null}
      <Story head={post} detail={detail} />
      <EntryPoints head={post} detail={detail} navigate={navigate} />
    </div>
  );
}
