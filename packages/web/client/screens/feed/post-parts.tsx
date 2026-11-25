/*
 * The pieces of a Feed item, shared by every size (FeedItem.tsx) and the
 * detailed size's body (PostDetail.tsx): its head, its leads (picture, film,
 * running output, page), its pull request chips, and the detail read.
 */
import { DiffStat } from "../../components/DiffStat.tsx";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { api } from "../../lib/api.ts";
import { routePath } from "../../lib/router.ts";
import { timeAgo, timeAgoWithSuffix } from "../../lib/time.ts";
import { moveWords, type FeedMove } from "../../../shared/api/feed-moves.ts";
import type { Route } from "../../lib/types.ts";
import type { FeedAgent, FeedChange, FeedDiffStat, FeedLead, FeedLive, FeedPostDetail, FeedPostHead, FeedPr } from "../../../shared/api/feed.ts";
import { postKind } from "./source-model.ts";
import { shownLead } from "./feed-store.ts";
import { isWaitingOnYou, waitingReasonLabel } from "./attention-model.ts";
import { LiveDot, Mark as SourceMark, PostHead, WaitsDot } from "./sources.tsx";

const LIVE_POLL_MS = 4_000;

export type Navigate = (route: Route) => void;

/** "14:07", the one clock Home and the Feed share. */
export function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The operator's latest move on the post, from the Feed or Home, in one quiet
 * line: "You chose Option B · 2h ago". The web server keeps it, so it is the
 * same after a reload or a restart, and on every device.
 */
export function MoveLine({ move }: { move: FeedMove | null | undefined }) {
  if (!move) return null;
  // One line of it; the whole receipt is on hover.
  const label = move.label.length > 120 ? `${move.label.slice(0, 119)}…` : move.label;
  return (
    <p className="fd-you" data-kind={move.kind}>
      <span className="fd-youWords">{moveWords({ kind: move.kind, label })}</span>
      <span className="fd-faint"> · {timeAgoWithSuffix(move.at)}</span>
    </p>
  );
}

export function isNotModified(error: unknown): boolean {
  return (error as { status?: number })?.status === 304;
}

/** A plain link that the shell routes, so a modified click still opens a tab. */
export function RouteLink({ route, navigate, children, className }: { route: Route; navigate: Navigate; children: ReactNode; className?: string }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(route);
  };
  return <a className={className} href={routePath(route)} onClick={onClick}>{children}</a>;
}

export function Glyph({ d, size = 12 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const G = {
  // A pull request: two commits on a branch line, and the head's line curving back into it. The circles sit on
  // the line ends; drawn from a line's end, they sat beside it and the mark read as a music note.
  pr: "M3 3.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M3 12.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10 12.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6",
  draft: "M3 12.5V10l7-7 2.5 2.5-7 7zM9 4l2.5 2.5",
  chevron: "M6 4l4 4-4 4",
  page: "M2.5 3.5h11v9h-11zM2.5 6h11",
  flag: "M4 13.5V2.5M4 3h7.5L10 5.75l1.5 2.75H4",
};

export const STATE_LABEL: Record<FeedPr["state"], string> = { merged: "merged", open: "in review", draft: "draft", closed: "closed" };

/** True once the element has come near the screen; `stay` keeps it true after. */
export function useOnScreen<T extends Element>(stay: boolean): [(node: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    if (!node || typeof IntersectionObserver === "undefined") return;
    observer.current = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setSeen(true);
        if (stay) observer.current?.disconnect();
      } else if (!stay) setSeen(false);
    }, { rootMargin: "200px 0px" });
    observer.current.observe(node);
  }, [stay]);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, seen];
}

/* ── the live channel: one poll, only while a live lead is on screen ─────── */

const live = (() => {
  let state: FeedLive | null = null;
  let watchers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const tick = async () => {
    timer = null;
    if (watchers <= 0) return;
    try {
      state = await api<FeedLive>(`/api/feed/live${state ? `?since=${state.version}` : ""}`);
      for (const l of listeners) l();
    } catch (error) {
      if (!isNotModified(error)) { /* keep what is shown */ }
    }
    if (watchers > 0) timer = setTimeout(tick, LIVE_POLL_MS);
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    get: () => state,
    watch() {
      watchers += 1;
      if (!timer) void tick();
      return () => { watchers -= 1; };
    },
  };
})();

/* ── leads ─────────────────────────────────────────────────────────────── */

export function VideoLead({ asset, caption }: { asset: string; caption: string | null }) {
  const [ref, near] = useOnScreen<HTMLDivElement>(false);
  const [armed, setArmed] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (near) setArmed(true); }, [near]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (near && !reduced) void el.play().catch(() => {});
    else el.pause();
  }, [near, armed]);
  return (
    <div ref={ref} className="fd-media">
      {/* Loads once near the screen; plays muted while on it unless reduced motion is requested. */}
      <video ref={video} src={armed ? asset : undefined} muted loop playsInline preload="metadata" controls aria-label={caption ?? "Recording"} />
    </div>
  );
}

/**
 * A picture whose file is gone draws nothing, not an empty frame. The writer checked the file when it wrote the post,
 * but a scratch folder can be cleaned after that, and the asset route then answers 404. Keyed by the address, so a new
 * picture gets its own try.
 */
export function useMissingPicture(src: string | null | undefined): [missing: boolean, onError: () => void] {
  const [failed, setFailed] = useState<string | null>(null);
  return [!!src && failed === src, () => { if (src) setFailed(src); }];
}

/**
 * Where a picture's load stands: loading, shown, or gone. A pull request's screenshot is read through `gh` on its
 * first view (server feed/pr-image.ts), which can take seconds or fail, so its frame must not stand empty meanwhile.
 * `ref` catches a picture the browser already had, whose load fired before React listened. Keyed by the address.
 */
export function usePictureLoad(src: string | null | undefined): {
  at: "loading" | "shown" | "gone";
  ref: (img: HTMLImageElement | null) => void;
  onLoad: () => void;
  onError: () => void;
} {
  const [state, setState] = useState<{ src: string; at: "shown" | "gone" } | null>(null);
  const settle = useCallback((at: "shown" | "gone") => { if (src) setState({ src, at }); }, [src]);
  const ref = useCallback((img: HTMLImageElement | null) => { if (img?.complete && img.naturalWidth > 0) settle("shown"); }, [settle]);
  return { at: src && state?.src === src ? state.at : "loading", ref, onLoad: () => settle("shown"), onError: () => settle("gone") };
}

/**
 * A click expands the post, where the picture shows whole; a modified click opens the picture. While the picture
 * loads, its slot keeps the frame's size but draws no frame; one that cannot load draws nothing.
 */
export function VisualLead({ asset, name, caption, onOpen }: { asset: string; name: string; caption: string | null; onOpen?: (event: { currentTarget: Element }) => void }) {
  const picture = usePictureLoad(asset);
  if (picture.at === "gone") return null;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpen(event);
  };
  const label = caption?.trim() || (name && name !== "Screenshot" ? name : null);
  return (
    <a className="fd-media fd-mediaVisual" data-loading={picture.at === "loading" || undefined} href={asset} target="_blank" rel="noreferrer" onClick={onClick}>
      <img ref={picture.ref} src={asset} alt={caption ?? name} loading="lazy" decoding="async" onLoad={picture.onLoad} onError={picture.onError} />
      {label && picture.at === "shown" ? <span className="fd-mediaCaption">{label}</span> : null}
    </a>
  );
}

export function LiveLead({ workId }: { workId: string }) {
  const [ref, near] = useOnScreen<HTMLDivElement>(false);
  useEffect(() => (near ? live.watch() : undefined), [near]);
  const state = useSyncExternalStore(live.subscribe, live.get, () => null);
  const session = state?.sessions.find((s) => s.workId === workId);
  // The post's head already says Running: the lead shows only the newest output.
  const text = session?.snippet ?? session?.title ?? "";
  return (
    <div ref={ref} className="fd-live" data-empty={text ? undefined : true}>
      <span className="fd-liveDot" role="img" aria-label="Running" />
      <span className="fd-liveText">{text}</span>
      {session ? <span className="fd-faint">{clock(session.at)}</span> : null}
    </div>
  );
}

export function DiffBars({ stat }: { stat: FeedDiffStat }) {
  const max = Math.max(1, ...stat.top.map((f) => f.additions + f.deletions));
  return (
    <div className="fd-diff">
      {stat.top.map((file) => (
        <div key={file.path} className="fd-diffRow" title={file.path}>
          <span className="fd-diffPath">{file.path}</span>
          <span className="fd-diffBar" aria-hidden>
            <span className="fd-diffAdd" style={{ width: `${(file.additions / max) * 100}%` }} />
            <span className="fd-diffDel" style={{ width: `${(file.deletions / max) * 100}%` }} />
          </span>
          <DiffStat className="fd-diffNum" additions={file.additions} deletions={file.deletions} />
        </div>
      ))}
      <div className="fd-diffFoot">
        <span>{stat.files} {stat.files === 1 ? "file" : "files"}</span>
        <DiffStat additions={stat.additions} deletions={stat.deletions} />
        {stat.areas.length ? <span>{stat.areas.join(", ")}</span> : null}
      </div>
    </div>
  );
}

/** The change's size, one quiet line: "4 files +120 −18", the lines in their colors. */
export function ChangeLine({ change }: { change: Pick<FeedChange, "files" | "additions" | "deletions"> }) {
  return (
    <span className="fd-change">
      {change.files != null ? <span>{change.files} {change.files === 1 ? "file" : "files"}</span> : null}
      {change.additions != null ? <span className="fd-add">+{change.additions}</span> : null}
      {change.deletions != null ? <span className="fd-del">−{change.deletions}</span> : null}
    </span>
  );
}

/** A file's name with its folder, "board-case/faults.md": what the reader recognises; the whole path is its tooltip. */
export function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

export function PageLead({ path, href }: { path: string; href: string | null }) {
  const [embed, setEmbed] = useState(false);
  return (
    <div className="src-inPlace fd-pageCard" data-open={embed || undefined} onKeyDown={(e) => { if (e.key === "Escape" && embed) { e.stopPropagation(); setEmbed(false); } }}>
      <div className="fd-pageChrome">
        <span className="fd-pageDots" aria-hidden="true"><span /><span /><span /></span>
        <span className="fd-pagePath" title={path}><Glyph d={G.page} size={12} /><span>{shortPath(path)}</span></span>
        <span className="fd-pageActions">
          {href ? <button type="button" className="fd-pageBtn" aria-expanded={embed} onClick={() => setEmbed((o) => !o)}>{embed ? "Close preview" : "Preview"}</button> : null}
          {href ? <a className="fd-pageBtn" href={href} target="_blank" rel="noreferrer">Open ↗</a> : null}
        </span>
      </div>
      {href ? (
        <div className="src-region" inert={!embed}>
          <div className="src-regionInner">{embed ? <div className="fd-embed"><iframe src={href} title={path} loading="lazy" /></div> : null}</div>
        </div>
      ) : null}
    </div>
  );
}

/** What a post shows first: a film, a picture, the running output, a page. A diff never leads. */
export function Lead({ post, onOpen }: { post: FeedPostHead; onOpen?: (event: { currentTarget: Element }) => void }) {
  const lead: FeedLead = shownLead(post);
  switch (lead.kind) {
    case "video": return <VideoLead asset={lead.ref.asset} caption={lead.ref.caption} />;
    case "visual": return <VisualLead asset={lead.ref.asset} name={lead.ref.name} caption={lead.ref.caption} onOpen={onOpen} />;
    case "live": return <LiveLead workId={lead.ref.workId} />;
    case "page": return <PageLead path={lead.ref.path} href={lead.ref.href} />;
    default: return null;
  }
}

/* ── a post ────────────────────────────────────────────────────────────── */

export function Mark({ agent }: { agent: FeedAgent }) {
  return <SourceMark harness={agent.harness} compact />;
}

export function PrChip({ pr }: { pr: FeedPr }) {
  return (
    <a className="fd-chip" href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>
      <Glyph d={pr.state === "draft" ? G.draft : G.pr} />
      <span className="fd-chipLabel">{pr.label}</span>
      <span className="fd-chipState" data-state={pr.state}>{STATE_LABEL[pr.state]}</span>
    </a>
  );
}

export function useDetail(id: string, version: number) {
  const [detail, setDetail] = useState<FeedPostDetail | null>(null);
  const loading = useRef<number | null>(null);
  const load = useCallback(() => {
    if (loading.current === version) return;
    loading.current = version;
    void api<FeedPostDetail>(`/api/feed/post/${encodeURIComponent(id)}`).then(setDetail).catch(() => { loading.current = null; });
  }, [id, version]);
  return { detail, load };
}

/**
 * The agent line. Most posts are an agent's, not yet reviewed, so that is said
 * once, in the kind's tooltip, not on every head; a reviewed post shows "You
 * with" before the agent. Why a post waits on you is the waits dot's label,
 * not more words in the head. `brief` (the M size) keeps the kind, the agent
 * and the time; L adds the thread and the others.
 */
export function Byline({ post, brief = false }: { post: FeedPostHead; brief?: boolean }) {
  const live = post.lead.kind === "live";
  return (
    <PostHead
      kind={<KindMark post={post} />}
      signal={live || post.forYou ? <>{live ? <LiveDot /> : null}{post.forYou ? <WaitsDot label={post.forYou.label || undefined} /> : null}</> : null}
      context={brief ? [] : [post.thread]}
      who={{ harness: post.agent.harness, name: post.agent.name, more: brief ? 0 : post.others, withYou: post.reviewed }}
      at={clock(post.at)}
    />
  );
}

/** The folder’s last path component, or null. */
function folderName(cwd: string | null): string | null {
  const parts = cwd?.split("/").filter(Boolean);
  return parts?.length ? parts[parts.length - 1] ?? null : null;
}

/**
 * A post's head: harness monogram, agent name, repo/thread context pill,
 * explicit wait cue when waiting on the operator, and timestamp.
 */
export function PlateHead({ post }: { post: FeedPostHead }) {
  const live = post.lead.kind === "live";
  const where = post.thread ?? folderName(post.owner.cwd);
  const milestone = postKind(post) === "milestone";
  const waiting = isWaitingOnYou(post);
  const reason = waiting ? waitingReasonLabel(post) : null;
  return (
    <div className="fd-plateHead">
      <span className="fd-plate"><SourceMark harness={post.agent.harness} compact /></span>
      <span className="fd-plateLines">
        <span className="fd-plateName">
          {post.reviewed ? <span className="fd-plateYou">You <span className="fd-faint">with</span></span> : null}
          <span className="fd-plateAgent">{post.agent.name}</span>
          {post.others ? <span className="fd-faint" title={`and ${post.others} more ${post.others === 1 ? "agent" : "agents"}`}>+{post.others}</span> : null}
          {where ? <span className="fd-plateContext">{where}</span> : null}
          {milestone ? <span className="fd-kindFlag" title="Milestone"><Glyph d={G.flag} /></span> : null}
          {live ? <LiveDot /> : null}
          {waiting ? (
            <span className="fd-waitBadge" data-reason={post.forYou?.reason}>
              <span>{reason}</span>
              <span className="fd-waitAge">· {timeAgo(post.at)}</span>
            </span>
          ) : (
            <time className="fd-plateAt" dateTime={new Date(post.at).toISOString()}>{clock(post.at)}</time>
          )}
        </span>
      </span>
    </div>
  );
}

/** A pull request post's one structured line under its words: the glyph, "#2019", its title, its state. */
export function PrLine({ post }: { post: FeedPostHead }) {
  const kind = postKind(post);
  const pr = post.prs[0];
  if (!pr || !(kind === "pr" || kind === "draft" || kind === "merged")) return null;
  return (
    <a className="fd-prLine" data-state={pr.state} href={pr.url} target="_blank" rel="noreferrer">
      <Glyph d={pr.state === "draft" ? G.draft : G.pr} />
      <span className="fd-prNum">{pr.label}</span>
      <span className="fd-prTitle">{pr.title}</span>
      <span className="fd-prState">{STATE_LABEL[pr.state]}</span>
    </a>
  );
}

/**
 * What a post is, said by its data rather than a type word: its pull request (the glyph, "#2019", its state),
 * or a flag for an agent's milestone. Every other post is told by its title, picture or page, so the slot is empty.
 */
function KindMark({ post }: { post: FeedPostHead }) {
  const kind = postKind(post);
  const pr = post.prs[0];
  if (pr && (kind === "pr" || kind === "draft" || kind === "merged")) {
    return (
      <a className="fd-kindPr" data-state={pr.state} href={pr.url} target="_blank" rel="noreferrer" title={pr.title}>
        <Glyph d={pr.state === "draft" ? G.draft : G.pr} />
        <span>{pr.label}</span>
        <span className="fd-kindState">{STATE_LABEL[pr.state]}</span>
      </a>
    );
  }
  if (kind === "milestone") return <span className="fd-kindFlag" title="Milestone"><Glyph d={G.flag} /></span>;
  return null;
}
