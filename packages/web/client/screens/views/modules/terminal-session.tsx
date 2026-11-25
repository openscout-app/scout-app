/**
 * Terminal session — one terminal that already runs, in a panel: an agent's,
 * or a tmux, zellij or herdr session Scout registered or found on this machine.
 *
 * Shows:  with nothing chosen, one quiet list of the terminals running on
 *         this machine, most recently active first, an agent's under the
 *         agent's name, under a find field; picking one opens it here,
 *         observing. Then the same terminal the full /terminal page draws: an
 *         agent's terminal (observed, read-only, until Take over is clicked),
 *         a session's summary or live terminal, or a herdr session's
 *         projection. Head: Observe · Take over; on its own pick, also
 *         Open full and Change.
 * Data:   /api/terminal-sessions (discovered sessions too) every 10s while
 *         picking; the roster (useScout().agents); the terminal relay once
 *         a terminal is open.
 * Scope:  Terminal. "This page's terminal" (how the Terminal view ships it)
 *         follows the page: the terminal /terminal/<target> names, drawn as
 *         that page always drew it, observed or taken over as its ?mode= says
 *         (an agent named with no mode is taken over). Observe and Take over
 *         move the page, so Back returns; the terminal's own links and back
 *         pill act on the page too. Its relay keeps the page's session keys,
 *         so a terminal once open full-bleed reattaches to the same session.
 *         A page naming no terminal shows the picker; a pick opens its page.
 *         Unset, the panel keeps its own pick, kept in the view at rest:
 *           agentId              an agent's terminal, observed
 *           terminalSessionId    a registered or discovered session
 *           terminalSurfaceKey   which surface of it (tmux, zellij, herdr)
 *           mode                 observe, or "" for a session's summary
 *         Take over, and the terminal a herdr projection opens, last for this
 *         mount only: a reload or a return to the view lands observing (or on
 *         the projection), so nothing is driven again without a click. Links
 *         inside the terminal that stay on a terminal move the panel, not the
 *         page; its back pill ends a takeover, else picks another, like Change.
 *         Its relay is keyed by the panel.
 * Opens:  Open full (own pick): this terminal on its own page
 *         (/terminal/<target>), at rest; take over there. Anything else the
 *         terminal links to (an agent's profile) opens on the page.
 *
 * The terminal is mounted by which terminal it is, never by how it is
 * watched or where its panel sits: moving, sizing and full view keep the
 * relay and its pty (terminal-page-model.ts › pageTerminalKey).
 */
import type { MouseEvent } from "react";
import { resolveAgentTerminalSurface } from "../../../lib/terminal-relay.ts";
import type { Agent } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { TerminalContent, TerminalModesInHead } from "../../terminal/Terminal.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { followsPageTerminal, pageModeRoute, pageTerminal, pageTerminalKey, TERMINAL_SCOPE, terminalMode } from "./terminal-page-model.ts";
import { TargetPicker, usePanelTarget } from "./terminal-target.tsx";
import { targetIdentity, targetKind } from "./terminal-target-model.ts";

/** An agent with no terminal surface has nothing to watch; taking over starts one, on a click. */
function NothingToWatch({ agent, onTakeOver }: { agent: Agent; onTakeOver: () => void }) {
  return (
    <div className="vw-tsession-none">
      <span className="vw-dim">{agent.name} has no terminal to watch. Take over opens its session in a terminal you drive.</span>
      <button type="button" className="vw-chip" onClick={onTakeOver}>
        Take over
      </button>
    </div>
  );
}

/**
 * "This page's terminal": the terminal the page names, as its own page drew
 * it, with no relay scope, so it keeps the page's session. Keyed by which
 * terminal it is: a new route object or a change of mode keeps it mounted.
 */
function PageTerminal({ route, navigate }: ModuleProps) {
  const { agents } = useScout();
  const page = pageTerminal(route);
  if (!page) return <TargetPicker onPick={(next) => navigate(next)} />;

  const mode = terminalMode(page);
  const agent = page.agentId ? agents.find((a) => a.id === page.agentId) ?? null : null;
  const observe = agent && !resolveAgentTerminalSurface(agent) ? null : pageModeRoute(page, "observe");
  const takeOver = pageModeRoute(page, "takeover");
  return (
    <div className="vw-tsession">
      <ModuleHead>
        {observe && (
          <button type="button" className="vw-chip" aria-pressed={mode === "observe"} onClick={() => mode !== "observe" && navigate(observe)} title="Watch, read-only">
            Observe
          </button>
        )}
        {takeOver && (
          <button type="button" className="vw-chip" aria-pressed={mode === "takeover"} onClick={() => mode !== "takeover" && navigate(takeOver)} title="Type into this terminal">
            Take over
          </button>
        )}
      </ModuleHead>
      <TerminalModesInHead.Provider value={Boolean(observe && takeOver)}>
        <TerminalContent key={pageTerminalKey(page)} route={page} navigate={navigate} />
      </TerminalModesInHead.Provider>
    </div>
  );
}

function TerminalSession(props: ModuleProps) {
  return followsPageTerminal(props.config) ? <PageTerminal {...props} /> : <PickedTerminal {...props} />;
}

function PickedTerminal({ instanceId, navigate, config, setConfig }: ModuleProps) {
  const { agents } = useScout();
  const panel = usePanelTarget({ navigate, config, setConfig });
  const { saved, shown } = panel;
  if (!saved || !shown) return <TargetPicker onPick={panel.pick} />;

  const mode = terminalMode(shown);
  const kind = targetKind(saved);
  const agent = kind === "agent" ? agents.find((a) => a.id === saved.agentId) ?? null : null;
  const bare = !!agent && !resolveAgentTerminalSurface(agent);
  // a herdr projection, and the terminal it opens, have one way to be seen
  const modes = kind === "agent" || kind === "session";
  // The full page's back pill goes back in history, which here would leave
  // the view; in a panel it ends a takeover, else means "pick another".
  const keepBackInPanel = (e: MouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest(".s-back-pill")) return;
    e.preventDefault();
    e.stopPropagation();
    panel.back();
  };

  return (
    <div className="vw-tsession" onClickCapture={keepBackInPanel}>
      <ModuleHead>
        {modes && !bare && (
          <button type="button" className="vw-chip" aria-pressed={mode === "observe"} onClick={panel.observe} title="Watch, read-only">
            Observe
          </button>
        )}
        {modes && (
          <button type="button" className="vw-chip" aria-pressed={mode === "takeover"} onClick={panel.takeOver} title="Type into this terminal, until this panel closes">
            Take over
          </button>
        )}
        <button type="button" className="vw-chip" onClick={() => navigate(saved)} title="Open this terminal on its own page">
          Open full
        </button>
        <button type="button" className="vw-chip" onClick={panel.clear} title="Pick another terminal">
          Change
        </button>
      </ModuleHead>
      {bare && mode !== "takeover" ? (
        <NothingToWatch agent={agent} onTakeOver={panel.takeOver} />
      ) : (
        // which terminal, not how it is watched: a mode change keeps it mounted
        <TerminalModesInHead.Provider value={modes && !bare}>
          <TerminalContent key={targetIdentity(shown)} route={shown} navigate={panel.navigate} relayScope={instanceId} />
        </TerminalModesInHead.Provider>
      )}
    </div>
  );
}

export const terminalSessionModule = defineModule({
  type: "terminal-session",
  title: "Terminal session",
  blurb: "One running terminal: an agent's, or a tmux, zellij or herdr session",
  docs: {
    shows: "A running terminal: the page's own (observed or taken over as its link says), or one picked here, observed until Take over, which lasts for this mount only; with none, a quiet list of the terminals running here.",
    data: "/api/terminal-sessions every 10s while picking; useScout().agents; the terminal relay (the page's session keys when following it).",
    opens: "Following the page: Observe and Take over move the page. Picked: Open full, the terminal on its own page, at rest. Its other links (an agent's profile) open on the page.",
  },
  size: { w: 6, h: 14 },
  minSize: { w: 4, h: 8 },
  scopes: [TERMINAL_SCOPE],
  Component: TerminalSession,
});
