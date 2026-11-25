/** Usage observations, not a bill: null means the provider did not report it. */
/**
 * What a recorded model request was for. "chat" is a typed message, "local" a
 * spoken reply, "api" a question handed over from a live call. The rest are
 * the requests Scoutbot makes outside a conversation: a session recap, the
 * note on provider limits, and a briefing (its analysis and its spoken pass).
 */
export type VoiceUsageMode = "local" | "api" | "chat" | "recap" | "advice" | "brief";
export type VoiceTokenUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
export type VoiceModelUsage = VoiceTokenUsage & {
  id: string;
  sessionId: string;
  mode: VoiceUsageMode;
  model: string;
  provider: string | null;
  startedAt: number;
  finishedAt: number | null;
  elapsedMs: number | null;
  state: "pending" | "completed" | "failed";
};
export type VoiceModelUsageSummary = VoiceTokenUsage & {
  mode: VoiceUsageMode;
  requests: number;
  missingTokenReports: number;
  elapsedMs: number | null;
};
export type LiveCallUsage = {
  sessionId: string;
  leaseId: string;
  state: string;
  startedAt: number | null;
  endedAt: number | null;
  model: string | null;
  voice: string | null;
  providerSeconds: number | null;
  clientReportedSeconds: number | null;
};
export type VoiceUsageSnapshot = {
  llm: { records: VoiceModelUsage[]; summaries: VoiceModelUsageSummary[] } | null;
  /** Bounded recent call history, not an all-time audio total. */
  calls: LiveCallUsage[];
};

export function validUsageNumber(value: unknown, integer = false): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    && (!integer || Number.isSafeInteger(value)) ? value : null;
}
