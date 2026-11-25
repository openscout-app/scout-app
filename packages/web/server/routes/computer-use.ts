import type { Hono } from "hono";
import { safeComputerId } from "../../shared/api/computer-use.ts";
import { computerActivityReader } from "../computer-use.ts";
import { computerOrigin } from "../core/observe/computer-calls.ts";
import { isSameMacScoutRequest, resolveScoutRequestPeerAddress } from "../server-core.ts";
import type { CreateOpenScoutWebServerOptions } from "../web-server-options.ts";

export function mountComputerUseRoute(app: Hono, options: Pick<CreateOpenScoutWebServerOptions, "resolvePeerAddress">, read = computerActivityReader()) {
  app.get("/api/computer-use", async c => {
    c.header("Cache-Control", "no-store");
    const peer = (options.resolvePeerAddress ?? resolveScoutRequestPeerAddress)(c);
    if (!isSameMacScoutRequest(c.req.raw, peer)) return c.json({ error: "Computer records are available on their host." }, 403);
    const selected = c.req.query("run");
    const origin = c.req.query("origin");
    if (origin !== undefined && origin !== computerOrigin) return c.json({ error: "This record belongs to another Scout connection." }, 404);
    if (selected !== undefined) {
      const [source, id, ...extra] = selected.split("/");
      if (extra.length || !["action", "lattices"].includes(source!) || !safeComputerId(id)) return c.json({ error: "Invalid computer run." }, 400);
    }
    const cursor = c.req.query("before");
    if (cursor !== undefined && (!selected || !/^\d{1,9}$/.test(cursor))) return c.json({ error: "Invalid step cursor." }, 400);
    const through = c.req.query("through");
    if (through !== undefined && (!selected || !/^\d{1,15}$/.test(through))) return c.json({ error: "Invalid replay time." }, 400);
    const activity = await read(selected ?? null, Date.now(), cursor === undefined ? undefined : Number(cursor), through === undefined ? undefined : Number(through));
    if (selected && !activity.runs.length && !activity.issues.length) return c.json({ error: "Native run is unavailable." }, 404);
    return c.json(activity);
  });
}
