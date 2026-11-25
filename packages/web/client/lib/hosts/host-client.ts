/**
 * One Scout runtime the web app talks to. Today that is only the runtime
 * that served the page (same origin). A paired host, reached over the relay
 * or the tailnet the way the phone reaches it, is a second implementation of
 * this same interface.
 */
/** The runtime's own live feeds, which the local portal reads over its /trpc socket. */
export type HostStream = "control.events" | "tail.events";

export interface HostStreamHandlers {
  /** The stream is live, the first time and after every resume: reconcile here. */
  onStarted?: () => void;
  onData: (data: unknown) => void;
  /** The stream dropped. It resumes on its own unless the host is gone for good. */
  onInterrupted?: (error: Error) => void;
}

export interface HostClient {
  /** Stable host key: "local" for the serving runtime; a paired host's public key. */
  readonly id: string;
  readonly label: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  eventSource(path: string): EventSource;
  /**
   * One of the runtime's live feeds. Only hosts reached through the bridge
   * implement it; the serving runtime's page opens its /trpc socket itself.
   */
  subscribe?(stream: HostStream, handlers: HostStreamHandlers): () => void;
}

export const LOCAL_HOST_ID = "local";

export function sameOriginHost(label = "This host"): HostClient {
  return {
    id: LOCAL_HOST_ID,
    label,
    fetch: (path, init) => fetch(path, init),
    eventSource: (path) => new EventSource(path),
  };
}
