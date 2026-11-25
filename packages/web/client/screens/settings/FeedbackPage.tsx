import { useEffect, useRef, useState } from "react";
import { feedbackRequest } from "./feedback-request.ts";
import { hostSettingsAvailable } from "../../lib/host-settings-bridge.ts";
import type { FeedbackPreview, FeedbackResult } from "../../../shared/api/feedback.ts";
import "./feedback.css";

export function FeedbackPage() {
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<FeedbackPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (preview) sendButton.current?.focus(); }, [preview]);

  const act = async (send: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setSaved(false);
    try {
      if (!send) {
        const draft = await feedbackRequest<FeedbackPreview>("preview", { note, client: hostSettingsAvailable() ? "macos" : "web" });
        if (alive.current) setPreview(draft);
      } else if (preview) {
        const result = await feedbackRequest<FeedbackResult>("send", { token: preview.token });
        if (alive.current) { if (result.status === "uploaded") { setSent(result.id); setNote(""); setPreview(null); } else setSaved(true); }
      }
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Feedback could not be sent. Try again."); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const edit = () => { setPreview(null); setError(null); setSaved(false); requestAnimationFrame(() => noteInput.current?.focus()); };

  return <section className="sq-feedback" aria-label="Send feedback">
    <p className="sq-feedback-intro">A bug, a rough edge, or something Scout could do better.</p>
    <p className="sq-note">Sent privately to the Scout team. Only your note and basic app/system details are included. No logs, chats, files, or project data are collected.</p>
    {sent ? <div role="status" className="sq-feedback-result"><p>Feedback sent. Thank you.</p><p className="sq-note">Reference: {sent}</p><button type="button" className="sq-button" onClick={() => { setSent(null); requestAnimationFrame(() => noteInput.current?.focus()); }}>Write another note</button></div> : <form onSubmit={event => { event.preventDefault(); void act(Boolean(preview)); }}>
      {preview ? <>
        <h2 className="sq-label">Review your feedback</h2>
        <p className="sq-feedback-note">{preview.report.context.userDescription}</p>
        {preview.report.context.userDescription !== note.trim() ? <p className="sq-note">Privacy checks changed the note. Review it before sending.</p> : null}
        <details className="sq-feedback-details"><summary>Included app/system details</summary><dl>
          <dt>Scout runtime</dt><dd>{preview.report.apps.collector?.version ?? "Not reported"}</dd>
          <dt>Host system</dt><dd>{preview.report.system.os} {preview.report.system.osVersion}</dd>
          <dt>Architecture</dt><dd>{preview.report.system.chip}</dd><dt>Memory</dt><dd>{formatMemory(preview.report.system.memory)}</dd>
        </dl><details><summary>Full report</summary><pre>{JSON.stringify(preview.report, null, 2)}</pre></details></details>
      </> : <><label htmlFor="scout-feedback-note">Your feedback</label><textarea ref={noteInput} id="scout-feedback-note" className="sq-textarea" rows={7} maxLength={8000} value={note} onChange={event => setNote(event.target.value)} placeholder="What happened, or what would make Scout better?" disabled={busy} required /><p className="sq-note">Review the redacted note and included details before sending.</p></>}
      {error ? <p className="sq-note" data-tone="error" role="alert">{error}</p> : null}
      {saved ? <p className="sq-note" data-tone="error" role="alert">Not sent. A private copy was saved on this host. Your note is still here; try sending again when the connection is back.</p> : null}
      <div className="sq-feedback-actions">{preview ? <button type="button" className="sq-button" onClick={edit} disabled={busy}>Edit note</button> : null}<button ref={sendButton} type="submit" className="sq-button" data-primary disabled={busy || (!preview && !note.trim())}>{busy ? preview ? "Sending…" : "Preparing…" : preview ? "Send feedback" : "Review feedback"}</button></div>
    </form>}
  </section>;
}

function formatMemory(raw: string) { const bytes = Number(raw); return Number.isFinite(bytes) && bytes > 0 ? `${Math.round(bytes / 1024 ** 3)} GB` : raw; }
