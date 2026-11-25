import { expect, test } from "bun:test";
import {
  recordReviewRefusal, readReviewAttempts, reserveReviewAttempt, reviewAttemptStorageKey, reviewRoutinesForRoom, reviewRunRequest,
  reviewWorkHref, selectReviewRoutine, storeReviewReceipt,
  type BoardReviewPreview,
} from "./board-review.ts";

const scope = { connectionId: "conn/one", channel: "team/review" };
const preview: BoardReviewPreview = {
  routine: { ...scope, id: "reviewer", name: "Code review", version: 1, projectPath: "/repo", harness: "codex", enabled: true },
  input: { source: "vercel-board", id: "board-task", version: "3" },
  artifact: { kind: "git", ref: "project", revision: "commit-one" },
};

function storage() {
  const persisted = new Map<string, string>();
  return () => ({
    getItem: (key: string) => persisted.get(key) ?? null,
    setItem: (key: string, value: string) => { persisted.set(key, value); },
  });
}

test("room candidates are scoped; selection keeps an explicit disabled reviewer", () => {
  const disabled = { ...preview.routine, id: "disabled", enabled: false };
  const candidates = reviewRoutinesForRoom([
    { ...preview.routine, id: "another-board", connectionId: "another" },
    { ...preview.routine, id: "another-channel", channel: "another" },
    disabled, preview.routine,
  ], scope);
  expect(candidates.map(item => item.id)).toEqual(["disabled", "reviewer"]);
  expect(selectReviewRoutine(candidates, "disabled")).toBe(disabled);
  expect(selectReviewRoutine(candidates, "another-board")).toBe(preview.routine);
  expect(selectReviewRoutine([], null)).toBeNull();
});

test("ambiguous requests retry the identical pinned payload after reload", () => {
  const open = storage();
  const key = reviewAttemptStorageKey("local", scope, "board-task");
  const sent = reserveReviewAttempt(open(), key, preview);
  const retried = reserveReviewAttempt(open(), key, structuredClone(preview));
  expect(reviewRunRequest(preview, "board-task", retried)).toEqual({
    routineId: "reviewer", itemId: "board-task", inputVersion: "3", revision: "commit-one",
    requestId: sent.requestId, routineVersion: 1,
  });
});

test("other reviewers, versions, and task or host scopes get different request IDs", () => {
  const open = storage();
  const key = reviewAttemptStorageKey("local", scope, "board-task");
  const attempts = [
    reserveReviewAttempt(open(), key, preview),
    reserveReviewAttempt(open(), key, { ...preview, routine: { ...preview.routine, id: "alternate" } }),
    reserveReviewAttempt(open(), key, { ...preview, routine: { ...preview.routine, version: 2 } }),
    reserveReviewAttempt(open(), key, { ...preview, input: { ...preview.input, version: "4" } }),
    reserveReviewAttempt(open(), key, { ...preview, artifact: { ...preview.artifact, revision: "commit-two" } }),
    reserveReviewAttempt(open(), reviewAttemptStorageKey("local", scope, "different-task"), preview),
    reserveReviewAttempt(open(), reviewAttemptStorageKey("local", { ...scope, channel: "elsewhere" }, "board-task"), preview),
    reserveReviewAttempt(open(), reviewAttemptStorageKey("paired", scope, "board-task"), preview),
  ];
  expect(new Set(attempts.map(a => a.requestId)).size).toBe(attempts.length);
  expect(reserveReviewAttempt(open(), key, preview).requestId).toBe(attempts[0]!.requestId);
});

test("a recovered receipt reopens the durable work ID, not a flight or external URL", () => {
  const open = storage();
  const key = reviewAttemptStorageKey("local", scope, "board-task");
  const attempt = reserveReviewAttempt(open(), key, preview);
  expect(reviewWorkHref(readReviewAttempts(open(), key)[0]?.workId)).toBeNull();
  storeReviewReceipt(open(), key, attempt, "work id/1");
  expect(reviewWorkHref(readReviewAttempts(open(), key)[0]?.workId)).toBe("/work/work%20id%2F1");
  expect(reserveReviewAttempt(open(), key, preview)).toEqual({ ...attempt, workId: "work id/1" });
  expect(reviewWorkHref("..")).toBeNull();
});

test("a confirmed refusal allows a new request without dropping prior tickets", () => {
  const open = storage();
  const key = reviewAttemptStorageKey("local", scope, "board-task");
  const prior = reserveReviewAttempt(open(), key, { ...preview, input: { ...preview.input, version: "2" } });
  storeReviewReceipt(open(), key, prior, "prior-review");
  const refused = reserveReviewAttempt(open(), key, preview);
  const attempts = recordReviewRefusal(open(), key, refused.requestId, true);
  expect(attempts.find(a => a.workId)).toEqual({ ...prior, workId: "prior-review" });
  expect(attempts.find(a => a.retryOnly)?.requestId).not.toBe(refused.requestId);
  expect(reserveReviewAttempt(open(), key, preview).requestId).not.toBe(refused.requestId);
});
