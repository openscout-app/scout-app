import type { ComponentType, ReactNode } from "react";
import type { Route } from "../lib/types.ts";
import { NativeAreaScreen } from "../screens/feed/NativeAreaScreen.tsx";
import type { ShellMode } from "./routes.ts";
import { SURFACE_CATALOG, type ScoutSurfaceDescriptor } from "./surface-catalog.ts";

/** What the shell hands every surface. A surface draws content only, never chrome. */
export type ScoutSurfaceProps = {
  mode: ShellMode;
  url: URL;
  /** Leaves the surface. In an embed, the host decides where that goes. */
  navigate: (route: Route) => void;
  /** The shell's guidance for when the surface has nothing to show yet. */
  emptyState?: ReactNode;
};

/**
 * One Scout App surface. A `live` surface has a Component; a `planned` one
 * keeps its slot, route and description so the shell can say plainly that it
 * is not in this build yet.
 */
export type ScoutSurface = ScoutSurfaceDescriptor & {
  Component?: ComponentType<ScoutSurfaceProps>;
};

function FeedSurface({ url, navigate, emptyState }: ScoutSurfaceProps) {
  return <NativeAreaScreen navigate={navigate} expand={url.searchParams.get("post") || undefined} empty={emptyState} />;
}

const components: Partial<Record<ScoutSurface["id"], ComponentType<ScoutSurfaceProps>>> = {
  feed: FeedSurface,
};

/** Feed · Chat · Sessions · Board · Control, in rail order. */
export const SCOUT_SURFACES: readonly ScoutSurface[] = SURFACE_CATALOG.map(surface => ({
  ...surface,
  Component: components[surface.id],
}));

export function surfaceById(id: ScoutSurface["id"], surfaces: readonly ScoutSurface[] = SCOUT_SURFACES): ScoutSurface {
  return surfaces.find(s => s.id === id) ?? SCOUT_SURFACES[0]!;
}
