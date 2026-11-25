/**
 * One expensive read shared by every request: served from memory, refreshed
 * in the background once it is older than `maxAgeMs`, never more than one
 * refresh at a time. The first request waits for the first read; later ones
 * never wait. A failed refresh keeps the last value and is not retried until
 * `maxAgeMs` has passed again, so a broken source isn't hammered per request.
 *
 * `fresh` waits for a new read (an explicit force-refresh), and asks `read`
 * to bypass any cache of its own.
 */
export type RefreshingRead<T> = {
  get(options?: { fresh?: boolean }): Promise<T>;
};

export function createRefreshingRead<T>(
  read: (options: { fresh: boolean }) => Promise<T>,
  options: { maxAgeMs: number; now?: () => number },
): RefreshingRead<T> {
  const now = options.now ?? Date.now;
  let value: { data: T } | null = null;
  let attemptedAt = Number.NEGATIVE_INFINITY;
  let lastError: unknown = null;
  let inFlight: Promise<T> | null = null;

  const refresh = (fresh = false): Promise<T> => {
    if (inFlight && !fresh) return inFlight;
    attemptedAt = now();
    const attempt: Promise<T> = read({ fresh })
      .then((data) => {
        value = { data };
        lastError = null;
        return data;
      }, (error: unknown) => {
        lastError = error;
        throw error;
      })
      .finally(() => {
        if (inFlight === attempt) inFlight = null;
      });
    inFlight = attempt;
    return attempt;
  };

  return {
    async get({ fresh = false } = {}) {
      if (fresh) return refresh(true);
      const due = now() - attemptedAt > options.maxAgeMs;
      if (!value) {
        // nothing to serve yet: wait, unless the last attempt failed recently
        if (!due && lastError && !inFlight) throw lastError;
        return refresh();
      }
      if (due) void refresh().catch(() => { /* keep serving the last value */ });
      return value.data;
    },
  };
}
