import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export interface BoardReviewScope {
  connectionId: string;
  channel: string;
}

export interface BoardReviewRoutine extends BoardReviewScope {
  id: string;
  version: number;
  name: string;
  projectPath: string;
  harness: "codex" | "claude";
  enabled: boolean;
}

export interface BoardReviewPreview {
  routine: BoardReviewRoutine;
  input: { source: string; id: string; version: string };
  artifact: { kind: string; ref: string; revision: string };
}

export interface BoardReviewAttempt {
  key: string;
  routineId: string;
  requestId: string;
  /** undefined until resolved; null when the runtime returned no work ID. */
  workId?: string | null;
  /** Not shown as pending; the stable ID still protects a concurrent admission. */
  retryOnly?: boolean;
}

export function reviewRoutinesForRoom(routines: BoardReviewRoutine[], scope: BoardReviewScope) {
  return routines.filter(routine => routine.connectionId === scope.connectionId && routine.channel === scope.channel);
}

export function selectReviewRoutine(routines: BoardReviewRoutine[], preferred: string | null) {
  return routines.find(routine => routine.id === preferred)
    ?? routines.find(routine => routine.enabled)
    ?? routines[0]
    ?? null;
}

export function reviewAttemptStorageKey(hostId: string, scope: BoardReviewScope, itemId: string) {
  return "scout:board-review:v1:" + JSON.stringify([hostId, scope.connectionId, scope.channel, itemId]);
}

export function readReviewAttempts(storage: Pick<Storage, "getItem">, storageKey: string): BoardReviewAttempt[] {
  try {
    const attempts: unknown = JSON.parse(storage.getItem(storageKey) ?? "[]");
    if (Array.isArray(attempts)) {
      return attempts.filter((attempt): attempt is BoardReviewAttempt => attempt
        && typeof attempt.key === "string" && typeof attempt.routineId === "string"
        && typeof attempt.requestId === "string"
        && (attempt.workId == null || typeof attempt.workId === "string"));
    }
  } catch { /* storage may be unavailable */ }
  return [];
}

export function reviewIntentKey(preview: BoardReviewPreview) {
  const { routine, input, artifact } = preview;
  return JSON.stringify([routine.id, routine.version, input.source, input.id, input.version,
    artifact.kind, artifact.ref, artifact.revision]);
}

export function reviewRunRequest(preview: BoardReviewPreview, itemId: string, attempt: BoardReviewAttempt) {
  return {
    routineId: preview.routine.id,
    itemId,
    requestId: attempt.requestId,
    routineVersion: preview.routine.version,
    inputVersion: preview.input.version,
    revision: preview.artifact.revision,
  };
}

export function reserveReviewAttempt(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  preview: BoardReviewPreview,
): BoardReviewAttempt {
  const key = reviewIntentKey(preview);
  const attempts = readReviewAttempts(storage, storageKey);
  const attempt = attempts.find(existing => existing.key === key)
    ?? { key, routineId: preview.routine.id, requestId: reviewRequestId(storageKey, key) };
  delete attempt.retryOnly;
  // Persist before sending. A reload after a lost response must not mint another ID.
  storage.setItem(storageKey, JSON.stringify([attempt, ...attempts.filter(existing => existing.key !== key)]));
  return attempt;
}

export function storeReviewReceipt(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  attempt: BoardReviewAttempt,
  workId: string | null,
): void {
  const attempts = readReviewAttempts(storage, storageKey);
  if (attempts.some(existing => existing.key === attempt.key && existing.requestId !== attempt.requestId)) return;
  const others = attempts.filter(existing => existing.key !== attempt.key);
  const { retryOnly: _, ...receipt } = attempt;
  storage.setItem(storageKey, JSON.stringify([{ ...receipt, workId }, ...others]));
}

function reviewRequestId(storageKey: string, key: string, replacedRequestId?: string) {
  return `board-review-${bytesToHex(sha256(utf8ToBytes(JSON.stringify([storageKey, key, replacedRequestId]))))}`;
}

/** Serialize ledger changes when supported. The same pins (or confirmed
 * refused predecessor) still converge on one ID without Web Locks. */
export async function withReviewLedger<T>(storageKey: string, update: () => T): Promise<T> {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(storageKey, () => update())
    : update();
}

export function recordReviewRefusal(
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  requestId: string,
  durable: boolean,
) {
  const attempts = readReviewAttempts(storage, storageKey).map(attempt =>
    attempt.requestId === requestId && attempt.workId === undefined
      ? { ...attempt, retryOnly: true, requestId: durable ? reviewRequestId(storageKey, attempt.key, requestId) : requestId }
      : attempt);
  storage.setItem(storageKey, JSON.stringify(attempts));
  return attempts;
}

const PRE_ADMISSION_CODES = new Set([
  "invalid_manual_review_request", "operator_only", "manual_review_routine_not_found",
  "manual_review_routine_disabled", "manual_review_preview_changed", "manual_review_project_not_found",
  "manual_review_project_not_git", "manual_review_project_head_unreadable", "vercel_board_changed", "not_custodian",
  "review_item_moved", "review_item_deleted", "review_item_protected", "review_item_unknown",
  "review_item_changed", "review_item_forbidden", "review_item_not_task", "review_connection_not_live", "review_channel_not_permitted",
]);

export function reviewRunFailure(cause: unknown) {
  const code = (cause as { code?: string } | null)?.code;
  if (code === "manual_review_dispatch_refused") return "refused";
  return code && PRE_ADMISSION_CODES.has(code) ? "pre-admission" : "uncertain";
}

export function reviewWorkHref(workId: string | null | undefined) {
  return workId && workId !== "." && workId !== ".." ? `/work/${encodeURIComponent(workId)}` : null;
}
