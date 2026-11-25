import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("request actions synchronously block duplicate clicks and accepted replays", async () => {
  // Run hook mocks in an isolated process so React mocks cannot leak to UI render tests.
  const fixture = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    mock.module("react", () => ({ useRef: value => ({ current: value }), useState: value => [value, () => {}] }));
    let calls = 0, finish;
    mock.module("../../lib/api.ts", () => ({ api: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }));
    mock.module("../../lib/operator-requests-store.ts", () => ({ receiveRequests() {}, refreshRequests: async () => {}, settleRequests() {}, holdRequest() {}, releaseRequest() {} }));
    const { useRequestActions } = await import("./use-request-actions.ts");
    for (const kind of ["answer", "permission", "approval"]) {
      const item = kind === "answer" ? { answer: { conversationId: "c", replyToMessageId: "m" } }
        : kind === "permission" ? { permission: { requestId: "p", version: "v" } }
        : { approval: { sessionId: "s", turnId: "t", blockId: "b", version: 1 } };
      const hook = useRequestActions(item, () => {});
      const send = () => kind === "answer" ? hook.answer("Yes") : hook.act({ kind: "approve", value: "once", label: "Allow once" });
      const before = calls;
      const first = send(); await send(); assert.equal(calls, before + 1, kind + " double click");
      finish({ items: [] }); await first; await send(); assert.equal(calls, before + 1, kind + " accepted replay");
    }
    process.exit(0);
  `;
  const child = Bun.spawn([process.execPath, "-e", fixture], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe("");
  expect(code).toBe(0);
});

test("a permission request the runtime ended settles for good: its reason is the receipt, and nothing is sent again", async () => {
  const fixture = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    mock.module("react", () => ({ useRef: value => ({ current: value }), useState: value => [value, () => {}] }));
    let calls = 0, refreshes = 0;
    mock.module("../../lib/api.ts", () => ({ api: async () => { calls++; throw Object.assign(new Error("Nothing is waiting on this request any more."), { status: 410 }); } }));
    mock.module("../../lib/operator-requests-store.ts", () => ({ receiveRequests() {}, refreshRequests: async () => { refreshes++; }, settleRequests() {}, holdRequest() {}, releaseRequest() {} }));
    const { useRequestActions } = await import("./use-request-actions.ts");
    const feedback = [];
    const hook = useRequestActions({ permission: { requestId: "p", version: "v" } }, () => {}, value => feedback.push(value));
    await hook.act({ kind: "approve", value: "project", label: "Allow always" });
    assert.deepEqual(feedback, [{ phase: "sending", label: "Allow always" }, { phase: "recorded", label: "Nothing is waiting on this request any more." }]);
    assert.equal(refreshes, 1);
    await hook.act({ kind: "deny", value: "deny", label: "Deny" });
    assert.equal(calls, 1);
    process.exit(0);
  `;
  const child = Bun.spawn([process.execPath, "-e", fixture], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe("");
  expect(code).toBe(0);
});

test("a decision shows at once and holds its row; stalled, Retry sends it again, the first answer wins, and the row lets go after the outcome", async () => {
  const fixture = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    mock.module("react", () => ({ useRef: value => ({ current: value }), useState: value => [value, () => {}] }));
    const timers = [];
    globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    const fire = (ms) => { for (const t of timers.splice(0)) { if (t.ms === ms) t.fn(); else timers.push(t); } };
    const finishes = [];
    mock.module("../../lib/api.ts", () => ({ api: () => new Promise(resolve => { finishes.push(resolve); }) }));
    const store = { holds: [], releases: [], settles: [] };
    mock.module("../../lib/operator-requests-store.ts", () => ({
      receiveRequests() {}, refreshRequests: async () => {},
      settleRequests: (ids) => store.settles.push(...ids), holdRequest: (item) => store.holds.push(item.id), releaseRequest: (id) => store.releases.push(id),
    }));
    const { useRequestActions, STALL_MS, OUTCOME_MS } = await import("./use-request-actions.ts");
    const feedback = [];
    const hook = useRequestActions({ id: "permission:p", permission: { requestId: "p", version: "v" } }, () => {}, value => feedback.push(value));
    const first = hook.act({ kind: "approve", value: "once", label: "Allow once" });
    assert.deepEqual(feedback, [{ phase: "sending", label: "Allow once" }]);
    assert.deepEqual(store.holds, ["permission:p"], "the row is held from the click");
    hook.retry();
    assert.equal(finishes.length, 1, "no retry before the send stalls");
    fire(STALL_MS);
    const second = hook.retry();
    assert.equal(finishes.length, 2, "a stalled send goes again");
    finishes[1]({ ok: true }); await second;
    assert.deepEqual(feedback.at(-1), { phase: "recorded", label: "Approval recorded" });
    assert.deepEqual(store.settles, ["permission:p"]);
    finishes[0]({ ok: true }); await first;
    assert.equal(feedback.filter(f => f.phase === "recorded").length, 1, "the late first answer adds nothing");
    assert.deepEqual(store.releases, []);
    fire(OUTCOME_MS);
    assert.ok(store.releases.includes("permission:p"), "the row lets go once the outcome has shown");
    process.exit(0);
  `;
  const child = Bun.spawn([process.execPath, "-e", fixture], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe("");
  expect(code).toBe(0);
});
