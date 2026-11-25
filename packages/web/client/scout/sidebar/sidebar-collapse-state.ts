/**
 * Pure sidebar collapse + resize transitions (SCO-084 / SCO-086).
 * Kept free of React so unit tests do not load the hook module.
 */

/** Shared collapsed width for all rails (sidebar, side rail, inspector). */
export const RAIL_COLLAPSED_WIDTH = 48;

/** Slack presentation gives the primary destination rail a calmer 56px measure. */
export const SLACK_SIDEBAR_COLLAPSED_WIDTH = 56;

/**
 * Shared vertical slot grid for every collapsed rail (primary, context, inspector).
 * Slot N starts at: RAIL_SLOT_TOP + N * RAIL_SLOT_ROW.
 * Keep in sync with the CSS vars on `html[data-scout-sidebar-chrome]` (app.css).
 */
export const RAIL_SLOT_CELL = 32;
export const RAIL_SLOT_GAP = 6;
export const RAIL_SLOT_ROW = RAIL_SLOT_CELL + RAIL_SLOT_GAP;
/** Top pad before slot 0 — brand / first chip / first inspector glyph. */
export const RAIL_SLOT_TOP = 8;

/**
 * The header band — 32px, on EVERY column, in BOTH states, and the height of
 * every page's top bar, so one hairline runs across the window.
 *
 * This is the one law the collapse control obeys: the toggle occupies the same
 * cell whether the column is open or shut, so collapse/expand happens in place
 * (the glyph flips, nothing moves). It also keeps the header hairline running
 * unbroken across the window — collapsing a column used to delete its band and
 * punch a hole in the line that runs NAVIGATE -> HOME -> CONTEXT.
 *
 * Collapsed rails therefore RESERVE this band before slot 0, which is what puts
 * all three columns' first content row on one baseline (band + top pad).
 *
 * The band was 44px (the mobile panel-header height) but that left a slab of
 * dead space above the first destination in the nav rail, which carries no
 * panel title. It is the chevron (RAIL_TOGGLE_HEIGHT) plus 2px above and below,
 * and RAIL_TOGGLE_HEADER_TOP centres the chevron in it.
 */
export const RAIL_TOGGLE_HEIGHT = 28;
export const RAIL_HEADER_HEIGHT = 32;
export const RAIL_TOGGLE_WIDTH = 22;
export const RAIL_TOGGLE_HEADER_TOP = Math.round(
  (RAIL_HEADER_HEIGHT - RAIL_TOGGLE_HEIGHT) / 2,
);
/**
 * The BASIC shell has no header band below a top row: its rail toggle lives in
 * the sidebar's 40px BRAND cell, so it centres on the brand, not the band. Keep
 * in sync with `[data-sidebar="brand-row"] { height }` in app.css.
 */
export const RAIL_BRAND_CELL_HEIGHT = 40;
export const RAIL_TOGGLE_BRAND_TOP = Math.round(
  (RAIL_BRAND_CELL_HEIGHT - RAIL_TOGGLE_HEIGHT) / 2,
);
/** Inline inset of the toggle from the column's inner edge when expanded. */
export const RAIL_BAND_INSET = 8;

/**
 * Distance from a column's OUTER edge to its band toggle.
 *
 * Expanded, the toggle tucks against the inner edge (`width - inset - w`); it is
 * part of the column it governs, not a widget balanced on the seam — the seam
 * belongs to resize. Collapsed, the rail centres it. Left columns apply the
 * result as `left`, the inspector as `right`; the formula is the same for both.
 *
 * `collapsedWidth` exists because the Slack presentation gives the primary rail a
 * 56px collapsed measure (see SLACK_SIDEBAR_COLLAPSED_WIDTH) — centring against a
 * hardcoded 48 would park its toggle 4px left of its own centre line.
 */
export function railToggleOffset(
  width: number,
  collapsed: boolean,
  collapsedWidth: number = RAIL_COLLAPSED_WIDTH,
): number {
  if (collapsed) {
    return Math.round((collapsedWidth - RAIL_TOGGLE_WIDTH) / 2);
  }
  // Guard NaN like every other measure in this module: `Math.max(8, NaN)` is
  // NaN, which would reach the DOM as `left: NaN` and drop the control out of
  // the band entirely.
  if (!Number.isFinite(width)) return RAIL_BAND_INSET;
  return Math.max(
    RAIL_BAND_INSET,
    Math.round(width) - RAIL_BAND_INSET - RAIL_TOGGLE_WIDTH,
  );
}

/** @deprecated Prefer RAIL_COLLAPSED_WIDTH — same value, shared across rails. */
export const SIDEBAR_COLLAPSED_WIDTH = RAIL_COLLAPSED_WIDTH;

/** Default expanded sidebar width (also the double-click reset target). */
export const SIDEBAR_EXPANDED_WIDTH = 260;
/**
 * The collapse magnet: a dragged rail edge flows freely down to this many px
 * above the collapsed width, then snaps shut. Released inside the snap, the
 * rail collapses; released outside it, the rail keeps the dragged width.
 */
export const RAIL_COLLAPSE_SNAP = 10;
/** The narrowest expanded sidebar: the collapsed rail plus the snap. */
export const SIDEBAR_MIN_WIDTH = RAIL_COLLAPSED_WIDTH + RAIL_COLLAPSE_SNAP;
export const SIDEBAR_MAX_WIDTH = 360;
// Auto-collapse only when the window is genuinely cramped: expanded sidebar
// (260) + ~600px of usable content. 1023 collapsed on ordinary half-screen
// windows, which read as the shell fighting the operator.
export const SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH = 880;

/**
 * Side rail (context panel) width. There is no minimum as a layout rule: the
 * rail is as wide as the operator drags it, and its rows adapt (titles
 * ellipsize, then secondary columns drop, then a row is its glyph and name;
 * each rail's CSS holds its own container rules). The one floor is the
 * collapse magnet: the edge flows freely until it is RAIL_COLLAPSE_SNAP px
 * from the collapsed width, then snaps to it, and a release there collapses
 * the rail to its icon state.
 *
 * Docked sides on a composition (DockedSides.tsx) fold at the same point.
 * Persisted under the shell's `appshell.<id>.leftW.v2` key; a width stored under
 * an older band is already inside this one. Double-click resets to
 * SIDE_RAIL_DEFAULT_WIDTH.
 */
export const SIDE_RAIL_DEFAULT_WIDTH = 320;
/**
 * Every page's side panes open at this width: the list on the left and the
 * inspector on the right, docked (DockedSides) or in the shell. One width, so
 * the content between them starts and ends in the same place from page to page.
 */
export const PANE_SIDE_WIDTH = SIDE_RAIL_DEFAULT_WIDTH;
export const SIDE_RAIL_COLLAPSE_BELOW = RAIL_COLLAPSED_WIDTH + RAIL_COLLAPSE_SNAP;
export const SIDE_RAIL_MAX_WIDTH = 400;

/** The side rail's drag band: no settle zone, so a drag above the collapse point lands where it ends. */
export const SIDE_RAIL_DRAG_BAND = {
  min: SIDE_RAIL_COLLAPSE_BELOW,
  max: SIDE_RAIL_MAX_WIDTH,
  collapseMargin: 0,
} as const;

/** Clamp a side-rail width into [collapse point, max] (rounds; NaN → default). */
export function clampSideRailWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDE_RAIL_DEFAULT_WIDTH;
  return Math.max(
    SIDE_RAIL_COLLAPSE_BELOW,
    Math.min(SIDE_RAIL_MAX_WIDTH, Math.round(width)),
  );
}

/**
 * Drag-through-collapse thresholds (SCO-088b §2).
 * - Collapse commits when a live inward drag drops this far below the min width.
 *   Both rails use the collapse magnet instead, with a margin of 0: the sidebar
 *   and the side rail collapse below their collapsed width plus
 *   RAIL_COLLAPSE_SNAP, and otherwise keep the dragged width. The default
 *   margin remains for callers that keep a settle zone under their min.
 * - Expand-from-collapsed commits when the collapsed edge is dragged out at least
 *   this many px (a tiny accidental drag snaps back with no state change).
 */
export const RAIL_DRAG_COLLAPSE_MARGIN = 40;
export const RAIL_DRAG_EXPAND_TRAVEL = 24;

/**
 * Live ghost width the dragged edge previews (SCO-088b §2 + addendum). Continuous
 * from the collapsed target (48) up to max — never dead-clamped at min, so an
 * inward drag flows toward collapse and an outward drag from a collapsed rail
 * grows from 48. Once an expanded-rail drag passes the collapse threshold the
 * ghost snaps to the 48px collapsed target as a "release = collapse" affordance.
 */
export function resolveRailDragGhostWidth(
  rawWidth: number,
  {
    min,
    max,
    startedCollapsed,
    collapsedWidth = RAIL_COLLAPSED_WIDTH,
    collapseMargin = RAIL_DRAG_COLLAPSE_MARGIN,
  }: {
    min: number;
    max: number;
    startedCollapsed: boolean;
    collapsedWidth?: number;
    collapseMargin?: number;
  },
): number {
  if (!Number.isFinite(rawWidth)) {
    return startedCollapsed ? collapsedWidth : min;
  }
  const clamped = Math.max(
    collapsedWidth,
    Math.min(max, Math.round(rawWidth)),
  );
  if (startedCollapsed) return clamped;
  const collapseThreshold = min - collapseMargin;
  return clamped < collapseThreshold ? collapsedWidth : clamped;
}

/** What a rail edge-drag commits on pointer-up (SCO-088b §2). */
export type RailDragCommit =
  | { kind: "collapse" }
  | { kind: "expand" }
  | { kind: "resize"; width: number }
  | { kind: "none" };

/**
 * Decide what a rail drag commits on pointer-up (SCO-088b §2). Uses the RAW live
 * width (not the snapped ghost) so the collapse/resize boundary is exact.
 * - started collapsed → `expand` past the outward-travel threshold, else `none`.
 * - started expanded → `collapse` below `min − margin`, else `resize` clamped to
 *   [min, max] (so between the collapse threshold and min it settles at min).
 */
export function resolveRailDragCommit(
  { startedCollapsed, rawWidth }: { startedCollapsed: boolean; rawWidth: number },
  {
    min,
    max,
    collapsedWidth = RAIL_COLLAPSED_WIDTH,
    collapseMargin = RAIL_DRAG_COLLAPSE_MARGIN,
  }: { min: number; max: number; collapsedWidth?: number; collapseMargin?: number },
): RailDragCommit {
  const w = Number.isFinite(rawWidth) ? Math.round(rawWidth) : min;
  if (startedCollapsed) {
    return w >= collapsedWidth + RAIL_DRAG_EXPAND_TRAVEL
      ? { kind: "expand" }
      : { kind: "none" };
  }
  const collapseThreshold = min - collapseMargin;
  if (w < collapseThreshold) return { kind: "collapse" };
  return { kind: "resize", width: Math.max(min, Math.min(max, w)) };
}

export type SidebarCollapseSnapshot = {
  manualCollapsed: boolean;
  autoCollapsed: boolean;
  forceExpanded: boolean;
};

/** Pure: effective collapsed state from preferences + viewport-derived flags. */
export function resolveEffectiveCollapsed(
  snapshot: SidebarCollapseSnapshot,
): boolean {
  return snapshot.autoCollapsed
    ? !snapshot.forceExpanded
    : snapshot.manualCollapsed;
}

/**
 * A caller's own floor and ceiling for the expanded sidebar. Without one the
 * band is the shared one (min SIDEBAR_MIN_WIDTH, max SIDEBAR_MAX_WIDTH, no
 * settle zone), so existing callers behave as before.
 */
export type SidebarWidthBounds = { min: number; max: number };

export type SidebarDragBand = { min: number; max: number; collapseMargin: number };

/**
 * The drag band for a sidebar. With bounds, an inward drag released between
 * the halfway point (collapsed width to min) and min settles at min instead
 * of leaving a column too narrow to read; released below halfway, it
 * collapses. The collapse point is never under the shared snap.
 */
export function sidebarDragBand(
  collapsedWidth: number,
  bounds?: SidebarWidthBounds | null,
): SidebarDragBand {
  const floor = collapsedWidth + RAIL_COLLAPSE_SNAP;
  if (!bounds) {
    return { min: Math.max(SIDEBAR_MIN_WIDTH, floor), max: SIDEBAR_MAX_WIDTH, collapseMargin: 0 };
  }
  // The shared ceiling still holds: resolveSidebarWidth clamps to it.
  const max = Math.min(SIDEBAR_MAX_WIDTH, Math.max(floor, Math.round(bounds.max)));
  const min = Math.min(max, Math.max(floor, Math.round(bounds.min)));
  const collapseAt = Math.max(floor, Math.round((collapsedWidth + min) / 2));
  return { min, max, collapseMargin: min - collapseAt };
}

/** Clamp an expanded width into a band (rounds; NaN → fallback, clamped). */
export function clampSidebarWidthToBand(
  width: number,
  band: { min: number; max: number },
  fallback: number = SIDEBAR_EXPANDED_WIDTH,
): number {
  const value = Number.isFinite(width) ? Math.round(width) : fallback;
  return Math.max(band.min, Math.min(band.max, value));
}

/**
 * The ghost edge for a band with a settle zone: between the collapse point and
 * min it shows min, where the release will land. Without a settle zone the
 * ghost below min is already the collapsed width, so this changes nothing.
 */
export function settleRailDragGhost(
  ghostWidth: number,
  band: { min: number },
  startedCollapsed: boolean,
  collapsedWidth: number,
): number {
  if (startedCollapsed) return ghostWidth;
  return ghostWidth > collapsedWidth && ghostWidth < band.min ? band.min : ghostWidth;
}

/** Clamp expanded sidebar width to the SCO-086 min/max band. */
export function clampSidebarExpandedWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_EXPANDED_WIDTH;
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)),
  );
}

/**
 * Resolve layout width from collapse + live/persisted expanded width.
 * Collapsed always uses RAIL_COLLAPSED_WIDTH; expanded uses the clamped value.
 */
export function resolveSidebarWidth(
  effectiveCollapsed: boolean,
  expandedWidth: number = SIDEBAR_EXPANDED_WIDTH,
  collapsedWidth: number = RAIL_COLLAPSED_WIDTH,
): number {
  return effectiveCollapsed
    ? collapsedWidth
    : clampSidebarExpandedWidth(expandedWidth);
}

/**
 * Pure, idempotent setCollapsed transition.
 * Wide viewport → manualCollapsed; auto-collapse viewport → forceExpanded only.
 */
export function applySetCollapsed(
  snapshot: SidebarCollapseSnapshot,
  nextCollapsed: boolean,
): Pick<SidebarCollapseSnapshot, "manualCollapsed" | "forceExpanded"> {
  if (snapshot.autoCollapsed) {
    return {
      manualCollapsed: snapshot.manualCollapsed,
      forceExpanded: !nextCollapsed,
    };
  }
  return {
    manualCollapsed: nextCollapsed,
    forceExpanded: snapshot.forceExpanded,
  };
}

/** Pure toggle of the active preference layer. */
export function applyToggleCollapsed(
  snapshot: SidebarCollapseSnapshot,
): Pick<SidebarCollapseSnapshot, "manualCollapsed" | "forceExpanded"> {
  const effective = resolveEffectiveCollapsed(snapshot);
  return applySetCollapsed(snapshot, !effective);
}
