import { describe, expect, test } from "bun:test";

import { askSessionIds, askSilence, lastWrites, sessionEnd, silentSessions, SILENT_AFTER_MS, unlistedEnd, unlistedSessions, type Hearing } from "./swarm-heard.ts";
import type { AgentRun, TailEvent } from "./types.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);

function run(id: string, state: AgentRun["state"], flight: Record<string, unknown>): AgentRun {
  return { id, agentId: `agent-${id}`, state, createdAt: NOW - 60 * MIN, metadata: { flightMetadata: flight } } as unknown as AgentRun;
}

function event(kind: TailEvent["kind"], summary: string, ts: number): TailEvent {
  return { kind, summary, ts } as TailEvent;
}

const traced = (thread: string) => run("a", "running", { sessionTrace: [{ sessionId: "old-thread" }, { sessionId: thread }], dispatchAck: { sessionId: "session-abc" } });

function hearing(writes: Record<string, number>, ends: Hearing["ends"] = new Map()): Hearing {
  return { readAt: NOW, writes: new Map(Object.entries(writes)), ends };
}

describe("hearing a session", () => {
  test("an ask's sessions read latest first, then the dispatch's", () => {
    expect(askSessionIds(traced("thread-1"))).toEqual(["thread-1", "old-thread", "session-abc"]);
    expect(askSessionIds(run("b", "running", {}))).toEqual([]);
  });

  test("a session's last write is its latest move across its transcripts", () => {
    const writes = lastWrites({ transcripts: [
      { sessionId: "t", mtimeMs: NOW - 9 * MIN, lastEventAt: NOW - 8 * MIN },
      { sessionId: "t", mtimeMs: NOW - 20 * MIN },
      { sessionId: null, mtimeMs: NOW },
    ] as never });
    expect([...writes]).toEqual([["t", NOW - 8 * MIN]]);
  });

  test("a log's last word decides how it ended; usage records say nothing", () => {
    expect(sessionEnd([event("assistant", "done", NOW - 3 * MIN), event("system", "task complete", NOW - 2 * MIN), event("other", "tokens", NOW - MIN)], NOW - MIN))
      .toEqual({ at: NOW - 2 * MIN, turnEnded: true, wroteAt: NOW - MIN });
    expect(sessionEnd([event("system", "turn duration · 812 ms", NOW)], NOW)?.turnEnded).toBe(true);
    expect(sessionEnd([event("tool", "bash: bun test", NOW)], NOW)?.turnEnded).toBe(false);
    expect(sessionEnd([event("other", "tokens", NOW)], NOW)).toBeNull();
  });
});

describe("silence", () => {
  test("a session heard from within the bound is not silent", () => {
    expect(askSilence(traced("t"), NOW - 30 * MIN, hearing({ t: NOW - SILENT_AFTER_MS + MIN }))).toBeNull();
    expect(askSilence(traced("t"), NOW - 30 * MIN, hearing({}))).toBeNull();
  });

  test("silence counts from the later of the last write and the start", () => {
    expect(askSilence(traced("t"), NOW - 20 * MIN, hearing({ t: NOW - 40 * MIN }))).toEqual({ since: NOW - 20 * MIN, finished: false });
    expect(askSilence(traced("t"), NOW - 10 * MIN, hearing({ t: NOW - 40 * MIN }))).toBeNull();
  });

  test("a turn that ended after the ask started finished it; an earlier one, or an end read for an older write, does not", () => {
    const wrote = NOW - 30 * MIN;
    const ended = (at: number, wroteAt = wrote) => new Map([["t", { at, turnEnded: true, wroteAt }]]);
    expect(askSilence(traced("t"), NOW - 50 * MIN, hearing({ t: wrote }, ended(wrote)))).toEqual({ since: wrote, finished: true });
    expect(askSilence(traced("t"), NOW - 50 * MIN, hearing({ t: wrote }, ended(NOW - 55 * MIN)))?.finished).toBe(false);
    expect(askSilence(traced("t"), NOW - 50 * MIN, hearing({ t: wrote }, ended(wrote, NOW - 45 * MIN)))?.finished).toBe(false);
  });

  test("the sessions to read are running, silent, and not yet read for their latest write", () => {
    const wrote = NOW - 30 * MIN;
    const runs = [traced("t"), run("b", "completed", { sessionTrace: [{ sessionId: "u" }] }), run("c", "running", { sessionTrace: [{ sessionId: "v" }] })];
    expect(silentSessions(runs, hearing({ t: wrote, u: wrote, v: NOW - MIN }))).toEqual([{ sessionId: "t", wroteAt: wrote }]);
    expect(silentSessions(runs, hearing({ t: wrote }, new Map([["t", { at: wrote, turnEnded: true, wroteAt: wrote }]])))).toEqual([]);
  });
});

describe("a session the tail no longer lists", () => {
  // Lane C's ask went at 02:10Z on 10-23; its turn ended at 02:24Z, and its reply never reached the runtime.
  const asked = Date.UTC(2026, 9, 23, 2, 10, 0);
  const ended = Date.UTC(2026, 9, 23, 2, 24, 23);
  const now = Date.UTC(2026, 9, 24, 10, 5, 0);
  const lane = run("c", "running", { sessionTrace: [{ sessionId: "thread-c" }], dispatchAck: { sessionId: "thread-c" } });
  const heard = (end?: { at: number; turnEnded: boolean; wroteAt: number }): Hearing =>
    ({ readAt: now, writes: new Map(), ends: new Map(end ? [["thread-c", end]] : []) });

  test("its end, read by id, finishes an ask whose turn ended after the ask started", () => {
    const end = unlistedEnd([event("assistant", "Rebased and lease-pushed #95", ended - 1_000), event("other", "tokens", ended - 500), event("system", "task complete", ended)]);
    expect(end).toEqual({ at: ended, turnEnded: true, wroteAt: ended });
    expect(askSilence(lane, asked, heard(end!))).toEqual({ since: ended, finished: true });
  });

  test("a log read by id that stopped mid-turn is silent, and one that moved lately is not", () => {
    expect(askSilence(lane, asked, heard({ at: ended, turnEnded: false, wroteAt: ended }))).toEqual({ since: ended, finished: false });
    expect(askSilence(lane, asked, heard({ at: now - 5 * MIN, turnEnded: true, wroteAt: now - 5 * MIN }))).toBeNull();
  });

  test("an empty read says nothing", () => {
    expect(unlistedEnd([])).toBeNull();
    expect(askSilence(lane, asked, heard())).toBeNull();
  });

  test("the sessions to read by id are running, unlisted, and not read by id within the bound", () => {
    const runs = [lane, traced("t"), run("b", "completed", { sessionTrace: [{ sessionId: "u" }] }), run("d", "running", {})];
    const writes = new Map([["t", now - MIN]]);
    expect(unlistedSessions(runs, { readAt: now, writes, readById: new Map() })).toEqual(["thread-c"]);
    expect(unlistedSessions(runs, { readAt: now, writes, readById: new Map([["thread-c", now - 5 * MIN]]) })).toEqual([]);
    expect(unlistedSessions(runs, { readAt: now, writes, readById: new Map([["thread-c", now - SILENT_AFTER_MS]]) })).toEqual(["thread-c"]);
  });
});
