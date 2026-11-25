import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAgentTerminalSurface } from "../../../lib/terminal-relay.ts";
import { fetchTerminalSessions } from "../../../lib/terminal-sessions.ts";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import type { ModuleProps } from "./contract.ts";
import { Quiet, usePolled } from "./shared.tsx";
import {
  clearTarget,
  filterRows,
  panelStep,
  targetConfig,
  targetIdentity,
  targetRoute,
  targetRows,
  type TargetRow,
  type TerminalRoute,
} from "./terminal-target-model.ts";
import "./terminal-target.css";

/*
 * What Terminal session and Terminal details share: the picker a panel shows
 * while it has no terminal, and the panel target that keeps a terminal's own
 * links inside its panel. Not a module itself; the settings live in
 * terminal-target-model.ts.
 */

/** The terminals a panel can open: running sessions every 10s, named by their agents from the live roster. */
function useTargetRows(): { rows: TargetRow[] | null; error: string | null } {
  const { agents } = useScout();
  const { data, error } = usePolled(() => fetchTerminalSessions({ includeDiscovered: true }), 10_000);
  // a failed first read lists nothing rather than reading forever
  const rows = useMemo(
    () => (data || error ? targetRows(data ?? [], agents, resolveAgentTerminalSurface) : null),
    [data, error, agents],
  );
  return { rows, error };
}

/**
 * One quiet list at the top of the panel: a find field, then each terminal
 * running on this machine, most recently active first, an agent's under the
 * agent's name.
 * Enter in the field opens the first match. Picking calls back with the
 * terminal's route.
 */
export function TargetPicker({ onPick }: { onPick: (route: TerminalRoute) => void }) {
  const { rows, error } = useTargetRows();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => (rows ? filterRows(rows, query) : []), [rows, query]);

  return (
    <div className="vw-tt">
      <div className="vw-tt-find">
        <input
          type="search"
          value={query}
          placeholder="Find a terminal"
          aria-label="Find a terminal"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) onPick(shown[0].route);
          }}
        />
        {rows && <span className="vw-dim vw-num">{query ? `${shown.length} of ${rows.length}` : rows.length}</span>}
      </div>
      {error && <Quiet>Terminal list unavailable: {error}</Quiet>}
      {!rows ? (
        <Quiet>Reading terminals…</Quiet>
      ) : !rows.length ? (
        !error && <Quiet>No terminals running on this machine.</Quiet>
      ) : !shown.length ? (
        <Quiet>Nothing matches “{query}”.</Quiet>
      ) : (
        <ul className="vw-tt-rows">
          {shown.map((row) => (
            <li key={row.id}>
              <button type="button" className="vw-row vw-row--tt" onClick={() => onPick(row.route)} title={row.route.mode === "observe" ? "Watch this terminal, read-only" : "Open this terminal"}>
                <span className="vw-strong vw-ell">{row.title}</span>
                <span className="vw-dim vw-ell">{row.owner}</span>
                <span className="vw-dim vw-tt-detail">{row.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A panel's terminal: the target its settings keep, and what this mount drives
 * on top of it. A takeover, and a host terminal opened from a herdr
 * projection, are held here and never saved, so a reload or a return to the
 * view lands on the terminal observed (or its projection) with nothing driven
 * until a click. `navigate` routes what the panel draws: terminal routes move
 * this panel, the way the embed's local router keeps them in its window, and
 * anything else (an agent profile) goes to the page. It is stable across
 * renders.
 */
export function usePanelTarget({ navigate, config, setConfig }: Pick<ModuleProps, "navigate" | "config" | "setConfig">) {
  const saved = targetRoute(config);
  const savedId = targetIdentity(saved);
  const [held, setHeld] = useState<{ over: string; route: TerminalRoute } | null>(null);
  // a drive belongs to the target it started on: a new target ends it
  const driven = held && held.over === savedId ? held.route : null;
  useEffect(() => {
    if (held && held.over !== savedId) setHeld(null);
  }, [held, savedId]);
  const shown = driven ?? saved;

  const latest = useRef({ navigate, setConfig, shown });
  latest.current = { navigate, setConfig, shown };
  const local = useCallback((next: Route) => {
    const { navigate: go, setConfig: set, shown: now } = latest.current;
    if (next.view !== "terminal") return go(next);
    const step = panelStep(next, now);
    if (step.to === "page") return go(next);
    set(step.config);
    setHeld(step.driven ? { over: targetIdentity(targetRoute(step.config)), route: step.driven } : null);
  }, []);

  const clear = () => {
    setHeld(null);
    setConfig(clearTarget());
  };
  return {
    saved,
    shown,
    navigate: local,
    pick: (route: TerminalRoute) => {
      setHeld(null);
      setConfig(targetConfig(route));
    },
    takeOver: () => {
      if (saved) setHeld({ over: savedId, route: { ...saved, mode: "takeover" } });
    },
    observe: () => {
      setHeld(null);
      if (saved?.mode !== "observe") setConfig({ mode: "observe" });
    },
    clear,
    /** The full page's back pill: ends a drive (back to where it started), else picks another. */
    back: () => (driven ? setHeld(null) : clear()),
  };
}
