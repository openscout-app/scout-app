/** A transcript belongs to an unsent recording until the person sends it. */
export const VOICE_NOTE_MAX_BYTES = 4 * 1024 * 1024;
export const VOICE_NOTE_MAX_WAV_BYTES = 10 * 1024 * 1024;
export const VOICE_NOTE_MAX_DURATION_MS = 5 * 60_000;
export const VOICE_NOTE_SAMPLE_RATE = 16_000;
export type VoiceNoteTranscript = { text: string; processing: "on-device" | "server"; provider: string };
export type VoiceNoteCapabilities = { available: boolean; processing: "on-device" | "server"; provider: string | null };
export const VOICE_NOTE_CONNECTION_PATH = "/voice-note-connect.html";
export const VOICE_NOTE_CALLBACK_PATH = "/settings/voice-connected";
export const VOICE_NOTE_LOCAL_PATH = "/api/voice/transcription/connected";

/** The transcription boundary accepts only our bounded mono PCM WAV format. */
export function validateVoiceNoteWav(bytes: Uint8Array): boolean {
  if (bytes.length < 46 || bytes.length > 44 + VOICE_NOTE_SAMPLE_RATE * 2 * VOICE_NOTE_MAX_DURATION_MS / 1000 || (bytes.length - 44) % 2) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  return tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && tag(36) === "data"
    && view.getUint32(4, true) === bytes.length - 8 && view.getUint32(16, true) === 16
    && view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1
    && view.getUint32(24, true) === VOICE_NOTE_SAMPLE_RATE && view.getUint32(28, true) === VOICE_NOTE_SAMPLE_RATE * 2
    && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 && view.getUint32(40, true) === bytes.length - 44;
}

export function voiceNoteBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** A destination is an origin, never a caller-selected callback path. */
export function voiceNoteOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) return null;
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ? url.origin : null;
  } catch { return null; }
}

export function voiceNotePcmWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  tag(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); tag(8, "WAVE"); tag(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, VOICE_NOTE_SAMPLE_RATE, true); view.setUint32(28, VOICE_NOTE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i]!)); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return bytes;
}
