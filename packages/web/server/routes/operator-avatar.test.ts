import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountOperatorAvatarRoutes, operatorAvatarReader, sizedAvatarUrl, type AvatarSource } from "./operator-avatar.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function source(over: Partial<AvatarSource> & { calls?: { gh: number; fetch: string[] } } = {}) {
  const calls = over.calls ?? { gh: 0, fetch: [] };
  let clock = 0;
  const s: AvatarSource & { calls: typeof calls; tick(ms: number): void } = {
    calls,
    tick: (ms) => { clock += ms; },
    avatarUrl: over.avatarUrl ?? (async () => { calls.gh++; return "https://avatars.githubusercontent.com/u/42?v=4"; }),
    fetch: over.fetch ?? (async (url) => { calls.fetch.push(url); return new Response(PNG, { headers: { "content-type": "image/png" } }); }),
    now: () => clock,
  };
  return s;
}

describe("operator avatar", () => {
  test("sizes GitHub avatar URLs and refuses any other host", () => {
    expect(sizedAvatarUrl("https://avatars.githubusercontent.com/u/42?v=4")).toBe("https://avatars.githubusercontent.com/u/42?v=4&s=96");
    expect(sizedAvatarUrl("https://evil.example/u/42")).toBeNull();
    expect(sizedAvatarUrl("http://avatars.githubusercontent.com/u/42")).toBeNull();
    expect(sizedAvatarUrl("not a url")).toBeNull();
  });

  test("serves the photo from this host and asks gh once", async () => {
    const s = source();
    const app = new Hono();
    mountOperatorAvatarRoutes(app, operatorAvatarReader(s));
    const [a, b] = await Promise.all([app.request("/api/operator/avatar"), app.request("/api/operator/avatar")]);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(PNG);
    expect(b.status).toBe(200);
    expect(s.calls.gh).toBe(1);
    expect(s.calls.fetch).toEqual(["https://avatars.githubusercontent.com/u/42?v=4&s=96"]);
  });

  test("404s without a GitHub login, and asks again only after the miss expires", async () => {
    const calls = { gh: 0, fetch: [] as string[] };
    const s = source({ calls, avatarUrl: async () => { calls.gh++; return null; } });
    const app = new Hono();
    mountOperatorAvatarRoutes(app, operatorAvatarReader(s));
    expect((await app.request("/api/operator/avatar")).status).toBe(404);
    expect((await app.request("/api/operator/avatar")).status).toBe(404);
    expect(calls.gh).toBe(1);
    s.tick(11 * 60_000);
    await app.request("/api/operator/avatar");
    expect(calls.gh).toBe(2);
  });

  test("refuses SVG and oversize bodies", async () => {
    const svg = source({ fetch: async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }) });
    expect(await operatorAvatarReader(svg)()).toBeNull();
    const big = source({ fetch: async () => new Response(new Uint8Array(600 * 1024), { headers: { "content-type": "image/png" } }) });
    expect(await operatorAvatarReader(big)()).toBeNull();
  });
});
