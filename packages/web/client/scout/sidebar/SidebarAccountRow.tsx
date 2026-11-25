/**
 * The account, at the sidebar foot under Settings.
 *
 * Who you are holds on every page, so it sits with Settings at the foot of the
 * places rather than in the top row: the top row's right side is kept for New,
 * the page's own tools and the panes. The row opens your menu: profile, Docs,
 * Settings. The same row sits at the foot on the hosted web and in the macOS app.
 *
 * You are drawn as your GitHub photo, else your initial on the LED board;
 * never as a generated face.
 */
import type { MouseEvent } from "react";
import { SidebarMenuButton, SidebarMenuItem } from "../../components/ui/sidebar.tsx";
import { OperatorMark } from "../../components/OperatorMark.tsx";
import { useContextMenu } from "../../components/ContextMenu.tsx";
import { useScout } from "../Provider.tsx";
import { useOperatorDisplayName } from "../use-operator-display-name.ts";
import { ACTIVE_MENU_CLASS } from "./ScoutSidebarFrame.tsx";

const DOCS_URL = "https://openscout.app/docs";

export function SidebarAccountRow() {
  const { navigate, openSettings } = useScout();
  const operator = useOperatorDisplayName();
  const openMenu = useContextMenu();
  const handle = operator ? `@${operator.toLowerCase()}` : "You";

  const onOpen = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(
      {
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
        clientX: rect.left + 8,
        clientY: rect.top - 4,
      },
      [
        { kind: "action", label: "Profile", onSelect: () => navigate({ view: "settings", section: "operator" }) },
        { kind: "action", label: "Docs", onSelect: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
        { kind: "separator" },
        { kind: "action", label: "Settings", shortcut: "⌘,", onSelect: () => openSettings() },
      ],
    );
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        tooltip={handle}
        aria-label={operator ? `Account ${handle}` : "Account"}
        aria-haspopup="menu"
        data-area="account"
        className={ACTIVE_MENU_CLASS}
        onClick={onOpen}
      >
        <OperatorMark label={operator} size={18} title={handle} />
        <span data-nav-label="">{handle}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
