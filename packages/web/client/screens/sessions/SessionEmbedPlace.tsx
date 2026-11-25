/**
 * The Scout window's way onward: where the session itself is, and one button
 * to go there. The same places, in the same order, as the companion's
 * primary action (tapInPlaces), minus the Scout window it is already in.
 *
 * Reads GET /api/session-ref/:ref/steer?machine= for where the session lives;
 * every jump goes through the server routes that re-prove the binding.
 */

import { useEffect, useState } from "react";

import { api } from "../../lib/api.ts";
import type { SessionSteerAvailability } from "../../../shared/api/session-steer.ts";
import { readLocalNodeId, sessionPageUrl, terminalGo, type SessionPlaceResult } from "../companion/arrivals/tap-in-data.ts";
import { tapInPlaces, terminalOf, whereOf, type TapInPlace, type TapInTerminal } from "../companion/arrivals/tap-in-model.ts";
import { sessionSteerPath } from "./session-delivery.ts";
// The bar is styled with the observer; a chat head can show it without one.
import "./session-observe.css";

const STEER_REFRESH_MS = 15_000;

export type SessionEmbedPlaceModel = {
  /** Where it lives ("Terminal · ttys005", "herdr main / p3"), or empty. */
  lives: string;
  /** The way in, best first. */
  primary: TapInPlace | null;
  /** The session page, when the primary is something else. */
  page: TapInPlace | null;
  /** The attach command to copy when Scout can't open a terminal on it. */
  attach: string | null;
};

/** Pure: the places for one session in its Scout window. */
export function sessionEmbedPlaceModel(input: {
  steer: SessionSteerAvailability | null;
  sessionRef: string;
  machine: string | null;
  /** Offer the session page too; off where the host already links to it. */
  page?: boolean;
}): SessionEmbedPlaceModel & { terminal: TapInTerminal | null } {
  const terminal = terminalOf(input.steer, { sessionRef: input.sessionRef, machine: input.machine });
  const lives = whereOf(input.steer);
  const reachable = terminalGo(terminal) ? terminal : null;
  const [primary = null, ...rest] = tapInPlaces({ terminal: reachable, lives, page: input.page ?? true, window: false, thread: false, work: false });
  return {
    terminal,
    lives,
    primary,
    page: rest.find((p) => p.to === "page") ?? null,
    attach: terminal?.via === "attach" && !reachable ? terminal.command : null,
  };
}

export function SessionEmbedPlaceView({
  model,
  go,
  openPage,
  line,
}: {
  model: SessionEmbedPlaceModel;
  go: (place: TapInPlace) => void;
  openPage: () => void;
  line: string | null;
}) {
  if (!model.primary) return null;
  // "Go to herdr main / p3" already says where; the bare place would repeat it.
  const where = model.lives && !model.primary.label.includes(model.lives) ? model.lives : null;
  return (
    <nav className="s-observe-embed-place" aria-label="Where the session is">
      {where && <span className="s-observe-embed-place-where" title={where}>{where}</span>}
      <button type="button" className="s-observe-embed-place-go" title={model.primary.title} onClick={() => go(model.primary!)}>
        {model.primary.label}
      </button>
      {model.page && (
        <button type="button" className="s-observe-embed-place-alt" title={model.page.title} onClick={openPage}>
          {model.page.label}
        </button>
      )}
      {model.attach && <code className="s-observe-embed-place-attach" title="Run this in a terminal to attach">{model.attach}</code>}
      {line && <span className="s-observe-embed-place-line" role="status">{line}</span>}
    </nav>
  );
}

/** Reads where the session lives and offers the way there. Renders nothing until it knows. */
export function SessionEmbedPlace(props: { sessionRef: string | null; machineId: string | null; page?: boolean }) {
  return <SessionEmbedPlaceRead key={JSON.stringify([props.sessionRef, props.machineId])} {...props} />;
}

export function sessionEmbedSteerFor(snapshot: { sessionRef: string; machine: string; steer: SessionSteerAvailability } | null, sessionRef: string, machine: string): SessionSteerAvailability | null {
  return snapshot?.sessionRef === sessionRef && snapshot.machine === machine ? snapshot.steer : null;
}

function SessionEmbedPlaceRead({ sessionRef, machineId, page }: { sessionRef: string | null; machineId: string | null; page?: boolean }) {
  const [machine, setMachine] = useState<string | null>(machineId);
  const [snapshot, setSnapshot] = useState<{ sessionRef: string; machine: string; steer: SessionSteerAvailability } | null>(null);
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (machineId) { setMachine(machineId); return; }
    let stopped = false;
    setMachine(null);
    void readLocalNodeId().then((id) => { if (!stopped) setMachine(id); });
    return () => { stopped = true; };
  }, [machineId]);

  useEffect(() => {
    if (!sessionRef || !machine) return;
    let stopped = false;
    const read = () => api<SessionSteerAvailability>(sessionSteerPath({ sessionId: sessionRef, sessionRef, machineId: machine }))
      .then((value) => { if (!stopped) setSnapshot({ sessionRef, machine, steer: value }); }, () => {});
    void read();
    const timer = window.setInterval(read, STEER_REFRESH_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [sessionRef, machine]);

  // Never offer a capability captured for another session or host, including
  // the render before the refresh effect runs or when that refresh fails.
  const effectiveMachine = machineId ?? machine;
  if (!sessionRef || !effectiveMachine) return null;
  const steer = sessionEmbedSteerFor(snapshot, sessionRef, effectiveMachine);
  const model = sessionEmbedPlaceModel({ steer, sessionRef, machine: effectiveMachine, page });
  const pageUrl = sessionPageUrl({ sessionRef, machineId: effectiveMachine });
  const openPage = () => { setLine(null); window.open(pageUrl, "_blank", "noopener"); };
  const done = (r: SessionPlaceResult) => setLine(r.ok ? (r.app ? `Opened in ${r.app}` : null) : r.reason);
  const go = (place: TapInPlace) => {
    if (place.to === "page") return openPage();
    const reach = terminalGo(model.terminal);
    if (!reach) return;
    setLine(null);
    void reach.run().then(done);
  };
  return <SessionEmbedPlaceView model={model} go={go} openPage={openPage} line={line} />;
}
