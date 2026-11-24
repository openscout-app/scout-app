import { expect, test } from "bun:test";
import { servePreview } from "./preview-host.ts";

test("preview serves the bundled client, keeps missing routes out of the shell, and never pretends an offline runtime is empty", async () => {
  // An intentionally unavailable area of a test-owned loopback service.
  let calls = 0;
  const absent = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { calls++; return new Response(null, { status: 503 }); } });
  const host = await servePreview(absent.url.origin, 0);
  const read = (path: string, init?: RequestInit) => fetch(new URL(path, host.url), init);
  try {
    const shell = await read("/embed/feed");
    expect(await shell.text()).toContain('src="/assets/preview.js"');
    for (const file of ["js", "css"]) expect((await read("/assets/preview." + file)).status).toBe(200);
    expect((await read("/c/chat?workId=one")).status).toBe(200);
    expect((await read("/missing")).status).toBe(404);
    expect((await read("/api/not-mounted")).headers.get("content-type")).toContain("application/json");
    expect((await read("/api/feed", { method: "POST" })).status).toBe(405);
    expect((await read("/api/feed", { headers: { origin: "https://example.invalid" } })).status).toBe(403);
    expect(calls).toBe(0);
    expect((await read("/api/feed")).status).toBe(503);
    expect(calls).toBe(1);
  } finally { await host.close(); await absent.stop(true); }
});
