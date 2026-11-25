import { useCallback, type MouseEvent } from "react";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { SessionHopMenu, sessionHopMenuItems } from "../../components/SessionHopMenu.tsx";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { renderWithMentions } from "../../lib/mentions.tsx";
import {
  peekTerminalSessionInventory,
  resolveSessionTerminalTarget,
} from "../../lib/session-terminal-hop.ts";
import { fullTimestamp, timeAgo } from "../../lib/time.ts";
import type { ActivityItem, Route } from "../../lib/types.ts";
import {
  ACTIVITY_CATEGORY_META,
  activityCategory,
  activityFacts,
  activityHasTerminal,
  activityJumps,
  activityStampLabel,
  activitySummary,
  activityTitle,
  actorInitial,
  kindLabel,
  pathLeaf,
} from "./activity-model.ts";

/*
 * One activity record, as the Activity page draws it: the row (time, group,
 * what happened, who, where, and where it links), its details, and its
 * context menu. The page and the Activity panels mount these; nothing here
 * reads data.
 */

type Navigate = (route: Route) => void;

/** The record's context menu: copy what it says, open what it links to, reach its terminal. */
export function useActivityMenu(navigate: Navigate, returnTo: Route) {
  const showContextMenu = useContextMenu();
  return useCallback((e: MouseEvent, item: ActivityItem) => {
    const sel = window.getSelection()?.toString().trim();
    const items: MenuItem[] = [];
    if (sel) {
      items.push({ kind: "action", label: "Copy Selection", shortcut: "⌘C", onSelect: () => { void copyTextToClipboard(sel); } });
      items.push({ kind: "separator" });
    }
    const text = item.title ?? item.summary ?? "";
    if (text) items.push({ kind: "action", label: "Copy Details", onSelect: () => { void copyTextToClipboard(text); } });
    if (item.actorName) items.push({ kind: "action", label: "Copy Actor", onSelect: () => { void copyTextToClipboard(item.actorName!); } });
    items.push({ kind: "action", label: "Copy Event ID", onSelect: () => { void copyTextToClipboard(item.id); } });
    const jumps = activityJumps(item);
    if (jumps.length > 0) {
      items.push({ kind: "separator" });
      for (const jump of jumps) items.push({ kind: "action", label: `Open ${jump.label}`, onSelect: () => navigate(jump.route) });
    }
    if (activityHasTerminal(item)) {
      const sessions = peekTerminalSessionInventory();
      const target = sessions
        ? resolveSessionTerminalTarget(sessions, { agentId: item.agentId, sessionRefs: [item.sessionId] })
        : null;
      items.push({ kind: "separator" });
      items.push(...sessionHopMenuItems({ target, agentId: item.agentId, navigate, returnTo }));
    }
    showContextMenu(e, items);
  }, [navigate, returnTo, showContextMenu]);
}

/** Group and kind, the headline, the summary, then who and where. */
export function ActivityHeadline({ item }: { item: ActivityItem }) {
  const categoryMeta = ACTIVITY_CATEGORY_META[activityCategory(item.kind)];
  const workspaceLabel = pathLeaf(item.workspaceRoot);
  const summary = activitySummary(item);
  return (
    <>
      <div className="sys-audit-topline">
        <span className="sys-audit-category">{categoryMeta.label}</span>
        <span className="sys-audit-kind">{kindLabel(item.kind)}</span>
      </div>
      <h3 className="sys-audit-title">{renderWithMentions(activityTitle(item))}</h3>
      {summary && <p className="sys-audit-summary">{renderWithMentions(summary)}</p>}
      <div className="sys-audit-meta">
        <span className="sys-audit-meta-item">
          <span className="sys-audit-avatar" aria-hidden>{actorInitial(item.actorName)}</span>
          {item.actorName ?? "system"}
        </span>
        {workspaceLabel && <span className="sys-audit-meta-item">Workspace {workspaceLabel}</span>}
      </div>
    </>
  );
}

/**
 * What the page showed under an open record: every id it carries, then Open
 * for each page it links to. `terminal` adds the terminal hop to that row,
 * for a reader that has no row above it carrying one (the details panel).
 */
export function ActivityDetails({
  item,
  navigate,
  returnTo,
  terminal = false,
}: {
  item: ActivityItem;
  navigate: Navigate;
  returnTo: Route;
  terminal?: boolean;
}) {
  const jumps = activityJumps(item);
  const hop = terminal && activityHasTerminal(item);
  return (
    <div className="sys-audit-details">
      <div className="sys-detail-grid">
        {activityFacts(item, fullTimestamp).map((fact) => (
          <div key={fact.label} className="sys-detail-card">
            <span className="sys-detail-label">{fact.label}</span>
            {fact.code ? <code className="sys-detail-value">{fact.value}</code> : <span className="sys-detail-value">{fact.value}</span>}
          </div>
        ))}
      </div>
      {(jumps.length > 0 || hop) && (
        <div className="sys-inline-actions">
          {jumps.map((jump) => (
            <button key={jump.key} type="button" className="s-btn s-btn-sm" onClick={() => navigate(jump.route)}>
              Open {jump.label}
            </button>
          ))}
          {hop && (
            <SessionHopMenu
              className="s-btn s-btn-sm"
              label="Terminal"
              hints={{ agentId: item.agentId, sessionRefs: [item.sessionId] }}
              navigate={navigate}
              returnTo={returnTo}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One row of the log. A click or Enter/Space on the row toggles it (only on
 * the row itself, so Enter on one of its Open buttons still opens that).
 * `expanded` draws its details under it; `selected` marks it as the pick a
 * details panel beside the list is showing.
 */
export function ActivityEntry({
  item,
  expanded,
  selected = expanded,
  onToggle,
  onMenu,
  navigate,
  returnTo,
}: {
  item: ActivityItem;
  expanded: boolean;
  selected?: boolean;
  onToggle: () => void;
  onMenu: (e: MouseEvent, item: ActivityItem) => void;
  navigate: Navigate;
  returnTo: Route;
}) {
  const tone = ACTIVITY_CATEGORY_META[activityCategory(item.kind)].tone;
  const jumps = activityJumps(item);
  return (
    <article
      className={`sys-audit-entry${expanded ? " sys-audit-entry-expanded" : ""}${selected ? " is-selected" : ""}`}
      data-activity-id={item.id}
      onContextMenu={(e) => onMenu(e, item)}
    >
      <div
        className="sys-audit-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-current={selected ? "true" : undefined}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="sys-audit-stamp" title={fullTimestamp(item.ts)}>
          <span className="sys-audit-time">{timeAgo(item.ts)}</span>
          <span className="sys-audit-date">{activityStampLabel(item.ts)}</span>
        </div>

        <div className={`sys-audit-marker sys-audit-marker-${tone}`}>
          <span />
        </div>

        <div className="sys-audit-body">
          <ActivityHeadline item={item} />
          {jumps.length > 0 && (
            <div className="sys-audit-jumps">
              <span className="sys-audit-jumps-label">Open</span>
              {jumps.map((jump) => (
                <button
                  key={jump.key}
                  type="button"
                  className="sys-audit-jump"
                  title={jump.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(jump.route);
                  }}
                >
                  {jump.label}
                </button>
              ))}
              {activityHasTerminal(item) && (
                <SessionHopMenu
                  className="sys-audit-jump"
                  label="Terminal"
                  hints={{ agentId: item.agentId, sessionRefs: [item.sessionId] }}
                  navigate={navigate}
                  returnTo={returnTo}
                />
              )}
            </div>
          )}
        </div>

        <div className="sys-audit-expand">{selected ? "Close" : "Details"}</div>
      </div>

      {expanded && <ActivityDetails item={item} navigate={navigate} returnTo={returnTo} />}
    </article>
  );
}
