import { afterEach, expect, test } from "bun:test";

import { relayEventStream } from "./server-core.ts";

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** An upstream that sends one event and then one more every 20 ms, forever. */
function upstream(): string {
  const encoder = new TextEncoder();
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      let timer: ReturnType<typeof setInterval> | undefined;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: first\n\n"));
          timer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode("data: tick\n\n"));
            } catch {
              clearInterval(timer);
            }
          }, 20);
        },
        cancel() {
          clearInterval(timer);
        },
      }), { headers: { "content-type": "text/event-stream" } });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/events`;
}

// #1546: a client leaving mid-stream closed the relay's stream, the pump then
// closed it again, and that throw escaped unhandled and ended the server.
test("a client that leaves mid-stream ends its relay quietly", async () => {
  const escaped: unknown[] = [];
  const onRejection = (reason: unknown) => { escaped.push(reason); };
  process.on("unhandledRejection", onRejection);
  try {
    // A browser leaving does both at once: Bun cancels the response and aborts the request.
    for (const leave of ["cancel", "abort", "abort-then-cancel", "cancel-then-abort"] as const) {
      const client = new AbortController();
      const res = await relayEventStream(upstream(), { signal: client.signal });
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("data: first");
      if (leave === "cancel") await reader.cancel();
      else if (leave === "abort") client.abort();
      else if (leave === "abort-then-cancel") { client.abort(); void reader.cancel(); }
      else { void reader.cancel(); client.abort(); }
      // Let the pump see the end and the upstream keep sending.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    expect(escaped).toEqual([]);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("an upstream that ends closes the relay once, with every event through", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("data: one\n\ndata: two\n\n", { headers: { "content-type": "text/event-stream" } }) });
  servers.push(server);
  const res = await relayEventStream(`http://127.0.0.1:${server.port}/events`);
  expect(await res.text()).toBe("data: one\n\ndata: two\n\n");
});
