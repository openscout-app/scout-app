/*
 * A post's actions: its one primary move in an aligned column at the right,
 * and the rest on hover, focus or a key. The Feed and Home's For you band
 * render it; the parent places the two grid areas `pa-primary` and `pa-strip`.
 *
 *   Primary   Review the draft, Push it, Ship it, Open the study (post-actions.ts)
 *   Continue  a successor task for the same agent: POST /api/work/:id/continue
 *   Ask       Scoutbot answers from the post: POST /api/scoutbot/artifact-ask
 *   React     to the owner's session (POST /api/sessions/reply), else as a successor task
 *   Done/Drop the runtime's work move, held for undo (pending-moves.ts)
 *   Hide      out of the Feed and Home until it has something newer; the work is unchanged (feed-hides.ts)
 *   Open      the session, the pull request, the study
 *
 * Each action says how it went in one line under the strip.
 *
 * In the lightbox (`sheet`) the box to write to the agent is open under the
 * moves: typed into its session when Scout can reach it, else a follow-up task
 * on the same work. Its key focuses the box, and Escape leaves the box with
 * the post still open.
 */
import { useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type Ref } from "react";
import "./post-actions.css";
import { ScoutActionButton } from "../../primitives/ScoutActionButton.tsx";
import { isWaitingOnYou } from "./attention-model.ts";
import { api } from "../../lib/api.ts";
import { replyToSession } from "../../lib/session-start.ts";
import { routePath } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import type { FeedPostDetail, FeedPostHead } from "../../../shared/api/feed.ts";
import { ASK_QUESTIONS } from "../canvas/ask.ts";
import { REACTIONS, type ReactionKind } from "../canvas/reactions.ts";
import { dismissMove, holdMove, undoMove, useHeldMoves } from "./pending-moves.ts";
import { closeHideFailure, hideItem, undoHide, useRecentHide } from "./feed-hides.ts";
import { recordMove } from "./feed-moves.ts";
import { ACTION_KEY, askAboutPost, postActions, pushMessage, reactMessage, type FeedCommand, type ReactRoute } from "./post-actions.ts";
import { ReplyBox } from "./ReplyBox.tsx";

type Navigate = (route: Route) => void;
type Panel = "continue" | "ask" | "react" | null;
type Status = { at: "idle" } | { at: "busy"; text: string } | { at: "done"; text: string } | { at: "failed"; text: string };

/** What the page's keyboard can ask of a post. */
export type PostActionsHandle = { run(command: FeedCommand): boolean };

const ARM_MS = 3_000;

function why(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/\s+/g, " ").trim() : fallback;
}

function requestId(): string {
  return `feed-${crypto.randomUUID()}`;
}

/** A successor task on the post's work, as `scout ask --continue <work>`. */
export async function continueWork(workId: string, body: string): Promise<void> {
  await api(`/api/work/${encodeURIComponent(workId)}/continue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, requestId: requestId() }),
  });
}

export async function sendDirection(route: ReactRoute, body: string, agent: string): Promise<string> {
  if (route.to === "session") {
    const r = await replyToSession({ sessionId: route.sessionId, harness: route.harness, cwd: route.cwd, body, clientMessageId: crypto.randomUUID() });
    return r.delivery === "in_place" ? `Typed into ${agent}'s session${r.location ? ` in ${r.location}` : ""}.` : `${agent}'s session was resumed with it.`;
  }
  await continueWork(route.workId, body);
  return `Sent to ${agent} as a follow-up task.`;
}

function Key({ k }: { k: string | undefined }) {
  return k ? <kbd className="pa-key" aria-hidden>{k}</kbd> : null;
}

export function PostActions({ post, detail = null, navigate, ref, sheet = false }: {
  post: FeedPostHead;
  /** The post's detail when the parent already read it; Ask reads it otherwise. */
  detail?: FeedPostDetail | null;
  navigate: Navigate;
  ref?: Ref<PostActionsHandle>;
  /** Drawn in the lightbox: the box to write to the agent stays open under the moves. */
  sheet?: boolean;
}) {
  const actions = postActions(post);
  const resting: Panel = sheet && actions.continue ? "continue" : null;
  const [panel, setPanel] = useState<Panel>(resting);
  const [status, setStatus] = useState<Status>({ at: "idle" });
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState<{ question: string; text: string | null } | null>(null);
  const [kind, setKind] = useState<ReactionKind | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // The lightbox opens with the box shown but the post focused, so the post's keys still work: the box takes the
  // keyboard only when the panel changes after that (a key or a click asked for it), never on the first draw, however
  // many times the effect runs for it.
  const shownPanel = useRef<Panel>(panel);
  const firstKind = useRef<HTMLButtonElement | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (panel === shownPanel.current) return;
    shownPanel.current = panel;
    if (panel === "continue" || panel === "ask") field.current?.focus();
    if (panel === "react") firstKind.current?.focus();
  }, [panel]);

  const report = (going: Promise<string>, busy: string) => {
    setStatus({ at: "busy", text: busy });
    going.then(
      (text) => { if (alive.current) setStatus({ at: "done", text }); },
      (error: unknown) => { if (alive.current) setStatus({ at: "failed", text: why(error, "It did not go through.") }); },
    );
  };

  const runPrimary = (fromKey: boolean) => {
    const primary = actions.primary;
    if (!primary || status.at === "busy") return;
    if (primary.kind === "review_draft" || primary.kind === "open_study") {
      window.open(primary.href, "_blank", "noopener");
      return;
    }
    // Asking an agent to push or land is one keystroke away; a key press arms it first.
    if (fromKey && !armed) { setArmed(true); return; }
    setArmed(false);
    if (primary.kind === "push") report(continueWork(post.workId, pushMessage(post)).then(() => { recordMove(post.id, "push"); return `Asked ${post.agent.name} to push it and open a pull request.`; }), "Asking…");
    else report(sendDirection(actions.react, reactMessage("ship", post), post.agent.name).then((where) => { recordMove(post.id, "ship", primary.pr.label); return `Ship it sent. ${where}`; }), "Sending…");
  };

  const move = (command: "done" | "drop") => holdMove({ postId: post.id, workId: post.workId, title: post.title, command });
  const hide = () => hideItem({ id: post.id, at: post.at, title: post.title });

  useImperativeHandle(ref, () => ({
    run(command) {
      switch (command) {
        case "primary": if (!actions.primary) return false; runPrimary(true); return true;
        case "continue": if (!actions.continue) return false; openPanel("continue"); return true;
        case "ask": openPanel("ask"); return true;
        case "react": openPanel("react"); return true;
        case "done": if (!actions.done) return false; move("done"); return true;
        case "drop": if (!actions.drop) return false; move("drop"); return true;
        case "hide": hide(); return true;
        default: return false;
      }
    },
  }));

  /** Opens a panel; one already open takes focus again. */
  const openPanel = (next: Exclude<Panel, null>) => {
    if (panel === next) { (next === "react" ? firstKind.current : field.current)?.focus(); return; }
    setPanel(next);
  };
  // In the lightbox a panel folds back to the open box; in the stream it folds away.
  const toggle = (next: Exclude<Panel, null>) => (panel === next && next !== resting ? setPanel(resting) : openPanel(next));
  /** Escape in a box: the stream folds the panel; the lightbox leaves the box, so the next Escape closes the post. */
  const leave = () => {
    if (sheet) { field.current?.blur(); setPanel(resting); return; }
    setPanel(null);
  };

  const submitContinue = () => {
    const body = draft.trim();
    if (!body || status.at === "busy") return;
    // A reply to an agent's own post is that session's next turn. In the lightbox the box writes where Steer did:
    // into the session when Scout can reach it, else a follow-up task.
    const direct = post.agentPost?.own || sheet;
    const sent = direct ? sendDirection(actions.react, body, post.agent.name) : continueWork(post.workId, body).then(() => `Sent to ${post.agent.name} as a follow-up task.`);
    report(sent.then((text) => { recordMove(post.id, direct ? "reply" : "continue", body); setDraft(""); setPanel(resting); return text; }), "Sending…");
  };

  const ask = async (question: string) => {
    const q = question.replace(/\s+/g, " ").trim();
    if (!q || status.at === "busy") return;
    setAnswer({ question: q, text: null });
    setStatus({ at: "busy", text: "Asking Scoutbot…" });
    try {
      const read = detail ?? await api<FeedPostDetail>(`/api/feed/post/${encodeURIComponent(post.id)}`).catch(() => null);
      const r = await api<{ answer: string }>("/api/scoutbot/artifact-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(askAboutPost(q, post, read)),
      });
      if (!alive.current) return;
      if (!r.answer) throw new Error("Scoutbot gave no answer.");
      setAnswer({ question: q, text: r.answer });
      setStatus({ at: "idle" });
      recordMove(post.id, "ask", q);
    } catch (error) {
      if (alive.current) { setAnswer(null); setStatus({ at: "failed", text: why(error, "Scoutbot could not answer.") }); }
    }
  };

  const react = () => {
    if (!kind || status.at === "busy") return;
    const label = REACTIONS.find((r) => r.kind === kind)?.label ?? kind;
    const note = draft.replace(/\s+/g, " ").trim();
    report(sendDirection(actions.react, reactMessage(kind, post, draft), post.agent.name).then((where) => { recordMove(post.id, "react", note ? `${label}. ${note}` : label); setKind(null); setDraft(""); setPanel(resting); return `${label} sent. ${where}`; }), "Sending…");
  };

  const openSession = (event: MouseEvent<HTMLAnchorElement>, route: Route) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(route);
  };

  const waiting = isWaitingOnYou(post);
  const Resolution = waiting ? ScoutActionButton : "button";
  const busy = status.at === "busy";
  const agent = post.agent.name;
  const inSession = actions.react.to === "session";
  const writeTo = post.agentPost?.own ? `Reply to ${agent}` : sheet ? (inSession ? `Steer ${agent}` : `Follow up with ${agent}`) : `What should ${agent} do next?`;

  return (
    <>
      <div className="pa-primary">
        {actions.primary ? (
          <button type="button" className="pa-go" data-kind={actions.primary.kind} data-armed={armed || undefined} disabled={status.at === "busy"} onClick={() => runPrimary(false)}>
            {armed ? "Press p again" : actions.primary.label}
            <Key k={ACTION_KEY.primary} />
          </button>
        ) : null}
      </div>

      <div className="pa-strip" data-open={panel || status.at !== "idle" || undefined}>
        <div className="pa-row" role="group" aria-label="Actions">
          {actions.continue ? (
            <Resolution type="button" className={waiting ? undefined : "pa-act"} data-tier="primary" aria-expanded={panel === "continue"} onClick={() => toggle("continue")}>
              {post.agentPost?.own ? "Reply" : "Continue"}<Key k={ACTION_KEY.continue} />
            </Resolution>
          ) : null}
          {actions.done ? (
            <Resolution type="button" className={waiting ? undefined : "pa-act"} {...(waiting ? { quiet: true } : {})} data-tier="primary" onClick={() => move("done")}>
              Done<Key k={ACTION_KEY.done} />
            </Resolution>
          ) : null}
          <span className="pa-quiet">
            <button type="button" className="pa-act s-ds-act" aria-expanded={panel === "ask"} onClick={() => toggle("ask")}>Ask<Key k={ACTION_KEY.ask} /></button>
            <button type="button" className="pa-act s-ds-act" aria-expanded={panel === "react"} onClick={() => toggle("react")}>React<Key k={ACTION_KEY.react} /></button>
            {actions.drop ? <button type="button" className="pa-act s-ds-act" onClick={() => move("drop")}>Drop<Key k={ACTION_KEY.drop} /></button> : null}
            <button type="button" className="pa-act s-ds-act" aria-label="Hide until something new happens" onClick={hide}>Hide<Key k={ACTION_KEY.hide} /></button>
          </span>
          {actions.open.length ? (
            <span className="pa-open">
              {actions.open.map((o) => o.kind === "session" ? (
                <a key="session" className="pa-act s-ds-act" href={routePath({ view: "sessions", sessionId: o.sessionId })} onClick={(e) => openSession(e, { view: "sessions", sessionId: o.sessionId })}>{o.label}</a>
              ) : (
                <a key={o.kind} className="pa-act s-ds-act" href={o.href} target="_blank" rel="noreferrer">{o.label}</a>
              ))}
            </span>
          ) : null}
        </div>

        {panel === "continue" ? (
          <div className="pa-panel pa-panel--stack">
            <ReplyBox
              fieldRef={field}
              value={draft}
              maxLength={2000}
              placeholder={writeTo}
              label={writeTo}
              canSend={Boolean(draft.trim()) && !busy}
              onChange={setDraft}
              onSend={submitContinue}
              onEscape={leave}
            />
            {sheet && status.at === "idle" ? <p className="pa-hint">{inSession ? "Goes to its session." : "Goes as a follow-up task."}</p> : null}
          </div>
        ) : null}

        {panel === "ask" ? (
          <div className="pa-panel pa-panel--stack">
            <div className="pa-choices">
              {ASK_QUESTIONS.update.map((q) => <button key={q} type="button" className="pa-choice" disabled={busy} onClick={() => void ask(q)}>{q}</button>)}
            </div>
            <ReplyBox
              fieldRef={field}
              value={draft}
              maxLength={400}
              placeholder="Ask your own"
              label="Your question"
              canSend={Boolean(draft.trim()) && !busy}
              onChange={setDraft}
              onSend={() => { void ask(draft); setDraft(""); }}
              onEscape={leave}
            />
            {answer ? (
              <div className="pa-answer" role="status">
                <p className="pa-asked">{answer.question}</p>
                {answer.text ? <p className="pa-answerText">{answer.text}</p> : null}
              </div>
            ) : <p className="pa-hint">Scoutbot reads the post, the task and the files changed. The agent is not interrupted.</p>}
          </div>
        ) : null}

        {panel === "react" ? (
          <div className="pa-panel pa-panel--stack">
            <div className="pa-choices" role="radiogroup" aria-label="Reaction">
              {REACTIONS.map((r, i) => (
                <button key={r.kind} ref={i === 0 ? firstKind : undefined} type="button" role="radio" aria-checked={kind === r.kind} className="pa-choice" title={r.means} onClick={() => setKind(r.kind)}>{r.label}</button>
              ))}
            </div>
            <ReplyBox
              fieldRef={field}
              value={draft}
              maxLength={600}
              placeholder="Add a sentence"
              label="Your sentence"
              canSend={Boolean(kind) && !busy}
              onChange={setDraft}
              onSend={react}
              onEscape={leave}
            />
            <p className="pa-hint">{kind ? `Tells ${post.agent.name}: ${REACTIONS.find((r) => r.kind === kind)?.means}` : `Pick one. It reaches ${post.agent.name} as direction.`}</p>
          </div>
        ) : null}

        {status.at !== "idle" ? (
          <p className="pa-status" data-state={status.at} role="status">{status.at === "failed" ? `Not sent: ${status.text}` : status.text}</p>
        ) : null}
      </div>
    </>
  );
}

/** A Hide button for a row that has no PostActions: the same move, in the same style. */
export function HideAct({ id, at, title }: { id: string; at: number; title: string }) {
  return (
    <button type="button" className="pa-act" onClick={() => hideItem({ id, at, title })}>Hide</button>
  );
}

/** Undo the newest of a hide and a held move. */
export function undoLast() {
  if (!undoHide()) undoMove();
}

function clip(title: string): string {
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

/** The undo line for Done, Drop and Hide, and a move or hide that did not go through. One per page. */
export function MoveToast() {
  const moves = useHeldMoves();
  const hidden = useRecentHide();
  const failed = moves.find((m) => m.state === "failed");
  const held = [...moves].reverse().find((m) => m.state === "held");
  if (hidden && (hidden.state === "held" || !held)) {
    return (
      <div className="pa-toast" role="status" data-state={hidden.state}>
        {hidden.state === "failed" ? (
          <>
            <span>Not hidden: {hidden.error}</span>
            <button type="button" className="pa-toastAct" onClick={closeHideFailure}>Close</button>
          </>
        ) : (
          <>
            <span>Hidden: {clip(hidden.title)}</span>
            <button type="button" className="pa-toastAct" onClick={() => undoHide()}>Undo<kbd className="pa-key pa-key--on" aria-hidden>u</kbd></button>
          </>
        )}
      </div>
    );
  }
  const shown = held ?? failed;
  if (!shown) return null;
  const title = clip(shown.title);
  return (
    <div className="pa-toast" role="status" data-state={shown.state}>
      {shown.state === "failed" ? (
        <>
          <span>Not moved: {shown.error}</span>
          <button type="button" className="pa-toastAct" onClick={() => dismissMove(shown.postId)}>Close</button>
        </>
      ) : (
        <>
          <span>{shown.command === "done" ? "Done" : "Dropped"}: {title}</span>
          <button type="button" className="pa-toastAct" onClick={() => undoMove(shown.postId)}>Undo<kbd className="pa-key pa-key--on" aria-hidden>u</kbd></button>
        </>
      )}
    </div>
  );
}
