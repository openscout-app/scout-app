import { useEffect, useState } from "react";
import type { ConversationDefinition } from "@openscout/protocol";

import type { ChatApi } from "./chat-api.ts";
import { forYouQuestions, type ForYouItem } from "./chat-space-model.ts";

/**
 * The questions waiting on this viewer across rooms. Bootstrap already counts
 * them per room; this reads the question page only for rooms with a count,
 * and again whenever those counts change. A room that fails to load drops out
 * rather than blanking the rest.
 */
export function useForYouQuestions(
  api: ChatApi,
  questionCounts: Record<string, number> | undefined,
  channels: ConversationDefinition[],
  space: string | null,
): ForYouItem[] {
  const [items, setItems] = useState<ForYouItem[]>([]);
  const wanted = Object.entries(questionCounts ?? {})
    .filter(([, count]) => count > 0)
    .map(([channelId]) => channelId)
    .sort();
  const key = JSON.stringify([space, wanted, questionCounts]);
  useEffect(() => {
    const read = api.questions;
    if (!read || wanted.length === 0) { setItems([]); return; }
    let alive = true;
    const titles = new Map(channels.map(channel => [channel.id, channel.title.replace(/^#/u, "")]));
    void Promise.all(wanted.map(async channelId => {
      try {
        const page = await read(channelId, null, space);
        return { channelId, channelTitle: titles.get(channelId) ?? channelId, questions: page.questions };
      } catch {
        return null;
      }
    })).then(pages => {
      if (alive) setItems(forYouQuestions(pages.filter(page => page !== null)));
    });
    return () => { alive = false; };
    // `key` carries the counts and the space; channels only rename rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return items;
}
