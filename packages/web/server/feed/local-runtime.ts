/** Read-only transport to the public Scout runtime. The browser cannot choose the
 * runtime, pass credentials, follow redirects, or turn this into a generic proxy. */
import { type RuntimeFeedWork, type FeedRead, feedWorkUrl, taskFromRuntimeWork, workSlices } from "./work-source.ts";
import type { RuntimePost } from "./agent-posts.ts";
import type { WebFeedTask } from "../../shared/api/feed.ts";
import type { FeedAttention } from "./post.ts";
import { attentionFromRecords, OPERATOR_ID, type RuntimeCollaborationEvent, type RuntimeCollaborationRecord } from "./attention.ts";

export const isLoopback = (name: string) => ["localhost", "127.0.0.1", "[::1]"].includes(name);
export class ReadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export class LocalRuntime {
  private readonly base: string;
  constructor(
    url: string,
    private readonly get: typeof fetch = fetch,
  ) {
    const u = new URL(url);
    if (
      u.protocol !== "http:" ||
      !isLoopback(u.hostname) ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      throw new Error("Expected a local Scout runtime HTTP origin");
    this.base = u.origin;
  }

  async read(path: string, range?: string | null): Promise<Response> {
    const url = new URL(path, this.base);
    if (url.origin !== this.base || !url.pathname.startsWith("/v1/")) throw new Error("Invalid runtime path");
    try {
      return await this.get(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: range ? { range } : undefined,
      });
    } catch {
      throw new ReadError(503, "Local Scout runtime unavailable");
    }
  }

  async json<T>(path: string): Promise<T> {
    const res = await this.read(path);
    if (!res.ok) {
      await res.body?.cancel();
      throw new ReadError([404, 409, 400].includes(res.status) ? res.status : 503, "Local Scout read unavailable");
    }
    return (await res.json()) as T;
  }

  async nodeId() {
    const node = await this.json<{ id: string }>("/v1/node");
    if (!node?.id) throw new ReadError(503, "Local Scout runtime has no node identity");
    return node.id;
  }

  async work(read: FeedRead, now: number) {
    const tasks: WebFeedTask[] = [],
      gone: string[] = [];
    const slices = read.mode === "window" && read.limit < 0 ? workSlices(read, now) : [read];
    for (const slice of slices) {
      const url = feedWorkUrl(slice, this.base);
      const res = await this.read(url.pathname + url.search);
      if (!res.ok) {
        await res.body?.cancel();
        throw new ReadError(503, "Feed work unavailable. Start a local Scout runtime with GET /v1/feed/work.");
      }
      const page = (await res.json()) as { tasks: RuntimeFeedWork[]; gone: string[] };
      if (!Array.isArray(page?.tasks) || !Array.isArray(page.gone))
        throw new ReadError(503, "Invalid Scout Feed work page");
      tasks.push(...page.tasks.map(taskFromRuntimeWork));
      gone.push(...page.gone);
    }
    return { tasks, gone };
  }

  /**
   * The operator's waiting records (feed/attention.ts), read from the runtime's collaboration records. An older
   * runtime without the routes, or one that fails the read, has no decisions to show: never a made-up one.
   */
  async attention(now: number): Promise<FeedAttention[]> {
    const read = async <T>(path: string, key: string): Promise<T[]> => {
      const res = await this.read(path);
      if (!res.ok) {
        await res.body?.cancel();
        return [];
      }
      const body = (await res.json()) as unknown;
      const list = Array.isArray(body) ? body : (body as Record<string, unknown> | null)?.[key];
      return Array.isArray(list) ? (list as T[]) : [];
    };
    const [records, events] = await Promise.all([
      read<RuntimeCollaborationRecord>(`/v1/collaboration/records?nextMoveOwnerId=${OPERATOR_ID}&limit=500`, "records"),
      read<RuntimeCollaborationEvent>("/v1/collaboration/events?limit=500", "events"),
    ]);
    return attentionFromRecords(records, events, now);
  }

  async posts(since: number) {
    const res = await this.read(`/v1/posts?since=${since}&limit=500`);
    if (res.status === 404) {
      await res.body?.cancel();
      return [];
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new ReadError(503, "Local Scout posts unavailable");
    }
    const body = (await res.json()) as { posts: RuntimePost[] };
    if (!Array.isArray(body?.posts)) throw new ReadError(503, "Invalid Scout posts page");
    return body.posts;
  }
}
