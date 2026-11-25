import { Download, Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { VoiceNoteTranscription } from "../../../shared/voice-note-transcription.ts";
import "./voice-note.css";

export function audioClock(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function ChatAudioNote({ href, file, name, transcription, compact = false, trailingAction, durationHint }: {
  href?: string; file?: File; name: string; transcription?: VoiceNoteTranscription; compact?: boolean; trailingAction?: ReactNode;
  durationHint?: number;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [source, setSource] = useState(href);
  const [playing, setPlaying] = useState(false), [waiting, setWaiting] = useState(false);
  const hint = Number.isFinite(durationHint) && durationHint! > 0 ? durationHint! : 0;
  const [elapsed, setElapsed] = useState(0), [duration, setDuration] = useState(hint), [error, setError] = useState("");
  useEffect(() => {
    setElapsed(0); setDuration(hint); setError(""); setPlaying(false); setWaiting(false);
    if (!file) { setSource(href); return; }
    const url = URL.createObjectURL(file); setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file, href, hint]);
  const readDuration = () => { setError(""); if (audio.current && Number.isFinite(audio.current.duration) && audio.current.duration > 0) setDuration(audio.current.duration); };
  const unavailable = compact ? "Preview unavailable. Recording is still attached." : "Audio unavailable. You can download the recording.";
  async function toggle() {
    const media = audio.current; if (!media) return;
    setError("");
    if (!media.paused) { media.pause(); return; }
    if (media.ended) media.currentTime = 0;
    try { setWaiting(true); await media.play(); } catch { setWaiting(false); setError(unavailable); }
  }
  const pending = transcription?.status === "queued" || transcription?.status === "processing";
  return <div className="chat-audio-note" data-compact={compact || undefined} aria-label="Voice note" title={name}>
    <div className="chat-audio-row">
      <audio ref={audio} src={source} preload="metadata" hidden
        onLoadedMetadata={readDuration} onDurationChange={readDuration}
        onTimeUpdate={() => setElapsed(audio.current?.currentTime ?? 0)}
        onPlay={() => { setPlaying(true); setWaiting(false); }} onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)} onCanPlay={() => { setWaiting(false); setError(""); }}
        onEnded={() => { setPlaying(false); setWaiting(false); if (audio.current) setDuration(audio.current.currentTime); }}
        onError={() => { if (source) { setWaiting(false); setPlaying(false); setError(unavailable); } }} />
      <button type="button" className="chat-audio-play" onClick={() => void toggle()} disabled={!source} aria-label={playing ? "Pause voice note" : "Play voice note"}>
        {waiting ? <Loader2 className="chat-audio-spinner" size={14} aria-hidden /> : playing ? <Pause size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
      </button>
      <input className="chat-audio-seek" type="range" min={0} max={duration || 1} step={0.1}
        value={duration ? Math.min(elapsed, duration) : 0} disabled={!duration}
        aria-label="Seek in voice note" aria-valuetext={`${audioClock(elapsed)}${duration ? ` of ${audioClock(duration)}` : ""}`}
        style={{ "--voice-progress": `${duration ? Math.min(100, elapsed / duration * 100) : 0}%` } as CSSProperties}
        onChange={event => { if (audio.current) { audio.current.currentTime = Number(event.target.value); setElapsed(audio.current.currentTime); } }} />
      <span className="chat-audio-time">{duration > 0 || playing || elapsed > 0 ? audioClock(elapsed) : ""}{duration > 0 ? <> <span>/ {audioClock(duration)}</span></> : null}</span>
      {trailingAction ?? (source && !compact ? <a className="chat-audio-download" href={source} download={name} aria-label="Download voice note"><Download size={14} strokeWidth={1.8} aria-hidden /></a> : null)}
    </div>
    {error ? <p className="chat-audio-status" role="alert">{error}</p> : null}
    {pending ? <p className="chat-audio-status" role="status"><Loader2 className="chat-audio-spinner" size={12} aria-hidden />Transcribing…</p> : null}
    {transcription?.status === "failed" ? <p className="chat-audio-status">Transcript unavailable · Audio saved</p> : null}
    {transcription?.status === "ready" ? <div className="chat-audio-transcript"><span>Transcript</span><p>{transcription.text?.trim() || "No speech detected."}</p></div> : null}
  </div>;
}
