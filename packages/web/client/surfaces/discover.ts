import {
  buildLazySurfaceRegistry,
  type LazySurfaceModule,
  type SurfaceModule,
} from "./discover-build.ts";
import type { RegisteredSurface } from "./types.ts";

// The definitions remain beside their screens. This small routing index lets an
// embed select one lazy module without evaluating every screen just to inspect
// its scoutSurface export. The lazy registry verifies both copies agree.
const lazySurfaceModules = [
  { modulePath: "../screens/work/WorkEmbedScreen.tsx", embedPaths: ["/embed/work"] },
  { modulePath: "../screens/companion/CompanionScreen.tsx", embedPaths: ["/embed/companion"] },
  { modulePath: "../screens/requests/NativeAreaScreen.tsx", embedPaths: ["/embed/requests"] },
  { modulePath: "../screens/home/NativeAreaScreen.tsx", embedPaths: ["/embed/home"] },
  { modulePath: "../screens/search/NativeAreaScreen.tsx", embedPaths: ["/embed/search"] },
  { modulePath: "../screens/ops/NativeAreaScreen.tsx", embedPaths: ["/embed/ops"] },
  { modulePath: "../screens/sessions/NativeAreaScreen.tsx", embedPaths: ["/embed/sessions"] },
  { modulePath: "../screens/mesh/NativeAreaScreen.tsx", embedPaths: ["/embed/hosts"] },
  { modulePath: "../screens/feed/NativeAreaScreen.tsx", embedPaths: ["/embed/feed"] },

  {
    modulePath: "../screens/chat/ThreadEmbedScreen.tsx",
    embedPaths: ["/embed/thread"],
  },
  {
    modulePath: "../screens/ops/AgentLanesView.tsx",
    embedPaths: ["/embed/agent-lanes", "/ops/lanes/embed", "/embed/lanes", "/embed/traces"],
  },
  {
    modulePath: "../screens/projects/ProjectsScreen.tsx",
    embedPaths: ["/embed/projects"],
  },
  {
    modulePath: "../screens/voice/RealtimeVoiceScreen.tsx",
    embedPaths: ["/embed/voice"],
  },
  {
    modulePath: "../screens/settings/ScoutSettings.tsx",
    embedPaths: ["/embed/settings"],
  },
] as const satisfies readonly LazySurfaceModule[];

const screenModules: Record<string, () => Promise<SurfaceModule>> = {
  "../screens/work/WorkEmbedScreen.tsx": () => import("../screens/work/WorkEmbedScreen.tsx"),
  "../screens/companion/CompanionScreen.tsx": () => import("../screens/companion/CompanionScreen.tsx"),
  "../screens/requests/NativeAreaScreen.tsx": () => import("../screens/requests/NativeAreaScreen.tsx"),
  "../screens/home/NativeAreaScreen.tsx": () => import("../screens/home/NativeAreaScreen.tsx"),
  "../screens/search/NativeAreaScreen.tsx": () => import("../screens/search/NativeAreaScreen.tsx"),
  "../screens/ops/NativeAreaScreen.tsx": () => import("../screens/ops/NativeAreaScreen.tsx"),
  "../screens/sessions/NativeAreaScreen.tsx": () => import("../screens/sessions/NativeAreaScreen.tsx"),
  "../screens/mesh/NativeAreaScreen.tsx": () => import("../screens/mesh/NativeAreaScreen.tsx"),
  "../screens/feed/NativeAreaScreen.tsx": () => import("../screens/feed/NativeAreaScreen.tsx"),
  "../screens/chat/ThreadEmbedScreen.tsx": () => import("../screens/chat/ThreadEmbedScreen.tsx"),
  "../screens/ops/AgentLanesView.tsx": () => import("../screens/ops/AgentLanesView.tsx"),
  "../screens/projects/ProjectsScreen.tsx": () => import("../screens/projects/ProjectsScreen.tsx"),
  "../screens/voice/RealtimeVoiceScreen.tsx": () => import("../screens/voice/RealtimeVoiceScreen.tsx"),
  "../screens/settings/ScoutSettings.tsx": () => import("../screens/settings/ScoutSettings.tsx"),
};

const lazyRegistry = buildLazySurfaceRegistry(screenModules, lazySurfaceModules);

export function resolveEmbeddableSurface(pathname: string): Promise<RegisteredSurface | null> {
  return lazyRegistry.resolve(pathname);
}

export function isEmbeddableSurfacePath(pathname: string): boolean {
  return lazyRegistry.has(pathname);
}

export async function listEmbeddableSurfaceSummaries() {
  const surfaces = await lazyRegistry.loadAll();
  return surfaces.map((surface) => ({
    id: surface.id,
    label: surface.label,
    webPath: surface.webPath,
    embedPath: surface.embedPath,
    embedAliases: surface.embed?.aliases ?? [],
    profile: surface.embed?.profile ?? `macos.${surface.id}`,
    route: surface.route,
    modulePath: surface.modulePath,
    screen: surface.screen,
    macosHost: surface.embed?.hosts?.macos ?? true,
  }));
}
