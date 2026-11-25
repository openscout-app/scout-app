/*
 * Canvas › embeds: the words an embed shows about itself, from the view's own content and real times. Pure, so
 * they can be tested without a page. An embed is a live view an agent drives (Arc is the first provider); it is
 * titled by what it shows, never by the file that feeds it.
 */
import type { CanvasEmbedProvider, CanvasState } from "../../../shared/canvas.ts";

/** What each provider's view is called: where a kind is said, and the title of one that names itself nothing. */
export const EMBED_NAME: Record<CanvasEmbedProvider, string> = { arc: "Architecture diagram" };

/** An agent at work whose last change to an embed is this recent is editing it. */
export const EDITING_MS = 3 * 60_000;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** An id as words: "arc-on-canvas" and "arcOnCanvas" read "Arc on canvas". */
export function idWords(id: string): string {
  const words = id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_.\-]+/).filter(Boolean).map((w) => w.toLowerCase());
  const t = words.join(" ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/**
 * An Arc diagram's own title: its first view's title, else a top-level title, else its id as words; null when it
 * has none of those. Never its file's name: the file is how the view arrives, not what it is.
 */
export function arcTitle(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { id?: unknown; title?: unknown; views?: unknown };
  const first = Array.isArray(d.views) ? d.views[0] as { title?: unknown } | undefined : undefined;
  return clean(first?.title) || clean(d.title) || idWords(clean(d.id)) || null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null);

/**
 * An Arc diagram as an outline, for Scoutbot to answer about: what each node is, what connects to what and how, the
 * guided views and the flows. Positions, sizes, colors and styling are left out: they are most of the JSON and none
 * of the meaning, so a large diagram fits where its JSON would be cut. Empty when it is not a diagram.
 */
export function arcOutline(data: unknown): string {
  const d = obj(data);
  if (!d) return "";
  const nodeData = obj(d.nodeData) ?? {};
  const ids = [...new Set([...Object.keys(obj(d.nodes) ?? {}), ...Object.keys(nodeData)])];
  const named = (id: unknown) => {
    const n = obj(nodeData[String(id)]);
    return clean(n?.name) || String(id);
  };
  const lines: string[] = [];
  const title = arcTitle(data);
  if (title) lines.push(`Title: ${title}`);
  if (ids.length) {
    lines.push(`Nodes (${ids.length}):`);
    for (const id of ids) {
      const n = obj(nodeData[id]);
      const subtitle = clean(n?.subtitle), description = clean(n?.description);
      lines.push(`- ${id}: ${named(id)}${subtitle ? ` (${subtitle})` : ""}${description ? ` — ${description}` : ""}`);
    }
  }
  const styles = obj(d.connectorStyles) ?? {};
  const connectors = Array.isArray(d.connectors) ? d.connectors.map(obj).filter((c): c is Obj => !!c) : [];
  if (connectors.length) {
    lines.push(`Connections (${connectors.length}):`);
    for (const c of connectors) {
      const style = clean(c.style);
      const how = clean(c.label) || clean(obj(styles[style])?.label) || style;
      lines.push(`- ${named(c.from)} → ${named(c.to)}${how ? `: ${how}` : ""}${clean(c.id) ? ` [${clean(c.id)}]` : ""}`);
    }
  }
  const views = Array.isArray(d.views) ? d.views.map(obj).filter((v): v is Obj => !!v) : [];
  if (views.length) {
    lines.push(`Views (${views.length}):`);
    for (const v of views) {
      const caption = clean(v.caption);
      lines.push(`- ${clean(v.title) || clean(v.id)}${caption ? ` — ${caption}` : ""}`);
    }
  }
  const flows = Array.isArray(d.flows) ? d.flows.map(obj).filter((f): f is Obj => !!f) : [];
  if (flows.length) {
    const byId = new Map(connectors.filter((c) => clean(c.id)).map((c) => [clean(c.id), c]));
    lines.push(`Flows (${flows.length}):`);
    for (const f of flows) {
      const legs = (Array.isArray(f.legs) ? f.legs.map(obj) : []).map((leg) => {
        const c = leg && (clean(leg.id) ? byId.get(clean(leg.id)) : leg);
        if (!c) return null;
        return leg?.direction === "reverse" ? `${named(c.to)} → ${named(c.from)}` : `${named(c.from)} → ${named(c.to)}`;
      }).filter(Boolean);
      lines.push(`- ${clean(f.label) || clean(f.id) || "flow"}${legs.length ? `: ${legs.join(", ")}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** Guided views in an Arc diagram, as the player's rail lists them. */
export function arcViews(data: unknown): number {
  const v = data && typeof data === "object" ? (data as { views?: unknown }).views : null;
  return Array.isArray(v) ? v.length : 0;
}

/** How long ago, to the second while it is fresh: "8s ago", "4m ago", "2h ago", "3d ago". */
export function sinceLabel(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Whether the agent driving an embed is editing it now: at work, and its last change was within EDITING_MS. */
export const isEditing = (state: CanvasState | null, changedAt: number | null, now: number) =>
  state === "working" && changedAt !== null && now - changedAt <= EDITING_MS;

/**
 * The live line under an embed's title: who drives it, whether they are editing, and when it last changed.
 * "Codex is editing · changed 8s ago", "Codex · changed 2h ago", "Codex · reading…".
 */
export function liveLine(name: string | null, state: CanvasState | null, changedAt: number | null, now: number): string {
  const who = name ?? "An earlier session";
  if (changedAt === null) return `${who} · reading…`;
  return `${who}${isEditing(state, changedAt, now) ? " is editing" : ""} · changed ${sinceLabel(changedAt, now)}`;
}

/**
 * The line under an embed seen from a past window, which does not follow the agent: a shown diagram is the version
 * that window listed; a file has no history, so it is the file as it is now, and says so.
 * "Codex · this version shown 2d ago", "Codex · the file as it is now, changed 3h ago".
 */
export function pastLine(name: string | null, shown: boolean, changedAt: number | null, now: number): string {
  const who = name ?? "An earlier session";
  if (changedAt === null) return `${who} · reading…`;
  return shown ? `${who} · this version shown ${sinceLabel(changedAt, now)}` : `${who} · the file as it is now, changed ${sinceLabel(changedAt, now)}`;
}
