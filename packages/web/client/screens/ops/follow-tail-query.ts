import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { FollowTarget, Route } from "../../lib/types.ts";
import { followTailParams } from "./follow-tail-params.ts";

/**
 * A follow link lands on the tail with Scout ids (flight, invocation, session,
 * chat) in the URL. Tail events carry the harness's own session id instead,
 * so a `q` built from Scout ids matches nothing. When those ids are present,
 * ask the broker which harness session they point at and filter on that.
 * Keep resolving while mounted: a queued flight may not have a session yet,
 * and a retry may later move it to another session.
 */
export function useFollowTailQuery(route: Route, tailQuery: string | undefined): {
  query: string | undefined;
  sessionId: string | undefined;
} {
  const params = followTailParams(route);
  const key = params.toString();
  const [resolved, setResolved] = useState<{ key: string; query: string | undefined } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let pending = false;
    const resolve = async () => {
      if (pending) return;
      pending = true;
      try {
        const target = await api<FollowTarget>(`/api/follow?${key}`);
        if (!cancelled) setResolved({ key, query: target.harnessSessionId?.trim() || undefined });
      } catch {
        // Keep the scoped fallback on transient failure and retry next tick.
      } finally {
        pending = false;
      }
    };
    void resolve();
    const timer = setInterval(() => void resolve(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);

  const sessionId = resolved?.key === key ? resolved.query : undefined;
  // Never show the whole fleet while waiting for a typed task to resolve.
  const fallback = tailQuery || [...params.values()].join("|") || undefined;
  return { query: sessionId ?? fallback, sessionId };
}
