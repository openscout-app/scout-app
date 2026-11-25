import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMeshViewStore,
  setMeshSelection,
  requestScrollToMachine,
  clearAllMachinePositions,
} from "../../lib/mesh-view-store.ts";
import { hostReading } from "../../lib/network-reading.ts";
import { loadMeshNodeState, refreshMeshNodeState } from "../../lib/mesh-node-state.ts";
import { arrangeGroup, hostGroup } from "../../lib/host-order.ts";
import { useHostLayout } from "../../lib/host-layout.ts";
import { useScout } from "../Provider.tsx";
import { type MachineBucket } from "../../lib/mesh-buckets.ts";
import { isAgentBusy } from "../../lib/agent-state.ts";
import { useMeshNodeStates } from "../../lib/use-mesh-node-state.ts";
import { canvasMachineBuckets, machineContentsNote, machineOpenRows, machineRowMeta } from "../../screens/mesh/machine-children.ts";
import { openAgent } from "./openAgent.ts";
import { stateColor } from "../../lib/colors.ts";
import "./mesh-rail-rack.css";

const CONTENTS_LIMIT = 10;

type Mode = "rack" | "map";

export function MeshCanvasMinimap() {
  const [mode, setMode] = useState<Mode>("rack");
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const revealed = useRef<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [hostLayout] = useHostLayout();
  const { agents } = useScout();
  const {
    meshSnapshot,
    selectedId,
    selectedType,
    hiddenMachineIds,
    machinePositions,
  } = useMeshViewStore();

  const buckets = useMemo<MachineBucket[]>(
    () => (meshSnapshot ? canvasMachineBuckets(agents, meshSnapshot) : []),
    [agents, meshSnapshot],
  );
  const ready = Boolean(meshSnapshot) && buckets.length > 0;

  // The same pick that opens a machine in the Hosts list opens it here, so
  // the rack shows what is running once the panel has room.
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

  // The panel title sits outside this rail. Clicking it opens and closes the
  // rack, which is the control the minimized bar's own Open button repeats.
  // Dragging the seam gives the panel room, and that opens it too.
  useEffect(() => {
    if (!ready) return;
    const rail = railRef.current;
    const panel = rail?.closest(".vw-side-panel");
    const head = panel?.querySelector(":scope > .hud-grid-head");
    if (!(head instanceof HTMLElement) || !panel) return;
    const toggle = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button, a, input, select, textarea")) return;
      setOpen((value) => !value);
    };
    const onGrown = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; height?: number }>).detail;
      if (detail?.id === panel.getAttribute("data-panel") && (detail.height ?? 0) > 150) setOpen(true);
    };
    head.addEventListener("click", toggle);
    window.addEventListener("openscout-side-grown", onGrown);
    return () => {
      head.removeEventListener("click", toggle);
      window.removeEventListener("openscout-side-grown", onGrown);
    };
  }, [ready]);

  if (!ready) return null;

  const visibleCount = buckets.filter((b) => !hiddenMachineIds.has(b.machineId)).length;
  const totalCount = buckets.length;
  const pinnedCount = Object.keys(machinePositions).length;

  const { entries } = useMeshNodeStates();
  const reachSummary = useMemo(() => {
    let reachable = 0;
    let quiet = 0;
    let unchecked = 0;
    for (const bucket of buckets) {
      const entry = entries[bucket.machineId];
      const reading = hostReading(bucket, entry?.view ?? null, entry?.loading ?? false);
      if (reading.ping === "reachable") reachable += 1;
      else if (reading.ping === "unreachable") quiet += 1;
      else unchecked += 1;
    }
    return `${reachable} reachable · ${quiet} no answer · ${unchecked} not pinged`;
  }, [buckets, entries]);

  const focusMachine = (id: string) => {
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

  const toggleUnit = (id: string) => {
    const opening = !expandedIds.has(id);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (opening) void loadMeshNodeState(id, { deep: true });
  };

  return (
    <div ref={railRef} className={`mesh-rail${open ? " mesh-rail--open" : " mesh-rail--min"}`}>
      <div
        className="mesh-rail-head"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          setOpen((value) => !value);
        }}
      >
        <button
          type="button"
          className="mesh-rail-fold"
          aria-expanded={open}
          aria-label={open ? "Hide the rack" : "Open the rack"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : "Open"}
        </button>
        <span className="mesh-rail-ear" aria-hidden />
        <div className="mesh-rail-mode" role="group" aria-label="Bottom view">
          <button
            type="button"
            className={`mesh-rail-mode-btn${mode === "map" ? " mesh-rail-mode-btn--active" : ""}`}
            onClick={() => setMode("map")}
            aria-pressed={mode === "map"}
          >
            map
          </button>
          <button
            type="button"
            className={`mesh-rail-mode-btn${mode === "rack" ? " mesh-rail-mode-btn--active" : ""}`}
            onClick={() => setMode("rack")}
            aria-pressed={mode === "rack"}
          >
            rack
          </button>
        </div>
        <span className="mesh-rail-title-count">{totalCount}</span>
        <span className="mesh-rail-ear" aria-hidden />
      </div>

      {open && (mode === "rack" ? (
        <RackBody
          buckets={buckets}
          selectedId={selectedId}
          selectedType={selectedType}
          expandedIds={expandedIds}
          layout={hostLayout}
          onFocus={focusMachine}
          onToggle={toggleUnit}
        />
      ) : (
        <MapBody
          buckets={buckets}
          selectedId={selectedId}
          selectedType={selectedType}
          onFocus={focusMachine}
        />
      ))}

      <div
        className="mesh-rail-foot"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          setOpen((value) => !value);
        }}
      >
        <span className="mesh-rail-foot-mark" aria-hidden />
        <span className="mesh-rail-foot-meta">
          {open ? (mode === "map" ? `${totalCount} machines` : `${visibleCount}/${totalCount} on the map`) : reachSummary}
        </span>
        {pinnedCount > 0 && mode === "rack" ? (
          <button
            type="button"
            className="mesh-rail-foot-reset"
            onClick={() => clearAllMachinePositions()}
            title="Reset machine layout"
          >
            reset
          </button>
        ) : (
          <span className="mesh-rail-foot-mark" aria-hidden />
        )}
      </div>
    </div>
  );
}

function RackBody({
  buckets,
  selectedId,
  selectedType,
  expandedIds,
  layout,
  onFocus,
  onToggle,
}: {
  buckets: MachineBucket[];
  selectedId: string | null;
  selectedType: "node" | "agent" | null;
  expandedIds: ReadonlySet<string>;
  layout: ReturnType<typeof useHostLayout>[0];
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { navigate } = useScout();
  const { entries } = useMeshNodeStates();
  const [fullIds, setFullIds] = useState<ReadonlySet<string>>(() => new Set());
  const groups = (["lan", "tailnet"] as const).flatMap((id) => {
    const items = buckets.filter((bucket) => hostGroup(bucket.reachability) === id);
    if (items.length === 0) return [];
    const order = arrangeGroup(items.map((item) => item.machineId), layout);
    const byId = new Map(items.map((item) => [item.machineId, item]));
    const rows = order.map((machineId) => byId.get(machineId)).filter((item): item is MachineBucket => Boolean(item));
    return [{ id, label: id === "lan" ? "LAN" : "Tailnet", rows }];
  });

  return (
    <div className="mesh-rail-body">
      {groups.map((group) => (
        <section key={group.id}>
          <div className="mesh-rail-group">{group.label}</div>
          {group.rows.map((bucket) => {
            const active = selectedId === bucket.machineId && selectedType === "node";
            const entry = entries[bucket.machineId];
            const view = entry?.view ?? null;
            const reading = hostReading(bucket, view, entry?.loading ?? false);
            const expanded = expandedIds.has(bucket.machineId);
            const opened = machineOpenRows(bucket, view);
            const children = opened.rows;
            const full = fullIds.has(bucket.machineId);
            const visible = full ? children : children.slice(0, CONTENTS_LIMIT);
            const overflow = children.length - visible.length;
            const limitNote = opened.limitNote;
            return (
              <div
                key={bucket.machineId}
                className={["mesh-rail-unit", active && "mesh-rail-unit--active"].filter(Boolean).join(" ")}
              >
                <div className="mesh-rail-unit-main">
                  <button
                    type="button"
                    className="mesh-rail-unit-fold"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} what is on ${bucket.machineLabel}`}
                    onClick={() => onToggle(bucket.machineId)}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  <button
                    type="button"
                    className="mesh-rail-unit-body"
                    onClick={() => onFocus(bucket.machineId)}
                    title={`${bucket.machineLabel}. Active ${reading.activeLabel}. With us ${reading.contactLabel}.`}
                  >
                    <span className="mesh-rail-unit-text">
                      <span className="mesh-rail-unit-name" title={bucket.machineLabel}>
                        {bucket.machineLabel}
                      </span>
                      <span className="mesh-rail-unit-sub">
                        <span className="mesh-rail-unit-stamp">{reading.activeLabel === "no activity" ? "no activity" : `active ${reading.activeLabel}`}</span>
                        <span className="mesh-rail-unit-stamp">{reading.contactLabel === "no contact" ? "no contact" : `with us ${reading.contactLabel}`}</span>
                      </span>
                    </span>
                    <span className={`mesh-rail-ping mesh-rail-ping--${reading.ping}`}>{reading.pingLabel}</span>
                  </button>
                  <div className="mesh-rail-unit-actions">
                    <button
                      type="button"
                      className="mesh-rail-unit-eye"
                      disabled={entry?.loading ?? false}
                      onClick={() => void refreshMeshNodeState(bucket.machineId)}
                    >
                      ping
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className={opened.kind === "runs" ? "mesh-rail-contents mesh-rail-contents--runs" : "mesh-rail-contents"}>
                    {children.length === 0 ? (
                      <div className="mesh-rail-contents-note">
                        {machineContentsNote(bucket.kind, view != null, entry?.loading ?? false, view == null && Boolean(entry?.error))}
                      </div>
                    ) : visible.map((child) => {
                      const body = (
                        <>
                          <span className="mesh-rail-contents-name">{child.name}</span>
                          {child.meta && <span className="mesh-rail-contents-meta">{child.meta}</span>}
                        </>
                      );
                      return child.agent ? (
                        <button
                          key={child.key}
                          type="button"
                          className="mesh-rail-contents-row"
                          title={child.title}
                          onClick={() => openAgent(navigate, child.agent!, { from: "mesh-tree", returnTo: { view: "mesh" } })}
                        >
                          {body}
                        </button>
                      ) : (
                        <div key={child.key} className="mesh-rail-contents-row" title={child.title}>{body}</div>
                      );
                    })}
                    {expanded && !full && overflow > 0 && (
                      <button
                        type="button"
                        className="mesh-rail-contents-row"
                        onClick={() => setFullIds((current) => new Set(current).add(bucket.machineId))}
                      >
                        see {overflow} more
                      </button>
                    )}
                    {full && children.length > CONTENTS_LIMIT && (
                      <button
                        type="button"
                        className="mesh-rail-contents-row"
                        onClick={() => setFullIds((current) => {
                          const next = new Set(current);
                          next.delete(bucket.machineId);
                          return next;
                        })}
                      >
                        see less
                      </button>
                    )}
                    {limitNote && <div className="mesh-rail-contents-note">{limitNote}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function MapBody({
  buckets,
  selectedId,
  selectedType,
  onFocus,
}: {
  buckets: MachineBucket[];
  selectedId: string | null;
  selectedType: "node" | "agent" | null;
  onFocus: (id: string) => void;
}) {
  const { entries } = useMeshNodeStates();
  return (
    <div className="mesh-rail-body mesh-rail-body--map">
      <div className="mesh-mini-map">
        {buckets.map((b) => {
          const entry = entries[b.machineId];
          const count = b.kind === "this" ? b.agents.length : entry?.view?.workload?.total;
          const active = selectedId === b.machineId && selectedType === "node";
          const working = b.agents.filter(
            (a) => isAgentBusy(a.state),
          ).length;
          const dominant =
            !b.online
              ? "offline"
              : b.agents.length === 0
                ? "offline"
                : working > 0
                  ? "working"
                  : "available";
          const ledColor = !b.online ? undefined : stateColor(dominant);
          return (
            <button
              key={b.machineId}
              type="button"
              className={`mesh-mini-node mesh-mini-node--${dominant}${active ? " mesh-mini-node--active" : ""}${!b.online ? " mesh-mini-node--off" : ""}`}
              onClick={() => onFocus(b.machineId)}
              title={`${b.machineLabel} — ${machineRowMeta(b, entry?.view ?? null, entry?.loading ?? false)}`}
            >
              <span
                className="mesh-mini-led"
                style={ledColor ? { background: ledColor } : undefined}
                aria-hidden
              />
              <span className="mesh-mini-label">{b.machineLabel}</span>
              {count !== undefined && count > 0 && (
                <span className="mesh-mini-count">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
