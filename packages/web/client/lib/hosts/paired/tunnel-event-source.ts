/**
 * An EventSource whose bytes come through the bridge's `web.stream` instead of
 * an HTTP connection. It parses the server-sent event text the host relays and
 * behaves like the browser's own: `open`, `message` and named events, and an
 * `error` followed by a reconnect when the stream drops. A host that has
 * ended the connection for good closes it instead.
 */

const DEFAULT_RETRY_MS = 3_000;

export interface ParsedServerSentEvent {
  type: string;
  data: string;
  lastEventId: string;
}

/**
 * Incremental server-sent event parser (the WHATWG event stream format): feed
 * it text as it arrives, get back each event once its blank line lands.
 */
export class ServerSentEventParser {
  private buffer = "";
  private data: string[] = [];
  private type = "";
  private lastEventId = "";
  retryMs: number | null = null;

  push(text: string): ParsedServerSentEvent[] {
    this.buffer += text;
    const events: ParsedServerSentEvent[] = [];
    let newline: RegExpExecArray | null;
    const pattern = /\r\n|\r|\n/g;
    let start = 0;
    while ((newline = pattern.exec(this.buffer))) {
      // A lone \r at the end may be the first half of \r\n; wait for more.
      if (newline[0] === "\r" && newline.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, newline.index);
      start = newline.index + newline[0].length;
      const event = this.line(line);
      if (event) events.push(event);
    }
    this.buffer = this.buffer.slice(start);
    return events;
  }

  private line(line: string): ParsedServerSentEvent | null {
    if (line === "") {
      if (this.data.length === 0) {
        this.type = "";
        return null;
      }
      const event = { type: this.type || "message", data: this.data.join("\n"), lastEventId: this.lastEventId };
      this.data = [];
      this.type = "";
      return event;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.type = value;
    else if (field === "id" && !value.includes("\0")) this.lastEventId = value;
    else if (field === "retry" && /^\d+$/.test(value)) this.retryMs = Number(value);
    return null;
  }
}

export type OpenTunnelStream = (handlers: {
  onStarted: () => void;
  onText: (text: string) => void;
  onEnd: (error?: Error, final?: boolean) => void;
}) => () => void;

export class TunnelEventSource extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private stop: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = DEFAULT_RETRY_MS;

  constructor(readonly url: string, private readonly openStream: OpenTunnelStream) {
    super();
    this.connect();
  }

  close(): void {
    this.readyState = this.CLOSED;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const stop = this.stop;
    this.stop = null;
    stop?.();
  }

  private connect(): void {
    if (this.readyState === this.CLOSED) return;
    const parser = new ServerSentEventParser();
    this.stop = this.openStream({
      onStarted: () => {
        if (this.readyState === this.CLOSED) return;
        this.readyState = this.OPEN;
        this.fire(new Event("open"), this.onopen);
      },
      onText: (text) => {
        if (this.readyState !== this.OPEN) return;
        for (const parsed of parser.push(text)) {
          const event = new MessageEvent(parsed.type, { data: parsed.data, lastEventId: parsed.lastEventId });
          this.fire(event, parsed.type === "message" ? this.onmessage : null);
        }
        if (parser.retryMs !== null) this.retryMs = parser.retryMs;
      },
      onEnd: (_error, final) => {
        this.stop = null;
        if (this.readyState === this.CLOSED) return;
        this.readyState = final ? this.CLOSED : this.CONNECTING;
        this.fire(new Event("error"), this.onerror);
        if (!final && this.readyState === this.CONNECTING) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connect();
          }, this.retryMs);
        }
      },
    });
  }

  private fire<E extends Event>(event: E, handler: ((event: E) => void) | null): void {
    this.dispatchEvent(event);
    handler?.call(this, event);
  }
}
