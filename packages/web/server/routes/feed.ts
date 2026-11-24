/** Same-origin local preview API. Mount its fetch handler ahead of the app shell. */
import { realpath, stat } from "node:fs/promises";
import { activityGrid } from "../feed/activity.ts";
import { SHOW_ID } from "../feed/agent-posts.ts";
import { readDiscussion, readSession } from "../feed/discussion.ts";
import { namedRepos, pullRefs } from "../feed/feed-refs.ts";
import { checkMediaFile, insideCheckout, replyMedia } from "../feed/files.ts";
import { isLoopback, LocalRuntime, ReadError } from "../feed/local-runtime.ts";
import { byteRange, videoType } from "../feed/media-range.ts";
import { reposByRoot } from "../feed/repositories.ts";
import { FEED_WINDOW_MS, FeedTable } from "../feed/table.ts";
import type { FeedPostDetail, FeedSummaries, FeedViewId } from "../../shared/api/feed.ts";
import type { FeedSources } from "../../shared/api/feed-sources.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
function since(raw: string | null) {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
const VIEWS: FeedViewId[] = ["all", "home", "reviewed", "following"];
const SAFE_MEDIA = /^(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm|quicktime))$/i;

async function localAsset(table: FeedTable, roots: readonly string[], id: string, range: string | null) {
  const named = /^[0-9a-f]{16}$/.test(id) ? table.file(id) : null;
  const file = named && (await checkMediaFile(named, roots));
  if (!file) throw new ReadError(404, "No such Feed asset");
  const size = (await stat(file)).size;
  const type =
    videoType(file) ??
    `image/${file
      .slice(file.lastIndexOf(".") + 1)
      .toLowerCase()
      .replace(/^jpg$/, "jpeg")}`;
  const bytes = byteRange(range, size);
  const headers = {
    "content-type": type,
    "cache-control": "private, no-store",
    "content-security-policy": "sandbox; default-src 'none'",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  if (bytes === "unsatisfiable")
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  if (bytes)
    return new Response(Bun.file(file).slice(bytes.start, bytes.end + 1), {
      status: 206,
      headers: {
        ...headers,
        "content-range": `bytes ${bytes.start}-${bytes.end}/${size}`,
        "content-length": String(bytes.end - bytes.start + 1),
      },
    });
  return new Response(Bun.file(file), { headers: { ...headers, "content-length": String(size) } });
}

export type FeedApiOptions = {
  brokerUrl?: string;
  /** Only named media inside an explicitly trusted directory can become a file lead. Default: Scout shows only. */
  mediaRoots?: readonly string[];
  fetch?: typeof fetch;
  now?: () => number;
  refreshMs?: number;
};

export function createFeedApi(options: FeedApiOptions = {}) {
  const core = new LocalRuntime(
    options.brokerUrl ?? process.env.OPENSCOUT_BROKER_URL ?? "http://127.0.0.1:43110",
    options.fetch,
  );
  const now = options.now ?? Date.now;
  const roots = Promise.all((options.mediaRoots ?? []).map((dir) => realpath(dir).catch(() => null))).then((dirs) =>
    dirs.filter((s): s is string => s !== null && s !== "/"),
  );
  const table = new FeedTable();
  let reading: Promise<void> | undefined;
  let freshUntil = -Infinity;
  async function refresh() {
    const at = now(),
      start = Math.max(0, at - FEED_WINDOW_MS);
    table.bindOrigin(await core.nodeId());
    const mark = table.mark;
    const work =
      mark === null || mark < start
        ? { mode: "window" as const, since: start, limit: -1 }
        : { mode: "changed" as const, since: start, mark: Math.max(0, mark - 5000), limit: -1 };
    const [{ tasks, gone }, posts, allowed, attention] = await Promise.all([
      core.work(work, at),
      core.posts(Math.max(start, table.postMark - 1)),
      roots,
      // What waits on the operator joins its post; a failed read keeps what was last read, never a guess.
      core.attention(at).catch(() => table.context.attention),
    ]);
    const named = table.namedInputs(start);
    const upsert = [];
    for (const task of tasks) {
      if ((task.state === "working" ? task.updatedAt : task.finishedAt) < start) {
        gone.push(task.id);
        continue;
      }
      task.askedByAgent = Boolean(task.operatorAsked && task.askedFrom && (await insideCheckout(task.askedFrom)));
      if (allowed.length) task.media = await replyMedia(task.reply, allowed);
      const words = task.title + "\n" + (task.reply ?? "");
      named.set(task.id, { root: task.projectRoot, repos: namedRepos(words), refs: pullRefs(words) });
      upsert.push(task);
    }
    for (const id of gone) named.delete(id);
    table.apply({ upsert, remove: gone, posts, mark: at, expireBefore: start, context: { repos: reposByRoot(named), attention } });
    freshUntil = now() + (options.refreshMs ?? 30_000);
  }
  function ready() {
    if (now() < freshUntil) return Promise.resolve();
    return (reading ??= refresh().finally(() => {
      reading = undefined;
    }));
  }
  const notModified = () =>
    new Response(null, {
      status: 304,
      headers: { "cache-control": "no-store", "x-feed-version": String(table.version) },
    });

  async function handle(req: Request): Promise<Response | null> {
    const u = new URL(req.url),
      path = u.pathname,
      q = u.searchParams;
    if (!(
      path === "/api/feed" ||
      path.startsWith("/api/feed/") ||
      path === "/api/messages" ||
      path.startsWith("/api/session-ref/") ||
      path === "/api/ops/canvas-file"
    ))
      return null;
    const origin = req.headers.get("origin");
    if (
      !isLoopback(u.hostname) ||
      (origin !== null && origin !== u.origin) ||
      (req.headers.has("host") && req.headers.get("host") !== u.host) ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return json({ error: "Local requests only" }, 403);
    if (req.method !== "GET") return json({ error: "Read-only Feed preview" }, 405);
    if (path === "/api/feed/summaries")
      return json({ summaries: {}, available: false, pending: false } satisfies FeedSummaries);
    try {
      await ready();
      if (path === "/api/feed") {
        const view = q.get("view") as FeedViewId;
        const cursor = q.get("cursor");
        const body = table.response(VIEWS.includes(view) ? view : "all", {
          since: since(q.get("since")),
          now: now(),
          cursor: cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) ? cursor : null,
          debug: q.get("debug") === "rank",
        });
        return body ? json(body) : notModified();
      }
      if (path === "/api/feed/live") {
        const live = table.live(since(q.get("since")));
        return live ? json(live) : notModified();
      }
      if (path === "/api/feed/slots") {
        const version = since(q.get("since"));
        if (q.has("since") && version === null) return json({ error: "Invalid since" }, 400);
        const slots = table.pullSlots(version, now());
        return slots ? json(slots) : notModified();
      }
      if (path === "/api/feed/sources") {
        const at = now();
        return json({
          generatedAt: at,
          outside: { connected: false, threads: [] },
          quota: [],
          activity: activityGrid(table.activityPosts(), at),
        } satisfies FeedSources);
      }
      const post = /^\/api\/feed\/post\/([^/]+)$/.exec(path);
      if (post) {
        const detail = table.detail(decodeURIComponent(post[1]!));
        return detail ? json({ ...detail, diff: null } satisfies FeedPostDetail) : json({ error: "No such post" }, 404);
      }
      if (path === "/api/messages") return json(await readDiscussion(core, table, q));
      const session = /^\/api\/session-ref\/([^/]+)$/.exec(path);
      if (session) return json(await readSession(core, table, decodeURIComponent(session[1]!)));
      if (path.startsWith("/api/feed/asset/"))
        return await localAsset(table, await roots, path.slice("/api/feed/asset/".length), req.headers.get("range"));
      if (path === "/api/ops/canvas-file") {
        const ref = q.get("p") ?? "",
          id = ref.slice(5);
        if (!ref.startsWith("show:") || q.get("as") !== "raw" || !SHOW_ID.test(id) || !table.hasShow(id))
          throw new ReadError(404, "No such shown asset");
        const res = await core.read(`/v1/shows/${encodeURIComponent(id)}/bytes`, req.headers.get("range"));
        if (res.status === 416) {
          const contentRange = res.headers.get("content-range");
          await res.body?.cancel();
          return new Response(null, { status: 416, headers: contentRange ? { "content-range": contentRange } : {} });
        }
        const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!res.ok || !SAFE_MEDIA.test(type)) {
          await res.body?.cancel();
          throw new ReadError(res.status === 404 ? 404 : !res.ok ? 503 : 415, "Shown media unavailable");
        }
        const headers = new Headers({
          "content-type": type,
          "content-security-policy": "sandbox; default-src 'none'",
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        });
        for (const key of ["content-length", "content-range", "accept-ranges"]) {
          const value = res.headers.get(key);
          if (value) headers.set(key, value);
        }
        return new Response(res.body, { status: res.status, headers });
      }
      return json({ error: "Not part of the local Feed preview" }, 404);
    } catch (error) {
      if (error instanceof ReadError) return json({ error: error.message }, error.status);
      if (error instanceof URIError) return json({ error: "Invalid encoded id" }, 400);
      return json({ error: "Could not read the local Scout Feed" }, 503);
    }
  }
  return {
    handle,
    async close() {
      try {
        await reading;
      } finally {
        table.close();
      }
    },
  };
}
