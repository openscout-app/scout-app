import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { replyToSession } from "../../lib/session-start.ts";
import { sendToFocusedAgentSession } from "../../lib/send-to-agent-session.ts";
import type { Agent } from "../../lib/types.ts";
import { ASK_QUESTIONS, askRequest } from "../canvas/ask.ts";
import { REACTIONS, reactionMessage, type ReactionKind } from "../canvas/reactions.ts";
import type { HomeAgentDay } from "./agents-home-feed-model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Agents feed detail · respond — under an opened update, two ways to act on
   it without leaving the feed.

   Ask Scoutbot: a question about the update, answered one-shot from what the
   panel already shows (the update, the ask it answered, the files the
   session changed). POST /api/scoutbot/artifact-ask. The agent is not asked.

   Reply: one of the four reactions with a sentence of the operator's own,
   sent to the agent. A post worked in a harness session goes to that
   session by its id (POST /api/sessions/reply: typed in where it is open,
   else resumed). A Scout agent's post goes to the agent's chat. A roll-up of
   several reviewers has no one address, so it offers no reply.
   ────────────────────────────────────────────────────────────────────────── */

type Tab = "ask" | "reply";

type AskState =
  | { at: "idle" }
  | { at: "asking"; question: string }
  | { at: "answered"; question: string; answer: string }
  | { at: "failed"; question: string; why: string };

type SendState = { at: "idle" | "sending" | "sent" | "failed"; text: string };

/** Where a reply to this row goes, or why it cannot go anywhere. */
export function replyRoute(row: Pick<HomeAgentDay, "reviewers" | "conversationId" | "sessionId">, agent: Agent | null):
  { to: "session"; sessionId: string } | { to: "agent"; agent: Agent } | { to: "none"; why: string } {
  if (row.reviewers && row.reviewers.length > 1) return { to: "none", why: "This row folds several reviewers together. Open the thread to reply to one of them." };
  // a post with no conversation was worked in a harness session: reply to that exact session
  if (!row.conversationId && row.sessionId) return { to: "session", sessionId: row.sessionId };
  if (agent) return { to: "agent", agent };
  return { to: "none", why: "This update has no agent or session a reply can go to." };
}

export function AgentsFeedRespond({
  row,
  agent,
  root,
  text,
  asked,
  changed,
  loading,
}: {
  row: HomeAgentDay;
  agent: Agent | null;
  /** The workspace the update was worked in, for a session reply. */
  root: string | null;
  /** The update's full text, once read. */
  text: string | null;
  /** The ask the update answered, when the panel found one. */
  asked: string | null;
  /** Files the session changed, most recent first. */
  changed: string[];
  /** The update is still being read: asking now would ask about less. */
  loading: boolean;
}) {
  const [tab, setTab] = useState<Tab>("ask");
  const [ask, setAsk] = useState<AskState>({ at: "idle" });
  const [own, setOwn] = useState("");
  const [kind, setKind] = useState<ReactionKind | null>(null);
  const [note, setNote] = useState("");
  const [send, setSend] = useState<SendState>({ at: "idle", text: "" });
  const turn = useRef(0);
  useEffect(() => () => { turn.current = -1; }, []);

  const route = replyRoute(row, agent);
  const picked = REACTIONS.find((r) => r.kind === kind) ?? null;

  const askScoutbot = (question: string) => {
    const q = question.replace(/\s+/g, " ").trim();
    if (!q || loading) return;
    const mine = ++turn.current;
    setAsk({ at: "asking", question: q });
    const body = askRequest(
      q,
      { what: "update", path: `${row.name}'s latest update`, content: text ?? row.headline, contentKind: "text" },
      { name: row.name, harness: row.harness ?? "", state: row.status ?? "", ...(asked ? { asked } : {}), said: row.headline, files: changed.slice(0, 40) },
    );
    api<{ answer: string }>("/api/scoutbot/artifact-ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(
      (r) => { if (turn.current === mine) setAsk(r.answer ? { at: "answered", question: q, answer: r.answer } : { at: "failed", question: q, why: "Scoutbot gave no answer." }); },
      (e: unknown) => { if (turn.current === mine) setAsk({ at: "failed", question: q, why: e instanceof Error && e.message ? e.message : "Scoutbot could not answer." }); },
    );
  };

  const sendReply = () => {
    if (!kind || send.at === "sending" || route.to === "none") return;
    const headline = row.headline.length > 140 ? `${row.headline.slice(0, 139)}…` : row.headline;
    const body = reactionMessage(kind, { what: "your update", path: `"${headline}"` }, note, "Agent activity");
    setSend({ at: "sending", text: "" });
    const going = route.to === "session"
      ? replyToSession({ sessionId: route.sessionId, harness: row.harness, cwd: root, body, clientMessageId: crypto.randomUUID() })
          .then((r) => (r.delivery === "in_place" ? `Typed into the session${r.location ? ` in ${r.location}` : ""}.` : "The session was resumed with it."))
      : sendToFocusedAgentSession(route.agent, body).then(() => `Posted to ${row.name}.`);
    going.then(
      (where) => { setSend({ at: "sent", text: where }); setKind(null); setNote(""); },
      (e: unknown) => setSend({ at: "failed", text: e instanceof Error && e.message ? e.message : "Not sent." }),
    );
  };

  return (
    <footer className="afd-respond" aria-label="Respond to this update">
      <div className="afd-tabs" role="tablist" aria-label="Respond">
        <button type="button" role="tab" aria-selected={tab === "ask"} className="afd-tab" onClick={() => setTab("ask")}>Ask Scoutbot</button>
        <button type="button" role="tab" aria-selected={tab === "reply"} className="afd-tab" onClick={() => setTab("reply")}>Reply</button>
      </div>

      {tab === "ask" ? (
        <div className="afd-respondBody" role="tabpanel" aria-label="Ask Scoutbot">
          <div className="afd-questions">
            {ASK_QUESTIONS.update.map((q) => (
              <button key={q} type="button" className="afd-question" disabled={loading} aria-pressed={ask.at !== "idle" && ask.question === q} onClick={() => askScoutbot(q)}>{q}</button>
            ))}
          </div>
          <input
            className="afd-field"
            value={own}
            maxLength={400}
            placeholder="Ask your own"
            aria-label="Your question"
            onChange={(e) => setOwn(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); if (e.key === "Enter" && own.trim()) { askScoutbot(own); setOwn(""); } }}
          />
          {ask.at === "idle" ? (
            <p className="afd-hint">{loading ? "Reading the update…" : "Scoutbot reads this update and what the agent was asked. The agent is not interrupted."}</p>
          ) : (
            <div className="afd-answer" role="status">
              <p className="afd-answerAsked">{ask.question}</p>
              {ask.at === "asking" ? <p className="afd-hint">Asking…</p> : ask.at === "failed" ? <p className="afd-hint" data-state="failed">No answer: {ask.why}</p> : (
                <>
                  <p className="afd-answerText">{ask.answer}</p>
                  {route.to !== "none" ? (
                    <button type="button" className="afd-more" onClick={() => { setNote(ask.answer.slice(0, 600)); setTab("reply"); }}>Use in a reply</button>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="afd-respondBody" role="tabpanel" aria-label="Reply">
          {route.to === "none" ? <p className="afd-hint">{route.why}</p> : (
            <>
              <div className="afd-kinds" role="radiogroup" aria-label="Reaction">
                {REACTIONS.map((r) => (
                  <button key={r.kind} type="button" role="radio" aria-checked={kind === r.kind} className="afd-kind" title={r.means} onClick={() => setKind(r.kind)}>{r.label}</button>
                ))}
              </div>
              <p className="afd-hint">{picked ? `Tells the agent: ${picked.means}` : `Pick one. It goes to ${row.name}, with a sentence of yours if you add one.`}</p>
              <textarea
                className="afd-field"
                value={note}
                rows={2}
                maxLength={600}
                placeholder="Add a sentence"
                aria-label="Your sentence"
                onChange={(e) => setNote(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }}
              />
              <button type="button" className="afd-send" disabled={!kind || send.at === "sending"} onClick={sendReply}>
                {send.at === "sending" ? "Sending…" : `Send to ${row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name}`}
              </button>
            </>
          )}
          {send.at === "sent" || send.at === "failed" ? (
            <p className="afd-hint" data-state={send.at} role="status">{send.at === "sent" ? `Sent. ${send.text}` : `Not sent: ${send.text}`}</p>
          ) : null}
        </div>
      )}
    </footer>
  );
}
