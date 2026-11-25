/**
 * Message flights: a message posted on the runtime, drawn as one light that
 * leaves its sender and lands on its recipient.
 *
 * There are three places a flight can start or end:
 *  - a desk figure, the agent or session that figure stands for;
 *  - the board, which stands for the operator (and Scoutbot, which sits beside it);
 *  - away, the screen edge, for anyone not on this desk, including agents on
 *    other hosts.
 *
 * Direction comes from what the sender addressed (`flowRecipients`), never from
 * the body. A message addressed to nobody goes to its conversation; it flies
 * only when that conversation is a desk figure's thread, so the flight never
 * guesses a recipient. Nothing flies away to away: that traffic is not this
 * desk's.
 */

import { flowRecipients, type FlowSourceMessage } from "../../../lib/comms-flow.ts";

/** A message older than this when it arrives is a replay (a reconnect), not news. */
export const FLIGHT_FRESH_MS = 20_000;
/** At most this many flights for one message: a broadcast is a burst, not a storm. */
export const FLIGHTS_PER_MESSAGE = 4;
/** How far past the screen edge an away end sits, so the light leaves the screen. */
export const AWAY_OVERSHOOT = 40;

export type DeskFigure = {
  /** The figure's pin id: a work id or `session:<id>`. */
  pin: string;
  /** The Scout agent the figure stands for, when known. */
  agentId?: string | null;
  /** The harness session behind it, when known. */
  sessionId?: string | null;
  /** The figure's thread. */
  conversationId?: string | null;
};

export type FlightDesk = {
  figures: readonly DeskFigure[];
  operatorIds: ReadonlySet<string>;
};

export type FlightEnd =
  | { kind: "figure"; pin: string }
  | { kind: "board" }
  | { kind: "away"; actorId: string };

export type Flight = {
  /** Message id and recipient: stable, so one message never draws twice. */
  id: string;
  from: FlightEnd;
  to: FlightEnd;
};

/** The board's thread fields this reads; structural, so a CornerThread fits. */
export type DeskThread = { identityId?: string | null; conversationId?: string | null };

/**
 * The figures out on the desk, by pin, with who each one is.
 *
 * `threadOf` gives the board row behind a pin, when the board shows one;
 * `pinAgents` is the agent each pin was last seen as, kept for figures whose
 * row has left the board. A native identity (`native:<harness>:<session>`)
 * and a `session:` pin both name the session that messages address.
 */
export function deskFigures(
  pins: readonly string[],
  threadOf: (pin: string) => DeskThread | undefined,
  pinAgents: Readonly<Record<string, string>>,
): DeskFigure[] {
  return pins.map((pin) => {
    const thread = threadOf(pin);
    const agentId = str(thread?.identityId) ?? str(pinAgents[pin]);
    const native = agentId?.match(/^native:[^:]+:(.+)$/)?.[1] ?? null;
    const sessionId = native ?? (pin.startsWith("session:") ? pin.slice("session:".length) : null);
    return { pin, agentId, sessionId, conversationId: str(thread?.conversationId) };
  });
}

const BOARD: FlightEnd = { kind: "board" };
const BOARD_IDS = new Set(["scoutbot"]);
const SKIP_ACTORS = new Set(["system", "broker"]);

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function figureFor(id: string, figures: readonly DeskFigure[]): DeskFigure | undefined {
  const session = id.startsWith("session:") ? id.slice("session:".length) : id;
  return figures.find((f) =>
    f.pin === id
    || f.pin === `session:${session}`
    || (f.agentId != null && f.agentId === id)
    || (f.sessionId != null && f.sessionId === session),
  );
}

/** Where an actor id is on this desk. */
export function endOf(id: string, desk: FlightDesk): FlightEnd {
  if (desk.operatorIds.has(id) || BOARD_IDS.has(id)) return BOARD;
  const figure = figureFor(id, desk.figures);
  return figure ? { kind: "figure", pin: figure.pin } : { kind: "away", actorId: id };
}

export function sameEnd(a: FlightEnd, b: FlightEnd): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "figure" && b.kind === "figure") return a.pin === b.pin;
  if (a.kind === "away" && b.kind === "away") return a.actorId === b.actorId;
  return true;
}

function senderEnd(message: FlowSourceMessage, desk: FlightDesk): FlightEnd {
  const from = endOf(message.actorId, desk);
  if (from.kind !== "away") return from;
  // An agent answers under its own id; the reply also names the session that ran it.
  const responder = str(message.metadata?.responderSessionId);
  return responder ? endOf(responder, desk) : from;
}

/** The flights one posted message draws on this desk; empty when it is not this desk's to show. */
export function messageFlights(message: FlowSourceMessage, desk: FlightDesk, now: number): Flight[] {
  if (message.class === "status" || SKIP_ACTORS.has(message.actorId)) return [];
  if (now - message.createdAt > FLIGHT_FRESH_MS) return [];

  const from = senderEnd(message, desk);
  const { ids } = flowRecipients(message, new Map());
  let ends: FlightEnd[];
  if (ids.length) {
    ends = ids.map((id) => endOf(id, desk));
  } else {
    // Sent to the conversation: only a desk figure's thread says who hears it.
    const owner = desk.figures.find((f) => f.conversationId && f.conversationId === message.conversationId);
    if (!owner) return [];
    const ownerEnd: FlightEnd = { kind: "figure", pin: owner.pin };
    ends = [sameEnd(from, ownerEnd) ? BOARD : ownerEnd];
  }

  const flights: Flight[] = [];
  for (const to of ends) {
    if (sameEnd(from, to)) continue;
    if (from.kind === "away" && to.kind === "away") continue;
    if (flights.some((f) => sameEnd(f.to, to))) continue;
    const key = to.kind === "figure" ? to.pin : to.kind === "away" ? to.actorId : "board";
    flights.push({ id: `${message.id}:${key}`, from, to });
    if (flights.length >= FLIGHTS_PER_MESSAGE) break;
  }
  return flights;
}

/* ── Demo ──────────────────────────────────────────────────────────── */

/** How often the demo desk posts a scripted message. */
export const DEMO_FLIGHT_MS = 2_400;

/**
 * The demo desk's traffic (desk-demo.ts agents), one step per tick: an ask out
 * to a figure, figure to figure, a figure to an agent on another host and its
 * answer back to the board.
 */
const DEMO_SCRIPT: ReadonlyArray<{ from: string; to: string }> = [
  { from: "operator", to: "demo-ada" },
  { from: "demo-ada", to: "demo-descartes" },
  { from: "demo-descartes", to: "mini-codex" },
  { from: "mini-codex", to: "operator" },
  { from: "operator", to: "mini-claude" },
  { from: "demo-descartes", to: "operator" },
];

export function demoFlightMessage(step: number, now: number): FlowSourceMessage {
  const { from, to } = DEMO_SCRIPT[((step % DEMO_SCRIPT.length) + DEMO_SCRIPT.length) % DEMO_SCRIPT.length]!;
  return { id: `demo-flight-${step}`, conversationId: "demo", actorId: from, body: "", createdAt: now, metadata: { targetAgentId: to } };
}

/* ── Geometry ──────────────────────────────────────────────────────── */

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

/** The point of a box nearest to `toward`: a flight touches the board's edge, not its middle. */
export function nearestOnBox(box: Box, toward: Point): Point {
  const x = Math.min(Math.max(toward.x, box.left), box.right);
  const y = Math.min(Math.max(toward.y, box.top), box.bottom);
  if (x !== toward.x || y !== toward.y) return { x, y };
  // `toward` is inside the box: the nearest edge.
  const d = [toward.y - box.top, box.bottom - toward.y, toward.x - box.left, box.right - toward.x];
  const i = d.indexOf(Math.min(...d));
  return i === 0 ? { x, y: box.top } : i === 1 ? { x, y: box.bottom } : i === 2 ? { x: box.left, y } : { x: box.right, y };
}

/**
 * Where an away end sits for a flight from or to `local`: up and out over the
 * top edge, leaning toward the middle of the screen. Close to the top already,
 * it leaves by the nearer side instead, so the light is never a short blip.
 */
export function awayPoint(local: Point, width: number, height: number): Point {
  if (local.y < Math.min(160, height / 4)) {
    const left = local.x < width / 2;
    return { x: left ? -AWAY_OVERSHOOT : width + AWAY_OVERSHOOT, y: Math.min(height, local.y + 120) };
  }
  return { x: local.x + (width / 2 - local.x) * 0.2, y: -AWAY_OVERSHOOT };
}

/** A gentle arc from `a` to `b`, bowed upward by a fifth of its length. */
export function flightPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  // The normal that points up the screen (negative y).
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const bow = length * 0.2;
  const cx = (a.x + b.x) / 2 + nx * bow;
  const cy = (a.y + b.y) / 2 + ny * bow;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M ${r(a.x)} ${r(a.y)} Q ${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`;
}

/**
 * The flight's ease, cubic-bezier(0.45, 0, 0.25, 1) (Blink's): leaves gently,
 * travels fast, settles. Solved for x by Newton's method, then bisection.
 */
export function easeFlight(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = [0.45, 0, 0.25, 1];
  const bez = (s: number, a: number, b: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
  const dbez = (s: number, a: number, b: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s ** 2;
  let s = t;
  for (let i = 0; i < 6; i++) {
    const d = dbez(s, x1, x2);
    if (Math.abs(d) < 1e-6) break;
    s -= (bez(s, x1, x2) - t) / d;
  }
  if (!(s >= 0 && s <= 1) || Math.abs(bez(s, x1, x2) - t) > 1e-4) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { s = (lo + hi) / 2; if (bez(s, x1, x2) < t) lo = s; else hi = s; }
  }
  return bez(s, y1, y2);
}

/** Quick for a short hop, never slow across a display. */
export function flightDuration(a: Point, b: Point): number {
  return Math.round(Math.min(1100, 520 + Math.hypot(b.x - a.x, b.y - a.y) / 2.4));
}
