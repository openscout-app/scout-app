/**
 * Workspace — the Terminals home in a panel: workspaces of live terminal tiles,
 * and the picker that finds and adds terminals to them.
 *
 * Shows:  the open workspace's tiles (live shells and harnesses, sessions Scout
 *         registered, multiplexer projections), then the picker: Multiplexer
 *         setups · Linked agents · Scout terminals, or ranked results while the
 *         find field holds a query. With no workspace open, the library (or
 *         the terminals found running here); New workspace opens the builder.
 *         Workspace tabs, find, New and the menu sit in the app's top row on
 *         the Terminals view, and in a row at the top of the panel elsewhere.
 * Data:   /api/terminal-sessions (every 8s while visible, and on focus);
 *         /api/terminal-workspaces, read once and written through on change;
 *         a hudsonkit terminal relay per live tile. The deck (which workspaces,
 *         which is open) is one localStorage record shared with every
 *         Terminals surface, so a view holds one Workspace.
 * Scope:  none. Which workspace is open, and library · builder · workspace,
 *         live in the deck.
 * Opens:  a terminal, agent or herdr session on its own page
 *         (/terminal/<target>, the Terminal view), which leaves the view; a
 *         tile's ↗ opens it in a new window.
 *
 * Keys: on the Terminals view the panel is the screen, so "/" from anywhere
 * lands in its find field. On any other view (a terminal's page included),
 * only while focus is inside the panel. It takes no Esc of its own; a
 * terminal keeps every key it is given.
 */
import { TerminalHome } from "../../terminal/Terminal.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import { pageTerminal } from "./terminal-page-model.ts";
import "./terminal-workspace.css";

function TerminalWorkspace({ route, navigate }: ModuleProps) {
  const { root, keyScope } = usePanelKeyScope();
  // Bare /terminal draws the Terminals view: there the workspace is the screen.
  // A terminal's page draws the Terminal view, where it is one panel among others.
  const own = route.view === "terminal" && !pageTerminal(route);
  return (
    <div className="vw-termws" ref={root}>
      <TerminalHome navigate={navigate} keyScope={own ? undefined : keyScope} />
    </div>
  );
}

export const terminalWorkspaceModule = defineModule({
  type: "terminal-workspace",
  title: "Workspace",
  blurb: "Terminal workspaces: tiles of live terminals, and the picker that adds them",
  docs: {
    shows: "The open workspace's terminal tiles, then the picker (multiplexer setups, linked agents, Scout terminals) or ranked find results; the library and builder when no workspace is open.",
    data: "/api/terminal-sessions every 8s, /api/terminal-workspaces (read once, written through), a terminal relay per live tile; the deck is one localStorage record.",
    opens: "A terminal, agent or herdr session on its own page, /terminal/<target>; a tile's ↗ opens a new window.",
  },
  size: { w: 9, h: 24 },
  // 5 + the Index's 3 fills an 8-column grid, so the two stay side by side there
  minSize: { w: 5, h: 12 },
  // the deck is one record per browser: two panels would fight over it
  maxPerView: 1,
  Component: TerminalWorkspace,
});
