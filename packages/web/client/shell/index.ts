export { AppShell, type AppShellProps } from "./AppShell.tsx";
export { ScoutApp } from "./ScoutApp.tsx";
export { SCOUT_SURFACES, surfaceById, type ScoutSurface, type ScoutSurfaceProps } from "./surfaces.tsx";
export { SURFACE_CATALOG, type ScoutSurfaceDescriptor, type SurfaceCapability, type SurfaceId, type SurfaceStatus } from "./surface-catalog.ts";
export { isShellPath, resolveShellRoute, type ShellMode, type ShellRoute } from "./routes.ts";
export { readRuntimeInfo, type RuntimeInfo, type RuntimeStatus } from "./runtime.ts";
export { FeedCapabilitiesProvider, useFeedCapabilities, type FeedCapabilities } from "../screens/feed/feed-capabilities.tsx";
