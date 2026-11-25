/**
 * Scoutbot's line to the broker: the local Unix socket and nothing else.
 * There is no HTTP fallback on purpose; if the socket is gone the broker is
 * gone, and the supervisor restarts Scoutbot with the broker.
 */

export type ScoutbotBrokerLink = {
  readonly socketPath: string;
  getJson: <T>(path: string, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>;
  postJson: <T = { ok: true }>(path: string, body: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<T>;
  /** Reads an SSE route until it ends or `signal` aborts, one block at a time. */
  stream: (path: string, onBlock: (block: string) => void, signal: AbortSignal) => Promise<void>;
};

export class ScoutbotBrokerError extends Error {
  constructor(readonly status: number, path: string, body: string) {
    super(`${path} returned ${status}${body ? `: ${body}` : ""}`);
    this.name = "ScoutbotBrokerError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createScoutbotBrokerLink(input: {
  socketPath: string;
  /** Names request URLs only; the host part never leaves this process. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /**
   * Headers for every write: the answerer claim of the generation that made
   * this link. It throws once that claim is lost, so a write from a lost
   * generation fails here instead of borrowing a successor's claim. Reads
   * never carry it.
   */
  writeHeaders?: () => Record<string, string>;
}): ScoutbotBrokerLink {
  const baseUrl = input.baseUrl ?? "http://localhost";
  const fetchImpl = input.fetch ?? fetch;
  const request = (path: string, init: RequestInit & { timeoutMs?: number }) => {
    const signals = [AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)];
    if (init.signal) signals.push(init.signal);
    return fetchImpl(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.any(signals),
      unix: input.socketPath,
    } as RequestInit);
  };
  const readJson = async <T>(path: string, response: Response): Promise<T> => {
    const text = await response.text();
    if (!response.ok) throw new ScoutbotBrokerError(response.status, path, text);
    return (text ? JSON.parse(text) : { ok: true }) as T;
  };

  return {
    socketPath: input.socketPath,
    getJson: async (path, options = {}) =>
      readJson(path, await request(path, { method: "GET", ...options })),
    postJson: async (path, body, options = {}) =>
      readJson(path, await request(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...input.writeHeaders?.() },
        body: JSON.stringify(body),
        ...options,
      })),
    stream: async (path, onBlock, signal) => {
      const response = await fetchImpl(new URL(path, baseUrl), {
        headers: { accept: "text/event-stream" },
        signal,
        unix: input.socketPath,
      } as RequestInit);
      if (!response.ok || !response.body) {
        throw new ScoutbotBrokerError(response.status, path, await response.text().catch(() => ""));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          onBlock(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf("\n\n");
        }
      }
    },
  };
}

export function parseSseBlock(block: string): { eventName: string; data: unknown } | null {
  const trimmed = block.trim();
  if (!trimmed) return null;
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (!eventName || dataLines.length === 0) return null;
  try {
    return { eventName, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
