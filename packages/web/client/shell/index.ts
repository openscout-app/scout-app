export { AppShell, type AppShellProps } from "./AppShell.tsx";
export { ScoutApp } from "./ScoutApp.tsx";
export { SCOUT_SURFACES, surfaceById, type ScoutSurface, type ScoutSurfaceProps } from "./surfaces.tsx";
export { CONNECTED_TOOLS, SURFACE_CATALOG, type ConnectedToolDescriptor, type ConnectedToolId, type ScoutSurfaceDescriptor, type ShellPageId, type SurfaceCapability, type SurfaceId, type SurfaceStatus } from "./surface-catalog.ts";
export { isShellPath, resolveShellRoute, type ShellMode, type ShellRoute } from "./routes.ts";
export { readRuntimeInfo, type RuntimeInfo, type RuntimeStatus } from "./runtime.ts";
export { FeedCapabilitiesProvider, useFeedCapabilities, type FeedCapabilities } from "../screens/feed/feed-capabilities.tsx";
export { T3CodeSurface, T3CodeView } from "./T3CodeSurface.tsx";
export { framingVerdict, loopbackOrigin, parseT3CodeStatus, readT3CodeUrl, t3CodeOriginFromEnv, type T3CodeStatus } from "./t3code.ts";
