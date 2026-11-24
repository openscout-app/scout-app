import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedResponse, FeedPostDetail } from "../../shared/api/feed.ts";
import type { RuntimeFeedWork } from "../feed/work-source.ts";
import type { RuntimePost } from "../feed/agent-posts.ts";
import type { RuntimeCollaborationRecord } from "../feed/attention.ts";
import { createFeedApi } from "./feed.ts";

const now = Date.UTC(2026, 0, 22, 16),
  day = 86_400_000;
const chat = "chn-example",
  session = "session/one",
  agent = "author";
function work(id: string, overrides: Partial<RuntimeFeedWork> = {}): RuntimeFeedWork {
  return {
    id,
    state: "done",
    accepted: false,
    operatorAsked: true,
    askedFrom: null,
    title: "Check the navigation.",
    ownerId: agent,
    ownerName: "Author",
    harness: "codex",
    sessionId: session,
    endpointId: null,
    conversationId: chat,
    parentId: null,
    parentTitle: null,
    projectRoot: null,
    cwd: null,
    branch: null,
    createdAt: now - 3010,
    updatedAt: now - 1000,
    finishedAt: now - 1000,
    reply: "The navigation opens the selected discussion.\n\nChecks: local test passed.",
    replyId: "answer",
    operator: null,
    presentation: { status: "missing", title: null, caption: null },
    ...overrides,
  };
}
const done: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (done.length) await done.pop()!();
});
function setup(tasks: RuntimeFeedWork[] = [], options: { mediaRoots?: string[] } = {}) {
  const state = {
    tasks,
    posts: [] as RuntimePost[],
    gone: [] as string[],
    at: now,
    fail: false,
    host: "node:one",
    conflict: false,
    requests: [] as URL[],
    records: [] as RuntimeCollaborationRecord[],
    events: [] as { kind: string; recordId: string; actorId: string; at: number }[],
  };
  const api = createFeedApi({
    brokerUrl: "http://127.0.0.1",
    now: () => state.at,
    ...options,
    fetch: (async (input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      const u = new URL(String(input));
      state.requests.push(u);
      const q = u.searchParams;
      switch (u.pathname) {
        case "/v1/node":
          return Response.json({ id: state.host });
        case "/v1/feed/work":
          if (state.fail) return Response.json({ error: "unavailable" }, { status: 503 });
          return Response.json({
            tasks: state.tasks.filter(
              (t) => t.updatedAt >= Number(q.get("since")) && (!q.has("until") || t.updatedAt < Number(q.get("until"))),
            ),
            gone: state.gone,
          });
        case "/v1/collaboration/records":
          expect(q.get("nextMoveOwnerId")).toBe("operator");
          return Response.json(state.records);
        case "/v1/collaboration/events":
          return Response.json(state.events);
        case "/v1/posts":
          return Response.json({ posts: state.posts.filter((p) => p.createdAt > Number(q.get("since"))) });
        case "/v1/messages":
          expect(q.get("conversationId")).toBe(chat);
          return Response.json([
            {
              id: "ask",
              conversationId: chat,
              actorId: "operator",
              class: "request",
              body: "Check the navigation.",
              createdAt: now - 3010,
            },
            { id: "wrong", conversationId: "chn-neighbor", actorId: agent, body: "Other chat" },
            {
              id: "answer",
              conversationId: chat,
              actorId: agent,
              class: "agent",
              body: "The navigation opens the selected discussion.",
              replyToMessageId: "ask",
              createdAt: now - 1000,
              metadata: { notForBrowser: true },
            },
          ]);
        case "/v1/observed-sessions/resolve":
          expect(Object.fromEntries(q)).toEqual({ nodeId: state.host, harness: "codex", nativeSessionId: session });
          return Response.json({
            session: {
              identity: Object.fromEntries(q),
              availability: "available",
              identityConflict: state.conflict,
              cwd: null,
            },
          });
        case "/v1/tail/recent":
          expect(q.get("sessionId")).toBe(session);
          expect(q.get("sources")).toBe("codex");
          return Response.json({
            generatedAt: state.at,
            events: [
              {
                id: "line",
                kind: "assistant",
                sessionId: session,
                source: "codex",
                summary: "In the right session",
                ts: now - 1,
              },
              {
                id: "wrong",
                kind: "assistant",
                sessionId: "neighbor",
                source: "codex",
                summary: "Wrong session",
                ts: now - 2,
              },
            ],
          });
        case "/v1/shows/example-show/bytes":
          return new Response(new Uint8Array([1, 2]), {
            status: 206,
            headers: { "content-type": "image/png", "content-range": "bytes 0-1/10" },
          });
        default:
          throw new Error("Unexpected runtime route");
      }
    }) as typeof fetch,
  });
  done.push(() => api.close());
  const get = async (path: string, init?: RequestInit) =>
    (await api.handle(new Request("http://localhost" + path, init)))!;
  const body = async <T>(path: string): Promise<T> => {
    const res = await get(path);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };
  return { state, api, get, body };
}

test("a successful empty read is a ranked page without examples; an unavailable runtime is not empty", async () => {
  const { state, get, body } = setup();
  const [list, sources] = await Promise.all([body<FeedResponse>("/api/feed"), body<any>("/api/feed/sources")]);
  expect(list).toMatchObject({
    view: "all",
    full: true,
    posts: [],
    removed: [],
    days: [],
    home: null,
    cursor: null,
    size: { posts: 0, days: 0, reviewed: 0 },
  });
  expect(sources).toMatchObject({ outside: { connected: false, threads: [] }, quota: [], activity: { rows: [] } });
  expect(state.requests.filter((u) => u.pathname === "/v1/node")).toHaveLength(1);
  expect(state.requests.filter((u) => u.pathname === "/v1/feed/work")).toHaveLength(14);
  const unchanged = await get(`/api/feed?since=${list.version}`);
  expect(unchanged.status).toBe(304);
  expect(unchanged.headers.get("x-feed-version")).toBe(String(list.version));
  expect(await unchanged.text()).toBe("");
  state.fail = true;
  state.at += 31_000;
  expect((await get("/api/feed")).status).toBe(503);
  expect(await body("/api/feed/summaries?posts=example")).toEqual({ summaries: {}, pending: false, available: false });
});

test("a head opens its exact post, broker discussion and harness session; no fallback to the author's other chat", async () => {
  const { state, body, get } = setup([
    work("work-1"),
    work("work-2", { sessionId: "another", conversationId: "chn-neighbor", replyId: "different" }),
  ]);
  const list = await body<FeedResponse>("/api/feed?view=all");
  const head = list.posts.find((p) => p.workId === "work-1")!;
  expect(head).toMatchObject({
    id: "node%3Aone:thread:session/one",
    conversationId: chat,
    owner: { sessionId: session, agentId: agent },
    caption: "Check the navigation",
  });
  const detail = await body<FeedPostDetail>("/api/feed/post/" + encodeURIComponent(head.id));
  expect(detail.id).toBe(head.id);
  expect(detail.body.checks).toContain("local test passed");
  const rows = await body<any[]>("/api/messages?conversationId=" + encodeURIComponent(head.conversationId!));
  expect(rows.map((r) => r.id)).toEqual(["ask", "answer"]);
  expect(rows[1]).toMatchObject({ conversationId: chat, replyToMessageId: "ask" });
  expect(rows[1]).not.toHaveProperty("metadata");
  expect(await body<any[]>("/api/messages?conversationId=" + chat + "&beforeMessageId=answer")).toEqual([rows[0]]);
  const lookup = "/api/session-ref/" + encodeURIComponent("session:codex:" + head.owner.sessionId);
  expect((await body<any>(lookup)).observe.data.events.map((e: any) => e.id)).toEqual(["line"]);
  state.conflict = true;
  expect((await get(lookup)).status).toBe(409);
  expect((await get("/api/session-ref/" + encodeURIComponent("session:claude:" + session))).status).toBe(404);
  expect((await get("/api/messages")).status).toBe(400);
  expect((await get("/api/messages?conversationId=chn-absent")).status).toBe(404);
});

test("seven-day pages, reviewed view, and live work keep the production keys", async () => {
  const tasks = Array.from({ length: 9 }, (_, i) =>
    work("w" + i, {
      sessionId: null,
      updatedAt: now - i * day,
      finishedAt: now - i * day,
      operator: i === 2 ? { id: "note", text: "Reviewed.", at: now - day } : null,
    }),
  );
  tasks.push(work("running", { state: "working", reply: null, replyId: null }));
  const { body } = setup(tasks);
  const page = await body<FeedResponse>("/api/feed");
  expect(page.days).toHaveLength(7);
  expect(page.cursor).toBe(page.days[6]!.day);
  expect((await body<FeedResponse>("/api/feed?cursor=" + page.cursor)).posts.map((p) => p.workId)).toEqual([
    "w7",
    "w8",
  ]);
  expect((await body<FeedResponse>("/api/feed?view=reviewed")).posts.map((p) => p.workId)).toEqual(["w2"]);
  expect((await body<any>("/api/feed/live")).sessions.map((s: any) => s.workId)).toEqual(["running"]);
  expect(page.posts[0]!.id).toBe("node%3Aone:work:w0");
});

test("session promotion produces a removal, but a reused endpoint does not merge separate sessions", async () => {
  const first = work("w1", { sessionId: "route", endpointId: "runner.route" });
  const { body, state } = setup([first]);
  const original = await body<FeedResponse>("/api/feed");
  state.at += 31_000;
  state.tasks.push(
    work("w2", { endpointId: "runner.route", sessionId: "native", updatedAt: state.at, finishedAt: state.at }),
  );
  const delta = await body<FeedResponse>("/api/feed?since=" + original.version);
  expect(delta.full).toBe(false);
  expect(delta.removed).toEqual([original.posts[0]!.id]);
  expect(delta.posts[0]).toMatchObject({ workId: "w2", owner: { sessionId: "native" }, updates: 0 });
  state.at += 31_000;
  state.tasks.push(
    work("w3", { endpointId: "runner.route", sessionId: "other", updatedAt: state.at, finishedAt: state.at }),
  );
  const split = await body<FeedResponse>("/api/feed");
  expect(split.posts.map((p) => p.owner.sessionId).sort()).toEqual(["native", "other", "route"]);
  state.at += 31_000;
  state.tasks = [];
  state.gone = ["w1", "w2", "w3"];
  expect((await body<FeedResponse>("/api/feed?since=" + split.version)).removed.sort()).toEqual(
    split.posts.map((p) => p.id).sort(),
  );
});

test("standalone publications and their shown bytes are runtime-owned; no arbitrary file or show handler", async () => {
  const { state, body, get } = setup();
  state.posts = [
    {
      id: "pub",
      source: "post",
      author: { agentId: agent, nodeId: "node:one", harness: "codex", sessionId: session },
      text: "Published a picture.",
      createdAt: now,
      file: { showId: "example-show", kind: "image", name: "picture.png", mediaType: "image/png", byteSize: 10 },
    },
  ];
  const [head] = (await body<FeedResponse>("/api/feed")).posts;
  expect(head).toMatchObject({
    id: "node%3Aone:post:pub",
    conversationId: null,
    agentPost: { own: true },
    lead: { kind: "visual" },
  });
  if (head!.lead.kind !== "visual") throw new Error("missing picture");
  const r = await get(head!.lead.ref.asset, { headers: { range: "bytes=0-1" } });
  expect(r.status).toBe(206);
  expect(r.headers.get("content-range")).toBe("bytes 0-1/10");
  expect((await get("/api/ops/canvas-file?p=show:other&as=raw")).status).toBe(404);
});

test("local file leads are opt-in and restricted to a named file under an allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "feed-preview-test-"));
  done.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "preview.png");
  await writeFile(file, new Uint8Array([1, 2, 3]));
  const task = work("w", { reply: "See " + file });
  const defaults = setup([task]);
  expect((await defaults.body<FeedResponse>("/api/feed")).posts[0]!.lead.kind).toBe("text");
  const { body, get } = setup([task], { mediaRoots: [dir] });
  const { lead } = (await body<FeedResponse>("/api/feed")).posts[0]!;
  if (lead.kind !== "visual") throw new Error("missing named picture");
  expect(new Uint8Array(await (await get(lead.ref.asset, { headers: { range: "bytes=1-1" } })).arrayBuffer())).toEqual(
    new Uint8Array([2]),
  );
  await rm(file);
  expect((await get(lead.ref.asset)).status).toBe(404);
});

test("no hosted upstream, nonlocal origin, unowned shell route or mutation is handled as a successful read", async () => {
  expect(() => createFeedApi({ brokerUrl: "https://example.invalid" })).toThrow("local");
  const { api, get, state } = setup();
  expect(await api.handle(new Request("http://localhost/embed/feed"))).toBeNull();
  expect((await get("/api/feed", { headers: { origin: "https://example.invalid" } })).status).toBe(403);
  expect((await get("/api/feed/hides", { method: "POST" })).status).toBe(405);
  expect(state.requests).toHaveLength(0);
});

test("a decision the runtime records as waiting on the operator surfaces on its post, and only that", async () => {
  const { state, body } = setup([work("w-asks", { operatorAsked: false }), work("w-quiet", { conversationId: "chn-quiet", sessionId: "session/two" })]);
  state.records = [
    { id: "q-1", kind: "question", state: "open", title: "Ship option B?", conversationId: chat, createdById: agent, nextMoveOwnerId: "operator", updatedAt: now - 500 },
    // The operator's own ask coming back is not an agent asking.
    { id: "w-quiet", kind: "work_item", state: "review", title: "Mine", conversationId: "chn-quiet", createdById: "operator", requestedById: "operator", nextMoveOwnerId: "operator", updatedAt: now - 500 },
  ];
  const list = await body<FeedResponse>("/api/feed");
  const waiting = list.posts.filter((p) => p.forYou);
  expect(waiting.map((p) => [p.workId, p.forYou])).toEqual([["w-asks", { reason: "attention", label: "Question for you", detail: "Ship option B?" }]]);
});
