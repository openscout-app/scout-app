/**
 * An ask's words and its reply, shared by Home's Back to you rows and the
 * Inbox item so both read and answer the same way.
 *
 * AskWords: the ask's parts (ask-text.ts) with each link as a short chip.
 * A web link opens in a new tab; a file link (which a web page cannot open)
 * copies its path.
 *
 * AskReply: one line for an answer in the operator's own words, with the
 * composer's dictation mic (DictationMic, the same recognizer the chat
 * composer uses). The text goes through the same path as the ask's option
 * buttons: `onSend` is useRequestActions' `answer`.
 */
import { useState, type FormEvent } from "react";
import { DictationMic, type MicStatus } from "../../components/DictationMic.tsx";
import type { AskLink, AskPart } from "./ask-text.ts";
import "./ask-parts.css";

function FileChip({ link }: { link: AskLink }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(link.full).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };
  return (
    <button type="button" className="ask-chip" data-kind="file" title={`${link.full}\nCopy the path`} onClick={copy}>
      {copied ? "Path copied" : link.label}
    </button>
  );
}

export function AskWords({ parts }: { parts: readonly AskPart[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if ("text" in part) return <span key={index}>{part.text}</span>;
        const { link } = part;
        if (link.kind === "file") return <FileChip key={index} link={link} />;
        return (
          <a key={index} className="ask-chip" data-kind={link.kind} href={link.href} target="_blank" rel="noreferrer" title={link.full}>
            {link.label}
          </a>
        );
      })}
    </>
  );
}

export function AskReply({ onSend, disabled, label }: {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
  /** Who the reply goes to, for the field's accessible name. */
  label: string;
}) {
  const [draft, setDraft] = useState("");
  const [mic, setMic] = useState<MicStatus | null>(null);
  const listening = mic?.state === "recording" || mic?.state === "starting";
  const ready = draft.trim().length > 0 && !disabled;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    void onSend(draft.trim());
  };
  const heard = listening && mic?.partial.trim() ? mic.partial.trim() : null;
  return (
    <form className="ask-reply" onSubmit={submit} data-listening={listening || undefined}>
      <input
        className="ask-reply__field"
        value={draft}
        disabled={disabled}
        placeholder={heard ?? (listening ? "Listening…" : mic?.state === "processing" ? "Transcribing…" : "Reply")}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
      />
      <DictationMic
        className="ask-reply__mic"
        disabled={disabled}
        onStatus={setMic}
        onAppend={(text) => setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text))}
      />
      <button type="submit" className="ask-reply__send" aria-label="Send reply" disabled={!ready}>
        <svg viewBox="0 0 16 16" aria-hidden><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg>
      </button>
      {mic?.tone === "error" && mic.message ? <p className="ask-reply__note" role="status">{mic.message}</p> : null}
    </form>
  );
}
