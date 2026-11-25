/*
 * What each agent said last, for its area on the canvas: the sentence Projects › Agents shows, beside the work.
 * Data: GET /api/tail/recent (each harness session's latest reply, the last day), read on open and every 30s while
 * the page is in front. Keyed by the harness session id, which is the id in an area's route ref.
 */
import { useEffect, useState } from "react";

import { api } from "../../lib/api.ts";
import type { TailEvent } from "../../lib/types.ts";
import { latestObservedAssistantReplies } from "../projects/projects-inbox-replies.ts";

export type Said = { text: string; at: number; cwd: string | null };

const PATH = "/api/tail/recent?limit=200&transcripts=1&mode=assistant-replies";
const POLL_MS = 30_000;

/** The latest reply of each session in a batch of tail events, by session id. Later batches replace earlier ones. */
export function saidBySession(events: TailEvent[]): Map<string, Said> {
  const out = new Map<string, Said>();
  for (const e of latestObservedAssistantReplies(events, events.length)) {
    const id = (e.sessionId.split(/[\\/]/u).filter(Boolean).at(-1) ?? "").replace(/\.jsonl$/u, "");
    const text = e.summary.replace(/\s+/g, " ").trim();
    if (id && text && !out.has(id)) out.set(id, { text, at: e.ts, cwd: e.cwd?.trim() || null });
  }
  return out;
}

export function useSaid(): ReadonlyMap<string, Said> {
  const [said, setSaid] = useState<ReadonlyMap<string, Said>>(new Map());
  useEffect(() => {
    let live = true;
    const load = () => api<{ events?: TailEvent[] }>(PATH, { cache: "no-store" })
      .then((r) => { if (live) setSaid(saidBySession(r.events ?? [])); }, () => { /* the areas stay as they were */ });
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  return said;
}
