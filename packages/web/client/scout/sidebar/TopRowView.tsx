/**
 * The app frame's top row, as markup: back, the area's tabs (or its name) and
 * the utilities on the right.
 *
 * Presentation only. `CenterPaneHeader` resolves the route into it on the
 * local app; a build without the broker (Hosted Chat) passes its own.
 */
import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { BackGlyph } from "../../components/ScoutGlyph.tsx";
import type { Route } from "../../lib/types.ts";
import type { AreaSubNavItem } from "../nav-destinations.ts";

export function AreaSubNavStrip({
  items,
  route,
  navigate,
  className = "",
}: {
  items: AreaSubNavItem[];
  route: Route;
  navigate: (route: Route) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      className={`scout-area-subnav${className ? ` ${className}` : ""}`}
      aria-label="Area sub-navigation"
      data-scout-area-subnav=""
    >
      {items.map((item) => {
        const active = item.active(route);
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            className={`scout-area-subnav-item${active ? " scout-area-subnav-item--active" : ""}`}
            onClick={() => navigate(item.route)}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Half the widest centred Search (frame.css), and the gap the tabs keep from it. */
const CENTRED_SEARCH_HALF = 180;
/** Half the narrow centred Search an area with many tabs gets before Search has to move. */
const NARROW_SEARCH_HALF = 110;
const SEARCH_GAP = 20;

/**
 * Whether the tabs, at their full width, end past the left edge of the Search
 * centred in the window. top-row-actions.css then moves Search into the right
 * cluster so the tabs keep their width. Measured from the tabs' own left edge
 * and natural width, so moving Search does not change the answer.
 */
export function tabsCrowdSearch(tabsLeft: number, tabsWidth: number, windowWidth: number): boolean {
  return tabsLeft + tabsWidth > windowWidth / 2 - NARROW_SEARCH_HALF - SEARCH_GAP;
}

/**
 * Whether the tabs reach the full-width centred Search but clear the narrow
 * one. Search then stays in the middle of the window, narrower, so it sits in
 * the same place on every page; it moves only when even the narrow box would
 * touch the tabs.
 */
export function tabsNarrowSearch(tabsLeft: number, tabsWidth: number, windowWidth: number): boolean {
  return tabsLeft + tabsWidth > windowWidth / 2 - CENTRED_SEARCH_HALF - SEARCH_GAP
    && !tabsCrowdSearch(tabsLeft, tabsWidth, windowWidth);
}

function useCrowdedTabs(rowRef: { current: HTMLDivElement | null }) {
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined") return;
    const measure = () => {
      const tabs = row.querySelector<HTMLElement>("[data-scout-area-subnav]");
      const left = tabs?.getBoundingClientRect().left ?? 0;
      const width = tabs?.scrollWidth ?? 0;
      const crowded = Boolean(tabs) && tabsCrowdSearch(left, width, window.innerWidth);
      const narrow = Boolean(tabs) && tabsNarrowSearch(left, width, window.innerWidth);
      if (crowded) row.setAttribute("data-scout-tabs-crowded", "");
      else row.removeAttribute("data-scout-tabs-crowded");
      if (narrow) row.setAttribute("data-scout-search-narrow", "");
      else row.removeAttribute("data-scout-search-narrow");
    };
    measure();
    // The sidebar's width moves the tabs without resizing the window.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(row);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  });
}

export function TopRowView({
  back,
  forward,
  tabs,
  sectionName,
  rightUtility,
  hasSecondaryRow = false,
  onInteractiveMouseDown,
}: {
  /** The back control; left out where there is no history to walk. */
  back?: { enabled: boolean; onBack: () => void };
  /** Forward, beside Back; left out by builds without browser history. */
  forward?: { enabled: boolean; onForward: () => void };
  /** The area's pages as tabs; with none, the row names the area. */
  tabs?: ReactNode;
  sectionName: string;
  rightUtility?: ReactNode;
  hasSecondaryRow?: boolean;
  /** Marks interactive groups no-drag when hosted inside a drag region. */
  onInteractiveMouseDown?: (event: MouseEvent) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useCrowdedTabs(rowRef);
  return (
    <div
      ref={rowRef}
      className="scout-center-pane-header scout-center-pane-header--top-row"
      data-scout-center-pane-header=""
      data-scout-top-row=""
      data-scout-has-secondary-row={hasSecondaryRow ? "" : undefined}
    >
      <div
        className="scout-center-pane-header-main"
        onMouseDown={onInteractiveMouseDown}
      >
        {back ? (
          <button
            type="button"
            className="scout-top-row-back"
            aria-label="Back"
            aria-keyshortcuts="Meta+["
            title="Back (⌘[)"
            disabled={!back.enabled}
            onClick={back.onBack}
          >
            <BackGlyph size={15} aria-hidden="true" />
          </button>
        ) : null}
        {forward ? (
          <button
            type="button"
            className="scout-top-row-back scout-top-row-forward"
            aria-label="Forward"
            aria-keyshortcuts="Meta+]"
            title="Forward (⌘])"
            disabled={!forward.enabled}
            onClick={forward.onForward}
          >
            <BackGlyph size={15} aria-hidden="true" />
          </button>
        ) : null}
        {tabs ?? (
          <div className="scout-center-pane-breadcrumb" data-scout-breadcrumb="">
            <span className="scout-nav-crumb">{sectionName}</span>
          </div>
        )}
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
