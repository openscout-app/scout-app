/*
 * One Feed item at any of its three sizes (post-size.ts), from one head
 * (FeedPostHead). The stream, Home's placements and the Canvas slot all draw
 * this; only `size` differs.
 *
 *   s  a tweet: mark, name and time, two lines of title, the caption,
 *      the picture as a thumbnail; a click grows it
 *   m  a post: the plate head (who at the top left, the time alone at the
 *      top right), the lead or the outcome, the caption (the ask, from the
 *      Feed table), a pull request's one line; its moves and what folds
 *      under it show on hover in a row it always keeps, so nothing shifts
 *   l  a lightbox above the stream with every word and the detail
 *      (PostDetail.tsx); the post stays at M in the stream behind it, and
 *      Escape or a click outside closes it; its extras load on open
 *
 * Controlled (`size` and `onSize`): the stream owns every item's size and
 * its keys. Uncontrolled (`defaultSize`): the item keeps its own, and Enter
 * and Escape on it grow and shrink it.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { isEditableTarget } from "../../lib/keyboard-nav-core.ts";
import { hasLargeLead, shownLead } from "./feed-store.ts";
import { postKind } from "./source-model.ts";
import { useFeedCapabilities } from "./feed-capabilities.tsx";
import { ReadOnlyPostActions } from "./ReadOnlyPostActions.tsx";
import { PostActions as FullPostActions, type PostActionsHandle } from "./PostActions.tsx";
import { PostDetail } from "./PostDetail.tsx";
import { ChangeLine, clock, Lead, Mark, MoveLine, PlateHead, PrLine, useDetail, useMissingPicture, type Navigate } from "./post-parts.tsx";
import { decisionWords, isWaitingOnYou, waitingReasonLabel } from "./attention-model.ts";
import { clip, grow, sizeForKey, WORDS, type PostSize } from "./post-size.ts";
import { useTurnSummary } from "./turn-summaries.ts";

/** Parts of a post with a click of their own, which a press on the post leaves alone. */
const OWN_CLICK = "a, button, input, textarea, select, label, summary, video, [role='button'], [contenteditable='true'], .fd-moves";

/** What the stream's keys reach in an item: its element, its size, its actions. */
export type ItemHandle = { el: HTMLElement; size: PostSize; actions: PostActionsHandle | null };
export type Register = (id: string, handle: ItemHandle | null) => void;
/** Sets an item's size; `from` is what was clicked, which stays where it is on screen. */
export type Resize = (size: PostSize, from?: Element | null) => void;

export type FeedItemProps = {
  post: FeedPostHead;
  navigate: Navigate;
  /** Controlled size; pass `onSize` with it. */
  size?: PostSize;
  onSize?: Resize;
  /** Uncontrolled: the size the item starts at. */
  defaultSize?: PostSize;
  /** The code-only posts folded under this one (head.joined, resolved). */
  joined?: readonly FeedPostHead[];
  focused?: boolean;
  register?: Register;
};

export function FeedItem({ post, navigate, size: controlled, onSize, defaultSize = "m", joined = [], focused = false, register }: FeedItemProps) {
  const { readOnly } = useFeedCapabilities();
  const [own, setOwn] = useState<PostSize>(defaultSize);
  const size = controlled ?? own;
  const resize = useCallback<Resize>((next, from) => (onSize ? onSize(next, from) : setOwn(next)), [onSize]);
  const { detail, load } = useDetail(post.id, post.version);
  // The Feed table titles a turn with its outcome (the summary's gist once one exists) and captions it with the ask,
  // so the item draws the caption it is given. Asking for the summary here is what gets one written; an agent's own
  // post is already its own words.
  useTurnSummary(size === "l" || post.agentPost?.own ? null : post.id, post.at);
  useEffect(() => { if (size === "l") load(); }, [size, load]);

  const el = useRef<HTMLElement | null>(null);
  /** The stream's copy of a post open in the lightbox. */
  const behind = useRef<HTMLElement | null>(null);
  const actions = useRef<PostActionsHandle | null>(null);
  // The lightbox takes focus, so its keys (Escape) reach it.
  useEffect(() => { if (size === "l") el.current?.focus({ preventScroll: true }); }, [size]);
  const sizeNow = useRef(size);
  sizeNow.current = size;
  useEffect(() => {
    if (!register || !el.current) return;
    const node = el.current;
    register(post.id, { el: node, get size() { return sizeNow.current; }, get actions() { return actions.current; } });
    return () => register(post.id, null);
  }, [post.id, register, size]);

  // Uncontrolled, the item answers its own keys; in the stream, the stream does.
  const keys = controlled ? undefined : (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    const next = sizeForKey(event.key, size);
    if (!next) return;
    event.preventDefault();
    resize(next);
  };

  // The S thumbnail, dropped when its file is gone (hooks run before the size branches).
  const shownThumb = smallPicture(post);
  const [thumbMissing, thumbGone] = useMissingPicture(shownThumb && !shownThumb.video ? shownThumb.src : null);
  const waiting = isWaitingOnYou(post);
  const common = {
    ref: (node: HTMLElement | null) => { el.current = node; },
    tabIndex: -1,
    "data-post-id": post.id,
    "data-size": size,
    "data-focused": focused || undefined,
    "data-waiting": waiting || undefined,
    "data-agent-only": post.reviewed ? undefined : true,
    "data-class": post.class,
    "data-kind": postKind(post),
    onKeyDown: keys,
  } as const;

  if (size === "s") {
    const thumb = shownThumb;
    return (
      <article {...common} className="fd-post fd-item">
        <button type="button" className="fd-s" data-thumb={thumb ? "" : undefined} onClick={(e) => resize(grow(size), e.currentTarget)} title={post.caption ? `${post.title}\n${post.caption}` : post.title}>
          <span className="fd-sHead">
            <Mark agent={post.agent} />
            <span className="fd-sName">{post.agent.name}</span>
            {waiting ? <span className="fd-sWait">{waitingReasonLabel(post)}</span> : null}
            <span className="fd-when">{clock(post.at)}</span>
          </span>
          <span className="fd-sTitle">{clip(post.title, WORDS.s.title)}</span>
          {post.caption ? <span className="fd-sCaption">{clip(post.caption, WORDS.s.caption)}</span> : null}
          {thumb && !thumbMissing ? (
            <span className="fd-sThumb" data-video={thumb.video || undefined}>
              {/* A film's first frame is its poster; it never plays at S. */}
              {thumb.video ? <video src={`${thumb.src}#t=0.1`} muted playsInline preload="metadata" /> : <img src={thumb.src} alt="" loading="lazy" decoding="async" onError={thumbGone} />}
              {thumb.video ? <svg className="fd-sPlay" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5z" /></svg> : null}
            </span>
          ) : null}
        </button>
      </article>
    );
  }

  const open = size === "l";
  const large = hasLargeLead(post);
  const { decision, title: outcome, caption: ask } = decisionWords(post);
  // Earlier turns on its thread, and the code-only posts folded under it.
  const more = post.updates + joined.length;
  // L opens above the stream as a lightbox; the post stays in the stream at M, so closing it returns the reader
  // to the same place. `lit` draws the lightbox's copy; the stream's copy is the one a click outside comes back to.
  const draw = (lit: boolean) => {
    const words = WORDS[lit ? "l" : "m"];
    const caption = clip(ask, words.caption);
    const title = clip(outcome, words.title);
    const flip = (event?: { currentTarget: Element }) => resize(lit ? "m" : "l", lit ? behind.current : event?.currentTarget);
    const joinedSlot: ReactNode = lit && joined.length
      ? <div className="fd-joined">{joined.map((p) => <FeedItem key={p.id} post={p} navigate={navigate} defaultSize="s" />)}</div>
      : null;
    const live = lit === open;
    const postActions = live && (readOnly
      ? <ReadOnlyPostActions post={post} navigate={navigate} />
      : <FullPostActions post={post} detail={detail} navigate={navigate} ref={actions} sheet={lit} />);
    // At M a press anywhere on the post opens it; what has its own click (a link, a button, the film's controls, the
    // reply box) keeps it, and a drag that selected words is reading, not a press.
    const openAnywhere = live && !lit ? (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if ((event.target as Element).closest(OWN_CLICK)) return;
      if (window.getSelection()?.toString()) return;
      flip(event);
    } : undefined;
    return (
      <article
        {...common}
        onClick={openAnywhere}
        data-opens={openAnywhere ? "" : undefined}
        ref={live ? common.ref : (node: HTMLElement | null) => { behind.current = node; }}
        className="fd-post fd-item"
        data-size={lit ? "l" : "m"}
        data-expanded={lit || undefined}
        data-large={large || undefined}
        data-decision={decision ? "" : undefined}
        data-behind={!live || undefined}
        aria-hidden={!live || undefined}
      >
        <div className="fd-postBody">
          <PlateHead post={post} />
          {/* A post waiting on the operator says what is being decided, in the request's own words, before
              the agent's outcome: who and why are in the head, what is here. */}
          {decision ? <p className="fd-decision"><span>{decision}</span></p> : null}
          {lit && post.line ? <p className="fd-line">{post.line.text}</p> : null}
          {large ? <Lead post={post} onOpen={flip} /> : null}
          {title || caption || !decision ? (
            <button type="button" className="fd-head" onClick={flip} aria-expanded={lit}>
              {title ? <span className="fd-title">{title}</span> : null}
              {caption ? <span className="fd-caption">{caption}</span> : null}
            </button>
          ) : null}
          <PrLine post={post} />
          {!lit && post.change ? (
            <div className="fd-meta">
              <ChangeLine change={post.change} />
            </div>
          ) : null}
          <MoveLine move={post.move} />
          {/* Open, the moves and the box to write to the agent sit under the title, before the detail: what to do
              with the post is read with the post, not at the foot of everything it says. */}
          {live && lit ? (
            <div className="fd-sheetMoves">
              {postActions}
            </div>
          ) : null}
          {live && lit ? <p className="fd-keysHint" aria-hidden><kbd>j</kbd><kbd>k</kbd> next and previous <kbd>Esc</kbd> close</p> : null}
          {lit ? <PostDetail post={post} detail={detail} navigate={navigate} leadShown={large} more={joinedSlot} /> : null}
        </div>
        {/* At M every move, and what folds under the post, sits in a row the post always keeps at its foot. The row
            fills on hover, focus or a key, so nothing below it moves. */}
        {live && !lit ? (
          <div className="fd-moves">
            {postActions}
            {more ? <button type="button" className="fd-more fd-movesMore" onClick={flip}>{more} more {more === 1 ? "update" : "updates"}</button> : null}
          </div>
        ) : null}
      </article>
    );
  };
  if (!open) return draw(false);
  return (
    <>
      {draw(false)}
      {createPortal(
        <div className="fd-lightbox" onClick={(event) => { if (event.target === event.currentTarget) resize("m", behind.current); }}>
          <div className="fd-lightboxPanel" role="dialog" aria-modal="true" aria-label={post.title}>{draw(true)}</div>
        </div>,
        themedRoot(),
      )}
    </>
  );
}

/**
 * Where the lightbox mounts: inside the shell's theme scope, not on <body>. The palette (`--scout-chrome-ink-*`,
 * `--accent` and the rest) is set on the shell's elements (scout/Provider.tsx), so a post drawn on <body> lost it:
 * its ink, soft and faint all fell back to one inherited colour. The scope element is `display: contents`, so the
 * fixed lightbox still lays out against the window.
 */
function themedRoot(): HTMLElement {
  return document.querySelector<HTMLElement>("div[data-scout-theme]") ?? document.body;
}

/** The picture an S item shows beside its words: a screenshot, or a film's first frame. Pages have no poster yet. */
function smallPicture(post: FeedPostHead): { src: string; video: boolean } | null {
  const lead = shownLead(post);
  if (lead.kind === "visual") return { src: lead.ref.asset, video: false };
  if (lead.kind === "video") return { src: lead.ref.asset, video: true };
  return null;
}
