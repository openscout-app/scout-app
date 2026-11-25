import { useEffect, type ReactNode } from "react";
import { ThemeProvider } from "hudsonkit/theme";
import { Frame } from "@hudsonkit/chrome";
import { usePlatformLayout } from "@hudsonkit";
import { ContextMenuProvider } from "../components/ContextMenu.tsx";
import type { NavIcon } from "../components/ScoutGlyph.tsx";
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
  /** Declarative page entries. Single-page apps render a slim header; multi-page apps render the Scout sidebar. */
  pages: readonly ScoutPageTab[];
  activePageId?: string;
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

function SetupBanner({ callout }: { callout: ScoutSetupCallout }) {
  return (
    <aside className="s-thin-setup" aria-label={callout.title}>
      <div className="s-thin-setup-copy">
        <strong>{callout.title}</strong>
        <span>{callout.description}</span>
      </div>
      <div className="s-thin-setup-actions">
        <code className="s-thin-setup-cmd">{callout.command}</code>
        {callout.onAction ? (
          <button type="button" className="s-thin-setup-btn" onClick={callout.onAction}>
            {callout.actionLabel ?? "Run setup"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function ScoutAppFrameInner({
  product,
  pages,
  activePageId,
  navigate = navigateBrowser,
  status,
  setupCallout,
  headerActions,
  search,
  variant,
  loading = false,
  children,
}: ScoutAppFrameProps) {
  const { pathname } = useBrowserLocation();
  const { navTotalHeight } = usePlatformLayout();
  const resolvedPage = pages.find((page) =>
    activePageId
      ? page.id === activePageId
      : page.match
        ? page.match(pathname)
        : pathname === page.route || (page.route !== "/" && pathname.startsWith(`${page.route}/`)),
  ) ?? pages[0];

  const title = product === "Scout" ? "Scout" : `Scout ${product}`;
  const multiPage = pages.length > 1;

  useEffect(() => {
    document.title = resolvedPage && multiPage
      ? `${resolvedPage.label} · ${title}`
      : title;
  }, [multiPage, resolvedPage, title]);

  useEffect(() => {
    document.documentElement.style.setProperty("--statusbar-h", "0px");
    document.documentElement.setAttribute("data-scout-no-status-bar", "");
  }, []);

  const body = loading && variant ? <ScoutPageSkeleton variant={variant} label={`Loading ${title}`} /> : children;

  const actions = (
    <>
      {status ? <StatusPill status={status} /> : null}
      {headerActions}
    </>
  );

  if (!multiPage) {
    return (
      <Frame mode="panel">
        <ScoutNavigationBar
          title={title}
          onHome={() => navigate(pages[0]?.route ?? "/")}
          actions={actions}
          search={search}
        />
        <div className="s-thin-single-shell" style={{ paddingTop: navTotalHeight }}>
          {setupCallout ? <SetupBanner callout={setupCallout} /> : null}
          <ScoutSurface>{body}</ScoutSurface>
        </div>
      </Frame>
    );
  }

  return (
    <SidebarProvider defaultOpen>
      <Frame mode="panel">
        <div className="s-thin-multi-shell">
          <ScoutSidebarFrame
            brandLabel={product}
            homeLabel={pages[0]?.label ?? product}
            onHome={() => navigate(pages[0]?.route ?? "/")}
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
                      active={page.id === resolvedPage?.id}
                      onSelect={() => navigate(page.route)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </ScoutSidebarFrame>
          <div className="s-thin-multi-main">
            <header className="s-thin-topbar">
              <span className="s-thin-topbar-title">{resolvedPage?.label ?? title}</span>
              <div className="s-thin-topbar-right">{actions}</div>
            </header>
            {setupCallout ? <SetupBanner callout={setupCallout} /> : null}
            <div className="s-thin-multi-content">
              <ScoutSurface>{body}</ScoutSurface>
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
