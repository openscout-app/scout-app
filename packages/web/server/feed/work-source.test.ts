import { describe, expect, test } from "bun:test";

import { WORK_ROUTE_RECHECK_MS, WORK_SLICE_MS, feedWorkUrl, runtimeWorkSource, workSlices, type FeedWorkPage, type RuntimeFeedWork } from "./work-source.ts";

const BASE = "http://127.0.0.1:43110";
const work: RuntimeFeedWork = {
  id: "w1", title: "Fix the header.", state: "done", accepted: false, operatorAsked: true, askedFrom: null,
  ownerId: "agent-1", ownerName: "Agent One", harness: "claude", sessionId: "s1", conversationId: "c1",
  parentId: null, parentTitle: null, projectRoot: "/repo", cwd: "/repo", branch: null,
  createdAt: 1, updatedAt: 2, finishedAt: 2, replyId: "m1", reply: "Fixed it.", operator: null,
  presentation: { status: "missing", title: null, caption: null },
};
const local: FeedWorkPage = { tasks: [], gone: ["from-db"] };

function runtime(answers: Response[]) {
  const urls: string[] = [];
  const get = (async (input: URL | RequestInfo) => {
    urls.push(String(input));
    return answers.shift() ?? new Response("{}", { status: 500 });
  }) as typeof fetch;
  return { urls, get };
}

describe("the Feed's work from the runtime", () => {
  test("a read names its window, its mark and its limit", () => {
    expect(feedWorkUrl({ mode: "window", since: 100.7, limit: -1 }, BASE).search).toBe("?since=100");
    expect(feedWorkUrl({ mode: "changed", mark: 500, since: 100, limit: 50 }, BASE).search).toBe("?since=100&mark=500&limit=50");
  });

  test("a long window is asked for a day at a time, newest first, the newest slice open-ended", () => {
    const now = 10 * WORK_SLICE_MS;
    expect(workSlices({ mode: "window", since: now - 2.5 * WORK_SLICE_MS, limit: -1 }, now)).toEqual([
      { mode: "window", since: now - WORK_SLICE_MS, limit: -1 },
      { mode: "window", since: now - 2 * WORK_SLICE_MS, until: now - WORK_SLICE_MS, limit: -1 },
      { mode: "window", since: now - 2.5 * WORK_SLICE_MS, until: now - 2 * WORK_SLICE_MS, limit: -1 },
    ]);
    expect(workSlices({ mode: "window", since: now - 1000, limit: -1 }, now)).toEqual([{ mode: "window", since: now - 1000, limit: -1 }]);
  });

  test("the runtime's items become Feed tasks, with nothing yet read from disk", async () => {
    const now = 5 * WORK_SLICE_MS;
    const { urls, get } = runtime([Response.json({ tasks: [work], gone: ["w-open"] }), Response.json({ tasks: [], gone: ["w-old"] })]);
    const query = runtimeWorkSource(() => BASE, () => local, { fetch: get, now: () => now });
    const page = await query({ mode: "window", since: now - 2 * WORK_SLICE_MS, limit: -1 });
    expect(urls).toEqual([`${BASE}/v1/feed/work?since=${now - WORK_SLICE_MS}`, `${BASE}/v1/feed/work?since=${now - 2 * WORK_SLICE_MS}&until=${now - WORK_SLICE_MS}`]);
    expect(page.gone).toEqual(["w-open", "w-old"]);
    expect(page.tasks[0]).toEqual({ ...work, askedByAgent: false, shows: [], media: [], studies: [] });
  });

  test("a runtime without the route is read around, and asked again later", async () => {
    let now = 1_000;
    const { urls, get } = runtime([new Response("", { status: 404 }), Response.json({ tasks: [work], gone: [] })]);
    const query = runtimeWorkSource(() => BASE, () => local, { fetch: get, now: () => now });
    const read = () => ({ mode: "window" as const, since: now - 1000, limit: -1 });
    expect(await query(read())).toBe(local);
    now += WORK_ROUTE_RECHECK_MS - 1;
    expect(await query(read())).toBe(local);
    expect(urls).toHaveLength(1);
    now += 1;
    expect((await query(read())).tasks.map((task) => task.id)).toEqual(["w1"]);
  });

  test("any other failure is the read's failure, not a silent fallback", async () => {
    const { get } = runtime([new Response("", { status: 500 })]);
    const query = runtimeWorkSource(() => BASE, () => local, { fetch: get });
    await expect(query({ mode: "changed", mark: 10, since: 0, limit: -1 })).rejects.toThrow("runtime feed work answered 500");
  });
});
