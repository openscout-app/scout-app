/**
 * A For you item drawn for its kind, so it can be acted on from Home without
 * reading the agent's message. Each button answers through the runtime:
 *
 *   Permission  Allow, Deny, Always (only when the runtime offers it): the
 *               request's own decision (use-request-actions.ts)
 *   Decision    an option, sent as the operator's reply on the thread
 *   Question    a one-line answer, sent as the operator's reply on the thread
 *   Review      Review the draft, from the Feed's actions
 *   Push        Push it, from the Feed's actions
 *   Blocked     Continue: a successor task on the work
 *
 * A card with no backing for an answer shows none, and opens the thread.
 * How it went is one line under the actions.
 */
import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { api } from "../../../lib/api.ts";
import { refreshRequests } from "../../../lib/operator-requests-store.ts";
import { routePath } from "../../../lib/router.ts";
import type { OperatorAttentionAction, OperatorAttentionItem, Route } from "../../../lib/types.ts";
import type { ForYouCard as Card } from "../../../../shared/api/for-you.ts";
import { continueWork, HideAct, PostActions } from "../../feed/PostActions.tsx";
import { recordMove } from "../../feed/feed-moves.ts";
import { MoveLine } from "../../feed/post-parts.tsx";
import { useRequestActions } from "../../requests/use-request-actions.ts";
import { RequestProgress } from "../../requests/RequestProgress.tsx";
import { cardView, type CardView } from "./for-you-card-model.ts";
import type { HomeForYou } from "./front-page-model.ts";

type Navigate = (route: Route) => void;
type Status = { at: "idle" } | { at: "busy"; text: string } | { at: "done"; text: string } | { at: "failed"; text: string };

function why(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/\s+/g, " ").trim() : fallback;
}

function Go({ route, navigate, className, children }: { route: Route; navigate: Navigate; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(route);
  };
  return <a href={routePath(route)} onClick={onClick} className={className}>{children}</a>;
}

/** The request's thread when it names one, else its place in the Inbox. */
function threadRoute(row: HomeForYou): Route | null {
  if (row.source === "request") {
    const open = row.item.actions.find((a) => a.kind === "open" && a.route)?.route;
    if (open) return open as Route;
  }
  return row.open;
}

function StatusLine({ status }: { status: Status }) {
  if (status.at === "idle") return null;
  return <div className="fp-cardStatus" data-state={status.at} role={status.at === "failed" ? "alert" : "status"}>{status.text}</div>;
}

/** The operator's reply on the thread the ask came from. */
async function reply(conversationId: string, replyToMessageId: string | null, body: string): Promise<void> {
  await api("/api/send", { method: "POST", body: JSON.stringify({ body, conversationId, ...(replyToMessageId ? { replyToMessageId } : {}) }) });
  void refreshRequests();
}

function useStatus() {
  const [status, setStatus] = useState<Status>({ at: "idle" });
  const run = (going: Promise<string>, busy: string) => {
    setStatus({ at: "busy", text: busy });
    going.then((text) => setStatus({ at: "done", text }), (error: unknown) => setStatus({ at: "failed", text: why(error, "It did not go through.") }));
  };
  return [status, run] as const;
}

/* ── answers ───────────────────────────────────────────────────────────── */

/** Allow / Always / Deny from the request's own actions; only those the runtime offers. */
function RequestDecision({ item, navigate }: { item: OperatorAttentionItem; navigate: Navigate }) {
  const actions = useRequestActions(item, (action) => action.route && navigate(action.route as Route));
  const once = item.actions.find((a) => a.kind === "approve" && (a.value === "once" || !a.value || !item.permission));
  const always = item.permission ? item.actions.find((a) => a.kind === "approve" && a.value === "project") : undefined;
  const deny = item.actions.find((a) => a.kind === "deny");
  const button = (action: OperatorAttentionAction | undefined, label: string, primary = false) => action ? (
    <button type="button" className="fp-cardBtn" data-primary={primary || undefined} disabled={actions.busy || Boolean(actions.sent)} onClick={() => void actions.act(action)}>
      {actions.pendingLabel === action.label ? `${label}…` : label}
    </button>
  ) : null;
  // Sending, stalled, landed and unconfirmed read on the shared progress line; refusals and ended requests say why.
  const status: Status = actions.delivery?.state === "refused" ? { at: "failed", text: actions.delivery.reason }
    : actions.delivery?.state === "ended" ? { at: "done", text: actions.delivery.reason }
    : { at: "idle" };
  return (
    <>
      <div className="fp-cardActs">
        {button(once, "Allow", true)}
        {button(always, "Always")}
        {button(deny, "Deny")}
      </div>
      <RequestProgress delivery={actions.delivery} busy={actions.busy} stalled={actions.stalled} onRetry={() => void actions.retry()} />
      <StatusLine status={status} />
    </>
  );
}

/** `postId`: the Feed post the ask is on, when there is one; the choice is kept as its latest move (feed-moves.ts). */
export function useOptionReply(conversationId: string, replyToMessageId: string | null, postId: string | null = null) {
  const [status, run] = useStatus();
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = (label: string) => {
    if (chosen || status.at === "busy") return;
    setChosen(label);
    run(reply(conversationId, replyToMessageId, label).then(() => { recordMove(postId, "decide", label); return `Answered: ${label}.`; }).catch((error: unknown) => { setChosen(null); throw error; }), `Sending ${label}…`);
  };
  return { status, chosen, pick };
}

function OptionButtons({ view, conversationId, replyToMessageId, postId }: { view: CardView; conversationId: string; replyToMessageId: string | null; postId: string | null }) {
  const { status, chosen, pick } = useOptionReply(conversationId, replyToMessageId, postId);
  return (
    <>
      <div className="fp-cardActs" data-options>
        {view.options.map((o) => (
          <button key={o.label} type="button" className="fp-cardBtn" data-primary={o.recommended || undefined}
            data-chosen={chosen === o.label || undefined} disabled={Boolean(chosen) && status.at !== "failed"} onClick={() => pick(o.label)}
            title={o.description ?? undefined}>
            {o.label}
            {o.recommended ? <span className="fp-cardRec">Recommended</span> : null}
          </button>
        ))}
      </div>
      <StatusLine status={status} />
    </>
  );
}

/** The options as the agent laid them out, answered in its session. */
function OptionList({ view }: { view: CardView }) {
  return (
    <ul className="fp-cardOptions">
      {view.options.map((o) => (
        <li key={o.label} data-recommended={o.recommended || undefined}>
          <span className="fp-cardOptionLabel">{o.label}</span>
          {o.recommended ? <span className="fp-cardRec">Recommended</span> : null}
          {o.description ? <span className="fp-cardOptionText">{o.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Composer({ placeholder, send, done }: { placeholder: string; send: (body: string) => Promise<void>; done: string }) {
  const [text, setText] = useState("");
  const [status, run] = useStatus();
  const field = useRef<HTMLInputElement | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || status.at === "busy") return;
    run(send(body).then(() => { setText(""); return done; }), "Sending…");
  };
  return (
    <>
      <form className="fp-cardCompose" onSubmit={submit}>
        <input ref={field} className="fp-cardInput" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        <button type="submit" className="fp-cardBtn" data-primary disabled={!text.trim() || status.at === "busy"}>Send</button>
      </form>
      <StatusLine status={status} />
    </>
  );
}

function ContinueComposer({ workId, agent, postId }: { workId: string; agent: string; postId: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <div className="fp-cardActs"><button type="button" className="fp-cardBtn" data-primary onClick={() => setOpen(true)}>Continue</button></div>;
  }
  return <Composer placeholder={`What should ${agent} do next?`} send={(body) => continueWork(workId, body).then(() => recordMove(postId, "continue", body))} done={`Sent to ${agent} as a follow-up task.`} />;
}

function Answer({ card, view, row, navigate }: { card: Card; view: CardView; row: HomeForYou; navigate: Navigate }) {
  const agent = row.agent?.name ?? "the agent";
  const answer = card.answer;
  // A request card is the runtime's queue item; it leaves For you once answered. A post's answer is kept on the post.
  const postId = row.source === "post" ? row.post.id : null;
  if (answer.via === "post" && row.source === "post") return <div className="fp-cardPost"><PostActions post={row.post} navigate={navigate} /></div>;
  if (answer.via === "request" && row.source === "request") return <RequestDecision item={row.item} navigate={navigate} />;
  if (answer.via === "reply") {
    if (view.kind === "decision" && view.options.length) return <OptionButtons view={view} conversationId={answer.conversationId} replyToMessageId={answer.replyToMessageId} postId={postId} />;
    return <Composer placeholder={`Answer ${agent}`} send={(body) => reply(answer.conversationId, answer.replyToMessageId, body).then(() => recordMove(postId, "answer", body))} done="Answer sent." />;
  }
  if (answer.via === "continue") return <ContinueComposer workId={answer.workId} agent={agent} postId={postId} />;
  return null;
}

/* ── the card ──────────────────────────────────────────────────────────── */

/** `byline` is who and when, drawn first, as every row on Home and in the Feed opens; `agentCell` is what trails the card. */
export function ForYouCardView({ card, row, byline = null, agentCell, navigate }: { card: Card; row: HomeForYou; byline?: ReactNode; agentCell: ReactNode; navigate: Navigate }) {
  const view = cardView(card);
  if (!view) return null;
  const thread = threadRoute(row);
  const inSession = view.kind === "decision" && card.answer.via !== "reply";
  // A review leads with the work, not its pull request's title; the pull request is the one reference beside the label.
  const hero = view.kind === "review" ? row.title : view.hero;
  // A post the Feed serves can be hidden; PostActions carries its own Hide. A request is the runtime's, answered or dismissed there.
  const hideable = row.source === "post" && card.answer.via !== "post";
  return (
    <div className="fp-card" data-kind={view.kind}>
      <div className="fp-cardMain">
        {byline}
        <div className="fp-cardKind">
          {row.why ? <span className="fp-why" data-kind={row.why.kind} title={row.why.then}>{row.why.label}</span> : <span>{view.label}</span>}
          {view.about ? <span className="fp-cardAbout">{view.about}</span> : null}
          {row.project && !byline ? <span className="fp-cardAbout">{row.project}</span> : null}
        </div>
        <div className="fp-cardHero" data-mono={view.heroMono || undefined} title={hero}>{hero}</div>
        {view.line ? <div className="fp-cardLine">{view.line}</div> : null}
        {view.stake ? <div className="fp-cardLine" data-stake>{view.stake}</div> : null}
        {inSession && view.options.length ? <OptionList view={view} /> : null}
        {view.defaultAction ? <div className="fp-cardLine" data-default>Default: {view.defaultAction}</div> : null}
        {row.source === "post" ? <MoveLine move={row.post.move} /> : null}
        <Answer card={card} view={view} row={row} navigate={navigate} />
        {thread || hideable ? (
          <div className="fp-cardFoot">
            {thread ? <Go route={thread} navigate={navigate} className="fp-cardThread">{inSession ? "Answer in the session" : "Open thread"}</Go> : null}
            {hideable ? <HideAct id={row.id} at={row.at} title={row.title} /> : null}
          </div>
        ) : null}
      </div>
      {agentCell}
    </div>
  );
}
