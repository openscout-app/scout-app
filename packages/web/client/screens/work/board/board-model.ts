/**
 * The work board's model: what a card shows, which cards a view and its
 * filters keep, how a column is ordered, and how the runtime's answer to a
 * move reads. Pure functions over the board read; the runtime decides moves.
 */
import type { WebWorkBoardCard, WebWorkMoveDecision, WebWorkMoveResponse, WebWorkMoveVerdict, WebWorkStation } from "../../../../shared/api/web.ts";
import type { Route } from "../../../lib/types.ts";

/** The operator's id on work items and moves. */
export const OPERATOR_ID = "operator";

export type BoardView = "all" | "my-move" | "working" | "review";
export type BoardLayout = "board" | "lanes" | "list";
export type BoardOrder = "manual" | "updated" | "priority";
export type CardProp = "priority" | "owner" | "age" | "status";

export const ALL_PROPS: readonly CardProp[] = ["priority", "owner", "age", "status"];
export const PROP_LABEL: Record<CardProp, string> = { priority: "Priority", owner: "Owner", age: "Age", status: "Status line" };
export const VIEW_LABEL: Record<BoardView, string> = { all: "All work", "my-move": "My move", working: "Agents working", review: "Review queue" };
export const VERDICT_LABEL: Record<WebWorkMoveVerdict, string> = { allow: "Moves", hold: "Holds", consult: "Asks", deny: "Refused" };

/** Stations that end the work. Cards there carry no next move. */
const SETTLED_STATES = new Set(["done", "cancelled"]);
export const isSettled = (station: WebWorkStation | undefined) => Boolean(station && SETTLED_STATES.has(station.state));

/** 0 none, 1 low, 2 normal, 3 high, 4 urgent. */
export function priorityRank(priority: string | null | undefined): 0 | 1 | 2 | 3 | 4 {
  switch ((priority ?? "").toLowerCase()) {
    case "urgent": return 4;
    case "high": return 3;
    case "normal": case "medium": return 2;
    case "low": return 1;
    default: return 0;
  }
}
export const PRIORITY_LABEL = ["No priority", "Low", "Normal", "High", "Urgent"] as const;

/**
 * Two letters for an avatar. Agent names often lead with their project
 * ("demo-app-planck-9"), so the last word of letters names the agent.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").split(/[^A-Za-z]+/).filter(Boolean);
  if (!words.length) return "";
  const pick = words[words.length - 1]!;
  return pick.slice(0, 2).toUpperCase();
}

/** One of six avatar tints, stable for an id. */
export function tintOf(id: string | null | undefined): number {
  let h = 0;
  for (const ch of id ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

/** The operator's move on a card. A failed run is not one: it sits in its own group with Retry and Drop. */
export const isYourMove = (card: WebWorkBoardCard, station: WebWorkStation | undefined) =>
  card.item.nextMoveOwnerId === OPERATOR_ID && !isSettled(station) && !card.item.failedRun;
/*
 * Where a card stands on the board, and what each column means. Everything below reads one table, SESSION_PHASES, so
 * the placement and the column definitions shown to the operator cannot drift.
 *
 * A card's session phase comes from its newest unended flight (item.liveFlight, from the server):
 *   working   flight `running` with activity within SESSION_QUIET_AFTER_MS
 *   stale     flight `running` with no activity for longer than that
 *   starting  flight `queued` or `waking`
 *   waiting   flight `waiting` (on someone)
 *   none      no unended flight
 * Activity is the latest of the flight's start, its session's last acknowledgement and the item's latest work event.
 * The runtime records no session heartbeat beyond these, so a session that works silently past the window reads stale.
 *
 * Precedence: a station the board never moves (review, done, dropped) wins; then the phase's target station; then
 * the runtime's station, except that the working station holds only working cards.
 */

/** How long a running flight's session can go without recorded activity and still count as working. Same quiet
 * window the Sessions board uses for a native session. */
export const SESSION_QUIET_AFTER_MS = 30 * 60_000;

export type SessionPhase = "working" | "stale" | "starting" | "waiting" | "none";

/** Flight states that have ended (FlightState in @openscout/protocol). */
export const ENDED_FLIGHT_STATES = ["completed", "failed", "cancelled"] as const;

type PhaseTarget = "working" | "waiting" | "stay";

/** Each session phase: the flight states it covers, the liveness test, the station state it pulls a card to, and its label. */
export const SESSION_PHASES: Record<SessionPhase, { flightStates: readonly string[]; liveness: "fresh" | "quiet" | null; target: PhaseTarget; label: string }> = {
  working: { flightStates: ["running"], liveness: "fresh", target: "working", label: "Working" },
  stale: { flightStates: ["running"], liveness: "quiet", target: "stay", label: "Stale" },
  starting: { flightStates: ["queued", "waking"], liveness: null, target: "stay", label: "Starting" },
  waiting: { flightStates: ["waiting"], liveness: null, target: "waiting", label: "Waiting on someone" },
  none: { flightStates: [], liveness: null, target: "stay", label: "No session" },
};

const PHASE_ORDER: readonly SessionPhase[] = ["working", "stale", "starting", "waiting", "none"];

/** The session phase of a card's newest unended flight at `now`. */
export function sessionPhase(item: WebWorkBoardCard["item"], now = Date.now()): SessionPhase {
  const flight = item.liveFlight;
  if (!flight || (ENDED_FLIGHT_STATES as readonly string[]).includes(flight.state)) return "none";
  const fresh = flight.lastActivityAt !== null && now - flight.lastActivityAt <= SESSION_QUIET_AFTER_MS;
  for (const phase of PHASE_ORDER) {
    const rule = SESSION_PHASES[phase];
    if (!rule.flightStates.includes(flight.state)) continue;
    if (rule.liveness === "fresh" && !fresh) continue;
    if (rule.liveness === "quiet" && fresh) continue;
    return phase;
  }
  return "none";
}

/** A session is working on the card right now. */
export const isWorking = (card: WebWorkBoardCard, now = Date.now()) => sessionPhase(card.item, now) === "working";

/**
 * The canonical session view for a card's live flight: its current session once it has one, else the flight itself
 * (the session view follows a flight to its session). Null when no flight is live.
 */
export function liveSessionRoute(item: WebWorkBoardCard["item"]): Route | null {
  const flight = item.liveFlight;
  if (!flight || (ENDED_FLIGHT_STATES as readonly string[]).includes(flight.state)) return null;
  return flight.sessionId ? { view: "sessions", sessionId: flight.sessionId } : { view: "sessions", flightId: flight.id };
}

/** Station states the board places cards into or out of. Every other station keeps the runtime's cards as they are. */
const PLACED = new Set(["open", "waiting", "working"]);

/** The station that means a session is working on the item right now. */
export const workingStation = (stations: readonly WebWorkStation[]) => stations.find((s) => s.state === "working");

/** The station for work waiting on someone. */
export const waitingStation = (stations: readonly WebWorkStation[]) => stations.find((s) => s.state === "waiting");

/** Where work goes when the working station can't hold it: the last open station. */
export function idleStation(stations: readonly WebWorkStation[]): WebWorkStation | undefined {
  const open = stations.filter((s) => s.state === "open");
  return open[open.length - 1];
}

const targetStation = (target: PhaseTarget, stations: readonly WebWorkStation[]) =>
  target === "working" ? workingStation(stations) : target === "waiting" ? waitingStation(stations) : undefined;

/** Where a card the runtime has in `here` stands when its session phase is `phase`. */
export function placeFrom(here: WebWorkStation, phase: SessionPhase, stations: readonly WebWorkStation[]): WebWorkStation {
  if (!PLACED.has(here.state)) return here;
  const target = targetStation(SESSION_PHASES[phase].target, stations);
  if (target) return target;
  if (here.state === "working") return idleStation(stations) ?? here;
  return here;
}

/** The station a card stands in on the board at `now`. */
export function placeStation(card: WebWorkBoardCard, stations: readonly WebWorkStation[], now = Date.now()): string {
  const here = stations.find((s) => s.id === card.station);
  return here ? placeFrom(here, sessionPhase(card.item, now), stations).id : card.station;
}

/** The cards with each one in the station it stands in. A card that stays put is the same object. */
export function placeCards(cards: readonly WebWorkBoardCard[], stations: readonly WebWorkStation[], now = Date.now()): WebWorkBoardCard[] {
  return cards.map((card) => {
    const station = placeStation(card, stations, now);
    return station === card.station ? card : { ...card, station };
  });
}

/** A column's placement rule, spelled out from SESSION_PHASES, placeFrom() and the constants above. */
export type ColumnDefinition = {
  rule: string;
  reads: string[];
  qualifies: string[];
  excluded: string[];
  liveness: string | null;
  precedence: string[];
};

const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;
const codes = (list: readonly string[]) => list.map((s) => `\`${s}\``).join(", ");

/** The flight condition for a phase, in the fields and states the code tests. */
export function phaseCondition(phase: SessionPhase): string {
  const rule = SESSION_PHASES[phase];
  if (phase === "none") return `no unended flight (ended: ${codes(ENDED_FLIGHT_STATES)})`;
  const quiet = rule.liveness === "fresh" ? `, activity within ${minutes(SESSION_QUIET_AFTER_MS)}`
    : rule.liveness === "quiet" ? `, no activity for over ${minutes(SESSION_QUIET_AFTER_MS)}` : "";
  return `flight ${codes(rule.flightStates)}${quiet}`;
}

const READS = [
  "card.station: the runtime's station",
  "item.liveFlight.state: FlightState of the newest unended flight",
  "item.liveFlight.lastActivityAt: max(flight start, session lastAcknowledgedAt, latest work event)",
];

/** What puts a card in a column, generated from the same table, function and constants the placement uses. */
export function columnDefinition(station: WebWorkStation, stations: readonly WebWorkStation[]): ColumnDefinition {
  const placed = stations.filter((s) => PLACED.has(s.state));
  const fixed = stations.filter((s) => !PLACED.has(s.state)).map((s) => s.name);
  const working = workingStation(stations);
  const precedence = [
    `${fixed.join(", ")}: the runtime's station stands; session phase is not read.`,
    ...PHASE_ORDER.flatMap((p) => { const t = targetStation(SESSION_PHASES[p].target, stations); return t ? [`Phase ${p} → ${t.name}.`] : []; }),
    working ? `Any other phase keeps the runtime's station, but not ${working.name}: it goes to ${idleStation(stations)?.name ?? "the runtime's station"}.` : "Any other phase keeps the runtime's station.",
  ];
  if (!PLACED.has(station.state)) {
    return { rule: `The runtime's station is ${station.name} (state \`${station.state}\`).`, reads: [READS[0]!], qualifies: ["every session phase"], excluded: [], liveness: null, precedence };
  }
  const leaves = PHASE_ORDER.filter((p) => placeFrom(station, p, stations).id !== station.id);
  // Every (runtime station, phase) pair that lands here, grouped so phases from the same stations read as one clause.
  const sources = new Map<SessionPhase, string[]>();
  for (const p of PHASE_ORDER) {
    const from = [station, ...placed.filter((h) => h.id !== station.id)].filter((h) => placeFrom(h, p, stations).id === station.id).map((h) => h.name);
    if (from.length) sources.set(p, from);
  }
  const clauses = new Map<string, SessionPhase[]>();
  for (const [p, from] of sources) clauses.set(from.join(", "), [...(clauses.get(from.join(", ")) ?? []), p]);
  const or = (list: readonly string[]) => list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0] ?? "";
  const rule = [...clauses].map(([from, ps]) => `its phase is ${or(ps)} and the runtime has it in ${or(from.split(", "))}`).join("; or ");
  return {
    rule: `${rule[0]?.toUpperCase() ?? ""}${rule.slice(1)}.`,
    reads: [...READS],
    qualifies: [...sources.keys()].map((p) => `${p}: ${phaseCondition(p)}`),
    excluded: leaves.map((p) => `${p}: ${phaseCondition(p)} → ${placeFrom(station, p, stations).name}`),
    liveness: `working when now − lastActivityAt ≤ SESSION_QUIET_AFTER_MS (${minutes(SESSION_QUIET_AFTER_MS)}); a running flight past it is stale`,
    precedence,
  };
}

export type BoardFilters = { view: BoardView; owners: readonly string[]; hideSettled: boolean; query: string };

/** The cards a view and its filters keep, in the order asked for. */
export function visibleCards(
  cards: readonly WebWorkBoardCard[],
  stations: ReadonlyMap<string, WebWorkStation>,
  filters: BoardFilters,
  order: BoardOrder,
): WebWorkBoardCard[] {
  const q = filters.query.trim().toLowerCase();
  const kept = cards.filter((card) => {
    const station = stations.get(card.station);
    if (filters.view === "my-move" && !isYourMove(card, station)) return false;
    if (filters.view === "working" && !isWorking(card)) return false;
    if (filters.view === "review" && !card.reviewPending) return false;
    if (filters.owners.length && !filters.owners.includes(ownerKey(card))) return false;
    if (filters.hideSettled && isSettled(station)) return false;
    if (q) {
      const { item } = card;
      const hay = `${item.title}\n${item.summary ?? ""}\n${item.ownerName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (order === "updated") return [...kept].sort((a, b) => b.item.lastMeaningfulAt - a.item.lastMeaningfulAt);
  if (order === "priority") {
    return [...kept].sort((a, b) => priorityRank(b.item.priority) - priorityRank(a.item.priority) || b.item.lastMeaningfulAt - a.item.lastMeaningfulAt);
  }
  return kept;
}

/** The owner a filter or a lane groups by; "" is no owner. */
export const ownerKey = (card: WebWorkBoardCard) => card.item.ownerId ?? "";

export type OwnerOption = { id: string; name: string; count: number };

/** Owners on the board, busiest first. */
export function ownerOptions(cards: readonly WebWorkBoardCard[]): OwnerOption[] {
  const byId = new Map<string, OwnerOption>();
  for (const card of cards) {
    const id = ownerKey(card);
    const entry = byId.get(id) ?? { id, name: card.item.ownerName ?? (id || "No owner"), count: 0 };
    entry.count += 1;
    byId.set(id, entry);
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The failing reasons that decided a move, in the runtime's words. */
export function failingReasons(decision: WebWorkMoveDecision): string[] {
  return decision.reasons.filter((r) => r.outcome === "fail" && !r.shadow && r.effect !== "advise").map((r) => r.message);
}

/** A verdict in one line, as a column shows it while a card is held over it. */
export function verdictNote(decision: WebWorkMoveDecision): string {
  const failed = failingReasons(decision).join(" ");
  if (decision.verdict === "allow") return decision.review === "pending" ? "Moves, then waits for review." : "Moves now.";
  return failed || (decision.verdict === "deny" ? "The lifecycle does not allow it." : "");
}

/** What a station needs from the mover before the move is worth sending. */
export function stationAsk(station: WebWorkStation): "note" | "waiting" | null {
  if (station.rules.some((r) => r.check === "has_waiting_on" && !r.shadow)) return "waiting";
  if (station.rules.some((r) => r.check === "has_note" && !r.shadow && r.effect !== "advise")) return "note";
  return null;
}

/**
 * Whether a refusal is only the missing note or blocker the station asks
 * for: then the fix is to say it, not to give up on the move.
 */
export function refusalIsAsk(decision: WebWorkMoveDecision): boolean {
  const failed = decision.reasons.filter((r) => r.outcome === "fail" && !r.shadow && r.effect !== "advise");
  return decision.verdict === "deny" && failed.length > 0 && failed.every((r) => r.check === "has_waiting_on" || r.check === "has_note");
}

/** A hold the mover can lift by claiming the card. */
export const claimLifts = (decision: WebWorkMoveDecision) =>
  decision.verdict === "hold" && decision.reasons.some((r) => r.outcome === "fail" && r.check === "mover_is_owner" && !r.shadow);

/** The verdict a column shows for a station the card has no path to. */
export function unreachable(from: WebWorkStation | undefined, to: WebWorkStation): WebWorkMoveDecision {
  return {
    verdict: "deny", from: from?.id ?? "", to: to.id, toState: to.state, judges: [], review: "not_needed",
    reasons: [{ ruleId: "path", scope: "lifecycle", check: "transition", outcome: "fail", effect: "deny", message: `No path from ${from?.name ?? "here"} to ${to.name}.` }],
  };
}

/** The band a card keeps after the runtime answered its move without applying it. */
export function answerBand(answer: WebWorkMoveResponse | undefined): { kind: "hold" | "consult" | "deny"; text: string } | null {
  if (!answer || answer.applied || answer.decision.verdict === "allow") return null;
  const note = verdictNote(answer.decision);
  return { kind: answer.decision.verdict, text: note };
}

/** Lanes: one per owner, in the order owners first appear, "No owner" last. */
export function lanesByOwner(cards: readonly WebWorkBoardCard[]): Array<{ key: string; name: string; cards: WebWorkBoardCard[] }> {
  const lanes = new Map<string, { key: string; name: string; cards: WebWorkBoardCard[] }>();
  for (const card of cards) {
    const key = ownerKey(card);
    const lane = lanes.get(key) ?? { key, name: card.item.ownerName ?? (key || "No owner"), cards: [] };
    lane.cards.push(card);
    lanes.set(key, lane);
  }
  return [...lanes.values()].sort((a, b) => Number(a.key === "") - Number(b.key === "") || b.cards.length - a.cards.length);
}

/** The lifecycle's path for the detail panel: every station but the ones that cancel. */
export const lifecyclePath = (stations: readonly WebWorkStation[]) => stations.filter((s) => s.state !== "cancelled");

/** Display settings an instance keeps in its config. */
export type BoardDisplay = { layout: BoardLayout; order: BoardOrder; props: CardProp[]; compact: boolean; showEmpty: boolean; view: BoardView };

export function readDisplay(config: Readonly<Record<string, string>>): BoardDisplay {
  const layout = (["board", "lanes", "list"] as const).find((l) => l === config.layout) ?? "board";
  const order = (["manual", "updated", "priority"] as const).find((o) => o === config.order) ?? "manual";
  const view = (["all", "my-move", "working", "review"] as const).find((v) => v === config.view) ?? "all";
  const props = config.props === undefined || config.props === ""
    ? [...ALL_PROPS]
    : config.props === "none" ? [] : config.props.split(",").filter((p): p is CardProp => (ALL_PROPS as readonly string[]).includes(p));
  return { layout, order, view, props, compact: config.compact === "1", showEmpty: config.empty !== "0" };
}

/** Stations that start folded: finished and cancelled work only collect. The facts strip counts what closed today. */
export function defaultFolded(stations: readonly WebWorkStation[]): string[] {
  return stations.filter((s) => s.state === "done" || s.state === "cancelled").map((s) => s.id);
}

/**
 * Folded sections as the panel config keeps them: absent or "" means the
 * default set, "none" means nothing folded, otherwise a comma list of keys.
 */
export function readFolded(raw: string | undefined, fallback: readonly string[]): ReadonlySet<string> {
  if (raw === undefined || raw === "") return new Set(fallback);
  if (raw === "none") return new Set();
  return new Set(raw.split(",").filter(Boolean));
}

export function writeFolded(keys: Iterable<string>, fallback: readonly string[]): string {
  const next = [...new Set(keys)].filter(Boolean).sort();
  const base = [...new Set(fallback)].sort();
  if (next.length === base.length && next.every((k, i) => k === base[i])) return "";
  return next.length ? next.join(",") : "none";
}

/** The fold key for a swimlane; the lane with no owner has an empty key. */
export const laneFoldKey = (key: string) => key || "-";

export function writeProps(props: readonly CardProp[]): string {
  if (ALL_PROPS.every((p) => props.includes(p))) return "";
  return props.length ? ALL_PROPS.filter((p) => props.includes(p)).join(",") : "none";
}
