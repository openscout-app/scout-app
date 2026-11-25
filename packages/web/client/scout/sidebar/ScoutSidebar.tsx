/**
 * Scout primary navigation chrome (SCO-084 / SCO-085) — shadcn Sidebar composition.
 *
 * Stable app chrome only (Requirement 7 revised 2026-07-20 / SCO-086):
 * destinations and scope items. Per-area context content lives in the left
 * HudsonKit SidePanel (side rail), not here — do not re-introduce a Context
 * group.
 *
 * The Scout presentation lists areas only: an area's pages live once, in the
 * top bar's tab strip. New chat leads the list, under the column's head band
 * (which keeps its height for the collapse chevron, but no label). Slack keeps
 * its pages under the active row and New chat in the footer, since its top bar
 * has no tab strip.
 *
 * SCO-085 full-height: brand strip at window top (titleBarInset padding),
 * drag region on the brand strip. Settings is a primary area.
 *
 * SCO-087: the app-wide top row (right of the sidebar) owns machine scope, the
 * ⌘K trigger and the settings accelerator — they are NOT in the sidebar footer
 * anymore (machine scope: exactly one instance, in the top row). The sidebar
 * edge chevron (RailToggle) is also rendered by the shell so it can ride the
 * ghost edge during drag-resize; the sidebar body is pure presentation.
 *
 * SCO-086: logo is static (click → Home, never a toggle).
 *
 * Gated by nav.sidebar; renders exactly one chrome tree vs legacy left panel.
 * State (open/collapsed) is owned by useSidebarCollapse via SidebarProvider;
 * this file is presentation only. Default presentation is the 48px icon rail.
 *
 * HudsonKit SidePanel is intentionally separate (side rail / right inspector /
 * legacy left). Do not route this chrome through SidePanel.
 */
import { Bell, Plus } from "lucide-react";
import { PlusGlyph } from "../../components/ScoutGlyph.tsx";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../components/ui/sidebar.tsx";
import {
  NEW_CHAT_SHORTCUT_LABEL,
  NEW_TASK_ACTION_LABEL,
} from "../../lib/new-chat-shortcut.ts";
import { cn } from "../../lib/utils.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";
import {
  PRIMARY_AREAS,
  defaultRouteForArea,
  getPrimaryArea,
  primaryAreaForRoute,
  type PrimaryAreaId,
  type NavigationEntryId,
  type SidebarLayout,
  type SidebarRow,
} from "../primary-areas.ts";
import {
  projectGoShortcuts,
  sidebarSubNavForRoute,
  type SidebarSubNavAreaId,
} from "../nav-destinations.ts";
import { useOptionalFlag } from "hudsonkit/flags";
import { useSidebarModel } from "./useSidebarModel.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import { RequestsCount } from "../../screens/requests/RequestsCount.tsx";
import { requestsCountState } from "../../screens/requests/requests-model.ts";
import "../../screens/requests/requests.css";
import { ACTIVE_MENU_CLASS, ScoutSidebarFrame, SidebarPlaceRow } from "./ScoutSidebarFrame.tsx";
import { SidebarAccountRow } from "./SidebarAccountRow.tsx";

/** The go-shortcut that opens Search (g then f), as the row's key hint. */
const SEARCH_SHORTCUT = (() => {
  const key = projectGoShortcuts().find((shortcut) => shortcut.destinationId === "search")?.key;
  return key ? `G ${key.toUpperCase()}` : null;
})();

/** Consecutive rows that share an intent group: each becomes its own list, with a rule between. */
function rowsByGroup(rows: readonly SidebarRow[]): SidebarRow[][] {
  const runs: SidebarRow[][] = [];
  for (const row of rows) {
    const group = row.group ?? row.section;
    const last = runs[runs.length - 1];
    if (last && (last[0].group ?? last[0].section) === group) last.push(row);
    else runs.push([row]);
  }
  return runs;
}

function AreaMenuItems({
  areas,
  activeAreaId,
  onNavigateArea,
  route,
  navigate,
  opsControlEnabled,
  meshOpsEnabled,
  subNav: showSubNav,
  presentation,
  inboxCount,
}: {
  areas: readonly SidebarRow[];
  activeAreaId: string;
  onNavigateArea: (area: SidebarRow) => void;
  route: Route;
  navigate: (route: Route) => void;
  opsControlEnabled: boolean;
  meshOpsEnabled: boolean;
  subNav: boolean;
  presentation: "scout" | "slack";
  /** The Inbox's open count, carried by the row that stands for Home; null when the build has no Inbox. */
  inboxCount: { count: number; pending: boolean } | null;
}) {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const boardsEnabled = useOptionalFlag("surface.board", false);
  const reviewEnabled = useOptionalFlag("surface.review", false);
  const canvasEnabled = useOptionalFlag("surface.canvas", false);
  const feedEnabled = useOptionalFlag("surface.feed", true);
  // Scout lists an area's pages once, in the top bar's tab strip; Slack's top
  // bar has none, so its pages stay under the active row.
  const subNav = showSubNav && presentation === "slack"
    ? sidebarSubNavForRoute(route, { opsControlEnabled, meshOpsEnabled, boardsEnabled, reviewEnabled, canvasEnabled, feedEnabled })
    : null;

  const renderRow = (area: SidebarRow) => {
    const slackHome = presentation === "slack" && area.id === "home";
    const slackActivity = presentation === "slack" && area.id === "chat";
    const projectedAreaId = slackHome ? "chat" : slackActivity ? "home" : area.id;
    const Icon = slackActivity ? Bell : area.icon;
    const label = slackActivity ? "Activity" : area.label;
    // Slack's Activity row also stands for the Log it opens.
    const active =
      projectedAreaId === activeAreaId || (slackActivity && route.view === "activity");
    const areaSub =
      expanded &&
      active &&
      subNav &&
      (subNav.areaId as string) === projectedAreaId
        ? subNav.items
        : null;
    const subOpen = Boolean(areaSub && areaSub.length > 0);
    // The row hands its plate to the open page. On a route the area owns but
    // no page names (Home's /views), the row keeps it, so something is lit.
    const pageOpen = subOpen && Boolean(areaSub?.some((item) => item.active(route)));
    // Home carries the Inbox's count: shown only while something waits, so a
    // quiet Inbox leaves Home a plain row.
    const waiting =
      projectedAreaId === "home" && inboxCount && !inboxCount.pending && inboxCount.count > 0
        ? inboxCount.count
        : 0;
    const rowLabel = waiting > 0 ? `${label}, ${waiting} to review` : label;
    return (
      <SidebarMenuItem key={area.id}>
        <SidebarMenuButton
          type="button"
          isActive={active}
          tooltip={waiting > 0 ? `${label} · ${waiting} to review` : label}
          aria-label={rowLabel}
          aria-current={active && !pageOpen ? "page" : undefined}
          data-area={area.id}
          // With one of its pages open under it, the area row hands the
          // selection plate to that page; the row keeps full ink.
          data-sub-open={pageOpen ? "" : undefined}
          className={cn(ACTIVE_MENU_CLASS, waiting > 0 && "relative")}
          onClick={() => onNavigateArea(area)}
        >
          <Icon size={16} aria-hidden />
          <span data-nav-label="">{label}</span>
          {waiting > 0 ? <RequestsCount count={waiting} navigation /> : null}
        </SidebarMenuButton>
        {area.id === "search" && SEARCH_SHORTCUT ? (
          <SidebarMenuBadge className="font-mono text-2xs text-sidebar-foreground/55">
            {SEARCH_SHORTCUT}
          </SidebarMenuBadge>
        ) : null}
        {subOpen && areaSub ? (
          <SidebarMenuSub data-nav-sub={projectedAreaId}>
            {areaSub.map((item) => {
              const itemActive = item.active(route);
              // Slack names the Home page Activity (its top bar does too).
              const itemLabel = presentation === "slack" && item.id === "home" ? "Activity" : item.label;
              return (
                <SidebarMenuSubItem key={item.id}>
                  <SidebarMenuSubButton
                    render={<button type="button" />}
                    isActive={itemActive}
                    aria-current={itemActive ? "page" : undefined}
                    data-subnav={item.id}
                    className="text-xs"
                    onClick={() => navigate(item.route)}
                  >
                    <span>{itemLabel}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        ) : null}
      </SidebarMenuItem>
    );
  };

  return (
    <>
      {rowsByGroup(areas).map((run) => (
        <SidebarMenu key={run[0].id} data-nav-group={run[0].group ?? run[0].section}>
          {run.map(renderRow)}
        </SidebarMenu>
      ))}
    </>
  );
}

function NewChatItem({ onStart, presentation }: { onStart: () => void; presentation: "scout" | "slack" }) {
  const Icon = presentation === "scout" ? PlusGlyph : Plus;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        tooltip={`${NEW_TASK_ACTION_LABEL} (${NEW_CHAT_SHORTCUT_LABEL})`}
        aria-label={NEW_TASK_ACTION_LABEL}
        aria-keyshortcuts={NEW_CHAT_SHORTCUT_LABEL}
        data-action="new-task"
        className="[&_svg]:text-[var(--hud-accent)]"
        onClick={onStart}
      >
        <Icon size={16} aria-hidden />
        <span>{NEW_TASK_ACTION_LABEL}</span>
      </SidebarMenuButton>
      <SidebarMenuBadge className="font-mono text-2xs text-sidebar-foreground/55">
        {NEW_CHAT_SHORTCUT_LABEL}
      </SidebarMenuBadge>
    </SidebarMenuItem>
  );
}

export function ScoutSidebar({
  brandLabel = "Scout",
  presentation = "scout",
  layout,
  subNav = true,
  showRequests = true,
  onNewTask,
  actionsInTopRow = false,
}: {
  /**
   * Fixed product brand (usually app.name / "Scout"). Scope's active section
   * label is NOT a brand — scope destinations live in the model body.
   */
  brandLabel?: string;
  presentation?: "scout" | "slack";
  /**
   * A build's own rows, when it groups its sidebar differently from the full
   * app (basic keeps Terminals and Sent as rows, and its Ops opens on Lanes).
   * Rows open their defaultRoute; the full app's areas apply the Ops gate.
   */
  layout?: SidebarLayout;
  /** Slack only: area pages under the active row (Scout lists them in the top bar). A build that serves only the area's front page turns them off. */
  subNav?: boolean;
  /** The Inbox lives on the full shell; a build without it shows no count on Home. */
  showRequests?: boolean;
  /** The build's own "new task" when it has no context-capture overlay. */
  onNewTask?: () => void;
  /**
   * The top row carries New chat and a search shortcut; the Search destination
   * remains in Navigate. Builds without that row keep their tool rows here.
   */
  actionsInTopRow?: boolean;
}) {
  const { route, navigate, openSettings, openContextCapture } = useScout();
  const opsControlEnabled = useOptionalFlag("ops.control", true);
  const meshOpsEnabled = useOptionalFlag("surface.mesh-ops", false);
  const model = useSidebarModel(route);
  const attention = useOperatorRequests();
  const requestsCount = requestsCountState(attention.state?.items.length ?? 0);
  const inboxCount = showRequests
    ? { count: requestsCount.count, pending: !attention.state }
    : null;
  const activeAreaId: string = layout ? layout.rowForRoute(route) : primaryAreaForRoute(route);
  const rows = layout?.rows ?? PRIMARY_AREAS;
  // The full shell always lists every navigate row, including Search.
  const navigateAreas = [
    ...(actionsInTopRow ? [] : rows.filter((a) => a.section === "tools")),
    ...rows.filter((a) => a.section === "navigate"),
  ];
  // Settings is pinned at the sidebar bottom (see footer), so it is removed
  // from the SYSTEM list: it lives exactly once. The full app has nothing else
  // there; basic keeps its Ops row.
  const systemAreas = rows.filter((a) => a.section === "system" && a.id !== "settings");
  const settingsArea = getPrimaryArea("settings");
  const SettingsIcon = settingsArea.icon;
  const settingsActive = activeAreaId === "settings";
  const newChatOnTop = presentation === "scout" && !actionsInTopRow;
  const newChatInFooter = presentation !== "scout";

  const goHome = () =>
    navigate(presentation === "slack" ? { view: "messages" } : { view: "inbox" });
  const startNewTask = () => (onNewTask ? onNewTask() : openContextCapture());
  const goArea = (area: SidebarRow) => {
    if (presentation === "slack" && area.id === "home") {
      if (activeAreaId === "chat") return;
      navigate({ view: "messages" });
      return;
    }
    if (presentation === "slack" && area.id === "chat") {
      if (activeAreaId === "home" || route.view === "activity") return;
      navigate({ view: "activity" });
      return;
    }
    // Stay put if already in the area (preserve deep links).
    if (activeAreaId === area.id) return;
    navigate(
      layout
        ? area.defaultRoute
        : defaultRouteForArea(area.id as PrimaryAreaId, { opsControlEnabled }),
    );
  };
  return (
    <ScoutSidebarFrame
      brandLabel={brandLabel}
      homeLabel={presentation === "scout" ? getPrimaryArea("home").label : "Home"}
      presentation={presentation}
      onHome={goHome}
      ariaLabel={model.kind === "scope" ? "Scope navigation" : "Primary navigation"}
      kind={model.kind}
      footer={(
        // Settings stays pinned here across every route: a utility, not a
        // primary area. Slack also pins New chat here. The Inbox is Home's
        // second page; the Home row carries its count.
        <SidebarMenu className="gap-1">
          {newChatInFooter ? <NewChatItem onStart={startNewTask} presentation={presentation} /> : null}
          <SidebarPlaceRow
            id="settings"
            label={settingsArea.label}
            icon={SettingsIcon}
            active={settingsActive}
            onSelect={() => openSettings()}
          />
          {/* The account sits under Settings on every surface; the top row's
              corner is kept for tools and panes. Slack keeps its own coin. */}
          {presentation === "scout" ? <SidebarAccountRow /> : null}
        </SidebarMenu>
      )}
    >
        {model.kind === "scope" ? (
          <SidebarGroup>
            {/* Column header — see data-sidebar-head note on the Navigate group. */}
            <SidebarGroupLabel data-sidebar-head="" className="font-mono uppercase">
              <span data-sidebar-head-text="">Surfaces</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {model.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      type="button"
                      isActive={item.active}
                      tooltip={item.label}
                      aria-current={item.active ? "page" : undefined}
                      data-area={item.id}
                      aria-label={item.label}
                      title={item.label}
                      className={ACTIVE_MENU_CLASS}
                      onClick={() => navigate(item.route)}
                    >
                      {/* Scope items have no icons — initial-letter fallback for icon rail. */}
                      <span
                        className="flex size-4 shrink-0 items-center justify-center text-sm font-bold uppercase"
                        aria-hidden
                      >
                        {item.label.slice(0, 1)}
                      </span>
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              {/* data-sidebar-head: this is the rail's COLUMN header, not an
                  in-list group label. It sits on the same grid line as the side
                  rail's ("HOME") and inspector's ("CONTEXT") panel headers, so
                  app.css gives it the same band, dashed hairline and
                  eyebrow type. SYSTEM below stays a quiet divider — it groups a
                  list, it does not head the column. */}
              {/* The Scout presentation has no column title, so no band: Home is
                  the first row, and the collapse control sits in the brand row. */}
              {presentation === "scout" ? null : (
                <SidebarGroupLabel data-sidebar-head="" className="font-mono uppercase">
                  <span data-sidebar-head-text="">Navigate</span>
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                {newChatOnTop ? (
                  <SidebarMenu data-nav-group="new-chat">
                    <NewChatItem onStart={startNewTask} presentation={presentation} />
                  </SidebarMenu>
                ) : null}
                <AreaMenuItems
                  areas={navigateAreas}
                  activeAreaId={activeAreaId}
                  onNavigateArea={goArea}
                  route={route}
                  navigate={navigate}
                  opsControlEnabled={opsControlEnabled}
                  meshOpsEnabled={meshOpsEnabled}
                  subNav={subNav}
                  presentation={presentation}
                  inboxCount={inboxCount}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            {systemAreas.length === 0 ? null : (
            <SidebarGroup>
              <SidebarGroupLabel
                data-sidebar-system=""
                className={presentation === "scout" ? undefined : "font-mono text-2xs tracking-[0.12em] uppercase"}
              >
                System
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <AreaMenuItems
                  areas={systemAreas}
                  activeAreaId={activeAreaId}
                  onNavigateArea={goArea}
                  route={route}
                  navigate={navigate}
                  opsControlEnabled={opsControlEnabled}
                  meshOpsEnabled={meshOpsEnabled}
                  subNav={subNav}
                  presentation={presentation}
                  inboxCount={inboxCount}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            )}
          </>
        )}
    </ScoutSidebarFrame>
  );
}

/** Hook-friendly active area for tests / consumers. */
export function sidebarActiveAreaId(route: Route): NavigationEntryId {
  return primaryAreaForRoute(route);
}

/** Area sub-nav area ids used by the sidebar projection (tests). */
export type { SidebarSubNavAreaId };
