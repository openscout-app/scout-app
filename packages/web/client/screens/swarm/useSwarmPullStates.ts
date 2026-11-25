import { useEffect, useRef, useState } from "react";

import { api } from "../../lib/api.ts";
import { mergePullStates, type SwarmPullState, type SwarmPullsSnapshot } from "../../lib/swarm-pull-state.ts";

// The server reads GitHub at most once a minute; the page asks half as often.
const READ_MS = 120_000;

/**
 * The state of the pull requests in `query` (pullStateQuery), read when the
 * set changes and every two minutes. A web server older than the route
 * answers 404, and the page stops asking until it reloads. Without states
 * the panels say only what the asks say.
 */
export function useSwarmPullStates(query: string | null): ReadonlyMap<string, SwarmPullState> {
  const [states, setStates] = useState<ReadonlyMap<string, SwarmPullState>>(() => new Map());
  const missingRoute = useRef(false);

  useEffect(() => {
    if (!query || missingRoute.current) return;
    let cancelled = false;
    const read = () => {
      if (missingRoute.current) return;
      api<SwarmPullsSnapshot>(`/api/swarm/pulls?${query}`)
        .then((snapshot) => {
          if (!cancelled && Array.isArray(snapshot?.pulls)) setStates((held) => mergePullStates(held, snapshot.pulls));
        })
        .catch((error: unknown) => {
          if ((error as { status?: number } | null)?.status === 404) missingRoute.current = true;
        });
    };
    read();
    const timer = window.setInterval(() => {
      if (!document.hidden) read();
    }, READ_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [query]);

  return states;
}
