/**
 * Session details — what a session did and holds, beside its thread.
 *
 * Shows:  the session in the Session thread beside it: its trace state, harness,
 *         model and place, Terminal, Review, Pair and Copy id; turns, tools and
 *         edits on one line and its context load; the files it changed; what was
 *         sent into it; usage and metadata under Details.
 * Data:   none of its own. The thread reads the session and draws its details
 *         here (screens/sessions/session-details-host.ts), so a session is read
 *         once. With no thread beside it, it says how to get one.
 * Scope:  none: it shows whichever session the thread beside it shows. A pinned
 *         thread keeps its details beside its own turns.
 * Opens: Terminal, Review (/repo-diff), Pair (the agent's message tab), and a
 *         changed file in its place.
 *
 * Docked as a side, it folds to a strip and sizes from its edge like any side,
 * which is how the details make room for the thread.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { sessionDetailsHost } from "../../sessions/session-details-host.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { Quiet } from "./shared.tsx";
import "../../sessions/sessions-slots.css";
import "./sessions-panels.css";

function SessionDetailsPanel(_props: ModuleProps) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    return el ? sessionDetailsHost.attach(el) : undefined;
  }, []);
  const occupied = useSyncExternalStore(sessionDetailsHost.subscribe, sessionDetailsHost.occupied, () => false);
  return (
    <div className="vw-session-details">
      {!occupied && <Quiet>A session's details show here once a Session thread beside it has one.</Quiet>}
      <div ref={body} className="vw-session-details-body" />
    </div>
  );
}

export const sessionDetailsModule = defineModule({
  type: "session-details",
  title: "Session details",
  blurb: "The session in the thread beside it: its figures, the files it changed, what was sent, and its usage",
  docs: {
    shows: "The thread's session: trace state, harness, model and place; turns, tools, edits and context load; changed files; what was sent; usage and metadata under Details.",
    data: "None of its own: the Session thread beside it reads the session and draws its details here.",
    opens: "Terminal, Review (/repo-diff), Pair, and a changed file in its place.",
  },
  size: { w: 3, h: 20 },
  minSize: { w: 2, h: 8 },
  Component: SessionDetailsPanel,
});
