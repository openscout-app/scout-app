import { describe, expect, test } from "bun:test";

import type { IndexStartResponse, KnowledgeStatus } from "../../lib/knowledge-search.ts";
import {
  createKnowledgeSearchStore,
  indexBusy,
  indexProgress,
  indexStatusLine,
  INDEX_POLL_MS,
  KNOWLEDGE_SEARCH_REINDEX_TTL_MS,
  knowledgeSearchFilterKey,
  serverIndexing,
  type KnowledgeAnswer,
} from "./knowledge-search-store.ts";
import type { SearchPrimitivesResponse } from "./search-primitives.ts";

/*
 * The index lifecycle every Search surface shares, against a fake server and
 * a fake clock: one open-time refresh however many surfaces open, a poll only
 * while someone watches a running index, runs counted once, failures kept.
 */

function status(patch: Partial<KnowledgeStatus> = {}): KnowledgeStatus {
  return {
    generatedAt: 1_000,
    paths: { knowledgeRoot: "/k", qmdRoot: "/q", sqlitePath: "/s" },
    collections: 0,
    readyCollections: 0,
    chunks: 0,
    activeJobs: [],
    sqliteBytes: 0,
    indexing: null,
    lastIndex: null,
    ...patch,
  };
}

const facets: SearchPrimitivesResponse = {
  facets: [{ key: "harness", value: "claude", count: 3 }] as SearchPrimitivesResponse["facets"],
  params: { facets: [], genericFacetPrefixes: [], ranges: [], collections: [], sourceKinds: [] },
  status: status(),
};

function fakeServer(start: KnowledgeStatus) {
  let current = start;
  const calls = { status: 0, start: [] as boolean[], facets: 0 };
  let now = 10_000;
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let startImpl: (force: boolean) => Promise<IndexStartResponse> = async () => {
    current = { ...current, indexing: { startedAt: now } };
    return { started: true, indexing: current.indexing };
  };
  const store = createKnowledgeSearchStore({
    fetchStatus: async () => {
      calls.status += 1;
      return current;
    },
    startIndex: (force) => {
      calls.start.push(force);
      return startImpl(force);
    },
    fetchFacets: async () => {
      calls.facets += 1;
      return facets;
    },
    now: () => now,
    setTimer: (run, ms) => {
      expect(ms).toBe(INDEX_POLL_MS);
      const id = nextTimer++;
      timers.set(id, run);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  });
  return {
    store,
    calls,
    timers,
    set(next: Partial<KnowledgeStatus>) {
      current = { ...current, ...next };
    },
    advance(ms: number) {
      now += ms;
    },
    onStart(impl: (force: boolean) => Promise<IndexStartResponse>) {
      startImpl = impl;
    },
    /** Fire the pending poll and let its promise chain settle. */
    async tick() {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, run] of due) run();
      await flush();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the index lifecycle", () => {
  test("surfaces opening together share one status read and one background run", async () => {
    const server = fakeServer(status({ chunks: 0 }));
    await Promise.all([server.store.open(), server.store.open(), server.store.open()]);
    expect(server.calls.status).toBe(2); // the open read, then the read after the start
    expect(server.calls.start).toEqual([false]);
    expect(server.store.getState().statusLoaded).toBe(true);
    expect(indexBusy(server.store.getState())).toBe(true);
  });

  test("a run already going is followed, not started again", async () => {
    const server = fakeServer(status({ chunks: 5, indexing: { startedAt: 1 } }));
    await server.store.open();
    expect(server.calls.start).toEqual([]);
  });

  test("a run that finished here in the last 5 minutes skips the open-time refresh, while the index has content", async () => {
    const server = fakeServer(status({ chunks: 5 }));
    const release = server.store.watch();
    await server.store.open();
    expect(server.calls.start).toEqual([false]);
    server.set({ indexing: null, lastIndex: { finishedAt: 2, ok: true } });
    await server.tick();
    expect(server.store.getState().runs).toBe(1);

    await server.store.open();
    expect(server.calls.start).toEqual([false]);

    server.advance(KNOWLEDGE_SEARCH_REINDEX_TTL_MS);
    await server.store.open();
    expect(server.calls.start).toEqual([false, false]);
    release();
  });

  test("status is polled only while the server indexes and someone watches", async () => {
    const server = fakeServer(status({ chunks: 5 }));
    await server.store.open();
    expect(server.timers.size).toBe(0); // indexing, but nobody watching
    const release = server.store.watch();
    const again = server.store.watch();
    expect(server.timers.size).toBe(1); // one poll for every watcher
    release();
    expect(server.timers.size).toBe(1);
    again();
    expect(server.timers.size).toBe(0);
  });

  test("a run ending is counted once, and a failed one says why", async () => {
    const server = fakeServer(status({ chunks: 5 }));
    const release = server.store.watch();
    await server.store.open();
    server.set({ indexing: null, lastIndex: { finishedAt: 20_000, ok: false, error: "disk full" } });
    await server.tick();
    const state = server.store.getState();
    expect(state.runs).toBe(1);
    expect(state.error).toBe("Indexing failed: disk full");
    expect(server.timers.size).toBe(0);
    await server.tick();
    expect(server.store.getState().runs).toBe(1);
    release();
  });

  test("Update index forces a run and clears the last error; a second press joins the first", async () => {
    const server = fakeServer(status({ chunks: 5 }));
    server.store.applyStatus(status({ chunks: 5 }));
    await Promise.all([server.store.refresh(true), server.store.refresh(true)]);
    expect(server.calls.start).toEqual([true]);
    expect(server.store.getState().starting).toBe(false);
    expect(server.store.getState().error).toBeNull();
  });

  test("an older server answers the start with the finished run: counted once", async () => {
    const server = fakeServer(status({ chunks: 0 }));
    server.onStart(async () => ({ status: status({ chunks: 9, lastIndex: { finishedAt: 20_000, ok: true } }) }));
    await server.store.refresh(false);
    expect(server.store.getState().runs).toBe(1);
    expect(server.store.getState().status?.chunks).toBe(9);
  });

  test("another run already going is followed instead of failing", async () => {
    const server = fakeServer(status({ chunks: 5, indexing: { startedAt: 1 } }));
    server.onStart(async () => {
      throw new Error("index already running");
    });
    await server.store.refresh(true);
    expect(server.store.getState().error).toBeNull();
    expect(serverIndexing(server.store.getState().status)).toBe(true);
  });

  test("a start that fails says so", async () => {
    const server = fakeServer(status());
    server.onStart(async () => {
      throw new Error("broker unavailable");
    });
    await server.store.refresh(true);
    expect(server.store.getState().error).toBe("broker unavailable");
    expect(server.store.getState().statusLoaded).toBe(true);
  });

  test("facets load once the index has content, and again after each run", async () => {
    const server = fakeServer(status({ chunks: 0 }));
    server.store.loadFacets();
    expect(server.calls.facets).toBe(0);
    server.store.applyStatus(status({ chunks: 5 }));
    server.store.loadFacets();
    server.store.loadFacets();
    await flush();
    expect(server.calls.facets).toBe(1);
    expect(server.store.getState().facets).toBe(facets);
    server.store.applyStatus(status({ chunks: 5, indexing: { startedAt: 1 } }));
    server.store.applyStatus(status({ chunks: 6, indexing: null }));
    server.store.loadFacets();
    await flush();
    expect(server.calls.facets).toBe(2);
  });

  test("surfaces showing the status are counted, and each release counts once", () => {
    const server = fakeServer(status());
    const a = server.store.showStatus();
    const b = server.store.showStatus();
    expect(server.store.getState().shown).toBe(2);
    a();
    a();
    expect(server.store.getState().shown).toBe(1);
    b();
    expect(server.store.getState().shown).toBe(0);
  });
});

describe("answers kept for warm starts", () => {
  const answer = (n: number): KnowledgeAnswer => ({ hits: [], mode: "index", basic: null, ...{ n } });

  test("two filter sets keep their own answers", () => {
    const { store } = fakeServer(status());
    store.remember("q=a", answer(1));
    store.remember("q=b", answer(2));
    expect(store.answerFor("q=a")).toEqual(answer(1));
    expect(store.answerFor("q=b")).toEqual(answer(2));
  });

  test("the oldest answer goes first once twelve are kept", () => {
    const { store } = fakeServer(status());
    for (let i = 0; i < 13; i++) store.remember(`q=${i}`, answer(i));
    expect(store.answerFor("q=0")).toBeUndefined();
    expect(store.answerFor("q=12")).toBeDefined();
  });

  test("the key ignores a trailing space and the order filters were set in", () => {
    const base = { query: "deploy", sourceKinds: ["session"], harness: [], project: [], timeWindow: "all" as const };
    expect(knowledgeSearchFilterKey({ ...base, query: "deploy " })).toBe(knowledgeSearchFilterKey(base));
  });
});

describe("the status line", () => {
  test("says what the index holds, or what it is doing", () => {
    expect(indexStatusLine({ starting: false, status: null, statusLoaded: false }, "")).toBe("Loading index");
    expect(indexStatusLine({ starting: false, status: status(), statusLoaded: true }, "")).toBe("No index yet · basic search");
    expect(indexStatusLine({ starting: false, status: status({ chunks: 1234 }), statusLoaded: true }, "14:02"))
      .toBe("1,234 moments · last 3 days · updated 14:02");
    expect(indexStatusLine({ starting: true, status: status({ chunks: 4 }), statusLoaded: true }, ""))
      .toBe("Refreshing last 3 days in the background");
    expect(indexStatusLine({ starting: true, status: status(), statusLoaded: true }, ""))
      .toBe("Building the index for the last 3 days in the background");
    const running = status({
      indexing: { startedAt: 1 },
      activeJobs: [{ id: "j", source: "sessions", state: "running", progress: { discovered: 40, indexed: 12 }, updatedAt: 1 }],
    });
    expect(indexStatusLine({ starting: false, status: running, statusLoaded: true }, ""))
      .toBe("Indexing sessions in the background · 12 of 40");
    expect(indexProgress(running)).toEqual({ indexed: 12, discovered: 40 });
  });

  test("an older server without `indexing` is busy while it lists a job", () => {
    const older = status({ activeJobs: [{ id: "j", source: "s", state: "running", progress: {}, updatedAt: 1 }] });
    delete (older as Partial<KnowledgeStatus>).indexing;
    expect(serverIndexing(older)).toBe(true);
    expect(indexProgress(older)).toBeNull();
  });
});
