import type { GridBonds, GridItem, GridLayout } from "../../components/hud-grid/hud-grid-layout.ts";
import type { Route } from "../../lib/types.ts";
import { collides, GRID_BASE_COLS } from "../../components/hud-grid/hud-grid-layout.ts";
import { HOME_GRID_ADOPTS, HOME_VIEW_ARRANGEMENTS, HOME_VIEW_INSTANCES, HOME_VIEW_LAYOUT } from "../home/home-view.ts";
import type { GridAdoption } from "./modules/adopt-grid.ts";

/**
 * Views are compositions: a list of module instances on the HUD grid. Scout
 * ships opinionated ones; the operator adds, replaces and removes modules from
 * there, and Reset brings a view back to how it shipped. Pure, so the rules
 * test without a DOM (see /studies/modules-anywhere).
 *
 * An instance keeps its id when its module is replaced, so the grid keeps its
 * cell: same place, same size, new module.
 */

export type ViewModuleSize = { w: number; h: number };
/** `config` holds the instance's own settings (a scope, a terminal id); absent = defaults. */
export type ViewModuleInstance = { id: string; type: string; config?: Record<string, string> };

export type ViewSides = { left?: readonly string[]; right?: readonly string[] };
export type ViewSide = keyof ViewSides;

export type ViewComposition = {
  id: string;
  label: string;
  /** One line on what the composition is for. */
  intent: string;
  /**
   * The view's own route, for a composition that is an app view (bare
   * /terminal is Terminals). It draws there, and /views/:id goes there.
   */
  host?: Route;
  /** Offer "New terminal" in the bar. Off where a module already starts terminals. */
  quickTerminal?: boolean;
  instances: ViewModuleInstance[];
  /** Authored at 12 columns. Holds the grid's panels: a docked panel has no cell. */
  layout: GridLayout;
  /**
   * Panels docked beside the grid instead of on it, top to bottom: what you
   * pick from on the left, what is picked on the right. Each side folds to a
   * strip that still names its panels, so the grid can take the room.
   */
  sides?: ViewSides;
  /**
   * A side's width as shipped, in pixels, where its panels read better wider
   * than the default (a lane read whole). The viewer's drag replaces it.
   */
  sideWidth?: Partial<Record<ViewSide, number>>;
  /**
   * A docked panel's share of its side's height, by instance id, where the
   * module's own size doesn't suit this view (the lane read whole over two
   * short readouts). Without one a panel's share is its module's height.
   */
  sideWeights?: Readonly<Record<string, number>>;
  /**
   * How the grid's panels prefer to behave together. `panes`: panels stacked in one column that
   * read as one pane; a resize keeps each pane whole (its members share a width, the seam between
   * two members trades rows between them). Panes not declared, or no longer holding after a swap,
   * are read off the grid as it stands: panels sharing a column with no gap between them. `swaps`: panels that prefer to trade cells when one
   * is dragged onto the other: a declared pair trades on a plain drag, and engages sooner. Any other
   * neighbour along a whole edge trades only with ⌥ held. With ⇧ held, a drag moves a panel's whole
   * pane as one: it keeps its order, and over another column the two trade sides.
   */
  bonds?: GridBonds;
  /** Named layouts the grid's bar offers (Home's Desk, Focus, Watch), each authored at 12 columns. */
  arrangements?: readonly { id: string; label: string; layout: GridLayout }[];
  /**
   * The grid this composition replaced, whose saved arrangement it takes over
   * the first time it draws (modules/adopt-grid.ts): Home's own grid.
   */
  adopts?: GridAdoption;
};

export const SHIPPED_VIEWS: readonly ViewComposition[] = [
  {
    id: "watch",
    label: "Watch",
    intent: "Everything as it happens: events, who is working, what is out",
    instances: [
      { id: "watch-tail", type: "tail" },
      { id: "watch-agents", type: "agents" },
      { id: "watch-inflight", type: "inflight" },
      { id: "watch-requests", type: "requests" },
    ],
    layout: [
      { id: "watch-tail", x: 0, y: 0, w: 7, h: 22 },
      { id: "watch-inflight", x: 7, y: 0, w: 5, h: 10 },
      { id: "watch-requests", x: 7, y: 10, w: 5, h: 6 },
      { id: "watch-agents", x: 7, y: 16, w: 5, h: 10 },
    ],
  },
  {
    id: "ops-control",
    label: "Mission Control",
    intent: "Every live session's raw log on one wall, who is on it, and what the fleet is waiting on",
    // Ops › Control and bare /ops; the URL's ?sessionId= is the wall's cursor
    host: { view: "ops", mode: "mission" },
    // nothing on Mission Control starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the wall leads, as the page always did
    instances: [
      { id: "control-wall", type: "mission-wall" },
      { id: "control-context", type: "mission-context" },
      { id: "control-roster", type: "mission-roster" },
      { id: "control-summary", type: "ops-summary" },
    ],
    // the roster where the left rail was, the wall between, and the session
    // context over the ops summary where the inspector was
    layout: [
      { id: "control-roster", x: 0, y: 0, w: 3, h: 24 },
      { id: "control-wall", x: 3, y: 0, w: 6, h: 24 },
      { id: "control-context", x: 9, y: 0, w: 3, h: 14 },
      { id: "control-summary", x: 9, y: 14, w: 3, h: 10 },
    ],
  },
  {
    id: "comms",
    label: "Comms",
    intent: "Conversations, the questions waiting on you, and the live tail",
    instances: [
      { id: "comms-chats", type: "chats" },
      { id: "comms-requests", type: "requests" },
      { id: "comms-tail", type: "tail" },
    ],
    layout: [
      { id: "comms-chats", x: 0, y: 0, w: 5, h: 22 },
      { id: "comms-requests", x: 5, y: 0, w: 7, h: 8 },
      { id: "comms-tail", x: 5, y: 8, w: 7, h: 14 },
    ],
  },
  {
    id: "machines",
    label: "Machines",
    intent: "Machines, agents and plan headroom on one board",
    // Machine follows the view's pick: a Hosts click shows that machine beside it
    instances: [
      { id: "machines-hosts", type: "hosts" },
      { id: "machines-machine", type: "machine", config: { machine: "@route" } },
      { id: "machines-agents", type: "agents" },
      { id: "machines-quotas", type: "quotas" },
      { id: "machines-done", type: "done" },
    ],
    sides: { left: ["machines-hosts"], right: ["machines-machine"] },
    layout: [
      { id: "machines-quotas", x: 0, y: 0, w: 12, h: 12 },
      { id: "machines-agents", x: 0, y: 12, w: 6, h: 14 },
      { id: "machines-done", x: 6, y: 12, w: 6, h: 14 },
    ],
  },
  {
    id: "terminals",
    label: "Terminals",
    intent: "Every terminal on this machine: find one, open it, lay out a workspace",
    host: { view: "terminal" },
    // the workspace starts terminals itself
    quickTerminal: false,
    // the index is the page's left side (as wide as it is dragged, folding below 58);
    // the workspace takes the grid. In a narrow window the index opens over it.
    instances: [
      { id: "terminals-workspace", type: "terminal-workspace" },
      { id: "terminals-index", type: "terminal-index" },
    ],
    sides: { left: ["terminals-index"] },
    layout: [{ id: "terminals-workspace", x: 0, y: 0, w: 12, h: 24 }],
  },
  {
    id: "terminal",
    label: "Terminal",
    intent: "One terminal, open: observe it or take it over, with the index and its details beside it",
    // drawn on every terminal deep link (composed-routes.ts); bare /terminal stays Terminals
    quickTerminal: false,
    // @route: the session and its details follow the page's terminal and mode.
    // Stacked (narrow window) panels follow this order: the terminal leads.
    instances: [
      { id: "terminal-session", type: "terminal-session", config: { terminal: "@route" } },
      { id: "terminal-index", type: "terminal-index" },
      { id: "terminal-details", type: "terminal-details", config: { terminal: "@route" } },
    ],
    layout: [
      { id: "terminal-index", x: 0, y: 0, w: 3, h: 14 },
      { id: "terminal-details", x: 0, y: 14, w: 3, h: 10 },
      { id: "terminal-session", x: 3, y: 0, w: 9, h: 24 },
    ],
  },
  {
    id: "search",
    label: "Search",
    intent: "Find anything you ran, opened, or decided",
    host: { view: "search" },
    // nothing on Search starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the field and the list lead
    instances: [
      // follows the page: the URL holds its query, filters and ?hit=
      { id: "search-results", type: "search-results", config: { follow: "@route" } },
      { id: "search-hit", type: "search-hit" },
      { id: "search-index", type: "search-index" },
    ],
    layout: [
      { id: "search-results", x: 0, y: 0, w: 7, h: 22 },
      { id: "search-hit", x: 7, y: 0, w: 5, h: 17 },
      { id: "search-index", x: 7, y: 17, w: 5, h: 5 },
    ],
  },
  {
    id: "mesh",
    label: "Hosts",
    intent: "Every machine on the mesh: its agents, its reach, and the map",
    // all of /network: ?machineId= picks the machine the panels follow
    host: { view: "mesh" },
    // nothing on Network starts a terminal
    quickTerminal: false,
    // @route: the map narrows to the page's ?machineId= and Machine shows the view's pick
    // (the page's machine, then any Hosts, map or Rack click). Stacked (narrow window)
    // panels follow this order: the map leads, as the page's centre did.
    instances: [
      { id: "mesh-map", type: "mesh-map", config: { machine: "@route" } },
      { id: "mesh-machine", type: "machine", config: { machine: "@route" } },
      { id: "mesh-hosts", type: "hosts" },
      { id: "mesh-rack", type: "mesh-rack" },
    ],
    // the page's own arrangement: the rail with the rack under it, the map, the inspector
    sides: { left: ["mesh-hosts", "mesh-rack"], right: ["mesh-machine"] },
    layout: [{ id: "mesh-map", x: 0, y: 0, w: 12, h: 24 }],
  },
  {
    id: "mesh-ops",
    label: "Mesh Ops",
    intent: "Work and sessions across machines, by how recently each moved",
    // all of /mesh-ops: ?machineId= scopes the read, ?itemId= opens the item
    host: { view: "mesh-ops" },
    // nothing on Mesh Ops starts a terminal
    quickTerminal: false,
    // on /mesh-ops the board and Item read the URL; @route keeps the board on the
    // page's machine wherever else it is placed. Stacked panels: the board leads.
    instances: [
      { id: "mesh-ops-board", type: "mesh-ops", config: { machine: "@route" } },
      { id: "mesh-ops-item", type: "mesh-ops-item" },
      { id: "mesh-ops-hosts", type: "mesh-ops-hosts" },
    ],
    sides: { left: ["mesh-ops-hosts"], right: ["mesh-ops-item"] },
    layout: [{ id: "mesh-ops-board", x: 0, y: 0, w: 12, h: 22 }],
  },
  {
    id: "providers",
    label: "Providers",
    intent: "Plans, usage, and default models",
    // /providers (the harnesses view)
    host: { view: "harnesses" },
    // nothing on Providers starts a terminal
    quickTerminal: false,
    // Subscriptions and cloud accounts above the read-only model defaults.
    instances: [
      { id: "providers-subscriptions", type: "subscriptions" },
      { id: "providers-cloud", type: "cloud-accounts" },
      { id: "providers-routing", type: "provider-routing" },
    ],
    layout: [
      { id: "providers-subscriptions", x: 0, y: 0, w: 8, h: 22 },
      { id: "providers-cloud", x: 8, y: 0, w: 4, h: 22 },
      { id: "providers-routing", x: 0, y: 22, w: 12, h: 26 },
    ],
  },
  {
    id: "projects",
    label: "Projects",
    intent: "Every project: what is live, its sessions, worktrees and pull requests",
    // the project list and each project's page: /projects?view=projects, /projects/:slug[/sessions[/:ref]|/agents]
    host: { view: "agents-v2", indexView: "projects" },
    // sessions open their own terminals; no shell in the bar
    quickTerminal: false,
    // /projects with no project picked: the project list leads, and Project lists every
    // project's sessions; a pick opens that project's page (the project composition).
    instances: [
      { id: "projects-list", type: "projects" },
      { id: "projects-nav", type: "project-nav", config: { project: "@route" } },
      { id: "projects-thread", type: "project-thread" },
      { id: "projects-changes", type: "session-changes" },
    ],
    sides: { left: ["projects-list"] },
    layout: [
      { id: "projects-nav", x: 0, y: 0, w: 3, h: 36 },
      { id: "projects-thread", x: 3, y: 0, w: 5, h: 36 },
      { id: "projects-changes", x: 8, y: 0, w: 4, h: 36 },
    ],
  },
  {
    id: "project-snapshot",
    label: "Project · Overview",
    intent: "A project at a glance: what waits on you, what is working, what is in review and what landed",
    // bare /projects/:slug: the project's Overview. One panel reads the project's sessions,
    // requests, pull requests, merges, canvas, worktrees and disk, and links into the
    // by-sessions (project) and by-worktrees (projects-worktrees) looks, Changes and Canvas.
    host: { view: "agents-v2", indexView: "projects" },
    quickTerminal: false,
    instances: [{ id: "project-snapshot", type: "project-snapshot", config: { project: "@route" } }],
    layout: [{ id: "project-snapshot", x: 0, y: 0, w: 12, h: 36 }],
  },
  {
    id: "project",
    label: "Project",
    intent: "A project by its sessions: what a session says beside what its worktree changed",
    // /projects/:slug?by=sessions and /projects/:slug/sessions/:ref. The page's first choice is how to
    // look at the project (Project, the left panel): by sessions, here, or by worktrees
    // (projects-worktrees); composedViewFor picks one. No project list: once a project is
    // picked, Project's top line names it and leads back to picking.
    // Stacked (narrow window) panels follow this order: Project, Thread, Changes.
    host: { view: "agents-v2", indexView: "projects" },
    quickTerminal: false,
    instances: [
      { id: "projects-nav", type: "project-nav", config: { project: "@route" } },
      { id: "projects-thread", type: "project-thread" },
      { id: "projects-changes", type: "session-changes" },
    ],
    layout: [
      { id: "projects-nav", x: 0, y: 0, w: 3, h: 36 },
      { id: "projects-thread", x: 3, y: 0, w: 5, h: 36 },
      { id: "projects-changes", x: 8, y: 0, w: 4, h: 36 },
    ],
  },
  {
    id: "projects-worktrees",
    label: "Projects · Worktrees",
    intent: "A project by its worktrees: its worktrees, then open pull requests; one change, its files and diff",
    // /projects/:slug?by=worktrees, ?pr= and ?worktree= (with ?file=): the Projects page looking
    // by worktrees. Same Project panel as Project (worktrees first, pull requests below), and no
    // project list; then Worktree (the change picked: who made it, its files) beside Diff.
    host: { view: "agents-v2", indexView: "projects" },
    quickTerminal: false,
    instances: [
      { id: "projects-nav", type: "project-nav", config: { project: "@route" } },
      { id: "projects-branches", type: "project-branches" },
      { id: "projects-diff", type: "project-diff" },
    ],
    layout: [
      { id: "projects-nav", x: 0, y: 0, w: 3, h: 36 },
      { id: "projects-branches", x: 3, y: 0, w: 4, h: 36 },
      { id: "projects-diff", x: 7, y: 0, w: 5, h: 36 },
    ],
    // two panes: what is running (Sessions over Worktrees), and the one you picked (Session over PRs);
    // Sessions and PRs trade places readily ("bring Sessions above PRs")
    bonds: {
      panes: [
        ["projects-sessions", "projects-worktrees"],
        ["projects-session", "projects-prs"],
      ],
      swaps: [["projects-sessions", "projects-prs"]],
    },
  },
  {
    id: "ops-tail",
    label: "Tail",
    intent: "Every session event as it lands, the one you picked, and what a follow link narrowed it to",
    // all of /ops/tail: the URL holds its filter (?q=) and follow ids (?flightId ?invocationId ?conversationId ?workId ?sessionId ?targetAgentId)
    host: { view: "ops", mode: "tail" },
    // nothing on Tail starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the stream leads, as the page always did, then the pick
    instances: [
      // follows the page: the URL's filter and follow ids
      { id: "ops-tail-stream", type: "tail", config: { q: "@route" } },
      { id: "ops-tail-event", type: "tail-event" },
      { id: "ops-tail-following", type: "tail-follow" },
      { id: "ops-tail-queue", type: "ops-queue" },
    ],
    // the stream on the left; beside it what a follow link narrowed it to, the picked event (the inspector's card) and the rail's queue
    sides: { right: ["ops-tail-following", "ops-tail-event", "ops-tail-queue"] },
    layout: [{ id: "ops-tail-stream", x: 0, y: 0, w: 12, h: 24 }],
  },
  {
    id: "ops-issues",
    label: "Alerts",
    intent: "Warnings and errors as they land, and the one you picked",
    // /ops/issues, and /ops/errors and /ops/warnings, which parse to it
    host: { view: "ops", mode: "issues" },
    // nothing on Alerts starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the stream leads, then the pick
    instances: [
      // follows the page: the URL's filter
      { id: "ops-issues-stream", type: "alerts", config: { q: "@route" } },
      { id: "ops-issues-event", type: "tail-event" },
      { id: "ops-issues-queue", type: "ops-queue" },
    ],
    // the stream on the left; beside it the picked event (the inspector's card) and the rail's queue
    sides: { right: ["ops-issues-event", "ops-issues-queue"] },
    layout: [{ id: "ops-issues-stream", x: 0, y: 0, w: 12, h: 24 }],
  },
  {
    id: "ops-advisor",
    label: "Worktrees",
    intent: "Every worktree with work on it, across every repo, and what went quiet but still holds a process or a thread",
    // /ops/in-flight (and /ops/advisor, its ?plan=, and the legacy /ops/plan)
    host: { view: "ops", mode: "advisor" },
    // nothing here starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: In flight leads, then Stale, then the plan an agent lane opened.
    // Budgets live in Providers and Quotas; the subsystems watcher went (a down broker shows in the status bar).
    instances: [
      { id: "advisor-in-flight", type: "worktrees-in-flight" },
      { id: "advisor-stale", type: "stale" },
      // follows the page: ?plan= is the plan an agent lane's "Open plan" names
      { id: "advisor-plan", type: "plan", config: { plan: "@route" } },
    ],
    // In flight wide on the left; Stale beside it, the plan under Stale
    layout: [
      { id: "advisor-in-flight", x: 0, y: 0, w: 7, h: 16 },
      { id: "advisor-stale", x: 7, y: 0, w: 5, h: 10 },
      { id: "advisor-plan", x: 7, y: 10, w: 5, h: 14 },
    ],
  },
  {
    id: "ops-runtime",
    label: "Processes",
    intent: "Every agent process on this host, what it is doing and for how long, beside the fleet's requests and active asks",
    host: { view: "ops", mode: "atop" },
    // nothing here starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the page top-down, then its rails
    instances: [
      { id: "runtime-summary", type: "runtime-summary" },
      { id: "runtime-families", type: "harness-families" },
      { id: "runtime-table", type: "runtime-table" },
      { id: "runtime-context", type: "ops-summary" },
      { id: "runtime-queue", type: "ops-queue" },
    ],
    layout: [
      { id: "runtime-summary", x: 0, y: 0, w: 8, h: 5 },
      { id: "runtime-families", x: 0, y: 5, w: 8, h: 7 },
      { id: "runtime-table", x: 0, y: 12, w: 8, h: 18 },
      { id: "runtime-context", x: 8, y: 0, w: 4, h: 16 },
      { id: "runtime-queue", x: 8, y: 16, w: 4, h: 14 },
    ],
  },
  {
    id: "ops-agents",
    label: "Agents",
    intent: "Every agent with its asks, sessions, throughput, latency, tokens and cost",
    host: { view: "ops", mode: "agents" },
    // nothing here starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the directory leads
    instances: [
      { id: "agents-directory", type: "agents-directory" },
      { id: "agents-context", type: "ops-summary" },
      { id: "agents-roster", type: "agents-roster" },
    ],
    layout: [
      { id: "agents-directory", x: 0, y: 0, w: 8, h: 24 },
      { id: "agents-context", x: 8, y: 0, w: 4, h: 14 },
      { id: "agents-roster", x: 8, y: 14, w: 4, h: 10 },
    ],
  },
  {
    id: "ops-lanes",
    label: "Lanes",
    intent: "Every working session as a lane, the one you opened read whole beside it, and what the fleet is waiting on",
    // /ops/lanes and its ?sessionId= (or ?targetAgentId=): the lane the deck opened. The floor (/ops/fleet) keeps its own screen.
    host: { view: "ops", mode: "lanes" },
    // nothing here starts a terminal
    quickTerminal: false,
    // stacked (narrow window) panels follow this order: the deck leads, then the lane it opened, then the rails
    instances: [
      { id: "ops-lanes-deck", type: "lanes" },
      // follows the page: ?sessionId= is the lane the deck opened
      { id: "ops-lanes-lane", type: "lane", config: { lane: "@route" } },
      { id: "ops-lanes-roster", type: "lanes-roster" },
      { id: "ops-lanes-summary", type: "ops-summary" },
      { id: "ops-lanes-queue", type: "ops-queue" },
    ],
    // Three regions, each with its own handle: the roster docked left, the deck as the main area, and
    // the lane read whole over the inspector's summary and the rail's queue docked right. In the grid
    // the roster and the lane column could only change by whole columns, and the roster never went
    // below two (about 410px on a 2576px screen). Docked, each side drags to any width the window
    // leaves it, folds to a strip, and keeps its width; Focus (\) folds both so the deck takes the room.
    sides: { left: ["ops-lanes-roster"], right: ["ops-lanes-lane", "ops-lanes-summary", "ops-lanes-queue"] },
    // a lane reads whole, so its side ships wider than the shared pane width
    sideWidth: { right: 520 },
    // a lane reads whole: wider than a list, and most of its side's height over the two readouts
    sideWeights: { "ops-lanes-lane": 20, "ops-lanes-summary": 7, "ops-lanes-queue": 9 },
    layout: [{ id: "ops-lanes-deck", x: 0, y: 0, w: 12, h: 28 }],
  },
  {
    id: "agents",
    label: "Agents",
    intent: "What agents are doing and what they said, beside every project",
    // the Agents feed: bare /agents and /projects?view=sessions, its ?select= peek in the feed's panel
    host: { view: "agents-v2" },
    quickTerminal: false,
    // Activity › Agents: the feed alone. The project list belongs to Projects.
    instances: [
      { id: "agents-activity", type: "agent-activity" },
    ],
    layout: [
      { id: "agents-activity", x: 0, y: 0, w: 12, h: 24 },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    intent: "One agent: its sessions, config, trace and chat, and the session in hand",
    // an agent's page: /agents/:id and /projects/:slug/agents/:id with ?tab=, its session or conversation.
    // /views/agent goes to the feed, where an agent is picked; the panels follow whichever page is open.
    host: { view: "agents-v2" },
    quickTerminal: false,
    // @route: the panels follow the page's agent, so the URL holds the agent, tab and session.
    // Stacked (narrow window) panels follow this order: the profile, then its session.
    instances: [
      { id: "agent-profile", type: "agent", config: { agent: "@route" } },
      { id: "agent-session", type: "agent-session", config: { agent: "@route" } },
    ],
    layout: [
      { id: "agent-profile", x: 0, y: 0, w: 8, h: 24 },
      { id: "agent-session", x: 8, y: 0, w: 4, h: 24 },
    ],
  },
  {
    id: "activity",
    label: "Activity",
    intent: "Broker events, task execution, and collaboration handoffs, newest first: who, where, and where each leads",
    // all of /activity: ?event= is the open record, ?machineId= narrows the log
    host: { view: "activity" },
    // nothing on Activity starts a terminal (a record's Terminal hops to its own)
    quickTerminal: false,
    // @route: the log follows the page, so the URL holds the selection; Activity
    // details draws the record the page opened under its row, and Recent is the
    // Home rail the page had. Stacked (narrow window): the log, the record, Recent.
    instances: [
      { id: "activity-log", type: "activity", config: { follow: "@route" } },
      { id: "activity-item", type: "activity-item" },
      { id: "activity-recent", type: "home-recent" },
    ],
    sides: { right: ["activity-item", "activity-recent"] },
    layout: [
      { id: "activity-log", x: 0, y: 0, w: 12, h: 24 },
    ],
  },
  {
    id: "work-board",
    label: "Board",
    intent: "Work as the columns of its lifecycle: drag a card to a station and every column shows the runtime's answer before you drop; reviews wait on the card",
    // /work/board
    host: { view: "work", workId: "", board: true },
    quickTerminal: false,
    instances: [
      { id: "work-board", type: "work-board", config: {} },
    ],
    layout: [
      { id: "work-board", x: 0, y: 0, w: 12, h: 32 },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    intent: "A live voice call: who holds the floor, the controls, each turn, and what it used",
    // /voice. One session store (screens/voice/voice-session.ts) under every panel. The call itself
    // lives above the panels: GPT Live in the app-root provider, Local Live in the Voice call panel's engine.
    host: { view: "voice" },
    // a call has no shell of its own; no "New terminal" in the bar
    quickTerminal: false,
    // no @route: /voice carries no selection. The mode and the held turn are the session's.
    // Stacked (narrow window) panels follow this order: the stage and its controls, then the turns.
    instances: [
      { id: "voice-stage", type: "voice-stage" },
      { id: "voice-call", type: "voice-call" },
      { id: "voice-turns", type: "voice-turns" },
      { id: "voice-turn", type: "voice-turn" },
      { id: "voice-usage", type: "voice-usage" },
    ],
    layout: [
      { id: "voice-stage", x: 0, y: 0, w: 8, h: 11 },
      { id: "voice-turns", x: 8, y: 0, w: 4, h: 23 },
      { id: "voice-call", x: 0, y: 11, w: 8, h: 12 },
      { id: "voice-turn", x: 0, y: 23, w: 8, h: 14 },
      { id: "voice-usage", x: 8, y: 23, w: 4, h: 14 },
    ],
  },
  {
    id: "briefings",
    label: "Briefings",
    intent: "Scoutbot's fleet briefs, the newest 100: what it told you, when, and what it saw",
    // /briefings (the list; the Briefing panel waits for a pick) and /briefings/:id
    host: { view: "briefings" },
    // a reader; nothing here starts a terminal
    quickTerminal: false,
    // @route: the Briefing panel follows the page's briefing, so the URL holds the selection.
    // Recent is the Home rail the page had beside it.
    // Stacked (narrow window) panels follow this order: the list, the briefing, then Recent.
    instances: [
      { id: "briefings-list", type: "briefings" },
      { id: "briefings-briefing", type: "briefing", config: { briefing: "@route" } },
      { id: "briefings-recent", type: "home-recent" },
    ],
    layout: [
      { id: "briefings-list", x: 0, y: 0, w: 4, h: 15 },
      { id: "briefings-recent", x: 0, y: 15, w: 4, h: 9 },
      { id: "briefings-briefing", x: 4, y: 0, w: 8, h: 24 },
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    intent: "Every session Scout can see, the live ones marked, and the one you picked: read it, answer it, send to it",
    // /sessions (the board marks its first row; the thread shows it), /sessions/:ref
    // and /flights/:id/observe (?session=, ?compare=), each with ?machineId=
    host: { view: "sessions" },
    // a session runs in its own harness; no shell in the bar
    quickTerminal: false,
    // The slot deck as panels (design/studio views/sessions-place): the board is the
    // Board slot (Show, Project, Machine and Harness are its filter; Lanes is the Lane
    // slot) and the thread the Session slot that follows it. @route: the board marks
    // the page's session and a pick writes it; the thread follows the page's session.
    // Pin on the thread is the deck's Tear out; a second thread pinned to a session is Mix.
    // The board is the page's left side and the session's details its right: each as wide
    // as it is dragged, folding below 58 (DockedSides.tsx). In a narrow window they open
    // over the thread. The thread draws its session's details into the right side
    // (session-details-host.ts), so the session is read once.
    instances: [
      { id: "sessions-board", type: "session-board", config: { follow: "@route" } },
      { id: "sessions-thread", type: "session-thread", config: { session: "@route" } },
      { id: "sessions-details", type: "session-details" },
    ],
    sides: { left: ["sessions-board"], right: ["sessions-details"] },
    layout: [{ id: "sessions-thread", x: 0, y: 0, w: 12, h: 28 }],
  },
  {
    id: "requests",
    label: "Inbox",
    intent: "Approvals, questions and permission requests waiting on you, and the one in hand with its answers",
    // /inbox and /inbox?request=: the URL holds the selection; bare /inbox shows the first open item
    host: { view: "requests" },
    // a decision opens its own conversation or terminal; nothing here starts a shell
    quickTerminal: false,
    // @route: the list follows the page and the Request panel shows the page's request, so a pick
    // writes ?request= (with replace). One shared /api/operator-attention read and one set of
    // receipts under both. The list is the page's left side (as wide as it is dragged,
    // folding below 58); in a narrow window it opens over the request.
    instances: [
      { id: "requests-list", type: "requests", config: { follow: "@route" } },
      { id: "requests-request", type: "request", config: { request: "@route" } },
    ],
    sides: { left: ["requests-list"] },
    layout: [{ id: "requests-request", x: 0, y: 0, w: 12, h: 24 }],
  },
];

export const DEFAULT_VIEW_ID = SHIPPED_VIEWS[0].id;

export function shippedView(id: string | undefined): ViewComposition {
  return SHIPPED_VIEWS.find((v) => v.id === id) ?? SHIPPED_VIEWS[0];
}

export function addModule(instances: readonly ViewModuleInstance[], viewId: string, type: string, nonce: string): ViewModuleInstance[] {
  return [...instances, { id: `${viewId}-${type}-${nonce}`, type }];
}

/** Same cell, new module. Settings belong to the old module, so they go. */
export function replaceModule(instances: readonly ViewModuleInstance[], id: string, type: string): ViewModuleInstance[] {
  return instances.map((i) => (i.id === id ? { id: i.id, type } : i));
}

/** Merge settings into one instance. An empty string clears a key; no keys left = no config. */
export function configureModule(instances: readonly ViewModuleInstance[], id: string, patch: Record<string, string>): ViewModuleInstance[] {
  return instances.map((i) => {
    if (i.id !== id) return i;
    const next: Record<string, string> = { ...i.config };
    for (const [k, v] of Object.entries(patch)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    return Object.keys(next).length ? { ...i, config: next } : { id: i.id, type: i.type };
  });
}

function sameConfig(a: Record<string, string> | undefined, b: Record<string, string> | undefined, skip: (key: string) => boolean = () => false): boolean {
  const ka = Object.keys(a ?? {}).filter((k) => !skip(k));
  return ka.length === Object.keys(b ?? {}).filter((k) => !skip(k)).length && ka.every((k) => a?.[k] === b?.[k]);
}

export function removeModule(instances: readonly ViewModuleInstance[], id: string): ViewModuleInstance[] {
  return instances.filter((i) => i.id !== id);
}

/**
 * Modules added, removed, swapped or re-scoped since the view shipped. Moves
 * and resizes are the grid's and don't count. Pass `isState` to leave out a
 * module's live state (a terminal's session id): it is kept, but it is not a
 * choice the operator made. Without it, any difference counts, which is what
 * deciding whether to save needs.
 */
export function changesFrom(view: ViewComposition, instances: readonly ViewModuleInstance[], isState?: (type: string, key: string) => boolean): number {
  let n = 0;
  for (const i of instances) {
    const o = view.instances.find((x) => x.id === i.id);
    if (!o || o.type !== i.type || !sameConfig(o.config, i.config, isState ? (k) => isState(i.type, k) : undefined)) n++;
  }
  return n + view.instances.filter((o) => !instances.some((i) => i.id === o.id)).length;
}

/** The side an instance is docked on, or null for a grid panel. */
export function sideOf(view: ViewComposition, id: string): ViewSide | null {
  if (view.sides?.left?.includes(id)) return "left";
  if (view.sides?.right?.includes(id)) return "right";
  return null;
}

/** First cell, top-down, where a w×h module fits without moving anything. */
export function freeCell(layout: GridLayout, w: number, h: number, cols = GRID_BASE_COLS): { x: number; y: number } {
  const width = Math.min(w, cols);
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x + width <= cols; x++) {
      if (!layout.some((p) => collides({ id: "\0", x, y, w: width, h }, p))) return { x, y };
    }
  }
  return { x: 0, y: 1000 };
}

/**
 * The 12-column defaults the grid draws for these instances: the shipped cell
 * where there is one, otherwise the first free cell at the module's size.
 */
export function defaultsFor(view: ViewComposition, instances: readonly ViewModuleInstance[], sizeOf: (type: string) => ViewModuleSize): GridLayout {
  const out: GridItem[] = [];
  const onGrid = instances.filter((i) => !sideOf(view, i.id));
  for (const i of onGrid) {
    const shipped = view.layout.find((c) => c.id === i.id);
    if (shipped) out.push(shipped);
  }
  for (const i of onGrid) {
    if (out.some((c) => c.id === i.id)) continue;
    const size = sizeOf(i.type);
    out.push({ id: i.id, ...freeCell(out, size.w, size.h), ...size });
  }
  return out;
}

export function parseInstances(raw: unknown): ViewModuleInstance[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ViewModuleInstance[] = [];
  // an id is a panel, its cell, its settings and (for a terminal) its pty: one each, so a repeat is dropped
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object") return null;
    const { id, type, config } = v as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof type !== "string") return null;
    if (seen.has(id)) continue;
    seen.add(id);
    if (config === undefined) {
      out.push({ id, type });
      continue;
    }
    if (!config || typeof config !== "object" || Object.values(config).some((x) => typeof x !== "string")) return null;
    out.push({ id, type, config: { ...(config as Record<string, string>) } });
  }
  return out;
}

/** What a view saves: its instances, and the shipped instances they were made from. */
export type SavedView = { base: ViewModuleInstance[]; instances: ViewModuleInstance[] };

function sameInstances(a: readonly ViewModuleInstance[], b: readonly ViewModuleInstance[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]!.id && x.type === b[i]!.type && sameConfig(x.config, b[i]!.config));
}

/**
 * Whether cells the grid saved belong to another version of the view. Drawn as
 * shipped, a view's saved cells must name exactly its panels: a save made
 * before Scout reshaped the view (Projects kept three panel ids and gained
 * five) would put the kept ids back in their old cells and shove the new
 * panels around them.
 */
export function staleGridSave(view: ViewComposition, saved: readonly GridItem[] | null): boolean {
  if (!saved) return false;
  const ids = new Set(view.instances.filter((i) => !sideOf(view, i.id)).map((i) => i.id));
  return saved.length !== ids.size || saved.some((cell) => !ids.has(cell.id));
}

/**
 * Whether cells the grid saved were saved before some of them docked: a docked
 * panel never draws on the grid, so a cell of one comes only from an older
 * version of the view. That save holds the rest where they sat beside the
 * docked panels (Lanes' deck at columns 2 to 8 once its roster and lane
 * column docked), with a hole where each one was. Unlike staleGridSave this
 * holds for a view the operator edited too: its own modules keep their
 * settings, and the grid lays them out again.
 */
export function gridSavedBeforeSides(view: ViewComposition, saved: readonly GridItem[] | null): boolean {
  return !!saved && saved.some((cell) => sideOf(view, cell.id) != null);
}

/**
 * The instances to draw from what was saved, or null for the shipped view.
 * When Scout has shipped a new version of the view since the save, a save
 * holding no choices of the operator's (only module state, such as a
 * terminal's session) takes the new version; one with choices keeps theirs.
 * A plain list is a save from before views kept their base: kept as is.
 */
export function savedInstances(view: ViewComposition, raw: unknown, isState: (type: string, key: string) => boolean): ViewModuleInstance[] | null {
  if (Array.isArray(raw)) return parseInstances(raw);
  if (!raw || typeof raw !== "object") return null;
  const { base, instances } = raw as Record<string, unknown>;
  const mine = parseInstances(instances);
  const from = parseInstances(base);
  if (!mine) return null;
  if (from && !sameInstances(from, view.instances) && changesFrom({ ...view, instances: from }, mine, isState) === 0) return null;
  return mine;
}
