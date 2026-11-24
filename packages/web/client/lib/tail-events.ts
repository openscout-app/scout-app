// Web client subscription to the broker's tail.events firehose via tRPC over
// WebSocket. Single shared connection across all React subscribers.

import { readOnlyPreview } from "./preview-capabilities.ts";
import { useEffect, useRef } from "react";
import { createTRPCUntypedClient, createWSClient, wsLink } from "@trpc/client";

import type { TailEvent } from "./types.ts";
import { resolveScoutTailStreamUrl } from "./runtime-config.ts";

type TailSubscription = (event: TailEvent) => void;

const subscribers = new Set<TailSubscription>();
let wsClient: ReturnType<typeof createWSClient> | null = null;
let trpc: ReturnType<typeof createTRPCUntypedClient> | null = null;
let activeSub: { unsubscribe: () => void } | null = null;

function dispatch(event: TailEvent): void {
  for (const subscriber of [...subscribers]) {
    subscriber(event);
  }
}

function ensureSubscribed(): void {
  if (activeSub) return;
  if (!wsClient) {
    wsClient = createWSClient({ url: resolveScoutTailStreamUrl() });
    trpc = createTRPCUntypedClient({ links: [wsLink({ client: wsClient })] });
  }
  activeSub = trpc!.subscription("tail.events", undefined, {
    onData: (data) => {
      // tRPC `tracked` envelope: { id, data }.
      const event = (data as { data: TailEvent }).data;
      if (event) dispatch(event);
    },
  });
}

function teardown(): void {
  activeSub?.unsubscribe();
  activeSub = null;
  const client = wsClient;
  wsClient = null;
  trpc = null;
  void client?.close();
}

export function useTailEvents(onEvent: (event: TailEvent) => void, enabled = !readOnlyPreview): void {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const subscriber: TailSubscription = (event) => cbRef.current(event);
    subscribers.add(subscriber);
    ensureSubscribed();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        teardown();
      }
    };
  }, [enabled]);
}
