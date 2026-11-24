/*
 * The box for writing to an agent from a post: Continue, Reply, Ask, React,
 * and Home's Steer use it. The companion's reply line (TapInPanel.tsx) is the
 * same shape: a field that grows with what is typed, and the mic and a round
 * send inside its right end. The box's radius is the buttons' radius plus the
 * inset, so at one line it is a pill and the curves stay concentric.
 *
 *   Return        sends
 *   Shift Return  starts a new line
 *   Escape        leaves the box (onEscape)
 *
 * While the mic takes, a band across the top of the box draws its levels
 * beside the words heard so far; what is said is added to the draft. The
 * stream's keys stay out of the box while it has focus.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { DictationMic, type MicStatus } from "../../components/DictationMic.tsx";
import { VoiceWaveform } from "../../components/MessageComposer/VoiceWaveform.tsx";
import "./reply-box.css";

/** The field's tallest: six lines, then it scrolls. */
const MAX_LINES = 6;

export function ReplyBox({ value, onChange, onSend, onEscape, placeholder, label, maxLength, canSend, fieldRef, mic = true }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onEscape?: () => void;
  placeholder: string;
  label: string;
  maxLength: number;
  /** Whether Send is live; an empty box never sends. */
  canSend: boolean;
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** Offer dictation. The mic shows its own state when voice is unavailable or needs permission. */
  mic?: boolean;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const [take, setTake] = useState<MicStatus | null>(null);
  const [micNote, setMicNote] = useState<string | null>(null);
  const listening = take !== null && (take.state === "starting" || take.state === "recording" || take.state === "processing");

  // The field is as tall as its text, a line at a time, up to MAX_LINES; past that it scrolls.
  useLayoutEffect(() => {
    const field = own.current;
    if (!field) return;
    field.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(field).lineHeight) || 20;
    field.style.height = `${Math.min(field.scrollHeight, Math.ceil(line * MAX_LINES))}px`;
  }, [value]);

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onEscape?.(); return; }
    // A Return that ends an IME composition belongs to it.
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  const setRef = (node: HTMLTextAreaElement | null) => {
    own.current = node;
    if (typeof fieldRef === "function") fieldRef(node);
    else if (fieldRef) (fieldRef as { current: HTMLTextAreaElement | null }).current = node;
  };

  return (
    <div className="rb" data-ready={canSend || undefined} data-listening={listening || undefined}>
      <div className="rb-box">
        {listening && take ? (
          <span className="rb-voice" role="status" aria-live="polite">
            <VoiceWaveform className="rb-wave" samples={take.levels} active={take.state === "recording"} processing={take.state === "processing"} />
            <span className="rb-heard">{heardLine(take)}</span>
          </span>
        ) : null}
        <textarea
          ref={setRef}
          className="rb-field"
          rows={1}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={keys}
        />
        <span className="rb-tools">
          {mic ? (
            <DictationMic
              className="rb-mic"
              onAppend={(said) => onChange(value.trim() ? `${value.trimEnd()} ${said}` : said)}
              onError={(message) => setMicNote(message)}
              onStatus={(status) => { setMicNote(status.message); setTake(status); }}
            />
          ) : null}
          <button type="button" className="rb-send" aria-label="Send" title="Send · Return" disabled={!canSend} onClick={onSend}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
            </svg>
          </button>
        </span>
      </div>
      {micNote && !listening ? <p className="rb-note" role="status">{micNote}</p> : null}
    </div>
  );
}

/** What the band says during a take: the words so far (their tail, when long), else what it is doing. */
function heardLine(take: MicStatus): string {
  const said = take.partial.trim();
  if (said) return said.length > 90 ? `…${said.slice(-90)}` : said;
  return take.state === "processing" ? "Finishing the transcript…" : take.state === "starting" ? "Starting…" : "Listening…";
}
