import type { Route, WorkDetail, WorkItem } from "../../../lib/types.ts";
import { harnessLabel } from "../../../components/HarnessMark.tsx";
import { isGeneratedSessionName } from "../../../lib/harness-session-title.ts";
import { FOLLOW_PAGE, scopeValue } from "./follow-page.ts";

/*
 * The Work view's rules, without React: which work item a panel shows, and
 * what the Flights, Participants, Case and list panels draw from a work item.
 * The work-*.tsx modules read these; work-view-model.test.ts holds them.
 */

// ── Which work item ─────────────────────────────────────────────────────────

/** The work item the page is on: /work/:id, or an Ops Tail or Follow link that names one. */
export function pageWorkId(route: Route): string {
  if (route.view === "work") return route.workId;
  if (route.view === "ops" || route.view === "follow") return route.workId ?? "";
  return "";
}

export type PanelWork = {
  /** "" = none chosen: the panel says how to pick one. */
  workId: string;
  /** The panel tracks the page's work item rather than a fixed one. */
  following: boolean;
  /**
   * The panel follows the page on the Work view itself: it keeps the page's
   * back control and page-wide keys, and its links move the page.
   */
  own: boolean;
};

/** A panel's work item: its own choice, or the page's when it follows the page. */
export function panelWork(route: Route, value: string | undefined): PanelWork {
  const following = value === FOLLOW_PAGE;
  return {
    workId: scopeValue(value, pageWorkId(route)),
    following,
    own: following && route.view === "work",
  };
}

/** The work item on its own page. Navigation keeps the page's ?machineId= (the route is machine scoped). */
export function workRoute(workId: string): Route {
  return { view: "work", workId };
}

/** Open full is offered unless the panel already is the page's work item. */
export function offersOpenFull(route: Route, work: PanelWork): boolean {
  return Boolean(work.workId) && !(route.view === "work" && route.workId === work.workId);
}

// ── The list ────────────────────────────────────────────────────────────────

/** Which work a list shows: "" = active work (as the Work module always read), "all" = done too. */
export type WorkListShow = "" | "all";

export function workListPath(show: string | undefined): string {
  return show === "all" ? "/api/work?active=false&limit=60" : "/api/work?limit=40";
}

/** Work an agent on the page's machine owns or has the next move on; null ids = no machine scope. */
export function filterWorkByAgents(items: readonly WorkItem[], agentIds: ReadonlySet<string> | null): WorkItem[] {
  if (!agentIds) return [...items];
  return items.filter((item) => Boolean(
    (item.ownerId && agentIds.has(item.ownerId)) || (item.nextMoveOwnerId && agentIds.has(item.nextMoveOwnerId)),
  ));
}

/** Most recently moved first; an owner filter when one is set. */
/**
 * The owner a work row names. A runtime-generated name ("Session Mwfxl324
 * Wqoium") is an id read aloud, so the row says whose session it is instead,
 * as the Projects list does.
 */
/** An owner's name, or "Claude session" when the name is the runtime's id read aloud. */
export function sessionOwnerLabel(name: string, harness: string | null | undefined): string {
  if (!isGeneratedSessionName(name)) return name;
  return harness ? `${harnessLabel(harness)} session` : "Session";
}

export function workOwnerLabel(
  item: Pick<WorkItem, "ownerId" | "ownerName" | "nextMoveOwnerId" | "nextMoveOwnerName">,
  harnessOf: (agentId: string) => string | null | undefined,
): string {
  const next = item.nextMoveOwnerName != null;
  const name = ((next ? item.nextMoveOwnerName : item.ownerName) ?? "").trim();
  if (!isGeneratedSessionName(name)) return name;
  const id = next ? item.nextMoveOwnerId : item.ownerId;
  return sessionOwnerLabel(name, id ? harnessOf(id) : null);
}

export function workListRows(items: readonly WorkItem[], owner: string | undefined): WorkItem[] {
  return (owner ? items.filter((item) => item.ownerId === owner) : [...items])
    .sort((a, b) => b.lastMeaningfulAt - a.lastMeaningfulAt);
}

/**
 * What marks a row as wanting the operator: a blocker, or a review that is
 * the operator's move. Everything else reads from its phase.
 */
export function workRowMark(item: Pick<WorkItem, "state" | "attention" | "acceptanceState" | "nextMoveOwnerId">): string | null {
  if (item.state === "done") return null;
  if (item.attention === "interrupt") return "Blocked";
  const acceptance = item.acceptanceState && item.acceptanceState !== "none" ? item.acceptanceState : null;
  if (item.state === "review" && (!acceptance || acceptance === "pending") && item.nextMoveOwnerId === "operator") {
    return "Awaiting your review";
  }
  return null;
}

/** The picker's options: recent work by title, the id when a title repeats. */
export function workOptions(items: readonly WorkItem[]): { value: string; label: string }[] {
  const seen = new Map<string, number>();
  for (const item of items) seen.set(item.title, (seen.get(item.title) ?? 0) + 1);
  return workListRows(items, undefined).map((item) => ({
    value: item.id,
    label: (seen.get(item.title) ?? 0) > 1 ? `${item.title} · ${item.id}` : item.title || item.id,
  }));
}

// ── Flights and deliveries ──────────────────────────────────────────────────

export type WorkFlightRow = {
  id: string;
  agentId: string;
  agentLabel: string;
  state: string;
  /** Where the ask stands on its way to the agent, when the broker says. */
  delivery: string | null;
  /** The asker stopped waiting; the agent may still be running. */
  waitNote: string | null;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  /** The newest session the flight ran in. */
  sessionId: string | null;
  sessionCount: number;
  conversationId: string | null;
  /** The work item's own ask (the Run card's flight). */
  primary: boolean;
  active: boolean;
  /** Its session view: the flight observed, as a receipt's Session link opens it. */
  open: Route;
};

const TERMINAL_FLIGHT_STATES = new Set(["completed", "done", "failed", "cancelled", "canceled", "expired"]);

function sentence(text: string): string {
  const clean = text.replace(/[_-]+/g, " ").trim();
  return clean ? clean[0]!.toUpperCase() + clean.slice(1).toLowerCase() : clean;
}

function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "thread_held_externally") return "its thread is open in another app";
  return reason.replace(/[_-]+/g, " ").toLowerCase();
}

/** The delivery line for one flight: the broker's outcome, else what its sessions say. */
export function flightDelivery(flight: WorkDetail["allFlights"][number]): string | null {
  const outcome = flight.dispatchOutcome;
  if (outcome?.status) {
    const reason = reasonText(outcome.reason);
    const label = outcome.status === "queued_until_online"
      ? "Queued until online"
      : outcome.status === "not_submitted"
        ? "Not delivered yet"
        : outcome.status === "submission_unknown"
          ? "Delivery unknown"
          : sentence(outcome.status);
    return reason ? `${label}: ${reason}` : label;
  }
  if (flight.sessions.length > 0) return flight.sessions.length > 1 ? `Delivered to ${flight.sessions.length} sessions` : "Delivered to a session";
  if (flight.state === "queued") return "Queued";
  return null;
}

/**
 * Every flight the work item ran, active first, then newest. In a machine
 * scope (agent ids given) only flights on that machine's agents.
 */
export function workFlightRows(detail: WorkDetail, agentIds: ReadonlySet<string> | null): WorkFlightRow[] {
  const byId = new Map<string, WorkDetail["allFlights"][number]>();
  for (const flight of [...(detail.allFlights ?? []), ...detail.activeFlights]) byId.set(flight.id, { ...byId.get(flight.id), ...flight });
  const activeIds = new Set(detail.activeFlights.map((flight) => flight.id));
  const primaryId = detail.primaryInvocation?.flightId ?? null;
  return [...byId.values()]
    .filter((flight) => !agentIds || agentIds.has(flight.agentId))
    .map((flight): WorkFlightRow => {
      const sessions = [...flight.sessions].sort((a, b) => b.startedAt - a.startedAt);
      const sessionId = sessions[0]?.sessionId ?? null;
      const active = activeIds.has(flight.id) || !TERMINAL_FLIGHT_STATES.has(flight.state);
      return {
        id: flight.id,
        agentId: flight.agentId,
        agentLabel: flight.agentName ?? flight.agentId,
        state: flight.state,
        delivery: flightDelivery(flight),
        waitNote: flight.requesterWaitTimedOut ? "The asker stopped waiting; the agent may still be running." : null,
        summary: flight.summary,
        startedAt: flight.startedAt,
        completedAt: flight.completedAt,
        sessionId,
        sessionCount: sessions.length,
        conversationId: flight.conversationId,
        primary: flight.id === primaryId,
        active,
        open: {
          view: "sessions",
          flightId: flight.id,
          ...(sessionId ? { sessionId } : {}),
          ...(flight.agentId ? { agentId: flight.agentId } : {}),
        },
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

// ── Participants ────────────────────────────────────────────────────────────

export type WorkRole = "Owner" | "Next move" | "Asked" | "Ran" | "Wrote";
const ROLE_ORDER: readonly WorkRole[] = ["Owner", "Next move", "Asked", "Ran", "Wrote"];

export type WorkParticipant = {
  id: string;
  label: string;
  roles: WorkRole[];
  /** Timeline events they wrote. */
  events: number;
  /** Flights they ran. */
  flights: number;
  lastAt: number | null;
  /** The operator: shown, never a link (there is no profile to open). */
  operator: boolean;
};

export const OPERATOR_ID = "operator";

/**
 * Everyone on the work item: who owns it, whose move it is, who asked, who
 * ran it, and who wrote on its timeline, one row each, roles first.
 */
export function workParticipants(detail: WorkDetail, operatorName: string | null): WorkParticipant[] {
  const people = new Map<string, WorkParticipant>();
  const at = (id: string | null | undefined, name: string | null | undefined): WorkParticipant | null => {
    const key = id?.trim();
    if (!key || key === "system") return null;
    let person = people.get(key);
    if (!person) {
      const operator = key === OPERATOR_ID;
      person = { id: key, label: operator ? operatorName?.trim() || "You" : name?.trim() || key, roles: [], events: 0, flights: 0, lastAt: null, operator };
      people.set(key, person);
    } else if (!person.operator && person.label === key && name?.trim()) {
      person.label = name.trim();
    }
    return person;
  };
  const role = (person: WorkParticipant | null, r: WorkRole) => {
    if (person && !person.roles.includes(r)) person.roles.push(r);
  };
  const seen = (person: WorkParticipant | null, when: number | null | undefined) => {
    if (person && when && (person.lastAt === null || when > person.lastAt)) person.lastAt = when;
  };

  role(at(detail.ownerId, detail.ownerName), "Owner");
  if (detail.nextMoveOwnerId && detail.nextMoveOwnerId !== detail.ownerId) {
    role(at(detail.nextMoveOwnerId, detail.nextMoveOwnerName), "Next move");
  }
  const ask = detail.primaryInvocation;
  if (ask) {
    const asker = at(ask.requesterId, ask.requesterName);
    role(asker, "Asked");
    seen(asker, ask.createdAt);
  }
  for (const flight of [...(detail.allFlights ?? []), ...detail.activeFlights.filter((f) => !(detail.allFlights ?? []).some((a) => a.id === f.id))]) {
    const runner = at(flight.agentId, flight.agentName);
    if (!runner) continue;
    role(runner, "Ran");
    runner.flights += 1;
    seen(runner, flight.completedAt ?? flight.startedAt);
  }
  if (ask && !ask.flightId && ask.targetAgentId) role(at(ask.targetAgentId, ask.targetAgentName), "Ran");
  for (const item of detail.timeline) {
    const writer = at(item.actorId, item.actorName);
    if (!writer) continue;
    writer.events += 1;
    seen(writer, item.at);
    if (writer.roles.length === 0) role(writer, "Wrote");
  }
  const rank = (person: WorkParticipant) => Math.min(...person.roles.map((r) => ROLE_ORDER.indexOf(r)), ROLE_ORDER.length);
  return [...people.values()]
    .map((person) => ({ ...person, roles: [...person.roles].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)) }))
    .sort((a, b) => rank(a) - rank(b) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

// ── Case facts ──────────────────────────────────────────────────────────────

export type WorkFact = { label: string; value: string };

/** The inspector's case facts, in its order: phase, acceptance, priority, signal, routing. */
export function workCaseFacts(detail: WorkDetail): WorkFact[] {
  const owner = detail.ownerName ?? detail.ownerId ?? "Unassigned";
  const next = detail.nextMoveOwnerName ?? detail.nextMoveOwnerId ?? null;
  const facts: (WorkFact | null)[] = [
    { label: "Phase", value: detail.currentPhase },
    { label: "Acceptance", value: detail.acceptanceState.replace(/_/g, " ") },
    detail.priority ? { label: "Priority", value: detail.priority } : null,
    detail.attention === "interrupt" ? { label: "Signal", value: "Blocked" } : detail.attention === "badge" ? { label: "Signal", value: "Noteworthy" } : null,
    { label: "Owner", value: owner },
    next && (detail.ownerId ?? null) !== (detail.nextMoveOwnerId ?? null) && next !== owner ? { label: "Next move", value: next } : null,
    { label: "Children", value: String(detail.activeChildWorkCount) },
    { label: "Flights", value: String(detail.activeFlightCount) },
  ];
  return facts.filter((fact): fact is WorkFact => fact !== null);
}

/** Child work, open first, then most recently moved. */
export function workChildRows(detail: WorkDetail): WorkItem[] {
  return [...detail.childWork].sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || b.lastMeaningfulAt - a.lastMeaningfulAt);
}
