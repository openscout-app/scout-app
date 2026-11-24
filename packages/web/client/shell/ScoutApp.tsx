import { useEffect } from "react";
import { routePath } from "../lib/router.ts";
import type { Route } from "../lib/types.ts";
import { FeedCapabilitiesProvider, type FeedCapabilities } from "../screens/feed/feed-capabilities.tsx";
import { routeEmbeddedNavigation } from "../surfaces/embed-navigation.ts";
import { AppShell } from "./AppShell.tsx";
import { FeedEmptyState } from "./FeedEmptyState.tsx";
import { navigateTo, onAppLinkClick, useLocationUrl } from "./navigation.ts";
import { PlannedSurface } from "./PlannedSurface.tsx";
import { RecordedChat, RecordedSession } from "./records.tsx";
import { resolveShellRoute, type ShellRoute } from "./routes.ts";
import { unknownRuntime, type RuntimeInfo } from "./runtime.ts";
import { SCOUT_SURFACES, surfaceById, type ScoutSurface } from "./surfaces.tsx";

/** An embed leaves its document: a native host takes the route, a browser loads it. */
const embedNavigate = (route: Route) => routeEmbeddedNavigation(route, dest => location.assign(routePath(dest)));
/** The app owns its navigation and stays on one document. */
const appNavigate = (route: Route) => navigateTo(routePath(route));

function useTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
}

/**
 * The whole Scout App for one URL: `/` and each surface route in the app
 * shell, `/embed/<surface>` chrome-free.
 */
export function ScoutApp({ url: initial, runtime = unknownRuntime, capabilities, surfaces = SCOUT_SURFACES }: {
  url: URL;
  runtime?: RuntimeInfo;
  /** Feed settings for every surface on the page. The preview passes `readOnly: true`. */
  capabilities?: Partial<FeedCapabilities>;
  surfaces?: readonly ScoutSurface[];
}) {
  const url = useLocationUrl(initial);
  const route = resolveShellRoute(url);
  return (
    <FeedCapabilitiesProvider capabilities={capabilities}>
      {route?.mode === "embed" ? (
        <EmbedSurface surface={surfaceById(route.surface, surfaces)} url={url} runtime={runtime} />
      ) : (
        <AppShell mode="app" active={route?.surface ?? "feed"} surfaces={surfaces} runtime={runtime}>
          <AppContent route={route} url={url} surfaces={surfaces} />
        </AppShell>
      )}
    </FeedCapabilitiesProvider>
  );
}

function EmbedSurface({ surface, url, runtime }: { surface: ScoutSurface; url: URL; runtime: RuntimeInfo }) {
  const Component = surface.Component;
  return (
    <AppShell mode="embed" active={surface.id} runtime={runtime}>
      {Component ? <Component mode="embed" url={url} navigate={embedNavigate} /> : null}
    </AppShell>
  );
}

function AppContent({ route, url, surfaces }: { route: ShellRoute | null; url: URL; surfaces: readonly ScoutSurface[] }) {
  const surface = route ? surfaceById(route.surface, surfaces) : null;
  const title = !route ? "Not found · Scout App"
    : route.view === "conversation" ? "Chat · Scout App"
    : route.view === "session" ? "Session · Scout App"
    : surface?.Component ? null : `${surface!.label} · Scout App`;
  useTitle(title);

  if (!route || !surface) return <NotFound />;
  if (route.view === "conversation") return <RecordedChat id={route.conversationId} workId={route.workId} />;
  if (route.view === "session") return <RecordedSession id={route.sessionId} />;
  const Component = surface.Component;
  if (!Component) return <PlannedSurface surface={surface} />;
  return (
    <div className="app-surfacePage" data-surface={surface.id}>
      <header className="app-feedHead">
        <h1>{surface.label}</h1>
        <p>{surface.description}</p>
      </header>
      <Component mode="app" url={url} navigate={appNavigate} emptyState={<FeedEmptyState />} />
    </div>
  );
}

function NotFound() {
  return (
    <section className="app-page" aria-labelledby="app-missing-title">
      <header className="app-pageHead"><h1 id="app-missing-title">Not in Scout App</h1></header>
      <p>This address is not part of the app. Feed is live now.</p>
      <a className="app-button" href="/feed" onClick={onAppLinkClick}>Open Feed</a>
    </section>
  );
}
