import { describe, expect, test } from "bun:test";
import {
  RAIL_BAND_INSET,
  RAIL_COLLAPSED_WIDTH,
  RAIL_COLLAPSE_SNAP,
  RAIL_DRAG_COLLAPSE_MARGIN,
  RAIL_DRAG_EXPAND_TRAVEL,
  RAIL_HEADER_HEIGHT,
  RAIL_SLOT_CELL,
  RAIL_SLOT_GAP,
  RAIL_SLOT_ROW,
  RAIL_SLOT_TOP,
  RAIL_TOGGLE_HEADER_TOP,
  RAIL_TOGGLE_HEIGHT,
  RAIL_TOGGLE_WIDTH,
  SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SLACK_SIDEBAR_COLLAPSED_WIDTH,
  SIDE_RAIL_DEFAULT_WIDTH,
  SIDE_RAIL_COLLAPSE_BELOW,
  SIDE_RAIL_DRAG_BAND,
  SIDE_RAIL_MAX_WIDTH,
  applySetCollapsed,
  applyToggleCollapsed,
  clampSidebarWidthToBand,
  clampSideRailWidth,
  settleRailDragGhost,
  sidebarDragBand,
  clampSidebarExpandedWidth,
  resolveEffectiveCollapsed,
  resolveRailDragCommit,
  resolveRailDragGhostWidth,
  resolveSidebarWidth,
  railToggleOffset,
  type SidebarCollapseSnapshot,
} from "./sidebar-collapse-state.ts";

describe("sidebar collapse constants (SCO-083 / SCO-086)", () => {
  test("auto-collapse fires only when genuinely cramped", () => {
    expect(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH).toBe(880);
    // An ordinary half-screen window (~960-1280) must keep its labels.
    expect(960).toBeGreaterThan(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH);
    // The expanded sidebar plus ~600px of content still fits at the boundary.
    expect(SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH).toBeGreaterThanOrEqual(SIDEBAR_EXPANDED_WIDTH + 600);
  });

  test("collapsed slot grid is one shared pitch for every rail", () => {
    expect(RAIL_SLOT_CELL).toBe(32);
    expect(RAIL_SLOT_GAP).toBe(6);
    expect(RAIL_SLOT_ROW).toBe(38);
    expect(RAIL_SLOT_TOP).toBe(8);
    // Slot N starts at TOP + N * ROW — same formula for primary, context, inspector.
    expect(RAIL_SLOT_TOP + 0 * RAIL_SLOT_ROW).toBe(8);
    expect(RAIL_SLOT_TOP + 1 * RAIL_SLOT_ROW).toBe(46);
    expect(RAIL_SLOT_TOP + 2 * RAIL_SLOT_ROW).toBe(84);
  });

  test("the toggle centres in the 32px header band", () => {
    expect(RAIL_HEADER_HEIGHT).toBe(32);
    expect(RAIL_TOGGLE_WIDTH).toBe(22);
    expect(RAIL_TOGGLE_HEIGHT).toBe(28);
    expect(RAIL_TOGGLE_HEADER_TOP).toBe(2);
    expect(RAIL_TOGGLE_HEADER_TOP * 2 + RAIL_TOGGLE_HEIGHT).toBe(RAIL_HEADER_HEIGHT);
  });

  describe("railToggleOffset — one cell, both states", () => {
    test("expanded, the toggle tucks inside the column's inner edge", () => {
      // Never on the seam: the far edge of the control clears the boundary by
      // exactly the band inset.
      expect(railToggleOffset(260, false)).toBe(260 - RAIL_BAND_INSET - RAIL_TOGGLE_WIDTH);
      expect(railToggleOffset(260, false) + RAIL_TOGGLE_WIDTH).toBe(260 - RAIL_BAND_INSET);
      expect(railToggleOffset(260, false)).toBe(230);
    });

    test("collapsed, the toggle centres in the rail", () => {
      expect(railToggleOffset(RAIL_COLLAPSED_WIDTH, true)).toBe(13);
      const offset = railToggleOffset(RAIL_COLLAPSED_WIDTH, true);
      expect(offset + RAIL_TOGGLE_WIDTH + offset).toBe(RAIL_COLLAPSED_WIDTH);
    });

    test("collapsed width is a parameter, so the 56px Slack rail centres too", () => {
      const offset = railToggleOffset(
        SLACK_SIDEBAR_COLLAPSED_WIDTH,
        true,
        SLACK_SIDEBAR_COLLAPSED_WIDTH,
      );
      expect(offset).toBe(17);
      expect(offset + RAIL_TOGGLE_WIDTH + offset).toBe(SLACK_SIDEBAR_COLLAPSED_WIDTH);
    });

    test("a column narrower than the control still keeps it inside", () => {
      // Degenerate widths clamp to the inset rather than going negative and
      // hanging the control off the outer edge.
      expect(railToggleOffset(20, false)).toBe(RAIL_BAND_INSET);
      expect(railToggleOffset(Number.NaN, false)).toBe(RAIL_BAND_INSET);
    });

    test("the collapsed offset does not depend on the remembered width", () => {
      // Collapse must land the control in the same cell no matter how wide the
      // column was — that is the whole point of the in-place toggle.
      expect(railToggleOffset(360, true)).toBe(railToggleOffset(200, true));
    });
  });

  test("expanded and icon-rail widths match the anatomy", () => {
    expect(SIDEBAR_EXPANDED_WIDTH).toBe(260);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBe(48);
    expect(RAIL_COLLAPSED_WIDTH).toBe(48);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBe(RAIL_COLLAPSED_WIDTH);
  });

  test("resize band is min 58 (collapsed + snap) / max 360 / default 260", () => {
    expect(RAIL_COLLAPSE_SNAP).toBe(10);
    expect(SIDEBAR_MIN_WIDTH).toBe(RAIL_COLLAPSED_WIDTH + RAIL_COLLAPSE_SNAP);
    expect(SIDEBAR_MIN_WIDTH).toBe(58);
    expect(SIDEBAR_MAX_WIDTH).toBe(360);
    expect(SIDEBAR_EXPANDED_WIDTH).toBe(260);
  });
});

describe("sidebar resize pure logic (SCO-086)", () => {
  test("clampSidebarExpandedWidth clamps to min/max and rounds", () => {
    expect(clampSidebarExpandedWidth(40)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarExpandedWidth(100)).toBe(100);
    expect(clampSidebarExpandedWidth(500)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarExpandedWidth(250.6)).toBe(251);
    expect(clampSidebarExpandedWidth(Number.NaN)).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  test("resolveSidebarWidth uses expandedWidth when expanded", () => {
    expect(resolveSidebarWidth(true)).toBe(RAIL_COLLAPSED_WIDTH);
    expect(resolveSidebarWidth(false)).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(resolveSidebarWidth(false, 220)).toBe(220);
    expect(resolveSidebarWidth(false, 180)).toBe(180);
    expect(resolveSidebarWidth(false, 50)).toBe(SIDEBAR_MIN_WIDTH);
    expect(resolveSidebarWidth(true, 300)).toBe(RAIL_COLLAPSED_WIDTH);
    expect(
      resolveSidebarWidth(true, 300, SLACK_SIDEBAR_COLLAPSED_WIDTH),
    ).toBe(56);
  });

  test("custom collapsed geometry preserves drag travel", () => {
    const slackRail = {
      min: SLACK_SIDEBAR_COLLAPSED_WIDTH + RAIL_COLLAPSE_SNAP,
      max: SIDEBAR_MAX_WIDTH,
      collapsedWidth: SLACK_SIDEBAR_COLLAPSED_WIDTH,
    };
    expect(
      resolveRailDragGhostWidth(40, {
        ...slackRail,
        startedCollapsed: true,
      }),
    ).toBe(56);
    expect(
      resolveRailDragCommit(
        { startedCollapsed: true, rawWidth: 79 },
        slackRail,
      ),
    ).toEqual({ kind: "none" });
    expect(
      resolveRailDragCommit(
        { startedCollapsed: true, rawWidth: 80 },
        slackRail,
      ),
    ).toEqual({ kind: "expand" });
  });

  test("double-click reset target is SIDEBAR_EXPANDED_WIDTH (260)", () => {
    expect(clampSidebarExpandedWidth(SIDEBAR_EXPANDED_WIDTH)).toBe(260);
  });
});

describe("side-rail resize band (SCO-088 §3)", () => {
  test("no minimum but the collapse magnet: default 320 / collapses below 58 / max 400", () => {
    expect(SIDE_RAIL_DEFAULT_WIDTH).toBe(320);
    expect(SIDE_RAIL_COLLAPSE_BELOW).toBe(RAIL_COLLAPSED_WIDTH + RAIL_COLLAPSE_SNAP);
    expect(SIDE_RAIL_DRAG_BAND).toEqual({ min: 58, max: 400, collapseMargin: 0 });
    expect(SIDE_RAIL_MAX_WIDTH).toBe(400);
  });

  test("clampSideRailWidth clamps + rounds; NaN → default", () => {
    expect(clampSideRailWidth(40)).toBe(58);
    expect(clampSideRailWidth(100)).toBe(100);
    // a width stored under the old 240–400 band keeps its value
    expect(clampSideRailWidth(240)).toBe(240);
    expect(clampSideRailWidth(130)).toBe(130);
    expect(clampSideRailWidth(999)).toBe(400);
    expect(clampSideRailWidth(300.6)).toBe(301);
    expect(clampSideRailWidth(Number.NaN)).toBe(320);
  });
});

describe("drag-through-collapse ghost width (SCO-088b §2 + addendum)", () => {
  // A band with a settle zone under its min (the default margin), as callers
  // other than the two rails may use.
  const SETTLE_MIN = 200;
  const sidebar = { min: SETTLE_MIN, max: SIDEBAR_MAX_WIDTH };
  const collapseThreshold = SETTLE_MIN - RAIL_DRAG_COLLAPSE_MARGIN; // 160

  test("expanded drag: continuous, NOT dead-clamped at min", () => {
    // Above min: tracks the pointer.
    expect(
      resolveRailDragGhostWidth(300, { ...sidebar, startedCollapsed: false }),
    ).toBe(300);
    // Between the collapse threshold and min: flows BELOW min (shows direction),
    // never dead-clamps at min.
    expect(
      resolveRailDragGhostWidth(180, { ...sidebar, startedCollapsed: false }),
    ).toBe(180);
    expect(180).toBeLessThan(SETTLE_MIN);
    expect(180).toBeGreaterThanOrEqual(collapseThreshold);
  });

  test("expanded drag past the collapse threshold snaps the ghost to 48", () => {
    expect(
      resolveRailDragGhostWidth(collapseThreshold - 1, {
        ...sidebar,
        startedCollapsed: false,
      }),
    ).toBe(RAIL_COLLAPSED_WIDTH);
    expect(
      resolveRailDragGhostWidth(60, { ...sidebar, startedCollapsed: false }),
    ).toBe(RAIL_COLLAPSED_WIDTH);
  });

  test("collapsed drag: grows continuously from 48, never snaps", () => {
    expect(
      resolveRailDragGhostWidth(48, { ...sidebar, startedCollapsed: true }),
    ).toBe(48);
    expect(
      resolveRailDragGhostWidth(120, { ...sidebar, startedCollapsed: true }),
    ).toBe(120);
    // Clamped to max at the top.
    expect(
      resolveRailDragGhostWidth(999, { ...sidebar, startedCollapsed: true }),
    ).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("drag commit decision (SCO-088b §2)", () => {
  const sidebar = { min: 200, max: SIDEBAR_MAX_WIDTH };
  const sideRail = SIDE_RAIL_DRAG_BAND;

  test("expanded → collapse below (min − 40)", () => {
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 159 }, sidebar),
    ).toEqual({ kind: "collapse" });
    // The side rail has no settle zone, only the collapse magnet: inside the
    // 10px snap above the collapsed rail it collapses, above it it keeps the
    // width the drag ended at.
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 57 }, sideRail),
    ).toEqual({ kind: "collapse" });
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 58 }, sideRail),
    ).toEqual({ kind: "resize", width: 58 });
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 90 }, sideRail),
    ).toEqual({ kind: "resize", width: 90 });
    // its ghost flows freely and snaps to the collapsed rail only inside the snap
    expect(resolveRailDragGhostWidth(59, { ...sideRail, startedCollapsed: false })).toBe(59);
    expect(resolveRailDragGhostWidth(57, { ...sideRail, startedCollapsed: false })).toBe(RAIL_COLLAPSED_WIDTH);
  });

  test("expanded → resize clamped to [min,max] between threshold and min, and above", () => {
    // Between threshold (160) and min (200): settles at min.
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 180 }, sidebar),
    ).toEqual({ kind: "resize", width: 200 });
    // Normal resize.
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 300 }, sidebar),
    ).toEqual({ kind: "resize", width: 300 });
    // Above max clamps.
    expect(
      resolveRailDragCommit({ startedCollapsed: false, rawWidth: 999 }, sidebar),
    ).toEqual({ kind: "resize", width: SIDEBAR_MAX_WIDTH });
  });

  test("collapsed → expand only past the outward-travel threshold", () => {
    const justUnder = RAIL_COLLAPSED_WIDTH + RAIL_DRAG_EXPAND_TRAVEL - 1;
    const atThreshold = RAIL_COLLAPSED_WIDTH + RAIL_DRAG_EXPAND_TRAVEL;
    expect(
      resolveRailDragCommit({ startedCollapsed: true, rawWidth: justUnder }, sidebar),
    ).toEqual({ kind: "none" });
    expect(
      resolveRailDragCommit({ startedCollapsed: true, rawWidth: atThreshold }, sidebar),
    ).toEqual({ kind: "expand" });
  });
});

describe("sidebar collapse pure transitions (SCO-084)", () => {
  const wide: SidebarCollapseSnapshot = {
    manualCollapsed: false,
    autoCollapsed: false,
    forceExpanded: false,
  };
  const narrow: SidebarCollapseSnapshot = {
    manualCollapsed: false,
    autoCollapsed: true,
    forceExpanded: false,
  };

  test("wide viewport uses manualCollapsed for effective state", () => {
    expect(resolveEffectiveCollapsed(wide)).toBe(false);
    expect(resolveEffectiveCollapsed({ ...wide, manualCollapsed: true })).toBe(true);
    expect(resolveSidebarWidth(true)).toBe(SIDEBAR_COLLAPSED_WIDTH);
    expect(resolveSidebarWidth(false)).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  test("narrow viewport derives collapse unless forceExpanded", () => {
    expect(resolveEffectiveCollapsed(narrow)).toBe(true);
    expect(resolveEffectiveCollapsed({ ...narrow, forceExpanded: true })).toBe(false);
    // Manual preference does not affect narrow derived collapse.
    expect(
      resolveEffectiveCollapsed({ ...narrow, manualCollapsed: false, forceExpanded: false }),
    ).toBe(true);
  });

  test("setCollapsed on wide viewport updates manual only", () => {
    const collapse = applySetCollapsed(wide, true);
    expect(collapse.manualCollapsed).toBe(true);
    expect(collapse.forceExpanded).toBe(false);

    const expand = applySetCollapsed({ ...wide, manualCollapsed: true }, false);
    expect(expand.manualCollapsed).toBe(false);
    expect(expand.forceExpanded).toBe(false);
  });

  test("setCollapsed on narrow viewport updates forceExpanded only (never manual)", () => {
    const expand = applySetCollapsed(
      { ...narrow, manualCollapsed: true },
      false,
    );
    expect(expand.manualCollapsed).toBe(true); // preserved
    expect(expand.forceExpanded).toBe(true);

    const collapse = applySetCollapsed(
      { ...narrow, manualCollapsed: true, forceExpanded: true },
      true,
    );
    expect(collapse.manualCollapsed).toBe(true); // preserved
    expect(collapse.forceExpanded).toBe(false);
  });

  test("setCollapsed is idempotent for already-desired state", () => {
    const again = applySetCollapsed({ ...wide, manualCollapsed: true }, true);
    expect(again.manualCollapsed).toBe(true);

    const againNarrow = applySetCollapsed(
      { ...narrow, forceExpanded: true },
      false,
    );
    expect(againNarrow.forceExpanded).toBe(true);
  });

  test("toggle uses the active preference layer", () => {
    const wideToggle = applyToggleCollapsed(wide);
    expect(wideToggle.manualCollapsed).toBe(true);
    expect(wideToggle.forceExpanded).toBe(false);

    const narrowToggle = applyToggleCollapsed(narrow);
    expect(narrowToggle.manualCollapsed).toBe(false);
    expect(narrowToggle.forceExpanded).toBe(true);
  });

  test("onOpenChange must not map to setManualCollapsed(!open) on narrow", () => {
    // Regression guard for the Codex correction: if open=true on a narrow
    // viewport, we set forceExpanded, never flip manualCollapsed.
    const open = true;
    const nextCollapsed = !open;
    const next = applySetCollapsed(
      { manualCollapsed: false, autoCollapsed: true, forceExpanded: false },
      nextCollapsed,
    );
    expect(next.manualCollapsed).toBe(false);
    expect(next.forceExpanded).toBe(true);
  });
});

describe("collapse magnet on the main sidebar band", () => {
  const magnet = (collapsedWidth: number) => ({
    min: Math.max(SIDEBAR_MIN_WIDTH, collapsedWidth + RAIL_COLLAPSE_SNAP),
    max: SIDEBAR_MAX_WIDTH,
    collapseMargin: 0,
    collapsedWidth,
  });

  test("flows freely down to the snap, then snaps to the collapsed width", () => {
    const band = magnet(RAIL_COLLAPSED_WIDTH);
    expect(resolveRailDragGhostWidth(120, { ...band, startedCollapsed: false })).toBe(120);
    expect(resolveRailDragGhostWidth(58, { ...band, startedCollapsed: false })).toBe(58);
    expect(resolveRailDragGhostWidth(57, { ...band, startedCollapsed: false })).toBe(48);
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 120 }, band)).toEqual({ kind: "resize", width: 120 });
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 57 }, band)).toEqual({ kind: "collapse" });
  });

  test("the snap is measured from the sidebar's own collapsed width", () => {
    const band = magnet(SLACK_SIDEBAR_COLLAPSED_WIDTH);
    expect(resolveRailDragGhostWidth(65, { ...band, startedCollapsed: false })).toBe(56);
    expect(resolveRailDragGhostWidth(66, { ...band, startedCollapsed: false })).toBe(66);
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 65 }, band)).toEqual({ kind: "collapse" });
  });
});

describe("caller width bounds (sidebarDragBand)", () => {
  test("without bounds the band is the shared one, so existing callers are unchanged", () => {
    expect(sidebarDragBand(SLACK_SIDEBAR_COLLAPSED_WIDTH)).toEqual({
      min: Math.max(SIDEBAR_MIN_WIDTH, SLACK_SIDEBAR_COLLAPSED_WIDTH + RAIL_COLLAPSE_SNAP),
      max: SIDEBAR_MAX_WIDTH,
      collapseMargin: 0,
    });
    expect(sidebarDragBand(RAIL_COLLAPSED_WIDTH, null).min).toBe(SIDEBAR_MIN_WIDTH);
  });

  test("bounds raise the floor and settle a release between halfway and min at min", () => {
    const band = sidebarDragBand(SLACK_SIDEBAR_COLLAPSED_WIDTH, { min: 248, max: 360 });
    expect(band).toEqual({ min: 248, max: 360, collapseMargin: 248 - 152 });
    const opts = { ...band, collapsedWidth: SLACK_SIDEBAR_COLLAPSED_WIDTH };
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 90 }, opts)).toEqual({ kind: "collapse" });
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 160 }, opts)).toEqual({ kind: "resize", width: 248 });
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 300 }, opts)).toEqual({ kind: "resize", width: 300 });
    expect(resolveRailDragCommit({ startedCollapsed: false, rawWidth: 500 }, opts)).toEqual({ kind: "resize", width: 360 });
  });

  test("bounds never exceed the shared ceiling or sit under the collapse snap", () => {
    expect(sidebarDragBand(56, { min: 20, max: 900 })).toEqual({ min: 66, max: SIDEBAR_MAX_WIDTH, collapseMargin: 0 });
  });

  test("a stored width under the floor reads as the floor; NaN reads as the default", () => {
    const band = sidebarDragBand(56, { min: 248, max: 360 });
    expect(clampSidebarWidthToBand(66, band)).toBe(248);
    expect(clampSidebarWidthToBand(Number.NaN, band, 320)).toBe(320);
    expect(clampSidebarWidthToBand(410, band)).toBe(360);
  });

  test("the ghost shows where a release lands inside the settle zone", () => {
    const band = sidebarDragBand(56, { min: 248, max: 360 });
    const ghost = (raw: number, startedCollapsed = false) => settleRailDragGhost(
      resolveRailDragGhostWidth(raw, { ...band, startedCollapsed, collapsedWidth: 56 }),
      band,
      startedCollapsed,
      56,
    );
    expect(ghost(100)).toBe(56);
    expect(ghost(200)).toBe(248);
    expect(ghost(300)).toBe(300);
    expect(ghost(120, true)).toBe(120);
    // No settle zone: unchanged from the shared ghost.
    const shared = sidebarDragBand(56);
    expect(settleRailDragGhost(resolveRailDragGhostWidth(62, { ...shared, startedCollapsed: false, collapsedWidth: 56 }), shared, false, 56)).toBe(56);
  });
});
