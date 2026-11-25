/**
 * Calls the bridge's tRPC router over the encrypted channel, in the wire
 * format the bridge's relay client dispatches: `{ id, jsonrpc: "2.0",
 * method: "query" | "mutation" | "subscription", params: { path, input } }`.
 * A subscription answers `started`, then `data` frames under its id until it
 * sends `stopped` or an error, or this side sends `subscription.stop`.
 * Messages the bridge pushes on its own (session updates, conversation
 * changes) carry no id we're waiting on and are ignored.
 */

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type BridgeReply = {
  id?: unknown;
  result?: { type?: string; id?: unknown; data?: unknown };
  error?: { message?: string; code?: number; data?: { code?: string } };
};

export interface BridgeSubscriptionHandlers {
  onStarted?: () => void;
  /** `id` is the event id of a resumable stream (a tRPC `tracked` event). */
  onData: (data: unknown, id?: string) => void;
  /** The stream ended: `error` when it failed, none when the bridge stopped it. */
  onEnd?: (error?: Error) => void;
}

function replyError(error: NonNullable<BridgeReply["error"]>): Error {
  return Object.assign(new Error(error.message ?? "The host refused the request"), {
    code: error.data?.code ?? error.code,
  });
}

export class BridgeRpc {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly subscriptions = new Map<number, BridgeSubscriptionHandlers>();

  constructor(
    private readonly send: (text: string) => void,
    private readonly timeoutMs = 30_000,
  ) {}

  query<T>(path: string, input?: unknown): Promise<T> {
    return this.call<T>("query", path, input);
  }

  mutation<T>(path: string, input?: unknown): Promise<T> {
    return this.call<T>("mutation", path, input);
  }

  handleMessage(text: string): void {
    let reply: BridgeReply;
    try {
      reply = JSON.parse(text) as BridgeReply;
    } catch {
      return;
    }
    if (typeof reply?.id !== "number") return;
    const subscription = this.subscriptions.get(reply.id);
    if (subscription) {
      this.handleSubscriptionReply(reply.id, subscription, reply);
      return;
    }
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    clearTimeout(pending.timer);
    if (reply.error) {
      pending.reject(replyError(reply.error));
    } else {
      pending.resolve(reply.result?.data);
    }
  }

  /** Open a subscription. The returned function stops it; calling it after the end is harmless. */
  subscribe(path: string, input: unknown, handlers: BridgeSubscriptionHandlers): () => void {
    const id = this.nextId++;
    this.subscriptions.set(id, handlers);
    try {
      this.send(JSON.stringify({ id, jsonrpc: "2.0", method: "subscription", params: { path, input } }));
    } catch (error) {
      this.subscriptions.delete(id);
      const failure = error instanceof Error ? error : new Error(String(error));
      queueMicrotask(() => handlers.onEnd?.(failure));
      return () => {};
    }
    return () => {
      if (!this.subscriptions.delete(id)) return;
      try {
        this.send(JSON.stringify({ id, jsonrpc: "2.0", method: "subscription.stop" }));
      } catch {
        // The channel is gone, and the bridge stops the stream with it.
      }
    };
  }

  failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const subscriptions = [...this.subscriptions.values()];
    this.subscriptions.clear();
    for (const subscription of subscriptions) subscription.onEnd?.(error);
  }

  private handleSubscriptionReply(id: number, handlers: BridgeSubscriptionHandlers, reply: BridgeReply): void {
    if (reply.error) {
      this.subscriptions.delete(id);
      handlers.onEnd?.(replyError(reply.error));
      return;
    }
    const result = reply.result;
    if (result?.type === "started") {
      handlers.onStarted?.();
    } else if (result?.type === "stopped") {
      this.subscriptions.delete(id);
      handlers.onEnd?.();
    } else if (result?.type === "data") {
      // A tracked event arrives as `{ id, data: { id, data } }`; hand over the inner data.
      if (typeof result.id === "string") {
        const inner = result.data as { data?: unknown } | null;
        handlers.onData(inner && typeof inner === "object" && "data" in inner ? inner.data : inner, result.id);
      } else {
        handlers.onData(result.data);
      }
    }
  }

  private call<T>(method: "query" | "mutation", path: string, input: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The host didn't answer ${path} in time`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.send(JSON.stringify({ id, jsonrpc: "2.0", method, params: { path, input } }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
