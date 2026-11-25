/**
 * The Scout sidebar's frame: the column, the brand row, the list and the foot.
 *
 * Presentation only. It reads no route, no flags and nothing from the local
 * runtime, so a build without the broker (Hosted Chat) draws the same column
 * the local app does. `ScoutSidebar` fills it with the app's areas; another
 * build passes its own rows.
 */
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { usePlatform } from "@hudsonkit";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../components/ui/sidebar.tsx";
import { cn } from "../../lib/utils.ts";
import { ScoutMark } from "../../components/ScoutMark.tsx";
import type { NavIcon } from "../../components/ScoutGlyph.tsx";

// Row type (face, size, weight) lives with the rest of the nav chrome in
// app.css, keyed on data-area / data-entry / data-action / data-subnav, so the
// rows carry only state here. Active rows change light, not weight.
export const ACTIVE_MENU_CLASS =
  "data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground";

export function ScoutSidebarFrame({
  brandLabel = "Scout",
  presentation = "scout",
  homeLabel = "Home",
  onHome,
  ariaLabel = "Primary navigation",
  kind,
  children,
  footer,
}: {
  brandLabel?: string;
  presentation?: "scout" | "slack";
  /** What the brand row opens; the mark is never a collapse toggle (SCO-086). */
  homeLabel?: string;
  onHome: () => void;
  ariaLabel?: string;
  kind?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { titleBarInset, dragRegionProps, onInteractiveMouseDown } = usePlatform();
  return (
    <Sidebar
      side="left"
      variant="sidebar"
      collapsible="icon"
      aria-label={ariaLabel}
      data-sidebar-kind={kind}
      data-presentation={presentation}
    >
      {/* Brand strip: drag region + titleBarInset so macOS traffic lights clear.
          SCO-087b: the brand band is pinned to the shared 44px top grid line
          (see app.css brand-row rule); titleBarInset is the only top padding so
          the SCOUT baseline lines up with the side-rail header + title bar. */}
      <SidebarHeader
        className="border-b border-sidebar-border"
        style={{
          paddingTop: titleBarInset || 0,
          ...((dragRegionProps as { style?: CSSProperties } | undefined)?.style ?? {}),
        }}
        {...(Object.fromEntries(
          Object.entries((dragRegionProps ?? {}) as Record<string, unknown>).filter(
            ([key]) => key !== "style",
          ),
        ) as HTMLAttributes<HTMLDivElement>)}
        data-sidebar-drag-region=""
      >
        <div className="flex items-center gap-0.5" data-sidebar="brand-row">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                size="lg"
                tooltip={homeLabel}
                onClick={onHome}
                onMouseDown={onInteractiveMouseDown}
                aria-label={`Scout ${homeLabel}`}
                title={homeLabel}
                className={cn(
                  "data-[slot=sidebar-menu-button]:!p-2",
                  presentation === "slack" ? "font-sans" : "font-mono",
                )}
              >
                <ScoutMark className="size-[18px] shrink-0" />
                <span className={cn(
                  "truncate text-sm font-bold",
                  presentation === "slack" ? "tracking-[-0.01em]" : "tracking-[0.08em] uppercase",
                )}>
                  {brandLabel}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">{children}</SidebarContent>

      {footer ? (
        <SidebarFooter className="border-t border-sidebar-border">{footer}</SidebarFooter>
      ) : null}
    </Sidebar>
  );
}

/** One place in the list: an icon and a label, lit when it is the open one. */
export function SidebarPlaceRow({
  id,
  label,
  icon: Icon,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  icon: NavIcon;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        isActive={active}
        tooltip={label}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        data-area={id}
        className={ACTIVE_MENU_CLASS}
        onClick={onSelect}
      >
        <Icon size={16} aria-hidden />
        <span data-nav-label="">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
