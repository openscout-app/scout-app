import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { HerdrPaneProjection, HerdrSessionTopology } from "@openscout/protocol";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { useHerdrPaneOutputs } from "../../lib/herdr-topology.ts";
import { compactTerminalPath } from "../../lib/terminal-sessions.ts";
import { AgentStatusDot, herdrTabName, herdrTabSummary } from "./HerdrSession.tsx";
import { useHerdrPaneNames } from "./herdr-pane-names.ts";
import { lastOutputLine, outputTail } from "./herdr-pane-table.ts";

/** Lines asked of each pane for its tail; the pane clips what it cannot show. */
const FILL_TAIL_LINES = 40;
/** Tails are a glance at the session, so they refresh slower than the layout. */
const FILL_TAIL_POLL_MS = 6_000;

type HerdrSessionPreviewProps = {
  topology: HerdrSessionTopology;
  stale?: boolean;
  /**
   * Fill the container, as a workspace slot does: one bar carries `leading`,
   * the tabs, the view toggle and `trailing`; the layout takes the rest, and
   * each pane shows the end of its output.
   */
  fill?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Fill mode: a pane click enters the session on that pane. */
  onEnterPane?: (pane: HerdrPaneProjection) => void;
};

/** A read-only map and directory of the same observed session. */
export function HerdrSessionPreview({
  topology,
  stale = false,
  fill = false,
  leading,
  trailing,
  onEnterPane,
}: HerdrSessionPreviewProps) {
  const [view, setView] = useState<"layout" | "list">("layout");
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const entries = topology.workspaces.flatMap((workspace) => workspace.tabs.map((tab) => ({
    workspace, tab, key: `${workspace.workspaceId}:${tab.tabId}`,
  })));
  const active = entries.find((entry) => entry.key === selected)
    ?? entries.find(({ workspace, tab }) => workspace.focused && tab.tabId === workspace.activeTabId)
    ?? entries[0];
  const live = topology.running && !stale;
  const paneName = useHerdrPaneNames(topology);
  const layout = active?.tab.layout;
  const area = layout?.area;
  const hasGeometry = layout && area && area.width > 0 && area.height > 0 && layout.panes.length > 0;

  // Only the tab on screen is read, and only in fill mode, where there is room
  // to show what a pane printed.
  const activePaneIds = useMemo(
    () => (active?.tab.panes ?? []).map((pane) => pane.paneId),
    [active?.tab.panes],
  );
  const outputs = useHerdrPaneOutputs(fill ? topology.session : null, activePaneIds, {
    lines: FILL_TAIL_LINES,
    pollMs: FILL_TAIL_POLL_MS,
    enabled: fill && live,
  });

  const controls = (
    <div className="s-herdr-preview-controls" role="group" aria-label="Herdr preview view">
      {(["layout", "list"] as const).map((mode) => (
        <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === "layout" ? "Layout" : "List"}</button>
      ))}
    </div>
  );

  // A slot's bar is narrow: with one workspace, its name on every tab says
  // nothing, so a tab shows its own name and keeps the full label as a tooltip.
  const singleWorkspace = topology.workspaces.length === 1;
  // The strip scrolls inside a narrow bar; keep the selected tab in it.
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !tab) return;
    const bounds = strip.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < bounds.left) strip.scrollLeft += box.left - bounds.left;
    else if (box.right > bounds.right) strip.scrollLeft += box.right - bounds.right;
  }, [active?.key]);
  const tabs = active ? (
    <div ref={tabsRef} className="s-herdr-tabs" role="tablist" aria-label="Herdr session tabs">
      {entries.map(({ workspace, tab, key }, index) => {
        const label = herdrTabSummary(workspace, tab).label;
        const name = herdrTabName(tab);
        const shown = !fill || !singleWorkspace || !name ? label : /^\d+$/.test(name) ? `Tab ${name}` : name;
        return (
        <button key={key} type="button" role="tab" id={`${id}-tab-${index}`} title={shown === label ? undefined : label}
          aria-selected={key === active.key} aria-controls={`${id}-layout`} tabIndex={key === active.key ? 0 : -1}
          className={`s-herdr-tab ${key === active.key ? "s-herdr-tab--active" : ""}`}
          onClick={() => setSelected(key)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % entries.length
              : event.key === "ArrowLeft" ? (index + entries.length - 1) % entries.length
              : event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); setSelected(entries[next]!.key);
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}>
          <AgentStatusDot status={live ? tab.agentStatus : "unknown"} />
          <span>{shown}</span>
          <span className="s-herdr-tab-count">{tab.panes.length}</span>
        </button>
        );
      })}
    </div>
  ) : null;

  if (fill) {
    const panesById = new Map((active?.tab.panes ?? []).map((pane) => [pane.paneId, pane]));
    return (
      <div className="s-herdr-preview s-herdr-preview--fill">
        <div className="s-term-bar s-herdr-preview-bar">
          {leading}
          {tabs ?? <span className="s-herdr-tabs" />}
          {controls}
          {trailing}
        </div>
        <div className="s-herdr-preview-body" id={`${id}-layout`} role="tabpanel"
          aria-labelledby={active ? `${id}-tab-${entries.indexOf(active)}` : undefined}>
          {!active ? (
            <div className="s-term-picker-empty">No tabs reported for this session.</div>
          ) : view === "list" ? (
            <div className="s-term-picker-list s-term-herdr-preview-list" aria-label={`${topology.session} panes`}>
              {active.tab.panes.map((pane) => (
                <FillPaneRow key={pane.paneId} pane={pane} name={paneName(pane, pane.paneId)} live={live}
                  lastLine={lastOutputLine(outputs[pane.paneId] ?? null)} onEnter={onEnterPane} />
              ))}
            </div>
          ) : hasGeometry ? (
            <div className="s-herdr-layout" role="group" aria-label={`Layout of ${herdrTabSummary(active.workspace, active.tab).label}`}>
              {layout.panes.map(({ paneId, rect, focused }) => (
                <FillPane key={paneId} paneId={paneId} pane={panesById.get(paneId)} name={paneName(panesById.get(paneId), paneId)} focused={focused} live={live}
                  tail={outputTail(outputs[paneId] ?? null, FILL_TAIL_LINES)}
                  style={{ left: `${(rect.x - area.x) / area.width * 100}%`, top: `${(rect.y - area.y) / area.height * 100}%`, width: `${rect.width / area.width * 100}%`, height: `${rect.height / area.height * 100}%` }}
                  onEnter={onEnterPane} />
              ))}
            </div>
          ) : (
            <div className="s-term-picker-empty">No pane geometry was reported for this tab. The List view still has its pane details.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="s-herdr-preview">
      {controls}
      {view === "layout" && active ? <>
        {tabs}
        <div id={`${id}-layout`} role="tabpanel" aria-labelledby={`${id}-tab-${entries.indexOf(active)}`}>
          {hasGeometry ? <div className="s-herdr-layout-window">
            <div className="s-herdr-layout-titlebar">
              <span>{active.tab.panes.length} panes · {live ? "Live layout" : "Last known layout"}</span>
            </div>
            <div className="s-herdr-layout" style={{ aspectRatio: `${area.width} / ${Math.max(area.height * 2, 1)}` }}>
              {layout.panes.map(({ paneId, rect, focused }) => {
                const pane = active.tab.panes.find((entry) => entry.paneId === paneId);
                return <div key={paneId} className={`s-herdr-layout-pane ${focused ? "s-herdr-layout-pane--focused" : ""}`}
                  style={{ left: `${(rect.x - area.x) / area.width * 100}%`, top: `${(rect.y - area.y) / area.height * 100}%`, width: `${rect.width / area.width * 100}%`, height: `${rect.height / area.height * 100}%` }}
                  title={[pane?.name, pane?.label, pane?.foregroundCwd ?? pane?.cwd].filter(Boolean).join(" · ")}>
                  <span className="s-herdr-layout-pane-head"><AgentStatusDot status={live ? pane?.agentStatus ?? "unknown" : "unknown"} /><strong className="s-herdr-pane-label">{paneName(pane, paneId)}</strong></span>
                  <span className="s-herdr-preview-pane-kind">{pane?.agent ?? "shell"} · {live ? pane?.agentStatus ?? "unknown" : "last known"}</span>
                  <span className="s-herdr-cwd">{compactTerminalPath(pane?.foregroundCwd ?? pane?.cwd)}</span>
                </div>;
              })}
            </div>
          </div> : <div className="s-term-picker-empty">No pane geometry was reported for this tab. The List view still has its pane details.</div>}
        </div>
      </> : view === "layout" ? <div className="s-term-picker-empty">No tabs reported for this session.</div> : null}
      {view === "list" && <div className="s-term-picker-list s-term-herdr-preview-list" aria-label={`${topology.session} panes`}>
        {entries.flatMap(({ workspace, tab, key }) => tab.panes.map((pane) => (
          <div className="s-term-picker-item" key={`${key}:${pane.paneId}`}>
            <div className="s-term-picker-item-summary">
              <div className="s-term-picker-item-main"><strong title={pane.label ?? undefined}>{paneName(pane, pane.paneId)}</strong><span>{compactTerminalPath(pane.foregroundCwd ?? pane.cwd) || "Directory unknown"}</span></div>
              <div className="s-term-picker-item-meta"><span>{pane.agent ?? "shell"}</span><span>{live ? pane.agentStatus : "last known"}</span><span>{herdrTabSummary(workspace, tab).label}</span></div>
            </div>
          </div>
        )))}
      </div>}
    </div>
  );
}

/** The pane's own line: how it is doing, what runs there, its name and where it is. */
function FillPaneStrip({ pane, name, live }: { pane: HerdrPaneProjection | undefined; name: string; live: boolean }) {
  const cwd = compactTerminalPath(pane?.foregroundCwd ?? pane?.cwd);
  return (
    <span className="s-herdr-pane-strip">
      <AgentStatusDot status={live ? pane?.agentStatus ?? "unknown" : "unknown"} />
      {pane?.agent && <HarnessMark harness={pane.agent} size={12} className="s-herdr-agent-mark" />}
      <strong className="s-herdr-pane-label">{name}</strong>
      {cwd && <span className="s-herdr-cwd">{cwd}</span>}
      {pane?.agent && <span className="s-herdr-pane-status">{live ? pane.agentStatus : "last known"}</span>}
    </span>
  );
}

function FillPane({
  paneId,
  pane,
  name,
  focused,
  live,
  tail,
  style,
  onEnter,
}: {
  paneId: string;
  pane: HerdrPaneProjection | undefined;
  name: string;
  focused: boolean;
  live: boolean;
  tail: string | null;
  style: CSSProperties;
  onEnter?: (pane: HerdrPaneProjection) => void;
}) {
  const enterable = Boolean(pane && onEnter && live);
  const enter = () => { if (pane && onEnter && live) onEnter(pane); };
  return (
    <div
      className={`s-herdr-layout-pane s-herdr-fill-pane ${focused ? "s-herdr-layout-pane--focused" : ""}`}
      style={style}
      {...(enterable ? {
        role: "button",
        tabIndex: 0,
        onClick: enter,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); enter(); }
        },
        title: `Enter ${name}: focus it and open the web terminal`,
        // The tail is inside; name the button for the pane, not for its output.
        "aria-label": `Enter ${name}`,
      } : { title: [paneId, pane?.label, pane?.foregroundCwd ?? pane?.cwd].filter(Boolean).join(" · ") })}
    >
      <FillPaneStrip pane={pane} name={name} live={live} />
      <span className="s-herdr-pane-tail" aria-hidden={tail ? undefined : true}>
        <pre>{tail ?? ""}</pre>
      </span>
    </div>
  );
}

function FillPaneRow({
  pane,
  name,
  live,
  lastLine,
  onEnter,
}: {
  pane: HerdrPaneProjection;
  name: string;
  live: boolean;
  lastLine: string | null;
  onEnter?: (pane: HerdrPaneProjection) => void;
}) {
  const enterable = Boolean(onEnter && live);
  const content = (
    <>
      <FillPaneStrip pane={pane} name={name} live={live} />
      {lastLine && <span className="s-herdr-pane-last">{lastLine}</span>}
    </>
  );
  return enterable ? (
    <button type="button" className="s-herdr-fill-row" onClick={() => onEnter?.(pane)}
      title={`Enter ${name}: focus it and open the web terminal`}>
      {content}
    </button>
  ) : (
    <div className="s-herdr-fill-row">{content}</div>
  );
}
