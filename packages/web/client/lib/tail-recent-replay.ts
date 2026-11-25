/**
 * The unscoped recent replay with transcripts: GET /api/tail/recent with the
 * newest 1,000 lines. Home's feed, the session board and the Tail all read it
 * by these exact bytes, so a page that shows more than one of them makes one
 * request (api() shares an in-flight GET by its path) instead of one per reader.
 */
export const RECENT_REPLAY_LIMIT = 1_000;

export function tailRecentQuery(limit: number = RECENT_REPLAY_LIMIT): string {
  return new URLSearchParams({ limit: String(limit), transcripts: "true" }).toString();
}

export const RECENT_REPLAY_PATH = `/api/tail/recent?${tailRecentQuery()}`;
