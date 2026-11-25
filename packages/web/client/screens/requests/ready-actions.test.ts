import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("Continue and Hold post the flight to the Ready route once, and say what the runtime took", async () => {
  // Run hook mocks in an isolated process so React mocks cannot leak to UI render tests.
  const fixture = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    mock.module("react", () => ({ useRef: value => ({ current: value }), useState: value => [value, () => {}] }));
    const posts = [];
    mock.module("../../lib/api.ts", () => ({ api: async (path, init) => { posts.push([path, JSON.parse(init.body)]); return { items: [] }; } }));
    mock.module("../../lib/operator-requests-store.ts", () => ({ holdRequest() {}, receiveRequests() {}, refreshRequests: async () => {}, releaseRequest() {}, settleRequests() {} }));
    const { useRequestActions } = await import("./use-request-actions.ts");
    const item = { id: "ready:flt-1", kind: "ready", ready: { flightId: "flt-1", invocationId: "inv-1", workId: null, summary: "s", at: 1 }, actions: [] };
    for (const kind of ["continue", "hold"]) {
      const feedback = [];
      const hook = useRequestActions(item, () => {}, (f) => feedback.push(f));
      await hook.act({ kind, label: kind === "continue" ? "Continue" : "Hold", flightId: "flt-1" });
      await hook.act({ kind, label: "again", flightId: "flt-1" });
      assert.deepEqual(feedback.at(-1), { phase: "recorded", label: kind === "continue" ? "Continued" : "Held" });
    }
    assert.deepEqual(posts, [
      ["/api/operator-attention/ready/decide", { ref: "flt-1", decision: "continue" }],
      ["/api/operator-attention/ready/decide", { ref: "flt-1", decision: "hold" }],
    ]);
  `;
  const child = Bun.spawn([process.execPath, "-e", fixture], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe("");
  expect(code).toBe(0);
});

test("a refusal (not Ready any more) is the runtime's answer, not a lost send", async () => {
  const fixture = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    mock.module("react", () => ({ useRef: value => ({ current: value }), useState: value => [value, () => {}] }));
    mock.module("../../lib/api.ts", () => ({ api: async () => { throw Object.assign(new Error("The task is not Ready."), { status: 409 }); } }));
    mock.module("../../lib/operator-requests-store.ts", () => ({ holdRequest() {}, receiveRequests() {}, refreshRequests: async () => {}, releaseRequest() {}, settleRequests() {} }));
    const { useRequestActions } = await import("./use-request-actions.ts");
    const item = { id: "ready:flt-1", kind: "ready", ready: { flightId: "flt-1", invocationId: "inv-1", workId: null, summary: "s", at: 1 }, actions: [] };
    const feedback = [];
    const hook = useRequestActions(item, () => {}, (f) => feedback.push(f));
    await hook.act({ kind: "continue", label: "Continue", flightId: "flt-1" });
    assert.deepEqual(feedback.at(-1), { phase: "failed" });
  `;
  const child = Bun.spawn([process.execPath, "-e", fixture], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe("");
  expect(code).toBe(0);
});
