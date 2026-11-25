import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Folder, Loader2 } from "lucide-react";
import { loadConversationList } from "../../lib/conversation-list-cache.ts";
import { api } from "../../lib/api.ts";
import "../../scout/slots/ctx-panel.css";
import "./chat-list.css";
import { isOfflineApiError } from "../../lib/api-errors.ts";
import { useListArrowNav, makeSearchHandoff, useSlashToFocus, rovingTabIndex } from "../../lib/keyboard-nav.ts";
import {
  conversationDisplayTitle,
  isChannelConversation,
  isObservedDirect,
  isOperatorDm,
} from "../../lib/conversations.ts";
import {
  isArchived,
  isPinned,
  loadConversationPrefs,
  pinRank,
  toggleArchive,
  togglePin,
  type ConversationPrefs,
} from "../../lib/conversation-prefs.ts";
import {
  fleetAskForSession,
  type FleetActiveAskIndex,
} from "../../lib/fleet-active-asks.ts";
import { taskThreadTitle } from "../../lib/sessions-view.ts";
import {
  groupByProject,
  loadChatListOrder,
  orderProjectGroups,
  OTHER_CHATS_LABEL,
  plainListTitle,
  projectLabelForSession,
  PROJECTS_SHOWN,
  saveChatListOrder,
  shortAge,
  visibleProjectRows,
  type ChatListOrder,
  type ProjectGroup,
} from "../../lib/chat-list.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { HarnessMark, harnessTint } from "../../components/HarnessMark.tsx";
import { useBeside } from "./use-beside.ts";
import {
  loadLastViewedMap,
  saveLastViewed,
  type LastViewedMap,
} from "../../lib/sessionRead.ts";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import {
  EMPTY_DECLARED_REQUEST_INDEX,
  buildDeclaredRequestIndex,
  declaredRequestForSession,
  declaredRequestLabel,
  type DeclaredRequestIndex,
} from "../../lib/declared-requests.ts";
import { useScout } from "../../scout/Provider.tsx";
import {
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { conversationalMessagePreview } from "../../lib/message-visibility.ts";
import { RowNameField } from "../../scout/slots/RailRow.tsx";
import type { Agent, OperatorAttentionItem, SessionEntry } from "../../lib/types.ts";

/** How many observed conversations show before "more" (keeps the list scannable). */
const OBSERVED_PREVIEW_LIMIT = 12;

/**
 * Roving-tabindex bookkeeping. Rows are addressed by ROW id, not conversation
 * id: Waiting on you mirrors conversations that also render further down, so
 * a conversation id is not unique in the list.
 */
type RailNav = {
  /** Conversation currently open in the center pane (highlights every mirror). */
  activeId: string | undefined;
  /** The single row that owns the tab stop, or undefined when nothing is open. */
  activeRowId: string | undefined;
  /** First row in render order: the tab stop when nothing is open. */
  firstRowId: string | undefined;
};

/**
 * The Chats list column, drawn the way the Mac app draws it.
 *
 * One quiet control row: Projects or Recent, and the filter. Projects groups
 * your conversations under the project that moved last; Recent is one list,
 * newest first. Every row is one line: the harness mark, the title in plain
 * words, and the row's state at one right edge (working, waiting on you, or
 * its age). Waiting on you MIRRORS rows rather than moving them, so nothing
 * reflows when a request resolves.
 */
export function ChatLeft() {
  const { route, navigate, agents, apiConnection } = useScout();
  const { sessions, loading, loadError, reload } = useConversationList();
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [prefs, setPrefs] = useState<ConversationPrefs>(() => loadConversationPrefs());
  const [query, setQuery] = useState("");
  const [order, setOrderState] = useState<ChatListOrder>(() => loadChatListOrder());
  const setOrder = useCallback((next: ChatListOrder) => {
    setOrderState(saveChatListOrder(next));
  }, []);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [observedOpen, setObservedOpen] = useState(false);
  const [showAllObserved, setShowAllObserved] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const asksByAgent = useFleetActiveAsks();
  // Requests are DECLARED only (operator needs, approvals, session questions),
  // never inferred from a flight, message text, or a reply to your own ask.
  const { state: requestsState } = useOperatorRequests();
  const declaredRequests = useMemo(
    () => buildDeclaredRequestIndex(requestsState?.items ?? []),
    [requestsState?.items],
  );
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    const scopedAgents = scopedAgentIds
      ? agents.filter((agent) => scopedAgentIds.has(agent.id))
      : agents;
    for (const agent of scopedAgents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents, scopedAgentIds]);

  const activeId =
    route.view === "messages" ? route.conversationId :
    route.view === "conversation" ? route.conversationId :
    route.view === "agent-info" ? route.conversationId :
    route.view === "agents-v2" ? route.conversationId :
    undefined;
  /** A thread raised in the agent master view highlights its own row. */
  const activeThreadId = route.view === "messages" ? route.threadId : undefined;

  // Keep the observed list tight when the query changes under it.
  useEffect(() => {
    setShowAllObserved(false);
  }, [query]);

  const machineScoped = useMemo(
    () => filterSessionsByMachineScope(sessions, scopedAgentIds, machineId),
    [sessions, scopedAgentIds, machineId],
  );

  const scoped = useMemo(
    () => (query ? machineScoped.filter((s) => matchesQuery(s, query)) : machineScoped),
    [machineScoped, query],
  );

  /**
   * The precedence layer: your conversations holding a DECLARED request
   * (an operator need, a question, an approval).
   */
  const needsYou = useMemo(() => {
    const requestUpdatedAt = (s: SessionEntry) =>
      declaredRequestForSession(declaredRequests, s)?.updatedAt ?? 0;
    return scoped
      .filter((s) => {
        if (isArchived(s.id, prefs)) return false;
        if (!isOperatorDm(s) && !isChannelConversation(s)) return false;
        return Boolean(declaredRequestForSession(declaredRequests, s));
      })
      .sort((a, b) => requestUpdatedAt(b) - requestUpdatedAt(a));
  }, [scoped, prefs, declaredRequests]);

  const sections = useMemo(() => {
    const live = scoped.filter((s) => !isArchived(s.id, prefs));
    const archived = sortByRecency(scoped.filter((s) => isArchived(s.id, prefs)));

    // Pinned float above everything else (most recently pinned first).
    const pinned = live
      .filter((s) => isPinned(s.id, prefs))
      .sort((a, b) => pinRank(b.id, prefs) - pinRank(a.id, prefs) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    const unpinned = live.filter((s) => !isPinned(s.id, prefs));
    // Named #channels only: group_direct is a DM or observed room, not a channel.
    const channels = unpinned.filter(isChannelConversation);
    const dms = unpinned.filter(isOperatorDm);
    const observed = unpinned.filter(isObservedDirect);

    return {
      pinned,
      channels: sortByRecency(channels),
      dms: sortByRecency(dms),
      observed: sortByRecency(observed),
      archived,
    };
  }, [scoped, prefs]);

  /** Projects: your conversations under the project that moved last. */
  const projectGroups = useMemo<Array<ProjectGroup<SessionEntry>>>(() => {
    if (order !== "projects") return [];
    return orderProjectGroups(
      groupByProject(sections.dms, (s) =>
        projectLabelForSession(s, s.agentId ? agentById.get(s.agentId) : undefined)),
      OTHER_CHATS_LABEL,
    );
  }, [order, sections.dms, agentById]);

  /**
   * Recent: everything that moved, newest first. Channels and observed
   * traffic fold into the one list; membership is a property of a row, not a
   * reason to strand it in a section below.
   */
  const recentRows = useMemo(
    () => (order === "recent"
      ? sortByRecency([...sections.dms, ...sections.channels, ...sections.observed])
      : []),
    [order, sections.dms, sections.channels, sections.observed],
  );
  const railChannels = order === "projects" ? sections.channels : [];
  const railObserved = order === "projects" ? sections.observed : [];

  const activeRailId = activeId ?? activeThreadId;

  const shownProjects = useMemo(() => {
    if (showAllProjects || query || projectGroups.length <= PROJECTS_SHOWN) return projectGroups;
    const shown = projectGroups.slice(0, PROJECTS_SHOWN);
    const activeGroup = activeRailId
      ? projectGroups.find((group) => group.sessions.some((s) => s.id === activeRailId))
      : undefined;
    if (activeGroup && !shown.includes(activeGroup)) shown.push(activeGroup);
    return shown;
  }, [projectGroups, showAllProjects, query, activeRailId]);
  const hiddenProjectCount = projectGroups.length - shownProjects.length;

  const projectRows = useMemo(() => shownProjects.map((group) => ({
    group,
    collapsed: !query && collapsedProjects.has(group.label),
    ...visibleProjectRows(
      group.sessions,
      Boolean(query) || expandedProjects.has(group.label),
      activeRailId,
    ),
  })), [shownProjects, query, collapsedProjects, expandedProjects, activeRailId]);

  const observedShown = showAllObserved || query
    ? railObserved
    : railObserved.slice(0, OBSERVED_PREVIEW_LIMIT);
  const observedHidden = Math.max(0, railObserved.length - observedShown.length);
  // A query opens the collapsed Observed section so search reaches it.
  const observedExpanded = observedOpen || Boolean(query);

  const showContextMenu = useContextMenu();

  const onTogglePin = useCallback((id: string) => {
    setPrefs((prev) => togglePin(id, prev));
  }, []);

  const onToggleArchive = useCallback((id: string) => {
    setPrefs((prev) => toggleArchive(id, prev));
  }, []);

  const rename = useRenameState();
  // Conversations kept beside the stage, on every Comms page (comms-deck.ts).
  const beside = useBeside();

  const onSelect = useCallback((s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    navigate({
      view: "messages",
      conversationId: s.id,
      ...(machineId ? { machineId } : {}),
    });
  }, [navigate, machineId]);

  /**
   * A session row lands in the agent master view with the session raised as
   * a thread. The master screen folds threadId onto the master DM when they
   * coincide.
   */
  const onSelectSession = useCallback((s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    // A chat on another host opens by its id; its agent is not in this roster.
    if (s.agentId && !s.remoteMachineId) {
      navigate({
        view: "messages",
        agentId: s.agentId,
        threadId: s.id,
        ...(machineId ? { machineId } : {}),
      });
      return;
    }
    navigate({
      view: "messages",
      conversationId: s.id,
      ...(machineId ? { machineId } : {}),
    });
  }, [navigate, machineId]);

  const openConversationMenu = useCallback(
    (event: MouseEvent, s: SessionEntry) => {
      const pinned = isPinned(s.id, prefs);
      const archived = isArchived(s.id, prefs);
      const title = conversationDisplayTitle(s);
      const items: MenuItem[] = [
        {
          kind: "action",
          label: "Open",
          onSelect: () => onSelect(s),
        },
        ...(s.remoteMachineId ? [] : [{
          kind: "action" as const,
          label: beside.has(s.id) ? "Close beside the stage" : "Open beside the stage",
          onSelect: () => beside.toggle(s.id),
        }]),
        { kind: "separator" },
        {
          kind: "action",
          label: pinned ? "Unpin" : "Pin to top",
          onSelect: () => onTogglePin(s.id),
        },
        {
          kind: "action",
          label: archived ? "Unarchive" : "Archive",
          onSelect: () => onToggleArchive(s.id),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Rename…",
          onSelect: () => rename.begin(s.id),
        },
        {
          kind: "action",
          label: "Copy name",
          onSelect: () => {
            void navigator.clipboard?.writeText(title).catch(() => {});
          },
        },
      ];
      showContextMenu(event, items);
    },
    [prefs, onSelect, onTogglePin, onToggleArchive, showContextMenu, rename, beside],
  );

  const toggleSetMember = (setter: typeof setExpandedProjects, key: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apiOffline =
    apiConnection.status === "offline" || isOfflineApiError(loadError);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onListKeyDown = useListArrowNav();
  const onSearchKeyDown = makeSearchHandoff(() => listRef.current);
  useSlashToFocus(useCallback(() => inputRef.current, []));

  const archivedCount = sections.archived.length;
  // Waiting on you rows are mirrors of rows counted below; never counted twice.
  const totalVisible = sections.pinned.length
    + (order === "projects" ? sections.dms.length : recentRows.length)
    + railChannels.length
    + railObserved.length
    + archivedCount;

  const railRows = useMemo(() => {
    const out: Array<{ rowId: string; id: string }> = [];
    for (const s of needsYou) out.push({ rowId: `ny-${s.id}`, id: s.id });
    for (const s of sections.pinned) out.push({ rowId: `pin-${s.id}`, id: s.id });
    for (const project of projectRows) {
      if (project.collapsed) continue;
      for (const s of project.shown) out.push({ rowId: s.id, id: s.id });
    }
    for (const s of recentRows) out.push({ rowId: s.id, id: s.id });
    for (const s of railChannels) out.push({ rowId: s.id, id: s.id });
    if (observedExpanded) for (const s of observedShown) out.push({ rowId: s.id, id: s.id });
    if (showArchived) for (const s of sections.archived) out.push({ rowId: `arch-${s.id}`, id: s.id });
    return out;
  }, [needsYou, sections, projectRows, recentRows, railChannels, observedExpanded, observedShown, showArchived]);

  const nav: RailNav = useMemo(() => ({
    activeId: activeRailId,
    activeRowId: activeRailId ? railRows.find((r) => r.id === activeRailId)?.rowId : undefined,
    firstRowId: railRows[0]?.rowId,
  }), [activeRailId, railRows]);

  const row = (
    s: SessionEntry,
    options: {
      rowId?: string;
      select?: (s: SessionEntry) => void;
      taskTitled?: boolean;
      requestTitled?: boolean;
      observed?: boolean;
    } = {},
  ) => (
    <ChatRow
      key={options.rowId ?? s.id}
      rowId={options.rowId ?? s.id}
      session={s}
      nav={nav}
      agentById={agentById}
      asksByAgent={asksByAgent}
      taskTitled={options.taskTitled}
      requestTitled={options.requestTitled}
      observed={options.observed ?? isObservedDirect(s)}
      onSelect={options.select ?? onSelect}
      onContextMenu={openConversationMenu}
    />
  );

  return (
    <RenameContext.Provider value={rename}>
    <DeclaredRequestsContext.Provider value={declaredRequests}>
    <div className="ctx-panel chat-list">
      <div className="chat-list-controls">
        <div className="chat-list-segmented" role="radiogroup" aria-label="Order chats by">
          {(["projects", "recent"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={order === candidate}
              data-on={order === candidate || undefined}
              title={candidate === "projects"
                ? "Group chats under the project that moved last"
                : "Every chat, newest first"}
              onClick={() => setOrder(candidate)}
            >
              {candidate === "projects" ? "Projects" : "Recent"}
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          type="text"
          className="chat-list-filter"
          placeholder="Filter"
          aria-label="Filter chats (/)"
          title="Filter chats (/)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <div
        ref={listRef}
        className={[
          "ctx-panel-list",
          "ctx-panel-list--scroll",
          "chat-list-body",
          totalVisible === 0 && "ctx-panel-list--empty",
        ]
          .filter(Boolean)
          .join(" ")}
        onKeyDown={onListKeyDown}
      >
        {totalVisible === 0 ? (
          <ChatRailEmptyState
            query={query}
            loading={loading}
            error={loadError}
            apiOffline={apiOffline}
            onRetry={() => {
              void reload(true);
            }}
          />
        ) : (
          <>
            {needsYou.length > 0 && (
              <ChatSection label="Waiting on you" chip={needsYou.length}>
                {/* Mirrors: the origin row keeps its place below, so nothing
                    reflows under the cursor when a request resolves. */}
                {needsYou.map((s) => row(s, { rowId: `ny-${s.id}`, requestTitled: true }))}
              </ChatSection>
            )}

            {sections.pinned.length > 0 && (
              <ChatSection label="Pinned">
                {sections.pinned.map((s) => row(s, { rowId: `pin-${s.id}` }))}
              </ChatSection>
            )}

            {projectRows.map(({ group, collapsed, shown, hidden }) => (
              <ProjectBlock
                key={group.label}
                group={group}
                collapsed={collapsed}
                expanded={expandedProjects.has(group.label)}
                hidden={hidden}
                asksByAgent={asksByAgent}
                onToggleCollapsed={() => toggleSetMember(setCollapsedProjects, group.label)}
                onToggleExpanded={() => toggleSetMember(setExpandedProjects, group.label)}
              >
                {shown.map((s) => row(s, { select: onSelectSession, taskTitled: true }))}
              </ProjectBlock>
            ))}

            {order === "projects" && (hiddenProjectCount > 0 || showAllProjects) && !query ? (
              <button
                type="button"
                className="chat-list-more chat-list-more--projects"
                onClick={() => setShowAllProjects((value) => !value)}
              >
                {showAllProjects
                  ? "Fewer projects"
                  : `${hiddenProjectCount} more ${hiddenProjectCount === 1 ? "project" : "projects"}`}
              </button>
            ) : null}

            {recentRows.length > 0 && (
              <section className="chat-list-section chat-list-section--flat" aria-label="Recent">
                {recentRows.map((s) => row(s, { select: onSelectSession, taskTitled: !isChannelConversation(s) }))}
              </section>
            )}

            {railChannels.length > 0 && (
              <ChatSection label="Channels">
                {railChannels.map((s) => row(s))}
              </ChatSection>
            )}

            {railObserved.length > 0 && (
              <ChatSection
                label="Observed"
                hint="Agent conversations you are not in"
                open={observedExpanded}
                onToggle={() => setObservedOpen((v) => !v)}
              >
                {observedShown.map((s) => row(s, { select: onSelectSession, taskTitled: true, observed: true }))}
                {observedHidden > 0 ? (
                  <button
                    type="button"
                    className="chat-list-more"
                    onClick={() => setShowAllObserved(true)}
                  >
                    {observedHidden} more
                  </button>
                ) : null}
              </ChatSection>
            )}

            {archivedCount > 0 && (
              <ChatSection
                label="Archived"
                hint="Hidden from the list"
                open={showArchived}
                onToggle={() => setShowArchived((v) => !v)}
              >
                {sections.archived.map((s) => row(s, { rowId: `arch-${s.id}` }))}
              </ChatSection>
            )}
          </>
        )}
      </div>
    </div>
    </DeclaredRequestsContext.Provider>
    </RenameContext.Provider>
  );
}

/**
 * Inline rename, shared with the rows without threading a prop through every
 * call site.
 *
 * `renamed` is the optimistic overlay: the row shows the new name the instant
 * you press Enter and keeps showing it until the forced list reload lands, so
 * a rename never flashes back to the old title while the runtime catches up.
 */
type RenameState = {
  editingId: string | null;
  renamed: Record<string, string>;
  begin: (id: string) => void;
  commit: (id: string, title: string) => void;
  cancel: () => void;
};

const RenameContext = createContext<RenameState | null>(null);
const DeclaredRequestsContext = createContext<DeclaredRequestIndex>(EMPTY_DECLARED_REQUEST_INDEX);

function useRenameState(): RenameState {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renamed, setRenamed] = useState<Record<string, string>>({});

  const commit = useCallback((id: string, title: string) => {
    setEditingId(null);
    const next = title.trim();
    setRenamed((prev) => ({ ...prev, [id]: next }));
    void api(`/api/conversations/${encodeURIComponent(id)}/title`, {
      method: "POST",
      body: JSON.stringify({ title: next }),
    })
      .then(() => loadConversationList({ force: true }))
      /* Drop the overlay either way: on success the list now carries the real
         name, and on failure the row must show what the runtime actually has
         rather than a name that only ever existed in this tab. */
      .catch(() => {})
      .then(() => {
        setRenamed((prev) => {
          const { [id]: _dropped, ...rest } = prev;
          return rest;
        });
      });
  }, []);

  return {
    editingId,
    renamed,
    begin: useCallback((id: string) => setEditingId(id), []),
    commit,
    cancel: useCallback(() => setEditingId(null), []),
  };
}

/** A quiet section head: the label, and an amber chip when the count is yours to act on. */
function ChatSection({
  label,
  chip,
  hint,
  open,
  onToggle,
  children,
}: {
  label: string;
  /** Rows waiting on the operator. Inventory counts are not shown. */
  chip?: number;
  hint?: string;
  /** Collapsible sections pass both `open` and `onToggle`. */
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const head = (
    <>
      <span className="chat-list-section-label">{label}</span>
      {chip ? <span className="chat-list-chip">{chip}</span> : null}
    </>
  );
  if (onToggle) {
    return (
      <section className="chat-list-section" aria-label={label}>
        <button
          type="button"
          className="chat-list-section-head"
          title={hint}
          aria-expanded={Boolean(open)}
          data-open={open || undefined}
          onClick={onToggle}
        >
          {head}
          <Chevron open={Boolean(open)} />
        </button>
        {open ? children : null}
      </section>
    );
  }
  return (
    <section className="chat-list-section" aria-label={label}>
      <div className="chat-list-section-head" title={hint}>{head}</div>
      {children}
    </section>
  );
}

/**
 * One project: a folder head with the project's live state at the right edge
 * (a spinner with the working count, an amber chip for rows waiting on you),
 * then its rows and a "more" row.
 */
function ProjectBlock({
  group,
  collapsed,
  expanded,
  hidden,
  asksByAgent,
  onToggleCollapsed,
  onToggleExpanded,
  children,
}: {
  group: ProjectGroup<SessionEntry>;
  collapsed: boolean;
  expanded: boolean;
  hidden: number;
  asksByAgent: FleetActiveAskIndex;
  onToggleCollapsed: () => void;
  onToggleExpanded: () => void;
  children: ReactNode;
}) {
  const declaredRequests = useContext(DeclaredRequestsContext);
  let working = 0;
  let waiting = 0;
  for (const s of group.sessions) {
    const ask = fleetAskForSession(asksByAgent, s);
    if (ask?.status === "working" || ask?.status === "queued") working += 1;
    if (declaredRequestForSession(declaredRequests, s) || ask?.status === "needs_attention") waiting += 1;
  }
  return (
    <section className="chat-list-section chat-list-project" aria-label={group.label}>
      <button
        type="button"
        className="chat-list-project-head"
        aria-expanded={!collapsed}
        title={collapsed ? `Show ${group.label}` : `Fold ${group.label}`}
        onClick={onToggleCollapsed}
      >
        <span className="chat-list-folder" aria-hidden>
          <Folder size={13} strokeWidth={1.2} />
        </span>
        <span className="chat-list-project-name">{group.label}</span>
        <span className="chat-list-edge">
          {working > 0 ? (
            <span className="chat-list-working" title={`${working} working`}>
              <Spinner />
              {working > 1 ? working : null}
            </span>
          ) : null}
          {waiting > 0 ? (
            <span className="chat-list-chip" title={`${waiting} waiting on you`}>{waiting}</span>
          ) : null}
          {collapsed ? <Chevron open={false} /> : null}
        </span>
      </button>
      {collapsed ? null : (
        <>
          {children}
          {hidden > 0 || expanded ? (
            <button type="button" className="chat-list-more" onClick={onToggleExpanded}>
              {expanded ? "Fewer" : `${hidden} more`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * One conversation on one line. The leading mark is the harness, or # for a
 * channel; it takes the harness colour while the row is open or waiting on
 * you. The right edge holds the row's state: a spinner while it works, an
 * amber dot while it waits on you, otherwise its age.
 */
function ChatRow({
  session: s,
  rowId,
  nav,
  agentById,
  asksByAgent,
  taskTitled,
  requestTitled,
  observed,
  onSelect,
  onContextMenu,
}: {
  session: SessionEntry;
  /** Unique per RENDERED row: Waiting on you mirrors reuse the conversation. */
  rowId: string;
  nav: RailNav;
  agentById: Map<string, Agent>;
  asksByAgent: FleetActiveAskIndex;
  /** Lead with the task (title, then preview, then branch), not the agent name. */
  taskTitled?: boolean;
  /** Lead with what the agent asked: the Waiting on you mirrors. */
  requestTitled?: boolean;
  /** Observed rows have no unread or waiting state. */
  observed?: boolean;
  onSelect: (s: SessionEntry) => void;
  onContextMenu: (event: MouseEvent, s: SessionEntry) => void;
}) {
  const rename = useContext(RenameContext);
  const declared = declaredRequestForSession(useContext(DeclaredRequestsContext), s);
  const agent = s.agentId ? agentById.get(s.agentId) : undefined;
  const ask = fleetAskForSession(asksByAgent, s);
  const channel = isChannelConversation(s);
  const current = s.id === nav.activeId;
  const working = ask?.status === "working" || ask?.status === "queued";
  const waiting = !observed && (Boolean(declared) || ask?.status === "needs_attention");
  const baseTitle = requestTitled && declared
    ? declaredRequestSubtitle(declared)
    : taskTitled ? taskThreadTitle(s) : conversationDisplayTitle(s);
  const title = rename?.renamed[s.id] ?? (plainListTitle(baseTitle) || conversationDisplayTitle(s));
  const harness = s.harness ?? agent?.harness ?? null;
  const tint = current || waiting ? harnessTint(harness) : null;
  const age = shortAge(declared?.updatedAt ?? ask?.updatedAt ?? s.lastMessageAt, Date.now());
  const who = agent?.name ?? s.agentName;
  const tooltip = [
    title,
    who && who.toLowerCase() !== title.toLowerCase() ? who : null,
    s.remoteMachineName ? `On ${s.remoteMachineName}` : null,
    observed ? "Observed: you are not in this conversation" : null,
    declared ? `${declaredRequestLabel(declared)} waiting on you` : null,
    working ? "Working" : null,
  ].filter(Boolean).join("\n");

  const leading = channel
    ? <span className="chat-row-mark chat-row-mark--hash" aria-hidden>#</span>
    : (
      <span className="chat-row-mark" style={tint ? { color: tint } : undefined} aria-hidden>
        <HarnessMark harness={harness} size={11} title={null} />
      </span>
    );

  if (rename?.editingId === s.id) {
    return (
      <div className="chat-row" data-current={current || undefined} data-editing>
        {leading}
        <RowNameField
          value={title}
          onCommit={(next: string) => rename.commit(s.id, next)}
          onCancel={rename.cancel}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="chat-row"
      data-list-primary
      data-current={current || undefined}
      data-lit={current || working || waiting || undefined}
      data-waiting={waiting || undefined}
      data-observed={observed || undefined}
      aria-current={current ? "page" : undefined}
      title={tooltip}
      tabIndex={rovingTabIndex(
        rowId === nav.activeRowId,
        nav.activeRowId !== undefined,
        rowId === nav.firstRowId,
      )}
      onClick={() => onSelect(s)}
      onContextMenu={(event) => onContextMenu(event, s)}
    >
      {leading}
      <span className="chat-row-title">{title}</span>
      {s.remoteMachineName ? <span className="chat-row-host">{s.remoteMachineName}</span> : null}
      <span className="chat-list-edge">
        {working ? (
          <Spinner />
        ) : waiting ? (
          <span className="chat-row-wait" aria-label="Waiting on you" />
        ) : age ? (
          <span className="chat-row-age">{age}</span>
        ) : null}
      </span>
    </button>
  );
}

function Spinner() {
  return <Loader2 size={10} strokeWidth={1.6} className="chat-list-spinner" aria-label="Working" />;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="chat-list-chevron" data-open={open || undefined} width="9" height="9" viewBox="0 0 10 10" aria-hidden>
      <path d="M3.5 2 6.5 5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatRailEmptyState({
  query,
  loading,
  error,
  apiOffline,
  onRetry,
}: {
  query: string;
  loading: boolean;
  error: string | null;
  apiOffline: boolean;
  onRetry: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const title = loading
    ? "Loading conversations"
    : apiOffline
      ? "Scout server offline"
      : error
        ? "Couldn't load conversations"
        : hasQuery
          ? "No matching conversations"
          : "No conversations yet";
  const detail = loading
    ? "Checking the runtime for your conversations, channels, and observed threads."
    : apiOffline
      ? "Start or restart Scout services, then retry."
      : error
        ? error
        : hasQuery
          ? "Try a shorter filter."
          : "Your conversations, channels, and observed agent threads will show here.";

  return (
    <div className="ctx-panel-empty-card" data-tone={apiOffline || error ? "error" : "neutral"}>
      <div className="ctx-panel-empty-card-title">{title}</div>
      <div className="ctx-panel-empty-card-detail">{detail}</div>
      {(apiOffline || error) && (
        <button
          type="button"
          className="ctx-panel-empty-card-action"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function matchesQuery(s: SessionEntry, query: string): boolean {
  const q = query.toLowerCase();
  return conversationDisplayTitle(s).toLowerCase().includes(q)
    || s.id.toLowerCase().includes(q)
    || (s.preview ?? "").toLowerCase().includes(q)
    || (s.agentName ?? "").toLowerCase().includes(q);
}

/**
 * What the agent asked, in its own words. The kind of request (Ask, Approval)
 * goes in the tooltip; saying it in the title as well read "Approval ·
 * Permission request".
 */
function declaredRequestSubtitle(item: OperatorAttentionItem): string {
  return trimPreview(item.title) ?? declaredRequestLabel(item);
}

function sortByRecency(list: SessionEntry[]): SessionEntry[] {
  return [...list].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
}

function trimPreview(preview: string | null): string | null {
  if (!preview) return null;
  const collapsed = conversationalMessagePreview(preview).replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}…` : collapsed;
}
