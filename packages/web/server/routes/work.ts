import { backgroundReads } from "../background-reads.ts";
import type { Hono } from "hono";
import type { Context } from "hono";
import { queryWorkItemById } from "../db-queries.ts";
import { createWorkInventoryCache, openWorkMaterialInEditor, readWorkMaterialContent, readWorkMaterialRaw, rawMaterialHeaders, type WorkInventories } from "../work-materials.ts";
import { createOpenInEditor, type OpenInEditor } from "../open-in-editor.ts";
import { indexPlanDocuments } from "../plan-documents.ts";
import {
  defaultHeuristicsResponse,
  globalHeuristicsFile,
  projectHeuristicsFile,
  writeGlobalHeuristicsFile,
  writeProjectHeuristicsFile,
} from "../material-heuristics.ts";
import type { WebWorkDetailResponse } from "../../shared/api/web.ts";
import { workListOptions } from "./work-list-query.ts";
import { mountWorkBoardRoutes } from "./work-board.ts";

export type WorkRouteDeps = {
  currentDirectory: string;
  /** Opens a file on this host; tests pass a recorder. */
  openInEditor?: OpenInEditor;
  /** Work inventories, reused across file reads for a short while. */
  inventories?: WorkInventories;
};

export function mountWorkRoutes(app: Hono, deps: WorkRouteDeps) {
  const { currentDirectory } = deps;
  const openInEditor = deps.openInEditor ?? createOpenInEditor();
  // The page reads the inventory with the work; picking a file reuses it.
  const inventories = deps.inventories ?? createWorkInventoryCache();

  const rawHeuristicsFromRequest = async (c: Context): Promise<string> => {
    const body = await c.req.json().catch(() => null) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof (body as { raw?: unknown }).raw === "string") {
      return (body as { raw: string }).raw;
    }
    return `${JSON.stringify(body ?? {}, null, 2)}\n`;
  };
  app.get("/api/heuristics/defaults", (c) => c.json(defaultHeuristicsResponse()));
  app.get("/api/heuristics/global", (c) => {
    const result = globalHeuristicsFile();
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.put("/api/heuristics/global", async (c) => {
    const result = writeGlobalHeuristicsFile(await rawHeuristicsFromRequest(c));
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.get("/api/heuristics/project", (c) => {
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!workspaceRoot) {
      return c.json({ error: "workspaceRoot is required" }, 400);
    }
    const result = projectHeuristicsFile(workspaceRoot);
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.put("/api/heuristics/project", async (c) => {
    const workspaceRoot = c.req.query("workspaceRoot");
    if (!workspaceRoot) {
      return c.json({ error: "workspaceRoot is required" }, 400);
    }
    const result = writeProjectHeuristicsFile(workspaceRoot, await rawHeuristicsFromRequest(c));
    return "config" in result ? c.json(result) : c.json(result, 400);
  });
  app.get("/api/plan-documents", async (c) => {
    const agents = await backgroundReads.agents();
    return c.json(await indexPlanDocuments({
      currentDirectory,
      workspaces: agents.map((agent) => ({
        agentId: agent.id,
        agentName: agent.name,
        cwd: agent.cwd,
        project: agent.project,
        projectRoot: agent.projectRoot,
      })),
    }));
  });
  const handleListWork = async (c: Context) => {
    const options = workListOptions((name) => c.req.query(name));
    return c.json(options ? await backgroundReads.workItems(options) : []);
  };
  const handleWorkDetail = async (c: Context) => {
    const workId = c.req.param("id");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const inventory = await inventories(detail, { fresh: true });
    return c.json({ ...detail, inventory } satisfies WebWorkDetailResponse);
  };
  const handleWorkInventory = async (c: Context) => {
    const workId = c.req.param("id");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    return c.json(await inventories(detail, { fresh: true }));
  };
  const handleWorkMaterialContent = async (c: Context) => {
    const workId = c.req.param("id");
    const materialId = c.req.query("materialId");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    if (!materialId) {
      return c.json({ error: "materialId is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await readWorkMaterialContent(detail, materialId, inventories);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 410 | 415);
    }
    return c.json(result.content);
  };
  const handleWorkMaterialRaw = async (c: Context) => {
    const workId = c.req.param("id");
    const materialId = c.req.query("materialId");
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    if (!materialId) {
      return c.json({ error: "materialId is required" }, 400);
    }
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await readWorkMaterialRaw(detail, materialId, inventories);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 410 | 415);
    }
    return new Response(Bun.file(result.realPath), { headers: rawMaterialHeaders(result.mediaType) });
  };
  // Launches the editor on this host. The /api trust gate has already refused
  // foreign origins; the material must resolve inside its trusted root.
  const handleWorkMaterialEditor = async (c: Context) => {
    const workId = c.req.param("id");
    const body = await c.req.json().catch(() => null) as { materialId?: unknown; line?: unknown } | null;
    const materialId = typeof body?.materialId === "string" ? body.materialId : "";
    if (!workId) {
      return c.json({ error: "id is required" }, 400);
    }
    if (!materialId) {
      return c.json({ error: "materialId is required" }, 400);
    }
    const line = typeof body?.line === "number" && Number.isInteger(body.line) && body.line > 0 ? body.line : undefined;
    const detail = queryWorkItemById(workId);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await openWorkMaterialInEditor(detail, materialId, openInEditor, line, inventories);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 410 | 415 | 500);
    }
    return c.json({ ok: true, editor: result.editor });
  };
  app.get("/api/work", handleListWork);
  app.get("/api/tasks", handleListWork);
  // before /api/work/:id, which would read "board" and "moves" as work ids
  mountWorkBoardRoutes(app);
  app.get("/api/work/:id", handleWorkDetail);
  app.get("/api/work/:id/inventory", handleWorkInventory);
  app.get("/api/work/:id/material", handleWorkMaterialContent);
  app.get("/api/work/:id/material/raw", handleWorkMaterialRaw);
  app.post("/api/work/:id/material/editor", handleWorkMaterialEditor);
  app.get("/api/tasks/:id", handleWorkDetail);
}
