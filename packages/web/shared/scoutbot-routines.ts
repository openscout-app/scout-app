/** Local host preferences; these are not Scout runtime records. */
export type CleanupConfig = {
  enabled: boolean;
  name: string;
  repository: string;
  intervalMinutes: number;
  warningGiB: number;
};
export type CleanupCopy = {
  id: string;
  path: string;
  head: string | null;
  branch: string | null;
  kind: string;
  mergedIntoMain: boolean | null;
  decision: string;
  decisionReasons: string[];
};
export type CleanupReview = {
  id: string;
  checkedAt: number;
  expiresAt: number;
  repository: string;
  availableBytes: number;
  totalBytes: number;
  copies: CleanupCopy[];
};
export type CleanupOutcome = { path: string; removed: boolean; errors?: string[] };
export type CleanupResult = {
  outcomes: CleanupOutcome[];
  availableBefore: number;
  availableAfter: number;
  finishedAt: number;
};
export type RoutineOperation = { kind: "check" | "config" | "apply" | "run" | "unknown"; state: "running" | "interrupted"; message: string; paths?: string[] };
export type CleanupState = {
  operation?: RoutineOperation;
  config: CleanupConfig;
  disk: { availableBytes: number; totalBytes: number; checkedAt: number } | null;
  review: CleanupReview | null;
  result: CleanupResult | null;
  error: string | null;
  notificationError: string | null;
  lastAttemptAt: number | null;
};

export const DEFAULT_BRIEFING_MODEL = "gpt-6-luna";
export type BriefingRoutineConfig = { enabled: boolean; name: string; focus: string; intervalMinutes: number; model: string };
export type BriefingRoutineResult = { briefId: string; title: string; model: string; preparedAt: number };
export type BriefingRoutineRun = { id: string; startedAt: number; finishedAt: number | null; status: "running" | "complete" | "failed" | "interrupted"; result?: BriefingRoutineResult; error?: string };
export type BriefingRoutineState = {
  owner: "personal";
  config: BriefingRoutineConfig;
  nextRunAt: number | null;
  paused: boolean;
  lastRun: BriefingRoutineRun | null;
  operation?: RoutineOperation;
};
export function isBriefingLunaModel(value: string): boolean { return /^gpt-(?:[6-9]|[1-9]\d+)(?:\.\d+)?-luna$/.test(value); }
