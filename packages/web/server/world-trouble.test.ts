import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { claudeToolFailed, codexCommandFailed, createTranscriptParser } from "./world-transcript.ts";
import { askRefs, deliveryState, dlvRow, readDeliveriesSince, readOpenTroubleDelivery, readTroubleDeliveries, sessionEndedAt } from "./world-broker-rows.ts";
import { emptyBatch, fromOtlp, otlpFailed, toOtlp } from "./world-otlp.ts";

// FAILED: which rows count. STUCK's threshold is tested with the engine's rules (client/screens/ops/world-week/trouble.test.ts)
describe("World · FAILED mapping", () => {
  test("Claude: an is_error tool result fails, unless the operator rejected or interrupted it", () => {
    expect(claudeToolFailed(true, "Exit code 1\nnpm ERR!")).toBe(true);
    expect(claudeToolFailed(false, "Exit code 1")).toBe(false);
    expect(claudeToolFailed(true, "The user doesn't want to proceed with this tool use.")).toBe(false);
    expect(claudeToolFailed(true, "[Request interrupted by user for tool use]")).toBe(false);
  });
  test("Codex: a failed command fails, except Ctrl-C / SIGTERM and a search that found nothing", () => {
    expect(codexCommandFailed("failed", 2, "bun test")).toBe(true);
    expect(codexCommandFailed("failed", 1, "bun run build")).toBe(true);
    expect(codexCommandFailed("completed", 0, "ls")).toBe(false);
    expect(codexCommandFailed("failed", 130, "bun dev")).toBe(false);
    expect(codexCommandFailed("failed", 143, "bun dev")).toBe(false);
    expect(codexCommandFailed("failed", 1, "rg -n foo src")).toBe(false);
    expect(codexCommandFailed("failed", 1, "cd x && grep -R needle .")).toBe(false);
    expect(codexCommandFailed("failed", 2, "rg -n foo src")).toBe(true);   // rg's exit 2 is a real error
  });
  test("transcripts: the failed call is named by its tool_use id, at the result's time", () => {
    const p = createTranscriptParser({ harness: "claude", home: "/h", from: 0, sid: "s1" });
    p.line(JSON.stringify({ type: "assistant", timestamp: "2026-10-10T10:00:00Z", cwd: "/h/dev/x", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "bun test" } }] } }));
    p.line(JSON.stringify({ type: "user", timestamp: "2026-10-10T10:00:05Z", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "Exit code 1\n3 fail" }] } }));
    p.line(JSON.stringify({ type: "user", timestamp: "2026-10-10T10:00:06Z", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "The user doesn't want to proceed with this tool use." }] } }));
    const { errs } = p.take();
    expect(errs).toHaveLength(1);
    expect(errs[0].slice(0, 4)).toEqual([Date.parse("2026-10-10T10:00:05Z"), "s1", "Bash", "bun test"]);
    const c = createTranscriptParser({ harness: "codex", home: "/h", from: 0, sid: "c1" });
    c.line(JSON.stringify({ timestamp: "2026-10-10T10:01:00Z", type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", status: "failed", exit_code: 2, command: ["bash", "-lc", "bun run check"], stderr: "a\nb\nerror TS2322" } } }));
    c.line(JSON.stringify({ timestamp: "2026-10-10T10:01:01Z", type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", status: "failed", exit_code: 1, command: ["bash", "-lc", "rg needle"] } } }));
    const ce = c.take().errs;
    expect(ce).toHaveLength(1);
    expect(ce[0][2]).toBe("exec_command");
    expect(ce[0][4]).toContain("exit 2");
  });
  test("OTLP: status ERROR or success=false fails a tool span", () => {
    expect(otlpFailed(new Map(), { code: 2 })).toBe(true);
    expect(otlpFailed(new Map(), { code: "STATUS_CODE_ERROR" })).toBe(true);
    expect(otlpFailed(new Map<string, unknown>([["success", false]]), null)).toBe(true);
    expect(otlpFailed(new Map<string, unknown>([["success", "false"]]), null)).toBe(true);
    expect(otlpFailed(new Map(), { code: 1 })).toBe(false);
    expect(otlpFailed(new Map<string, unknown>([["success", true]]), null)).toBe(false);
  });
  test("snapshot and live/OTLP carry the same failures: a tool error and an undelivered message survive the round trip", () => {
    const now = Date.now(), b = emptyBatch("mini");
    b.errs.push([now - 5000, "sess-1", "Bash", "bun test", "exit 1 · 3 fail"]);
    b.deliveries.push({ id: "d1", created_at: now - 9000, done_at: now - 4000, status: "failed", from: "a1", to: "t1", to_name: "Hudson", transport: "tmux", text: "ping", error: "endpoint gone" });
    const out = fromOtlp(toOtlp(b), { now });
    const got = out.batches.find(x => x.host === "mini")!;
    expect(got.errs.map(e => [e[1], e[2], e[3]])).toEqual([["sess-1", "Bash", "bun test"]]);
    expect(got.deliveries.map(d => [d.id, deliveryState(d.status), d.to_name, d.error])).toEqual([["d1", "f", "Hudson", "endpoint gone"]]);
  });
  test("broker deliveries: failed and open messages travel; asks' own deliveries and the operator's inbox don't", () => {
    expect([deliveryState("failed"), deliveryState("pending"), deliveryState("delivered"), deliveryState(null)]).toEqual(["f", "o", "c", "c"]);
    const db = new Database(":memory:");
    db.run(`create table deliveries (id text, created_at int, status text, target_id text, transport text, metadata_json text, message_id text, target_kind text)`);
    db.run(`create table messages (id text, actor_id text, body text, conversation_id text, metadata_json text)`);
    db.run(`create table actors (id text, display_name text)`);
    db.run(`create table delivery_attempts (delivery_id text, error text, created_at int)`);
    db.run(`insert into actors values ('t1','Hudson')`);
    for (const [id, st, tgt, tr, md] of [["d1", "failed", "t1", "tmux", null], ["d2", "pending", "t1", "tmux", null], ["d3", "delivered", "t1", "tmux", null],
      ["d4", "pending", "operator", "mcp_poll", null], ["d5", "failed", "t1", "tmux", '{"invocationId":"inv1"}']] as const) {
      db.run(`insert into messages values (?, 'a1', 'hello', null, null)`, ["m" + id]);
      db.run(`insert into deliveries values (?, 1000, ?, ?, ?, ?, ?, 'agent')`, [id, st, tgt, tr, md, "m" + id]);
    }
    db.run(`insert into delivery_attempts values ('d1', 'endpoint gone', 1100)`);
    const rows = readTroubleDeliveries(db, 0);
    expect(rows.map(r => [r.id, deliveryState(r.status), r.to_name, r.error])).toEqual([["d1", "f", "Hudson", "endpoint gone"], ["d2", "o", "Hudson", null]]);
    const first = readDeliveriesSince(db, 0, 0, []);
    expect(first.rows.map(r => r.id)).toEqual(["d1", "d2"]);
    expect(first.open).toEqual(["d2"]);
    // nothing new, still open: nothing travels; then it fails: it travels once
    expect(readDeliveriesSince(db, 0, first.maxRow, first.open).rows).toEqual([]);
    db.run(`update deliveries set status = 'failed' where id = 'd2'`);
    const later = readDeliveriesSince(db, 0, first.maxRow, first.open);
    expect(later.rows.map(r => [r.id, deliveryState(r.status)])).toEqual([["d2", "f"]]);
    expect(later.open).toEqual([]);
  });
});

// UNDELIVERABLE and the ids the Inspector acts on (Overview › stuck work)
describe("World · undelivered messages: ids and ended sessions", () => {
  const schema = (db: Database) => {
    db.run(`create table deliveries (id text, created_at int, status text, target_id text, transport text, metadata_json text, message_id text, target_kind text)`);
    db.run(`create table messages (id text, actor_id text, body text, conversation_id text, metadata_json text)`);
    db.run(`create table actors (id text, display_name text)`);
    db.run(`create table delivery_attempts (delivery_id text, error text, created_at int)`);
    db.run(`create table runtime_sessions (agent_id text, state text, ended_at int, last_seen_at int)`);
    db.run(`create table agent_endpoints (agent_id text, state text, updated_at int)`);
  };
  const put = (db: Database, id: string, target: string, kind: string, status = "pending", meta: string | null = null) => {
    db.run(`insert into messages values (?, 'system', 'reconcile notice', 'conv-' || ?, ?)`, ["m" + id, id, meta]);
    db.run(`insert into deliveries values (?, 1000, ?, ?, 'tmux', null, ?, ?)`, [id, status, target, "m" + id, kind]);
  };
  test("a session whose runtime sessions and endpoints have all ended reads as ended at the latest end; a live one does not", () => {
    const db = new Database(":memory:"); schema(db);
    db.run(`insert into runtime_sessions values ('session-a', 'offline', 5000, 4000), ('session-a', 'superseded', null, 6000)`);
    db.run(`insert into agent_endpoints values ('session-a', 'stopped', 5500)`);
    db.run(`insert into runtime_sessions values ('session-b', 'active', null, 9000)`);
    db.run(`insert into agent_endpoints values ('session-c', 'online', 7000)`);
    expect(sessionEndedAt(db, "session-a")).toBe(6000);
    expect(sessionEndedAt(db, "session-b")).toBeNull();
    expect(sessionEndedAt(db, "session-c")).toBeNull();
    expect(sessionEndedAt(db, "session-unknown")).toBeNull();
    // an older runtime without these tables: nothing reads as ended
    const old = new Database(":memory:");
    expect(sessionEndedAt(old, "session-a")).toBeNull();
  });
  test("open rows to an ended session carry ended_at; agents never do; every row carries its ids", () => {
    const db = new Database(":memory:"); schema(db);
    db.run(`insert into runtime_sessions values ('session-a', 'offline', 5000, 5000)`);
    db.run(`insert into agent_endpoints values ('hudson', 'offline', 5000)`);
    put(db, "d1", "session-a", "participant", "pending", '{"flightId":"flt-1"}');
    put(db, "d2", "hudson", "agent");
    put(db, "d3", "session-a", "participant", "failed");
    const rows = readTroubleDeliveries(db, 0), by = new Map(rows.map(r => [r.id, r]));
    expect(by.get("d1")).toMatchObject({ to: "session-a", message_id: "md1", conversation_id: "conv-d1", flight_id: "flt-1", ended_at: 5000 });
    expect(by.get("d2")?.ended_at ?? null).toBeNull();   // an agent can be woken
    expect(by.get("d3")?.ended_at ?? null).toBeNull();   // already finished: FAILED says it
    // the payload tuple: ids as strs indexes, then when the session ended
    const strs: string[] = [], S = (s: string) => { let i = strs.indexOf(s); if (i < 0) { i = strs.length; strs.push(s); } return i; };
    const t = dlvRow(by.get("d1")!, 0, S);
    expect(t).toHaveLength(13);
    expect(t.slice(7, 12).map(k => k >= 0 ? strs[k] : null)).toEqual(["d1", "session-a", "md1", "flt-1", "conv-d1"]);
    expect(t[12]).toBe(5000);
    expect(dlvRow(by.get("d2")!, 0, S)[10]).toBe(-1);
  });
  test("Dismiss reads only an open trouble delivery on this runtime", () => {
    const db = new Database(":memory:"); schema(db);
    put(db, "d1", "session-a", "participant");
    put(db, "d2", "hudson", "agent", "delivered");
    db.run(`insert into messages values ('md3', 'a1', 'ask', null, null)`);
    db.run(`insert into deliveries values ('d3', 1000, 'pending', 'hudson', 'tmux', '{"invocationId":"inv1"}', 'md3', 'agent')`);
    expect(readOpenTroubleDelivery(db, "d1")?.id).toBe("d1");
    expect(readOpenTroubleDelivery(db, "d2")).toBeNull();      // finished
    expect(readOpenTroubleDelivery(db, "d3")).toBeNull();      // an ask's own delivery: not the Overview's to dismiss
    expect(readOpenTroubleDelivery(db, "nope")).toBeNull();
  });
  test("an ask's ids travel only when it has some", () => {
    const strs: string[] = [], S = (s: string) => { strs.push(s); return strs.length - 1; };
    expect(askRefs({}, S)).toEqual([]);
    expect(askRefs(undefined, S)).toEqual([]);
    expect(askRefs({ id: "inv-1", flight_id: null, conversation_id: "conv-1" }, S).map(k => k >= 0 ? strs[k] : null)).toEqual(["inv-1", null, "conv-1"]);
  });
  test("live/OTLP carries the same ids and the ended session", () => {
    const now = Date.now(), b = emptyBatch("mini");
    b.deliveries.push({ id: "d1", created_at: now - 9000, done_at: null, status: "pending", from: "system", to: "session-a", to_name: "session-a", transport: "tmux", text: "notice", error: null,
      message_id: "md1", conversation_id: "conv-1", flight_id: "flt-1", ended_at: now - 5000 });
    b.asks.push({ id: "inv-1", created_at: now - 8000, completed_at: null, state: "running", requester_id: "operator", target_agent_id: "hudson", target_node: null, task: "look", error: null, flight_id: "flt-2", conversation_id: "conv-2" });
    const got = fromOtlp(toOtlp(b), { now }).batches.find(x => x.host === "mini")!;
    expect(got.deliveries[0]).toMatchObject({ id: "d1", message_id: "md1", conversation_id: "conv-1", flight_id: "flt-1", ended_at: now - 5000 });
    expect(got.asks[0]).toMatchObject({ id: "inv-1", flight_id: "flt-2", conversation_id: "conv-2" });
  });
});
