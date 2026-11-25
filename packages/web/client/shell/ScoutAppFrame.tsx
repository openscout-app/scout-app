import { useEffect, useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { ThemeProvider } from "hudsonkit/theme";
import { Frame } from "@hudsonkit/chrome";
import { ScoutActionButton } from "../primitives/ScoutActionButton.tsx";
import { defaultScoutRail, SCOUT_MASTHEAD_HEIGHT, type ScoutRail } from "./boot-html.ts";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import { SettingsGlyph, type NavIcon } from "../components/ScoutGlyph.tsx";
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarProvider } from "../components/ui/sidebar.tsx";
import { navigateBrowser, useBrowserLocation } from "../lib/browser-location.ts";
import {
  resolveScoutStartupTemplate,
  resolveScoutStartupTheme,
  SCOUT_THEME_STORAGE_KEY,
} from "../lib/theme.ts";
import { ScoutAppearance } from "../scout/ScoutAppearance.tsx";
import { ScoutSidebarFrame, SidebarPlaceRow } from "../scout/sidebar/ScoutSidebarFrame.tsx";
import { ScoutSurface } from "../scout/slots/ScoutSurface.tsx";
import { ScoutNavigationBar } from "./ScoutNavigationBar.tsx";
import { ScoutPageSkeleton, type ScoutSkeletonVariant } from "./ScoutPageSkeleton.tsx";
import { ScoutThinSettingsPanel, type ScoutThinSettingsConfig } from "./ScoutThinSettingsPanel.tsx";

export interface ScoutPageTab {
  id: string;
  label: string;
  route: string;
  icon: NavIcon;
  match?: (pathname: string) => boolean;
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
  /** Declarative page entries. Omit or pass a single entry for a slim chromeless masthead; multi-page apps (or `chrome="sidebar"`) render the simplistic Scout sidebar. */
  pages?: readonly ScoutPageTab[];
  activePageId?: string;
  /** Force the simplistic Scout sidebar (`"sidebar"`), slim masthead (`"masthead"`), or automatic (`"auto"`). */
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

function ScoutAppFrameInner({
  product,
  pages = [],
  activePageId,
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
  children,
}: ScoutAppFrameProps) {
  const { pathname } = useBrowserLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const useSidebar = chrome === "sidebar" || (chrome === "auto" && pages.length > 1);
  const settingsEnabled = useSidebar && settings !== false;
  const settingsConfig = typeof settings === "object" && settings ? settings : undefined;
  const settingsRoute = settingsConfig?.route ?? "/settings";
  const isSettings = settingsEnabled && (pathname === settingsRoute || pathname.startsWith(`${settingsRoute}/`));

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
    if (!search || !useSidebar) return;
    const onKey = (e: KeyboardEvent) => {
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
  }, [search, useSidebar]);

  const body = (
    <ScoutSurface>
      <div className="s-thin-content-rail s-surface-rail" data-rail={isSettings ? "reading" : rail}>
        {isSettings ? (
          <ScoutThinSettingsPanel
            product={product}
            status={status}
            setupCallout={setupCallout}
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

  return (
    <SidebarProvider defaultOpen>
      <Frame mode="panel">
        <div className="s-thin-multi-shell s-thin-editorial">
          <ScoutSidebarFrame
            brandLabel={product}
            homeLabel={pages[0]?.label ?? product}
            onHome={() => navigate(pages[0]?.route ?? "/")}
            footer={sidebarFooter}
          >
            <SidebarGroup className="py-2">
              <SidebarGroupContent>
                <SidebarMenu>
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
          <div className="s-thin-multi-main">
            <header className="s-thin-topbar">
              <span className="s-thin-topbar-title">
                {isSettings ? "Settings" : resolvedPage?.label ?? title}
              </span>
              <div className="s-thin-topbar-center">
                {search && !isSettings ? (
                  <label className="s-thin-search">
                    <Search aria-hidden="true" size={12} className="s-thin-search-icon" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search.value}
                      onChange={(event) => search.onChange(event.target.value)}
                      placeholder={search.placeholder ?? "Search"}
                      aria-label={search.placeholder ?? "Search"}
                      className="s-thin-search-input"
                    />
                    {search.value ? (
                      <button
                        type="button"
                        className="s-thin-search-clear"
                        aria-label="Clear search"
                        onClick={() => search.onChange("")}
                      >
                        <X size={12} />
                      </button>
                    ) : (
                      <kbd className="s-thin-search-kbd" aria-hidden="true">/</kbd>
                    )}
                  </label>
                ) : null}
              </div>
              <div className="s-thin-topbar-right">{actions}</div>
            </header>
            <div className="s-thin-scroll">
              {setupCallout && !isSettings ? <SetupBanner callout={setupCallout} rail={rail} /> : null}
              {body}
            </div>
          </div>
        </div>
      </Frame>
    </SidebarProvider>
  );
}

export function ScoutAppFrame(props: ScoutAppFrameProps) {
  const initialTheme = resolveScoutStartupTheme();
  const initialTemplate = resolveScoutStartupTemplate();

  return (
    <ThemeProvider
      defaultTheme={initialTheme}
      defaultTemplate={initialTemplate}
      storageKey={SCOUT_THEME_STORAGE_KEY}
    >
      <ScoutAppearance initialTheme={initialTheme}>
        <ContextMenuProvider>
          <ScoutAppFrameInner {...props} />
        </ContextMenuProvider>
      </ScoutAppearance>
    </ThemeProvider>
  );
}
