// Web client subscription to the broker's tail.events firehose via tRPC over
// WebSocket. Single shared connection across all React subscribers.
//
// See docs/tail-firehose.md.

import { useEffect, useRef } from "react";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { BrokerRouter } from "@openscout/runtime/broker-trpc-router";

import type { TailEvent } from "./types.ts";
import { resolveScoutTailStreamUrl, SAME_ORIGIN_RUNTIME } from "./runtime-config.ts";
import { focusedStreamHost } from "./hosts/host-fleet.ts";

type TailSubscription = (event: TailEvent) => void;

const subscribers = new Set<TailSubscription>();
let wsClient: ReturnType<typeof createWSClient> | null = null;
let trpc: ReturnType<typeof createTRPCClient<BrokerRouter>> | null = null;
let activeSub: { unsubscribe: () => void } | null = null;

function dispatch(event: TailEvent): void {
  for (const subscriber of [...subscribers]) {
    subscriber(event);
  }
}

function ensureSubscribed(): void {
  if (activeSub) return;
  // A host reached through the bridge carries the tail itself.
  const host = focusedStreamHost();
  if (host) {
    activeSub = {
      unsubscribe: host.subscribe("tail.events", {
        onData: (data) => {
          if (data) dispatch(data as TailEvent);
        },
      }),
    };
    return;
  }
  if (!SAME_ORIGIN_RUNTIME) return;
  if (!wsClient) {
    wsClient = createWSClient({ url: resolveScoutTailStreamUrl() });
    trpc = createTRPCClient<BrokerRouter>({ links: [wsLink({ client: wsClient })] });
  }
  activeSub = trpc!.tail.events.subscribe(undefined, {
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
  // Keep wsClient open across re-mounts; tRPC handles reconnection.
}

export function useTailEvents(onEvent: (event: TailEvent) => void, enabled = true): void {
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
