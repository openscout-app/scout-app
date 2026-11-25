import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type React from "react";

import { ensureAgentChat } from "../../../lib/agent-chat.ts";
import { api } from "../../../lib/api.ts";
import { focusCompanionInput, openFromCompanion } from "../../../lib/companion-host.ts";
import type { Agent, Message } from "../../../lib/types.ts";
import { placesFor, turnsFrom, type CornerThread, type CornerTurn } from "../system-corner/system-corner-model.ts";
import { DEMO_TURNS } from "./arrivals-demo.ts";
import { HarnessMark, harnessLabel } from "../../../components/HarnessMark.tsx";
import { agentChoices, rowName, type AgentChoice } from "./arrivals-model.ts";
import { DropVeil, useDroppedFiles } from "../../glass/reply-kit.tsx";
import { readClipboardMediaFiles } from "../../../lib/media-blobs.ts";
import { createClientMessageId } from "../../../lib/client-turn-transition.ts";
import { rememberProjectRoot } from "../../../lib/project-recency.ts";
import { startProjectSession } from "../../../lib/session-start.ts";
import { SessionTargetField, useSessionTarget } from "./NewSessionTarget.tsx";

/*
 * The board's in-place tools. Nothing here navigates away or reorders the
 * board: a row opens downward in place, the composer sits under the header,
 * and leaving Scout's companion is always an explicit "Conversation" / "Work".
 *
 * Demo mode keeps everything local: turns are scripted and sends echo.
 */

type Delivery = { state: "sending" | "sent" | "failed"; error?: string };

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Not sent";
}

/** Open the thread's conversation or work in Scout. */
export function openPlace(t: CornerThread, id: "conversation" | "work"): Promise<unknown> | null {
  if (id === "conversation" && t.conversationId) return openFromCompanion("thread", { workId: t.workId ?? t.conversationId, conversationId: t.conversationId });
  if (id === "work" && t.workId) return openFromCompanion("work", { workId: t.workId });
  return null;
}

function useTurns(t: CornerThread, demo: boolean, tick: number): CornerTurn[] | null {
  const [turns, setTurns] = useState<CornerTurn[] | null>(null);
  useEffect(() => {
    if (demo) { setTurns(DEMO_TURNS[t.id] ?? []); return; }
    if (!t.conversationId) { setTurns([]); return; }
    let live = true;
    api<Message[]>(`/api/messages?conversationId=${encodeURIComponent(t.conversationId)}&limit=12`)
      .then((rows) => { if (live) setTurns(turnsFrom(rows, t.task, 3)); })
      .catch(() => { if (live) setTurns([]); });
    return () => { live = false; };
  }, [t.id, t.conversationId, t.task, demo, tick]);
  return turns;
}

/** A row, opened: its last turns, a reply line, and where it lives. */
export function RowDetail({ t, demo, onDraft, extra, style, flipKey }: { t: CornerThread; demo: boolean; onDraft: (busy: boolean) => void; /** More links: Attach on the board, Detach on a plate. */ extra?: ReactNode; /** On the board: its place under its row. */ style?: CSSProperties; /** On the board: the key it glides by on a pass. */ flipKey?: string }) {
  const [tick, setTick] = useState(0);
  const turns = useTurns(t, demo, tick);
  const [echo, setEcho] = useState<CornerTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  // A native session has no Scout thread to show, so its facts lead.
  const [facts, setFacts] = useState(Boolean(t.sessionRef));
  const [placeError, setPlaceError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canReply = demo || Boolean(t.conversationId);
  const places = placesFor(t);

  useEffect(() => { onDraft(Boolean(draft.trim())); }, [draft, onDraft]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !canReply) return;
    setDraft("");
    setDelivery({ state: "sending" });
    if (demo) {
      setEcho((e) => [...e, { who: "you", text }]);
      setDelivery({ state: "sent" });
      return;
    }
    try {
      await api("/api/send", { method: "POST", body: JSON.stringify({ body: text, chatId: t.conversationId }) });
      setDelivery({ state: "sent" });
      setTick((n) => n + 1);
    } catch (cause) {
      setDraft(text);
      setDelivery({ state: "failed", error: message(cause) });
    }
  };

  const go = (id: "conversation" | "work") => {
    setPlaceError(null);
    openPlace(t, id)?.catch((cause) => setPlaceError(cause instanceof Error ? cause.message : "Could not open that place."));
  };

  const shown = [...(turns ?? []), ...echo];
  return (
    <li className="arv-detail" style={style} data-k={flipKey} onClick={(e) => e.stopPropagation()}>
      <div className="arv-detail__task">{t.task}</div>
      {facts && (
        <dl className="arv-facts">
          {(t.facts.length ? t.facts : [["State", t.state]]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      <ol className="arv-turns">
        {turns === null ? <li className="arv-note">Loading…</li>
          : shown.length === 0 ? <li className="arv-note">{canReply ? "No replies yet" : t.sessionRef ? "Started outside Scout. Its turns are in the session itself." : "No conversation for this work"}</li>
          : shown.map((x, i) => <li key={i} className={`is-${x.who}`}>{x.text}</li>)}
        {delivery && delivery.state !== "sent" && (
          <li className={`arv-note${delivery.state === "failed" ? " is-error" : ""}`}>{delivery.state === "sending" ? "Sending…" : `Not sent · ${delivery.error}`}</li>
        )}
      </ol>
      {canReply && (
        <input
          ref={input}
          className="arv-input"
          value={draft}
          placeholder={`Reply to ${rowName(t)}`}
          onFocus={focusCompanionInput}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void send(); }
            if (e.key === "o" && e.metaKey && places[0]) { e.preventDefault(); go(places[0].id); }
          }}
        />
      )}
      <div className="arv-links">
        {places.map((p, i) => (
          <button key={p.id} type="button" className={i === 0 ? "is-primary" : undefined} title={p.detail} onClick={() => go(p.id)}>
            {p.label}{i === 0 && <kbd>⌘O</kbd>}
          </button>
        ))}
        <button type="button" className={facts ? "is-on" : undefined} onClick={() => setFacts((f) => !f)}>{facts ? "Less" : "What's going on"}</button>
        {extra}
        {demo && places.length === 0 && <span className="arv-note">Demo: Conversation and Work open Scout in the app</span>}
      </div>
      {placeError && <div className="arv-error">{placeError}</div>}
    </li>
  );
}

/** Project context stays beside the agent it identifies. */
function projectOf(a: Pick<Agent, "project" | "projectRoot" | "cwd">): string {
  return a.project || (a.projectRoot ?? a.cwd ?? "").split("/").filter(Boolean).at(-1) || "Elsewhere";
}

type Pick_ = AgentChoice & { project: string; harness: string | null };

type Destination = "session" | "agent";

/**
 * A destination and a message. A new session leads: a project, then the
 * harness, model and thinking level, with no agent there yet. Agent keeps the
 * recipient picker: agent names lead, project and harness disambiguate them,
 * opening from a project ranks its agents first, and each selected agent gets
 * its own conversation.
 */
export function NewConversation({ demo, crew, project: opensOn = null, files: handed = null, panelHitId, panelClassName, onClose, onDraft }: {
  demo: boolean;
  crew: CornerThread[];
  /** The project it opens on (the companion's New ask in …), when an agent there can take it. */
  project?: string | null;
  /** Files dropped on the board's New conversation button; each new batch attaches once. */
  files?: { batch: number; files: File[] } | null;
  /** The runtime panel's hit region: it opens outside the board, and the screen edge must still take its clicks. */
  panelHitId?: string;
  /** The runtime panel's look, for the same reason. */
  panelClassName?: string;
  onClose: () => void;
  onDraft: (busy: boolean) => void;
}) {
  const [dest, setDest] = useState<Destination>("session");
  const [agents, setAgents] = useState<Pick_[] | null>(null);
  const [agentRows, setAgentRows] = useState<Agent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [to, setTo] = useState<Pick_[]>([]);
  const [query, setQuery] = useState("");
  const [toFocused, setToFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "sent"; labels: string[]; chatId: string | null; session?: boolean } | { kind: "failed"; error: string }>({ kind: "idle" });
  const toInput = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const pickerId = useId();
  const target = useSessionTarget({ demo, agents: agentRows, opensOn });
  const sending = useRef(false);
  const drop = useDroppedFiles();
  const attached = useRef<number | null>(null);
  useEffect(() => {
    if (!handed || attached.current === handed.batch) return;
    attached.current = handed.batch;
    if (demo) return;
    drop.add(handed.files);
  }, [handed?.batch]);

  useEffect(() => {
    let live = true;
    const handles = crew.map((t) => t.handle);
    const take = (rows: Array<Agent | { id: string; name: string; project?: string | null; projectRoot?: string | null; cwd?: string | null; harness?: string | null }>) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      const choices = agentChoices(rows as Agent[], handles).map((c) => {
        const a = byId.get(c.id)!;
        return { ...c, project: projectOf(a as Agent), harness: (a as Agent).harness ?? null };
      });
      setAgents(choices);
      setAgentRows(rows as Agent[]);
    };
    if (demo) {
      take(crew.map((t) => ({ id: t.id, name: t.handle, project: t.project ?? "openscout", harness: t.harness ?? null })));
      return;
    }
    api<Agent[]>("/api/agents?detail=summary&limit=100")
      .then((rows) => { if (live) take(rows); })
      .catch(() => { if (live) { setAgents([]); setLoadError("Couldn't load agents. Close and try again."); } });
    return () => { live = false; };
  }, [demo, crew.length]);

  // A session opens with its project chosen, so the message is next; an agent is found first.
  useEffect(() => { focusCompanionInput(); requestAnimationFrame(() => (dest === "session" ? body.current : toInput.current)?.focus()); }, [dest]);
  useEffect(() => { onDraft(Boolean(draft.trim() || to.length || drop.files.length)); }, [draft, to.length, drop.files.length, onDraft]);

  const q = query.trim().toLowerCase();
  const suggestions = (agents ?? []).filter((a) => !to.some((t) => t.id === a.id)
    && (!q || [a.label, a.name, a.project, a.harness ?? ""].some((part) => part.toLowerCase().includes(q))))
    .sort((a, b) => Number(b.project === opensOn) - Number(a.project === opensOn)).slice(0, 6);
  const activeCursor = Math.max(0, Math.min(cursor, suggestions.length - 1));
  const showSuggestions = toFocused && Boolean(query || !to.length);
  useEffect(() => {
    if (showSuggestions) document.getElementById(`${pickerId}-option-${activeCursor}`)?.scrollIntoView({ block: "nearest" });
  }, [showSuggestions, activeCursor, pickerId]);
  const add = (a: Pick_) => { setTo((list) => [...list, a]); setQuery(""); setCursor(0); };

  const ready = dest === "session" ? Boolean(target.project && target.runnable) : to.length > 0;

  const start = async () => {
    const ask = draft.trim();
    const attachments = drop.files;
    const project = target.project;
    if (!project || !target.runnable || drop.uploading || !(ask || attachments.length) || sending.current) return;
    sending.current = true;
    setState({ kind: "sending" });
    const label = project.title;
    if (demo) { setState({ kind: "sent", labels: [label], chatId: null, session: true }); setDraft(""); sending.current = false; return; }
    try {
      const { harness, model, effort } = target.runtime;
      const result = await startProjectSession({
        projectPath: project.root,
        harness,
        ...(model ? { model } : {}),
        ...(effort ? { reasoningEffort: effort } : {}),
        instructions: ask || "Shared capture for context.",
        ...(attachments.length ? { attachments } : {}),
        clientMessageId: createClientMessageId(),
      });
      rememberProjectRoot(project.root);
      setDraft(""); drop.clear();
      setState({ kind: "sent", labels: [label], chatId: result.conversationId ?? null, session: true });
    } catch (cause) {
      setState({ kind: "failed", error: message(cause) });
    } finally {
      sending.current = false;
    }
  };

  const send = async () => {
    if (dest === "session") return start();
    const ask = draft.trim();
    const attachments = drop.files;
    if (!to.length || drop.uploading || !(ask || attachments.length) || sending.current) return;
    const text = ask;
    sending.current = true;
    setState({ kind: "sending" });
    if (demo) { setState({ kind: "sent", labels: to.map((a) => a.label), chatId: null }); setDraft(""); sending.current = false; return; }
    try {
      let last: string | null = null;
      for (const agent of to) {
        const chatId = await ensureAgentChat({
          id: agent.id, name: agent.name, conversationId: agent.conversationId,
          projectRoot: agent.projectRoot, cwd: agent.cwd, selector: agent.selector,
        });
        await api("/api/send", { method: "POST", body: JSON.stringify({ body: text, chatId, ...(attachments.length ? { attachments } : {}) }) });
        last = chatId;
      }
      setDraft(""); drop.clear();
      setState({ kind: "sent", labels: to.map((a) => a.label), chatId: to.length === 1 ? last : null });
    } catch (cause) {
      setState({ kind: "failed", error: message(cause) });
    } finally {
      sending.current = false;
    }
  };

  if (state.kind === "sent") {
    return (
      <div className="arv-new is-sent">
        <span>{state.session ? "Started in" : "Sent to"} <b>{state.labels.join(", ")}</b>. {state.labels.length > 1 ? "Each shows on the board when it starts." : "It shows on the board when it starts."}</span>
        <span className="arv-links">
          {state.chatId && (
            <button type="button" onClick={() => void openFromCompanion("thread", { workId: state.chatId!, conversationId: state.chatId! }).catch(() => {})}>Conversation</button>
          )}
          <button type="button" onClick={() => setState({ kind: "idle" })}>Another</button>
          <button type="button" onClick={onClose}>Done</button>
        </span>
      </div>
    );
  }

  const sendKeys = (e: React.KeyboardEvent) => { if (e.key === "Enter" && e.metaKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } };
  return (
    <form
      className={`arv-new arv-compose${drop.dropping ? " is-dropping" : ""}`}
      onSubmit={(e) => { e.preventDefault(); void send(); }}
      onKeyDown={sendKeys}
      onPaste={(e) => {
        // A copied screenshot or file attaches; copied text pastes as usual.
        const pasted = readClipboardMediaFiles(e.clipboardData);
        if (!pasted.length || demo) return;
        e.preventDefault();
        drop.add(pasted);
      }}
      {...drop.handlers}
    >
      {drop.dropping && <DropVeil />}
      <div className="arv-compose__dest arv-seg" role="group" aria-label="Start">
        {([["session", "New session"], ["agent", "Agent"]] as const).map(([value, text]) => (
          <button key={value} type="button" className={dest === value ? "is-on" : undefined} aria-pressed={dest === value} disabled={state.kind === "sending"} onClick={() => setDest(value)}>{text}</button>
        ))}
      </div>
      {dest === "session" ? <SessionTargetField target={target} disabled={state.kind === "sending"} panelHitId={panelHitId} panelClassName={panelClassName} /> : <>
      <div className="arv-compose__field" onClick={() => { toInput.current?.focus(); setToFocused(true); }}>
        <label className="arv-compose__label" htmlFor={pickerId}>Message to</label>
        <span className="arv-compose__recipients">
          {to.map((a) => (
            <span key={a.id} className="arv-compose__chip">
              {a.harness && <span className="arv-coin"><HarnessMark harness={a.harness} size={9} title={null} /></span>}
              <b>{a.label}</b>
              <span className="arv-compose__project">{a.project}</span>
              <button type="button" aria-label={`Remove ${a.label} in ${a.project}`} disabled={state.kind === "sending"} onClick={() => setTo((list) => list.filter((x) => x.id !== a.id))}>×</button>
            </span>
          ))}
          <input
            ref={toInput}
            id={pickerId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls={`${pickerId}-options`}
            aria-activedescendant={showSuggestions && suggestions[activeCursor] ? `${pickerId}-option-${activeCursor}` : undefined}
            disabled={state.kind === "sending"}
            value={query}
            placeholder={to.length ? "Add another agent…" : "Find an agent or project…"}
            onFocus={() => { focusCompanionInput(); setToFocused(true); }}
            onBlur={() => setToFocused(false)}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); setToFocused(true); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setToFocused(true); setCursor((c) => Math.min(c + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === "Enter" && !e.metaKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (showSuggestions && suggestions[activeCursor]) add(suggestions[activeCursor]!); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setToFocused(false); }
              else if (e.key === "Backspace" && !query && to.length) setTo((list) => list.slice(0, -1));
            }}
          />
        </span>
        {showSuggestions && suggestions.length > 0 && (
          <ul className="arv-compose__suggest" id={`${pickerId}-options`} role="listbox" aria-label="Agents">
            {suggestions.map((a, i) => (
              <li key={a.id} role="presentation">
                <button type="button" role="option" id={`${pickerId}-option-${i}`} aria-selected={i === activeCursor} tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => add(a)} onMouseEnter={() => setCursor(i)}>
                {a.harness && <span className="arv-coin"><HarnessMark harness={a.harness} size={9} title={null} /></span>}
                <span className="arv-compose__destination"><b>{a.label}</b><small>{a.project}{a.harness ? ` · ${harnessLabel(a.harness)}` : ""}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {showSuggestions && !suggestions.length && <div className="arv-compose__empty" role={loadError ? "alert" : "status"}>{loadError ?? (agents === null ? "Loading agents…" : agents.length === 0 ? "No agents available" : q ? "No matching agents" : "All available agents selected")}</div>}
      </>}
      <textarea ref={body} className="arv-compose__body" aria-label="Message" rows={4} value={draft} disabled={state.kind === "sending"} placeholder={dest === "agent" && to.length === 1 ? `Message ${to[0]!.label}…` : "What would you like to work on?"} onFocus={focusCompanionInput} onChange={(e) => setDraft(e.target.value)} />
      {(drop.files.length > 0 || drop.uploading) && (
        <div className="arv-compose__files">
          {drop.files.map((file) => (
            <button key={file.id} type="button" className="arv-compose__file" title={`Remove ${file.fileName ?? "file"}`} onClick={() => drop.remove(file.id)}>
              {file.mediaType.startsWith("image/") && <img src={file.url} alt="" />}
              <span>{file.fileName ?? "file"}</span>
              <i aria-hidden>×</i>
            </button>
          ))}
          {drop.uploading && <span className="arv-compose__file is-busy">Attaching…</span>}
        </div>
      )}
      <footer className="arv-compose__foot">
        <span>{dest === "agent" && to.length > 1 ? `Separate conversation with each of ${to.length} agents` : ""}</span>
        <button type="submit" className="arv-compose__send" disabled={state.kind === "sending" || drop.uploading || !ready || !(draft.trim() || drop.files.length)}>{state.kind === "sending" ? (dest === "session" ? "Starting…" : "Sending…") : dest === "session" ? "Start" : "Send"} <kbd>⌘↩</kbd></button>
      </footer>
      {state.kind === "failed" && <div className="arv-error">{dest === "session" ? "Not started" : "Not sent"} · {state.error}</div>}
      {drop.error && <div className="arv-error">{drop.error}</div>}
    </form>
  );
}
