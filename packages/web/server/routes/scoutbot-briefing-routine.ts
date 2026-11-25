import type { Hono, Context } from "hono";
import { ScoutbotRoutineError } from "../scoutbot-routine-owner.ts";
import type { createBriefingRoutine } from "../scoutbot-briefing-routine.ts";

export function mountBriefingRoutineRoutes(app: Hono, routine?: ReturnType<typeof createBriefingRoutine>) {
  const reply = async (c: Context, action: () => unknown | Promise<unknown>) => {
    if (!routine) return c.json({ error: "Personal routines are unavailable on this host." }, 503);
    try { return c.json(await action()); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, error instanceof ScoutbotRoutineError ? error.status as 400 | 409 | 503 : 500); }
  };
  app.get("/api/scoutbot/routines/briefings", (c) => reply(c, () => routine!.state()));
  app.post("/api/scoutbot/routines/briefings/config", async (c) => {
    const body = await c.req.json().catch(() => null); return reply(c, () => routine!.configure(body));
  });
  app.post("/api/scoutbot/routines/briefings/run", async (c) => {
    const body = await c.req.json().catch(() => null) as { requestId?: unknown } | null;
    return reply(c, () => routine!.runNow(body?.requestId));
  });
}
