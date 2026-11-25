import type { ReactNode } from "react";
import type { Route } from "../lib/types.ts";
import type { useScout } from "../scout/Provider.tsx";
import { RequestsScreen } from "./requests/RequestsScreen.tsx";
import { ActivityContent } from "./activity/index.ts";
import { AgentsContent, AgentsLeft, AgentsRight } from "./agents/index.ts";
import { ProjectsRail, ProjectsScreen, ProjectsThreadAside } from "./projects/index.ts";
import { BriefingsContent } from "./briefings/index.ts";
import { ChatContent, ChatLeft, ChatRight } from "./chat/index.ts";
import { RoomsContent } from "./chat-space/RoomsContent.tsx";
import { FollowContent } from "./follow/index.ts";
import { HarnessesContent } from "./harnesses/index.ts";
import { HomeContent, HomeLeft, HomeRight } from "./home/index.ts";
import { MeshContent, MeshLeft, MeshRight } from "./mesh/index.ts";
import { MeshOpsContent, MeshOpsLeft, MeshOpsRight } from "./mesh-ops/index.ts";
import { OpsContent, OpsLeft } from "./ops/index.ts";
import { ReposContent } from "./repos/index.ts";
import { SearchContent, SearchRight } from "./search/index.ts";
import { SessionsContent } from "./sessions/index.ts";
import { SettingsContent } from "./settings/index.ts";
import { TerminalContent, TerminalLeft, TerminalRight } from "./terminal/index.ts";
import { WorkContent } from "./work/index.ts";
import { RealtimeVoicePage } from "./voice/RealtimeVoiceScreen.tsx";
import { ViewsContent } from "./views/ViewsContent.tsx";
import { BoardsContent } from "./boards/BoardsContent.tsx";
import { CompositionHost } from "./views/CompositionHost.tsx";
import { FrontPage } from "./home/front-page/FrontPage.tsx";
import { OpsFrame } from "./views/OpsFrame.tsx";
import { composedViewFor, pageOwnsSides } from "./views/composed-routes.ts";
import { shippedView } from "./views/views-model.ts";

type Navigate = ReturnType<typeof useScout>["navigate"];

/** Left pane for the current route. Falls back to HomeLeft when a surface has no custom left. */
export function resolveLeftPane(route: Route, navigate: Navigate): ReactNode {
  // a composed view's panels (or Home's front page) replace its rail
  if (pageOwnsSides(route)) return null;
  switch (route.view) {
    case "requests":
    case "views":
    case "boards":
    // Changes holds its own worktree list and details (ChangesPage)
    case "repos":
    case "repo-diff":
    case "review":
    case "canvas":
    case "feed":
    // Status's grid holds its own panels
    case "status":
    // Rooms brings its own room list.
    case "rooms":
      return null;
    case "ops":
      return <OpsLeft />;
    case "agents-v2":
      return <ProjectsRail route={route} navigate={navigate} />;
    case "agent-info":
      return <AgentsLeft />;
    case "messages":
    case "conversation":
      return <ChatLeft />;
    case "mesh":
      return <MeshLeft />;
    case "mesh-ops":
      return <MeshOpsLeft />;
    case "terminal":
      return <TerminalLeft />;
    case "inbox":
    default:
      return <HomeLeft />;
  }
}

/** Center content for the current route. An embed (the Mac app's Home) draws the page without the web's Inbox lead. */
export function resolveContentPane(
  route: Route,
  navigate: Navigate,
  agents: ReturnType<typeof useScout>["agents"] = [],
  options: { embedded?: boolean } = {},
): ReactNode {
  // / and /embed/home: the front page (screens/home/front-page). Home's old grid
  // is Ops › Cockpit, behind its Look closer.
  if (route.view === "inbox") return <FrontPage navigate={navigate} post={route.post} />;
  const composed = composedViewFor(route);
  if (composed) {
    // Home leads with what waits on the operator, above its panels (HomeInboxLead).
    const host = <CompositionHost view={shippedView(composed)} route={route} navigate={navigate} />;
    // a composed Control route keeps the Control strip above its panels; Hosts does too
    const opsStrip = route.view === "ops" || route.view === "mesh";
    return opsStrip ? <OpsFrame route={route} navigate={navigate}>{host}</OpsFrame> : host;
  }
  switch (route.view) {
    case "requests":
      return <RequestsScreen navigate={navigate} />;
    case "conversation":
    case "messages":
      return <ChatContent route={route} navigate={navigate} />;
    case "rooms":
      return <RoomsContent />;
    case "agents-v2":
      return <ProjectsScreen route={route} navigate={navigate} />;
    case "agent-info":
      return <AgentsContent route={route} navigate={navigate} />;
    case "settings":
      return <SettingsContent route={route} navigate={navigate} />;
    case "sessions":
      return <SessionsContent route={route} navigate={navigate} />;
    case "search":
      return <SearchContent route={route} navigate={navigate} />;
    case "mesh":
      return <MeshContent route={route} navigate={navigate} />;
    case "mesh-ops":
      return <MeshOpsContent route={route} navigate={navigate} />;
    case "repos":
    case "repo-diff":
      return <ReposContent route={route} navigate={navigate} />;
    case "harnesses":
      return <HarnessesContent route={route} navigate={navigate} />;
    case "briefings":
      return <BriefingsContent route={route} navigate={navigate} />;
    case "activity":
      return <ActivityContent route={route} navigate={navigate} />;
    case "views":
      return <ViewsContent route={route} navigate={navigate} />;
    case "boards":
      return <BoardsContent route={route} navigate={navigate} />;
    case "review":
      return <section className="scout-pane-head"><p>Historical Review needs the hosted history service.</p><button onClick={() => navigate({ view: "work", workId: "", board: true })}>Open local Board</button></section>;
    // Home is the Feed; the router sends /feed to Home, and this stays in step.
    case "feed":
      return <FrontPage navigate={navigate} />;
    case "voice":
      return <RealtimeVoicePage />;
    // Dashboards › Status: Home's old grid, as the Mac app's Home drew it
    case "status":
      return <FrontPage navigate={navigate} />;
    case "ops":
      return <OpsContent route={route} navigate={navigate} />;
    case "terminal":
      return <TerminalContent route={route as Extract<Route, { view: "terminal" }>} navigate={navigate} />;
    case "work":
      return <WorkContent route={route} navigate={navigate} />;
    case "follow":
      return <FollowContent route={route} navigate={navigate} />;
    default:
      return <FrontPage navigate={navigate} />;
  }
}

/** Right pane for the current route, or null when the surface has no inspector. */
export function resolveRightPane(route: Route, navigate: Navigate): ReactNode {
  // a composed view's panels (or Home's front page) replace its inspector
  if (pageOwnsSides(route)) return null;
  switch (route.view) {
    case "inbox":
      return <HomeRight />;
    case "agents-v2": {
      if (!route.agentId) {
        // Index mode: selected threads/sessions peek in the shell sidebar.
        return (route.selectedAgentId || route.sessionId)
          ? <ProjectsThreadAside route={route} navigate={navigate} />
          : null;
      }
      // Profile (agent-profile-rebalance): center = sessions spine + inline summary;
      // right rail = session snapshot, files, transcript tail, Observe/Take over.
      return <AgentsRight />;
    }
    case "agent-info":
      return <AgentsRight />;
    case "sessions":
      return null;
    case "search":
      return <SearchRight />;
    case "conversation":
      return <ChatRight />;
    case "messages":
      return <ChatRight />;
    case "terminal":
      return <TerminalRight />;
    case "work":
      // the work page draws its own detail pane
      return null;
    case "mesh":
      return <MeshRight />;
    case "mesh-ops":
      return <MeshOpsRight />;
    default:
      return null;
  }
}
