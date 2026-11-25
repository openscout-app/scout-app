/**
 * Terminals — every terminal on this machine, indexed: the terminal rail as a panel.
 *
 * Shows:  running terminals cut by Projects or Recent (the index's own tabs),
 *         each row what is in it: who is working, what they last did, which
 *         harnesses a herdr layout holds; stopped layouts fold to one line.
 *         Then Inactive (and review after 30 days) behind a fold, then the
 *         agents that can open a terminal. The head carries the running
 *         count and Refresh. Nothing is marked active on bare /terminal; on
 *         a terminal's page its row is, with Enter or Observe marked as the
 *         terminal is open (an agent named with no mode is entered).
 * Data:   fetchTerminalSessions (discovered included) every 8s while the
 *         window is visible, and on focus; herdr topology for live layouts;
 *         useScout().agents for owners and the agent list. A mount starts
 *         from what the index last held (sessions, herdr summaries, folds,
 *         scroll; see terminal-index-memory.ts) and reads on mount only when
 *         it holds nothing or that is 8s old, so crossing to the rail on a
 *         deep link and back keeps its place.
 * Scope:  none. Projects · Recent are the index's own tabs, one setting
 *         wherever the index shows.
 * Opens:  the terminal's page, /terminal/<target> (the Terminal view), as a
 *         new entry, so Back returns; its row actions Enter (takeover) or
 *         Observe (read-only); an agent's terminal. Release (an inactive tmux
 *         surface under review) asks first and stays on the index.
 *
 * Keys bind only inside the panel: arrows or j/k move along the rows (and
 * the folds between them), Home and End go to the ends. On bare /terminal
 * "/" belongs to the workspace beside it. On a terminal's page, where no
 * workspace is, "/" opens Terminals and its find field, as the rail did.
 */
import { TerminalIndex } from "../../terminal/left.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { pageTerminal } from "./terminal-page-model.ts";
import "./terminal-index.css";

function TerminalIndexPanel({ route, navigate }: ModuleProps) {
  return <TerminalIndex route={route} navigate={navigate} variant="panel" bindFind={pageTerminal(route) != null} />;
}

export const terminalIndexModule = defineModule({
  type: "terminal-index",
  title: "Terminals",
  blurb: "Every terminal on this machine, by project or recent, with the agents that can open one",
  docs: {
    shows: "Running terminals by Projects or Recent, stopped layouts folded, Inactive behind a fold, then agents that can open a terminal.",
    data: "fetchTerminalSessions every 8s while visible and on focus, starting from what the index last held; herdr topology for live layouts; useScout().agents.",
    opens: "The terminal at /terminal/<target>, entered or observed; an agent's terminal.",
  },
  size: { w: 3, h: 24 },
  minSize: { w: 3, h: 8 },
  Component: TerminalIndexPanel,
});
