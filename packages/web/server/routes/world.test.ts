import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installScoutApiMiddleware } from "../server-core.ts";
import { createWorldWeekService } from "../world-week.ts";
import { createWorldStashStore, WORLD_STASH_CAP } from "../world-stash.ts";
import { createTeamWeekService } from "../world-team.ts";
import { mountWorldRoutes } from "./world.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const headers = { authorization: "Bearer operator-test", "content-type": "application/json", origin: "http://localhost" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "world-routes-")); roots.push(root);
  // home is the temp root; the session works in ~/dev/proj, the only approved preview root
  const project = join(root, ".claude/projects/p"), cwd = join(root, "dev/proj");
  await Promise.all([mkdir(project, { recursive: true }), mkdir(cwd, { recursive: true }), mkdir(join(root, "notes"), { recursive: true })]);
  const file = join(cwd, "allowed.txt"), image = join(cwd, "image.png"), svg = join(cwd, "pic.svg"), html = join(cwd, "page.html"), pdf = join(cwd, "doc.pdf"), now = Date.now();
  const outside = join(root, "notes/secret.txt"), escape = join(cwd, "link.txt"), dotenv = join(cwd, ".env"), traversal = `${cwd}/../notes/secret.txt`;
  await writeFile(file, "A".repeat(400_001)); await writeFile(image, new Uint8Array([1, 2, 3]));
  await writeFile(svg, `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`);
  await writeFile(html, "<script>alert(1)</script>"); await writeFile(pdf, "%PDF-1.4\n");
  await writeFile(outside, "outside the roots"); await writeFile(dotenv, "OPENAI_API_KEY=sk-x");
  await symlink(outside, escape);
  const read = [file, image, svg, html, pdf, outside, escape, dotenv, traversal];
  await writeFile(join(project, "fixture-session.jsonl"), JSON.stringify({ type: "assistant", timestamp: new Date(now - 10).toISOString(), cwd, message: { content: read.map(path => ({ type: "tool_use", name: "Read", input: { file_path: path } })) } }));
  const week = createWorldWeekService({ home: root, readBroker: () => ({ asks: [], messages: [], actors: [], agents: [] }), readHosts: async () => [] });
  const stashPath = join(root, "state/world-modale-stash.json"), opened: [string, string][] = [];
  const app = new Hono();
  installScoutApiMiddleware(app, "world-test", { authToken: "operator-test" });
  const teamDir = join(root, "world-team");
  const toursDir = join(root, "world-tours");
  mountWorldRoutes(app, { week, team: createTeamWeekService({ dir: teamDir }), stash: createWorldStashStore(stashPath), openFile: async (p, action) => { opened.push([p, action]); }, toursDir });
  return { app, root, file, image, svg, html, pdf, outside, escape, dotenv, traversal, stashPath, opened, teamDir, now, toursDir };
}
const api = "http://localhost/api/ops";
describe("World routes behind the existing trust gate", () => {
  test("requires operator authentication for every route and rejects foreign origins", async () => {
    const { app } = await fixture();
    for (const path of ["world-week", "world-file", "world-stash", "world-tour"]) {
      expect((await app.request(`${api}/${path}`)).status).toBe(401);
      expect((await app.request(`${api}/${path}`, { headers: { ...headers, origin: "https://foreign.example" } })).status).toBe(403);
    }
  });
  test("serves tours by name from the tours folder, lists them, and refuses names that could leave it", async () => {
    const { app, toursDir, root } = await fixture();
    expect(await (await app.request(`${api}/world-tour`, { headers })).json()).toEqual([]);
    await mkdir(toursDir, { recursive: true });
    await writeFile(join(toursDir, "the-week.tour"), "name The Week\nt=0 speed 1h/s\n");
    await writeFile(join(toursDir, "notes.txt"), "not a tour");
    await writeFile(join(root, "outside.tour"), "t=0 play\n");
    const one = await app.request(`${api}/world-tour?name=the-week`, { headers });
    expect(one.status).toBe(200); expect(await one.text()).toBe("name The Week\nt=0 speed 1h/s\n");
    expect(one.headers.get("content-type")).toContain("text/plain");
    expect(await (await app.request(`${api}/world-tour`, { headers })).json()).toEqual(["the-week"]);
    expect((await app.request(`${api}/world-tour?name=missing`, { headers })).status).toBe(404);
    for (const bad of ["../outside", "..", "a/b", ".hidden", ""]) expect((await app.request(`${api}/world-tour?name=${encodeURIComponent(bad)}`, { headers })).status).toBe(400);
    await writeFile(join(toursDir, "huge.tour"), "#".repeat(64 * 1024 + 1));
    expect((await app.request(`${api}/world-tour?name=huge`, { headers })).status).toBe(404);
  });
  test("returns the week contract with a capped days query", async () => {
    const { app } = await fixture();
    const response = await app.request(`${api}/world-week?days=99`, { headers });
    const data = await response.json();
    expect(response.status).toBe(200); expect(data.now - data.from).toBe(14 * 864e5);
    expect(data.events).toHaveLength(9); expect(data.events[0]).toHaveLength(7);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  test("starts with four hours of calls and includes older calls only on a wider read", async () => {
    const { app, root, now } = await fixture();
    const calls = [3, 6, 48].map(hours => JSON.stringify({
      type: "assistant", timestamp: new Date(now - hours * 36e5).toISOString(), cwd: join(root, "dev/proj"),
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: join(root, "dev/proj/allowed.txt") } }] },
    }));
    await writeFile(join(root, ".claude/projects/p/history.jsonl"), calls.join("\n"));
    for (const [hours, expected] of [[4, 10], [24, 11], [168, 12], [4, 10]]) {
      const response = await app.request(`${api}/world-week?hours=${hours}`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.now - data.from).toBe(hours * 36e5);
      expect(data.events).toHaveLength(expected);
    }
  });
  test("serves the machines-as-team week from collected snapshots, and says how to collect when there are none", async () => {
    const { app, teamDir, now } = await fixture();
    const empty = await app.request(`${api}/world-week?data=team`, { headers });
    expect(empty.status).toBe(404); expect((await empty.json()).error).toContain("world-team.ts --hosts");
    await mkdir(join(teamDir, "snapshots"), { recursive: true });
    await writeFile(join(teamDir, "hosts.json"), JSON.stringify({ hosts: [{ host: "mini", persona: "Mini", ssh: "mini" }] }));
    await writeFile(join(teamDir, "snapshots/mini.json"), JSON.stringify({
      v: 1, host: "mini", home: "/example/operator", at: now, from: now - 7 * 864e5, now, sessions: [{ sid: "dddd4444", h: "claude" }],
      raw: [[now - 48 * 36e5, "~/dev/lattices", "claude", "dddd4444", "Bash", "older run"],
        [now - 60_000, "~/dev/lattices", "claude", "dddd4444", "Bash", "bun test"]], inbound: [[now - 70_000, "dddd4444", "Run the lattices tests"]],
      usage: [], files: {}, roots: {}, repos: { "~/dev/lattices": { origin: "", branches: [], worktrees: [] } }, broker: null, ms: 1,
    }));
    const response = await app.request(`${api}/world-week?data=team`, { headers });
    const a = await response.json(), b = await (await app.request(`${api}/world-week?data=team`, { headers })).json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(a.label).toBe("TEAM · 1 MACHINE"); expect(a.now - a.from).toBe(7 * 864e5);
    expect(a.actors.filter((x: { kind: string }) => x.kind === "person").map((x: { name: string }) => x.name)).toEqual(["Mini"]);
    expect(a.hosts).toMatchObject([{ name: "Mini", host: "mini", stale: false }]);
    expect(a.events[0]).toHaveLength(7); expect(a.allow).toEqual([]); expect(b).toEqual(a);
    // Concurrent readers must receive the history they selected, in either encoding.
    const [short, day] = await Promise.all([
      app.request(`${api}/world-week?data=team&hours=4`, { headers }),
      app.request(`${api}/world-week?data=team&hours=24`, { headers: { ...headers, "accept-encoding": "gzip" } }),
    ]);
    const four = await short.json(), oneDay = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await day.arrayBuffer()))));
    expect(four.now - four.from).toBe(4 * 36e5);
    expect(oneDay.now - oneDay.from).toBe(24 * 36e5);
    expect(four.events).toHaveLength(1);
    expect(a.events).toHaveLength(2);
    const zipped = await app.request(`${api}/world-week?data=team`, { headers: { ...headers, "accept-encoding": "gzip, br" } });
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await zipped.arrayBuffer()))))).toEqual(a);
  });
  test("denies /etc/passwd and relative aliases with 404 for both methods", async () => {
    const { app, opened } = await fixture();
    for (const p of ["/etc/passwd", "allowed.txt"]) {
      expect((await app.request(`${api}/world-file?p=${encodeURIComponent(p)}`, { headers })).status).toBe(404);
      expect((await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p, action: "open" }) })).status).toBe(404);
    }
    expect(opened).toEqual([]);
  });
  test("previews only realpaths inside an approved root: no traversal, symlink escape, deny-listed or outside-root files", async () => {
    const { app, file, outside, escape, dotenv, traversal, opened } = await fixture();
    const week = await (await app.request(`${api}/world-week`, { headers })).json();
    expect(week.allow).toContain(file);
    for (const p of [outside, escape, dotenv, traversal]) {
      expect(week.allow).not.toContain(p);
      expect((await app.request(`${api}/world-file?p=${encodeURIComponent(p)}`, { headers })).status).toBe(404);
      expect((await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p, action: "open" }) })).status).toBe(404);
    }
    expect(opened).toEqual([]);
  });
  test("re-checks containment at open time: a file swapped for an escaping symlink after the week was built is refused", async () => {
    const { app, file, outside } = await fixture();
    expect((await app.request(`${api}/world-file?p=${encodeURIComponent(file)}`, { headers })).status).toBe(200);
    await rm(file); await symlink(outside, file);
    expect((await app.request(`${api}/world-file?p=${encodeURIComponent(file)}`, { headers })).status).toBe(404);
  });
  test("every preview carries the sandbox CSP and nosniff; an SVG opened top-level comes back as text", async () => {
    const { app, file, image, svg, html, pdf } = await fixture();
    const get = (p: string, dest?: string) => app.request(`${api}/world-file?p=${encodeURIComponent(p)}`, { headers: dest ? { ...headers, "sec-fetch-dest": dest } : headers });
    for (const [p, dest, type] of [[svg, "image", "image/svg+xml"], [svg, "document", "text/plain; charset=utf-8"], [svg, "iframe", "text/plain; charset=utf-8"], [html, "document", "text/plain; charset=utf-8"],
      [html, undefined, "text/plain; charset=utf-8"], [file, undefined, "text/plain; charset=utf-8"], [image, "image", "image/png"], [pdf, "iframe", "application/pdf"]] as const) {
      const r = await get(p, dest);
      expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe(type);
      const csp = r.headers.get("content-security-policy") || "";
      expect(csp.split(";")[0].trim()).toBe("sandbox"); expect(csp).toContain("default-src 'none'");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
  test("serves capped text and binary with the Studio metadata headers", async () => {
    const { app, file, image } = await fixture();
    const text = await app.request(`${api}/world-file?p=${encodeURIComponent(file)}`, { headers });
    expect(text.status).toBe(200); expect((await text.text()).length).toBe(400_000);
    expect(text.headers.get("x-truncated")).toBe("1"); expect(text.headers.get("x-size")).toBe("400001");
    expect(Number(text.headers.get("x-mtime"))).toBeGreaterThan(0);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const binary = await app.request(`${api}/world-file?p=${encodeURIComponent(image)}`, { headers });
    expect(binary.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  test("rejects foreign POST with 403 and bad action with 400; forwards open/reveal as arguments", async () => {
    const { app, file, opened } = await fixture();
    const foreign = await app.request(`${api}/world-file`, { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: JSON.stringify({ p: file, action: "open" }) });
    expect(foreign.status).toBe(403);
    const bad = await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p: file, action: "delete" }) });
    expect(bad.status).toBe(400); expect(opened).toEqual([]);
    for (const action of ["open", "reveal"]) {
      const result = await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p: file, action }) });
      expect(await result.json()).toEqual({ ok: true });
    }
    const real = await realpath(file);
    expect(opened).toEqual([[real, "open"], [real, "reveal"]]);
  });
  test("persists opaque cards across store instances, caps bytes, and rejects invalid stash JSON", async () => {
    const { app, stashPath } = await fixture();
    expect(await (await app.request(`${api}/world-stash`, { headers })).json()).toEqual([]);
    const cards = [{ f: { abs: "/anything", disp: "whatever" }, ctx: null, x: 10, y: 20, future: { keep: true } }];
    const put = await app.request(`${api}/world-stash`, { method: "PUT", headers, body: JSON.stringify(cards) });
    expect(await put.json()).toEqual({ ok: true });
    expect(await (await app.request(`${api}/world-stash`, { headers })).json()).toEqual(cards);
    expect(await createWorldStashStore(stashPath).read()).toEqual(cards);
    expect(JSON.parse(await readFile(stashPath, "utf8"))).toEqual(cards);
    expect((await stat(stashPath)).mode & 0o777).toBe(0o600);
    for (const body of ["{}", "[null]", "[1]", "bad json"]) {
      expect((await app.request(`${api}/world-stash`, { method: "PUT", headers, body })).status).toBe(400);
    }
    expect((await app.request(`${api}/world-stash`, { method: "PUT", headers, body: JSON.stringify([{ huge: "x".repeat(WORLD_STASH_CAP) }]) })).status).toBe(413);
    expect((await app.request(`${api}/world-stash`, { method: "PUT", headers: { ...headers, origin: "https://foreign.example" }, body: "[]" })).status).toBe(403);
    expect(await createWorldStashStore(stashPath).read()).toEqual(cards);
  });
});

describe("Review routes", () => {
  async function reviewApp(file: (p: string, as: "head" | "raw" | "text") => Promise<unknown>) {
    const root = await mkdtemp(join(tmpdir(), "review-routes-")); roots.push(root);
    const image = join(root, "shot.png"); await writeFile(image, new Uint8Array([137, 80, 78, 71]));
    const days: number[] = [];
    const review = {
      json: async (d: number) => { days.push(d); return JSON.stringify({ days: d }); },
      data: async () => { throw new Error("unused"); },
      file: async (p: string, as: "head" | "raw" | "text") => (await file(p, as)) as never,
    };
    const app = new Hono();
    installScoutApiMiddleware(app, "review-test", { authToken: "operator-test" });
    mountWorldRoutes(app, { week: createWorldWeekService({ home: root, readBroker: () => ({ asks: [], messages: [], actors: [], agents: [] }), readHosts: async () => [] }), review });
    return { app, image, days };
  }
  test("the window: operator only, days clamped, never cached", async () => {
    const { app, days } = await reviewApp(async () => null);
    expect((await app.request(`${api}/review`)).status).toBe(401);
    const res = await app.request(`${api}/review?days=30`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ days: 7 });
    await app.request(`${api}/review`, { headers });
    expect(days).toEqual([7, 2]);
  });
  test("the pull requests: operator only, days clamped, never cached, gh trouble a warning in the body", async () => {
    const root = await mkdtemp(join(tmpdir(), "review-routes-")); roots.push(root);
    const days: number[] = [];
    const body = { from: 0, at: 0, me: "", repos: [], pulls: [], warnings: ["gh is not installed: pull requests are not shown"] };
    const reviewGithub = { data: async () => body, json: async (d: number) => { days.push(d); return JSON.stringify(body); } };
    const app = new Hono();
    installScoutApiMiddleware(app, "review-test", { authToken: "operator-test" });
    mountWorldRoutes(app, { week: createWorldWeekService({ home: root, readBroker: () => ({ asks: [], messages: [], actors: [], agents: [] }), readHosts: async () => [] }), reviewGithub });
    expect((await app.request(`${api}/review-github`)).status).toBe(401);
    const res = await app.request(`${api}/review-github?days=30`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(body);
    await app.request(`${api}/review-github`, { headers });
    expect(days).toEqual([7, 2]);
  });
  test("a file: the head or the source as JSON, an image as sandboxed bytes, anything refused is a 404", async () => {
    const { app, image } = await reviewApp(async (p, as) =>
      p === "~/a.ts" && as === "head" ? { kind: "head", body: { path: p, head: "x", lines: 1, mt: 1 } }
        : p === "~/a.ts" && as === "text" ? { kind: "text", body: { path: p, text: "x\ny", lines: 2, cut: 0, mt: 1 } }
        : p === "~/shot.png" && as === "raw" ? { kind: "raw", real: image } : null);
    expect((await app.request(`${api}/review-file?p=~/a.ts`)).status).toBe(401);
    const head = await app.request(`${api}/review-file?p=${encodeURIComponent("~/a.ts")}&as=head`, { headers });
    expect(await head.json()).toEqual({ path: "~/a.ts", head: "x", lines: 1, mt: 1 });
    const text = await app.request(`${api}/review-file?p=${encodeURIComponent("~/a.ts")}&as=text`, { headers });
    expect(text.headers.get("cache-control")).toBe("no-store");
    expect(await text.json()).toEqual({ path: "~/a.ts", text: "x\ny", lines: 2, cut: 0, mt: 1 });
    const raw = await app.request(`${api}/review-file?p=${encodeURIComponent("~/shot.png")}&as=raw`, { headers });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");
    expect(raw.headers.get("x-content-type-options")).toBe("nosniff");
    expect(raw.headers.get("content-security-policy")).toContain("sandbox");
    expect((await app.request(`${api}/review-file?p=${encodeURIComponent("~/.ssh/id_rsa")}&as=head`, { headers })).status).toBe(404);
  });
});

describe("canvas routes", () => {
  async function canvasApp(opened: Array<[string, number | undefined]> = []) {
    const root = await mkdtemp(join(tmpdir(), "canvas-routes-")); roots.push(root);
    const image = join(root, "shot.png"), film = join(root, "clip.mp4"), other = join(root, "notes.txt");
    await writeFile(image, new Uint8Array([137, 80, 78, 71]));
    await writeFile(film, new Uint8Array(Array.from({ length: 100 }, (_, i) => i)));
    await writeFile(other, "x");
    const canvas = {
      data: async (h: number, end?: string) => ({ hours: h, end: end ?? null }),
      real: async (p: string) => (p === "~/shot.png" ? image : p === "~/clip.mp4" ? film : p === "~/notes.txt" ? other : null),
      head: async (p: string) => (p === "~/n.md" ? { path: p, head: "# N", lines: 1, mt: 1 } : null),
      diff: async (p: string, since?: string) => (p === "~/notes.txt" ? { path: p, from: since ? "since" : "uncommitted", diff: "@@ -1 +1 @@\n-x\n+y", cut: 0 } : null),
      commitDiff: async (key: string, since: string) => (key === "proj:a.ts" && since === "abc1234" ? { path: key, from: "commits", diff: "@@ -1 +1 @@\n-x\n+y", cut: 0 } : null),
    };
    const app = new Hono();
    installScoutApiMiddleware(app, "canvas-test", { authToken: "operator-test" });
    mountWorldRoutes(app, { week: createWorldWeekService({ home: root, readBroker: () => ({ asks: [], messages: [], actors: [], agents: [] }), readHosts: async () => [] }), canvas: canvas as never,
      openInEditor: async (path, line) => { opened.push([path, line]); return { editor: "Cursor" }; } });
    return app;
  }
  const file = (p: string, as: string) => `${api}/canvas-file?p=${encodeURIComponent(p)}&as=${as}`;

  test("the canvas: operator only, the last 4 hours unless asked, hours clamped, an older ?days= read as days", async () => {
    const app = await canvasApp();
    expect((await app.request(`${api}/canvas`)).status).toBe(401);
    const hours = async (q: string) => (await (await app.request(`${api}/canvas${q}`, { headers })).json()).hours;
    expect([await hours(""), await hours("?hours=1"), await hours("?hours=999"), await hours("?hours=x"), await hours("?days=30"), await hours("?days=1")]).toEqual([4, 1, 168, 4, 168, 24]);
    // a past window's end goes to the canvas, which clamps it (server/canvas.ts)
    expect(await (await app.request(`${api}/canvas?hours=4&end=1763060400000`, { headers })).json()).toEqual({ hours: 4, end: "1763060400000" });
    expect((await (await app.request(`${api}/canvas`, { headers })).json()).end).toBeNull();
  });

  test("a film streams by range; an image is sandboxed bytes; anything else is a 404", async () => {
    const app = await canvasApp();
    expect((await app.request(file("~/clip.mp4", "raw"))).status).toBe(401);

    const whole = await app.request(file("~/clip.mp4", "raw"), { headers });
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(100);

    const part = await app.request(file("~/clip.mp4", "raw"), { headers: { ...headers, range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/100");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    const past = await app.request(file("~/clip.mp4", "raw"), { headers: { ...headers, range: "bytes=200-" } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */100");

    const img = await app.request(file("~/shot.png", "raw"), { headers });
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");

    expect((await app.request(file("~/notes.txt", "raw"), { headers })).status).toBe(404);
    expect((await app.request(file("~/.ssh/id_rsa", "raw"), { headers })).status).toBe(404);
    expect(await (await app.request(file("~/n.md", "head"), { headers })).json()).toEqual({ path: "~/n.md", head: "# N", lines: 1, mt: 1 });
    expect((await app.request(file("~/x.md", "head"), { headers })).status).toBe(404);
    expect(await (await app.request(`${file("~/notes.txt", "diff")}&since=abc1234`, { headers })).json()).toMatchObject({ from: "since" });
    expect(await (await app.request(file("~/notes.txt", "diff"), { headers })).json()).toMatchObject({ from: "uncommitted" });
    expect((await app.request(file("~/x.ts", "diff"), { headers })).status).toBe(404);
    // a gone copy, by its key and first commit
    expect(await (await app.request("/api/ops/canvas-file?key=proj%3Aa.ts&as=diff&since=abc1234", { headers })).json()).toMatchObject({ from: "commits" });
    expect((await app.request("/api/ops/canvas-file?key=proj%3Aa.ts&as=diff", { headers })).status).toBe(404);
    expect((await app.request("/api/ops/canvas-file?key=proj%3Ab.ts&as=diff&since=abc1234", { headers })).status).toBe(404);
  });

  test("a listed text file opens in the host's editor at a line; media and unlisted paths do not", async () => {
    const opened: Array<[string, number | undefined]> = [];
    const app = await canvasApp(opened);
    const post = (body: unknown, h: Record<string, string> = headers) =>
      app.request(`${api}/canvas-file/editor`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ p: "~/notes.txt", line: 3 }, {})).status).toBe(401);
    const ok = await post({ p: "~/notes.txt", line: 3 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, editor: "Cursor" });
    expect((await post({ p: "~/notes.txt", line: -2 })).status).toBe(200);
    expect((await post({ p: "~/shot.png" })).status).toBe(415);
    expect((await post({ p: "~/.ssh/id_rsa" })).status).toBe(404);
    expect((await post({})).status).toBe(404);
    expect(opened.map(([path, line]) => [path.slice(path.lastIndexOf("/") + 1), line])).toEqual([["notes.txt", 3], ["notes.txt", undefined]]);
  });
});

describe("Overview › Dismiss an undelivered message", () => {
  function dismissApp(open: Record<string, { ended_at?: number | null }>, fail = false) {
    const calls: unknown[] = [];
    const app = new Hono();
    installScoutApiMiddleware(app, "world-test", { authToken: "operator-test" });
    mountWorldRoutes(app, { deliveries: {
      lookup: id => open[id] ? { id, created_at: 1, done_at: null, status: "pending", from: "system", to: "session-a", to_name: "session-a", transport: "tmux", text: "x", error: null, ended_at: open[id].ended_at ?? null } : null,
      setStatus: async body => { if (fail) throw new Error("runtime down"); calls.push(body); return { ok: true }; },
    } });
    const post = (body: unknown, extra: Record<string, string> = {}) => app.request(`${api}/world-delivery/dismiss`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    return { app, calls, post };
  }
  test("needs the operator and this origin", async () => {
    const { app, post, calls } = dismissApp({ d1: {} });
    expect((await app.request(`${api}/world-delivery/dismiss`, { method: "POST", body: JSON.stringify({ id: "d1" }) })).status).toBe(401);
    expect((await post({ id: "d1" }, { origin: "https://foreign.example" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
  test("refuses a bad id and one the runtime holds no open delivery for", async () => {
    const { post, calls } = dismissApp({ d1: {} });
    expect((await post({})).status).toBe(400);
    expect((await post({ id: "a b/../c" })).status).toBe(400);
    expect((await post({ id: "d9" })).status).toBe(404);
    expect(calls).toEqual([]);
  });
  test("records the delivery as cancelled by the operator, with when its session ended", async () => {
    const { post, calls } = dismissApp({ d1: { ended_at: 5000 } });
    const r = await post({ id: "d1" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: "d1", status: "cancelled" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ deliveryId: "d1", status: "cancelled", metadata: { cancelledBy: "operator", cancelReason: "dismissed from the Overview", targetEndedAt: 5000 } });
  });
  test("says so when the runtime does not take it", async () => {
    const { post } = dismissApp({ d1: {} }, true);
    const r = await post({ id: "d1" });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("the runtime did not take the change");
  });
});
