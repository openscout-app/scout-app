/**
 * Canvas: the files agents chose to show (`scout show`, MCP `show`), read from the runtime's show store and put in
 * the area of the session that showed them.
 *
 * The runtime keeps immutable copies, but may evict superseded versions (GET /v1/shows?projectRoot=…&since=…); a card shows the
 * newest version of an item and counts the others. Its bytes come from GET /v1/shows/<id>/bytes, through the
 * canvas file route, so the agent's file can change or go away and the card still shows what the agent showed.
 *
 * Merged into a canvas build at serve time: the build reads the Review window and is cached, while shows are cheap
 * to list and should appear as soon as an agent shows something.
 */
import { basename, join } from "node:path";
import { artifactKey, embedFor, CANVAS_ITEMS_PER_AGENT, SHOW_PATH, type CanvasAgent, type CanvasData, type CanvasItem, type CanvasItemKind } from "../shared/canvas.ts";
import { formatSessionRouteRef } from "../shared/session-route-ref.ts";

/** The runtime's show record (ScoutShow in @openscout/protocol), as far as the canvas reads it. */
export type RuntimeShow = {
  id: string;
  itemId: string;
  supersedes?: string;
  agentId: string;
  sessionId?: string;
  harness?: string;
  projectRoot: string;
  worktree: string;
  branch?: string;
  sourcePath: string;
  kind: "image" | "video" | "document" | "other";
  mediaType: string;
  byteSize: number;
  caption?: string;
  createdAt: number;
};

export type ShowSource = {
  /** a project's shows since a time; the runtime resolves the root to its real path */
  list(projectRoot: string, since: number): Promise<RuntimeShow[]>;
  /** one version's bytes, a byte range when asked; the runtime's own response */
  bytes(id: string, range?: string | null): Promise<Response>;
};

/** A show id as the runtime makes them; anything else is never sent on. */
export const SHOW_ID = /^[A-Za-z0-9_-]{1,128}$/;

const KIND: Record<RuntimeShow["kind"], CanvasItemKind> = { image: "image", video: "video", document: "doc", other: "doc" };

/** The show store of the runtime at `baseUrl()`, over loopback HTTP, which the runtime treats as local. */
export function runtimeShowSource(baseUrl: () => string, timeoutMs = 5000): ShowSource {
  const url = (path: string) => new URL(path, baseUrl()).toString();
  return {
    async list(projectRoot, since) {
      const res = await fetch(url(`/v1/shows?projectRoot=${encodeURIComponent(projectRoot)}&since=${since}`), { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        // a runtime from before shows answers 404; a root it cannot resolve answers 400: nothing shown there
        await res.body?.cancel();
        if (res.status === 404 || res.status === 400) return [];
        throw new Error(`runtime shows answered ${res.status}`);
      }
      const body = (await res.json()) as { shows?: RuntimeShow[] };
      return Array.isArray(body.shows) ? body.shows : [];
    },
    async bytes(id, range) {
      if (!SHOW_ID.test(id)) return new Response(null, { status: 404 });
      return fetch(url(`/v1/shows/${id}/bytes`), { headers: range ? { range } : {} });
    },
  };
}

/** A project's shows, by the real path of its main checkout. */
export type ShowsByRoot = Map<string, { project: string; shows: RuntimeShow[] }>;

/**
 * The canvas with what agents showed: the newest version of each item, as a card first in its session's area.
 * A show finds its area by its session, else by its Scout agent's newest area in the project; a show from neither
 * gets an area of its own. The same file inferred from the session's calls is left out under its shown card.
 * Pure: `home` expands "~/" paths for that comparison.
 */
export function mergeShows(data: CanvasData, byRoot: ShowsByRoot, home: string): CanvasData {
  const latest = new Map<string, { show: RuntimeShow; project: string; listedIds: string[] }>();
  for (const { project, shows } of byRoot.values()) {
    for (const show of shows) {
      const hit = latest.get(show.itemId);
      if (!hit) latest.set(show.itemId, { show, project, listedIds: [show.id] });
      else { hit.listedIds.push(show.id); if (show.createdAt > hit.show.createdAt) hit.show = show; }
    }
  }
  if (!latest.size) return data;

  const agents: CanvasAgent[] = data.agents.map((a) => ({ ...a }));
  const bySession = new Map<string, number>();
  agents.forEach((a, i) => { const id = a.ref?.slice(a.ref.lastIndexOf(":") + 1); if (id) bySession.set(id, i); });
  const own = new Map<string, number>();
  const areaOf = (show: RuntimeShow, project: string): number => {
    const s = show.sessionId ? bySession.get(show.sessionId) : undefined;
    if (s != null) return s;
    let best = -1;
    agents.forEach((a, i) => { if (a.agentId === show.agentId && a.project === project && (best < 0 || a.lastAt > agents[best].lastAt)) best = i; });
    if (best >= 0) return best;
    const k = `${show.agentId}\0${show.sessionId ?? ""}\0${project}`;
    const known = own.get(k); if (known != null) return known;
    const harness = show.harness ?? "";
    own.set(k, agents.length);
    agents.push({
      id: `show:${show.agentId}:${show.sessionId ?? ""}`, agentId: show.agentId, name: show.agentId, harness, project,
      worktree: show.worktree === show.projectRoot ? "main" : show.branch || basename(show.worktree),
      state: "quiet", lastAt: show.createdAt, now: `Showed ${basename(show.sourcePath)}`, nowFile: null,
      ref: show.sessionId && harness ? formatSessionRouteRef(harness, show.sessionId) : null, title: null, asked: null,
    });
    return agents.length - 1;
  };

  const shown: CanvasItem[] = [];
  const covered = new Set<string>();
  for (const { show, project, listedIds } of [...latest.values()].sort((a, b) => b.show.createdAt - a.show.createdAt)) {
    const agent = areaOf(show, project);
    agents[agent].lastAt = Math.max(agents[agent].lastAt, show.createdAt);
    covered.add(agent + "\0" + show.sourcePath);
    // a shown Arc diagram is an embed, by the agent's own file name: the runtime files it as a document
    const embed = embedFor(show.sourcePath);
    shown.push({
      key: artifactKey(SHOW_PATH + show.itemId), path: SHOW_PATH + show.id, name: basename(show.sourcePath), kind: embed ? "embed" : KIND[show.kind] ?? "doc",
      agent, at: show.createdAt, mt: show.createdAt, how: "shown",
      ...(show.caption?.trim() ? { caption: show.caption.trim() } : {}),
      shown: { id: show.id, itemId: show.itemId, source: show.sourcePath, listedIds, versions: listedIds.length },
      ...(embed ? { embed } : {}),
    });
  }
  const abs = (p: string) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);
  const inferred = data.items.filter((it) => !covered.has(it.agent + "\0" + abs(it.path)));

  /* per area: its shown cards first, newest first, then what was inferred, as many as an area keeps */
  const per = new Map<number, number>();
  const items: CanvasItem[] = [];
  for (const it of [...shown, ...inferred]) {
    const n = per.get(it.agent) ?? 0;
    if (n >= CANVAS_ITEMS_PER_AGENT && it.how !== "shown") continue;
    per.set(it.agent, n + 1);
    items.push(it);
  }
  return { ...data, agents, items };
}
