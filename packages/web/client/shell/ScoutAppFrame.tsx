import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { ThemeProvider } from "hudsonkit/theme";
import { Frame } from "@hudsonkit/chrome";
import { ScoutActionButton } from "../primitives/ScoutActionButton.tsx";
import { defaultScoutRail, SCOUT_MASTHEAD_HEIGHT, type ScoutRail } from "./boot-html.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { RailToggle } from "../components/RailToggle.tsx";
import { SettingsGlyph, type NavIcon } from "../components/ScoutGlyph.tsx";
import { useFrameSpacing } from "../components/hud-grid/frame-spacing.ts";
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarProvider } from "../components/ui/sidebar.tsx";
import { navigateBrowser, useBrowserLocation } from "../lib/browser-location.ts";
import {
  resolveScoutStartupAppearanceDetails,
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
  SCOUT_THEME_STORAGE_KEY,
  writeScoutAppearanceDetails,
  type ScoutAppearanceDetails,
  type ScoutBackdrop,
} from "../lib/theme.ts";
import { ScoutAppearance } from "../scout/ScoutAppearance.tsx";
import { FrameSheet } from "../scout/sidebar/FrameSheet.tsx";
import { ScoutSidebarFrame, SidebarPlaceRow } from "../scout/sidebar/ScoutSidebarFrame.tsx";
import { TopRowView } from "../scout/sidebar/TopRowView.tsx";
import { useSidebarCollapse } from "../scout/sidebar/useSidebarCollapse.ts";
import {
  RAIL_BRAND_CELL_HEIGHT,
  RAIL_COLLAPSED_WIDTH,
  RAIL_HEADER_HEIGHT,
  RAIL_TOGGLE_BRAND_TOP,
  RAIL_TOGGLE_HEADER_TOP,
  SIDEBAR_EXPANDED_WIDTH,
  railToggleOffset,
} from "../scout/sidebar/sidebar-collapse-state.ts";
import { ScoutSurface } from "../scout/slots/ScoutSurface.tsx";
import { ScoutNavigationBar } from "./ScoutNavigationBar.tsx";
import { ScoutPageSkeleton, type ScoutSkeletonVariant } from "./ScoutPageSkeleton.tsx";
import { ScoutThinSettingsPanel, type ScoutThinSettingsConfig } from "./ScoutThinSettingsPanel.tsx";

const TOP_ROW_HEIGHT = 40;
const HANDLE_WIDTH = 8;

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function hasSavedTemplate(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(SCOUT_THEME_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed?.template === "string";
  } catch {
    return false;
  }
}

export interface ScoutPageTab {
  id: string;
  label: string;
  route: string;
  icon: NavIcon;
  match?: (pathname: string) => boolean;
}

export interface ScoutTopNavTab {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}

export interface ScoutRuntimeBadge {
  label: string;
  tone?: "ready" | "local" | "offline" | "loading";
  detail?: string;
}

export interface ScoutSetupCallout {
  title: string;
  description: string;
  command: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ScoutAppFrameProps {
  /** Short product noun, e.g. "Feed", "Sessions", "Search", "Boards". */
  product: string;
  /** Declarative page entries. Multi-page apps (or `chrome="sidebar"`) render the real framed Scout sidebar shell. */
  pages?: readonly ScoutPageTab[];
  activePageId?: string;
  /** Optional top navigation tabs rendered in `TopRowView` beside Back/Forward. */
  topTabs?: readonly ScoutTopNavTab[];
  /** Force the framed Scout sidebar (`"sidebar"`), slim masthead (`"masthead"`), or automatic (`"auto"`). */
  chrome?: "auto" | "sidebar" | "masthead";
  /** Standard Settings view pinned in the sidebar footer. Pass `false` to disable. */
  settings?: ScoutThinSettingsConfig | false;
  navigate?: (href: string) => void;
  status?: ScoutRuntimeBadge | null;
  setupCallout?: ScoutSetupCallout | null;
  headerActions?: ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** Optional skeleton variant shown automatically while `loading` is true. */
  variant?: ScoutSkeletonVariant;
  rail?: ScoutRail;
  loading?: boolean;
  children: ReactNode;
}

function StatusPill({ status }: { status: ScoutRuntimeBadge }) {
  const tone = status.tone ?? "local";
  return (
    <span className="s-thin-status" data-tone={tone} title={status.detail ?? status.label} role="status">
      <span className="s-thin-status-dot" aria-hidden="true" />
      <span>{status.label}</span>
    </span>
  );
}

function SetupBanner({ callout, rail }: { callout: ScoutSetupCallout; rail: ScoutRail }) {
  return (
    <aside className="s-thin-setup" aria-label={callout.title}>
      <div className="s-thin-setup-inner s-surface-rail" data-rail={rail}>
        <div className="s-thin-setup-copy">
          <strong>{callout.title}</strong>
          <span>{callout.description}</span>
        </div>
        <div className="s-thin-setup-actions">
          <code className="s-thin-setup-cmd">{callout.command}</code>
          {callout.onAction ? (
            <ScoutActionButton onClick={callout.onAction}>{callout.actionLabel ?? "Start runtime"}</ScoutActionButton>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function startEdgeDrag(
  event: ReactPointerEvent,
  startWidth: number,
  onMove: (width: number) => void,
  onEnd: (width: number | null) => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  let last = startWidth;
  const move = (e: PointerEvent) => {
    last = Math.max(0, startWidth + (e.clientX - startX));
    onMove(last);
  };
  const cleanup = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
  };
  const up = () => {
    cleanup();
    onEnd(last);
  };
  const cancel = () => {
    cleanup();
    onEnd(null);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
  document.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
}

function useFramedRootAttributes(active: boolean, navWidth: number, sheetGap: number, resizing: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.setAttribute("data-scout-sidebar-chrome", "");
    root.setAttribute("data-scout-frame", "");
    root.setAttribute("data-scout-no-status-bar", "");
    root.style.setProperty("--statusbar-h", "0px");
    root.style.setProperty("--scout-rail-collapsed-width", `${RAIL_COLLAPSED_WIDTH}px`);
    return () => {
      root.removeAttribute("data-scout-sidebar-chrome");
      root.removeAttribute("data-scout-frame");
      root.removeAttribute("data-scout-no-status-bar");
      root.style.removeProperty("--scout-rail-collapsed-width");
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.style.setProperty("--scout-nav-rail-width", `${navWidth}px`);
    root.style.setProperty("--scout-sheet-left", `${navWidth}px`);
    root.style.setProperty("--scout-sheet-right", `${sheetGap}px`);
    root.style.setProperty("--scout-sheet-bottom", `${sheetGap}px`);
    return () => {
      root.style.removeProperty("--scout-nav-rail-width");
      root.style.removeProperty("--scout-sheet-left");
      root.style.removeProperty("--scout-sheet-right");
      root.style.removeProperty("--scout-sheet-bottom");
    };
  }, [active, navWidth, sheetGap]);

  useEffect(() => {
    if (!active || !resizing) return;
    const root = document.documentElement;
    root.setAttribute("data-scout-sidebar-resizing", "");
    return () => root.removeAttribute("data-scout-sidebar-resizing");
  }, [active, resizing]);
}

function ScoutAppFrameInner({
  product,
  pages = [],
  activePageId,
  topTabs,
  chrome = "auto",
  settings,
  navigate = navigateBrowser,
  status,
  setupCallout,
  headerActions,
  search,
  variant,
  rail = defaultScoutRail(variant),
  loading = false,
  frameBackdrop,
  onFrameBackdropChange,
  children,
}: ScoutAppFrameProps & {
  frameBackdrop: ScoutBackdrop;
  onFrameBackdropChange: (backdrop: ScoutBackdrop) => void;
}) {
  const { pathname } = useBrowserLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const viewportWidth = useViewportWidth();
  const useSidebar = chrome === "sidebar" || (chrome === "auto" && pages.length > 1);
  const settingsEnabled = useSidebar && settings !== false;
  const settingsConfig = typeof settings === "object" && settings ? settings : undefined;
  const settingsRoute = settingsConfig?.route ?? "/settings";
  const isSettings = settingsEnabled && (pathname === settingsRoute || pathname.startsWith(`${settingsRoute}/`));

  const appId = `thin-${product.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const sidebar = useSidebarCollapse(appId, viewportWidth);
  const { seam: sheetGap } = useFrameSpacing();
  const navWidth = sidebar.width;
  useFramedRootAttributes(useSidebar, navWidth, sheetGap, sidebar.isSidebarResizing);

  const startSidebarDrag = useCallback((event: ReactPointerEvent) => {
    const startedCollapsed = sidebar.effectiveCollapsed;
    const startWidth = startedCollapsed ? RAIL_COLLAPSED_WIDTH : sidebar.expandedWidth;
    sidebar.beginResize(startWidth, startedCollapsed);
    startEdgeDrag(
      event,
      startWidth,
      (width) => sidebar.updateResize(width),
      (width) => {
        if (width === null) sidebar.clearDrag();
        else sidebar.commitDrag(width, startedCollapsed);
      },
    );
  }, [sidebar]);

  const resolvedPage = isSettings
    ? undefined
    : pages.find((page) =>
        activePageId
          ? page.id === activePageId
          : page.match
            ? page.match(pathname)
            : pathname === page.route || (page.route !== "/" && pathname.startsWith(`${page.route}/`)),
      ) ?? pages[0];

  const title = product === "Scout" ? "Scout" : `Scout ${product}`;

  useEffect(() => {
    document.title = isSettings
      ? `Settings · ${title}`
      : resolvedPage && useSidebar
        ? `${resolvedPage.label} · ${title}`
        : title;
  }, [isSettings, resolvedPage, title, useSidebar]);

  useEffect(() => {
    document.documentElement.style.setProperty("--statusbar-h", "0px");
    document.documentElement.setAttribute("data-scout-no-status-bar", "");
  }, []);

  useEffect(() => {
    if (!useSidebar) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        sidebar.toggleCollapsed();
        return;
      }
      if (!search) return;
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t && !/^(INPUT|TEXTAREA)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && t === searchInputRef.current) {
        search.onChange("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, sidebar, useSidebar]);

  const body = (
    <ScoutSurface>
      <div className="s-thin-content-rail s-surface-rail" data-rail={isSettings ? "reading" : rail}>
        {isSettings ? (
          <ScoutThinSettingsPanel
            product={product}
            status={status}
            setupCallout={setupCallout}
            frameBackdrop={frameBackdrop}
            onFrameBackdropChange={onFrameBackdropChange}
            extra={settingsConfig?.extra}
          />
        ) : loading && variant ? (
          <ScoutPageSkeleton variant={variant} inline label={`Loading ${title}`} />
        ) : (
          children
        )}
      </div>
    </ScoutSurface>
  );

  const actions = (
    <>
      {headerActions}
      {status ? <StatusPill status={status} /> : null}
    </>
  );

  if (!useSidebar) {
    return (
      <Frame mode="panel">
        <div className="s-thin-editorial">
          <ScoutNavigationBar
            title={title}
            editorial
            height={SCOUT_MASTHEAD_HEIGHT}
            onHome={() => navigate(pages[0]?.route ?? "/")}
            actions={actions}
            search={search}
          />
          <div className="s-thin-single-shell" style={{ paddingTop: SCOUT_MASTHEAD_HEIGHT }}>
            <div className="s-thin-scroll">
              {setupCallout ? <SetupBanner callout={setupCallout} rail={rail} /> : null}
              {body}
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  const sidebarFooter = settingsEnabled ? (
    <SidebarMenu>
      <SidebarPlaceRow
        id="settings"
        label="Settings"
        icon={SettingsGlyph}
        active={isSettings}
        onSelect={() => navigate(settingsRoute)}
      />
    </SidebarMenu>
  ) : undefined;

  const topTabsNode = !isSettings && topTabs && topTabs.length > 0 ? (
    <nav className="scout-area-subnav" aria-label="Area sub-navigation" data-scout-area-subnav="">
      {topTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={tab.active ? "page" : undefined}
          className={`scout-area-subnav-item${tab.active ? " scout-area-subnav-item--active" : ""}`}
          onClick={tab.onSelect}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  ) : undefined;

  return (
    <Frame mode="panel">
      <div className="s-thin-framed-shell">
        <SidebarProvider
          open={!sidebar.effectiveCollapsed}
          onOpenChange={(open) => sidebar.setCollapsed(!open)}
          style={{
            "--sidebar-width": `${sidebar.expandedWidth}px`,
            "--sidebar-width-icon": `${RAIL_COLLAPSED_WIDTH}px`,
            "--scout-sidebar-top": "0px",
          } as CSSProperties}
          data-sidebar-resizing={sidebar.isSidebarResizing ? "" : undefined}
        >
          <ScoutSidebarFrame
            brandLabel={product}
            homeLabel={pages[0]?.label ?? product}
            onHome={() => navigate(pages[0]?.route ?? "/")}
            footer={sidebarFooter}
          >
            <SidebarGroup className="py-2">
              <SidebarGroupContent>
                <SidebarMenu data-nav-group="navigate">
                  {pages.map((page) => (
                    <SidebarPlaceRow
                      key={page.id}
                      id={page.id}
                      label={page.label}
                      icon={page.icon}
                      active={!isSettings && page.id === resolvedPage?.id}
                      onSelect={() => navigate(page.route)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </ScoutSidebarFrame>
        </SidebarProvider>

        <RailToggle
          side="left"
          collapsed={sidebar.effectiveCollapsed}
          label="Sidebar"
          onToggle={sidebar.toggleCollapsed}
          className="scout-rail-toggle--band"
          style={{
            position: "fixed",
            left: railToggleOffset(navWidth, sidebar.effectiveCollapsed, RAIL_COLLAPSED_WIDTH),
            top: sidebar.effectiveCollapsed
              ? TOP_ROW_HEIGHT + RAIL_TOGGLE_HEADER_TOP
              : TOP_ROW_HEIGHT - RAIL_BRAND_CELL_HEIGHT + RAIL_TOGGLE_BRAND_TOP,
            zIndex: 46,
          }}
        />

        <div
          data-scout-sidebar-resize-handle=""
          role="separator"
          aria-orientation="vertical"
          aria-label={sidebar.effectiveCollapsed ? "Expand sidebar (drag out)" : "Resize or collapse sidebar"}
          title={sidebar.effectiveCollapsed
            ? "Drag out to expand · double-click to expand"
            : "Drag to resize · drag in to collapse · double-click to reset"}
          onPointerDown={startSidebarDrag}
          onDoubleClick={(event) => {
            event.preventDefault();
            if (sidebar.effectiveCollapsed) {
              sidebar.setExpandedWidth(SIDEBAR_EXPANDED_WIDTH);
              sidebar.setCollapsed(false);
            } else {
              sidebar.resetExpandedWidth();
            }
          }}
          style={{
            position: "fixed",
            left: Math.max(0, navWidth - HANDLE_WIDTH / 2),
            top: sidebar.effectiveCollapsed ? TOP_ROW_HEIGHT + RAIL_HEADER_HEIGHT : 0,
            bottom: 0,
            width: HANDLE_WIDTH,
            zIndex: 50,
            cursor: "ew-resize",
            touchAction: "none",
          }}
        />

        {sidebar.isSidebarResizing && sidebar.dragGhostWidth != null ? (
          <div
            aria-hidden="true"
            className="scout-sidebar-resize-ghost"
            style={{
              position: "fixed",
              left: sidebar.dragGhostWidth,
              top: TOP_ROW_HEIGHT,
              bottom: 0,
              width: 2,
              transform: "translateX(-50%)",
              zIndex: 55,
              pointerEvents: "none",
            }}
          />
        ) : null}

        <div
          className="scout-top-row-frame"
          data-scout-top-row-frame=""
          style={{ position: "fixed", top: 0, left: navWidth, right: 0, height: TOP_ROW_HEIGHT }}
        >
          <TopRowView
            sectionName={isSettings ? "Settings" : resolvedPage?.label ?? title}
            tabs={topTabsNode}
            back={{ enabled: true, onBack: () => window.history.back() }}
            forward={{ enabled: true, onForward: () => window.history.forward() }}
            rightUtility={(
              <>
                {search && !isSettings ? (
                  <label
                    className="scout-top-row-search"
                    data-active={search.value ? "" : undefined}
                    data-scout-search=""
                  >
                    <Search aria-hidden="true" size={12} />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search.value}
                      onChange={(event) => search.onChange(event.target.value)}
                      placeholder={search.placeholder ?? "Search"}
                      aria-label={search.placeholder ?? "Search"}
                      className="scout-top-row-search-input"
                    />
                    {search.value ? (
                      <button
                        type="button"
                        className="s-thin-framed-search-clear"
                        aria-label="Clear search"
                        onClick={() => search.onChange("")}
                      >
                        <X size={12} />
                      </button>
                    ) : (
                      <kbd className="s-thin-framed-search-kbd" aria-hidden="true">/</kbd>
                    )}
                  </label>
                ) : null}
                {actions}
              </>
            )}
          />
        </div>

        <main
          data-pane="center"
          className="s-thin-framed-center"
          style={{
            top: TOP_ROW_HEIGHT,
            left: navWidth,
            right: sheetGap,
            bottom: sheetGap,
          }}
        >
          <div className="s-thin-scroll">
            {setupCallout && !isSettings ? <SetupBanner callout={setupCallout} rail={rail} /> : null}
            {body}
          </div>
        </main>

        <FrameSheet
          left={navWidth}
          top={TOP_ROW_HEIGHT}
          right={sheetGap}
          bottom={sheetGap}
          seamBottom={sheetGap}
        />
      </div>
    </Frame>
  );
}

export function ScoutAppFrame(props: ScoutAppFrameProps) {
  const initialTheme = resolveScoutStartupTheme();
  const initialTemplate = hasSavedTemplate() ? resolveScoutStartupTemplate() : "hudson";
  const [appearanceDetails, setAppearanceDetails] = useState<ScoutAppearanceDetails>(
    () => resolveScoutStartupAppearanceDetails(),
  );

  const handleFrameBackdropChange = useCallback((frameBackdrop: ScoutBackdrop) => {
    setAppearanceDetails((prev) => {
      const next = { ...prev, frameBackdrop };
      writeScoutAppearanceDetails(next);
      return next;
    });
  }, []);

  return (
    <ThemeProvider
      defaultTheme={initialTheme}
      defaultTemplate={initialTemplate}
      storageKey={SCOUT_THEME_STORAGE_KEY}
    >
      <ScoutAppearance initialTheme={initialTheme} appearanceDetails={appearanceDetails}>
        <ContextMenuProvider>
          <ScoutAppFrameInner
            {...props}
            frameBackdrop={appearanceDetails.frameBackdrop}
            onFrameBackdropChange={handleFrameBackdropChange}
          />
        </ContextMenuProvider>
      </ScoutAppearance>
    </ThemeProvider>
  );
}
