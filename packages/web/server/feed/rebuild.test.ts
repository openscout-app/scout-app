import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { FeedResponse } from "../../shared/api/feed.ts";
import { queryFeedWork } from "../db/feed.ts";
import { testRuntimeRecords } from "./testing/runtime-records.ts";
import { mountFeedRoutes } from "../routes/feed.ts";
import type { SwarmPullsReader, SwarmPullState } from "../routes/swarm-pulls.ts";
import { memoryTurnSummaryStore, TurnSummaries } from "../turn-summary.ts";
import { feedLine } from "./text.ts";
import { FeedTable, FEED_WINDOW_MS } from "./table.ts";

test("write-time words remove the citation and its glue, not the surrounding sentence", () => {
  expect(feedLine("Review PR 2008 at `6817143c9` for the installer")).toBe("Review PR 2008 for the installer");
  expect(feedLine("Approve arach/scout#209 at 6817143c9.")).toBe("Approve arach/scout#209.");
  expect(feedLine("Updated, head b1a85667e, rebased.")).toBe("Updated, rebased.");
  expect(feedLine("Fixed it at https://example.org/commit/foo. Tests pass.")).toBe("Fixed it. Tests pass.");
  expect(feedLine("Verdict on the diff 123cafe..456beef for PR 2008")).toBe("Verdict on the diff for PR 2008");
  expect(feedLine("See [the result](https://example.org/path).")).toBe("See the result.");
});

test("a rebuild from records equals the incrementally written slots, including an operator reaction, reviewed status, a dismissed request and a saved summary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feed-rebuild-"));
  let now = Date.now(),
    modelCalls = 0,
    windowReads = 0;
  let origin: string | null = "mini";
  const runtime = testRuntimeRecords();
  runtime.exec(`
    CREATE TABLE test_attention(id PRIMARY KEY, workId, state);
    INSERT INTO test_attention VALUES('choose','one','open');
    INSERT INTO agent_endpoints VALUES('ep','dev',0,'codex','s','/projects/test','/projects/test','{}');
  `);
  const put = (id: string, state: string, title: string, reply: string | null) => {
    const inv = "inv:" + id,
      ask = "ask:" + id,
      msg = "m:" + id;
    runtime.query("DELETE FROM collaboration_records WHERE id=?").run(id);
    runtime
      .query("INSERT INTO collaboration_records VALUES(?, 'work_item', ?, NULL, 'dev', 'chat', NULL, ?, ?, ?, ?)")
      .run(
        id,
        state,
        title,
        now - 100,
        now,
        JSON.stringify({ requestedById: "operator", metadata: { lastInvocationId: inv } }),
      );
    runtime.query("DELETE FROM invocations WHERE id=?").run(inv);
    runtime.query("INSERT INTO invocations VALUES(?,?,?,?,'{}','{}')").run(
      inv,
      id,
      ask,
      JSON.stringify({
        sessionTrace: [{ sessionId: "s" }],
        ...(reply ? { taskFinalReplyMessageId: msg } : {}),
      }),
    );
    if (reply) runtime.query("INSERT INTO messages VALUES(?, 'chat', 'dev', ?, ?, ?, '{}')").run(msg, reply, ask, now);
  };
  let pullState: SwarmPullState["state"] = "open";
  const pull = () =>
    ({
      repo: "acme/test",
      number: 2008,
      key: "acme/test#2008",
      title: "Installer",
      head: "fix",
      url: "https://github.com/acme/test/pull/2008",
      state: pullState,
    }) as SwarmPullState;
  const store = memoryTurnSummaryStore();
  const summaries = new TurnSummaries({
    store,
    complete: async () => {
      modelCalls++;
      return {
        text: "Gist: The installer preserves the selected channel\nNeed: review\nAsk: Review the installer",
        model: "test",
      };
    },
  });
  const services: ReturnType<typeof mountFeedRoutes>[] = [];
  const open = (name: string) => {
    const app = new Hono(),
      path = join(dir, name + ".sqlite");
    const service = mountFeedRoutes(app, {
      originHost: async () => origin,
      projectionPath: path,
      now: () => now,
      summaries,
      query: (read) => {
        if (read.mode === "window") windowReads++;
        return queryFeedWork(read, runtime);
      },
      posts: {
        list: async (since) =>
          start - 8000 > since
            ? [
                {
                  id: "journal",
                  source: "post",
                  author: { agentId: "other", nodeId: "n" },
                  text: "Latency measured",
                  createdAt: start - 8000,
                },
              ]
            : [],
      },
      // Even when a busy repo's recent list is unavailable, the named PR can settle its thread.
      pulls: Object.assign(async () => ({}), {
        list: async () => ({ pulls: [], warning: "timeout" }),
      }) as unknown as SwarmPullsReader,
      namedPulls: async (_repo, ns) => (ns.includes(2008) ? [pull()] : []),
      localBranches: async () => [],
      attention: async () =>
        runtime
          .query<{ id: string; workId: string }, []>("SELECT id,workId FROM test_attention WHERE state='open'")
          .all()
          .map((r) => ({ ...r, label: "Choose", conversationId: "chat" })),
    });
    services.push(service);
    return { app, service, path };
  };
  const snapshot = (path: string) => {
    const db = new Database(path, { readonly: true });
    try {
      // updated_seq records local edit order, not source content.
      return db
        .query(
          `SELECT id,kind,placement,state,title,caption,refs,at,day,reviewed,candidate,head,detail,summary,files
        FROM feed_slots WHERE state<>'removed' ORDER BY id`,
        )
        .all();
    } finally {
      db.close();
    }
  };
  const start = now;
  try {
    put("one", "working", "Build the installer", null);
    const inc = open("inc");
    await inc.service.refresh();
    expect(inc.service.table.live(null)?.sessions).toHaveLength(1);
    now += 65_000;
    put("one", "done", "Build the installer", "Added the package: https://github.com/acme/test/pull/2008");
    await inc.service.refresh();
    expect(inc.service.table.home(now).forYou).toEqual(["mini:thread:s"]);
    now += 65_000;
    runtime.exec("UPDATE test_attention SET state='dismissed' WHERE id='choose'");
    put("two", "done", "Verify the installer at 6817143c9.", "Verified acme/test#2008.");
    await inc.service.refresh();
    await summaries.idle();
    expect(inc.service.table.home(now).backToYou).toEqual(["mini:thread:s"]);
    const prior = inc.service.table.version;
    now += 65_000;
    pullState = "merged";
    await inc.service.refresh();
    expect(inc.service.table.response("all", { since: prior, now })?.posts.map((p) => p.id)).toContain("mini:thread:s");
    expect(inc.service.table.home(now)).toMatchObject({ backToYou: [], shipped: ["mini:thread:s"] });
    expect(inc.service.table.head("mini:thread:s")).toMatchObject({
      title: "The installer preserves the selected channel",
      caption: "Verify the installer",
      updates: 1,
    });
    expect(inc.service.table.summary("mini:thread:s")).toBeNull(); // stale decision cannot overlay the merged turn
    now += 65_000;
    put("three", "done", "Choose the release channel", "The build is ready. Should I change channels?");
    await inc.service.refresh();
    await summaries.idle();
    expect(inc.service.table.home(now).backToYou).toEqual(["mini:thread:s"]);

    // Only a runtime message changes; the work record and the projection are not patched.
    // The changed-since reader must notice the conversation, not just work.updated_at.
    const reaction = "Ship it. Keep the existing channel.";
    const beforeReaction = inc.service.table.version;
    expect(inc.service.table.head("mini:thread:s")?.reviewed).toBe(false);
    now += 65_000;
    runtime
      .query("INSERT INTO messages VALUES('reaction', 'chat', 'operator', ?, NULL, ?, '{\"targetSessionId\":\"s\"}')")
      .run(reaction, now);
    const line = { text: reaction, at: now };
    await inc.service.refresh();
    expect(inc.service.table.response("reviewed", { now, since: beforeReaction })).toMatchObject({
      full: false,
      posts: [{ id: "mini:thread:s", reviewed: true, line }],
    });
    const assertStatus = async (app: Hono) => {
      const reviewed = (await (await app.request("/api/feed?view=reviewed")).json()) as FeedResponse;
      expect(reviewed.posts.map((p) => p.id)).toEqual(["mini:thread:s"]);
      expect(reviewed).toMatchObject({ size: { reviewed: 1 }, posts: [{ reviewed: true, line, backToYou: false }] });
      const home = (await (await app.request("/api/feed?view=home")).json()) as FeedResponse;
      expect(home.home).toMatchObject({ backToYou: [], forYou: [] }); // neither answered work nor a dismissed request returns
    };
    await assertStatus(inc.app);
    const incremental = snapshot(inc.path);
    const calls = modelCalls;
    const full = open("full");
    await full.service.refresh();
    await summaries.idle();
    expect(snapshot(full.path)).toEqual(incremental);
    await assertStatus(full.app);
    expect(modelCalls).toBe(calls);
    expect(windowReads).toBe(2);
    await inc.service.stop();
    services.splice(services.indexOf(inc.service), 1);
    origin = null;
    const restart = open("inc");
    const response = (await (await restart.app.request("/api/feed?view=all")).json()) as FeedResponse;
    expect(response.posts.map((p) => p.id).sort()).toEqual(["mini:post:journal", "mini:thread:s"]);
    expect(windowReads).toBe(2);
    expect(snapshot(restart.path)).toEqual(incremental);
    await expect(restart.service.refresh()).rejects.toThrow("origin host");
    expect(snapshot(restart.path)).toEqual(incremental); // an offline reader cannot create unscoped rows
    origin = "mini";
    await restart.service.stop();
    services.splice(services.indexOf(restart.service), 1);
    const db = new Database(inc.path);
    db.exec("PRAGMA user_version=99");
    db.close();
    const reset = open("inc");
    await reset.app.request("/api/feed?view=all");
    expect(windowReads).toBe(3);
    expect(snapshot(reset.path)).toEqual(incremental);
    await assertStatus(reset.app);
    expect(modelCalls).toBe(calls);
    now += FEED_WINDOW_MS + 1;
    await reset.service.refresh();
    expect(reset.service.table.response("all", { now, cursor: "2099-01-01" })).toMatchObject({
      posts: [],
      cursor: null,
    });
    expect(runtime.query("SELECT body FROM messages WHERE id='reaction'").get()).toEqual({ body: reaction });
    expect(runtime.query("SELECT state FROM test_attention WHERE id='choose'").get()).toEqual({ state: "dismissed" });
  } finally {
    for (const s of services) await s.stop();
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WAL lets a reader keep its snapshot during a commit; a copied projection cannot mix two hosts", () => {
  const dir = mkdtempSync(join(tmpdir(), "feed-origin-"));
  const path = join(dir, "feed.sqlite");
  const writer = new FeedTable({ path, originHost: "host-a" });
  const reader = new Database(path, { readonly: true });
  try {
    expect(reader.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    reader.exec("BEGIN");
    const count = () => reader.query("SELECT COUNT(*) AS n FROM feed_slots").get();
    expect(count()).toEqual({ n: 0 });
    writer.apply({ mark: Date.now(), posts: [{ id: "notice", source: "post", author: { agentId: "agent", nodeId: "source" }, text: "Done.", createdAt: Date.now() }] });
    expect(count()).toEqual({ n: 0 });
    reader.exec("COMMIT");
    expect(count()).toEqual({ n: 1 });
    const oldVersion = writer.version;
    writer.bindOrigin("host-b");
    expect(writer.mark).toBeNull();
    expect(writer.pullSlots(oldVersion, Date.now())).toMatchObject({ origin_host: "host-b", full: true, slots: [] });
  } finally { reader.close(); writer.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a projection path cannot repurpose another SQLite store", () => {
  const dir = mkdtempSync(join(tmpdir(), "feed-path-")), path = join(dir, "other.sqlite");
  const db = new Database(path, { create: true });
  try {
    db.exec("CREATE TABLE meta(key, value); INSERT INTO meta VALUES('retained',1)");
    expect(() => new FeedTable({ path, originHost: "mini" })).toThrow("non-Feed SQLite file");
    expect(db.query("SELECT value FROM meta WHERE key='retained'").get()).toEqual({ value: 1 });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
