import type { TerminalSessionRecord, TerminalSurface } from "@openscout/protocol";
import {
  collapseHerdrSessionItems,
  parseTerminalSurfaceId,
  surfaceKey,
  surfaceKeyFromParts,
  terminalListItems,
  terminalSurfaceMatchesId,
} from "../../../lib/terminal-sessions.ts";
import type { Agent, Route, TerminalSurfaceDescriptor } from "../../../lib/types.ts";
import { terminalSessionActivityAt } from "../../terminal/session-table.ts";
import type { ModuleConfig } from "./contract.ts";

/*
 * One existing terminal as panel settings, and back. Terminal session and
 * Terminal details keep their target in the same keys, so both read the same
 * picker and the same route. Pure, so it tests without a DOM.
 *
 * Settings outlive the mount (CompositionHost keeps them across reloads and
 * visits), so they only ever hold a terminal at rest: observed, or a session's
 * summary. Driving one (a takeover, or herdr's "Open terminal") is held by the
 * mount that asked for it and ends with it: a saved takeover would run again on
 * every reload with nobody clicking, re-queueing an agent's resume command or
 * resizing its tmux window to the panel.
 */

export type TerminalRoute = Extract<Route, { view: "terminal" }>;
export type TerminalMode = "observe" | "takeover";
type TerminalBackend = NonNullable<TerminalRoute["terminalBackend"]>;

/**
 * Every key a target is kept in. The first four name the target; the last five
 * once carried a host terminal opened from inside the panel. A host terminal
 * is no longer saved (it rests as the session it attached to), but the keys
 * are still read and cleared, so settings saved before land somewhere safe.
 */
export const TARGET_KEYS = [
  "agentId",
  "mode",
  "terminalSessionId",
  "terminalSurfaceKey",
  "terminalBackend",
  "terminalSessionName",
  "terminalAgent",
  "terminalTabId",
  "zellijSocketDir",
] as const;

const isMode = (v: string | undefined): v is TerminalMode => v === "observe" || v === "takeover";
const isBackend = (v: string | undefined): v is TerminalBackend => v === "pty" || v === "tmux" || v === "zellij" || v === "herdr";
const read = (config: ModuleConfig, key: string) => config[key]?.trim() || undefined;

/** Settings that clear the target: the panel goes back to its picker. */
export function clearTarget(): Record<string, string> {
  return Object.fromEntries(TARGET_KEYS.map((k) => [k, ""]));
}

/**
 * Where a terminal rests between mounts, or null when it has nowhere to rest.
 * An agent is observed. A session keeps observe or its summary, and a
 * takeover of it rests as observe. A herdr session is its projection, which
 * has one way to be seen. A host terminal rests as the session it attached
 * to: herdr's projection, a named tmux or zellij session observed. A fresh pty
 * has no session to come back to.
 */
export function restingRoute(route: TerminalRoute): TerminalRoute | null {
  if (route.terminalBackend) {
    const key = route.terminalBackend === "pty" ? null : surfaceKeyFromParts(route.terminalBackend, route.terminalSessionName);
    if (!key) return null;
    return { view: "terminal", terminalSurfaceKey: key, ...(route.terminalBackend === "herdr" ? {} : { mode: "observe" as const }) };
  }
  if (route.agentId) return { view: "terminal", agentId: route.agentId, mode: "observe" };
  const { terminalSessionId, terminalSurfaceKey } = route;
  if (!terminalSessionId && !terminalSurfaceKey) return null;
  const herdr = parseTerminalSurfaceId(terminalSurfaceKey)?.backend === "herdr";
  const mode = herdr ? undefined : route.mode === "takeover" ? "observe" : route.mode;
  return {
    view: "terminal",
    ...(terminalSessionId ? { terminalSessionId } : {}),
    ...(terminalSurfaceKey ? { terminalSurfaceKey } : {}),
    ...(mode ? { mode } : {}),
  };
}

/**
 * The terminal route a panel draws at rest, or null when it has no target. An
 * agent is observed: nothing is taken over without a click. A session with no
 * mode is its summary, as on the full page. Settings saved with a takeover or
 * a host terminal read as where those rest.
 */
export function targetRoute(config: ModuleConfig): TerminalRoute | null {
  const backend = read(config, "terminalBackend");
  if (isBackend(backend)) {
    const sessionName = read(config, "terminalSessionName");
    return restingRoute({ view: "terminal", terminalBackend: backend, ...(sessionName ? { terminalSessionName: sessionName } : {}) });
  }
  const mode = isMode(config.mode) ? config.mode : undefined;
  const agentId = read(config, "agentId");
  const terminalSessionId = read(config, "terminalSessionId");
  const terminalSurfaceKey = read(config, "terminalSurfaceKey");
  return restingRoute({
    view: "terminal",
    ...(agentId ? { agentId } : {}),
    ...(terminalSessionId ? { terminalSessionId } : {}),
    ...(terminalSurfaceKey ? { terminalSurfaceKey } : {}),
    ...(mode ? { mode } : {}),
  });
}

/**
 * The settings for a terminal route at rest, writing every target key so a
 * new target never inherits a field of the last one. A route with nowhere to
 * rest (a bare terminal route: the full page's "back to the picker") clears
 * the target.
 */
export function targetConfig(route: TerminalRoute): Record<string, string> {
  const patch = clearTarget();
  const resting = restingRoute(route);
  if (!resting) return patch;
  patch.agentId = resting.agentId ?? "";
  patch.terminalSessionId = resting.terminalSessionId ?? "";
  patch.terminalSurfaceKey = resting.terminalSurfaceKey ?? "";
  patch.mode = resting.mode ?? "";
  return patch;
}

/** Which terminal a route names, not how it is watched. Two routes on one terminal share it. */
export function targetIdentity(route: TerminalRoute | null): string {
  if (!route) return "";
  return [route.agentId, route.terminalSessionId, route.terminalSurfaceKey, route.terminalBackend, route.terminalSessionName]
    .map((v) => v ?? "")
    .join("|");
}

/** A route that drives its terminal: a takeover of an agent or a session, or a host terminal. */
export function drives(route: TerminalRoute): boolean {
  const kind = targetKind(route);
  return kind === "host" || ((kind === "agent" || kind === "session") && route.mode === "takeover");
}

/** Where a route followed inside a panel goes: the panel (settings to save, and what it drives now), or the page. */
export type PanelStep =
  | { to: "panel"; config: Record<string, string>; driven: TerminalRoute | null }
  | { to: "page" };

/**
 * What a terminal route followed inside a panel does. Usually the panel moves
 * to it: the settings save where it rests, and a route that drives is held for
 * this mount only. A route with nowhere to rest goes to the page instead,
 * except the bare route, which is the picker. An agent route that names no
 * mode keeps the mode the panel shows on that agent now.
 */
export function panelStep(route: TerminalRoute, shown: TerminalRoute | null): PanelStep {
  const next = route.agentId && !route.mode && shown?.agentId === route.agentId && shown.mode
    ? { ...route, mode: shown.mode }
    : route;
  if (!restingRoute(next)) {
    const bare = !next.agentId && !next.terminalSessionId && !next.terminalSurfaceKey && !next.terminalBackend;
    return bare ? { to: "panel", config: clearTarget(), driven: null } : { to: "page" };
  }
  return { to: "panel", config: targetConfig(next), driven: drives(next) ? next : null };
}

export type TargetKind = "agent" | "session" | "herdr" | "host";

/**
 * What a target is, which decides what the panel head offers: an agent or a
 * session can be observed or taken over; a herdr session draws its projection
 * whatever the mode; a host terminal (opened from that projection) is driven.
 */
export function targetKind(route: TerminalRoute): TargetKind {
  if (route.terminalBackend) return "host";
  if (route.agentId) return "agent";
  return parseTerminalSurfaceId(route.terminalSurfaceKey)?.backend === "herdr" ? "herdr" : "session";
}

/* attach commands: the operator's own terminal */

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

/** An argv as one line to paste into a shell. */
export function commandLine(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}

/** The command that attaches a terminal of your own to a surface, per host. */
export function attachCommandFor(surface: TerminalSurfaceDescriptor): string {
  switch (surface.backend) {
    case "tmux":
      return commandLine(["tmux", "attach", "-t", surface.sessionName]);
    case "herdr":
      // herdr's default session is the bare client; a named one is attached by name
      return surface.sessionName === "default" ? "herdr" : commandLine(["herdr", "session", "attach", surface.sessionName]);
    case "zellij": {
      const socket = surface.socketDir ? `ZELLIJ_SOCKET_DIR=${shellQuote(surface.socketDir)} ` : "";
      return `${socket}${commandLine(["zellij", "attach", surface.sessionName])}`;
    }
  }
}

/** A registered surface carries its host's own attach argv; prefer it, else derive one. */
export function attachCommandForSurface(surface: Pick<TerminalSurface, "attachCommand">, descriptor: TerminalSurfaceDescriptor | null): string | null {
  // records written before hosts declared an argv carry none
  if (Array.isArray(surface.attachCommand) && surface.attachCommand.length > 0) return commandLine(surface.attachCommand);
  return descriptor ? attachCommandFor(descriptor) : null;
}

/* who: the agent behind a surface */

type SurfaceOf = (agent: Agent) => TerminalSurfaceDescriptor | null;

/** Whether an agent's own surface covers this one: the same surface, or one naming no pane covers every pane. */
function covers(own: TerminalSurfaceDescriptor, surface: Pick<TerminalSurface, "surfaceId" | "backend" | "sessionName" | "paneId">): boolean {
  return terminalSurfaceMatchesId(own, surfaceKey(surface)) || terminalSurfaceMatchesId(surface, surfaceKey(own));
}

/** The agent bound to a session's surface: by the surface itself, else by a shared session name or id. */
export function agentForSurface(
  agents: readonly Agent[],
  session: Pick<TerminalSessionRecord, "id" | "sourceSessionId">,
  surface: Pick<TerminalSurface, "surfaceId" | "backend" | "sessionName" | "paneId">,
  surfaceOf: SurfaceOf,
): Agent | null {
  const bySurface = agents.find((agent) => {
    const own = surfaceOf(agent);
    return own ? covers(own, surface) : false;
  });
  if (bySurface) return bySurface;
  const aliases = new Set([session.id, session.sourceSessionId, surface.sessionName].map((v) => v.trim()).filter(Boolean));
  return agents.find((agent) => [agent.harnessSessionId, agent.conversationId, agent.terminalSurface?.sessionName].some((v) => v && aliases.has(v))) ?? null;
}

/* the picker */

export type TargetRow = {
  id: string;
  /** An agent's terminal opens by the agent, which outlives its session name; anything else by the session. */
  kind: "session" | "agent";
  /** The agent's name, or the session's. */
  title: string;
  /** The session under an agent, or who a session belongs to; then where it works. */
  owner: string;
  /** The host and its state: "tmux · live". */
  detail: string;
  /** Last activity in epoch ms, or null when neither host nor broker reports one. */
  activityAt: number | null;
  route: TerminalRoute;
  /** Lowercase text the find field matches against. */
  searchable: string;
};

/**
 * The terminals a panel can open, most recently active first (the rail's
 * order): each running session surface this machine lists, a herdr session
 * once rather than once per pane. A
 * surface an agent claims opens as that agent's terminal; a terminal an agent
 * claims but the host no longer lists has exited, and is left out, as are
 * retired agents. Every row opens observing, except herdr, which opens its
 * projection (herdr has no read-only view).
 */
export function targetRows(sessions: readonly TerminalSessionRecord[], agents: readonly Agent[], surfaceOf: SurfaceOf): TargetRow[] {
  const live = agents.filter((a) => !a.retiredFromFleet);
  const byAgent = new Set<string>();
  const rows: TargetRow[] = collapseHerdrSessionItems(terminalListItems([...sessions]))
    .filter((item) => item.surface.state !== "exited")
    .map((item) => {
      const agent = agentForSurface(live, item.session, item.surface, surfaceOf);
      const where = item.project && item.project !== "unscoped" && item.project !== "backend-only" ? item.project : item.cwdLabel;
      const detail = `${item.surface.backend} · ${item.condition}`;
      // Activity the host or the broker reports. Not session.updatedAt: a
      // discovered session is stamped with the moment it was probed, which
      // would float every idle host session above live work on each poll.
      const activityAt = Math.max(terminalSessionActivityAt(item) ?? 0, agent?.updatedAt ?? 0) || null;
      const searchable = `${item.searchable} ${agent?.name ?? ""} ${agent?.handle ?? ""}`.toLowerCase();
      // Open by agent only where the agent's own surface covers this one: a
      // match by session id or name alone could attach somewhere else. Once
      // per agent; herdr opens its projection.
      const own = agent ? surfaceOf(agent) : null;
      if (agent && own && covers(own, item.surface) && item.surface.backend !== "herdr" && !byAgent.has(agent.id)) {
        byAgent.add(agent.id);
        return {
          id: `agent:${agent.id}`,
          kind: "agent",
          title: agent.name,
          owner: [item.title, agent.project ?? where].filter(Boolean).join(" · "),
          detail,
          activityAt,
          route: { view: "terminal", agentId: agent.id, mode: "observe" },
          searchable,
        };
      }
      const owner = agent?.name ?? (item.origin === "backend" ? "Standalone" : item.session.harness || "Scout");
      return {
        id: `session:${item.id}`,
        kind: "session",
        title: item.title,
        owner: [owner, where].filter(Boolean).join(" · "),
        detail,
        activityAt,
        route: {
          view: "terminal",
          terminalSessionId: item.session.id,
          terminalSurfaceKey: item.key,
          ...(item.surface.backend === "herdr" ? {} : { mode: "observe" as const }),
        },
        searchable,
      };
    });
  // Rows with no reported activity go last, as on the rail; the name breaks ties.
  return rows.sort((a, b) => (b.activityAt ?? -1) - (a.activityAt ?? -1) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** Rows whose text holds every word of the query. */
export function filterRows(rows: readonly TargetRow[], query: string): TargetRow[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((row) => words.every((w) => row.searchable.includes(w)));
}
