import { ArrowLeft, X } from "lucide-react";
import { ChatAudioNote } from "./ChatAudioNote.tsx";
import { useEffect, useId, useRef, useState } from "react";
import type { VoiceNoteCapabilities, VoiceNoteTranscript } from "../../../shared/voice-note.ts";
import { voiceNoteAudioPayload } from "../../lib/voice-note-audio.ts";
import { connectVoiceNotes, hasVoiceNoteConnection, transcribeWithConnectedScout } from "../../lib/voice-note-connection.ts";
import "./voice-note.css";

export interface VoiceNoteTranscriber {
  afterSend?: boolean;
  capabilities(signal: AbortSignal): Promise<VoiceNoteCapabilities>;
  transcribe(payload: { audio: string }, signal: AbortSignal): Promise<VoiceNoteTranscript>;
}

export function VoiceNoteDraft({ file, transcriber, onUse, onKeepAudio, onDiscard, afterSend = false, onAfterSendChange, onReviewChange, durationHint }: {
  file: File; transcriber: VoiceNoteTranscriber; onUse: (text: string, keepAudio: boolean) => void;
  onKeepAudio: () => void; onDiscard: () => void; afterSend?: boolean;
  onAfterSendChange?: (enabled: boolean) => void; onReviewChange?: (reviewing: boolean) => void;
  durationHint?: number;
}) {
  const id = useId();
  const [reviewing, setReviewing] = useState(false);
  function review(value: boolean) { setReviewing(value); onReviewChange?.(value); }
  const [capabilities, setCapabilities] = useState<VoiceNoteCapabilities | null>(null);
  const [connected, setConnected] = useState(hasVoiceNoteConnection);
  const [phase, setPhase] = useState<"idle" | "connecting" | "transcribing" | "review">("idle");
  const [text, setText] = useState("");
  const [keepAudio, setKeepAudio] = useState(true);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void transcriber.capabilities(controller.signal).then(value => { if (!controller.signal.aborted) { setCapabilities(value); if (!value.available && value.processing === "server") onAfterSendChange?.(false); } })
      .catch(() => { if (!controller.signal.aborted) setError("Could not check transcription availability. You can still keep the audio."); });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [transcriber]);
  const busy = phase === "connecting" || phase === "transcribing";
  async function connect() {
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setPhase("connecting"); setError("");
    try { await connectVoiceNotes(controller.signal); if (!controller.signal.aborted) setConnected(true); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not connect Scout."); }
    finally { if (!controller.signal.aborted) setPhase("idle"); }
  }
  async function transcribe(local: boolean) {
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setPhase("transcribing"); setError(""); setProvider(local ? "On this device · Scout" : `${capabilities?.processing === "on-device" ? "On this device" : "Server"} · ${capabilities?.provider ?? "Transcription"}`);
    try {
      const payload = await voiceNoteAudioPayload(file);
      if (controller.signal.aborted) return;
      const result = await (local ? transcribeWithConnectedScout(payload, controller.signal) : transcriber.transcribe(payload, controller.signal));
      if (controller.signal.aborted) return;
      setText(result.text); setProvider(`${result.processing === "on-device" ? "On this device" : "Server"} · ${result.provider}`); setPhase("review");
      if (!result.text.trim()) setError("No speech was detected. You can write a transcript or keep the audio.");
    } catch (e) {
      if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Transcription failed. Your recording is still here."); setPhase("idle"); setConnected(hasVoiceNoteConnection()); }
    }
  }
  function cancel() { operation.current?.abort(); setPhase("idle"); }
  return <section className="chat-voice-note" data-review={reviewing || undefined} aria-label="Review voice note">
    <ChatAudioNote file={file} name={file.name} compact durationHint={durationHint} trailingAction={
      <button type="button" className="chat-voice-note-icon" onClick={onDiscard} aria-label="Cancel recording" title="Cancel recording"><X size={16} strokeWidth={1.8} aria-hidden /></button>
    } />
    {!reviewing ? <div className="chat-voice-note-footer">
      <span className="chat-voice-note-meta">{afterSend ? <>Transcribes after sending{capabilities?.available && capabilities.provider ? <> · {capabilities.provider}</> : null}</> : "Ready to send"}</span>
      {!transcriber.afterSend ? <button type="button" className="chat-voice-note-link" onClick={() => review(true)}>Review transcript</button> : null}
    </div> : <>
      {phase === "review" ? <div className="chat-voice-note-editor"><label htmlFor={id}>Transcript</label><textarea id={id} value={text} onChange={event => setText(event.target.value)} rows={3} maxLength={64_000} />
        <span className="chat-voice-note-meta">{provider}</span>
        <label className="chat-voice-note-choice"><input type="checkbox" checked={keepAudio} onChange={event => setKeepAudio(event.target.checked)} />Include the audio recording</label>
      </div> : busy ? <p className="chat-voice-note-meta" role="status">{phase === "connecting" ? "Approve the connection in the Scout window…" : `Transcribing · ${provider}…`}</p>
        : <div className="chat-voice-note-actions">
          {connected && capabilities?.processing !== "on-device" ? <button type="button" className="chat-voice-note-primary" onClick={() => void transcribe(true)}>Transcribe on device</button> : capabilities?.processing !== "on-device" ? <button type="button" className="chat-voice-note-secondary" onClick={() => void connect()}>Connect Scout</button> : null}
          {capabilities?.available ? <button type="button" className={connected ? "chat-voice-note-secondary" : "chat-voice-note-primary"} onClick={() => void transcribe(false)}>{capabilities.processing === "on-device" ? "Transcribe on device" : "Transcribe on server"}</button> : null}
        </div>}
      <div className="chat-voice-note-footer">
        <button type="button" className="chat-voice-note-link" onClick={() => { cancel(); review(false); }}><ArrowLeft size={12} aria-hidden />Back</button>
        {busy ? <button type="button" className="chat-voice-note-link" onClick={cancel}>Cancel transcription</button> : phase === "review" ? <button type="button" className="chat-voice-note-primary" disabled={!text.trim()} onClick={() => onUse(text.trim(), keepAudio)}>Use transcript</button> : <button type="button" className="chat-voice-note-link" onClick={() => { onKeepAudio(); cancel(); review(false); }}>Skip transcript</button>}
      </div>
    </>}
    {error ? <p className="chat-voice-note-error" role="alert">{error}</p> : null}
    {capabilities?.processing === "server" && (reviewing || !capabilities.available) ? <span className="chat-voice-note-meta">{capabilities.available ? `Server transcription sends audio to ${capabilities.provider}.` : "Server transcription is unavailable."}</span> : null}
  </section>;
}
