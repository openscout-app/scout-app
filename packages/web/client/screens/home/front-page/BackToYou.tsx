/**
 * A session back to you, as one row, led by what it needs of you. What its
 * turn produced comes first (a screenshot, a clip, a page, or the screenshot
 * its pull request shows), then its title, then two lines written once per
 * turn by the cheap model (feed/turn-summaries.ts): where the work stands,
 * and the need. A decision is its options as buttons, and a click sends that
 * choice to the session as its next turn; the option the work already shipped
 * with reads "live". A review or a question is its one line. A turn that
 * needs nothing leaves (the server drops it too, once summarized).
 *
 * Until the summary exists, the row reads the agent's own first sentence.
 * Then the session, quietly: the harness mark and the session's own name
 * (never "demo-app session" or a crew codename; back-to-you-meta.ts), its
 * project only when it is not the usual one, and the time on hover. A pull
 * request is one link among the moves, never the headline.
 *
 * Everything else stays one move away, never deleted:
 *   the outcome     the agent's own words: the title's tooltip, and under the
 *                   caption while a steer is open
 *   the session     the mark's tooltip (name, project, the change's size), and
 *                   the session move, which carries its name
 *   what acting does  the label's tooltip; the steer field's placeholder
 *
 * The moves take the mark's place on hover or focus, as on the Feed:
 *   Steer     reply in place: typed into the session when Scout can reach it,
 *             else a follow-up task on the work (PostActions.sendDirection)
 *   Open      the artifact, in a new tab
 *   <name>    the session's page
 *   #123      the pull request, when there is one
 *
 * Opening or steering from here takes the turn out of the placement
 * (back-to-you-seen.ts). How a steer or a choice went is one line under
 * what sent it. A failure says why, and Dismiss beside it sets the turn
 * aside the same way, so a turn that cannot be answered from here does not
 * stay.
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { routePath } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";
import { HideAct, sendDirection } from "../../feed/PostActions.tsx";
import { ReplyBox } from "../../feed/ReplyBox.tsx";
import { reactRoute } from "../../feed/post-actions.ts";
import { Mark } from "../../feed/sources.tsx";
import { G, Glyph } from "../../feed/post-parts.tsx";
import { useTurnSummary } from "../../feed/turn-summaries.ts";
import { markTurnSeen } from "./back-to-you-seen.ts";
import { recordMove } from "../../feed/feed-moves.ts";
import { decisionBody, notSentLine, turnName } from "./back-to-you-meta.ts";
import type { FeedNeed } from "../../../../shared/api/feed.ts";
import type { ReactRoute } from "../../feed/post-actions.ts";
import type { HomeArtifact, HomeTurn } from "./front-page-model.ts";
import { shownLabel, steerHint } from "./home-why.ts";

type Navigate = (route: Route) => void;
type Status = { at: "idle" } | { at: "busy" } | { at: "done"; text: string } | { at: "failed"; text: string };

/** After a steer lands, the row stays this long so its line can be read. */
const LEAVE_AFTER_MS = 2_400;

const NOUN: Record<HomeArtifact["kind"], string> = { visual: "Screenshot", video: "Clip", page: "Page" };

/** What to call the artifact on its Open move. */
export function artifactNoun(artifact: HomeArtifact): string {
  return NOUN[artifact.kind];
}

/** The session in words, for the mark's tooltip: "turing-23 · demo-app · +335 −74". */
export function sessionLine(turn: Pick<HomeTurn, "agent" | "project" | "size">): string {
  return [
    turn.agent?.name,
    turn.project,
    turn.size ? `+${turn.size.additions} −${turn.size.deletions}` : null,
  ].filter(Boolean).join(" · ");
}

function why(error: unknown): string {
  return error instanceof Error && error.message ? error.message.replace(/\s+/g, " ").trim() : "It did not go through.";
}

function plain(event: MouseEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0);
}

function PageGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M4 1.75h5.25L12 4.5v9.75H4z" />
      <path d="M9 1.75V4.75h3M6 8h4M6 10.25h4" />
    </svg>
  );
}

function artifactBody(artifact: HomeArtifact) {
  switch (artifact.kind) {
    case "visual":
      return <img src={artifact.src} alt={artifact.caption ?? ""} loading="lazy" />;
    case "video":
      return (
        <video src={artifact.src} muted playsInline loop preload="metadata" aria-label={artifact.caption ?? undefined}
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()} />
      );
    case "page":
      return <span className="fp-turnDoc"><PageGlyph /><span className="fp-turnDocName">{artifact.label}</span></span>;
  }
}

function Artifact({ artifact, onOpen }: { artifact: HomeArtifact; onOpen: () => void }) {
  const body = artifactBody(artifact);
  return artifact.href ? (
    <a className="fp-turnArt" data-kind={artifact.kind} href={artifact.href} target="_blank" rel="noreferrer" onClick={onOpen} aria-label={`Open the ${artifactNoun(artifact).toLowerCase()}`}>{body}</a>
  ) : (
    <div className="fp-turnArt" data-kind={artifact.kind}>{body}</div>
  );
}

/**
 * How a send went, as one line under what sent it. A failure says why and,
 * when the row can leave, offers Dismiss: the turn leaves Back to you as it
 * does after a steer, and nothing is sent.
 */
export function SendStatus({ status, className, onDismiss }: { status: Status; className: string; onDismiss?: () => void }) {
  if (status.at !== "done" && status.at !== "failed") return null;
  return (
    <div className={className} data-state={status.at}>
      <p className="pa-status" data-state={status.at} role="status">{status.at === "failed" ? notSentLine(status.text) : status.text}</p>
      {status.at === "failed" && onDismiss ? <button type="button" className="fp-statusDismiss" onClick={onDismiss}>Dismiss</button> : null}
    </div>
  );
}

/**
 * A decision's options as buttons. A click sends the choice through the
 * steer path (PostActions.sendDirection) as the session's next turn. The
 * option the work already shipped with is marked live.
 */
export function NeedChoices({ need, ask, route, agent, postId = null, onSent, onDismiss }: {
  need: Extract<FeedNeed, { kind: "decision" }>;
  ask: string | null;
  route: ReactRoute;
  agent: string;
  /** The post the decision is on: the choice is kept as its latest move (feed-moves.ts). */
  postId?: string | null;
  onSent?: (where: string) => void;
  /** Sets the turn aside after a failed choice; without it the failure has no Dismiss. */
  onDismiss?: () => void;
}) {
  const [status, setStatus] = useState<Status>({ at: "idle" });
  const [picked, setPicked] = useState<string | null>(null);
  const choose = (option: string) => {
    if (status.at === "busy") return;
    setPicked(option);
    setStatus({ at: "busy" });
    sendDirection(route, decisionBody(ask, option), agent).then(
      (where) => { setStatus({ at: "done", text: where }); recordMove(postId, "decide", option); onSent?.(where); },
      (error: unknown) => setStatus({ at: "failed", text: why(error) }),
    );
  };
  return (
    <div className="fp-choices">
      <div className="fp-choiceRow" role="group" aria-label={ask ?? "Choose"}>
        {need.options.map((option) => (
          <button key={option} type="button" className="fp-choice" data-live={option === need.live || undefined}
            aria-pressed={picked === option} disabled={status.at === "busy" || status.at === "done"} onClick={() => choose(option)}>
            {option}{option === need.live ? <span className="fp-choiceLive">live</span> : null}
          </button>
        ))}
      </div>
      <SendStatus status={status} className="fp-choiceStatus" onDismiss={onDismiss} />
    </div>
  );
}

export function BackToYouRow({ turn, at, navigate, sessionName = null, usualProject = null }: {
  turn: HomeTurn;
  /** When the turn ended, in words; shown on hover. */
  at: string;
  navigate: Navigate;
  /** The session's kept name (the operator's, or its work title), when the runtime has one. */
  sessionName?: string | null;
  /** The project most rows share: this row names its own only when it differs. */
  usualProject?: string | null;
}) {
  const [steering, setSteering] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>({ at: "idle" });
  const field = useRef<HTMLTextAreaElement | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { if (steering) field.current?.focus(); }, [steering]);

  const summary = useTurnSummary(turn.id, turn.at);
  const seen = () => markTurnSeen(turn.turnKey);
  const name = turnName({ sessionName, agentName: turn.agent?.name, title: turn.title });
  const agent = name ?? turn.agent?.name ?? "the session";
  const pr = turn.post.prs[0] ?? null;
  const session: Route | null = turn.sessionId ? { view: "sessions", sessionId: turn.sessionId } : turn.open;

  const go = (route: Route) => (event: MouseEvent<HTMLAnchorElement>) => {
    seen();
    if (!plain(event)) return;
    event.preventDefault();
    navigate(route);
  };

  const steer = () => {
    const body = draft.replace(/\s+/g, " ").trim();
    if (!body || status.at === "busy") return;
    setStatus({ at: "busy" });
    sendDirection(reactRoute(turn.post), body, agent).then(
      (where) => {
        recordMove(turn.post.id, "reply", body);
        if (!alive.current) return;
        setDraft("");
        setSteering(false);
        setStatus({ at: "done", text: where });
        setTimeout(seen, LEAVE_AFTER_MS);
      },
      (error: unknown) => { if (alive.current) setStatus({ at: "failed", text: why(error) }); },
    );
  };


  // Its summary says it needs nothing of you: it is not back to you.
  const need = summary?.need ?? null;
  if (need?.kind === "none") return null;

  // A picture or a clip leads as a thumbnail beside the row; a page leads as the row's first line.
  // A change is plumbing, never the artifact, and its size is left out: it counts generated files.
  const pictured = turn.artifact?.kind === "visual" || turn.artifact?.kind === "video";
  // The title is the outcome and the caption the ask, as the Feed table writes them; the summary's ask is the line
  // on what acting does. A turn to steer says nothing more there: the composer carries where a reply goes.
  const caption = turn.caption;
  const next = summary ? summary.ask : turn.why.kind === "steer" ? null : turn.why.then;
  const tip = [turn.title, turn.caption].filter(Boolean).join("\n");
  const project = turn.project && turn.project !== usualProject ? turn.project : null;
  // A pull request to review or merge is named, not described: "Ready to merge" claimed more than an open state shows.
  const whyPr = turn.why.kind === "draft" || turn.why.kind === "merge"
    ? turn.post.prs.find((p) => p.state === (turn.why.kind === "draft" ? "draft" : "open")) ?? null
    : null;
  return (
    <article className="fp-turn" data-art={pictured ? "" : undefined} data-open={steering || status.at !== "idle" || undefined} title={at}>
      {pictured && turn.artifact ? <Artifact artifact={turn.artifact} onOpen={seen} /> : null}
      <div className="fp-turnMain">
        {/* Who and when, on one line, before what it says: a feed is read by who's talking. */}
        <div className="fp-turnBy" title={sessionLine(turn) || undefined}>
          <Mark harness={turn.agent?.harness} size={12} />
          <span className="fp-turnName">{name ?? turn.agent?.name ?? "Session"}</span>
          {project ? <span className="fp-turnWhere">{project}</span> : null}
          <span className="fp-turnAt">{at}</span>
        </div>
        {!pictured && turn.artifact ? <Artifact artifact={turn.artifact} onOpen={seen} /> : null}
        <h3 className="fp-turnTitle">
          {whyPr ? (
            <a className="fp-why fp-whyPr" data-kind={turn.why.kind} href={whyPr.url} target="_blank" rel="noreferrer" onClick={seen}
              title={[whyPr.title, turn.why.then].filter(Boolean).join("\n")}>
              <Glyph d={whyPr.state === "draft" ? G.draft : G.pr} />
              <span>{whyPr.label}</span>
            </a>
          ) : turn.why.kind === "steer" ? null : <span className="fp-why" data-kind={turn.why.kind}>{turn.why.label}</span>}
          {turn.open ? <a className="fp-plain" href={routePath(turn.open)} onClick={go(turn.open)} title={tip}>{turn.title}</a> : <span title={tip}>{turn.title}</span>}
        </h3>
        {caption ? <p className="fp-turnCaption" data-summary={summary ? "" : undefined}>{caption}</p> : null}
        {next ? <p className="fp-then" data-ask={summary?.ask ? "" : undefined} data-need={need?.kind}>{next}</p> : null}
        {need?.kind === "decision" ? <NeedChoices need={need} ask={summary?.ask ?? null} route={reactRoute(turn.post)} agent={agent} postId={turn.post.id} onSent={() => setTimeout(seen, LEAVE_AFTER_MS)} onDismiss={seen} /> : null}
      </div>
      <div className="fp-turnMoves" role="toolbar" aria-label="Moves">
        <button type="button" className="pa-act" aria-expanded={steering} onClick={() => setSteering((s) => !s)}>Steer</button>
        {turn.artifact?.href ? (
          <a className="pa-act" href={turn.artifact.href} target="_blank" rel="noreferrer" onClick={seen}>Open {artifactNoun(turn.artifact).toLowerCase()}</a>
        ) : null}
        {session ? <a className="pa-act" href={routePath(session)} onClick={go(session)} title={turn.project ?? undefined}>{turn.agent?.name ?? "Session"}</a> : null}
        {pr && pr !== whyPr ? <a className="pa-act fp-mono" href={pr.url} target="_blank" rel="noreferrer" onClick={seen} title={pr.title || undefined}>{pr.label}</a> : null}
        <HideAct id={turn.id} at={turn.at} title={turn.title} />
      </div>
      {steering ? (
        <div className="fp-turnSteer">
          <ReplyBox
            fieldRef={field}
            value={draft}
            maxLength={2000}
            placeholder={steerHint(agent)}
            label={`Steer ${agent}`}
            canSend={Boolean(draft.trim()) && status.at !== "busy"}
            onChange={setDraft}
            onSend={steer}
            onEscape={() => setSteering(false)}
          />
        </div>
      ) : null}
      <SendStatus status={status} className="fp-turnStatus" onDismiss={seen} />
    </article>
  );
}

/**
 * A turn that was back to you until its pull requests merged, in Landed:
 * its picture, the ask it answered in one line, "Merged, live",
 * and the one decision or question its work left open, answered in place.
 * A review is settled by the merge, so it does not show.
 */
export function ShippedRow({ turn, at, navigate, sessionName = null }: { turn: HomeTurn; at: string; navigate: Navigate; sessionName?: string | null }) {
  const summary = useTurnSummary(turn.id, turn.at);
  const name = turnName({ sessionName, agentName: turn.agent?.name, title: turn.title });
  const agent = name ?? turn.agent?.name ?? "the session";
  const need = summary?.need ?? null;
  const left = need?.kind === "decision" || need?.kind === "question" ? need : null;
  const picture = turn.artifact?.kind === "visual" ? turn.artifact : null;
  const settled = turn.post.settled;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!turn.open || !plain(event)) return;
    event.preventDefault();
    navigate(turn.open);
  };
  return (
    <article className="fp-shipped" data-art={picture ? "" : undefined} title={at}>
      {picture ? (
        <a className="fp-shippedArt" href={picture.href} target="_blank" rel="noreferrer" aria-label="Open the screenshot">
          <img src={picture.src} alt={picture.caption ?? ""} loading="lazy" />
        </a>
      ) : null}
      <div className="fp-shippedMain">
        <span className="fp-shippedHead">
          <Mark harness={turn.agent?.harness} size={12} />
          {turn.open ? <a className="fp-landedTitle" href={routePath(turn.open)} onClick={open}>{turn.title}</a> : <span className="fp-landedTitle">{turn.title}</span>}
        </span>
        {turn.caption ? <span className="fp-landedOut">{turn.caption}</span> : null}
        <span className="fp-landedWho">
          {[settled?.prs[0] ? `Merged, live · ${settled.prs[0]}` : "Merged, live", name].filter(Boolean).join(" · ")}
        </span>
        {left && summary?.ask ? <p className="fp-then" data-ask="" data-need={left.kind}>{summary.ask}</p> : null}
        {left?.kind === "decision" ? <NeedChoices need={left} ask={summary?.ask ?? null} route={reactRoute(turn.post)} agent={agent} postId={turn.post.id} /> : null}
        <div className="pa-strip"><div className="pa-row"><HideAct id={turn.id} at={turn.at} title={turn.title} /></div></div>
      </div>
    </article>
  );
}
