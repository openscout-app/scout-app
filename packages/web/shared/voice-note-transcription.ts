export type VoiceNoteTranscription = {
  status: "queued" | "processing" | "ready" | "failed";
  updatedAt: number;
  text?: string;
  reason?: string;
};
export function voiceNoteTranscriptions(metadata: unknown): Record<string, VoiceNoteTranscription> {
  const raw = (metadata as { voiceNotes?: unknown } | null)?.voiceNotes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value && typeof value === "object"
    && ["queued", "processing", "ready", "failed"].includes(value.status) && Number.isFinite(value.updatedAt)
    && (value.text === undefined || typeof value.text === "string")));
}
