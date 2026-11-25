import { describe, expect, test } from "bun:test";
import { activityGrid } from "./activity.ts";
import { OUTSIDE_FAILED_BACKOFF_MS, OUTSIDE_MAX_CONVERSATIONS, OUTSIDE_PROBES_PER_READ, OutsideReader, outsideThreads, type OutsideMessageInput, type OutsideSlack } from "./outside.ts";
import { quotaCrossings, type QuotaGaugeInput } from "./quota-events.ts";

const NOW = new Date(2026, 10, 16, 14, 0).getTime();
const H = 3_600_000;
const ME = "U_ME";

function msg(id: string, actorId: string, hoursAgo: number, partial: Partial<OutsideMessageInput> = {}): OutsideMessageInput {
  return { id, actorId, actorName: actorId === ME ? "me" : actorId.toLowerCase(), body: `text ${id}`, createdAt: NOW - hoursAgo * H, class: "operator", ...partial };
}

describe("outside threads", () => {
  test("a person who wrote to you last in a direct conversation waits on you", () => {
    const [t] = outsideThreads({ workspace: "w", viewerId: ME, now: NOW, conversations: [
      { id: "D1", title: "Kim", kind: "direct", messages: [msg("1", ME, 5), msg("2", "U_KIM", 2)] },
    ] });
    expect(t?.waiting).toBe("you");
    expect(t?.last).toEqual({ who: "u_kim", operator: false, at: NOW - 2 * H });
    expect(t?.messages.map((m) => m.id)).toEqual(["1", "2"]);
  });

  test("you wrote last: it waits on them", () => {
    const [t] = outsideThreads({ workspace: "w", viewerId: ME, now: NOW, conversations: [
      { id: "D1", title: "desk", kind: "direct", messages: [msg("1", "U_BOT", 5, { class: "agent" }), msg("2", ME, 1)] },
    ] });
    expect(t?.waiting).toBe("them");
  });

  test("an app replying in a direct conversation does not wait on you; a channel waits only when it names you", () => {
    const threads = outsideThreads({ workspace: "w", viewerId: ME, now: NOW, conversations: [
      { id: "D1", title: "desk", kind: "direct", messages: [msg("1", ME, 5), msg("2", "U_BOT", 1, { class: "agent" })] },
      { id: "C1", title: "ai", kind: "channel", messages: [msg("3", ME, 6), msg("4", "U_KIM", 3)] },
      { id: "C2", title: "eng", kind: "channel", messages: [msg("5", ME, 6), msg("6", "U_KIM", 2, { mentions: [{ actorId: ME }] })] },
    ] });
    expect(Object.fromEntries(threads.map((t) => [t.channel.id, t.waiting]))).toEqual({ D1: null, C1: null, C2: "you" });
  });

  test("Slack's own notices, notes to yourself and conversations you never joined are left out", () => {
    const threads = outsideThreads({ workspace: "w", viewerId: ME, now: NOW, conversations: [
      { id: "D1", title: "Slack", kind: "direct", messages: [msg("1", "USLACK", 2)] },
      { id: "D2", title: "me", kind: "direct", messages: [msg("2", ME, 2)] },
      { id: "C1", title: "general", kind: "channel", messages: [msg("3", "U_KIM", 2)] },
      { id: "D3", title: "old", kind: "direct", messages: [msg("4", "U_KIM", 24 * 9)] },
    ] });
    expect(threads).toEqual([]);
  });

  test("rich messages are read from their Markdown when the plain body is empty", () => {
    const [t] = outsideThreads({ workspace: "w", viewerId: ME, now: NOW, conversations: [
      { id: "D1", title: "Kim", kind: "direct", messages: [msg("1", ME, 3, { body: "", editBody: "what is the latest" }), msg("2", "U_KIM", 1)] },
    ] });
    expect(t?.messages[0]?.text).toBe("what is the latest");
  });
});

/** A Slack account with these conversations; counts every read so tests can hold the work to its bound. */
function fakeSlack(channels: Array<{ id: string; kind: string; messages: OutsideMessageInput[]; thread?: OutsideMessageInput[] }>) {
  const calls = { bootstrap: 0, recent: 0, context: [] as Array<{ cursor?: string; limit?: number }> };
  let fail: Error | null = null;
  const slack: OutsideSlack = {
    async bootstrap() {
      calls.bootstrap += 1;
      if (fail) throw fail;
      return { viewer: { actorId: ME }, source: { name: "w" }, channels: channels.map((c) => ({ id: c.id, title: c.id, kind: c.kind })) };
    },
    async recent(id, limit = 12) {
      calls.recent += 1;
      return channels.find((c) => c.id === id)!.messages.slice(-limit);
    },
    async context(id, _root, cursor, limit = 100) {
      calls.context.push({ cursor, limit });
      const all = channels.find((c) => c.id === id)!.thread ?? [];
      const from = cursor ? Number(cursor) : 0;
      const next = from + limit < all.length ? String(from + limit) : null;
      return { messages: all.slice(from, from + limit), nextCursor: next };
    },
  };
  return { slack, calls, failWith: (e: Error | null) => { fail = e; } };
}

const dms = (n: number, hoursAgo: (i: number) => number) => Array.from({ length: n }, (_, i) => ({
  id: `D${String(i).padStart(2, "0")}`, kind: "direct", messages: [msg(`d${i}`, `U_P${i}`, hoursAgo(i))],
}));
const zoe = { id: "C_ENG", kind: "channel", messages: [msg("z1", "U_ZOE", 1, { mentions: [{ actorId: ME }] })] };

describe("the outside reader", () => {
  test("more than forty direct conversations, all quiet this week: a recent channel still makes the cut", async () => {
    const { slack, calls } = fakeSlack([...dms(45, () => 24 * 10), zoe]);
    const value = await new OutsideReader(slack, () => NOW).read();
    expect(value.threads.map((t) => t.channel.id)).toEqual(["C_ENG"]);
    expect(calls.recent).toBeLessThanOrEqual(OUTSIDE_PROBES_PER_READ + OUTSIDE_MAX_CONVERSATIONS);
  });

  test("more than forty busy direct conversations: the newest channel ranks in by its time once probed, and the oldest fall out", async () => {
    let now = NOW;
    const { slack, calls } = fakeSlack([...dms(45, (i) => 20 + i), zoe]);
    const reader = new OutsideReader(slack, () => now);
    await reader.read();
    now += 3 * 60_000;
    calls.recent = 0;
    const second = await reader.read();
    expect(second.threads[0]?.channel.id).toBe("C_ENG");
    expect(second.threads[0]?.waiting).toBe("you");
    // Each read stays bounded: the second probes only what it has not seen, then reads the newest in full.
    expect(calls.recent).toBeLessThanOrEqual(45 + 1 - OUTSIDE_PROBES_PER_READ + OUTSIDE_MAX_CONVERSATIONS);
  });

  test("a failed read keeps the last answer and does not try Slack again within the backoff", async () => {
    let now = NOW;
    const { slack, calls, failWith } = fakeSlack([{ id: "D1", kind: "direct", messages: [msg("1", "U_KIM", 1)] }]);
    const reader = new OutsideReader(slack, () => now);
    const first = await reader.read();
    expect(first.threads).toHaveLength(1);
    failWith(Object.assign(new Error("Slack users.conversations failed: ratelimited"), { status: 429, code: "ratelimited" }));
    now += 3 * 60_000;
    expect(await reader.read()).toEqual(first);
    expect(calls.bootstrap).toBe(2);
    now += OUTSIDE_FAILED_BACKOFF_MS - 60_000;
    expect(await reader.read()).toEqual(first);
    expect(calls.bootstrap).toBe(2);
    now += 2 * 60_000;
    failWith(null);
    await reader.read();
    expect(calls.bootstrap).toBe(3);
  });

  for (const stage of ["probe", "recent", "context"] as const) {
    for (const failure of [
      { status: 429, code: "ratelimited", retryAfterSeconds: 600 },
      { status: 502, code: "invalid_auth" },
      { status: 401, code: "http_401" },
      { status: 403, code: "missing_scope" },
    ]) {
      test(`${stage} ${failure.code} reaches reader backoff and keeps last-good data`, async () => {
        let now = NOW;
        const root = msg("r", "U_KIM", 1, { threadSummary: { count: 1, lastActiveAt: NOW - H } });
        const { slack, calls } = fakeSlack([{ id: "D1", kind: "direct", messages: [root], thread: [root] }]);
        const reader = new OutsideReader(slack, () => now);
        const first = await reader.read();
        expect(first.threads).toHaveLength(1);
        const recent = slack.recent.bind(slack);
        const context = slack.context.bind(slack);
        const error = Object.assign(new Error(failure.code), failure);
        slack.recent = async (id, limit) => {
          if ((stage === "probe" && limit === 1) || (stage === "recent" && limit !== 1)) throw error;
          return recent(id, limit);
        };
        slack.context = async (...args) => {
          if (stage === "context") throw error;
          return context(...args);
        };
        // Expire probes as well as the held answer.
        now += 16 * 60_000;
        const failedAt = now;
        expect(await reader.read()).toEqual(first);
        expect(calls.bootstrap).toBe(2);
        now += 3 * 60_000;
        expect(await reader.read()).toEqual(first);
        expect(calls.bootstrap).toBe(2);
        const delay = Math.max(OUTSIDE_FAILED_BACKOFF_MS, "retryAfterSeconds" in failure ? failure.retryAfterSeconds! * 1000 : 0);
        now = failedAt + delay - 1;
        expect(await reader.read()).toEqual(first);
        expect(calls.bootstrap).toBe(2);
        now += 1;
        slack.recent = recent;
        slack.context = context;
        await reader.read();
        expect(calls.bootstrap).toBe(3);
      });
    }
  }

  test("a first-read fake 429 does not bootstrap again three minutes later or before retry-after", async () => {
    let now = NOW;
    const { slack, calls } = fakeSlack(dms(1, () => 1));
    slack.recent = async () => { throw Object.assign(new Error("ratelimited"), { status: 429, code: "ratelimited", retryAfterSeconds: 600 }); };
    const reader = new OutsideReader(slack, () => now);
    expect(await reader.read()).toEqual({ connected: true, threads: [] });
    now += 3 * 60_000;
    await reader.read();
    expect(calls.bootstrap).toBe(1);
    now = NOW + 600_000 - 1;
    await reader.read();
    expect(calls.bootstrap).toBe(1);
    now += 1;
    await reader.read();
    expect(calls.bootstrap).toBe(2);
  });

  test("conversation-local recent and context misses remain tolerable", async () => {
    const root = msg("r", "U_KIM", 1, { threadSummary: { count: 1, lastActiveAt: NOW - H } });
    const { slack } = fakeSlack([...dms(1, () => 2), { id: "D1", kind: "direct", messages: [root] }]);
    const recent = slack.recent.bind(slack);
    slack.recent = async (id, limit) => {
      if (id === "D00") throw Object.assign(new Error("channel_not_found"), { status: 404, code: "channel_not_found" });
      return recent(id, limit);
    };
    slack.context = async () => { throw Object.assign(new Error("message_not_found"), { status: 404, code: "message_not_found" }); };
    const value = await new OutsideReader(slack, () => NOW).read();
    expect(value.threads.map((t) => t.channel.id)).toEqual(["D1"]);
    expect(value.threads[0]?.messages[0]?.id).toBe("r");
  });

  test("a thread longer than a page is read on to its newest reply", async () => {
    const root = msg("r", ME, 30, { threadSummary: { count: 250, lastActiveAt: NOW - H } });
    const replies = [root, ...Array.from({ length: 249 }, (_, i) => msg(`t${i}`, ME, 29 - i * 0.1)), msg("t-last", "U_KIM", 1)];
    const { slack, calls } = fakeSlack([{ id: "C1", kind: "channel", messages: [root], thread: replies }]);
    const [t] = (await new OutsideReader(slack, () => NOW).read()).threads;
    expect(t?.last).toEqual({ who: "u_kim", operator: false, at: NOW - H });
    expect(calls.context.map((c) => c.cursor ?? null)).toEqual([null, "200"]);
  });
});

describe("quota crossings", () => {
  const gauge = (history: Array<[number, number, number]>, current = { fill: 0.2, resetAt: NOW + 100 * H }): QuotaGaugeInput => ({
    id: "claude", label: "Claude", kind: "quota",
    windows: [{ label: "7d", ...current, history: history.map(([h, fill, reset]) => ({ capturedAt: NOW - h * H, fill, resetAt: NOW - reset * H })) }],
  });

  test("one event per window cycle that passed 90%, at its first reading over the line", () => {
    const events = quotaCrossings([gauge([[60, 0.7, 30], [50, 0.91, 30], [40, 0.96, 30], [20, 0.1, -100]])]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "claude", window: "7d", crossedAt: NOW - 50 * H, peak: 0.96, peakAt: NOW - 40 * H, resetAt: NOW - 30 * H });
    expect(events[0]!.points).toHaveLength(3);
    expect(events[0]!.now).toEqual({ fill: 0.2, resetAt: NOW + 100 * H });
  });

  test("a reset read as seconds-from-now drifts on every reading but stays one cycle", () => {
    const reset = NOW + 30 * H;
    const drift = [12_000, -8_000, 31_000, -40_000, 3_000];
    const history = drift.map((d, i) => ({ capturedAt: NOW - (10 - i) * H, fill: 0.88 + i * 0.02, resetAt: reset + d }));
    const events = quotaCrossings([{ id: "codex", label: "Codex", kind: "quota", windows: [{ label: "7d", fill: 0.96, resetAt: reset, history }] }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ crossedAt: NOW - 9 * H, peak: 0.96, resetAt: reset + 3_000, now: null });
    expect(events[0]!.points).toHaveLength(5);
  });

  test("a reset only guessed as a window from the reading belongs to no cycle", () => {
    const history = [0, 1, 2].map((i) => ({ capturedAt: NOW - (5 - i) * H, fill: 0.95, resetAt: NOW - (5 - i) * H + 7 * 24 * H }));
    expect(quotaCrossings([{ id: "claude", label: "Claude", kind: "quota", windows: [{ label: "7d", fill: 0.95, resetAt: NOW + 7 * 24 * H, windowMs: 7 * 24 * H, history }] }])).toEqual([]);
  });

  test("a cycle that stayed under the line, and status gauges, make nothing", () => {
    expect(quotaCrossings([gauge([[60, 0.5, 30], [50, 0.89, 30]]), { id: "cursor", label: "Cursor", kind: "status" }])).toEqual([]);
  });
});

describe("the week by project", () => {
  test("counts posts per working day and project, by harness, over seven days", () => {
    const grid = activityGrid([
      { day: "2026-11-16", project: "demo-app", harness: "claude" },
      { day: "2026-11-16", project: "demo-app", harness: "codex" },
      { day: "2026-11-14", project: "scout", harness: "claude" },
      { day: "2026-11-01", project: "scout", harness: "claude" },
      { day: "2026-11-16", project: null, harness: "claude" },
    ], NOW);
    expect(grid.days).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(grid.rows.map((r) => [r.project, r.total])).toEqual([["demo-app", 2], ["scout", 1]]);
    expect(grid.rows[0]!.cells[6]).toEqual({ claude: 1, codex: 1 });
  });
});
