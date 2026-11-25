import { VOICE_NOTE_MAX_BYTES, VOICE_NOTE_MAX_DURATION_MS, VOICE_NOTE_SAMPLE_RATE, voiceNoteBase64, voiceNotePcmWav } from "../../shared/voice-note.ts";

/** Normalize browser containers locally. Only this bounded format crosses an ASR boundary. */
export async function voiceNoteAudioPayload(file: Blob): Promise<{ audio: string }> {
  if (file.size > VOICE_NOTE_MAX_BYTES) throw new Error("Recordings must be no larger than 4 MB.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration * 1000 > VOICE_NOTE_MAX_DURATION_MS + 1000) throw new Error("Recordings must be no longer than five minutes.");
    const length = Math.min(Math.ceil(decoded.duration * VOICE_NOTE_SAMPLE_RATE), VOICE_NOTE_SAMPLE_RATE * VOICE_NOTE_MAX_DURATION_MS / 1000);
    const offline = new OfflineAudioContext(1, length, VOICE_NOTE_SAMPLE_RATE);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return { audio: voiceNoteBase64(voiceNotePcmWav(rendered.getChannelData(0))) };
  } finally { await context.close(); }
}

export { voiceNotePcmWav } from "../../shared/voice-note.ts";
