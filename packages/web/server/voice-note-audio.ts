import { validateVoiceNoteWav, VOICE_NOTE_MAX_WAV_BYTES } from "../shared/voice-note.ts";

export class VoiceNoteError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Bound the stream before parsing or decoding; Content-Length is not trusted. */
export async function readVoiceNoteAudio(request: Request): Promise<{ bytes: Uint8Array; base64: string }> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new VoiceNoteError(415, "json_required", "An audio recording is required.");
  const body = await readVoiceNoteJson(request, Math.ceil(VOICE_NOTE_MAX_WAV_BYTES * 4 / 3) + 1024);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "audio")) throw new VoiceNoteError(400, "invalid_audio", "Send one audio recording.");
  const audio = (body as { audio?: unknown }).audio;
  if (typeof audio !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new VoiceNoteError(400, "invalid_audio", "Send one audio recording.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0)); }
  catch { throw new VoiceNoteError(400, "invalid_audio", "The recording could not be decoded."); }
  if (!validateVoiceNoteWav(bytes)) throw new VoiceNoteError(400, "invalid_audio", "The recording must be mono 16 kHz PCM audio of at most five minutes.");
  return { bytes, base64: audio };
}

/** Bounded even for chunked operator/native requests with no Content-Length. */
export async function readVoiceNoteJson(request: Request, maxBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new VoiceNoteError(400, "audio_required", "An audio recording is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new VoiceNoteError(413, "audio_too_large", "This recording is too large to transcribe."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(await new Blob(chunks as BlobPart[]).text()); }
  catch { throw new VoiceNoteError(400, "invalid_audio", "The recording could not be read."); }
}
