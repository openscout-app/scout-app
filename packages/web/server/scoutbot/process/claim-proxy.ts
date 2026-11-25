import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLAIM_HEADER = "x-scout-assistant-claim-token";
// The runtime's own response framing; this proxy re-frames the body.
const DROPPED_RESPONSE_HEADERS = ["content-encoding", "content-length", "transfer-encoding", "connection"];

export type ScoutbotClaimProxy = {
  /** Hand this to the Scout MCP child as its runtime socket. */
  readonly socketPath: string;
  close: () => Promise<void>;
};

/**
 * The Scout MCP child's only line to the runtime. The child makes Scoutbot's
 * asks as scoutbot, and the runtime admits those writes only with the
 * answerer claim. The claim is request context in this process: it never
 * goes into the child's environment, its arguments or a tool call. So the
 * child talks to this socket, and this process adds the claim to each write
 * on its way to the runtime socket. Reads pass through without it.
 *
 * `writeHeaders` belongs to one claim generation. Once that claim is lost it
 * throws, and a write is refused here rather than sent with no claim or with
 * a successor's claim.
 */
export function startScoutbotClaimProxy(input: {
  runtimeSocketPath: string;
  writeHeaders: () => Record<string, string>;
  fetch?: typeof fetch;
}): ScoutbotClaimProxy {
  // A private directory: mkdtemp creates it 0700, so only this user reaches it.
  const directory = mkdtempSync(join(tmpdir(), "scoutbot-mcp-"));
  const socketPath = join(directory, "runtime.sock");
  const fetchImpl = input.fetch ?? fetch;
  const server = Bun.serve({
    unix: socketPath,
    fetch: async (request, self) => {
      // invocations_wait holds a request open for up to 300 seconds; the
      // default idle timeout would cut it off at 10.
      self.timeout(request, 0);
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete(CLAIM_HEADER);
      headers.delete("host");
      const write = request.method !== "GET" && request.method !== "HEAD";
      if (write) {
        let claim: Record<string, string>;
        try {
          claim = input.writeHeaders();
        } catch {
          return Response.json({ error: "assistant_claim_lost" }, { status: 409 });
        }
        for (const [name, value] of Object.entries(claim)) headers.set(name, value);
      }
      let upstream: Response;
      try {
        upstream = await fetchImpl(new URL(`${url.pathname}${url.search}`, "http://localhost"), {
          method: request.method,
          headers,
          body: write ? await request.arrayBuffer() : undefined,
          signal: request.signal,
          unix: input.runtimeSocketPath,
        } as RequestInit);
      } catch {
        return Response.json({ error: "runtime_unreachable" }, { status: 502 });
      }
      const responseHeaders = new Headers(upstream.headers);
      for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    },
  });
  let closed = false;
  return {
    socketPath,
    close: async () => {
      if (closed) return;
      closed = true;
      await server.stop(true);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
