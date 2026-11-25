import { expect, test } from "bun:test";
import { SCOUT_MODEL_TASTE, SCOUT_RUNTIME_CATALOG } from "@openscout/protocol";
import { createModelInventoryReader } from "./model-inventory.ts";
import { SCOUT_MODEL_INVENTORY_URL } from "../shared/model-inventory.ts";
const feed = () => ({ schema: 1, inventory: { schemaVersion: "openscout.model-inventory.v1", catalog: structuredClone(SCOUT_RUNTIME_CATALOG), taste: structuredClone(SCOUT_MODEL_TASTE) } });

test("public inventory is one bounded credential-free read, cached across concurrent consumers", async () => {
  let calls = 0;
  const payload = feed(); payload.inventory.taste.revision = "2026-11-10.2";
  const read = createModelInventoryReader({ now: () => 100, fetch: (async (url, options) => {
    calls++; expect(url).toBe(SCOUT_MODEL_INVENTORY_URL); expect(options?.method).toBe("GET"); expect(options?.credentials).toBe("omit"); expect(options?.headers).toEqual({ Accept: "application/json" });
    return Response.json(payload);
  }) as typeof fetch });
  const [a, b] = await Promise.all([read(), read()]);
  expect(a).toBe(b); expect(a.source).toBe("published"); expect(a.taste.revision).toBe("2026-11-10.2");
  await read(); expect(calls).toBe(1);
});

test("old feed, invalid opinions, network errors and oversized bodies use included data", async () => {
  const malformed = feed(); malformed.inventory.taste.runtimes.sol!.selector = { tier: 1 } as any;
  const old = feed(); old.inventory.taste.revision = "2026-08-08.1";
  for (const response of [Response.json({ schema: 1, families: [] }), Response.json(malformed), Response.json(old), new Response("failed", { status: 500 }), new Response("{}", { headers: { "content-length": "1048577" } }), new Response('"'+"x".repeat(1_048_576)+'"')]) {
    const read = createModelInventoryReader({ fetch: (async () => response) as typeof fetch });
    expect((await read()).source).toBe("included");
  }
});

test("failed refresh retains validated data and marks it cached, rather than claiming a successful check", async () => {
  let now = 100; let calls = 0;
  const payload = feed(); payload.inventory.taste.revision = "2026-11-10.9";
  const read = createModelInventoryReader({ now: () => now, fetch: (async () => { if (++calls > 1) throw new Error("offline"); return Response.json(payload); }) as typeof fetch });
  expect((await read()).source).toBe("published"); now += 600_001;
  const fallback = await read(); expect(fallback.taste.revision).toBe("2026-11-10.9"); expect(fallback.source).toBe("cached");
});
