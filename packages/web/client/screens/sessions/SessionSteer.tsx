import { useEffect, useId, useRef } from "react";
import { isComposerSendShortcut, type ComposeShortcutEvent } from "../../lib/compose-shortcuts.ts";
import { dataTransferMayContainFiles, readTransferredFiles } from "../../lib/media-blobs.ts";
import type { ReplyFile } from "../../lib/reply-files.ts";
import { SESSION_STEER_MAX_LENGTH, type SessionSteerAuditEntry } from "../../../shared/api/session-steer.ts";

import { recallPrompt, type PromptRecall } from "./session-interactions.ts";

export type PendingSessionSteer = { id: string; text: string; duringTurn: boolean; observedIds: string[] };
export function unobservedSteers(pending: PendingSessionSteer[], prompts: { id: string; text: string }[]) {
  const matched = new Set<string>();
  return pending.filter((entry) => {
    const prompt = prompts.find((p) => !matched.has(p.id) && !entry.observedIds.includes(p.id) && p.text.trim() === entry.text.trim());
    if (prompt) matched.add(prompt.id);
    return !prompt;
  });
}
export function steerShortcut(event: ComposeShortcutEvent & { preventDefault(): void }, send: () => void) {
  if (isComposerSendShortcut(event, true)) { event.preventDefault(); send(); }
}

/** Codex's composer shape; no model, queue or branch controls until this
 * exact-session surface has a backing operation for them. Files have one:
 * on this host they go in as their paths (reply-files.ts). */
export type SessionReadOnly = { title: string; detail: string };

/** Files dropped on the session or pasted into its line, waiting to go with the reply. */
export type SessionReplyFiles = {
  files: readonly ReplyFile[];
  attaching: number;
  /** Why the last drop or paste held nothing (a refusal, or a session on another host). */
  note?: string | null;
  remove: (id: string) => void;
  paste: (files: File[]) => void;
};

/** A final refusal reads as one plain line; a dead text box invites typing that can't go anywhere. */
const READ_ONLY_TITLES: Record<string, string> = {
  not_live: "No terminal to send to",
  machine_unverified: "On another machine",
  remote_refused: "On another machine",
  native_app_refused: "Held by the desktop app",
  ambiguous: "Open in more than one place",
  session_blocked: "Waiting on an approval",
  background_copy: "Scout's background run",
  self_target: "Runs this page",
  invalid_session: "Not typed into from here",
};
const READ_ONLY_DETAILS: Record<string, string> = {
  not_live: "Messages here are typed into the session's own terminal, and no terminal holds this one. Scout won't restart it on its own.",
  background_copy: "Scout started this session in a terminal of its own to work on a task. Nobody works in that terminal, so Scout doesn't type into it.",
  self_target: "This session runs the web server that shows this page, so Scout doesn't type into it.",
  native_app_refused: "Reply to it in the desktop app.",
  invalid_session: "This reference is not a native session, so this page has nothing to type into.",
};
/** Retrying states keep the composer; everything else the server refuses is final for this binding. */
const TRANSIENT_CODES = new Set(["unavailable", "probe_failed", "busy", "binding_changed", "delivery_unconfirmed", "audit_unavailable"]);
/** `resumable`: nothing holds the session and it is on this host, so the composer stays and a reply resumes it (sessionResumable). */
export function sessionReadOnly(blockedReason: string | null | undefined, live: { available: boolean; code?: string; reason: string } | null | undefined, resumable = false): SessionReadOnly | null {
  if (blockedReason) return { title: /machine/iu.test(blockedReason) ? "On another machine" : "Read only", detail: blockedReason };
  if (resumable) return null;
  if (!live || live.available || !live.code || TRANSIENT_CODES.has(live.code)) return null;
  return { title: READ_ONLY_TITLES[live.code] ?? "Can't send to this session", detail: READ_ONLY_DETAILS[live.code] ?? live.reason };
}

export function SessionSteerComposer({ draft, onChange, submit, interrupt, working, busy, sending = busy, available, reason, readOnly, error, status, pending = [], placeholder = "Ask for follow-up changes", note = null, files = null, recallHistory, focusDraft = 0 }: {
  draft: string; onChange: (value: string) => void; submit: () => void; interrupt?: (() => void) | null;
  working: boolean; busy: boolean; sending?: boolean; available: boolean; reason: string; readOnly?: SessionReadOnly | null;
  error?: string | null; status?: string | null; pending?: PendingSessionSteer[];
  placeholder?: string; note?: string | null; files?: SessionReplyFiles | null;
  recallHistory?: string[]; focusDraft?: number;
}) {
  const reasonId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recalled = useRef<PromptRecall>(null);
  const seenFocus = useRef(focusDraft);
  useEffect(() => { if (seenFocus.current !== focusDraft) { seenFocus.current = focusDraft; inputRef.current?.focus(); } }, [focusDraft]);
  useEffect(() => { recalled.current = null; }, [recallHistory === undefined]);
  const held = files?.files ?? [];
  const attaching = files?.attaching ?? 0;
  const canSend = available && !busy && !attaching && (!!draft.trim() || held.length > 0) && draft.length <= SESSION_STEER_MAX_LENGTH;
  return <div className="s-session-composer">
    {pending.length > 0 && <div className="s-session-pending" aria-label="Sent messages" aria-live="polite">
      {pending.map((entry) => <div key={entry.id} className="s-session-pending-message"><p>{entry.text}</p>
        <small title="The input was sent to the session. It has not appeared in the transcript yet.">Sent to session{entry.duringTurn ? " · during this turn" : ""}</small></div>)}
    </div>}
    {readOnly ? <div className="s-session-readonly" role="status">
      <span className="s-session-readonly-title">{readOnly.title}</span>
      <span className="s-session-readonly-detail">{readOnly.detail}</span>
    </div> : <form className="s-session-composer-box" onSubmit={(event) => { event.preventDefault(); if (canSend) submit(); }} aria-label="Message this session" aria-busy={busy}>
      {(held.length > 0 || attaching > 0) && <ul className="s-session-files" aria-label="Files to send">
        {held.map((file) => <li key={file.id}>
          <span title={file.localPath ?? file.fileName}>{file.fileName ?? "File"}</span>
          <button type="button" aria-label={`Remove ${file.fileName ?? "file"}`} title="Remove" disabled={busy} onClick={() => files?.remove(file.id)}>
            <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" /></svg>
          </button>
        </li>)}
        {attaching > 0 && <li className="is-attaching" role="status">Attaching…</li>}
      </ul>}
      <textarea ref={inputRef} aria-label="Message" aria-describedby={!available ? reasonId : undefined}
        placeholder={placeholder} rows={2} maxLength={SESSION_STEER_MAX_LENGTH}
        value={draft} disabled={!available || busy} onChange={(event) => { recalled.current = null; onChange(event.target.value); }}
        onPaste={(event) => {
          if (!files || !dataTransferMayContainFiles(event.clipboardData)) return;
          const pasted = readTransferredFiles(event.clipboardData);
          if (!pasted.length) return;
          event.preventDefault();
          files.paste(pasted);
        }}
        onKeyDown={(event) => {
          const input = event.currentTarget;
          const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : null;
          const edge = direction === -1 ? input.selectionStart === 0 : input.selectionEnd === draft.length;
          if (recallHistory && direction && edge && input.selectionStart === input.selectionEnd && held.length === 0 && !attaching
            && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing) {
            const next = recallPrompt(recallHistory, draft, recalled.current, direction);
            if (next) {
              event.preventDefault(); recalled.current = next.text ? next : null; onChange(next.text);
              requestAnimationFrame(() => input.setSelectionRange(direction === -1 ? 0 : next.text.length, direction === -1 ? 0 : next.text.length));
              return;
            }
          }
          steerShortcut(event, () => { if (canSend) submit(); });
        }} />
      <div className="s-session-composer-tools">
        {recallHistory && recallHistory.length > 0 && !draft && held.length === 0 && <span className="s-session-recall-hint">↑ Recall prompt</span>}
        {working && <button type="submit" className="s-session-steer-action" title="Send input to this session while it works" disabled={!canSend}>{sending ? "Sending…" : "Send"}</button>}
        {working ? interrupt && <button type="button" className="s-session-send" aria-label="Stop" title="Stop" disabled={busy} onClick={interrupt}>
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
        </button> : <button type="submit" className="s-session-send" aria-label="Send" title="Send" disabled={!canSend}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" /></svg>
        </button>}
      </div>
    </form>}
    {!available && !readOnly && <p className="s-session-steer-reason" id={reasonId} role="status" title={reason}>{reason}</p>}
    {available && !readOnly && note && <p className="s-session-steer-note">{note}</p>}
    {!readOnly && files?.note && <p className="s-session-steer-note" role="status">{files.note}</p>}
    {error && <p role="alert">{error} Your draft has been kept.</p>}
    {status && <p role="status">{status}</p>}
  </div>;
}

export function SessionSteeredList({ entries, error, quiet = false }: { entries: SessionSteerAuditEntry[] | null; error?: string | null; quiet?: boolean }) {
  // quiet: the section only appears once something was sent (Sharp's Ledger rail)
  if (quiet && !error && (!entries || entries.length === 0)) return null;
  return <section className="s-session-steered" aria-label="Sent"><h3>Sent</h3>
    {error ? <p role="status">{error}</p> : !entries ? <p>Loading…</p> : entries.length === 0 ? <p>Nothing sent yet.</p> : <ol>
      {entries.map((entry) => <li key={entry.id}><details><summary>
        <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        <span>{entry.outcome === "accepted" ? "Delivered" : entry.outcome === "unconfirmed" ? "Unconfirmed" : "Refused"} · {entry.operator}</span>
      </summary><p>{entry.reason}</p><dl>
        <dt>Machine</dt><dd>{entry.machine ?? "Unverified"} · {entry.serverHost}</dd>
        <dt>Target</dt><dd>{entry.target?.host === "broker" ? `Broker · ${entry.target.transport} · ${entry.target.endpointId}` : entry.target ? `${entry.target.host} ${entry.target.address} · PID ${entry.target.pid}` : "Unbound"}</dd>
        <dt>Text</dt><dd>{entry.textLength} characters</dd>
        <dt>Text SHA-256</dt><dd><code>{entry.textSha256}</code></dd>
      </dl>{!!entry.duplicateOutcomes && <p role="status">Duplicate outcome flagged; the first outcome is shown.</p>}</details></li>)}
    </ol>}
  </section>;
}
