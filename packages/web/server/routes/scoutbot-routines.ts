import type { Hono } from "hono";
import { CleanupError, type createCleanupRoutine } from "../scoutbot-cleanup.ts";

export function mountCleanupRoutineRoutes(app: Hono, cleanup?: ReturnType<typeof createCleanupRoutine>): void {
  // Inherits operator API authentication and same-origin checks. Channel-member
  // grants and the isolated scoped gateway do not admit these local-host routes.
  const routineReply = async (c: import("hono").Context, action: () => unknown | Promise<unknown>) => {
    if (!cleanup) return c.json({ error: "Routines unavailable on this host." }, 503);
    try { return c.json(await action()); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, error instanceof CleanupError ? error.status as 400 | 409 : 500); }
  };
  app.get("/api/scoutbot/routines/cleanup", (c) => routineReply(c, () => cleanup!.state()));
  app.post("/api/scoutbot/routines/cleanup/config", async (c) => {
    const body = await c.req.json().catch(() => null);
    return routineReply(c, () => cleanup!.configure(body));
  });
  app.post("/api/scoutbot/routines/cleanup/check", (c) => routineReply(c, () => cleanup!.check()));
  app.post("/api/scoutbot/routines/cleanup/apply", async (c) => {
    const body = await c.req.json().catch(() => null);
    return routineReply(c, () => cleanup!.cleanup(body));
  });

}
