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
    const html = await shell.text();
    expect(html).toContain('src="/assets/preview.js"');
    // Display-only: the app names the runtime it reads, never a credential.
    expect(html).toContain(`<meta name="scout-runtime-url" content="${absent.url.origin}">`);
    expect(html).toContain('<meta name="scout-runtime-kind" content="existing">');
    for (const path of ["/", "/feed", "/chat", "/sessions", "/board", "/control", "/sessions/s%3Aone"]) expect((await read(path)).status).toBe(200);
    for (const path of ["/embed/chat", "/feed/extra", "/sessions/a/b"]) expect((await read(path)).status).toBe(404);
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

test("T3 Code: app pages may frame the configured loopback origin; /embed/feed is unchanged; status reports framing honestly", async () => {
  const absent = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 503 }) });
  const seen: Headers[] = [];
  let headers: Record<string, string> = {};
  const t3 = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) { seen.push(req.headers); return new Response("<!doctype html>", { headers }); } });
  const plain = await servePreview(absent.url.origin, 0);
  const host = await servePreview(absent.url.origin, 0, { t3code: t3.url.origin });
  const read = (base: URL, path: string) => fetch(new URL(path, base));
  try {
    // The embed document and its policy are byte-for-byte what they were without T3 Code.
    const embed = await read(host.url, "/embed/feed");
    const before = await read(plain.url, "/embed/feed");
    expect(await embed.text()).toBe(await before.text());
    expect(embed.headers.get("content-security-policy")).toBe(before.headers.get("content-security-policy"));
    expect(embed.headers.get("content-security-policy")).not.toContain("frame-src");

    // App pages name the origin, display-only, and allow framing exactly that origin.
    const app = await read(host.url, "/t3code");
    expect(app.status).toBe(200);
    expect(await app.text()).toContain(`<meta name="scout-t3code-url" content="${t3.url.origin}">`);
    expect(app.headers.get("content-security-policy")).toContain(`frame-src ${t3.url.origin};`);
    expect(app.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await (await read(plain.url, "/t3code")).text()).not.toContain("scout-t3code-url");

    const status = async (base: URL) => (await read(base, "/api/t3code")).json();
    expect(await status(plain.url)).toEqual({ configured: false });
    expect(await status(host.url)).toEqual({ configured: true, url: t3.url.origin, reachable: true, frameBlocked: false });
    headers = { "x-frame-options": "DENY" };
    expect(await status(host.url)).toEqual({ configured: true, url: t3.url.origin, reachable: true, frameBlocked: true, blockedBy: "x-frame-options" });
    headers = { "content-security-policy": "frame-ancestors 'self'" };
    expect(await status(host.url)).toEqual({ configured: true, url: t3.url.origin, reachable: true, frameBlocked: true, blockedBy: "frame-ancestors" });
    headers = { "content-security-policy": `frame-ancestors ${host.url.origin}`, "x-frame-options": "DENY" };
    expect(await status(host.url)).toEqual({ configured: true, url: t3.url.origin, reachable: true, frameBlocked: false });
    // The probe forwards nothing from the browser's request.
    expect(seen.every(h => !h.has("cookie") && !h.has("authorization") && !h.has("origin"))).toBe(true);

    await t3.stop(true);
    expect(await status(host.url)).toEqual({ configured: true, url: t3.url.origin, reachable: false });
    await expect(servePreview(absent.url.origin, 0, { t3code: "https://t3.example.test" })).rejects.toThrow("loopback");
  } finally { await host.close(); await plain.close(); await absent.stop(true); await t3.stop(true); }
});
