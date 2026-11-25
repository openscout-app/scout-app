import { useEffect, useRef } from "react";

/** A poll that pauses while hidden, offline, or rate-limited, and never overlaps itself. */
export function usePoll(run: () => Promise<number | void>, intervalMs: number, enabled: boolean) {
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;
    let retryAt = 0;
    const tick = () => {
      if (cancelled || busy || Date.now() < retryAt) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      busy = true;
      void runRef.current().then(retryAfterSeconds => {
        if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          retryAt = Date.now() + retryAfterSeconds * 1000;
        }
      }).catch(() => {
        retryAt = Date.now() + intervalMs;
      }).finally(() => {
        busy = false;
      });
    };
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", tick);
    };
  }, [enabled, intervalMs]);
}
