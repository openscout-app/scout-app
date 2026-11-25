import { useEffect, useRef, useState } from "react";

import { subscribeBrokerEvents, type BrokerEvent } from "../../../lib/sse.ts";
import type { FlowSourceMessage } from "../../../lib/comms-flow.ts";
import {
  awayPoint,
  DEMO_FLIGHT_MS,
  demoFlightMessage,
  easeFlight,
  flightDuration,
  flightPath,
  messageFlights,
  nearestOnBox,
  type Box,
  type FlightDesk,
  type FlightEnd,
  type Point,
} from "./message-flight-model.ts";
import "./flight.css";

/*
 * Message flights over the desk. Each message posted on the runtime draws one
 * thin light from its sender to its recipient: a desk figure, the board (the
 * operator), or the screen edge (anyone not on this desk, other hosts
 * included). Like Blink it never takes the pointer and nothing glows, and it
 * draws only when the surface covers the screen. Reduce Motion hides it.
 */

/** Flights on screen at once; a burst past this drops the oldest. */
const MAX_FLIGHTS = 8;

type Shot = { id: string; d: string; ms: number; to: Point };

/** Where posted messages come from; returns its unsubscribe. */
export type FlightSource = (emit: (message: FlowSourceMessage) => void) => () => void;

/** The runtime: every `message.posted` on the broker's control stream. */
export const runtimeFlights: FlightSource = (emit) => subscribeBrokerEvents((event: BrokerEvent) => {
  if (event.kind !== "message.posted") return;
  const message = (event.payload as { message?: FlowSourceMessage } | undefined)?.message;
  if (message?.id && message.actorId) emit(message);
});

/** The demo desk: a scripted message every DEMO_FLIGHT_MS. */
export const demoFlights: FlightSource = (emit) => {
  let step = 0;
  const timer = setInterval(() => emit(demoFlightMessage(step++, Date.now())), DEMO_FLIGHT_MS);
  return () => clearInterval(timer);
};

function figurePoint(pin: string): Point | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-placed="${CSS.escape(pin)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 };
  }
  return null;
}

export function FlightLayer({ on, desk, board, source = runtimeFlights }: {
  on: boolean;
  source?: FlightSource;
  /** The desk as it is now; read when a message arrives, so it is never stale. */
  desk: () => FlightDesk;
  board: () => Box | null;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const deskRef = useRef(desk);
  const boardRef = useRef(board);
  deskRef.current = desk;
  boardRef.current = board;

  useEffect(() => {
    if (!on) { setShots([]); return; }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    return source((message) => {
      if (reduced?.matches || document.hidden) return;
      const flights = messageFlights(message, deskRef.current(), Date.now());
      if (!flights.length) return;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const box = boardRef.current();
      const local = (end: FlightEnd): Point | null =>
        end.kind === "figure" ? figurePoint(end.pin) : end.kind === "board" && box ? { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 } : null;

      const drawn: Shot[] = [];
      for (const flight of flights) {
        let a = local(flight.from);
        let b = local(flight.to);
        if (!a && !b) continue;
        // A figure that is hidden, or a board not drawn, counts as away.
        a ??= awayPoint(b!, w, h);
        b ??= awayPoint(a, w, h);
        if (flight.from.kind === "board" && box) a = nearestOnBox(box, b);
        if (flight.to.kind === "board" && box) b = nearestOnBox(box, a);
        drawn.push({ id: `${flight.id}:${Date.now()}`, d: flightPath(a, b), ms: flightDuration(a, b), to: b });
      }
      if (drawn.length) setShots((list) => [...list, ...drawn].slice(-MAX_FLIGHTS));
    });
  }, [on, source]);

  if (!on || !shots.length) return null;
  const done = (id: string) => setShots((list) => list.filter((s) => s.id !== id));
  return (
    <div className="flt" aria-hidden>
      <svg className="flt-sky" width="100%" height="100%">
        {shots.map((shot) => <FlightShot key={shot.id} shot={shot} onDone={() => done(shot.id)} />)}
      </svg>
    </div>
  );
}

/** The trail's length: a fifth of the flight, never a long streak. */
const TRAIL_SHARE = 0.22;
const TRAIL_MAX = 120;

/**
 * One flight. The head and its trail move together from one frame loop (SMIL
 * times a late-inserted animation from page load, so it cannot be used here);
 * when the head lands, a thin ring opens and its end clears the shot.
 */
function FlightShot({ shot, onDone }: { shot: Shot; onDone: () => void }) {
  const trail = useRef<SVGPathElement | null>(null);
  const head = useRef<SVGCircleElement | null>(null);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const path = trail.current;
    const dot = head.current;
    if (!path || !dot) return;
    const total = path.getTotalLength();
    const seg = Math.min(TRAIL_MAX, total * TRAIL_SHARE);
    path.style.strokeDasharray = `${seg} ${total + seg}`;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / shot.ms);
      const along = easeFlight(t) * total;
      const at = path.getPointAtLength(along);
      dot.setAttribute("cx", String(at.x));
      dot.setAttribute("cy", String(at.y));
      path.style.strokeDashoffset = String(seg - along);
      // In over the first tenth, out over the last sixth, so it never pops.
      const alpha = Math.min(1, t / 0.1, (1 - t) / 0.16 + 0.15);
      path.style.opacity = String(Math.max(0, alpha) * 0.9);
      dot.style.opacity = String(Math.max(0, Math.min(1, t / 0.08)));
      if (t < 1) frame = requestAnimationFrame(step);
      else setLanded(true);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [shot.ms]);

  return (
    <g className={`flt-shot${landed ? " is-landed" : ""}`}>
      <path ref={trail} className="flt-trail" d={shot.d} />
      {!landed && <circle ref={head} className="flt-head" r={2.5} cx={-10} cy={-10} />}
      {landed && <circle className="flt-land" cx={shot.to.x} cy={shot.to.y} r={3} onAnimationEnd={onDone} />}
    </g>
  );
}
