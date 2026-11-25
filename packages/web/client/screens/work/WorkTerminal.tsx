/**
 * The run's terminal, in place under the run's actions: the terminal that
 * already runs its session (a found surface, else its agent's own terminal),
 * drawn as the Terminals page draws it. It opens observing; Take over types
 * into it. Pop out offers the other hops: the Terminals view, the operator's
 * terminal app (only when one is open; else it stays here), herdr. Nothing
 * here starts a terminal.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ExternalLink, X } from "lucide-react";

import { useContextMenu } from "../../components/ContextMenu.tsx";
import { sessionHopMenuItems, useSessionTerminalTarget } from "../../components/SessionHopMenu.tsx";
import type { SessionTerminalHints } from "../../lib/session-terminal-hop.ts";
import { resolveAgentTerminalSurface } from "../../lib/terminal-relay.ts";
import type { Route, WorkDetail } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { TerminalContent } from "../terminal/Terminal.tsx";
import {
  sessionTerminalHasModes,
  sessionTerminalKey,
  sessionTerminalRoute,
  sessionTerminalStep,
  type SessionTerminal,
} from "../views/modules/session-terminal-model.ts";
import type { TerminalMode } from "../views/modules/terminal-target-model.ts";
import { setWorkTerminalOpen } from "./work-terminal-state.ts";

type Navigate = (route: Route) => void;

/** What the run's terminal is found by: its agent and its session ids. */
export function workTerminalHints(detail: WorkDetail): SessionTerminalHints {
  const ask = detail.primaryInvocation;
  return {
    agentId: ask?.targetAgentId ?? null,
    sessionRefs: [ask?.resolvedSessionId, ask?.targetSessionId],
  };
}

export function WorkTerminal({ detail, navigate }: { detail: WorkDetail; navigate: Navigate }) {
  const { agents, route } = useScout();
  const hints = workTerminalHints(detail);
  const { target, resolved } = useSessionTerminalTarget(hints);
  const agent = hints.agentId ? agents.find((candidate) => candidate.id === hints.agentId) ?? null : null;
  // the agent's own terminal only once the inventory answered, so a found surface never replaces it on screen
  const terminal: SessionTerminal | null = target
    ? { kind: "surface", target }
    : resolved && agent && resolveAgentTerminalSurface(agent)
    ? { kind: "agent", agentId: agent.id }
    : null;
  const [mode, setMode] = useState<TerminalMode>("observe");
  const [note, setNote] = useState<string | null>(null);
  const openMenu = useContextMenu();
  const close = () => setWorkTerminalOpen(detail.id, false);

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest" }); }, []);

  const latest = useRef({ navigate, terminal, route });
  latest.current = { navigate, terminal, route };
  // The same terminal in another mode stays here; anything else opens on the page.
  const local = useCallback((next: Route) => {
    const shown = latest.current.terminal;
    const step = shown ? sessionTerminalStep(next, shown) : { to: "page" as const };
    if (step.to === "page") openContent(latest.current.navigate, next, { returnTo: latest.current.route });
    else setMode(step.mode);
  }, []);
  // The page's back pill would leave the work item; here it ends a takeover, else closes the terminal.
  const keepBackHere = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest(".s-back-pill")) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === "takeover") setMode("observe");
    else close();
  };

  const popOut = (event: MouseEvent) => {
    setNote(null);
    openMenu(event, sessionHopMenuItems({
      target,
      agentId: hints.agentId,
      navigate,
      returnTo: route,
      onError: setNote,
      onOwnTerminal: () => setNote("No terminal app is open, so it stays here."),
    }));
  };

  const name = target ? `${target.surface.backend} · ${target.surface.sessionName}` : terminal ? agent?.name ?? agent?.id ?? null : null;

  return (
    <div ref={box} className="s-wc-term" aria-label="Run terminal">
      <div className="s-wc-term-bar">
        {terminal && sessionTerminalHasModes(terminal) ? (
          <>
            <button type="button" className="s-wc-term-chip" aria-pressed={mode === "observe"} onClick={() => setMode("observe")} title="Watch, read-only">
              Observe
            </button>
            <button type="button" className="s-wc-term-chip" aria-pressed={mode === "takeover"} onClick={() => setMode("takeover")} title="Type into this terminal">
              Take over
            </button>
          </>
        ) : null}
        {name ? <span className="s-wc-term-name" title={name}>{name}</span> : null}
        {note ? <span className="s-wc-term-note" role="status">{note}</span> : null}
        <span className="s-wc-spacer" />
        <button type="button" className="s-wc-term-chip" onClick={popOut} disabled={!terminal} title="Open this terminal somewhere else">
          <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
          Pop out
        </button>
        <button type="button" className="s-wc-term-chip s-wc-term-close" onClick={close} aria-label="Close the terminal" title="Close">
          <X size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {terminal ? (
        <div className="s-wc-term-body" onClickCapture={keepBackHere}>
          {/* which terminal, not how it is watched: a mode change keeps it mounted */}
          <TerminalContent key={sessionTerminalKey(terminal)} route={sessionTerminalRoute(terminal, mode)} navigate={local} relayScope={`work:${detail.id}`} />
        </div>
      ) : (
        <p className="s-wc-term-empty">{resolved ? "No terminal runs this session on this host." : "Looking for this run's terminal…"}</p>
      )}
    </div>
  );
}
