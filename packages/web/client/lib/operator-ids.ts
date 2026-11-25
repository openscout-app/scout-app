/**
 * Who counts as the operator, as the server counts it (runtime
 * `configuredOperatorActorIds`): the literal id, the configured name, and the
 * handle (falling back to the name). Some send paths store the operator under
 * the name ("Arach"), so a check against "operator" alone reads a 1:1 chat as
 * a room.
 */

import { useEffect, useState } from "react";
import { api } from "./api.ts";

/** Until `/api/user` answers, only the literal operator id counts. */
export const DEFAULT_OPERATOR_IDS: ReadonlySet<string> = new Set(["operator"]);

export function operatorActorIds(user: { name?: string | null; handle?: string | null } | null | undefined): ReadonlySet<string> {
  const name = user?.name?.trim() || "operator";
  const handle = user?.handle?.trim().replace(/^@+/, "") || name.replace(/^@+/, "") || name;
  return new Set(["operator", name, handle]);
}

let cached: ReadonlySet<string> | null = null;
let pending: Promise<ReadonlySet<string>> | null = null;

/** Waits between failed reads. The last one repeats while the page is mounted. */
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * The operator ids for this page load. One `/api/user` read is shared by every
 * mount, so switching chats does not fall back to the default set and flash
 * the room layout. A failed read is retried: the web server restarts under a
 * page that stays open, and without a retry every chat stored under the
 * operator's name would read as a room until the page reloads.
 */
export function useOperatorActorIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => cached ?? DEFAULT_OPERATOR_IDS);
  useEffect(() => {
    if (cached) {
      setIds(cached);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const load = () => {
      pending ??= api<{ name?: string | null; handle?: string | null }>("/api/user")
        .then((user) => {
          cached = operatorActorIds(user);
          return cached;
        });
      pending.then(
        (next) => { if (!cancelled) setIds(next); },
        () => {
          pending = null;
          if (cancelled) return;
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
          attempt += 1;
          timer = setTimeout(load, delay);
        },
      );
    };
    load();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return ids;
}
