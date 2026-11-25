/** The runtime reads at most this many sessions per usage request (core tail usage read). */
export const TAIL_USAGE_SESSION_LIMIT = 50;
const SESSION_ID_MAX_LENGTH = 256;

/** Session ids from repeated or comma-separated `sessionId`, deduped, at most the runtime's limit. */
export function parseTailUsageSessionIds(values: readonly string[]): string[] {
  const ids: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const id = part.trim();
      if (!id || id.length > SESSION_ID_MAX_LENGTH || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= TAIL_USAGE_SESSION_LIMIT) return ids;
    }
  }
  return ids;
}
