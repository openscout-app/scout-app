/**
 * For you's cards, by row id, from GET /api/feed/for-you. Read with the
 * feed's refresh, and again a few times while the server is still writing a
 * digest. A row with no card is drawn as it is today.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.ts";
import { useBrokerRefresh } from "../../../lib/broker-refresh.ts";
import { FLEET_EVENT_KINDS, matchesKinds } from "../../../lib/broker-event-kinds.ts";
import { usePageRefresh } from "../../../lib/page-refresh.ts";
import type { ForYouCard, ForYouResponse } from "../../../../shared/api/for-you.ts";

const POLICY = { matches: matchesKinds(FLEET_EVENT_KINDS), fallbackPollMs: 30_000, livePollMs: 120_000 };
/** While a digest is being written: read again this soon, at most this many times in a row. */
const PENDING_MS = 3_000;
const PENDING_READS = 10;

export function useForYouCards(): ReadonlyMap<string, ForYouCard> {
  const [cards, setCards] = useState<ReadonlyMap<string, ForYouCard>>(new Map());
  const [pending, setPending] = useState(false);
  const reads = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(() => {
    return api<ForYouResponse>("/api/feed/for-you").then(
      (res) => {
        if (!alive.current) return;
        setCards(new Map(res.cards.map((card) => [card.id, card])));
        setPending(res.pending);
      },
      // A failed read keeps the cards it had; rows stand in for the rest.
      () => undefined,
    );
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerRefresh(() => void load(), POLICY);
  usePageRefresh(load);
  useEffect(() => {
    if (!pending) { reads.current = 0; return; }
    if (reads.current >= PENDING_READS) return;
    const t = setTimeout(() => { reads.current += 1; void load(); }, PENDING_MS);
    return () => clearTimeout(t);
  }, [pending, cards, load]);

  return cards;
}
