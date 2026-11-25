import { Send, Terminal } from "lucide-react";
import type { Route, SessionEntry } from "../lib/types.ts";
import { getDestination } from "../scout/nav-destinations.ts";
import { areaForRoute, getPrimaryArea, type SidebarLayout } from "../scout/primary-areas.ts";
import { OpsGlyph, SessionsGlyph } from "../components/ScoutGlyph.tsx";
import { isOperatorDm } from "../lib/conversations.ts";
import type { LastViewedMap } from "../lib/sessionRead.ts";
import { isSyntheticAgentId, sessionRefFromSyntheticAgentId } from "../lib/synthetic-agent-routing.ts";
import { normalizeTimestampMs } from "../lib/time.ts";

/** Compile-time npm surface selection; the ordinary web build remains full. */
export const BASIC_WEB = import.meta.env.VITE_SCOUT_WEB_PROFILE === "basic";

/**
 * The basic build's sidebar: the full app's sidebar with basic's own rows. The
 * build has no sub-pages, so Sessions, Terminals and Sent stay rows of their
 * own, and Ops opens on Lanes with Tail one link away. Shared rows are the
 * full app's areas; adding a surface to the build is adding its row here.
 */
export const BASIC_SIDEBAR: SidebarLayout = {
  rows: [
    getPrimaryArea("search"),
    getPrimaryArea("home"),
    { id: "sessions", label: getDestination("sessions").label, icon: SessionsGlyph, defaultRoute: { view: "sessions" }, section: "navigate", group: "work" },
    { ...getPrimaryArea("chat"), defaultRoute: { view: "messages" } },
    { id: "terminals", label: getDestination("terminals").label, icon: Terminal, defaultRoute: { view: "terminal" }, section: "navigate", group: "work" },
    { id: "ops", label: getDestination("ops").label, icon: OpsGlyph, defaultRoute: { view: "ops", mode: "lanes" }, section: "system", group: "infrastructure" },
    getPrimaryArea("settings"),
  ],
  rowForRoute: basicSidebarRow,
};

/** The basic sidebar row a (basic-normalized) route lights. */
export function basicSidebarRow(route: Route): string {
  if (route.view === "terminal") return "terminals";
  // Lanes and Tail are in basic's Ops.
  if (route.view === "ops") return "ops";
  if (route.view === "follow" && route.preferredView === "tail") return "ops";
  if (route.view === "broker") return "dispatch";
  const area = areaForRoute(route);
  if (area === "agents") return "sessions";
  return area === "work" ? "dispatch" : area;
}

/** The destinations the basic web client carries. */
export type BasicArea = "home" | "dms" | "sessions" | "terminal" | "dispatch" | "search" | "ops" | "settings";

/**
 * Folds any full-app route onto the basic surface. Home, DMs, Terminals,
 * Dispatch, Search, Ops (Lanes and Tail) and Settings keep their own state;
 * agent routes become that agent's DM, session links open the shared Sessions slots,
 * work and follow links retain their pages, and everything else lands on Home.
 */
export function basicRoute(route: Route): Route {
  switch (route.view) {
    case "inbox":
      return { view: "inbox" };
    case "work":
      return route;
    case "broker":
      return {
        view: "broker",
        ...(route.filter && route.filter !== "all" ? { filter: route.filter } : {}),
        ...(route.attemptId ? { attemptId: route.attemptId } : {}),
      };
    case "messages":
      // One URL per thread: a known conversation always opens at /c/:id.
      if (route.conversationId) return { view: "conversation", conversationId: route.conversationId };
      return basicAgentRoute(route.agentId);
    case "conversation":
      return {
        view: "conversation",
        conversationId: route.conversationId,
        ...(route.composeDraft ? { composeDraft: route.composeDraft } : {}),
      };
    case "agent-info":
      return { view: "conversation", conversationId: route.conversationId };
    case "agents-v2":
      return basicAgentRoute(route.agentId);
    case "terminal":
      return route;
    case "search":
      return route;
    case "sessions":
      return route;
    case "follow":
      return route;
    case "settings":
      return basicSettingsRoute(route);
    case "ops":
      // Ops is Lanes, with Tail beside it; the rest of Ops is the full app's.
      if (route.mode === "tail") return { view: "ops", mode: "tail", ...pickFollow(route) };
      return { view: "ops", mode: "lanes" };
    default:
      return { view: "inbox" };
  }
}

/**
 * Settings is the same page set the Mac app embeds from basic (`/embed/settings`),
 * so Operator, Devices and Scout Pro are reachable from the browser too. Agent
 * configuration and the legacy pairing page are full-app screens.
 */
function basicSettingsRoute(route: Extract<Route, { view: "settings" }>): Route {
  if (route.section === "agents") return route.agentId ? basicAgentRoute(route.agentId) : { view: "settings" };
  if (route.section === "pairing") return { view: "settings", section: "devices" };
  return route.section ? { view: "settings", section: route.section } : { view: "settings" };
}

/** An agent opens as its DM; a synthetic (observed-session) agent has no DM, so it opens in Tail. */
function basicAgentRoute(agentId: string | undefined): Route {
  if (!agentId) return { view: "messages" };
  if (isSyntheticAgentId(agentId)) {
    const sessionRef = sessionRefFromSyntheticAgentId(agentId);
    return sessionRef ? { view: "ops", mode: "tail", tailQuery: sessionRef } : { view: "ops", mode: "tail" };
  }
  return { view: "messages", agentId };
}

function pickFollow(route: Extract<Route, { view: "ops" }>): Partial<Extract<Route, { view: "ops" }>> {
  return {
    ...(route.tailQuery ? { tailQuery: route.tailQuery } : {}),
    ...(route.flightId ? { flightId: route.flightId } : {}),
    ...(route.invocationId ? { invocationId: route.invocationId } : {}),
    ...(route.conversationId ? { conversationId: route.conversationId } : {}),
    ...(route.workId ? { workId: route.workId } : {}),
    ...(route.sessionId ? { sessionId: route.sessionId } : {}),
    ...(route.targetAgentId ? { targetAgentId: route.targetAgentId } : {}),
  };
}

/** Which basic destination a (basic-normalized) route belongs to. */
export function basicArea(route: Route): BasicArea {
  switch (route.view) {
    case "messages":
    case "conversation":
      return "dms";
    case "terminal":
      return "terminal";
    case "sessions":
      return "sessions";
    case "broker":
      return "dispatch";
    case "search":
      return "search";
    case "ops":
      return "ops";
    case "settings":
      return "settings";
    default:
      return "home";
  }
}

/** Operator ↔ one-agent conversations only: no channels, no group DMs, no observed traffic. */
export function isBasicDm(session: SessionEntry): boolean {
  return session.kind === "direct" && isOperatorDm(session);
}

export function basicDmConversations(sessions: readonly SessionEntry[]): SessionEntry[] {
  return sessions.filter(isBasicDm);
}

/** The listed DM a conversation id resolves to, including coalesced ids. */
export function findBasicDm(
  sessions: readonly SessionEntry[],
  conversationId: string,
): SessionEntry | null {
  return sessions.find((session) =>
    isBasicDm(session)
    && (session.id === conversationId || Boolean(session.equivalentConversationIds?.includes(conversationId))),
  ) ?? null;
}

/** The newest listed DM with one agent, if the operator already has one. */
export function findBasicDmForAgent(
  sessions: readonly SessionEntry[],
  agentId: string,
): SessionEntry | null {
  let best: SessionEntry | null = null;
  for (const session of sessions) {
    if (!isBasicDm(session) || session.agentId !== agentId) continue;
    if (!best || (session.lastMessageAt ?? 0) > (best.lastMessageAt ?? 0)) best = session;
  }
  return best;
}

/** Unread: a message newer than the last open, or than `baseline` for a DM never opened here. */
export function isBasicDmUnread(
  session: Pick<SessionEntry, "id" | "lastMessageAt">,
  lastViewed: LastViewedMap,
  baseline: number,
): boolean {
  const lastMessageAt = normalizeTimestampMs(session.lastMessageAt);
  if (!lastMessageAt) return false;
  return lastMessageAt > (lastViewed[session.id] ?? baseline);
}

/** Native-host embeds the basic client carries; every other embed needs the full app. */
export const BASIC_EMBED_PATHS = ["/embed/settings", "/embed/home", "/embed/requests", "/embed/thread", "/embed/session"] as const;
export type BasicEmbedPath = (typeof BASIC_EMBED_PATHS)[number];

/** Whether a path is a native-host embed (any of them, carried or not). */
export function isEmbedPath(pathname: string): boolean {
  return pathname.startsWith("/embed/") || pathname === "/ops/lanes/embed";
}

export function isBasicEmbedPath(pathname: string): pathname is BasicEmbedPath {
  return (BASIC_EMBED_PATHS as readonly string[]).includes(pathname);
}
