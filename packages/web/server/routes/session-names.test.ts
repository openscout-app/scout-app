import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ScoutBrokerHttpError } from "@openscout/runtime/broker-api";

import { mountSessionNameRoutes, type SessionNameBroker } from "./session-names.ts";
import type { SessionNameSetBody, SessionNameSetResult } from "../../shared/api/session-names.ts";

function fakeBroker(set?: SessionNameBroker["set"]) {
  const calls: SessionNameSetBody[] = [];
  const broker: SessionNameBroker = {
    set: set ?? (async (body): Promise<SessionNameSetResult> => {
      calls.push(body);
      return {
        ok: true,
        action: body.name ? "set" : "cleared",
        session: { harness: "claude", nativeSessionId: "abc" },
        resolution: { name: body.name ?? "kernel-panic", source: body.name ? "operator" : "harness", operatorName: body.name, derivedName: null, harnessTitle: "kernel-panic" },
      };
    }),
  };
  return { broker, calls };
}

function app(peer: string, broker: SessionNameBroker) {
  const server = new Hono();
  mountSessionNameRoutes(server, { options: { resolvePeerAddress: () => peer }, broker });
  return server;
}

const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("session name routes", () => {
  test("a page on the host names a session, and an empty name clears it", async () => {
    const { broker, calls } = fakeBroker();
    const server = app("127.0.0.1", broker);
    const named = await server.request("http://127.0.0.1:43120/api/session-names", post({ selector: "abc", harness: "claude", name: "Session names" }));
    expect(named.status).toBe(200);
    expect((await named.json()).resolution.source).toBe("operator");
    await server.request("http://127.0.0.1:43120/api/session-names", post({ selector: "abc", name: "   " }));
    await server.request("http://127.0.0.1:43120/api/session-names", post({ selector: "abc", name: null }));
    expect(calls).toEqual([
      { selector: "abc", harness: "claude", name: "Session names" },
      { selector: "abc", name: null },
      { selector: "abc", name: null },
    ]);
  });

  test("a page on another device cannot rename a session", async () => {
    const { broker, calls } = fakeBroker();
    const response = await app("192.168.1.40", broker).request("http://m1.scout.local/api/session-names", post({ selector: "abc", name: "x" }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("local_only");
    expect(calls).toEqual([]);
  });

  test("a loopback proxy cannot make a remote client local", async () => {
    const { broker, calls } = fakeBroker();
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/session-names", {
      ...post({ selector: "abc", name: "x" }),
      headers: { "content-type": "application/json", "x-forwarded-for": "192.168.1.40" },
    });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("local_only");
    expect(calls).toEqual([]);
  });

  test("a missing socket peer is not local", async () => {
    const { broker, calls } = fakeBroker();
    const response = await app("", broker).request("http://127.0.0.1:43120/api/session-names", post({ selector: "abc", name: "x" }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("local_only");
    expect(calls).toEqual([]);
  });

  test("a request without a session is refused before the runtime", async () => {
    const { broker, calls } = fakeBroker();
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/session-names", post({ name: "x" }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("the runtime's refusal comes back as it gave it", async () => {
    const { broker } = fakeBroker(async () => {
      throw new ScoutBrokerHttpError(409, "conflict", JSON.stringify({ error: "ambiguous_session", detail: "abc names sessions in claude and codex" }));
    });
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/session-names", post({ selector: "abc", name: "x" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "abc names sessions in claude and codex", code: "ambiguous_session" });
  });

  test("a runtime that does not answer leaves the name unchanged", async () => {
    const { broker } = fakeBroker(async () => { throw new Error("ECONNREFUSED"); });
    const response = await app("127.0.0.1", broker).request("http://127.0.0.1:43120/api/session-names", post({ selector: "abc", name: "x" }));
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("runtime_unavailable");
  });
});
