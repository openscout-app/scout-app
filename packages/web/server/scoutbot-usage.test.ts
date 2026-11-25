import { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScoutbotUsageStore } from "./scoutbot-usage.ts";
import { createScoutbotAssistantService } from "./scoutbot-assistant.ts";
import { ScoutRealtimeVoiceAdmission } from "./realtime-voice.ts";
import { mountScoutVoiceRoutes } from "./routes/voice.ts";

describe("voice usage receipts", () => {
  test("upgrades existing call receipts without inventing historical timestamps or models", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE live_provider_sessions (
        lease_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL,
        reason TEXT, usage_seconds REAL, client_state TEXT, client_reason TEXT,
        client_usage_seconds REAL, updated_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
      ); INSERT INTO live_provider_sessions (lease_id, session_id, state, usage_seconds, updated_at)
        VALUES ('old-lease', 'old-session', 'confirmed', 12.5, 1000)`);
      const admission = new ScoutRealtimeVoiceAdmission({ database: db });
      expect(admission.usageHistory()[0]).toMatchObject({ sessionId: "old-session", providerSeconds: 12.5,
        startedAt: null, endedAt: null, model: null, voice: null });
      // Reopening an already migrated database is safe too.
      expect(new ScoutRealtimeVoiceAdmission({ database: db }).usageHistory()).toHaveLength(1);
    } finally { db.close(); }
  });
  test("persists per-session measurements across reopen and ignores duplicate completion", () => {
    const root = mkdtempSync(join(tmpdir(), "scout-usage-"));
    try {
      const path = join(root, "usage.sqlite");
      const store = new ScoutbotUsageStore({ path });
      const id = store.start({ sessionId: "local-session", mode: "local", model: "test-llm", startedAt: 1000 });
      store.finish(id, { state: "completed", provider: "openai", finishedAt: 3250, usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } });
      store.finish(id, { state: "failed", finishedAt: 9000 });
      store.close();
      const reopened = new ScoutbotUsageStore({ path });
      try {
        expect(reopened.snapshot().records).toHaveLength(1);
        expect(reopened.snapshot().records[0]).toMatchObject({ sessionId: "local-session", state: "completed", elapsedMs: 2250, totalTokens: 14 });
        expect(reopened.snapshot().summaries[0]).toMatchObject({ requests: 1, missingTokenReports: 0, totalTokens: 14 });
      } finally { reopened.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("unknown, invalid, pending and zero receipts remain distinguishable", () => {
    const db = new Database(":memory:");
    try {
      const store = new ScoutbotUsageStore({ database: db });
      const unknown = store.start({ sessionId: "s", mode: "local", model: "codex", startedAt: 10 });
      store.finish(unknown, { state: "completed", finishedAt: 20, usage: { inputTokens: -1, outputTokens: NaN, totalTokens: 1.5 } });
      store.start({ sessionId: "s", mode: "local", model: "pending", startedAt: 30 });
      const zero = store.start({ sessionId: "s", mode: "api", model: "zero", startedAt: 30 });
      store.finish(zero, { state: "completed", finishedAt: 40, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
      expect(store.snapshot().summaries.find(item => item.mode === "local")).toMatchObject({ totalTokens: null, missingTokenReports: 2 });
      expect(store.snapshot().summaries.find(item => item.mode === "api")).toMatchObject({ totalTokens: 0, missingTokenReports: 0 });
    } finally { db.close(); }
  });

  test("records actual reply model and tokens even when caller cancels after provider work", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const controller = new AbortController();
      const finish = usage.finish.bind(usage);
      usage.finish = (id, receipt) => { finish(id, receipt); controller.abort(); };
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL: "original-model" },
        fetchImpl: (async (_url, init) => {
          expect(JSON.parse(String(init?.body)).model).toBe("original-model");
          service.updateConfig({ model: "changed-model" });
          return Response.json({ id: "response", output_text: "done", usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } });
        }) as typeof fetch,
      });
      await expect(service.respond({ body: "test", usageMode: "api", signal: controller.signal })).rejects.toThrow();
      expect(usage.snapshot().records[0]).toMatchObject({ mode: "api", model: "original-model", provider: "openai", state: "completed", totalTokens: 11 });
      expect(service.getSessionState().session.messages).toHaveLength(0);
    } finally { db.close(); }
  });

  test("failed requests retain duration with unavailable token usage", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "fixture" }, fetchImpl: (async () => Response.json({ error: { message: "upstream failed" } }, { status: 500 })) as typeof fetch,
      });
      await expect(service.respond({ body: "test", usageMode: "local" })).rejects.toThrow("upstream failed");
      expect(usage.snapshot().records[0]).toMatchObject({ state: "failed", totalTokens: null });
      expect(usage.snapshot().records[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally { db.close(); }
  });

  test("usage reads neither start a call nor invoke a provider, and live receipts remain separate", async () => {
    const db = new Database(":memory:");
    const usageDb = new Database(":memory:");
    let now = 1000;
    const admission = new ScoutRealtimeVoiceAdmission({ database: db, now: () => now });
    const usage = new ScoutbotUsageStore({ database: usageDb });
    const app = new Hono();
    const dispose = mountScoutVoiceRoutes(app, { usage: () => usage, realtimeVoiceAdmission: admission,
      createRealtimeVoiceCall: async () => { throw new Error("Unexpected provider call"); } });
    try {
      const before = await app.request("/api/voice/usage");
      expect(await before.json()).toEqual({ llm: { records: [], summaries: [] }, calls: [] });
      expect(admission.activeLeaseCount()).toBe(0);
      const lease = admission.admit();
      admission.bindSession(lease.id, "provider-session", { model: "configured-live-model", voice: "configured-voice" });
      now = 5000;
      admission.recordClientFinalization(lease.id, { state: "confirmed", seconds: 3.5 });
      admission.recordClientFinalization(lease.id, { state: "unconfirmed" });
      expect(admission.usageHistory()[0]).toMatchObject({ providerSeconds: null, clientReportedSeconds: 3.5, startedAt: 1000, endedAt: 5000 });
      admission.release(lease.id);
      const reservation = admission.reserveFinalization(lease.id)!;
      admission.recordFinalization(lease.id, { state: "confirmed", seconds: 4 }, reservation.attempt);
      const after = await app.request("/api/voice/usage");
      expect(after.headers.get("cache-control")).toBe("no-store");
      expect((await after.json()).calls[0]).toMatchObject({ providerSeconds: 4, clientReportedSeconds: 3.5, model: "configured-live-model", voice: "configured-voice" });
    } finally { dispose(); db.close(); usageDb.close(); }
  });
});

// Each upstream request attempt is recorded once. Route/stream finalization is
// deliberately not another usage writer. All providers below are local mocks.
describe("post-979 usage across provider and streaming paths", () => {
  const jsonReply = () => Response.json({ id: "receipt", output_text: "A reply.",
    usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } });
  const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } });
  const completed = { type: "response.completed", response: { id: "stream-receipt", output_text: "A reply.",
    usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } };

  for (const stream of [false, true]) {
    test(`records actual Codex provider with unknown tokens and fresh history (stream=${stream})`, async () => {
      const db = new Database(":memory:");
      try {
        const usage = new ScoutbotUsageStore({ database: db });
        const service = createScoutbotAssistantService({
          currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
          env: { OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "agent" }, agentAvailable: () => true,
          invokeCodex: async input => {
            expect(input.threadId).toBeNull();
            expect(usage.snapshot().records[0]).toMatchObject({ provider: "codex", state: "pending" });
            input.onDelta?.("A reply. ");
            return { output: "A reply.", threadId: "fresh-thread" };
          },
          fetchImpl: (async () => { throw new Error("No cloud call expected"); }) as typeof fetch,
        });
        const input = { body: "test", usageMode: "local" as const, onSentence: () => {} };
        await (stream ? service.respondStream(input) : service.respond(input));
        expect(usage.snapshot().records).toHaveLength(1);
        expect(usage.snapshot().records[0]).toMatchObject({ mode: "local", state: "completed", provider: "codex", totalTokens: null });
        expect(service.getSessionState().session.messages).toHaveLength(2);
      } finally { db.close(); }
    });

    test(`counts each agent-to-OpenAI fallback attempt once (stream=${stream})`, async () => {
      const db = new Database(":memory:");
      try {
        const usage = new ScoutbotUsageStore({ database: db });
        let cloud = 0;
        const service = createScoutbotAssistantService({
          currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
          // With no provider set, Scoutbot stays on the agent and never falls back, so this test opts into the auto ladder.
          env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "auto" }, agentAvailable: () => true,
          invokeCodex: async () => { throw new Error("agent refused before output"); },
          fetchImpl: (async () => { cloud++; return stream ? sse([completed]) : jsonReply(); }) as typeof fetch,
        });
        const input = { body: "test", usageMode: "api" as const, onSentence: () => {} };
        await (stream ? service.respondStream(input) : service.respond(input));
        const { records, summaries } = usage.snapshot();
        expect(cloud).toBe(1);
        expect(records).toHaveLength(2);
        expect(records.find(r => r.provider === "codex")).toMatchObject({ state: "failed", totalTokens: null });
        expect(records.find(r => r.provider === "openai")).toMatchObject({ state: "completed", totalTokens: 11 });
        expect(summaries[0]).toMatchObject({ requests: 2, totalTokens: 11, missingTokenReports: 1 });
      } finally { db.close(); }
    });

    test(`retains completed receipt before history cancellation and model changes (stream=${stream})`, async () => {
      const db = new Database(":memory:");
      try {
        const usage = new ScoutbotUsageStore({ database: db });
        const abort = new AbortController();
        const finish = usage.finish.bind(usage);
        usage.finish = (id, receipt) => { finish(id, receipt); abort.abort(); };
        const service = createScoutbotAssistantService({
          currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
          env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL: "captured", OPENSCOUT_SCOUTBOT_VOICE_MODEL: "captured" },
          fetchImpl: (async () => { service.updateConfig({ model: "changed" }); return stream ? sse([completed]) : jsonReply(); }) as typeof fetch,
        });
        const sentences: string[] = [];
        const input = { body: "test", usageMode: "local" as const, signal: abort.signal, onSentence: (s: string) => sentences.push(s) };
        await expect(stream ? service.respondStream(input) : service.respond(input)).rejects.toThrow();
        expect(usage.snapshot().records).toHaveLength(1);
        expect(usage.snapshot().records[0]).toMatchObject({ model: "captured", state: "completed", totalTokens: 11 });
        expect(service.getSessionState().session.messages).toHaveLength(0);
        expect(sentences).toEqual([]);
      } finally { db.close(); }
    });
  }

  test("separates unsupported-stream and plain fallback attempts without finalizer double count", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      let calls = 0;
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => ++calls === 1 ? Response.json({ error: { message: "no SSE" } }, { status: 400 }) : jsonReply()) as typeof fetch,
      });
      await service.respondStream({ body: "test", usageMode: "local", onSentence: () => {} });
      expect(calls).toBe(2);
      expect(usage.snapshot().records).toHaveLength(2);
      expect(usage.snapshot().summaries[0]).toMatchObject({ requests: 2, totalTokens: 11, missingTokenReports: 1 });
    } finally { db.close(); }
  });

  test("a JSON response to streaming is one provider request", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => jsonReply()) as typeof fetch,
      });
      await service.respondStream({ body: "test", usageMode: "local", onSentence: () => {} });
      expect(usage.snapshot().records).toHaveLength(1);
      expect(usage.snapshot().summaries[0]).toMatchObject({ requests: 1, totalTokens: 11 });
    } finally { db.close(); }
  });

  test("mid-stream failure records duration and missing receipt without fallback", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      let calls = 0;
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => { calls++; return sse([{ type: "response.output_text.delta", delta: "Partial. " },
          { type: "response.failed", response: { error: { message: "midstream failed" } } }]); }) as typeof fetch,
      });
      await expect(service.respondStream({ body: "test", onSentence: () => {} })).rejects.toThrow();
      expect(calls).toBe(1);
      expect(usage.snapshot().records[0]).toMatchObject({ provider: "openai", state: "failed", totalTokens: null });
      expect(usage.snapshot().records[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(service.getSessionState().session.messages).toHaveLength(0);
    } finally { db.close(); }
  });

  test("early cancellation cannot invent a completed provider receipt", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const abort = new AbortController();
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => { abort.abort(); return jsonReply(); }) as typeof fetch,
      });
      await expect(service.respond({ body: "test", signal: abort.signal })).rejects.toThrow();
      expect(usage.snapshot().records[0]).toMatchObject({ state: "failed", totalTokens: null });
    } finally { db.close(); }
  });

  test("completion persistence failure preserves provider result and leaves an honest pending row", async () => {
    const db = new Database(":memory:");
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      usage.finish = () => { throw new Error("simulated disk failure"); };
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => jsonReply()) as typeof fetch,
      });
      expect((await service.respond({ body: "test" })).reply.body).toBe("A reply.");
      expect(usage.snapshot().records[0]).toMatchObject({ provider: "openai", state: "pending", totalTokens: null });
      expect(warning).toHaveBeenCalledTimes(1);
    } finally { warning.mockRestore(); db.close(); }
  });

  test("start persistence failure prevents provider work", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      usage.start = () => { throw new Error("simulated start failure"); };
      let calls = 0;
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => { calls++; return jsonReply(); }) as typeof fetch,
      });
      await expect(service.respond({ body: "test" })).rejects.toThrow("simulated start failure");
      expect(calls).toBe(0);
    } finally { db.close(); }
  });
});

describe("usage by request, for the settings page", () => {
  const seed = (store: ScoutbotUsageStore, startedAt: number, tokens: number | null) => {
    const id = store.start({ sessionId: "s", mode: "chat", model: "m", provider: "openai", startedAt });
    store.finish(id, { state: "completed", provider: "openai", finishedAt: startedAt + 5,
      usage: tokens === null ? null : { inputTokens: tokens - 1, outputTokens: 1, totalTokens: tokens } });
  };

  test("since returns the window newest first and says when it left rows out", () => {
    const db = new Database(":memory:");
    try {
      const store = new ScoutbotUsageStore({ database: db });
      for (const at of [100, 200, 300, 400]) seed(store, at, at);
      expect(store.since(200).records.map(r => r.startedAt)).toEqual([400, 300, 200]);
      expect(store.since(200).truncated).toBe(false);
      const bounded = store.since(0, 2);
      expect(bounded.records.map(r => r.startedAt)).toEqual([400, 300]);
      expect(bounded.truncated).toBe(true);
      expect(store.since(401)).toEqual({ records: [], truncated: false });
    } finally { db.close(); }
  });

  test("the usage route reads recorded requests and calls no provider", async () => {
    const { mountScoutbotRoutes } = await import("./routes/scoutbot.ts");
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const now = Date.now();
      seed(usage, now - 1000, 48_400);
      seed(usage, now - 2000, null);
      seed(usage, now - 40 * 24 * 60 * 60 * 1000, 9);
      const assistant = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
        fetchImpl: (async () => { throw new Error("Unexpected provider call"); }) as typeof fetch,
      });
      const app = new Hono();
      mountScoutbotRoutes(app, { assistant, usage: () => usage } as Parameters<typeof mountScoutbotRoutes>[1], { currentDirectory: "/tmp/scout-usage-test" });
      const response = await app.request("/api/scoutbot/usage?days=30");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json() as { days: number; truncated: boolean; records: Array<{ totalTokens: number | null }> };
      expect(body.days).toBe(30);
      expect(body.truncated).toBe(false);
      expect(body.records.map(r => r.totalTokens)).toEqual([48_400, null]);
      const clamped = await (await app.request("/api/scoutbot/usage?days=9999")).json() as { days: number; records: unknown[] };
      expect(clamped.days).toBe(90);
      expect(clamped.records).toHaveLength(3);
      expect(((await (await app.request("/api/scoutbot/usage?days=nope")).json()) as { days: number }).days).toBe(30);
      // An empty value is no choice, not zero days.
      expect(((await (await app.request("/api/scoutbot/usage?days=")).json()) as { days: number }).days).toBe(30);
      expect(((await (await app.request("/api/scoutbot/usage?days=0")).json()) as { days: number }).days).toBe(1);
    } finally { db.close(); }
  });

  test("requests made outside a conversation are recorded under their own kind", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL: "typed-model",
          OPENSCOUT_BUDGET_ADVICE_MODEL: "advice-model" },
        fetchImpl: (async () => Response.json({ id: "r", output_text: "Fine.", usage: { input_tokens: 40, output_tokens: 6, total_tokens: 46 } })) as typeof fetch,
      });
      await service.summarizeSessionRecap({ body: "events", systemPrompt: "Recap." });
      await service.completeCheap({ systemPrompt: "Assess.", body: "gauges" });
      const records = usage.snapshot().records;
      expect(records.find(r => r.mode === "recap")).toMatchObject({ model: "typed-model", provider: "openai", state: "completed", totalTokens: 46 });
      expect(records.find(r => r.mode === "advice")).toMatchObject({ model: "advice-model", provider: "openai", state: "completed", totalTokens: 46 });
      expect(records).toHaveLength(2);
      // Neither touched the conversation.
      expect(service.getSessionState().session.messages).toHaveLength(0);
    } finally { db.close(); }
  });

  test("a briefing records its request, and a recap through Codex records no tokens", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
        env: { OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "agent" }, agentAvailable: () => true,
        invokeCodex: async () => ({ output: "{\"title\":\"Quiet\",\"steps\":[]}", threadId: "t" }),
        fetchImpl: (async () => { throw new Error("No cloud call expected"); }) as typeof fetch,
      });
      await service.summarizeSessionRecap({ body: "events", systemPrompt: "Recap." });
      await service.createBrief({}).catch(() => undefined);
      const records = usage.snapshot().records;
      expect(records.find(r => r.mode === "recap")).toMatchObject({ provider: "codex", state: "completed", totalTokens: null });
      expect(records.filter(r => r.mode === "brief")).toHaveLength(1);
      expect(records.find(r => r.mode === "brief")).toMatchObject({ provider: "codex", totalTokens: null });
    } finally { db.close(); }
  });

  test("measuring what a turn carries reads state and asks no model", async () => {
    const service = createScoutbotAssistantService({
      currentDirectory: "/tmp/scout-usage-test",
      loadContext: (_route, options) => options?.spoken
        ? { agents: ["a"], mesh: null }
        : { agents: ["a", "b", "c"], sessions: [{ id: "s1" }], mesh: null },
      env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROMPT: "Be brief." },
      fetchImpl: (async () => { throw new Error("Unexpected provider call"); }) as typeof fetch,
    });
    const measure = await service.measureContext();
    expect(measure.instructionsChars).toBe("Be brief.".length);
    expect(measure.typed.chars).toBe(JSON.stringify({ agents: ["a", "b", "c"], sessions: [{ id: "s1" }], mesh: null }).length);
    expect(measure.typed.parts).toEqual([
      { key: "sessions", chars: 13 },
      { key: "agents", chars: 13 },
      { key: "mesh", chars: 4 },
    ].sort((a, b) => b.chars - a.chars || a.key.localeCompare(b.key)));
    expect(measure.spoken.chars).toBeLessThan(measure.typed.chars);
  });

  test("a message carries Scoutbot's own recorded use, so it can answer for it", async () => {
    const db = new Database(":memory:");
    try {
      const usage = new ScoutbotUsageStore({ database: db });
      seed(usage, Date.now() - 1000, 48_400);
      seed(usage, Date.now() - 2000, null);
      const bodies: string[] = [];
      const service = createScoutbotAssistantService({
        currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({ agents: ["a"] }),
        env: { OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "fixture" },
        fetchImpl: (async (_url, init) => {
          bodies.push(String(init?.body));
          return Response.json({ id: "r", output_text: "Fine.", usage: { input_tokens: 40, output_tokens: 6, total_tokens: 46 } });
        }) as typeof fetch,
      });
      await service.respond({ body: "How many tokens have you used today?" });
      expect(bodies).toHaveLength(1);
      // The state is sent as JSON inside the request, so its quotes are escaped once more.
      expect(bodies[0]).toContain("scoutbotUsage");
      expect(bodies[0]).toContain("48400");
      expect(bodies[0]).toContain("noTokenReport");
      const measure = await service.measureContext();
      expect(measure.typed.parts.map((part) => part.key)).toEqual(expect.arrayContaining(["agents", "scoutbotUsage"]));
    } finally { db.close(); }
  });

  test("a usage store that cannot be read leaves the part out and the reply still goes", async () => {
    const bodies: string[] = [];
    const service = createScoutbotAssistantService({
      currentDirectory: "/tmp/scout-usage-test", loadContext: () => ({ agents: ["a"] }),
      usage: () => ({
        start: () => "id", finish: () => undefined, since: () => { throw new Error("disk"); },
      }) as unknown as ScoutbotUsageStore,
      env: { OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "fixture" },
      fetchImpl: (async (_url, init) => { bodies.push(String(init?.body)); return Response.json({ id: "r", output_text: "Fine." }); }) as typeof fetch,
    });
    await service.respond({ body: "hello" });
    expect(bodies).toHaveLength(1);
    expect(service.getSessionState().session.messages.at(-1)?.body).toBe("Fine.");
    // The instructions name the part; the state itself must not hold it.
    expect(bodies[0]).not.toContain("noTokenReport");
  });

  test("the usage route answers 503 when the store cannot be read", async () => {
    const { mountScoutbotRoutes } = await import("./routes/scoutbot.ts");
    const app = new Hono();
    mountScoutbotRoutes(app, { assistant: {}, usage: () => { throw new Error("disk"); } } as unknown as Parameters<typeof mountScoutbotRoutes>[1],
      { currentDirectory: "/tmp/scout-usage-test" });
    expect((await app.request("/api/scoutbot/usage")).status).toBe(503);
  });
});

// Exercise actual route dispatch; no server/listener or runtime is started.
describe("usage attribution at the shared chat route", () => {
  for (const stream of [false, true]) {
    test(`forwards Local metadata and explicit API attribution (stream=${stream})`, async () => {
      const { mountScoutbotRoutes } = await import("./routes/scoutbot.ts");
      const db = new Database(":memory:");
      try {
        const usage = new ScoutbotUsageStore({ database: db });
        const assistant = createScoutbotAssistantService({
          currentDirectory: "/tmp/scout-usage-test", usage: () => usage, loadContext: () => ({}),
          env: { OPENAI_API_KEY: "fixture", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai" },
          fetchImpl: (async () => Response.json({ output_text: "Done.", usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } })) as typeof fetch,
        });
        const app = new Hono();
        mountScoutbotRoutes(app, { assistant } as Parameters<typeof mountScoutbotRoutes>[1], { currentDirectory: "/tmp/scout-usage-test" });
        const post = async (metadata: Record<string, unknown>) => {
          const result = await app.request("/api/scoutbot/chat", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: "test", stream, ...metadata }) });
          expect(result.status).toBe(200);
          const text = await result.text(); // Drain SSE before checking persistence.
          expect(text).not.toContain('event: error');
        };
        await post({ uiContext: { host: "web", usageMode: "local" } });
        await post({ usageMode: "api", uiContext: { host: "web", usageMode: "local" } });
        await post({ uiContext: { host: "web", usageMode: "not-a-mode" } });
        expect(usage.snapshot().records).toHaveLength(3);
        for (const mode of ["local", "api", "chat"]) {
          expect(usage.snapshot().summaries.find(item => item.mode === mode)).toMatchObject({ requests: 1, totalTokens: 3 });
        }
      } finally { db.close(); }
    });
  }
});
