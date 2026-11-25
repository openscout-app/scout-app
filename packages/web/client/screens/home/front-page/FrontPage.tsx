/**
 * Home is the Feed, in three panes. Left: Search and the places, fixed.
 * Centre: the feed's stream, every post kind in its own presentation and
 * opening in place, under one placement chosen by rule (home-stream.ts):
 * Back to you (asks and questions, people waiting on your reply, then the
 * sessions whose turn ended, led by what they produced). The page's own
 * Refresh sits in its header row and reads the feed, the placement and the
 * right pane again together (lib/page-refresh.ts).
 * Right: what changes with the moment: providers and quota, a fresh quota
 * warning, the week by project, what finished today with a result (from the
 * Feed's own posts), what is running, and threads waiting on the other side.
 *
 * From a half-screen window on a large display (home-wide.ts) Running gets
 * a column of its own on the left; the right pane keeps the rest.
 *
 * The canvas has a slot in the stream, always sixth, after five posts (FeedStream's
 * `slots`, a fixed placement the ranking never sees): the agents at work as a
 * minimap, their cursors moving over the files they touch, a ring where
 * something ships (CanvasSlot, use-canvas-glance.ts).
 *
 * Everything shown has a source: the feed engine, the runtime's request
 * queue, the tail, the service budgets and GET /api/feed/sources. A section
 * without one is left out, never drawn as a stand-in.
 */
import { DiffStat } from "../../../components/DiffStat.tsx";
import "./front-page.css";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionState } from "../../../components/ConnectionState.tsx";
import { Glyph, type GlyphName } from "../../../components/ScoutGlyph.tsx";
import { api } from "../../../lib/api.ts";
import { useBrokerRefresh } from "../../../lib/broker-refresh.ts";
import { refreshRequests } from "../../../lib/operator-requests-store.ts";
import { freshnessLabel, notePageRead, refreshPage, usePageFreshness, usePageRefresh } from "../../../lib/page-refresh.ts";
import { FLEET_EVENT_KINDS, matchesKinds } from "../../../lib/broker-event-kinds.ts";
import type { Route, WorkItem } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import type { FeedResponse } from "../../../../shared/api/feed.ts";
import { emptyFeed, feedPath, mergeFeed, type FeedState } from "../../feed/feed-store.ts";
import { hiddenPosts, useHeldMoves } from "../../feed/pending-moves.ts";
import { primaryAction } from "../../feed/post-actions.ts";
import { HideAct, MoveToast, PostActions } from "../../feed/PostActions.tsx";
import { usePendingHides } from "../../feed/feed-hides.ts";
import { isReadyRequest, isRequestDismissal, requestActions } from "../../requests/requests-model.ts";
import { useRequestActions } from "../../requests/use-request-actions.ts";
import { RequestProgress } from "../../requests/RequestProgress.tsx";
import { useRequestRows } from "../../requests/use-request-rows.ts";
import { AskReply, AskWords } from "../../requests/AskParts.tsx";
import { askText, type AskText } from "../../requests/ask-text.ts";
import { Mark as TintedMark, OutsideThread, PostHead, useFeedSources } from "../../feed/sources.tsx";
import { FeedStream } from "../../feed/FeedContent.tsx";
import { homeContext, homeWaiting, placedIds, type HomeStreamItem } from "./home-stream.ts";
import { requestsRoute } from "../../views/modules/requests-view-model.ts";
import { homeLoadNotice } from "../home-loading.ts";
import { useHomeFeed } from "../use-home-feed.ts";
import {
  homeView,
  permissionWhere,
  readableTitle,
  type HomeAgent,
  type HomeForYou,
  type HomeLead,
  type HomePost,
  type HomeRef,
  type HomeSize,
  type HomeTurn,
  readableLine,
} from "./front-page-model.ts";
import { HOME_RECENT_LABEL, homeRecent, homeRunning, type HomeRunning, type HomeRunningWork } from "./front-page-running.ts";
import { RouteLink, type Navigate } from "./route-link.tsx";
import { RunningList } from "./RunningList.tsx";
import { reloadWorkList, useWorkList } from "../../work/use-work-detail.ts";
import { BackToYouRow, ShippedRow } from "./BackToYou.tsx";
import { usualProject } from "./back-to-you-meta.ts";
import { sessionTitle } from "../../../lib/harness-session-title.ts";
import { useSeenTurns } from "./back-to-you-seen.ts";
import type { FleetActivity, TailEvent } from "../../../lib/types.ts";
import { timeAgoPast } from "../../../lib/time.ts";
import { activityLine, fleetActivityRoute, liveActivityFrom } from "../home-derive.ts";
import { useHomeWide, useWidth } from "./home-wide.ts";
import { landedToday, type HomeLanded } from "./front-page-landed.ts";
import { cardView } from "./for-you-card-model.ts";
import { ForYouCardView } from "./ForYouCard.tsx";
import { useForYouCards } from "./use-for-you-cards.ts";
import { useReserved } from "./use-reserved.ts";
import type { ForYouCard } from "../../../../shared/api/for-you.ts";
import { permissionAsk } from "../../../lib/permission-presentation.ts";

/*
 * Work finishing is a fleet event, as on the Feed. Home is a watch surface, like its fleet panels: left open
 * beside another app it keeps taking new posts, so it refreshes while visible, focused or not.
 */
const FEED_REFRESH_POLICY = { matches: matchesKinds(FLEET_EVENT_KINDS), fallbackPollMs: 30_000, livePollMs: 120_000, activeWhen: "visible" as const };

const CONTROL: Route = { view: "ops", mode: "mission" };
const WORK_LIST = "/api/work?limit=40";
/** Finished turns shown before "Show all". */
export const HOME_TURNS_SHOWN = 6;

function isNotModified(error: unknown): boolean {
  return (error as { status?: number })?.status === 304;
}

function why(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * The engine's Home view, patched in place by version as the Feed page does.
 * `error` is set only while nothing has loaded: a failed refresh keeps what
 * is shown.
 */
function useHomeView(): { feed: FeedState | null; error: string | null; reload: () => void } {
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(-1);
  const load = useCallback(async () => {
    try {
      const res = await api<FeedResponse>(feedPath("home", { since: version.current }));
      version.current = res.version;
      setFeed((state) => mergeFeed(state ?? emptyFeed("home"), res));
      setError(null);
      notePageRead();
    } catch (e) {
      if (isNotModified(e)) notePageRead();
      else if (version.current < 0) setError(why(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useBrokerRefresh(() => void load(), FEED_REFRESH_POLICY);
  usePageRefresh(load);
  return { feed, error, reload: () => void load() };
}

/* ── time ──────────────────────────────────────────────────────────────── */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "14:07" today, "Sun 21:32" before. */
export function when(ms: number, nowMs: number): string {
  const d = new Date(ms);
  return d.toDateString() === new Date(nowMs).toDateString() ? clock(ms) : `${WEEKDAY[d.getDay()]} ${clock(ms)}`;
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function Mark({ harness }: { harness: string | null | undefined }) {
  return <TintedMark harness={harness} size={12} />;
}

function Refs({ refs }: { refs: HomeRef[] }) {
  if (!refs.length) return null;
  return (
    <span className="fp-refs">
      {refs.map((r) => (
        <a key={r.label} className="fp-ref" href={r.url} target="_blank" rel="noreferrer">
          <span className="fp-mono">{r.label}</span>
        </a>
      ))}
    </span>
  );
}

/**
 * Who did the work, as a column: the harness mark, the agent and the time on
 * one line, the pull requests under it. One fixed width wherever it sits, so
 * it aligns from row to row and section to section.
 */
function AgentCell({ agent, at, refs, size, fallback }: { agent: HomeAgent | null; at: string; refs?: HomeRef[]; size?: HomeSize | null; fallback?: string | null }) {
  return (
    <div className="fp-agent">
      <span className="fp-agentLine">
        <Mark harness={agent?.harness} />
        <span className="fp-agentName">{agent?.name ?? ""}</span>
        <span className="fp-agentAt">{at}</span>
      </span>
      {refs?.length ? (
        <span className="fp-refLine">
          <Refs refs={refs} />
          {size ? <DiffStat className="fp-size" additions={size.additions} deletions={size.deletions} /> : null}
        </span>
      ) : fallback ? <span className="fp-agentWhere">{fallback}</span> : null}
    </div>
  );
}

function LeadView({ lead, shape }: { lead: HomeLead; shape: "wide" | "thumb" }) {
  if (lead.kind === "visual") {
    return (
      <figure className="fp-shot" data-shape={shape}>
        <img src={lead.src} alt={lead.caption ?? ""} loading="lazy" />
      </figure>
    );
  }
  if (lead.kind === "video") {
    return (
      <figure className="fp-shot" data-shape={shape}>
        <video src={lead.src} muted playsInline loop preload="metadata" aria-label={lead.caption ?? undefined}
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()} />
      </figure>
    );
  }
  return null;
}

function SectionHead({ children, count, link, navigate, strong, icon }: {
  children: ReactNode;
  /** A glyph before the name, for a slot that is a place in the app (the Canvas) rather than a list. */
  icon?: GlyphName;
  count?: number;
  link: { label: string; route: Route } | null;
  navigate: Navigate;
  strong?: boolean;
}) {
  return (
    <div className="fp-label">
      {icon ? <span className="fp-labelIcon" aria-hidden><Glyph name={icon} size={14} /></span> : null}
      {link ? <RouteLink route={link.route} navigate={navigate} className="fp-headLink">{children}</RouteLink> : <span>{children}</span>}
      {count ? <span className="fp-quiet">{count}</span> : null}
      {link ? (
        <RouteLink route={link.route} navigate={navigate} className="fp-allLink" data={{ "data-strong": strong ? "" : undefined }}>
          {strong ? <Glyph name="feed" size={13} /> : null}
          {link.label}
          <Glyph name="chevronRight" size={11} />
        </RouteLink>
      ) : null}
    </div>
  );
}

/* ── For you ───────────────────────────────────────────────────────────── */

/**
 * The row's next move, in the right column. A request is answered on the
 * Requests page. A handed-back post uses the Feed's own actions: its primary
 * move there, the rest on hover or focus under the row. A post with no
 * primary move (a question on its thread, or work in review with no pull
 * request) opens where it waits.
 */
function NextMove({ row, navigate }: { row: HomeForYou; navigate: Navigate }) {
  if (row.source === "request") return <RouteLink route={row.ask.route} navigate={navigate} className="fp-ask">{row.ask.label}</RouteLink>;
  const fallback = primaryAction(row.post)
    ? null
    : row.reason.reason === "attention"
      ? <RouteLink route={requestsRoute()} navigate={navigate} className="fp-ask">Answer</RouteLink>
      : row.open ? <RouteLink route={row.open} navigate={navigate} className="fp-ask">Review the work</RouteLink> : null;
  return (
    <>
      <PostActions post={row.post} navigate={navigate} />
      {fallback}
    </>
  );
}

/** Who and when, on one line, as every row on Home and in the Feed opens: mark, name, project, time. */
function Byline({ row, nowMs }: { row: HomeForYou; nowMs: number }) {
  return (
    <div className="fp-turnBy">
      <Mark harness={row.agent?.harness} />
      <span className="fp-turnName">{row.agent?.name ?? "Session"}</span>
      {row.project ? <span className="fp-turnWhere">{row.project}</span> : null}
      <span className="fp-turnAt">{when(row.at, nowMs)}</span>
    </div>
  );
}

function ForYouRow({ row, thumbs, nowMs, navigate }: { row: HomeForYou; thumbs: boolean; nowMs: number; navigate: Navigate }) {
  const title = (
    <>
      <span className="fp-forTitleText">{row.title}</span>
      {row.project ? <span className="fp-forProject">{row.project}</span> : null}
    </>
  );
  // a question on the thread is why it is here, so its words lead; otherwise
  // the post's own caption, else the engine's reason ("Left on home/x, no pull request")
  // A line that only names a session by its id ("Session Mwscugkg Ucsr9y is ready") says nothing the byline does not.
  const caption = readableTitle(row.source === "post" && (row.reason.reason === "attention" || !row.caption) ? row.reason.label : row.caption);
  return (
    <div className="fp-forRow" data-source={row.source}>
      {!thumbs ? null : hasVisual(row) ? <LeadView lead={row.lead} shape="thumb" /> : <span className="fp-forThumb" aria-hidden />}
      <div className="fp-forMain">
        {row.open ? <RouteLink route={row.open} navigate={navigate} className="fp-forTitle">{title}</RouteLink> : <div className="fp-forTitle">{title}</div>}
        {caption ? <div className="fp-forCaption">{caption}</div> : null}
      </div>
      <AgentCell agent={row.agent} at={when(row.at, nowMs)} refs={row.refs} size={row.size} />
      <NextMove row={row} navigate={navigate} />
    </div>
  );
}

type AskRowData = Extract<HomeForYou, { source: "request" }>;

/**
 * An ask's body under its title: three lines at most, with More in place to
 * read the rest. More shows only when the text runs past the clamp.
 */
function AskBody({ parts }: { parts: AskText["body"] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [parts, open]);
  return (
    <div className="fp-askBody">
      <p ref={ref} className="fp-askText" data-open={open || undefined}><AskWords parts={parts} /></p>
      {clamped || open ? (
        <button type="button" className="fp-textLink fp-askMore" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Less" : "More"}</button>
      ) : null}
    </div>
  );
}

/**
 * An ask from the runtime's queue, set as a notification row: a short title
 * (its first sentence), at most three lines of the rest, its links as short
 * chips, and the answers it declared as buttons that reply from here (what
 * each means, when the ask says, on the button). A reply in your own words,
 * typed or spoken, goes the same way. A permission leads with what it asks
 * to run. Open takes it to the Inbox.
 */
function AskRow({ row, nowMs, navigate }: { row: AskRowData; nowMs: number; navigate: Navigate }) {
  const item = row.item;
  const reply = useRequestActions(item, (action) => { if (action.route) navigate(action.route); });
  const options = item.answer?.options ?? [];
  // Answers sit with the options; Dismiss ends the ask without answering it, so it sits with Open.
  const moves = requestActions(item).filter((a) => a.kind !== "open");
  const decisions = moves.filter((a) => !isRequestDismissal(item, a));
  const dismiss = moves.find((a) => isRequestDismissal(item, a)) ?? null;
  const { agents } = useScout();
  const permission = Boolean(item.permission || item.approval || item.pane?.prompt?.kind === "permission");
  // What it asks to do, read as the companion reads it (lib/permission-presentation.ts).
  const ask = permission ? permissionAsk(item) : null;
  const agent = item.agentId ? agents.find((a) => a.id === item.agentId || a.id === item.agentId!.split(".")[0]) ?? null : null;
  const where = ask ? permissionWhere(item, agent, ask.cwd) : null;
  // The ask's own words, whole, links intact; the row's cleaned one-line title when they do not read.
  const words = useMemo(() => askText(readableTitle(item.title) ?? row.title, options), [item.title, row.title, item.answer]);
  const body = words.body.length ? words.body : row.caption ? [{ text: row.caption }] : [];
  const done = Boolean(reply.sent);
  return (
    <article className="fp-askPost">
      <PostHead
        kind={<span className="fp-why" data-kind={row.why.kind} title={row.why.then}>{row.why.label}</span>}
        context={[ask?.tool]}
        who={{ harness: item.permission?.native?.harness ?? row.agent?.harness, name: (ask ? where : row.agent?.name) ?? "" }}
        at={when(row.at, nowMs)}
      />
      {ask ? (
        <>
          <pre className="fp-askAction" tabIndex={0} aria-label={ask.tool ? `${ask.tool} to allow` : "Command to allow"}><code>{ask.action}</code></pre>
          {ask.reason ? <p className="fp-askContext">{ask.reason}</p> : null}
        </>
      ) : (
        <>
          <h3 className="fp-askQ"><AskWords parts={words.title} /></h3>
          {body.length ? <AskBody parts={body} /> : null}
        </>
      )}
      <div className="fp-askMoves">
        <div className="fp-askChoices" role="group" aria-label="Answer">
          {options.map((option) => (
            <button key={option} type="button" className="fp-askChoice" aria-pressed={reply.sent === option} title={words.meanings[option]}
              disabled={reply.busy || (done && reply.sent !== option)} onClick={() => void reply.answer(option)}>
              {option}
            </button>
          ))}
          {decisions.map((action) => (
            <button key={`${action.kind}:${action.label}`} type="button" className="fp-askChoice" disabled={reply.busy || done}
              onClick={() => void reply.act(action)}>
              {action.label}
            </button>
          ))}
          {item.answer && !done ? (
            <AskReply label={`Reply to ${row.agent?.name ?? "the agent"}`} disabled={reply.busy} onSend={(text) => reply.answer(text)} />
          ) : null}
          <span className="fp-askAside">
            {dismiss && !done ? (
              <button type="button" className="fp-textLink fp-askDismiss" disabled={reply.busy} onClick={() => void reply.act(dismiss)}>{dismiss.label}</button>
            ) : null}
            <RouteLink route={row.ask.route} navigate={navigate} className="fp-textLink">Open</RouteLink>
          </span>
        </div>
      </div>
      {reply.sent && options.includes(reply.sent) ? <p className="fp-sent" role="status">Sent “{reply.sent}” as your reply.</p>
        : <RequestProgress delivery={reply.delivery} busy={reply.busy} stalled={reply.stalled} onRetry={() => void reply.retry()} />}
      {reply.error && reply.delivery?.state !== "unconfirmed" ? <p className="fp-failed" role="alert">{reply.error}</p> : null}
    </article>
  );
}

/**
 * A Ready task: one you asked to hear about is done, and the next move is yours. "<agent> is ready", the line
 * it said it did, and Continue or Hold. Never drawn as a question: nothing is being asked.
 */
function ReadyRow({ row, nowMs, navigate }: { row: AskRowData; nowMs: number; navigate: Navigate }) {
  const item = row.item;
  const reply = useRequestActions(item, (action) => { if (action.route) navigate(action.route); });
  const moves = requestActions(item).filter((a) => a.kind === "continue" || a.kind === "hold");
  const task = readableLine(item.detail);
  return (
    <article className="fp-askPost fp-readyPost">
      <PostHead
        kind={<span className="fp-why" data-kind={row.why.kind} title={row.why.then}>{row.why.label}</span>}
        who={{ harness: row.agent?.harness, name: row.agent?.name ?? "" }}
        at={when(row.at, nowMs)}
      />
      <h3 className="fp-askQ">{row.title}</h3>
      {row.caption ? <p className="fp-askContext">{row.caption}</p> : null}
      {task && task !== row.caption ? <p className="fp-readyTask" title={task}>Asked: {task}</p> : null}
      <div className="fp-choices" role="group" aria-label="Your move">
        {moves.map((action) => (
          <button key={action.kind} type="button" className={`fp-choice${action.kind === "continue" ? " is-ready" : ""}`} disabled={reply.busy || Boolean(reply.sent)}
            title={action.kind === "continue" ? "The agent picks it up again in the same session." : "Off your list; it stays Ready until the work changes."}
            onClick={() => void reply.act(action)}>
            {action.label}
          </button>
        ))}
        <RouteLink route={row.open ?? row.ask.route} navigate={navigate} className="fp-textLink">
          {row.item.conversationId ? "Open conversation" : "Open"}
        </RouteLink>
      </div>
      {reply.sent ? <p className="fp-sent" role="status">{reply.sent}.</p> : null}
      {reply.error ? <p className="fp-failed" role="alert">{reply.error}</p> : null}
    </article>
  );
}

/** Working items by the agent that owns them, newest first; keyed by the full id and the id up to its first ".". */
function workByAgent(items: readonly WorkItem[] | null): Map<string, HomeRunningWork> {
  const map = new Map<string, HomeRunningWork>();
  const working = (items ?? []).filter((w) => w.state === "working" && w.ownerId).sort((a, b) => a.updatedAt - b.updatedAt);
  for (const w of working) {
    const work = { title: w.title, progress: w.lastMeaningfulSummary, startedAt: w.createdAt };
    map.set(w.ownerId!, work);
    map.set(w.ownerId!.split(".")[0]!, work);
  }
  return map;
}

/* ── Landed ────────────────────────────────────────────────────────────── */

/**
 * Today's results, one line each: the harness mark, what the turn did, when.
 * The outcome, the session and what it made are the title's tooltip; the
 * post in the Feed has them in full.
 * Shipped turns (back to you until their pull requests merged) lead, with
 * their picture and any question left over (ShippedRow).
 */
function LandedList({ landed, shipped, meta, nowMs, navigate }: { landed: HomeLanded; shipped: readonly HomeTurn[]; meta: TurnMeta; nowMs: number; navigate: Navigate }) {
  if (!landed.rows.length && !shipped.length) return <div className="fp-nothing">Nothing finished yet today</div>;
  return (
    <div className="fp-landed">
      {shipped.map((turn) => (
        <ShippedRow key={turn.id} turn={turn} at={when(turn.at, nowMs)} navigate={navigate}
          sessionName={turn.sessionId ? meta.sessionNames.get(turn.sessionId) ?? null : null} />
      ))}
      {landed.rows.map((row) => {
        const who = [row.agent?.name, row.artifact ? `${row.artifact.kind} ${row.artifact.name}` : null].filter(Boolean).join(" · ");
        const tip = [row.outcome, who].filter(Boolean).join("\n") || undefined;
        return (
          <div key={row.id} className="fp-landedRow" title={tip}>
            <span className="fp-landedMark">{row.agent ? <TintedMark harness={row.agent.harness} size={12} title={row.agent.name} /> : null}</span>
            {row.open
              ? <RouteLink route={row.open} navigate={navigate} className="fp-landedTitle">{row.title}</RouteLink>
              : <span className="fp-landedTitle">{row.title}</span>}
            <span className="fp-landedAt">{when(row.at, nowMs)}</span>
            <span className="fp-landedHide"><HideAct id={row.id} at={row.at} title={row.title} /></span>
          </div>
        );
      })}
      {landed.more ? <div className="fp-landedMore">{landed.more} more in the Feed</div> : null}
    </div>
  );
}

function hasVisual(post: HomePost): boolean {
  return post.lead.kind === "visual" || post.lead.kind === "video";
}

/* ── the centre: one stream ────────────────────────────────────────────── */

/** What a Back to you row reads about sessions beyond its own turn. */
type TurnMeta = { sessionNames: ReadonlyMap<string, string>; usualProject: string | null };

function StreamItem({ item, cards, nowMs, navigate, meta }: { item: HomeStreamItem; cards: ReadonlyMap<string, ForYouCard>; nowMs: number; navigate: Navigate; meta: TurnMeta }) {
  // Ready before any card: a card would read it as a question.
  if (item.kind === "ask" && isReadyRequest(item.row.item)) return <ReadyRow row={item.row} nowMs={nowMs} navigate={navigate} />;
  // An ask or handed-back post drawn for its kind when the server classified it (/api/feed/for-you);
  // the presentation below stands in until it does, or when the card has nothing to lead with.
  // Keep native question tool grants on the shared runtime action path.
  // An ask that takes a reply (its declared answers, or your own words) is always the ask row, so every one reads
  // and answers the same way.
  if (item.kind === "ask" && (item.row.item.permission?.native?.display?.questions?.length || item.row.item.answer)) {
    return <AskRow row={item.row} nowMs={nowMs} navigate={navigate} />;
  }
  // A finished turn leads with what it produced, never a card's pull request.
  const card = item.kind === "ask" || item.kind === "question" ? cards.get(item.id) : undefined;
  if (card && (item.kind === "ask" || item.kind === "question") && cardView(card)) {
    const row = item.row;
    // Who and when lead the card, on one line; its pull request trails it.
    const byline = <Byline row={row} nowMs={nowMs} />;
    const trail = row.refs?.length ? (
      <div className="fp-agent">
        <span className="fp-refLine">
          <Refs refs={row.refs} />
          {row.size ? <DiffStat className="fp-size" additions={row.size.additions} deletions={row.size.deletions} /> : null}
        </span>
      </div>
    ) : null;
    return <ForYouCardView card={card} row={row} navigate={navigate} byline={byline} agentCell={trail} />;
  }
  switch (item.kind) {
    case "ask": return <AskRow row={item.row} nowMs={nowMs} navigate={navigate} />;
    case "outside": return (
      <article className="fp-streamPost">
        <PostHead kind={<span className="fp-why" data-kind={item.why.kind} title={item.why.then}>{item.why.label}</span>} context={["Slack"]} />
        <OutsideThread thread={item.thread} nowMs={nowMs} />
        <div className="pa-strip"><div className="pa-row"><HideAct id={item.thread.id} at={item.thread.at} title={item.thread.channel.title} /></div></div>
      </article>
    );
    case "question": return (
      <div className="fp-streamPost" data-bylined="">
        <Byline row={item.row} nowMs={nowMs} />
        <PostHead kind={<span className="fp-why" data-kind={item.why.kind} title={item.why.then}>{item.why.label}</span>} />
        <ForYouRow row={item.row} thumbs={false} nowMs={nowMs} navigate={navigate} />
      </div>
    );
    case "turn": return (
      <BackToYouRow turn={item.turn} at={when(item.turn.at, nowMs)} navigate={navigate}
        sessionName={item.turn.sessionId ? meta.sessionNames.get(item.turn.sessionId) ?? null : null} usualProject={meta.usualProject} />
    );
  }
}

/**
 * The page's Refresh, in its header row: one quiet button that reads the
 * feed, the placement and the right pane again. How fresh the page is shows
 * on hover; while it reads, the mark turns.
 */
function RefreshControl({ nowMs }: { nowMs: number }) {
  const { busy, at } = usePageFreshness();
  const fresh = freshnessLabel(at, nowMs);
  return (
    <span className="fp-refresh">
      {fresh ? <span className="fp-refreshAt" aria-hidden>{fresh}</span> : null}
      <button type="button" className="fp-refreshGo" data-busy={busy || undefined} aria-busy={busy}
        aria-label={fresh ? `Refresh. ${fresh}` : "Refresh"} title={fresh ?? undefined} onClick={() => void refreshPage()}>
        <Glyph name="refresh" size={14} />
      </button>
    </span>
  );
}

function RailHead({ children, link, navigate }: { children: ReactNode; link?: { label: string; route: Route } | null; navigate: Navigate }) {
  return <SectionHead link={link ?? null} navigate={navigate}>{children}</SectionHead>;
}

/* ── Between agents ────────────────────────────────────────────────────── */

/** How many of the runtime's messages and dispatches between agents the right rail shows. */
const BETWEEN_SHOWN = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What agents said to each other: the newest messages and dispatches in the fleet's window, one row each (the agent,
 * how long ago, what it said). The same reading as Cockpit's coordination; a click opens the thread or the ask.
 */
function BetweenAgents({ activity, sinceMs, nowMs, navigate }: { activity: readonly FleetActivity[] | undefined; sinceMs: number; nowMs: number; navigate: Navigate }) {
  const rows = useMemo(() => liveActivityFrom(activity, sinceMs).slice(0, BETWEEN_SHOWN), [activity, sinceMs]);
  if (!rows.length) return null;
  return (
    <section className="fp-section">
      <RailHead link={{ label: "Control", route: CONTROL }} navigate={navigate}>Between agents</RailHead>
      <div className="fp-between">
        {rows.map((item) => {
          const route = fleetActivityRoute(item);
          const text = activityLine(item);
          return (
            <button key={item.id} type="button" className="fp-betweenRow" disabled={!route} onClick={() => { if (route) navigate(route); }} title={text}>
              <span className="fp-betweenWho">
                <TintedMark harness={item.actorHarness ?? null} size={12} />
                <span className="fp-betweenName">{item.actorName ?? item.agentName ?? "agent"}</span>
                <span className="fp-quiet">{timeAgoPast(item.ts, nowMs)}</span>
              </span>
              {text ? <span className="fp-betweenText">{text}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

/** `post`: a Feed post a link names (/?post=<id>); the stream opens it expanded. */
export function FrontPage({ navigate, post }: { navigate: Navigate; post?: string }) {
  const engine = useHomeView();
  const seen = useSeenTurns();
  const [allTurns, setAllTurns] = useState(false);
  const [panes, wide] = useHomeWide();
  // The Feed in the middle hands up its unfiltered posts; Landed today reads those.
  const [streamFeed, setStreamFeed] = useState<FeedState | null>(null);
  const { live: requests } = useRequestRows();
  const home = useHomeFeed();
  const sources = useFeedSources();
  const { agents, agentsLoaded } = useScout();
  const held = useHeldMoves();
  const pendingHides = usePendingHides();
  const { nowMs } = home;

  const feed = engine.feed;
  const view = useMemo(() => {
    const full = homeView(feed ? { posts: [...feed.posts.values()], home: feed.home, size: feed.size } : null, { requests });
    // a post marked Done, Dropped or hidden leaves at once; Undo brings it back. The server leaves a hidden post
    // out of the Feed's reads; this only covers the moment before the next read.
    const hidden = new Set([...hiddenPosts(held), ...pendingHides]);
    return { ...full, forYou: full.forYou.filter((row) => !hidden.has(row.id)), backToYou: full.backToYou.filter((turn) => !hidden.has(turn.id)), shipped: full.shipped.filter((turn) => !hidden.has(turn.id)) };
  }, [feed, requests, held, pendingHides]);
  const outside = useMemo(() => (sources?.outside.connected ? sources.outside.threads.filter((t) => !pendingHides.has(t.id)) : []), [sources, pendingHides]);
  const waitingOnYou = useMemo(() => homeWaiting({ forYou: view.forYou, backToYou: view.backToYou, outside, seen }), [view.forYou, view.backToYou, outside, seen]);
  const context = useMemo(() => homeContext({ quota: sources?.quota ?? [], outside, nowMs }), [sources, outside, nowMs]);
  // The quota warning has no place of its own on Home any more: it stays a post in the stream.
  const placed = useMemo(() => placedIds(waitingOnYou, { ...context, quota: null }), [waitingOnYou, context]);
  const landedAll = useMemo(() => landedToday(streamFeed, nowMs), [streamFeed, nowMs]);
  // A shipped turn leads Landed with its picture; today's list does not repeat it.
  const landed = useMemo(() => {
    if (!landedAll) return view.shipped.length ? { rows: [], more: 0 } : null;
    const ids = new Set(view.shipped.map((t) => t.id));
    return { ...landedAll, rows: landedAll.rows.filter((row) => !ids.has(row.id) && !pendingHides.has(row.id)) };
  }, [landedAll, view.shipped, pendingHides]);
  // Sessions by their kept name (the operator's, or the work's), for the rows that name their session.
  const turnMeta = useMemo<TurnMeta>(() => {
    const sessionNames = new Map<string, string>();
    for (const transcript of home.tailDiscovery?.transcripts ?? []) {
      const name = transcript.sessionId ? sessionTitle(transcript) : null;
      if (name) sessionNames.set(transcript.sessionId!, name);
    }
    return { sessionNames, usualProject: usualProject([...view.backToYou, ...view.shipped].map((t) => t.project)) };
  }, [home.tailDiscovery, view.backToYou, view.shipped]);
  // A running session is titled by its work item: the feed's live posts name it.
  const workTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const post of feed?.posts.values() ?? []) {
      if (post.lead.kind === "live" && post.lead.ref.sessionId) titles.set(post.lead.ref.sessionId, post.title);
    }
    return titles;
  }, [feed]);
  // A running session's pull request, for its hover card: the one its live post names, an open one first.
  const sessionPrs = useMemo(() => {
    const prs = new Map<string, HomeRef>();
    for (const post of feed?.posts.values() ?? []) {
      if (post.lead.kind !== "live" || !post.lead.ref.sessionId || !post.prs.length) continue;
      const pr = post.prs.find((p) => p.state === "open") ?? post.prs[0]!;
      prs.set(post.lead.ref.sessionId, { label: pr.label, state: pr.state, url: pr.url });
    }
    return prs;
  }, [feed]);
  // What each running agent works on: the runtime's working items, read with the Work page's list.
  const workList = useWorkList(WORK_LIST);
  const byAgent = useMemo(() => workByAgent(workList.value), [workList.value]);
  const forYouCards = useForYouCards();
  // The projects the week already names, so a copy of a repository groups under it.
  const sourceProjects = useMemo(() => (sources?.activity?.rows ?? []).map((row) => row.project), [sources]);
  const running = useMemo(
    () => homeRunning({
      agents,
      workByAgent: byAgent,
      workTitles,
      sessionPrs,
      requests,
      projects: sourceProjects,
      tailEvents: home.tailEvents,
      transcripts: home.tailDiscovery?.transcripts ?? [],
      processes: home.tailDiscovery?.processes ?? [],
      nowMs,
    }),
    [agents, home.tailEvents, home.tailDiscovery, byAgent, workTitles, sessionPrs, requests, sourceProjects, nowMs],
  );

  // At work now (working, or waiting on you), and the rest of the window: active lately, newest first.
  const activeNow = useMemo(() => running.filter((row) => row.state !== "idle"), [running]);
  const activeLately = useMemo(
    () => homeRecent({ running, transcripts: home.tailDiscovery?.transcripts ?? [], projects: sourceProjects, nowMs }),
    [running, home.tailDiscovery, sourceProjects, nowMs],
  );
  // Active now is known once the roster, the local tail and the work list have answered; until then it keeps the
  // height it last had, and never says "Nothing running" on a guess.
  const runningSettled = agentsLoaded && home.tailSettled && workList.loaded;
  const runningReserve = useReserved("frontRunning", runningSettled, activeNow.length);

  // The page's Refresh also reads what this page holds outside its own hooks.
  usePageRefresh(() => Promise.all([refreshRequests({ fresh: true }), home.store.load("manual"), reloadWorkList(WORK_LIST)]));

  // The runtime or the feed can't be reached and nothing is on screen: say so,
  // as the old Home did, with Retry. A failed refresh keeps the page.
  const runtimeDown = !home.fleet && !home.loading && home.error;
  const feedDown = !feed && engine.error;
  if (runtimeDown || feedDown) {
    const retry = () => {
      if (runtimeDown) void home.store.load("manual");
      engine.reload();
    };
    return (
      <div className="s-front fp-loadState">
        <ConnectionState notice={homeLoadNotice((runtimeDown || feedDown) as string)} trace={home.trace} onRetry={retry} />
      </div>
    );
  }

  const waiting = waitingOnYou.length;
  // Finished turns past the first few wait behind "Show all"; asks and questions always show.
  const turnsHidden = allTurns ? 0 : Math.max(0, waitingOnYou.filter((i) => i.kind === "turn").length - HOME_TURNS_SHOWN);
  const shownItems = turnsHidden ? waitingOnYou.slice(0, waitingOnYou.length - turnsHidden) : waitingOnYou;
  // Left is what is true now: the sessions at work, then the ones active lately. Right is what already happened or
  // happened elsewhere: what landed today and what agents said to each other. Two panes put everything on the right.
  const runningSection = (
    <section className="fp-section">
      <SectionHead count={activeNow.length} link={{ label: "All sessions", route: { view: "sessions" } }} navigate={navigate}>Active now</SectionHead>
      <div ref={runningReserve.ref} style={runningReserve.style}>
        {activeNow.length ? <RunningList rows={activeNow} nowMs={nowMs} navigate={navigate} /> : runningSettled ? <div className="fp-nothing">Nothing running</div> : null}
      </div>
    </section>
  );
  const recentSection = activeLately.length ? (
    <section className="fp-section">
      <RailHead navigate={navigate}>{HOME_RECENT_LABEL}</RailHead>
      <RunningList rows={activeLately} nowMs={nowMs} navigate={navigate} />
    </section>
  ) : null;
  const betweenSection = <BetweenAgents activity={home.fleet?.activity} sinceMs={nowMs - (home.fleetLookbackMs ?? DAY_MS)} nowMs={nowMs} navigate={navigate} />;

  return (
    <div className="s-front">
      <div className="fp-page">
        <div className="fp-panes" ref={panes} data-wide={wide || undefined}>
          {wide ? (
            <aside className="fp-side" aria-label="Right now">
              {runningSection}
              {recentSection}
            </aside>
          ) : null}
          <main className="fp-stream" aria-label="Feed">
            {/* With nothing back to you the slot gives its space up; the Inbox and the stream below still hold everything. */}
            {waiting ? <section className="fp-placement" aria-label="Back to you">
              <div className="fp-pageHead">
                <SectionHead count={waiting} link={requests.length ? { label: "Inbox", route: requestsRoute() } : null} navigate={navigate}>Back to you</SectionHead>
                <RefreshControl nowMs={nowMs} />
              </div>
              {shownItems.map((item) => (
                <div key={item.id} className="fp-streamItem" data-kind={item.kind}>
                  <StreamItem item={item} cards={forYouCards} nowMs={nowMs} navigate={navigate} meta={turnMeta} />
                </div>
              ))}
              {turnsHidden ? (
                <button type="button" className="fp-textLink fp-turnMore" onClick={() => setAllTurns(true)}>Show {turnsHidden} more</button>
              ) : null}
            </section> : null}
            <FeedStream
              navigate={navigate}
              sources={sources}
              exclude={placed}
              embedded
              expand={post}
              onFeed={setStreamFeed}
            />
          </main>

          <aside className="fp-context" aria-label={wide ? "Landed and elsewhere" : "Right now"}>
            {/* Two panes: the left column's sections first, what is true now, then what landed. */}
            {wide ? null : runningSection}
            {wide ? null : recentSection}
            {landed ? (
              <section className="fp-section">
                <RailHead navigate={navigate}>Landed today</RailHead>
                <LandedList landed={landed} shipped={view.shipped} meta={turnMeta} nowMs={nowMs} navigate={navigate} />
              </section>
            ) : null}
            {betweenSection}
            {context.waitingOnThem.length ? (
              <section className="fp-section">
                <RailHead navigate={navigate}>Waiting on others</RailHead>
                {context.waitingOnThem.map((t) => <OutsideThread key={t.id} thread={t} nowMs={nowMs} compact />)}
              </section>
            ) : null}
          </aside>
        </div>
      </div>
      <MoveToast />
    </div>
  );
}
