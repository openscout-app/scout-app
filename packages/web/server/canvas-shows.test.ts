import { describe, expect, test } from "bun:test";
import { mergeShows, runtimeShowSource, type RuntimeShow, type ShowsByRoot } from "./canvas-shows.ts";
import { CANVAS_ITEMS_PER_AGENT, type CanvasAgent, type CanvasData, type CanvasItem } from "../shared/canvas.ts";

const HOME = "/home/op";
const ROOT = "/home/op/dev/app";

function agent(over: Partial<CanvasAgent>): CanvasAgent {
  return {
    id: "s", agentId: null, name: "", harness: "claude", project: "app", worktree: "main", state: "quiet", lastAt: 1000,
    now: "", nowFile: null, ref: null, title: null, asked: null, ...over,
  };
}
function item(over: Partial<CanvasItem>): CanvasItem {
  return { key: "artifact:x", path: "~/x.png", name: "x.png", kind: "image", agent: 0, at: 500, mt: 500, how: "wrote", ...over };
}
function show(over: Partial<RuntimeShow>): RuntimeShow {
  return {
    id: "v1", itemId: "item-1", agentId: "app.claude", projectRoot: ROOT, worktree: ROOT, sourcePath: `${ROOT}/shot.png`,
    kind: "image", mediaType: "image/png", byteSize: 10, createdAt: 2000, ...over,
  };
}
function data(agents: CanvasAgent[], items: CanvasItem[] = []): CanvasData {
  return { now: 5000, from: 0, end: 5000, live: true, hours: 24, projects: [{ name: "app", main: "~/dev/app", lastAt: 1000 }], agents, items, work: [], files: [] };
}
const byRoot = (...shows: RuntimeShow[]): ShowsByRoot => new Map([[ROOT, { project: "app", shows }]]);

describe("mergeShows", () => {
  test("puts a show in the area of the session that showed it, first, with its caption", () => {
    const d = data(
      [agent({ id: "a", ref: "session:claude:sess-a" }), agent({ id: "b", ref: "session:claude:sess-b", agentId: "app.claude", lastAt: 3000 })],
      [item({ key: "artifact:old", path: "~/old.png", agent: 0, at: 900 })],
    );
    const out = mergeShows(d, byRoot(show({ sessionId: "sess-a", caption: " The new header " })), HOME);
    expect(out.items.map((i) => i.how)).toEqual(["shown", "wrote"]);
    const shown = out.items[0];
    expect(shown).toMatchObject({ agent: 0, path: "show:v1", key: "artifact:show:item-1", name: "shot.png", caption: "The new header", kind: "image" });
    expect(out.agents[0].lastAt).toBe(2000);
    expect(d.agents[0].lastAt).toBe(1000); // the build is not changed
  });

  test("without a session match, finds the agent's newest area in the project", () => {
    const d = data([agent({ id: "a", agentId: "app.claude", lastAt: 100 }), agent({ id: "b", agentId: "app.claude", lastAt: 900 }), agent({ id: "c", agentId: "app.claude", project: "other", lastAt: 4000 })]);
    expect(mergeShows(d, byRoot(show({ sessionId: "gone" })), HOME).items[0].agent).toBe(1);
  });

  test("a show from no area on the canvas gets an area of its own, shared by its other shows", () => {
    const d = data([agent({ id: "a" })]);
    const out = mergeShows(d, byRoot(show({ itemId: "i1", id: "v1", sessionId: "s9", harness: "codex", agentId: "web.codex" }), show({ itemId: "i2", id: "v2", sessionId: "s9", harness: "codex", agentId: "web.codex", createdAt: 2500 })), HOME);
    expect(out.agents).toHaveLength(2);
    expect(out.agents[1]).toMatchObject({ agentId: "web.codex", ref: "session:codex:s9", project: "app", lastAt: 2500, worktree: "main" });
    expect(out.items.every((i) => i.agent === 1)).toBe(true);
  });

  test("shows the newest version of an item and counts the others", () => {
    const out = mergeShows(data([agent({ ref: "session:claude:s" })]), byRoot(
      show({ id: "v1", createdAt: 2000, sessionId: "s" }), show({ id: "v3", createdAt: 4000, sessionId: "s" }), show({ id: "v2", createdAt: 3000, sessionId: "s" }),
    ), HOME);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ path: "show:v3", mt: 4000, shown: { id: "v3", listedIds: ["v1", "v3", "v2"], versions: 3 } });
  });

  test("a filtered or evicted history reports a listed count, not a version ordinal", () => {
    const out = mergeShows(data([]), byRoot(show({ id: "v3", supersedes: "v2" })), HOME);
    expect(out.items[0].shown).toMatchObject({ id: "v3", listedIds: ["v3"], versions: 1 });
    expect(out.items[0].shown).not.toHaveProperty("version");
  });

  test("leaves out the same file inferred from the session's calls", () => {
    const d = data([agent({ ref: "session:claude:s" })], [item({ key: "artifact:~/dev/app/shot.png", path: "~/dev/app/shot.png" }), item({ key: "artifact:k", path: "~/dev/app/keep.png" })]);
    const out = mergeShows(d, byRoot(show({ sessionId: "s" })), HOME);
    expect(out.items.map((i) => i.path)).toEqual(["show:v1", "~/dev/app/keep.png"]);
  });

  test("an area keeps its shown cards, and inferred ones fill what is left", () => {
    const inferred = Array.from({ length: CANVAS_ITEMS_PER_AGENT }, (_, i) => item({ key: `artifact:${i}`, path: `~/f${i}.png` }));
    const out = mergeShows(data([agent({ ref: "session:claude:s" })], inferred), byRoot(show({ sessionId: "s" }), show({ id: "v9", itemId: "i9", sessionId: "s" })), HOME);
    expect(out.items).toHaveLength(CANVAS_ITEMS_PER_AGENT);
    expect(out.items.slice(0, 2).every((i) => i.how === "shown")).toBe(true);
  });

  test("nothing shown leaves the canvas as built", () => {
    const d = data([agent({})]);
    expect(mergeShows(d, new Map(), HOME)).toBe(d);
  });

  test("a document or other file is a document card", () => {
    const out = mergeShows(data([agent({ ref: "session:claude:s" })]), byRoot(show({ kind: "other", sessionId: "s", sourcePath: `${ROOT}/a.pdf` })), HOME);
    expect(out.items[0].kind).toBe("doc");
  });
});

describe("runtimeShowSource", () => {
  test("lists a project's shows, and reads nothing from a runtime without them", async () => {
    const server = Bun.serve({ port: 0, fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/v1/shows" && u.searchParams.get("projectRoot") === ROOT) return Response.json({ shows: [show({})] });
      if (u.pathname === "/v1/shows/v1/bytes") return new Response("ab", { headers: { "content-type": "image/png", "x-range": req.headers.get("range") ?? "" } });
      return Response.json({ error: "not_found" }, { status: 404 });
    } });
    try {
      const src = runtimeShowSource(() => `http://127.0.0.1:${server.port}`);
      expect((await src.list(ROOT, 0)).map((s) => s.id)).toEqual(["v1"]);
      expect(await src.list("/elsewhere", 0)).toEqual([]);
      const bytes = await src.bytes("v1", "bytes=0-1");
      expect(bytes.headers.get("x-range")).toBe("bytes=0-1");
      expect((await src.bytes("../etc", null)).status).toBe(404);
    } finally { server.stop(true); }
  });
});
