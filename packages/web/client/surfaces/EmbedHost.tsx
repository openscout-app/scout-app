import { lazy, Suspense, useEffect, useState } from "react";
import { useBrowserLocation } from "../lib/router.ts";
import type { Route } from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";
import { EmbedSurfaceHost } from "./EmbedSurfaceHost.tsx";
import { isEmbeddableSurfacePath, resolveEmbeddableSurface } from "./discover.ts";
import { nextEmbedStagePath } from "./embed-stage.ts";
import { installNativeAreaKeyboard } from "./native-area-keyboard.ts";
import type { RegisteredSurface } from "./types.ts";

type RoutedSurfaceFallbackProps = Pick<
  ReturnType<typeof useScout>,
  "route" | "navigate" | "agents"
>;

const RoutedSurfaceFallback = lazy(async () => {
  const { resolveContentPane } = await import("../screens/resolve-panes.tsx");
  return {
    default: ({ route, navigate, agents }: RoutedSurfaceFallbackProps) =>
      resolveContentPane(route, navigate, agents, { embedded: true }),
  };
});

function FullAppFallback({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  const { agents } = useScout();
  return (
    <Suspense fallback={null}>
      <RoutedSurfaceFallback route={route} navigate={navigate} agents={agents} />
    </Suspense>
  );
}

/** The full app's embed host: any route the surface hands off resolves to its pane. */
export function DiscoveredEmbedHost({ surface }: { surface: RegisteredSurface }) {
  return (
    <EmbedSurfaceHost
      surface={surface}
      renderFallback={(props) => <FullAppFallback {...props} />}
      installKeyboard={installNativeAreaKeyboard}
    />
  );
}

/**
 * One document for every surface in a native window. The host switches
 * sections by replacing the URL with the next surface's embed path and firing
 * popstate; the surface for that path mounts in place of the one up, keyed by
 * path so each section starts fresh. Nothing renders while the next surface's
 * module loads, so the old one never falls back to an unrelated pane.
 */
export function DiscoveredEmbedStage({
  initialSurface,
  initialPath,
}: {
  initialSurface: RegisteredSurface;
  initialPath: string;
}) {
  const { pathname } = useBrowserLocation();
  const [shown, setShown] = useState({ path: initialPath, surface: initialSurface });
  const path = nextEmbedStagePath(shown.path, pathname, isEmbeddableSurfacePath);

  useEffect(() => {
    if (path === shown.path) return;
    let cancelled = false;
    void resolveEmbeddableSurface(path).then((surface) => {
      if (!cancelled && surface) setShown({ path, surface });
    });
    return () => {
      cancelled = true;
    };
  }, [path, shown.path]);

  if (path !== shown.path) return null;
  return <DiscoveredEmbedHost key={shown.path} surface={shown.surface} />;
}
