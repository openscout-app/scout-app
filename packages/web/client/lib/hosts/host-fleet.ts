/**
 * Every host the web app can read from, one client each. Ported from the iOS
 * app's `FleetConnectionManager` (apps/ios/Scout/AppModel.swift): one client
 * per host with its own state, one focused host that actions go to by
 * default, and reads that go to every connected host at once and come back
 * tagged with the host they came from.
 */
import { LOCAL_HOST_ID, sameOriginHost, type HostClient } from "./host-client.ts";
import { ALL_HOSTS, selectedHosts, type HostReadScope } from "./read-scope.ts";

export type HostState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  /** Connected, and waiting for the host's owner to allow this browser. */
  | { kind: "awaiting_approval" }
  | { kind: "failed"; error: string };

export type HostRead<T> =
  | { hostId: string; label: string; ok: true; value: T }
  | { hostId: string; label: string; ok: false; error: unknown };

export class HostFleet {
  private clients = new Map<string, HostClient>();
  private states = new Map<string, HostState>();
  private focusedId: string | null = null;

  add(client: HostClient, state: HostState = { kind: "connected" }): void {
    const key = client.id.toLowerCase();
    this.clients.set(key, client);
    this.states.set(key, state);
    if (!this.focusedId) this.focusedId = key;
  }

  forget(id: string): void {
    const key = id.toLowerCase();
    this.clients.delete(key);
    this.states.delete(key);
    if (this.focusedId === key) this.focusedId = this.clients.keys().next().value ?? null;
  }

  setState(id: string, state: HostState): void {
    const key = id.toLowerCase();
    if (this.clients.has(key)) this.states.set(key, state);
  }

  state(id: string): HostState {
    return this.states.get(id.toLowerCase()) ?? { kind: "idle" };
  }

  focus(id: string): void {
    const key = id.toLowerCase();
    if (this.clients.has(key)) this.focusedId = key;
  }

  /** The host actions go to when the caller doesn't name one. */
  focused(): HostClient {
    const client = this.focusedId ? this.clients.get(this.focusedId) : undefined;
    if (!client) throw new Error("No Scout host is connected");
    return client;
  }

  /** A connected host by id, or null. Never connects one. */
  connected(id: string): HostClient | null {
    const key = id.toLowerCase();
    const client = this.clients.get(key);
    return client && this.states.get(key)?.kind === "connected" ? client : null;
  }

  connectedClients(): HostClient[] {
    return [...this.clients.keys()]
      .sort()
      .map((id) => this.connected(id))
      .filter((client): client is HostClient => client !== null);
  }

  hostIds(): string[] {
    return [...this.clients.keys()];
  }

  /**
   * Run one read against every connected host in scope, all at once, so one
   * slow host doesn't hold back the rest. A host that fails is reported, not
   * thrown: the caller merges what answered.
   */
  async read<T>(fn: (client: HostClient) => Promise<T>, scope: HostReadScope = ALL_HOSTS): Promise<HostRead<T>[]> {
    const ids = selectedHosts(scope, this.hostIds());
    const clients = this.connectedClients().filter((client) => ids.has(client.id.toLowerCase()));
    return Promise.all(
      clients.map(async (client): Promise<HostRead<T>> => {
        try {
          return { hostId: client.id, label: client.label, ok: true, value: await fn(client) };
        } catch (error) {
          return { hostId: client.id, label: client.label, ok: false, error };
        }
      }),
    );
  }
}

/** The page's fleet. Until pairing lands it holds only the serving runtime. */
export const hostFleet = new HostFleet();
hostFleet.add(sameOriginHost());

/** Fetch from the focused host. Use in place of a bare fetch("/api/…"). */
export function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  return hostFleet.focused().fetch(path, init);
}

/** Open a server-sent event stream on the focused host. */
export function hostEventSource(path: string): EventSource {
  return hostFleet.focused().eventSource(path);
}

/**
 * The focused host when it carries the runtime's live feeds itself (a host
 * reached through the bridge), or null when the page opens them directly.
 */
export function focusedStreamHost(): (HostClient & Required<Pick<HostClient, "subscribe">>) | null {
  let host: HostClient;
  try {
    host = hostFleet.focused();
  } catch {
    return null;
  }
  return host.subscribe ? host as HostClient & Required<Pick<HostClient, "subscribe">> : null;
}

export { LOCAL_HOST_ID };
