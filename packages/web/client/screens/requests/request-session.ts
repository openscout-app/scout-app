/**
 * "Go to session" for a permission request. In the companion, a session in
 * tmux opens in the companion's own terminal pop-up (showRequestPane); else
 * POST /api/operator-attention/permissions/reveal. Only the request id goes up; the server finds the session
 * that asked and walks its ladder (the live terminal window, else a terminal
 * attached to the host session) and says which rung landed. Read directly, not
 * through api(), because a reveal that didn't land answers 409 with its reason.
 */
import { useCallback, useState } from "react";
import { refreshSessionAuth } from "../../lib/api.ts";
import { noteCompanionPopOutOpening } from "../../lib/companion-host.ts";
import type { PaneTarget } from "../../components/pane-terminal-model.ts";
import { canShowQuickTerminal, showQuickTerminal } from "../companion/arrivals/quick-terminal.ts";
import { adoptSessionPopOut } from "../companion/arrivals/tap-in-data.ts";
import { FOCUS_LINE } from "../companion/arrivals/tap-in-model.ts";

type RevealTerminal = { app: string; bundleId: string; appPid: number };

type RevealBody =
  | {
    ok: true; rung: "window" | "attached"; reason: string; app?: string;
    /** An attached rung's pop-out: Done closes it on the host that opened it. */
    popOut?: string; machine?: string; sessionRef?: string; terminal?: RevealTerminal;
  }
  | { ok: false; code?: string; reason?: string };

export type SessionReveal = { ok: boolean; line: string };

/** The pop-out an attached reveal opened, when the answer names all of it; else null. */
export function revealPopOut(body: RevealBody | null): { token: string; to: { sessionRef: string; machine: string }; terminal?: RevealTerminal } | null {
  if (!body?.ok || body.rung !== "attached" || !body.popOut || !body.machine || !body.sessionRef) return null;
  return { token: body.popOut, to: { sessionRef: body.sessionRef, machine: body.machine }, ...(body.terminal ? { terminal: body.terminal } : {}) };
}

export function revealLine(status: number, body: RevealBody | null): SessionReveal {
  if (body?.ok) return { ok: true, line: body.rung === "attached" ? `Opened in ${body.app ?? "a terminal"}.` : "Brought its terminal forward." };
  const code = body && !body.ok ? body.code : undefined;
  return { ok: false, line: (code && FOCUS_LINE[code]) || (body && !body.ok && body.reason) || `HTTP ${status}` };
}

type PaneBody =
  | { ok: true; pane: PaneTarget; attached: boolean; request: { title: string; agent: string | null; at: number | null } }
  | { ok: false; code?: string; reason?: string };

async function postRequest<T>(path: string, requestId: string): Promise<{ status: number; body: T | null } | null> {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }) };
  try {
    let res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
    return { status: res.status, body: await res.json().catch(() => null) as T | null };
  } catch {
    return null;
  }
}

/**
 * The request's session in the companion's own terminal pop-up, when its
 * session is in tmux: POST …/permissions/pane names the session (nothing is
 * opened or focused there), and the pop-up joins it watching. False when the
 * session has no pane to show, so the caller can take the terminal app route.
 */
export async function showRequestPane(requestId: string): Promise<boolean> {
  const read = await postRequest<PaneBody>("/api/operator-attention/permissions/pane", requestId);
  const body = read?.body;
  if (!body?.ok || body.pane?.backend !== "tmux" || !body.pane.sessionName) return false;
  showQuickTerminal({ key: requestId, kind: "Permission request", pane: body.pane, who: body.request.agent, title: body.request.title, at: body.request.at });
  return true;
}

/** The line a reveal answers when the companion's pop-up showed the session: the pop-up itself says it. */
export const OPENED_HERE = "Opened its terminal here.";

export async function revealRequestSession(requestId: string): Promise<SessionReveal> {
  // In the companion, a session in tmux opens in its own pop-up, not a terminal app window.
  if (canShowQuickTerminal() && await showRequestPane(requestId)) return { ok: true, line: OPENED_HERE };
  const path = "/api/operator-attention/permissions/reveal";
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }) };
  // A reveal may open a terminal: the host notes the moment, so it moves only a window opened after it.
  noteCompanionPopOutOpening();
  let res: Response;
  try {
    res = await fetch(path, init);
    if (res.status === 401 && await refreshSessionAuth()) res = await fetch(path, init);
  } catch {
    return { ok: false, line: "Could not reach Scout." };
  }
  const body = await res.json().catch(() => null) as RevealBody | null;
  // An opened terminal is a pop-out: beside the board, with a Done that closes it.
  const opened = res.ok ? revealPopOut(body) : null;
  if (opened) adoptSessionPopOut(opened.token, opened.to, opened.terminal);
  return revealLine(res.status, body);
}

/**
 * "Open in terminal" state for one permission request: the jump in flight,
 * then its line ("Brought its terminal forward.", or why it didn't land).
 * Null `go` when the item is not a permission request: there is no session to reach.
 */
export function useSessionReveal(requestId: string | null | undefined): { go: (() => void) | null; going: boolean; result: SessionReveal | null } {
  const [going, setGoing] = useState(false);
  const [result, setResult] = useState<SessionReveal | null>(null);
  const go = useCallback(() => {
    if (!requestId) return;
    setGoing(true);
    setResult(null);
    void revealRequestSession(requestId).then(setResult).finally(() => setGoing(false));
  }, [requestId]);
  return { go: requestId ? go : null, going, result };
}
