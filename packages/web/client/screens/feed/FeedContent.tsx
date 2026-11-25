/*
 * The feed's stream: the most useful finished work, led by what was made.
 * The server groups, scores and ranks posts. This stream renders its All and
 * Reviewed views. Every post is one FeedItem at one of three sizes
 * (post-size.ts): the day's chosen posts at M, the folded rest
 * and a session's run at S, and any post opened in place at L, where its
 * extras load. Enter grows the focused item one size and Escape puts it back;
 * a click anywhere on a post opens L (links and buttons in it keep their own
 * click), and j, k or the arrows step through posts, open ones included. Nothing navigates: the
 * thread, session and pull requests are references inside L. /?post=<id>
 * opens the stream with that post at L.
 *
 * FeedContent draws the stream alone for the embedded Feed surface.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ScoutPageSkeleton } from "../../shell/ScoutPageSkeleton.tsx";
import "./feed.css";
import { api } from "../../lib/api.ts";
import { useBrokerRefresh } from "../../lib/broker-refresh.ts";
import { usePageRefresh } from "../../lib/page-refresh.ts";
import { FLEET_EVENT_KINDS, matchesKinds } from "../../lib/broker-event-kinds.ts";
import type { FeedPostHead, FeedResponse, FeedViewId } from "../../../shared/api/feed.ts";
import type { FeedSources } from "../../../shared/api/feed-sources.ts";
import { isEditableTarget, isModalShortcutContext } from "../../lib/keyboard-nav-core.ts";
import { appendPage, dayDate, dayLabel, emptyFeed, feedPath, mergeFeed, refillDay, type FeedState } from "./feed-store.ts";
import { collectWaitingPosts, foldInventoryLabel, isVisualOrShippedResult, partitionDayPosts } from "./attention-model.ts";
import { GitHubCatchUp } from "./GitHubCatchUp.tsx";
import { mergedDays, sourcePostsByDay, type SourcePost } from "./source-model.ts";
import { Mark, OutsideThread, PostHead, QuotaWarning, useFeedSources, WaitsDot } from "./sources.tsx";
import { HideAct, MoveToast, undoLast } from "./PostActions.tsx";
import { usePendingHides } from "./feed-hides.ts";
import { hiddenPosts, useHeldMoves } from "./pending-moves.ts";
import { FeedCapabilitiesProvider, useFeedCapabilities, type FeedCapabilities } from "./feed-capabilities.tsx";
import { feedCommand } from "./post-actions.ts";
import { clock, G, Glyph, isNotModified, type Navigate } from "./post-parts.tsx";
import { FeedItem, type ItemHandle, type Register } from "./FeedItem.tsx";
import { dismissTarget, grow, type PostSize } from "./post-size.ts";

/* Work finishing is a fleet event; the live net catches pull requests merging on GitHub. */
/* A stream left open beside another app keeps taking new posts: it refreshes while visible, focused or not. */
const FEED_REFRESH_POLICY = { matches: matchesKinds(FLEET_EVENT_KINDS), fallbackPollMs: 30_000, livePollMs: 120_000, activeWhen: "visible" as const };

/** How many decisions show at full size before the rest fold. */
const WAITING_SHOWN = 3;

/** Sets a post's size; `from` is what was clicked, which stays where it is on screen. */
type SetSize = (id: string, size: PostSize, from?: Element | null) => void;
type StreamState = {
  navigate: Navigate;
  focusedId: string | null;
  /** The size a post was set to, else its place's size: M among the day's posts, S in a fold. */
  sizeOf: (id: string, base: PostSize) => PostSize;
  setSize: SetSize;
  register: Register;
  headOf: (id: string) => FeedPostHead | undefined;
};

function Item({ post, base, stream }: { post: FeedPostHead; base: PostSize; stream: StreamState }) {
  const joined = post.joined.map(stream.headOf).filter((p): p is FeedPostHead => Boolean(p));
  const onSize = useCallback((size: PostSize, from?: Element | null) => stream.setSize(post.id, size, from), [stream.setSize, post.id]);
  return (
    <FeedItem
      post={post}
      joined={joined}
      navigate={stream.navigate}
      size={stream.sizeOf(post.id, base)}
      onSize={onSize}
      focused={stream.focusedId === post.id}
      register={stream.register}
    />
  );
}

/** The rest of the day, folded to one quiet row; open, each post is a compact item. */
/** What a closed fold says about its posts: whose they were (one mark per harness) and where (the first threads). */
function foldSummary(posts: readonly FeedPostHead[]): { harnesses: string[]; threads: string[]; moreThreads: number } {
  const harnesses = [...new Set(posts.map((p) => p.agent.harness).filter((h): h is string => Boolean(h)))];
  const all = [...new Set(posts.map((p) => p.thread ?? p.agent.name).filter(Boolean))];
  const threads = all.slice(0, 3);
  return { harnesses, threads, moreThreads: all.length - threads.length };
}

function FoldSummary({ posts }: { posts: readonly FeedPostHead[] }) {
  const { harnesses, threads, moreThreads } = foldSummary(posts);
  return (
    <>
      {harnesses.length ? <span className="fd-foldMarks" aria-hidden>{harnesses.map((h) => <Mark key={h} harness={h} compact />)}</span> : null}
      {threads.length ? (
        <span className="fd-foldList">
          {threads.join(", ")}{moreThreads ? ` and ${moreThreads} more` : ""}
        </span>
      ) : null}
    </>
  );
}

function Folded({ posts, stream, label }: { posts: FeedPostHead[]; stream: StreamState; label?: string }) {
  const [unfolded, setUnfolded] = useState(false);
  // A fold opens when it holds a post someone grew (a link to one of its posts).
  const holds = posts.some((p) => stream.sizeOf(p.id, "s") !== "s");
  useEffect(() => { if (holds) setUnfolded(true); }, [holds]);
  if (!posts.length) return null;
  return (
    <div className="fd-folded">
      <button type="button" className="fd-fold" onClick={() => setUnfolded(!unfolded)} aria-expanded={unfolded}>
        <span className="fd-foldIcon" data-open={unfolded || undefined}><Glyph d={G.chevron} size={11} /></span>
        <span className="fd-foldCount s-ds-section-head">{label ?? foldInventoryLabel(posts)}</span>
        {unfolded ? null : <FoldSummary posts={posts} />}
      </button>
      {unfolded ? <div className="fd-foldItems">{posts.map((p) => <Item key={p.id} post={p} base="s" stream={stream} />)}</div> : null}
    </div>
  );
}

/** An outside thread or a quota warning, drawn among the day's posts. */
function SourcePostView({ post, now }: { post: SourcePost; now: number }) {
  const { readOnly } = useFeedCapabilities();
  return (
    <article className="fd-post fd-sourcePost" data-kind={post.kind}>
      <div className="fd-postBody">
        <PostHead
          kind={post.kind === "outside" ? "Slack thread" : "Quota warning"}
          signal={post.kind === "outside" && post.thread.waiting === "you" ? <WaitsDot label="Waiting on your reply" /> : null}
          at={clock(post.at)}
        />
        {post.kind === "outside" ? <OutsideThread thread={post.thread} nowMs={now} /> : <QuotaWarning event={post.event} nowMs={now} />}
        {readOnly ? null : <div className="pa-strip">
          <div className="pa-row">
            {post.kind === "outside"
              ? <HideAct id={post.thread.id} at={post.thread.at} title={post.thread.channel.title} />
              : <HideAct id={post.event.id} at={post.event.crossedAt} title="Quota warning" />}
          </div>
        </div>}
      </div>
    </article>
  );
}

/** The element that scrolls `el`: Home's page, the Feed row's stream, or the document. */
/**
 * A modal other than the stream's own lightbox: the key help, the command palette, another dialog. The lightbox is a
 * modal dialog too, but the stream's keys must reach it, or j, k and Escape would stop as soon as a post opens.
 */
function otherModalOpen(): boolean {
  if (!isModalShortcutContext()) return false;
  if (document.querySelector(".kb-help-backdrop, [data-command-palette-open='true']")) return true;
  return [...document.querySelectorAll("[role='dialog'][aria-modal='true']")].some((d) => !d.classList.contains("fd-lightboxPanel"));
}

/** Where the keys start when no post is picked: the first post still on screen, not the top of the list. */
function firstOnScreen(order: readonly string[], el: (id: string) => HTMLElement | null): number {
  const at = order.findIndex((id) => {
    const rect = el(id)?.getBoundingClientRect();
    return rect ? rect.bottom > 64 && rect.top < window.innerHeight : false;
  });
  return Math.max(0, at);
}

function scrollerOf(el: Element): Element {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/* ── the page ──────────────────────────────────────────────────────────── */

/** The stream alone, with its own sources read: the Mac app's Feed row. */
export function FeedContent({ capabilities, ...props }: {
  navigate: Navigate;
  expand?: string;
  capabilities?: Partial<FeedCapabilities>;
}) {
  return (
    <FeedCapabilitiesProvider capabilities={capabilities}>
      <FeedWithSources {...props} />
    </FeedCapabilitiesProvider>
  );
}

function FeedWithSources({ navigate, expand }: { navigate: Navigate; expand?: string }) {
  const sources = useFeedSources();
  return <FeedStreamView navigate={navigate} sources={sources} expand={expand} />;
}

/**
 * A fixed placement in the stream: something that is not a post (Home's canvas), drawn once after the `after`-th
 * post shown, counted across days. `closesFirstDay` draws it at the end of the first day instead (after its fold)
 * when that comes sooner. Slots never enter the engine's ranking, the j/k order or a post's actions; with fewer
 * posts than `after`, a slot follows the last one.
 */
export type FeedSlot = { key: string; after: number; closesFirstDay?: boolean; node: ReactNode };

type FeedStreamProps = {
  navigate: Navigate;
  sources: FeedSources | null;
  /** Omit posts or source rows the host shows elsewhere. */
  exclude?: ReadonlySet<string>;
  /** The host owns scrolling and the undo toast. */
  embedded?: boolean;
  /** Hosted streams fill a rail and let the host scroll. */
  layout?: "standalone" | "hosted";
  /** A post to open expanded once it loads: the post a link (/?post=<id>) names. */
  expand?: string;
  /** Receives each updated snapshot of the unfiltered stream. */
  onFeed?: (feed: FeedState) => void;
  /** Fixed placements in post order. */
  slots?: readonly FeedSlot[];
};

/** The Feed's days and source rows. Use when the host already reads the sources. */
export function FeedStream({ capabilities, ...props }: FeedStreamProps & { capabilities?: Partial<FeedCapabilities> }) {
  return (
    <FeedCapabilitiesProvider capabilities={capabilities}>
      <FeedStreamView {...props} />
    </FeedCapabilitiesProvider>
  );
}

function FeedStreamView({ navigate, sources, exclude, embedded = false, layout = "standalone", expand, onFeed, slots }: FeedStreamProps) {
  const { readOnly, handoff } = useFeedCapabilities();
  const [view, setView] = useState<Exclude<FeedViewId, "home" | "following">>("all");
  const [resultsOnly, setResultsOnly] = useState(false);
  const [feed, setFeed] = useState<FeedState>(() => emptyFeed("all"));
  const [failed, setFailed] = useState(false);
  const [paging, setPaging] = useState(false);
  const versionRef = useRef(-1);
  // Posts out of the list for a moment: a Done or Drop under undo, a hide the Feed's last read still had.
  const pendingHides = usePendingHides();
  const held = new Set([...hiddenPosts(useHeldMoves()), ...pendingHides]);
  const hidden = exclude?.size ? new Set([...held, ...exclude]) : held;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const handles = useRef(new Map<string, ItemHandle>());
  const register = useCallback<Register>((id, handle) => {
    if (handle) handles.current.set(id, handle);
    else handles.current.delete(id);
  }, []);

  // Each post's size, when it is not its place's size. Any number of posts
  // can be open at once; growing one takes the keys' focus.
  const [sizes, setSizes] = useState<ReadonlyMap<string, PostSize>>(() => new Map());
  const sizesNow = useRef(sizes);
  sizesNow.current = sizes;
  // The posts grown past their place's size, newest last: Escape puts the focused one back, else the newest.
  const opened = useRef<string[]>([]);
  const [reveal, setReveal] = useState<string | null>(null);
  // What was clicked, and where it sat: after the post grows or shrinks, it is put back there.
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  const hold = useCallback((id: string, from: Element | null | undefined, growing: boolean) => {
    const el = from ?? handles.current.get(id)?.el.querySelector(".fd-head, .fd-s") ?? null;
    const top = el?.getBoundingClientRect().top ?? null;
    // Something on screen stays put; a post shrunk from off screen (Escape, deep in its detail) comes back into view.
    if (el && top !== null && top >= 0 && top <= window.innerHeight) anchor.current = { el, top };
    else if (!growing) setReveal(id);
  }, []);
  const setSize = useCallback<SetSize>((id, size, from) => {
    const was = handles.current.get(id)?.size ?? sizesNow.current.get(id);
    if (was === size) return;
    const growing = was == null || size === grow(was) || size === "l";
    if (growing) setFocusedId(id);
    opened.current = opened.current.filter((o) => o !== id);
    if (growing) opened.current.push(id);
    hold(id, from, growing);
    setSizes((m) => new Map(m).set(id, size));
  }, [hold]);
  // Escape: the post goes back to its place's size in one press (M among the day's posts, S in a fold), never smaller.
  const dismiss = useCallback((id: string) => {
    opened.current = opened.current.filter((o) => o !== id);
    hold(id, null, false);
    setSizes((m) => { const next = new Map(m); next.delete(id); return next; });
  }, [hold]);
  useLayoutEffect(() => {
    const held = anchor.current;
    anchor.current = null;
    if (!held || !held.el.isConnected) return;
    const delta = held.el.getBoundingClientRect().top - held.top;
    if (delta) scrollerOf(held.el).scrollBy(0, delta);
  }, [sizes]);
  useEffect(() => {
    if (!reveal) return;
    handles.current.get(reveal)?.el.scrollIntoView({ block: "nearest" });
    setReveal(null);
  }, [reveal]);

  // j and k (or the arrows) move between posts in the order they show, from the first on screen; with a post open,
  // they open the next one in its place. Enter grows one a size; Escape dismisses what is open; a letter runs its action.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || otherModalOpen()) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        // Nothing open: the key is left alone, so the Mac app's Escape still goes back (glass-keys.ts).
        const id = dismissTarget(focusedId, opened.current, (o) => handles.current.has(o));
        if (!id) return;
        dismiss(id);
        event.preventDefault();
        return;
      }
      const command = feedCommand(event);
      if (!command) return;
      if (command === "undo") { if (readOnly) return; undoLast(); event.preventDefault(); return; }
      const order = [...document.querySelectorAll<HTMLElement>(".s-feed .fd-post[data-post-id]")].map((n) => n.dataset.postId!).filter((id) => handles.current.has(id));
      if (!order.length) return;
      const at = focusedId ? order.indexOf(focusedId) : -1;
      if (command === "next" || command === "prev") {
        const step = command === "next" ? 1 : -1;
        const target = at < 0 ? firstOnScreen(order, (id) => handles.current.get(id)?.el ?? null) : Math.max(0, Math.min(order.length - 1, at + step));
        const next = order[target]!;
        const current = at >= 0 ? order[at]! : null;
        // A post open in the lightbox hands over to the next one, open too: read on without closing and reopening.
        if (current && next !== current && handles.current.get(current)?.size === "l") {
          dismiss(current);
          setSize(next, "l");
          event.preventDefault();
          return;
        }
        setFocusedId(next);
        const el = handles.current.get(next)!.el;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
        event.preventDefault();
        return;
      }
      const handle = at >= 0 ? handles.current.get(order[at]!) : null;
      if (!handle) return;
      if (command === "open") {
        if (handle.size !== "l") setSize(order[at]!, grow(handle.size));
        event.preventDefault();
        return;
      }
      if (handle.actions?.run(command)) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusedId, setSize, dismiss, readOnly]);

  const load = useCallback(async () => {
    try {
      const res = await api<FeedResponse>(feedPath(view, { since: versionRef.current }));
      versionRef.current = res.version;
      setFeed((state) => (state.view === res.view ? mergeFeed(state, res) : mergeFeed(emptyFeed(res.view), res)));
      setFailed(false);
    } catch (error) {
      // 304: nothing moved. A failed refresh keeps what is shown; only a first load that fails says so.
      if (!isNotModified(error)) setFailed(true);
    }
  }, [view]);

  useEffect(() => {
    versionRef.current = -1;
    setFeed(emptyFeed(view));
    void load();
  }, [view, load]);
  useBrokerRefresh(() => void load(), FEED_REFRESH_POLICY, !readOnly);
  usePageRefresh(load);
  useEffect(() => {
    if (feed.view === "all" && feed.version >= 0) onFeed?.(feed);
  }, [feed, onFeed]);

  const older = async () => {
    if (!feed.cursor || paging) return;
    setPaging(true);
    try {
      const res = await api<FeedResponse>(feedPath(view, { cursor: feed.cursor }));
      setFeed((state) => appendPage(state, res));
    } catch { /* the button stays */ }
    setPaging(false);
  };

  const loaded = feed.version >= 0;
  const now = Date.now();
  const waiting = loaded ? collectWaitingPosts(feed, hidden) : [];
  const waitingIds = new Set(waiting.map((p) => p.id));
  const dayHidden = waitingIds.size ? new Set([...hidden, ...waitingIds]) : hidden;
  const loadedDays = feed.days.map((d) => d.day);
  const bySourceDay = sourcePostsByDay(view === "all" && !resultsOnly ? sources : null, loadedDays, Boolean(feed.cursor));
  const days = loaded ? mergedDays(loadedDays, bySourceDay.keys()) : [];
  const feedDay = new Map(feed.days.map((d) => [d.day, d]));
  const resultCount = loaded ? [...feed.posts.values()].filter((p) => !dayHidden.has(p.id) && isVisualOrShippedResult(p)).length : 0;
  const showReviewed = feed.size.reviewed > 0 || view === "reviewed";
  const showFilters = loaded && (days.length > 0 || waiting.length > 0 || showReviewed);
  // fixed placements: each drawn once, after the post it names (or after the last)
  let counted = 0;
  const placed = new Set<string>();
  const slotsAfter = (n: number, firstDayEnd = false): ReactNode => {
    const due = (slots ?? []).filter((slot) => !placed.has(slot.key) && (slot.after <= n || (firstDayEnd && slot.closesFirstDay)));
    for (const slot of due) placed.add(slot.key);
    return due.length ? due.map((slot) => <Fragment key={`slot:${slot.key}`}>{slot.node}</Fragment>) : null;
  };

  // A link names a post: open it once it is in the list, and bring it into view.
  const expandedFromLink = useRef<string | null>(null);
  useEffect(() => {
    if (!expand || expandedFromLink.current === expand || !feed.posts.has(expand)) return;
    expandedFromLink.current = expand;
    // A code-only post joined under another opens with the post it sits under.
    const host = [...feed.posts.values()].find((p) => p.joined.includes(expand))?.id ?? expand;
    setSizes((was) => new Map(was).set(host, "l"));
    opened.current = [...opened.current.filter((o) => o !== host), host];
    setFocusedId(host);
    // A folded post renders a frame or two later, once its fold opens.
    let tries = 10;
    const bring = () => {
      const el = handles.current.get(host)?.el;
      if (el) el.scrollIntoView({ block: "start" });
      else if (--tries > 0) window.requestAnimationFrame(bring);
    };
    window.requestAnimationFrame(bring);
  }, [expand, feed]);
  const stream: StreamState = { navigate, focusedId, sizeOf: (id, base) => sizes.get(id) ?? base, setSize, register, headOf: (id) => feed.posts.get(id) };

  const visibleDays = days.map((key) => {
    const day = feedDay.get(key) ?? { day: key, ids: [], folded: [] };
    const extra = (bySourceDay.get(key) ?? []).filter((p) => !dayHidden.has(p.kind === "outside" ? p.thread.id : p.event.id));
    const { shown, folded } = refillDay(day.ids, day.folded, dayHidden, (id) => feed.posts.get(id));
    const partitioned = partitionDayPosts(shown, folded);
    if (!resultsOnly) return { day, extra, ...partitioned };
    return {
      day,
      extra: [] as SourcePost[],
      github: partitioned.github,
      featured: partitioned.featured.filter(isVisualOrShippedResult),
      folded: partitioned.folded.filter(isVisualOrShippedResult),
    };
  }).filter(({ extra, github, featured, folded }) => extra.length > 0 || github.rows.length > 0 || featured.length > 0 || folded.length > 0);

  return (
    <div className="s-feed" data-embedded={embedded || undefined} data-layout={layout} data-lens={resultsOnly ? "results" : view}>
      <div className="fd-column">
        {showFilters ? (
          <div className="fd-bar">
            <div className="fd-filters" role="group" aria-label="View">
              <button
                type="button"
                className="fd-filter"
                data-on={(view === "all" && !resultsOnly) || undefined}
                onClick={() => { setView("all"); setResultsOnly(false); }}
              >
                All
              </button>
              <button
                type="button"
                className="fd-filter"
                data-on={(view === "all" && resultsOnly) || undefined}
                onClick={() => { setView("all"); setResultsOnly(true); }}
              >
                Results{resultCount > 0 ? <span className="fd-filterCount">{resultCount}</span> : null}
              </button>
              {showReviewed ? (
                <button
                  type="button"
                  className="fd-filter"
                  data-on={view === "reviewed" || undefined}
                  onClick={() => { setView("reviewed"); setResultsOnly(false); }}
                >
                  My activity
                </button>
              ) : null}
            </div>
            {loaded && failed ? (
              <span className="fd-stale" role="status">Couldn&apos;t refresh — showing last loaded feed</span>
            ) : null}
          </div>
        ) : loaded && failed ? (
          <div className="fd-bar">
            <span className="fd-stale" role="status">Couldn&apos;t refresh — showing last loaded feed</span>
          </div>
        ) : null}

        {!loaded && failed ? <p className="fd-empty">Couldn&apos;t load the feed. Retrying.</p> : null}
        {!loaded && !failed ? <ScoutPageSkeleton variant="feed" inline label="Loading Feed" /> : null}

        {loaded && waiting.length > 0 ? (
          <section className="fd-attention" aria-label="Waiting on you">
            <header className="fd-attentionHead">
              <h2 className="s-ds-section-head">Waiting on you</h2>
              <span className="fd-attentionCount">{waiting.length}</span>
            </header>
            {/* The first few decisions at full size; the rest one quiet row away, so the day still shows below. */}
            <div className="fd-attentionList">
              {waiting.slice(0, WAITING_SHOWN).map((post) => <Item key={post.id} post={post} base="m" stream={stream} />)}
            </div>
            <Folded posts={waiting.slice(WAITING_SHOWN)} stream={stream} label={`${waiting.length - WAITING_SHOWN} more waiting`} />
          </section>
        ) : null}

        {loaded && visibleDays.length === 0 && waiting.length === 0 ? (
          <p className="fd-empty">
            {resultsOnly ? "No visual or code results in this range yet." : view === "reviewed" ? "No activity from you in this range yet." : "Nothing finished yet."}
          </p>
        ) : null}

        {visibleDays.map(({ day, extra, github, featured, folded }, dayIndex) => {
          const label = dayLabel(day.day, now);
          const openGithubPosts = new Map(github.rows
            .filter(({ post }) => stream.sizeOf(post.id, "s") === "l")
            .map(({ post }) => [post.id, post]));
          return (
            <section key={day.day} className="fd-day" aria-label={label || dayDate(day.day)}>
              <h2 className="fd-dayHead s-ds-section-head">
                {label ? <span>{label}</span> : null}
                <span className={label ? "fd-faint" : undefined}>{dayDate(day.day)}</span>
              </h2>
              {extra.map((p) => <SourcePostView key={p.kind === "outside" ? p.thread.id : p.event.id} post={p} now={now} />)}
              <GitHubCatchUp summary={github} onOpenPost={(id, from) => stream.setSize(id, "l", from)} />
              {[...openGithubPosts.values()].map((post) => (
                <div key={`gh-open:${post.id}`} className="fd-ghOpenHost">
                  <Item post={post} base="s" stream={stream} />
                </div>
              ))}
              <div className={resultsOnly && featured.length > 1 ? "fd-showcaseGrid" : undefined}>
                {featured.map((post) => {
                  counted += 1;
                  const here = slotsAfter(counted);
                  return (
                    <Fragment key={post.id}>
                      <Item post={post} base="m" stream={stream} />
                      {here}
                    </Fragment>
                  );
                })}
              </div>
              <Folded posts={folded} stream={stream} />
              {dayIndex === visibleDays.length - 1 ? slotsAfter(Infinity) : dayIndex === 0 ? slotsAfter(counted, true) : null}
            </section>
          );
        })}

        {loaded && feed.cursor ? (
          <button type="button" className="fd-older" onClick={() => void older()} disabled={paging}>{paging ? "Loading" : "Older"}</button>
        ) : null}

        {loaded && readOnly && !embedded && handoff ? (
          <footer className="fd-handoff">
            {handoff.detail ? <span>{handoff.detail}</span> : null}
            <a className="fd-handoffLink" href={handoff.href} target="_blank" rel="noreferrer">{handoff.label}</a>
          </footer>
        ) : null}
      </div>
      {embedded || readOnly ? null : <MoveToast />}
    </div>
  );
}
