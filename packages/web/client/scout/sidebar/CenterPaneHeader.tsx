/**
 * Shared center-pane header / page title bar (SCO-085 / SCO-086).
 *
 * Slim title bar above ScoutContent:
 * - Route breadcrumb (left)
 * - The area's tab strip: every area with pages draws the same strip
 *   (sidebarSubNavForRoute). The area name shows only when the area has no
 *   tabs, so it never repeats the tab.
 * - Optional RIGHT-UTILITY slot for screen-level header actions
 *
 * Routes that intentionally return null (no title bar):
 * - Home landings: inbox (no crumb, no secondary strip)
 * - Other flush landings depend on breadcrumb + area projections;
 *   see routeBreadcrumbForRoute / areaSubNavForRoute.
 *
 * One shell slot — do not hand-edit every screen for breadcrumb/subnav.
 */
import type { MouseEvent, ReactNode } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { routeBreadcrumbForRoute } from "../route-breadcrumb.ts";
import {
  areaSubNavForRoute,
  sidebarSubNavForRoute,
  type AreaSubNavItem,
} from "../nav-destinations.ts";
import { scopeProjectTabs, useProjectScope } from "../project-scope.ts";
import { useOptionalFlag } from "hudsonkit/flags";
import { useScout } from "../Provider.tsx";
import { getPrimaryArea, primaryAreaForRoute } from "../primary-areas.ts";
import type { Route } from "../../lib/types.ts";
import { hasSecondaryNavRow } from "./center-pane-header-state.ts";

import { AreaSubNavStrip, TopRowView } from "./TopRowView.tsx";

export { hasSecondaryNavRow } from "./center-pane-header-state.ts";
export { AreaSubNavStrip } from "./TopRowView.tsx";

/**
 * Shell-owned page title bar: breadcrumb, area sub-nav,
 * optional right-utility actions.
 * Returns null when nothing applies (keeps the center pane flush).
 */
export function CenterPaneHeader({
  rightUtility,
  variant,
  presentation = "scout",
  onOpenSearch,
  onInteractiveMouseDown,
}: {
  /** Right-aligned utility slot for screen-level header actions. */
  rightUtility?: ReactNode;
  /**
   * "top-row" renders the header as the fixed app-wide top row (SCO-087):
   * always mounted, no sticky, sits inside a drag-region wrapper.
   */
  variant?: "top-row";
  presentation?: "scout" | "slack";
  onOpenSearch?: () => void;
  /** Marks interactive groups no-drag when hosted inside a drag region. */
  onInteractiveMouseDown?: (event: MouseEvent) => void;
} = {}) {
  const { route, navigate, navigateBack, canNavigateBack, navigateForward, canNavigateForward } = useScout();
  const breadcrumb = routeBreadcrumbForRoute(route);
  const meshOpsEnabled = useOptionalFlag("surface.mesh-ops", false);
  const boardsEnabled = useOptionalFlag("surface.board", false);
  const reviewEnabled = useOptionalFlag("surface.review", false);
  const canvasEnabled = useOptionalFlag("surface.canvas", false);
  const feedEnabled = useOptionalFlag("surface.feed", true);
  const opsControlEnabled = useOptionalFlag("ops.control", true);
  const scope = useProjectScope();
  const scoped = <T extends { areaId: string; items: AreaSubNavItem[] }>(nav: T | null): T | null =>
    nav && nav.areaId === "work" ? { ...nav, items: scopeProjectTabs(nav.items, scope) } : nav;
  const subNav = scoped(areaSubNavForRoute(route, { meshOpsEnabled, boardsEnabled, reviewEnabled, canvasEnabled, feedEnabled }));
  // The top row's strip: the area's pages, under one treatment.
  // Work's project tabs carry the project picked in its list.
  const areaTabs = scoped(sidebarSubNavForRoute(route, {
    opsControlEnabled, meshOpsEnabled, boardsEnabled, reviewEnabled, canvasEnabled, feedEnabled,
  }));
  const isTopRow = variant === "top-row";
  const showSecondaryRow = Boolean(subNav);

  // The top row is the app frame: it always mounts (it hosts machine scope +
  // utilities + the drag region), even on flush landings with no crumb/sub-nav.
  if (!isTopRow && !breadcrumb && !subNav && !rightUtility) {
    return null;
  }

  // SCO-087b: the secondary content nav (the area sub-nav) is the
  // "tabs" the user wants OUT of the title bar. Shared by both variants.
  const secondaryNav = showSecondaryRow ? (
    <>
      {subNav ? (
        <AreaSubNavStrip items={subNav.items} route={route} navigate={navigate} />
      ) : null}
    </>
  ) : null;

  // SCO-088b/c: ONE 40px top row. It LEADS with the current section name in title
  // form (the primary-area label, e.g. "Sessions"), breadcrumb-style: section name
  // · " / " · the AREA_SUB_NAV tabs. When the area has no sub-nav, only the section
  // name shows (no slash, no duplication). Using the section label — not the deep
  // route breadcrumb — avoids a dim leaf that duplicates the active tab (the old
  // /ops/lanes "Lanes" case). Tabs never wrap; they scroll. Utilities pinned right.
  if (isTopRow) {
    const entryId = primaryAreaForRoute(route);
    const sectionName = getPrimaryArea(entryId).label;
    if (presentation === "slack") {
      const slackSectionName = primaryAreaForRoute(route) === "chat"
        ? "Home"
        : primaryAreaForRoute(route) === "home"
          ? "Activity"
          : sectionName;
      return (
        <div
          className="scout-center-pane-header scout-center-pane-header--top-row scout-slack-topbar"
          data-scout-center-pane-header=""
          data-scout-top-row=""
          data-presentation="slack"
        >
          <div
            className="scout-slack-topbar-history"
            onMouseDown={onInteractiveMouseDown}
          >
            <button
              type="button"
              aria-label="Go back"
              title="Go back"
              onClick={() => window.history.back()}
            >
              <ArrowLeft size={16} strokeWidth={1.8} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Go forward"
              title="Go forward"
              onClick={() => window.history.forward()}
            >
              <ArrowRight size={16} strokeWidth={1.8} aria-hidden />
            </button>
            <span>{slackSectionName}</span>
          </div>

          <button
            type="button"
            className="scout-slack-topbar-search"
            aria-label="Search Scout"
            onMouseDown={onInteractiveMouseDown}
            onClick={onOpenSearch}
          >
            <Search size={15} strokeWidth={1.8} aria-hidden />
            <span>Search Scout</span>
            <kbd>⌘K</kbd>
          </button>

          {rightUtility ? (
            <div
              className="scout-center-pane-header-utility scout-slack-topbar-utility"
              data-scout-header-utility=""
              onMouseDown={onInteractiveMouseDown}
            >
              {rightUtility}
            </div>
          ) : <span />}
        </div>
      );
    }

    return (
      <TopRowView
        back={{ enabled: canNavigateBack, onBack: navigateBack }}
        forward={navigateForward ? { enabled: canNavigateForward ?? true, onForward: navigateForward } : undefined}
        tabs={areaTabs ? (
          <AreaSubNavStrip items={areaTabs.items} route={route} navigate={navigate} />
        ) : undefined}
        sectionName={sectionName}
        rightUtility={rightUtility}
        hasSecondaryRow={showSecondaryRow}
        onInteractiveMouseDown={onInteractiveMouseDown}
      />
    );
  }

  // Legacy / non-top-row seam (kept single-row for the ?ff.nav.sidebar=off path).
  return (
    <div
      className="scout-center-pane-header"
      data-scout-center-pane-header=""
    >
      <div className="scout-center-pane-header-main" onMouseDown={onInteractiveMouseDown}>
        {breadcrumb ? (
          <div className="scout-center-pane-breadcrumb" data-scout-breadcrumb="">
            <span className="scout-nav-crumb">{breadcrumb}</span>
          </div>
        ) : null}
        {secondaryNav}
      </div>
      {rightUtility ? (
        <div
          className="scout-center-pane-header-utility"
          data-scout-header-utility=""
          onMouseDown={onInteractiveMouseDown}
        >
          {rightUtility}
        </div>
      ) : null}
    </div>
  );
}
