import {
  ChevronRight,
  Eye,
  LogIn,
  Power,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePersistentState } from "@hudsonkit";
import {
  collapseHerdrSessionItems,
  fetchTerminalSessions,
  surfaceKey,
  terminalListItems,
  terminalSurfaceIdsEqual,
} from "../../lib/terminal-sessions.ts";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { HerdrMark } from "../../components/HerdrMark.tsx";
import { RexMark } from "../../components/RexMark.tsx";
import { fetchHerdrTopology } from "../../lib/herdr-topology.ts";
import { isThisHost, terminalPlaceKey, useTerminalPlaces, useTerminalSources } from "../../lib/terminal-sources.ts";
import { timeAgo } from "../../lib/time.ts";
import { isEditableTarget, rovingTabIndex } from "../../lib/keyboard-nav.ts";
import { useScout } from "../../scout/Provider.tsx";
import { agentStateLabel, isAgentInTurn } from "../../lib/agent-state.ts";
import { controlTerminalSurface, resolveAgentTerminalSurface } from "../../lib/terminal-relay.ts";
import type { Agent, Route } from "../../lib/types.ts";
import { ModuleHead } from "../views/modules/ModuleHead.tsx";
import { terminalMode } from "../views/modules/terminal-page-model.ts";
import {
  sortTerminalSessionItems,
  terminalSessionActivityAt,
  terminalSessionLifecycle,
} from "./session-table.ts";
import {
  herdrReadFor,
  indexNeedsRead,
  rememberHerdr,
  rememberSessions,
  seededHerdrSummaries,
  seededIndexLoad,
  TERMINAL_INDEX_ROW_STOPS,
  terminalIndexKeyStep,
  terminalIndexMemory,
  terminalIndexRowTarget,
  type TerminalIndexLoad,
} from "./terminal-index-memory.ts";
import { terminalOwnerAgent } from "./terminal-row-identity.tsx";
import {
  groupTerminalNavItems,
  holdTerminalNavOrder,
  isStoppedHostItem,
  normalizeTerminalNavMode,
  projectLabel,
  rexWindowLabel,
  rexWindowName,
  TERMINAL_NAV_MODES,
  type TerminalNavMode,
  type TerminalNavSection,
} from "./terminal-nav-model.ts";
import {
  agentSourceRef,
  markedHarness,
  summarizeHerdrTopology,
  terminalAgentRow,
  terminalItemSourceRef,
  terminalNavRow,
  type TerminalNavHerdrSummary,
  type TerminalNavRowModel,
} from "./terminal-nav-row.ts";
import "../../scout/slots/ctx-panel.css";
import "../../scout/slots/terminal-left-panel.css";

const TERMINAL_NAV_REFRESH_MS = 8_000;
type TerminalNavSort = "recent" | "name";
type TerminalListItemRow = ReturnType<typeof terminalListItems>[number];

/**
 * Every row's mark sits in one 34px tile (see terminal-left-panel.css) so the
 * column lines up; what changes is the glyph inside. herdr fills its tile,
 * which is what sets a layout apart from a single agent.
 */
const TERMINAL_NAV_GLYPH = 18;
/** The app mark (Rex) leading a row's detail line, at the line's cap height. */
const TERMINAL_NAV_APP_GLYPH = 11;
const TERMINAL_NAV_HERDR_GLYPH = 26;
const TERMINAL_NAV_CHIP_GLYPH = 13;
/**
 * A herdr layout's harnesses: a small overlapped pile, each with its pane
 * count badged on. 12px is half the logos' 24-unit grid, so on a 2x screen
 * every unit is one device pixel; centred in an 18px disc it sits on whole
 * pixels too. The outline keeps hairline details solid at this size.
 */
const TERMINAL_NAV_PANE_GLYPH = 12;
const TERMINAL_NAV_PANE_OUTLINE = 0.35;

/**
 * The rail is an index with two cuts of the same terminals: Projects and
 * Recent. A row says what is in a terminal (who is working, what they last
 * did, which harnesses a herdr layout holds) rather than how it is hosted,
 * and stopped herdr layouts fold to one line per group.
 *
 * One index, two homes. As the rail it sits left of a terminal screen with
 * its own head (where a shell still draws one). As a panel it is the index of
 * the Terminals composition on bare /terminal, where "/" belongs to the
 * workspace beside it, and of the Terminal composition on a deep link
 * (/terminal/<target>), where it takes "/" as the rail did: the panel head
 * carries the title, the count and Refresh.
 */

export type TerminalIndexVariant = "rail" | "panel";

export type TerminalIndexProps = {
  /** The route drawn: the row it names is the active one; bare /terminal names none. */
  route: Route;
  navigate: (route: Route) => void;
  variant?: TerminalIndexVariant;
  /** Take "/" on the document, to the Terminals find field. Defaults to the rail; a panel takes it where no workspace beside it does. */
  bindFind?: boolean;
};

/** The left rail on terminal deep links, fed from Scout context. */
export function TerminalLeft() {
  const { route, navigate } = useScout();
  return <TerminalIndex route={route} navigate={navigate} variant="rail" />;
}

export function TerminalIndex({ route, navigate, variant = "rail", bindFind = variant === "rail" }: TerminalIndexProps) {
  const { agents } = useScout();
  const rail = variant === "rail";
  // how the route has its terminal open, as the terminal itself reads it
  const openMode = route.view === "terminal" ? terminalMode(route) : null;
  // Crossing between the panel and the rail mounts the index afresh; it
  // starts from what it last held (terminal-index-memory.ts), not from empty.
  const memory = terminalIndexMemory;
  const [state, setState] = useState<TerminalIndexLoad>(() => seededIndexLoad(memory));
  const sort: TerminalNavSort = "recent";
  const [storedNavMode, setNavMode] = usePersistentState<string>("terminal-nav-mode", "projects");
  const navMode: TerminalNavMode = normalizeTerminalNavMode(storedNavMode);
  const [herdrSummaries, setHerdrSummaries] = useState<ReadonlyMap<string, TerminalNavHerdrSummary>>(
    () => seededHerdrSummaries(memory),
  );
  const [expandedStopped, setExpandedStopped] = useState<ReadonlySet<string>>(() => memory.expandedStopped);
  const [inactiveExpanded, setInactiveExpanded] = useState(() => memory.inactiveExpanded);
  const [agentsExpanded, setAgentsExpanded] = useState(() => memory.agentsExpanded);
  const [releasingItemId, setReleasingItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    memory.expandedStopped = expandedStopped;
  }, [expandedStopped, memory]);
  useEffect(() => {
    memory.inactiveExpanded = inactiveExpanded;
  }, [inactiveExpanded, memory]);
  useEffect(() => {
    memory.agentsExpanded = agentsExpanded;
  }, [agentsExpanded, memory]);
  /**
   * Arrows or j/k move along the rows, Home and End to the ends, with one tab
   * stop for the list. The stops are the row buttons, the stopped folds and
   * the Inactive toggle, at any depth; focus on a row's Enter or Observe
   * counts as that row.
   */
  const onListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = terminalIndexKeyStep(event);
    if (!step) return;
    const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TERMINAL_INDEX_ROW_STOPS));
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const owner = focused?.closest(".terminal-nav-row")?.querySelector<HTMLElement>(".terminal-nav-row-select") ?? focused;
    const next = terminalIndexRowTarget(step, owner ? stops.indexOf(owner) : -1, stops.length);
    if (next < 0) return;
    event.preventDefault();
    stops.forEach((stop, index) => {
      stop.tabIndex = index === next ? 0 : -1;
    });
    stops[next].focus();
  }, []);
  /**
   * Finding a terminal has one door: the field on the Terminals stage. The
   * index carries no search box of its own, so "/" pressed while it shows
   * beside one terminal goes to that field — opening the stage first when a
   * terminal session, not the picker, is on screen. Beside the workspace
   * (bare /terminal) it binds nothing on the document: the workspace owns "/".
   */
  useEffect(() => {
    if (!bindFind) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const focusFind = () => {
        const field = document.querySelector<HTMLInputElement>("[data-terminal-find]");
        if (!field) return false;
        field.focus();
        field.select();
        return true;
      };
      if (focusFind()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      navigate({ view: "terminal" });
      // Bare /terminal draws the Terminals composition, and the field mounts
      // with its workspace panel a few paints on; look for it for up to ~half
      // a second. This index unmounts on the way, so this touches only the DOM.
      let frames = 0;
      const retry = () => {
        if (!focusFind() && ++frames < 30) requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [bindFind, navigate]);

  const load = useCallback((options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setState((current) => ({ state: "loading", sessions: current.sessions }));
    }
    void fetchTerminalSessions({ includeDiscovered: true })
      .then((sessions) => {
        rememberSessions(memory, sessions, Date.now());
        setState({ state: "ready", sessions });
      })
      .catch((error) => {
        if (options.silent) return;
        setState((current) => ({
          state: "failed",
          sessions: current.sessions,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
  }, [memory]);

  // Read on mount only when nothing is held or it is a refresh old; a seeded
  // index reads quietly, so it keeps its rows and does not say Syncing.
  useEffect(() => {
    if (indexNeedsRead(memory, Date.now(), TERMINAL_NAV_REFRESH_MS)) {
      load({ silent: memory.sessions != null });
    }
  }, [load, memory]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        load({ silent: true });
      }
    };
    const interval = window.setInterval(refreshIfVisible, TERMINAL_NAV_REFRESH_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [load]);

  // Raw per-surface items stay around for agent dedup (a pane-level agent
  // surface must match even when its herdr session collapsed to one row);
  // the rail itself displays one row per herdr session.
  const allItems = useMemo(() => terminalListItems(state.sessions), [state.sessions]);
  const items = useMemo(
    () => sortTerminalSessionItems(
      collapseHerdrSessionItems(allItems),
      sort === "recent"
        ? { column: "activity", direction: "desc" }
        : { column: "name", direction: "asc" },
    ),
    [sort, allItems],
  );
  const agentTargets = useMemo(
    () => sortTerminalAgentsForNav(agents, sort).filter((agent) => {
      const surface = resolveAgentTerminalSurface(agent);
      if (!surface) return true;
      return !allItems.some((item) =>
        item.surface.backend === surface.backend
        && item.surface.sessionName === surface.sessionName
        && (surface.paneId == null || item.surface.paneId === surface.paneId)
      );
    }),
    [agents, allItems, sort],
  );
  // A running herdr session's record carries no folder and no agents; its
  // topology does. Read it for live sessions only, on the rail's own cadence.
  const liveHerdrNames = useMemo(
    () => items
      .filter((item) => item.surface.backend === "herdr" && !isStoppedHostItem(item))
      .map((item) => item.surface.sessionName)
      .sort()
      .join("\n"),
    [items],
  );
  useEffect(() => {
    const names = liveHerdrNames ? liveHerdrNames.split("\n") : [];
    const sessions = state.sessions;
    if (names.length === 0) {
      const none = new Map<string, TerminalNavHerdrSummary>();
      rememberHerdr(memory, sessions, none);
      setHerdrSummaries(none);
      return;
    }
    // seeded with summaries read for these very sessions: nothing new to read
    if (herdrReadFor(memory, sessions)) return;
    let cancelled = false;
    void Promise.all(names.map(async (name) => {
      const summary = await fetchHerdrTopology(name).then(summarizeHerdrTopology).catch(() => null);
      return [name, summary] as const;
    })).then((entries) => {
      if (cancelled) return;
      const next = new Map<string, TerminalNavHerdrSummary>();
      for (const [name, summary] of entries) if (summary) next.set(name, summary);
      rememberHerdr(memory, sessions, next);
      setHerdrSummaries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [liveHerdrNames, memory, state.sessions]);
  // Where each attached session's client runs (Rex, Ghostty), re-read with
  // the sessions. Then what each row's harness calls its session: asked for
  // the rows on screen only, so a folded section costs nothing.
  const places = useTerminalPlaces(state.sessions);
  const sourceRefs = useMemo(() => {
    const refs: string[] = [];
    for (const item of items) {
      if (!inactiveExpanded && terminalSessionLifecycle(item) !== "current") continue;
      const ref = terminalItemSourceRef(item);
      if (ref) refs.push(ref);
    }
    // An agent on another host has its transcripts there; wait for the
    // places read to say which agents are this host's.
    if (agentsExpanded && places) {
      for (const agent of agentTargets) {
        if (isThisHost(places, agent) === false) continue;
        const ref = agentSourceRef(agent);
        if (ref) refs.push(ref);
      }
    }
    return refs;
  }, [agentTargets, agentsExpanded, inactiveExpanded, items, places]);
  const sources = useTerminalSources(sourceRefs);
  const rowModels = useMemo(() => {
    const models = new Map<string, TerminalNavRowModel>();
    for (const item of items) {
      const owner = terminalOwnerAgent(agents, item);
      const herdr = item.surface.backend === "herdr"
        ? herdrSummaries.get(item.surface.sessionName) ?? null
        : null;
      const ref = terminalItemSourceRef(item);
      models.set(item.id, terminalNavRow(item, owner, herdr, {
        source: ref ? sources.get(ref) ?? null : null,
        place: places?.byKey.get(terminalPlaceKey(item.surface.backend, item.surface.sessionName)) ?? null,
      }));
    }
    return models;
  }, [agents, herdrSummaries, items, places, sources]);
  /** The herdr session and tab an agent's harness session runs in, when a live one holds it. */
  const herdrPlaceOf = (agent: Agent): string | null => {
    const ref = agentSourceRef(agent);
    if (!ref) return null;
    for (const [sessionName, summary] of herdrSummaries) {
      const tab = summary.tabsByRef?.[ref];
      if (tab) return `${sessionName} › ${tab}`;
    }
    return null;
  };
  const currentItems = items.filter((item) => terminalSessionLifecycle(item) === "current");
  const rankedSections = groupTerminalNavItems(currentItems, navMode, {
    isWorking: (item) => rowModels.get(item.id)?.working ?? false,
    projectOf: (item) => item.surface.backend === "herdr"
      ? herdrSummaries.get(item.surface.sessionName)?.project ?? null
      : null,
    rexOf: (item) => rowModels.get(item.id)?.rex ?? null,
    appOf: (item) => places?.byKey.get(terminalPlaceKey(item.surface.backend, item.surface.sessionName))?.apps[0] ?? null,
  });
  // Projects holds still: ranked on its first draw, then each project and
  // terminal keeps its place while work comes and goes. Recent is the cut
  // that moves rows by time, so it is drawn as ranked.
  const navSections = navMode === "projects"
    ? holdTerminalNavOrder(rankedSections, memory.navOrder)
    : rankedSections;
  const inactiveItems = items.filter((item) => terminalSessionLifecycle(item) === "inactive");
  const reviewItems = items.filter((item) => terminalSessionLifecycle(item) === "review");
  const inactiveCount = inactiveItems.length + reviewItems.length;
  const reviewCount = reviewItems.length;
  const showInactive = inactiveExpanded;
  const visibleAgents = agentTargets;
  const activeTerminalSurfaceKey = route.view === "terminal" ? route.terminalSurfaceKey ?? null : null;
  const activeTerminalSessionId = route.view === "terminal" ? route.terminalSessionId ?? null : null;
  const isActiveTerminalItem = (item: ReturnType<typeof terminalListItems>[number]) =>
    terminalSurfaceIdsEqual(item.key, activeTerminalSurfaceKey)
    && (!activeTerminalSessionId || item.session.id === activeTerminalSessionId);
  const activeAgentKey = route.view === "terminal" && route.agentId ? `agent:${route.agentId}` : null;
  const activeAgentListed = activeAgentKey != null && visibleAgents.some((agent) => `agent:${agent.id}` === activeAgentKey);
  // Agents fold to one counted row. Opening an agent unfolds it once, so its
  // row shows; folding it again after that is the operator's call.
  useEffect(() => {
    if (activeAgentListed) setAgentsExpanded(true);
  }, [activeAgentKey, activeAgentListed]);
  const showAgents = agentsExpanded;
  const hasAnyActive = Boolean(
    currentItems.some(isActiveTerminalItem)
    || (showInactive && [...inactiveItems, ...reviewItems].some(isActiveTerminalItem))
    || (showAgents && activeAgentListed),
  );
  // Pick up where the other home left the list, then bring the active row
  // into view once per mount (block "nearest": no move when it shows already).
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = memory.scrollTop;
  }, [memory]);
  const revealedActive = useRef(false);
  useLayoutEffect(() => {
    if (revealedActive.current || !hasAnyActive) return;
    revealedActive.current = true;
    listRef.current?.querySelector(".terminal-nav-row--active")?.scrollIntoView({ block: "nearest" });
  }, [hasAnyActive]);
  const firstRowId = navSections.find((section) => section.items.length > 0)?.items[0]?.id
    ?? (showInactive ? inactiveItems[0]?.id ?? reviewItems[0]?.id : undefined)
    ?? (showAgents && visibleAgents[0] ? `agent:${visibleAgents[0].id}` : undefined);
  const stoppedCount = currentItems.filter(isStoppedHostItem).length;
  const syncing = state.state === "loading" && items.length === 0;
  const runningCount = currentItems.length - stoppedCount;
  const summary = syncing
    ? "Syncing"
    : `${runningCount} running${stoppedCount > 0 ? ` · ${stoppedCount} stopped` : ""}`;
  const refreshButton = (
    <button
      type="button"
      className={rail ? "terminal-nav-refresh" : "terminal-index-refresh"}
      onClick={() => load()}
      disabled={state.state === "loading"}
      title="Refresh terminals"
      aria-label="Refresh terminals"
    >
      <RefreshCw size={rail ? 14 : 12} strokeWidth={1.8} />
    </button>
  );
  const terminalRouteFor = (
    item: ReturnType<typeof terminalListItems>[number],
    mode?: "takeover" | "observe",
  ) => ({
    view: "terminal" as const,
    terminalSessionId: item.session.id,
    terminalSurfaceKey: surfaceKey(item.surface),
    ...(mode ? { mode } : {}),
  });
  const terminalRouteForAgent = (agent: Agent, mode: "takeover" | "observe" = "takeover") => ({
    view: "terminal" as const,
    agentId: agent.id,
    mode,
  });
  const releaseTerminal = async (item: ReturnType<typeof terminalListItems>[number]) => {
    if (item.surface.backend !== "tmux") return;
    if (!window.confirm(
      `Release inactive terminal ${item.surface.sessionName}? The tmux surface will stop, but any associated Scout agent remains available and can be started again.`,
    )) return;
    setReleasingItemId(item.id);
    setActionError(null);
    try {
      await controlTerminalSurface({
        backend: "tmux",
        sessionName: item.surface.sessionName,
        paneId: item.surface.paneId ?? null,
        socketDir: item.surface.socketDir ?? null,
      }, "release");
      load({ silent: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setReleasingItemId(null);
    }
  };
  const renderTerminalItem = (item: TerminalListItemRow, options: { withProject?: boolean } = {}) => {
    const active = isActiveTerminalItem(item);
    const lifecycle = terminalSessionLifecycle(item);
    const releasing = releasingItemId === item.id;
    const row = rowModels.get(item.id) ?? terminalNavRow(item, null, null);
    const activityAt = terminalSessionActivityAt(item);
    const when = row.working ? "now" : activityAt !== null ? timeAgo(activityAt) : "";
    const place = row.panes?.project ?? projectLabel(item);
    // In Rex, where it sits there: its window (unless the section already
    // says it), then its block's name, else the terminal's own.
    const where = row.rex
      ? [navMode === "windows" ? null : rexWindowName(row.rex), row.rex.block ?? row.handle].filter(Boolean).join(" › ")
      : row.host ? `${row.host} › ${row.handle}` : row.handle;
    return (
      <div
        key={item.id}
        className={`terminal-nav-row${active ? " terminal-nav-row--active" : ""}${lifecycle === "review" ? " terminal-nav-row--review" : ""}${row.panes ? " terminal-nav-row--layout" : ""}`}
        title={[
          item.surface.sessionName,
          row.rex ? `Rex: ${rexWindowLabel(row.rex)}${row.rex.block ? ` › ${row.rex.block}` : ""}` : null,
          row.panes?.project,
          row.panes?.branch,
        ].filter(Boolean).join(" · ")}
      >
        <button
          type="button"
          data-list-primary
          className="terminal-nav-row-select"
          tabIndex={rovingTabIndex(active, hasAnyActive, item.id === firstRowId)}
          onClick={() => navigate(terminalRouteFor(item))}
        >
          <span className="terminal-nav-mark" data-kind={row.mark.kind}>
            {row.mark.kind === "herdr" ? (
              <HerdrMark size={TERMINAL_NAV_HERDR_GLYPH} title={null} />
            ) : row.mark.kind === "harness" ? (
              <HarnessMark harness={row.mark.harness} size={TERMINAL_NAV_GLYPH} title={null} />
            ) : (
              <span className="terminal-nav-mark-shell">&gt;_</span>
            )}
            {row.working && <span className="terminal-nav-mark-working" aria-label="working" />}
          </span>
          <span className="terminal-nav-row-main">
            <span className="terminal-nav-row-title">
              <span className="terminal-nav-row-name">{row.title}</span>
              {row.panes && row.panes.paneCount > 0 && (
                <span className="terminal-nav-panes">
                  {row.panes.panes.map((group) => (
                    <span
                      key={group.harness}
                      className={`terminal-nav-pane-chip${group.working > 0 ? " terminal-nav-pane-chip--working" : ""}`}
                      title={`${group.count} ${group.harness}${group.working > 0 ? `, ${group.working} working` : ""}`}
                    >
                      <HarnessMark harness={group.harness} size={TERMINAL_NAV_PANE_GLYPH} outline={TERMINAL_NAV_PANE_OUTLINE} title={null} />
                      {group.count > 1 ? (
                        <span className="terminal-nav-pane-count">{group.count}</span>
                      ) : group.working > 0 ? (
                        <span className="terminal-nav-pane-count terminal-nav-pane-count--dot" />
                      ) : null}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="terminal-nav-row-detail">
              {row.rex && <RexMark className="terminal-nav-row-app" size={TERMINAL_NAV_APP_GLYPH} title="Rex" />}
              {[
                // the app its client runs in, then the session: "Rex › herdr";
                // in Rex, its mark, then the window and block it is open in
                where,
                options.withProject ? place : null,
                row.panes && row.panes.paneCount > 0
                  ? `${row.panes.paneCount} ${row.panes.paneCount === 1 ? "pane" : "panes"}${row.panes.working > 0 ? ` · ${row.panes.working} working` : ""}`
                  : null,
              ].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="terminal-nav-row-when">
            {lifecycle === "review" ? <span className="terminal-nav-badge terminal-nav-badge--review">review</span> : when}
          </span>
        </button>
        <div className="terminal-nav-row-actions">
          <button
            type="button"
            className={`terminal-nav-action${active && openMode === "takeover" ? " terminal-nav-action--selected" : ""}`}
            onClick={() => navigate(terminalRouteFor(item, "takeover"))}
            title="Enter this terminal"
            aria-label="Enter this terminal"
          >
            <LogIn size={12} strokeWidth={1.8} />
            <span>Enter</span>
          </button>
          <button
            type="button"
            className={`terminal-nav-action${active && openMode === "observe" ? " terminal-nav-action--selected" : ""}`}
            onClick={() => navigate(terminalRouteFor(item, "observe"))}
            title="Observe this terminal read-only"
            aria-label="Observe this terminal read-only"
          >
            <Eye size={12} strokeWidth={1.8} />
            <span>Observe</span>
          </button>
          {lifecycle === "review" && item.surface.backend === "tmux" && (
            <button
              type="button"
              className="terminal-nav-action terminal-nav-action--release"
              onClick={() => void releaseTerminal(item)}
              disabled={releasing}
              title="Release this inactive tmux surface; keep the agent"
              aria-label="Release this inactive tmux surface; keep the agent"
            >
              <Power size={12} strokeWidth={1.8} />
              <span>{releasing ? "Releasing" : "Release"}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderStoppedFold = (section: TerminalNavSection) => {
    if (section.stopped.length === 0) return null;
    const expanded = expandedStopped.has(section.key);
    const names = section.stopped.map((item) => item.surface.sessionName).join(" · ");
    return (
      <>
        <button
          type="button"
          className="terminal-nav-stopped"
          aria-expanded={expanded}
          title={`Stopped herdr layouts: ${names}`}
          onClick={() => setExpandedStopped((current) => {
            const next = new Set(current);
            if (next.has(section.key)) next.delete(section.key);
            else next.add(section.key);
            return next;
          })}
        >
          <span className="terminal-nav-stopped-mark"><HerdrMark size={TERMINAL_NAV_GLYPH} title={null} /></span>
          <span className="terminal-nav-stopped-count">
            {section.stopped.length} stopped {section.stopped.length === 1 ? "layout" : "layouts"}
          </span>
          <ChevronRight size={12} strokeWidth={1.8} className="terminal-nav-stopped-chevron" />
          {!expanded && <span className="terminal-nav-stopped-names">{names}</span>}
        </button>
        {expanded && section.stopped.map((item) => renderTerminalItem(item, { withProject: navMode !== "projects" }))}
      </>
    );
  };
  const renderSection = (section: TerminalNavSection) => {
    if (section.items.length === 0 && section.stopped.length === 0) return null;
    const when = section.working
      ? "now"
      : section.latestActivity !== null ? timeAgo(section.latestActivity) : "";
    return (
      <div className="terminal-nav-section" key={section.key}>
        <div className={`terminal-nav-section-title${section.working ? " terminal-nav-section-title--working" : ""}`}>
          <span>{section.label}</span>
          {navMode === "projects" && when && <span className="terminal-nav-section-when">{when}</span>}
          <span>{section.items.length || ""}</span>
        </div>
        {section.items.map((item) => renderTerminalItem(item, { withProject: navMode !== "projects" }))}
        {renderStoppedFold(section)}
      </div>
    );
  };

  return (
    <div className={`ctx-panel terminal-nav${rail ? "" : " terminal-nav--panel"}`}>
      {rail ? (
        <div className="terminal-nav-head">
          <div>
            <div className="terminal-nav-title">Terminals</div>
            <div className="terminal-nav-summary">{summary}</div>
          </div>
          {refreshButton}
        </div>
      ) : (
        // The panel head already says Terminals; it takes the count and Refresh.
        <ModuleHead>
          <span className="terminal-index-head">
            <span className="terminal-index-count" title={summary}>
              {syncing ? "Syncing" : `${runningCount} running`}
            </span>
            {refreshButton}
          </span>
        </ModuleHead>
      )}
      <div className="terminal-nav-modes" role="tablist" aria-label="Index terminals by">
        {TERMINAL_NAV_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            title={mode.title}
            aria-selected={navMode === mode.id}
            className={`terminal-nav-mode${navMode === mode.id ? " terminal-nav-mode--active" : ""}`}
            onClick={() => setNavMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {state.state === "failed" && (
        <div className="terminal-nav-error">{state.error}</div>
      )}
      {actionError && <div className="terminal-nav-error">{actionError}</div>}
      <div
        ref={listRef}
        className="terminal-nav-list"
        onKeyDown={onListKeyDown}
        onScroll={(event) => {
          memory.scrollTop = event.currentTarget.scrollTop;
        }}
      >
        {items.length === 0 && visibleAgents.length === 0 && state.state !== "loading" ? (
          <div className="ctx-panel-empty">No terminal targets</div>
        ) : (
          <>
            {navSections.map((section) => renderSection(section))}
            {currentItems.length === 0 && state.state !== "loading" && (
              <div className="terminal-nav-empty">No sessions</div>
            )}

            {inactiveCount > 0 && (
              <div className="terminal-nav-section terminal-nav-section--inactive">
                <button
                  type="button"
                  className="terminal-nav-inactive-toggle"
                  aria-expanded={showInactive}
                  onClick={() => setInactiveExpanded((expanded) => !expanded)}
                >
                  <ChevronRight size={13} strokeWidth={1.8} />
                  <span>Inactive</span>
                  <span>{inactiveCount}</span>
                  {reviewCount > 0 && <span className="terminal-nav-review-count">{reviewCount} review</span>}
                </button>
                {showInactive && (
                  <>
                    {inactiveItems.map((item) => renderTerminalItem(item))}
                    {reviewItems.length > 0 && (
                      <div className="terminal-nav-section-title terminal-nav-section-title--review">
                        <span>Review after 30 days</span>
                        <span>{reviewItems.length}</span>
                      </div>
                    )}
                    {reviewItems.map((item) => renderTerminalItem(item))}
                  </>
                )}
              </div>
            )}

            <div className="terminal-nav-section terminal-nav-section--inactive">
              <button
                type="button"
                className="terminal-nav-inactive-toggle"
                aria-expanded={showAgents}
                onClick={() => setAgentsExpanded((expanded) => !expanded)}
              >
                <ChevronRight size={13} strokeWidth={1.8} />
                <span>Agents</span>
                <span>{visibleAgents.length}</span>
              </button>
              {showAgents && visibleAgents.map((agent) => {
                const key = `agent:${agent.id}`;
                const active = key === activeAgentKey;
                const terminalSurface = resolveAgentTerminalSurface(agent);
                const sourceRef = agentSourceRef(agent);
                const agentRow = terminalAgentRow(agent, {
                  source: sourceRef ? sources.get(sourceRef) ?? null : null,
                  local: isThisHost(places, agent),
                  herdrPlace: herdrPlaceOf(agent),
                });
                return (
                  <div
                    key={agent.id}
                    className={`terminal-nav-row terminal-nav-row--agent${active ? " terminal-nav-row--active" : ""}`}
                    title={agentRow.tooltip}
                  >
                    <button
                      type="button"
                      data-list-primary
                      className="terminal-nav-row-select"
                      tabIndex={rovingTabIndex(active, hasAnyActive, key === firstRowId)}
                      onClick={() => navigate(terminalRouteForAgent(agent))}
                    >
                      {markedHarness(agent.harness) ? (
                        <span className="terminal-nav-mark" data-kind="harness">
                          <HarnessMark harness={markedHarness(agent.harness)!} size={TERMINAL_NAV_GLYPH} title={null} />
                          {isAgentInTurn(agent.state, agent) && <span className="terminal-nav-mark-working" aria-label="working" />}
                        </span>
                      ) : (
                        <span className={`terminal-nav-agent-dot${terminalSurface ? " terminal-nav-agent-dot--bound" : ""}`} aria-hidden />
                      )}
                      <span className="terminal-nav-row-main">
                        <span className="terminal-nav-row-title">
                          <span className="terminal-nav-row-name">{agentRow.title}</span>
                        </span>
                        <span className="terminal-nav-row-detail">{agentRow.detail}</span>
                      </span>
                      <span className="terminal-nav-badges">
                        <span className="terminal-nav-badge terminal-nav-badge--backend">{terminalSurface?.backend ?? agent.harness ?? "agent"}</span>
                        <span className="terminal-nav-badge">{terminalSurface ? "bound" : agentStateLabel(agent.state)}</span>
                      </span>
                    </button>
                    <div className="terminal-nav-row-actions">
                      <button
                        type="button"
                        className={`terminal-nav-action${active && openMode === "takeover" ? " terminal-nav-action--selected" : ""}`}
                        onClick={() => navigate(terminalRouteForAgent(agent, "takeover"))}
                        title="Enter this agent terminal"
                        aria-label="Enter this agent terminal"
                      >
                        <LogIn size={12} strokeWidth={1.8} />
                        <span>Enter</span>
                      </button>
                      {terminalSurface && (
                        <button
                          type="button"
                          className={`terminal-nav-action${active && openMode === "observe" ? " terminal-nav-action--selected" : ""}`}
                          onClick={() => navigate(terminalRouteForAgent(agent, "observe"))}
                          title="Observe this agent terminal read-only"
                          aria-label="Observe this agent terminal read-only"
                        >
                          <Eye size={12} strokeWidth={1.8} />
                          <span>Observe</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleAgents.length === 0 && (
                <div className="terminal-nav-empty">No agents</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function sortTerminalAgentsForNav(agents: Agent[], sort: TerminalNavSort): Agent[] {
  return [...agents]
    .filter((agent) => !agent.retiredFromFleet && !agent.staleLocalRegistration)
    .sort((a, b) => {
      const nameRank = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (sort === "name") return nameRank || a.id.localeCompare(b.id);
      const updatedRank = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      return updatedRank || nameRank || a.id.localeCompare(b.id);
    });
}

