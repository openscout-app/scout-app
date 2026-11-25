import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  useMeshViewStore,
  toggleMachineVisibility,
  clearMachinePosition,
  setMeshQuery,
  toggleAgentStateFilter,
  toggleTreeFullMachine,
  setMeshSelection,
  requestScrollToMachine,
  soloMachine,
  showAllMachines,
  type AgentStateToken,
} from "../../lib/mesh-view-store.ts";
import { arrangeGroup, hostGroup, moveInGroup, pinHost, unpinHost, type HostLayout } from "../../lib/host-order.ts";
import { useHostLayout } from "../../lib/host-layout.ts";
import { hostReading } from "../../lib/network-reading.ts";
import { useScout } from "../../scout/Provider.tsx";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { bucketAgentsByMachine, type MachineBucket } from "../../lib/mesh-buckets.ts";
import { hasFleetActiveAskForAgent, type FleetActiveAskIndex } from "../../lib/fleet-active-asks.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import { NodeMenu, nodeMenuRowProps, type NodeMenuHandle } from "./NodeMenu.tsx";
import { buildNodeMenuActions } from "./node-actions.ts";
import { machineContentsNote, machineOpenRows, machineRowMeta } from "./machine-children.ts";
import { loadMeshNodeState, refreshMeshNodeState } from "../../lib/mesh-node-state.ts";
import { useMeshNodeState } from "../../lib/use-mesh-node-state.ts";
import { FleetSearch } from "../../scout/slots/FleetSearch.tsx";
import { FleetFilterPills } from "../../scout/slots/FleetFilterPills.tsx";
import { openAgent } from "../../scout/slots/openAgent.ts";
import type { Agent, Route } from "../../lib/types.ts";
import "../../scout/slots/ctx-panel.css";
import "../../scout/slots/mesh-nav-panel.css";

const COMPACT_LIMIT = 10;

function tokenForAgent(a: Agent): AgentStateToken {
  return normalizeAgentState(a.state);
}

/**
 * One machine in the rail.
 *
 * Every machine gets the same menu — this broker, a mesh peer, a tailnet-only
 * device — reachable by right-click, by the ⋯ button, and by Shift+F10 from
 * the keyboard. The counts come from what that node reported about itself when
 * it has reported anything, and fall back to the agents we can place on it,
 * never to a made-up zero.
 */
function MachineNode({
  bucket,
  active,
  hidden,
  anyHidden,
  positioned,
  full,
  expanded,
  pinned,
  lifted,
  drop,
  selectedId,
  selectedType,
  activeAsks,
  onSelect,
  onFocus,
  onSelectAgent,
  onToggleFull,
  onToggleExpanded,
  onDragStart,
  onMoveKey,
  onPin,
}: {
  bucket: MachineBucket;
  active: boolean;
  hidden: boolean;
  anyHidden: boolean;
  positioned: boolean;
  full: boolean;
  expanded: boolean;
  pinned: boolean;
  lifted: boolean;
  drop: boolean;
  selectedId: string | null;
  selectedType: string | null;
  activeAsks: FleetActiveAskIndex;
  /** Show this machine's state in the inspector. */
  onSelect: (machineId: string) => void;
  /** Show only this machine on the map. */
  onFocus: (machineId: string) => void;
  onSelectAgent: (agent: Agent) => void;
  onToggleFull: (machineId: string) => void;
  onToggleExpanded: (machineId: string) => void;
  onDragStart: (machineId: string, event: ReactPointerEvent) => void;
  onMoveKey: (machineId: string, delta: -1 | 1) => void;
  onPin: (machineId: string) => void;
}) {
  const menu = useRef<NodeMenuHandle | null>(null);
  const entry = useMeshNodeState(bucket.machineId);
  const view = entry?.view ?? null;

  const actions = buildNodeMenuActions({
    machineId: bucket.machineId,
    machineLabel: bucket.machineLabel,
    nodeId: bucket.node?.nodeId ?? null,
    brokerUrl: bucket.node?.brokerUrl ?? view?.node?.brokerUrl ?? null,
    hidden,
    anyHidden,
    positioned,
    canCopy: typeof navigator !== "undefined" && Boolean(navigator.clipboard),
    checking: entry?.loading ?? false,
    pinned,
    on: {
      select: (id) => onSelect(id),
      pin: (id) => onPin(id),
      refresh: (id) => void refreshMeshNodeState(id),
      focus: (id) => onFocus(id),
      toggleHidden: (id) => toggleMachineVisibility(id),
      showAll: () => showAllMachines(),
      clearPosition: (id) => clearMachinePosition(id),
      copy: (text) => void navigator.clipboard?.writeText(text),
    },
  });

  const opened = machineOpenRows(bucket, view);
  const children = opened.rows;
  const visible = full ? children : children.slice(0, COMPACT_LIMIT);
  const overflow = children.length - visible.length;
  const limitNote = opened.limitNote;
  const reading = hostReading(bucket, view, entry?.loading ?? false);
  const meta = machineRowMeta(bucket, view, entry?.loading ?? false);
  const readingLine = [
    pinned ? "pinned" : null,
    bucket.reachability === "this" ? "this host" : null,
    meta,
  ].filter(Boolean).join(" · ");
  const waiting = expanded && children.length === 0;

  return (
    <div
      className={[
        "mesh-nav-machine",
        hidden && "mesh-nav-machine--hidden",
        lifted && "is-lifted",
        drop && "is-drop",
        opened.kind === "runs" && "mesh-nav-machine--runs",
      ].filter(Boolean).join(" ")}
      {...nodeMenuRowProps(menu)}
    >
      <div className={`mesh-host-row${active ? " mesh-host-row--active" : ""}`}>
        <button
          type="button"
          className="mesh-host-grip"
          aria-label={`Move ${bucket.machineLabel}`}
          title="Drag to move. Up and down to move one place."
          onPointerDown={(event) => onDragStart(bucket.machineId, event)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            onMoveKey(bucket.machineId, event.key === "ArrowUp" ? -1 : 1);
          }}
        >
          ⠿
        </button>
        <button
          type="button"
          className="mesh-host-fold"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${bucket.machineLabel}`}
          onClick={() => onToggleExpanded(bucket.machineId)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <button
          type="button"
          className="mesh-host-select"
          aria-pressed={active}
          onClick={() => onSelect(bucket.machineId)}
          onPointerDown={(event) => onDragStart(bucket.machineId, event)}
          onPointerEnter={() => { if (!entry) void loadMeshNodeState(bucket.machineId, { deep: false }); }}
          title={`${bucket.machineLabel}. ${readingLine}. Active ${reading.activeLabel}. With us ${reading.contactLabel}. ${reading.pingLabel}.`}
        >
          <span className="mesh-host-name">{bucket.machineLabel}</span>
          <span className="mesh-host-reading">{readingLine}</span>
        </button>
        <NodeMenu
          ref={menu}
          machineLabel={bucket.machineLabel}
          actions={actions}
          className="mesh-nav-menu-btn"
        />
      </div>
      {waiting && (
        <RailRow
          name={machineContentsNote(
            bucket.kind,
            view != null,
            entry?.loading ?? false,
            view == null && Boolean(entry?.error),
          )}
          depth={1}
          tone="neutral"
        />
      )}
      {expanded && visible.map((child) => (
        <RailRow
          key={child.key}
          name={child.name}
          meta={child.meta}
          tone={child.tone}
          depth={1}
          active={selectedId === child.selectId && selectedType === "agent"}
          unread={child.agent ? hasFleetActiveAskForAgent(activeAsks, child.agent.id) : false}
          onClick={child.agent ? () => onSelectAgent(child.agent!) : undefined}
          title={child.title}
        />
      ))}
      {expanded && !full && overflow > 0 && (
        <RailRow
          name={`see ${overflow} more`}
          depth={1}
          tone="neutral"
          onClick={() => onToggleFull(bucket.machineId)}
          title="Show the rest of this list"
        />
      )}
      {expanded && full && children.length > COMPACT_LIMIT && (
        <RailRow
          name="see less"
          depth={1}
          tone="neutral"
          onClick={() => onToggleFull(bucket.machineId)}
          title={opened.kind === "runs" ? "Show the first of these" : "Show recent agents only"}
        />
      )}
      {expanded && limitNote && (
        <RailRow name={limitNote} depth={1} tone="neutral" />
      )}
    </div>
  );
}

function dropIndex(container: HTMLElement, clientY: number): number {
  const rows = [...container.querySelectorAll<HTMLElement>(":scope > .mesh-nav-machine")];
  for (let index = 0; index < rows.length; index++) {
    const box = rows[index]!.getBoundingClientRect();
    if (clientY < box.top + box.height / 2) return index;
  }
  return rows.length;
}

function HostGroup({
  label,
  items,
  layout,
  onLayout,
  selectedId,
  selectedType,
  hiddenMachineIds,
  hiddenCount,
  machinePositions,
  treeFullMachineIds,
  expandedIds,
  activeAsks,
  onSelect,
  onFocus,
  onSelectAgent,
  onToggleFull,
  onToggleExpanded,
}: {
  label: string;
  items: MachineBucket[];
  layout: HostLayout;
  onLayout: (next: HostLayout) => void;
  selectedId: string | null;
  selectedType: string | null;
  hiddenMachineIds: ReadonlySet<string>;
  hiddenCount: number;
  machinePositions: Readonly<Record<string, { x: number; y: number }>>;
  treeFullMachineIds: ReadonlySet<string>;
  expandedIds: ReadonlySet<string>;
  activeAsks: FleetActiveAskIndex;
  onSelect: (machineId: string) => void;
  onFocus: (machineId: string) => void;
  onSelectAgent: (agent: Agent) => void;
  onToggleFull: (machineId: string) => void;
  onToggleExpanded: (machineId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; y: number; moved: boolean } | null>(null);
  const listeners = useRef<{ move: (event: PointerEvent) => void; up: (event: PointerEvent) => void } | null>(null);
  const [lift, setLift] = useState<{ id: string; over: number } | null>(null);
  const ids = items.map((item) => item.machineId);
  const ordered = arrangeGroup(ids, layout);
  const byId = new Map(items.map((item) => [item.machineId, item]));
  const rows = ordered.map((id) => byId.get(id)).filter((item): item is MachineBucket => Boolean(item));

  useEffect(() => () => {
    const current = listeners.current;
    if (!current) return;
    window.removeEventListener("pointermove", current.move);
    window.removeEventListener("pointerup", current.up);
  }, []);

  const start = (id: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { id, y: event.clientY, moved: false };
    const move = (ev: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      if (!current.moved && Math.abs(ev.clientY - current.y) < 4) return;
      current.moved = true;
      const list = listRef.current;
      if (!list) return;
      setLift({ id: current.id, over: dropIndex(list, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      const current = drag.current;
      drag.current = null;
      listeners.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLift(null);
      if (!current?.moved) return;
      const list = listRef.current;
      onLayout(moveInGroup(layout, ids, current.id, list ? dropIndex(list, ev.clientY) : 0));
      const stop = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", stop, { capture: true, once: true });
    };
    listeners.current = { move, up };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section className="mesh-nav-group">
      <div className="mesh-nav-group-label">{label}</div>
      <div ref={listRef}>
        {rows.map((bucket) => (
          <MachineNode
            key={bucket.machineId}
            bucket={bucket}
            active={selectedId === bucket.machineId && selectedType === "node"}
            hidden={hiddenMachineIds.has(bucket.machineId)}
            anyHidden={hiddenCount > 0}
            positioned={bucket.machineId in machinePositions}
            full={treeFullMachineIds.has(bucket.machineId)}
            expanded={expandedIds.has(bucket.machineId)}
            pinned={layout.pinned.includes(bucket.machineId)}
            lifted={lift?.id === bucket.machineId}
            drop={lift != null && lift.id !== bucket.machineId && lift.over === ordered.indexOf(bucket.machineId)}
            selectedId={selectedId}
            selectedType={selectedType}
            activeAsks={activeAsks}
            onSelect={onSelect}
            onFocus={onFocus}
            onSelectAgent={onSelectAgent}
            onToggleFull={onToggleFull}
            onToggleExpanded={onToggleExpanded}
            onDragStart={start}
            onMoveKey={(id, delta) => {
              const index = ordered.indexOf(id);
              if (index < 0) return;
              onLayout(moveInGroup(layout, ids, id, index + delta));
            }}
            onPin={(id) => onLayout(layout.pinned.includes(id) ? unpinHost(layout, id) : pinHost(layout, id))}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The Network rail: search, state pills, and every machine with its agents.
 * `returnTo` is where an opened agent's Back goes: the Network page unless a
 * Hosts panel on another view says its own.
 */
export function MeshLeft({ returnTo = { view: "mesh" } }: { returnTo?: Route } = {}) {
  const { agents, navigate } = useScout();
  const {
    meshSnapshot,
    selectedId,
    selectedType,
    query,
    agentStateFilters,
    hiddenMachineIds,
    treeFullMachineIds,
    machinePositions,
  } = useMeshViewStore();
  const activeAsks = useFleetActiveAsks();
  const [hostLayout, setHostLayout] = useHostLayout();
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [findOpen, setFindOpen] = useState(false);
  const revealed = useRef<string | null>(null);

  const buckets = useMemo<MachineBucket[]>(
    () => (meshSnapshot ? bucketAgentsByMachine(agents, meshSnapshot) : []),
    [agents, meshSnapshot],
  );

  const filteredBuckets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return buckets.map((b) => {
      const agentsHere = b.agents.filter((a) => {
        if (!agentStateFilters.has(tokenForAgent(a))) return false;
        if (!needle) return true;
        const hay = `${a.name ?? ""} ${a.project ?? ""} ${a.branch ?? ""} ${a.harness ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
      const nameHit = !needle || b.machineLabel.toLowerCase().includes(needle);
      if (!nameHit && agentsHere.length === 0) return null;
      return { ...b, agents: agentsHere };
    }).filter((b): b is MachineBucket => b !== null);
  }, [buckets, query, agentStateFilters]);

  const groups = useMemo(() => {
    const map = new Map<"lan" | "tailnet", MachineBucket[]>([
      ["lan", []],
      ["tailnet", []],
    ]);
    for (const b of filteredBuckets) map.get(hostGroup(b.reachability))?.push(b);
    return map;
  }, [filteredBuckets]);

  // A pick from the map or the rack opens the same machine here. Collapsing
  // the caret stays collapsed until the pick changes or the row is chosen again.
  useEffect(() => {
    if (selectedType !== "node" || !selectedId) return;
    if (revealed.current === selectedId) return;
    revealed.current = selectedId;
    setExpandedIds((current) => {
      if (current.has(selectedId)) return current;
      const next = new Set(current);
      next.add(selectedId);
      return next;
    });
    void loadMeshNodeState(selectedId, { deep: true });
  }, [selectedId, selectedType]);

  if (!meshSnapshot) {
    return (
      <div className="ctx-panel ctx-panel--empty">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Loading mesh…</div>
        </div>
      </div>
    );
  }

  // Clicking a machine opens what is running on it. Narrowing the map to it
  // alone is a separate action, so that is not a side effect of the click.
  const selectMachine = (id: string) => {
    revealed.current = id;
    setExpandedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    void loadMeshNodeState(id, { deep: true });
    setMeshSelection(id, "node");
    requestScrollToMachine(id);
  };

  const focusMachine = (id: string) => {
    soloMachine(id, buckets.map((b) => b.machineId));
    setMeshSelection(id, "node");
    requestScrollToMachine(id);
  };

  const hiddenCount = hiddenMachineIds.size;
  const totalMachines = buckets.length;

  const selectAgent = (a: Agent) => {
    setMeshSelection(a.id, "agent");
    const machineId = a.authorityNodeId ?? a.homeNodeId;
    if (machineId) requestScrollToMachine(machineId);
    openAgent(navigate, a, { from: "mesh-tree", returnTo });
  };

  const toggleExpanded = (machineId: string) => {
    const opening = !expandedIds.has(machineId);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(machineId)) next.delete(machineId);
      else next.add(machineId);
      return next;
    });
    if (opening) void loadMeshNodeState(machineId, { deep: true });
  };

  const renderGroup = (label: string, group: "lan" | "tailnet", items: MachineBucket[]) => {
    if (items.length === 0) return null;
    return (
      <HostGroup
        key={group}
        label={label}
        items={items}
        layout={hostLayout}
        onLayout={setHostLayout}
        selectedId={selectedId}
        selectedType={selectedType}
        hiddenMachineIds={hiddenMachineIds}
        hiddenCount={hiddenCount}
        machinePositions={machinePositions}
        treeFullMachineIds={treeFullMachineIds}
        expandedIds={expandedIds}
        activeAsks={activeAsks}
        onSelect={selectMachine}
        onFocus={focusMachine}
        onSelectAgent={selectAgent}
        onToggleFull={toggleTreeFullMachine}
        onToggleExpanded={toggleExpanded}
      />
    );
  };

  const findActive = query.trim().length > 0 || agentStateFilters.size < 5;

  return (
    <div className="ctx-panel mesh-nav">
      <div className="mesh-nav-head">
        <button
          type="button"
          className={`mesh-nav-find${findActive ? " mesh-nav-find--on" : ""}`}
          aria-expanded={findOpen || findActive}
          onClick={() => setFindOpen((open) => !open)}
        >
          {findOpen || findActive ? "Hide find" : "Find"}
        </button>
        {(findOpen || findActive) && (
          <>
            <FleetSearch
              value={query}
              onChange={setMeshQuery}
              placeholder="Find machines or agents…"
            />
            <FleetFilterPills active={agentStateFilters} onToggle={toggleAgentStateFilter} />
          </>
        )}
        {hiddenCount > 0 && hiddenCount < totalMachines && (
          <button
            type="button"
            className="mesh-nav-focus-chip"
            onClick={showAllMachines}
            title="Show all machines"
          >
            <span className="mesh-nav-focus-chip-label">
              focused · {totalMachines - hiddenCount}/{totalMachines}
            </span>
            <span className="mesh-nav-focus-chip-clear" aria-hidden>×</span>
          </button>
        )}
      </div>

      <div className="mesh-nav-tree">
        {renderGroup("LAN", "lan", groups.get("lan") ?? [])}
        {renderGroup("Tailnet", "tailnet", groups.get("tailnet") ?? [])}
      </div>

    </div>
  );
}
