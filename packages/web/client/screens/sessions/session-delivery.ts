import { canonicalSessionHarness, formatSessionRouteRef, parseSessionRouteRef } from "../../../shared/session-route-ref.ts";
import type { SessionRefObservePayload } from "./SessionRefScreen.tsx";
import type { Agent, SessionEntry } from "../../lib/types.ts";
import { isAgentInTurn } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import type { SessionSteerAvailability, SessionSteerReceipt } from "../../../shared/api/session-steer.ts";

export type SessionDeliveryTarget = {
  sessionId: string;
  sessionRef?: string | null;
  machineId?: string | null;
  blockedReason?: string | null;
  interruptLocal?: boolean;
  /** The session is on this host (the web server's): a reply route that resumes it can reach it. */
  local?: boolean;
  agentId?: string | null;
  projectPath?: string | null;
  harness?: string | null;
  model?: string | null;
};
export function sessionSteerPath(target: SessionDeliveryTarget): string {
  return `/api/session-ref/${encodeURIComponent(target.sessionRef ?? "")}/steer?machine=${encodeURIComponent(target.machineId ?? "")}`;
}
export function sessionDeliveryAvailability(target: SessionDeliveryTarget, live?: SessionSteerAvailability | null) {
  const reason = target.blockedReason || (!target.sessionRef || !target.sessionId ? "Waiting for a resolved session identity." : !target.machineId ? "The session's machine is not verified." : null);
  return reason ? { available: false, reason } : live ?? { available: false, reason: "Checking the live session…" };
}
export async function sendSessionDraft(target: SessionDeliveryTarget, body: string): Promise<SessionSteerReceipt> {
  if (target.blockedReason || !target.sessionRef || !target.machineId || !target.sessionId) throw new Error(sessionDeliveryAvailability(target).reason);
  // Exactly one input request. Never /sessions (start/resume), /send, or ask.
  return api<SessionSteerReceipt>(sessionSteerPath(target), { method: "POST", body: JSON.stringify({ text: body }) });
}

/**
 * A session on this host that nothing holds: the steer check found no live
 * process (not_live). A reply can still reach it through POST
 * /api/sessions/reply (the phone's and the TUI's route), which types it in
 * wherever the session turns out to be open, or else resumes the session
 * through the runtime as an exact-session ask, never a fork. Only then:
 * a live session's input never falls back to it.
 */
export function sessionResumable(target: SessionDeliveryTarget | null | undefined, live: SessionSteerAvailability | null | undefined): boolean {
  return Boolean(target && !target.blockedReason && target.local && target.sessionId && live && !live.available && live.code === "not_live");
}

/** What the reply route answered: typed in where the session is open, resumed with it, or refused with why. */
export type SessionReplyResult =
  | { ok: true; inPlace: boolean; location: string | null }
  | { ok: false; reason: string };

type SessionReplyAnswer =
  | { ok: true; delivery?: "in_place" | "resumed"; location?: string }
  | { ok: false; code: string; message: string };

/** The reply to a session nothing holds (sessionResumable): one POST, refusals in the operator's words. */
export async function replyToEndedSession(target: SessionDeliveryTarget, body: string, clientMessageId: string): Promise<SessionReplyResult> {
  const harness = canonicalSessionHarness(target.harness) ?? parseSessionRouteRef(target.sessionRef)?.harness ?? null;
  try {
    const answer = await api<SessionReplyAnswer>("/api/sessions/reply", {
      method: "POST",
      body: JSON.stringify({ sessionId: target.sessionId, harness, cwd: target.projectPath ?? null, body, clientMessageId, source: "scout-web" }),
    });
    if (answer.ok) return { ok: true, inPlace: answer.delivery === "in_place", location: answer.location ?? null };
    return { ok: false, reason: answer.message };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error && cause.message ? cause.message : "Not sent." };
  }
}

/** One read at a time; stop makes late responses from a previous slot inert. */
export function sessionSteerPoll<T>(read: () => Promise<T>, receive: (value: T) => void, failed: () => void) {
  let stopped = false, reading = false;
  return {
    async refresh() {
      if (stopped || reading) return;
      reading = true;
      try { const value = await read(); if (!stopped) receive(value); }
      catch { if (!stopped) failed(); }
      finally { reading = false; }
    },
    stop() { stopped = true; },
  };
}
/** The existing interrupt endpoint addresses the active agent, not history.
 * Never offer it on a pinned older session or an unbound observed process. */
export function sessionInterruptAgent(target: SessionDeliveryTarget, agent: Agent | null | undefined): Agent | null {
  return !target.blockedReason && target.interruptLocal !== false && agent && target.agentId === agent.id && agent.harnessSessionId === target.sessionId
    && isAgentInTurn(agent.state) && !agent.staleLocalRegistration && !agent.retiredFromFleet
    && agent.terminalSurface?.backend === "tmux" ? agent : null;
}

/** Route wrappers and conversation ids are read identities, never execution ids.
 * Until Observe resolves, including a delayed/failed second lookup, fail closed.
 * Host session-ref reads are not proxy-supported. Don't steer a local lookalike
 * for a machine-scoped pin; locality must come from Observe or its matched
 * owner. The live steer capability remains the authority for execution. */
export function sessionTargetFromObserve(observe: SessionRefObservePayload | null | undefined, conversation: SessionEntry | null, machineId?: string, localNodeId?: string | null, owner?: Agent): SessionDeliveryTarget {
  const meta = observe?.data.metadata?.session;
  const sessionId = parseSessionRouteRef(meta?.externalSessionId || observe?.sessionId)?.refId ?? "";
  const agentId = observe?.agentId ?? conversation?.agentId ?? null;
  // A local agent's registration can lag the Claude thread that Observe
  // actually resolved. Its home node still proves locality, not ownership of
  // that execution id: keep Observe's id and let /steer verify the process.
  // Do not relax execution matching for a remote owner or guess node aliases.
  const ownerNode = observe?.kind === "agent" && owner?.id === agentId
    && (owner.harnessSessionId === sessionId || (localNodeId && owner.homeNodeId === localNodeId)) ? owner.homeNodeId : null;
  const observedNode = meta?.nodeId ?? ownerNode ?? (observe?.kind === "history" || observe?.kind === "tail" ? localNodeId : null);
  const blockedReason = !observe || !sessionId ? "Waiting for a resolved session identity; no delivery will be attempted."
    : machineId && observedNode !== machineId ? "The selected machine is not verified by this Observe source. Open the session on that machine; this slot is read-only."
    : (machineId || observedNode) && (machineId || observedNode) !== localNodeId && !agentId ? "Machine-scoped history has no exact registered owner for this web delivery path."
    : null;
  const node = machineId || observedNode;
  return { sessionId, sessionRef: formatSessionRouteRef(meta?.adapterType ?? conversation?.harness, sessionId), machineId: node || localNodeId,
    agentId, blockedReason, interruptLocal: !machineId || machineId === localNodeId, local: !node || node === localNodeId, projectPath: meta?.cwd ?? conversation?.workspaceRoot,
    harness: meta?.adapterType ?? conversation?.harness, model: meta?.model ?? conversation?.model };
}
