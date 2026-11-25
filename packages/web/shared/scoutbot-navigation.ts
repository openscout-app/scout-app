export type ScoutbotNavigationDestination = {
  id: string;
  label: string;
  description: string;
  route: Record<string, unknown>;
  deepActions?: string[];
};

export type ScoutbotUiContext = {
  host: "web" | "macos";
  shellLabel: string;
  destinations: ScoutbotNavigationDestination[];
  rules: string[];
};

/** Product vocabulary for the full web shell. Internal Route.view aliases are
 * intentionally absent: Scoutbot should speak in page names, then emit the
 * implementation route only inside its hidden scout-ui action. */
export const SCOUTBOT_WEB_DESTINATIONS: ScoutbotNavigationDestination[] = [
  { id: "home", label: "Home", description: "Fleet overview, briefings, and recent activity.", route: { view: "inbox" } },
  { id: "projects", label: "Projects", description: "Projects, agents, and project-scoped work.", route: { view: "agents-v2" }, deepActions: ["Open a project by projectSlug.", "Open an agent by agentId."] },
  { id: "sessions", label: "Sessions", description: "Active and recent harness sessions.", route: { view: "sessions" }, deepActions: ["Open a session by sessionId."] },
  { id: "messages", label: "Messages", description: "Direct conversations and channels.", route: { view: "messages" }, deepActions: ["Open a conversation by conversationId.", "Filter by all, direct messages, or channels."] },
  { id: "dispatch", label: "Dispatch", description: "Requests, flights, work, and delivery state.", route: { view: "broker" } },
  { id: "search", label: "Search", description: "Knowledge and indexed workspace search.", route: { view: "search" } },
  { id: "operations", label: "Operations", description: "Mission Control, live activity, agent lanes, world map, runtime, and mesh health.", route: { view: "ops", mode: "mission" } },
  { id: "world", label: "World", description: "Shared map of workspace islands in the starfield.", route: { view: "ops", mode: "world" } },
  { id: "repositories", label: "Repositories", description: "Repository and worktree status, including diffs.", route: { view: "repos" }, deepActions: ["Open a repository by absolute root."] },
  { id: "code-browser", label: "Code Browser", description: "Read files in a project or worktree.", route: { view: "code" }, deepActions: ["Select a project with the project field; it accepts the displayed project name or slug.", "Open a file inside it with path and optional wt.", "Alternatively use absolute root and file fields.", "Focus a line with line and optional endLine.", "Deep links: scout://{project}/{path}, scout:///{absolute/path}, or legacy scout://code/{project}/{path}."] },
  { id: "terminals", label: "Terminals", description: "Observe or take over terminal sessions.", route: { view: "terminal" } },
  { id: "settings", label: "Settings", description: "Connections, agents, communications, credentials, voice, and devices.", route: { view: "settings" }, deepActions: ["Open Scoutbot's own settings, with its model, instructions and recorded token use, with section=scoutbot."] },
];

/** Honest capabilities of the simplified native shell. Web-only pages are not
 * listed and therefore must never be advertised by hosted live voice. */
export const SCOUTBOT_MACOS_DESTINATIONS: ScoutbotNavigationDestination[] = [
  { id: "comms", label: "Comms", description: "Native conversations and channels.", route: { view: "messages" }, deepActions: ["Open a conversation by conversationId.", "Open a channel by channelId."] },
  { id: "projects", label: "Projects", description: "Native project and agent browser.", route: { view: "agents-v2" }, deepActions: ["Filter to a project by projectSlug.", "Select an agent by agentId."] },
  { id: "terminals", label: "Terminals", description: "Native terminal workspace.", route: { view: "terminal" }, deepActions: ["Select an agent terminal by agentId."] },
  { id: "tail", label: "Tail", description: "Live agent and harness activity.", route: { view: "ops", mode: "tail" } },
  { id: "dispatch", label: "Dispatch", description: "Dispatch and coordination overview.", route: { view: "broker" } },
  { id: "agent-lanes", label: "Agent Lanes", description: "Native lane overview for active agents.", route: { view: "ops", mode: "lanes" } },
  { id: "repositories", label: "Repositories", description: "Native repository and worktree status.", route: { view: "repos" } },
  { id: "code-browser", label: "Code Browser", description: "Embedded read-only project browser.", route: { view: "code" }, deepActions: ["Select a project with the project field; it accepts the displayed project name or slug.", "Open a file inside it with path and optional wt.", "Alternatively use absolute root and file fields.", "Focus a line with line and optional endLine.", "Deep links: scout://{project}/{path}, scout:///{absolute/path}, or legacy scout://code/{project}/{path}."] },
  { id: "settings", label: "Settings", description: "Native app settings; Voice is directly addressable.", route: { view: "settings" }, deepActions: ["Open Voice settings with section=voice."] },
];

export function scoutbotUiContext(host: "web" | "macos"): ScoutbotUiContext {
  const macos = host === "macos";
  return {
    host,
    shellLabel: macos ? "Scout for macOS" : "OpenScout web",
    destinations: macos ? SCOUTBOT_MACOS_DESTINATIONS : SCOUTBOT_WEB_DESTINATIONS,
    rules: [
      "When asked what navigation is available, list only these human labels and short descriptions.",
      "Never expose internal Route.view names, aliases, URL fragments, or implementation vocabulary in the human reply.",
      "Emit only a destination route or deep action explicitly described by this host context.",
      "If the requested destination or deep action is absent, say it is not available in this app instead of approximating it with another page.",
    ],
  };
}

/** The page the operator has open, in Scoutbot's own vocabulary. */
export type ScoutbotPage = {
  /** The page's product name. */
  label: string;
  /** Records open on the page, by route field (sessionId, agentId, …). */
  open?: Record<string, string>;
};

/** Web pages reached without a navigation destination, by the name the
 * sidebar gives them. Never the internal view name. */
const SCOUTBOT_WEB_PAGE_NAMES: Record<string, string> = {
  requests: "Inbox",
  conversation: "Messages",
  "agent-info": "Messages",
  rooms: "Rooms",
  boards: "Boards",
  activity: "Log",
  work: "Work items",
  briefings: "Briefings",
  views: "Views",
  mesh: "Hosts",
  "mesh-ops": "Mesh Ops",
  "repo-diff": "Repositories",
  harnesses: "Providers",
  voice: "Voice",
  follow: "Follow",
};

const SCOUTBOT_WEB_OPS_MODE_NAMES: Record<string, string> = {
  tail: "Tail",
  issues: "Alerts",
  lanes: "Lanes",
  week: "Overview",
  atop: "Processes",
  advisor: "Worktrees",
  agents: "Operations",
};

/** Route fields that name a record the operator has open. */
const SCOUTBOT_OPEN_RECORD_FIELDS = [
  "sessionId",
  "agentId",
  "selectedAgentId",
  "conversationId",
  "threadId",
  "projectSlug",
  "flightId",
  "invocationId",
  "workId",
  "requestId",
  "attemptId",
  "eventId",
  "briefingId",
  "boardId",
  "viewId",
  "itemId",
  "project",
  "root",
  "path",
  "file",
  "section",
] as const;

const SCOUTBOT_OPEN_RECORD_MAX = 400;

function routeMode(route: Record<string, unknown>): string | undefined {
  if (route.view !== "ops") return undefined;
  return typeof route.mode === "string" ? route.mode : "mission";
}

/** The page a route shows, named as Scoutbot names it to the operator. Null
 * when the route is not a page this host's shell has. */
export function scoutbotPageForRoute(route: unknown, host: "web" | "macos" = "web"): ScoutbotPage | null {
  if (!route || typeof route !== "object") return null;
  const value = route as Record<string, unknown>;
  const view = typeof value.view === "string" ? value.view : null;
  if (!view) return null;
  const mode = routeMode(value);
  const destinations = host === "macos" ? SCOUTBOT_MACOS_DESTINATIONS : SCOUTBOT_WEB_DESTINATIONS;
  const destination = destinations.find((entry) => (
    entry.route.view === view
    && (entry.route.mode === undefined || entry.route.mode === mode)
  ));
  const label = destination?.label
    ?? (host === "web"
      ? (view === "ops" && mode ? SCOUTBOT_WEB_OPS_MODE_NAMES[mode] : SCOUTBOT_WEB_PAGE_NAMES[view])
      : undefined);
  if (!label) return null;
  const open: Record<string, string> = {};
  for (const field of SCOUTBOT_OPEN_RECORD_FIELDS) {
    const raw = value[field];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    open[field] = trimmed.slice(0, SCOUTBOT_OPEN_RECORD_MAX);
  }
  return Object.keys(open).length > 0 ? { label, open } : { label };
}
