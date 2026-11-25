import { Component, lazy, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { MessageComposerEmbedBoundary } from "./components/MessageComposer/MessageComposerEmbedBoundary.tsx";
import {
  isLikelyDiscoveredEmbedPath,
  shouldBootstrapDiscoveredEmbed,
} from "./surfaces/embed-path.ts";

import {
  applyScoutThemeToDocument,
  SCOUT_DEFAULT_APPEARANCE_DETAILS,
  setScoutAppearanceStorageKey,
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTheme,
  resolveScoutStartupTemplate,
} from "./lib/theme.ts";
import { DevErrorOverlay } from "./dev/DevErrorOverlay.tsx";
import { installGlassKeys } from "./lib/glass-keys.ts";
import { installBuildWatch } from "./lib/build-watch.ts";
import { rememberBootPaint } from "./lib/boot-paint.ts";
import { hostFleet, LOCAL_HOST_ID } from "./lib/hosts/host-fleet.ts";
import { initPairedHosts } from "./lib/hosts/paired/paired-hosts.ts";
import { provideBoardTaskSession } from "./screens/chat-space/board-task-session-slot.ts";
import "./styles/tokens.css";
import "./styles/primitives.css";
import "./arc-tailwind.css";
import "./app.css";
import "./styles/glass.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("missing #root");
}
const rootElement = el;
installGlassKeys();
installBuildWatch();
// A Board task's Scout session reads this host's runtime, so only local Scout
// provides it; hosted Chat builds the same Board panel without it.
provideBoardTaskSession(lazy(() =>
  import("./screens/chat-space/VercelBoardTaskSession.tsx").then((module) => ({ default: module.VercelBoardTaskSession })),
));

// Show the real rounded sheet on a fresh inspection origin. Saved choices still win.
setScoutAppearanceStorageKey(undefined, { template: "hudson", details: { ...SCOUT_DEFAULT_APPEARANCE_DETAILS, look: "classic", frameBackdrop: "smooth" } });
const initialTheme = resolveScoutStartupTheme();
applyScoutThemeToDocument(
  initialTheme,
  resolveScoutStartupTemplate(),
  resolveScoutStartupAppearanceDetails(),
);

const pathname = window.location.pathname;
const isScoutbotFxLab = pathname === "/dev/scoutbot-fx";
const isEmbeddableSurfacesLab = pathname === "/dev/embeddable-surfaces";
const observeEmbedMatch = pathname.match(/^\/embed\/observe\/([^/]+)$/);
const isRepoDiffEmbed = pathname === "/embed/repo-diff";
const isSessionEmbed = pathname === "/embed/session";
const isTerminalEmbed = pathname === "/embed/terminal";
/* Glass: the Mac app's see-through window injects __SCOUT_GLASS__ before any
   script runs, so it holds across in-app navigation. /glass opens the whole
   app there; /glass/conversation is the one-conversation page. */
const isGlassConversation = pathname === "/glass/conversation";
const isGlassApp = !isGlassConversation
  && (pathname === "/glass" || pathname === "/glass/" || "__SCOUT_GLASS__" in window);
if (isGlassApp && pathname.startsWith("/glass")) {
  window.history.replaceState(window.history.state, "", `/${window.location.search}`);
}
const isScoutDeck = pathname === "/deck" || pathname === "/deck/";
const isScoutSwarm = pathname === "/swarm" || pathname === "/swarm/";
/* Scout Chat's two standalone surfaces. Both mount without the operator shell:
   a teammate holding a channel credential cannot make the shell's API calls,
   and an invitation must render for somebody who has no identity here yet. */
/* The reserved `chat.<portalHost>` root opens the same surface as `/chat`
   (docs/eng/chat-channel-invites-api.md, "Entry and design"). The server may
   also redirect that root; this keeps the surface correct either way. */
const isChatServiceHost = window.location.hostname.toLowerCase().startsWith("chat.");
const isChatSpace = pathname === "/chat"
  || pathname === "/chat/"
  || (isChatServiceHost && (pathname === "/" || pathname === ""));
const inviteLandingMatch = pathname.match(/^\/invite\/([^/]+)\/?$/);
const useDiscoveredEmbed = shouldBootstrapDiscoveredEmbed(pathname);
/* web.openscout.app has no runtime behind it: the app reads only from the
   hosts this browser pairs with. With none paired yet, the console lists the
   account's hosts to open. */
const isHostedWeb = import.meta.env.VITE_SCOUT_WEB_PROFILE === "hosted";
const CONSOLE_HOSTS_URL = "https://console.openscout.app/#hosts";

class ScoutBootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string }
> {
  state = { error: null as Error | null, componentStack: "" };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[openscout] app render failed", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ padding: "24px", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
        <h1 style={{ fontSize: "16px" }}>Scout could not render this view</h1>
        <pre style={{ whiteSpace: "pre-wrap", color: "#e8993d" }}>{this.state.error.message}</pre>
        {this.state.componentStack ? (
          <pre style={{ whiteSpace: "pre-wrap", color: "#9fa4ad" }}>{this.state.componentStack}</pre>
        ) : null}
      </main>
    );
  }
}

async function renderShell() {
  let content: ReactNode;

  if (isChatSpace) {
    const { ChatSpaceSurface } = await import("./screens/chat-space/ChatSpaceSurface.tsx");
    content = <ChatSpaceSurface />;
  } else if (inviteLandingMatch) {
    const { InviteLandingScreen } = await import("./screens/chat-space/InviteLandingScreen.tsx");
    content = <InviteLandingScreen token={decodeURIComponent(inviteLandingMatch[1]!)} />;
  } else if (isScoutDeck) {
    const { ScoutDeckSurface } = await import("./native-surfaces/deck/ScoutDeckSurface.tsx");
    content = <ScoutDeckSurface />;
  } else if (isScoutSwarm) {
    const { SwarmSurface } = await import("./screens/swarm/SwarmSurface.tsx");
    content = <SwarmSurface />;
  } else if (isScoutbotFxLab) {
    const { ScoutbotFxLab } = await import("./dev/ScoutbotFxLab.tsx");
    content = <ScoutbotFxLab />;
  } else if (isEmbeddableSurfacesLab) {
    const { EmbeddableSurfacesLab } = await import("./dev/EmbeddableSurfacesLab.tsx");
    content = <EmbeddableSurfacesLab />;
  } else if (isTerminalEmbed) {
    const { TerminalEmbedScreen } = await import("./screens/terminal/TerminalEmbedScreen.tsx");
    content = <TerminalEmbedScreen />;
  } else {
    if (isHostedWeb) {
      hostFleet.forget(LOCAL_HOST_ID);
      if ((await initPairedHosts()).length === 0) {
        window.location.replace(CONSOLE_HOSTS_URL);
        return;
      }
    } else if (!observeEmbedMatch && !isRepoDiffEmbed && !isGlassConversation && !isSessionEmbed) {
      // A pairing link points the whole app at that Mac (lib/hosts/paired).
      await initPairedHosts();
    }
    const { createScoutApp } = await import("./scout");
    const scoutApp = createScoutApp({ initialTheme });

    if (observeEmbedMatch) {
      const { ObserveEmbedScreen } = await import("./screens/ObserveEmbedScreen.tsx");
      content = (
        <scoutApp.Provider>
          <ObserveEmbedScreen agentId={decodeURIComponent(observeEmbedMatch[1])} />
        </scoutApp.Provider>
      );
    } else if (isRepoDiffEmbed) {
      const { RepoDiffEmbedScreen } = await import("./screens/RepoDiffEmbedScreen.tsx");
      content = (
        <scoutApp.Provider>
          <RepoDiffEmbedScreen />
        </scoutApp.Provider>
      );
    } else if (isGlassConversation) {
      const { GlassSurface } = await import("./screens/glass/GlassSurface.tsx");
      content = (
        <scoutApp.Provider>
          <GlassSurface />
        </scoutApp.Provider>
      );
    } else if (isSessionEmbed) {
      const { SessionEmbedScreen } = await import("./screens/sessions/SessionEmbedScreen.tsx");
      content = (
        <scoutApp.Provider>
          <SessionEmbedScreen />
        </scoutApp.Provider>
      );
    } else {
      const [{ OpenScoutAppShell }, { wireScopeOntoScout }] = await Promise.all([
        import("./OpenScoutAppShell.tsx"),
        import("./scope/index.ts"),
      ]);
      wireScopeOntoScout(scoutApp);
      content = <OpenScoutAppShell app={scoutApp} glass={isGlassApp} />;
      // index.html's loading frame reads these on the next cold load (glass draws its own see-through window).
      if (!isGlassApp) rememberBootPaint();
    }
  }

  createRoot(rootElement).render(
    <StrictMode>
      <ScoutBootErrorBoundary>
        {isLikelyDiscoveredEmbedPath(pathname)
          ? <MessageComposerEmbedBoundary>{content}</MessageComposerEmbedBoundary>
          : content}
      </ScoutBootErrorBoundary>
      {import.meta.env.DEV ? <DevErrorOverlay /> : null}
    </StrictMode>,
  );
}

function renderEmbedMiss(missingPath: string) {
  createRoot(rootElement).render(
    <StrictMode>
      <div className="s-embed-miss" data-scout-theme>
        <h1>Embed surface unavailable</h1>
        <p>
          No registered surface for <code>{missingPath}</code>. Rebuild the web client and restart
          the Scout web server.
        </p>
      </div>
      {import.meta.env.DEV ? <DevErrorOverlay /> : null}
    </StrictMode>,
  );
}

if (useDiscoveredEmbed) {
  void import("./surfaces/embed-entry.tsx")
    .then(async ({ mountDiscoveredEmbed }) => {
      const mounted = await mountDiscoveredEmbed(rootElement, initialTheme);
      if (!mounted) {
        renderEmbedMiss(pathname);
      }
    })
    .catch((error) => {
      console.error("[openscout] embed bootstrap failed", error);
      renderEmbedMiss(pathname);
    });
} else {
  void renderShell();
}
