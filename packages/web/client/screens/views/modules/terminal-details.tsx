/**
 * Terminal details — who a terminal belongs to, how it is open, and how to
 * attach your own terminal to it.
 *
 * Shows:  the terminal inspector's body for one terminal: the agent (avatar,
 *         name, harness, workspace) or the session (origin, condition,
 *         harness, working dir), the mode, the backend and session name, and
 *         the attach command behind "Open in your own terminal". With nothing
 *         chosen, the same quiet list Terminal session picks from.
 * Data:   the roster (useScout().agents), live; /api/terminal-sessions when
 *         the target is a session, again every 15s while visible, and every
 *         10s while picking.
 * Scope:  Terminal, as on Terminal session. "This page's terminal" (how
 *         the Terminal view ships it) follows the page: the inspector the
 *         page's own terminal had beside it, its mode as the page has it
 *         open. Unset, the panel keeps its own pick in the same keys as
 *         Terminal session: agentId · mode · terminalSessionId ·
 *         terminalSurfaceKey, the terminal at rest. An agent reads as
 *         observed; a takeover is never kept.
 * Opens:  Observe and Takeover: the terminal on its own page in that mode.
 *         Profile and Trace: the agent. Open full (own pick): the terminal's
 *         page.
 */
import { TerminalDetails } from "../../terminal/right.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { panelTerminal, TERMINAL_SCOPE } from "./terminal-page-model.ts";
import { TargetPicker } from "./terminal-target.tsx";
import { clearTarget, targetConfig } from "./terminal-target-model.ts";

function TerminalDetailsPanel({ route, navigate, config, setConfig }: ModuleProps) {
  const { following, target } = panelTerminal(config, route);
  if (following) {
    // following the page, its own Terminal session pane offers Observe and Take over
    return target ? <TerminalDetails target={target} navigate={navigate} modesBeside /> : <Quiet>Open a terminal and its details show here.</Quiet>;
  }
  if (!target) return <TargetPicker onPick={(next) => setConfig(targetConfig(next))} />;
  return (
    <>
      <ModuleHead>
        <button type="button" className="vw-chip" onClick={() => navigate(target)} title="Open this terminal on its own page">
          Open full
        </button>
        <button type="button" className="vw-chip" onClick={() => setConfig(clearTarget())} title="Pick another terminal">
          Change
        </button>
      </ModuleHead>
      <TerminalDetails target={target} navigate={navigate} />
    </>
  );
}

export const terminalDetailsModule = defineModule({
  type: "terminal-details",
  title: "Terminal details",
  blurb: "Who a terminal belongs to, its mode, and the command to attach your own",
  docs: {
    shows: "The terminal inspector for the page's terminal, or one picked here: agent or session, mode, backend, attach command.",
    data: "useScout().agents; /api/terminal-sessions for a session, every 15s.",
    opens: "Observe or Takeover: the terminal's page in that mode. Profile, Trace: the agent.",
  },
  size: { w: 4, h: 12 },
  minSize: { w: 3, h: 6 },
  // A form, not a list: no taller than it is, and never the panel that takes
  // the window's spare height. Under the index on Terminal, the index does.
  fit: true,
  scopes: [TERMINAL_SCOPE],
  Component: TerminalDetailsPanel,
});
