import { SURFACE_CATALOG, type SurfaceId } from "./surface-catalog.ts";

/**
 * `app`: the full shell with its rail. `embed`: one surface with no chrome,
 * for launchers and native hosts that supply their own.
 */
export type ShellMode = "app" | "embed";

export type ShellRoute =
  | { mode: "embed"; surface: SurfaceId; view: "surface" }
  | { mode: "app"; surface: SurfaceId; view: "surface" }
  /** The recorded exchange behind a Feed item. */
  | { mode: "app"; surface: "feed"; view: "conversation"; conversationId: string; workId: string | null }
  /** A recorded harness session a standalone Feed item names. */
  | { mode: "app"; surface: "feed"; view: "session"; sessionId: string };

function decoded(segment: string): string | null {
  try { return decodeURIComponent(segment); } catch { return null; }
}

/** Maps a URL to the shell's mode and surface. Returns null for paths the shell does not own. */
export function resolveShellRoute(url: Pick<URL, "pathname" | "searchParams">): ShellRoute | null {
  const path = url.pathname;
  if (path === "/") return { mode: "app", surface: "feed", view: "surface" };
  for (const surface of SURFACE_CATALOG) {
    if (path === surface.route) return { mode: "app", surface: surface.id, view: "surface" };
    if ("embed" in surface && path === surface.embed.path) return { mode: "embed", surface: surface.id, view: "surface" };
  }
  const record = /^\/(c|sessions)\/([^/]+)$/.exec(path);
  const id = record ? decoded(record[2]!) : null;
  if (!record || !id) return null;
  return record[1] === "c"
    ? { mode: "app", surface: "feed", view: "conversation", conversationId: id, workId: url.searchParams.get("workId") }
    : { mode: "app", surface: "feed", view: "session", sessionId: id };
}

/** True when the shell renders this path. Hosts serve the app document for these and 404 the rest. */
export function isShellPath(pathname: string): boolean {
  return resolveShellRoute({ pathname, searchParams: new URLSearchParams() }) !== null;
}
