/**
 * Session Embed (tail "load session") — the standalone, chrome-free route.
 *
 * Hosted by the macOS app in a WKWebView (a bottom sheet) when you open a tail
 * row's full session. Reads the tail event's `sessionId` from the query string
 * (`/embed/session?ref=<sessionId>&theme=<dark|light>`) and resolves it through
 * the same `/api/session-ref/:id` endpoint the web Sessions view uses.
 *
 * Renders ONLY the resolved session full-bleed — no app shell, no nav, no
 * toolbar:
 *   - `observe`      → SessionObserve (history/live trace; rail hidden), under
 *                      a bar that names where the session is and goes there
 *                      (SessionEmbedPlace)
 *   - `conversation` → ConversationScreen (embedded, no back nav)
 *
 * Wrapped in `scoutApp.Provider` upstream in main.tsx (supplies the
 * `[data-scout-theme]` token scope, theme honored via `?theme=`). Mirrors
 * ObserveEmbedScreen + RepoDiffEmbedScreen.
 */

import { useEffect, useState, type ReactNode } from "react";

import { describeObserveEvidence } from "../../lib/observe-fidelity.ts";
import { harnessFromAdapterType } from "../../lib/session-start.ts";
import { routePath } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import { SCOUT_WEB_ORIGIN } from "../companion/arrivals/tap-in-model.ts";
import { ConversationScreen } from "../chat/ConversationScreen.tsx";
import { AgentLanePlate } from "../ops/AgentLaneCard.tsx";
import { observedSessionToCardModel } from "../ops/agent-lane-card-model.ts";
import {
  ObservePresentationToggle,
  SessionObserve,
  type ObserveSessionPresentation,
} from "./SessionObserve.tsx";
import { SessionEmbedPlace } from "./SessionEmbedPlace.tsx";
import { sessionTargetFromObserve } from "./session-delivery.ts";
import type { SessionRefLookup } from "./SessionRefScreen.tsx";
import { useSessionRefLookup } from "./useSessionRefLookup.ts";

/**
 * The embed has no app around it to move within, so a link out of the thread
 * (Open session, an agent, a file) opens that page of Scout on the web, the
 * same way the place bar opens the session page.
 */
function openRouteOutside(route: Route): void {
  window.open(`${SCOUT_WEB_ORIGIN}${routePath(route)}`, "_blank", "noopener");
}

/**
 * What the embed shows for its reference. A host reads it (with
 * `data-session-ref`) to know the page has caught up with the reference it
 * asked for.
 */
export type SessionEmbedState = "loading" | "observe" | "conversation" | "missing" | "error" | "none";

function EmbedShell({
  sessionRef,
  state,
  children,
}: {
  sessionRef?: string;
  state?: SessionEmbedState;
  children: ReactNode;
}) {
  return (
    <div className="s-observe-embed-page" data-session-ref={sessionRef || undefined} data-session-state={state}>
      {children}
    </div>
  );
}

function EmbedNotice({
  sessionRef,
  state,
  title,
  detail,
}: {
  sessionRef?: string;
  state: SessionEmbedState;
  title: string;
  detail?: string;
}) {
  return (
    <EmbedShell sessionRef={sessionRef} state={state}>
      <div className="s-observe-embed-empty">
        <div className="s-observe-embed-empty-title">{title}</div>
        {detail && <div className="s-observe-embed-empty-detail">{detail}</div>}
      </div>
    </EmbedShell>
  );
}

type SessionRefObserveLookup = Extract<SessionRefLookup, { kind: "observe" }>;

/** Pure resolved-observe branch so the embed's fidelity propagation is testable. */
export function SessionEmbedObserveContent({
  lookup,
  sessionRef,
  composer = true,
}: {
  lookup: SessionRefObserveLookup;
  /** The reference the host asked for, echoed for its readiness check. */
  sessionRef?: string;
  /** False when the host draws its own composer for this session. */
  composer?: boolean;
}) {
  const evidence = describeObserveEvidence({
    source: lookup.observe.source,
    fidelity: lookup.observe.fidelity,
    live: lookup.observe.data.live,
    eventCount: lookup.observe.data.events.length,
  });
  // Where the session itself is: its terminal, the ChatGPT app, or its web
  // page. The steer read re-proves the machine and process; this only names them.
  const place = sessionTargetFromObserve(lookup.observe, lookup.session);
  const sessionId = lookup.observe.sessionId ?? lookup.observe.refId;
  const [presentation, setPresentation] = useState<ObserveSessionPresentation>("conversation");
  const nowMs = useMinuteClock();

  // The same masthead a lane wears on Lanes: harness, name, branch, session,
  // runtime, the latest request, and the state line. Broker receipts carry no
  // trace, so they never read as working.
  const card = observedSessionToCardModel(lookup.observe.data, {
    harness: harnessFromAdapterType(lookup.observe.data.metadata?.session?.adapterType) ?? null,
    sessionId,
    title: lookup.session?.title,
    nowMs,
  });
  const model = evidence.receiptOnly ? { ...card, working: false } : card;

  const plate = (
    <AgentLanePlate
      model={model}
      label="Session"
      stateTitle={`${evidence.label}. ${evidence.detail}`}
      statusEnd={evidence.receiptOnly ? (
        <span className="s-lane-card-faint s-observe-embed-plate-note">{evidence.eventCountLabel}</span>
      ) : (
        <ObservePresentationToggle presentation={presentation} onChange={setPresentation} />
      )}
    />
  );

  return (
    <EmbedShell sessionRef={sessionRef} state="observe">
      <SessionObserve
        data={lookup.observe.data}
        agentId={lookup.observe.agentId ?? lookup.session?.agentId ?? undefined}
        sessionId={sessionId}
        showRail={false}
        composer={composer}
        observeSource={lookup.observe.source}
        observeFidelity={lookup.observe.fidelity}
        defaultPresentation="conversation"
        presentation={presentation}
        onPresentationChange={setPresentation}
        header={(
          <div className="s-observe-embed-head">
            {plate}
            <SessionEmbedPlace sessionRef={place.sessionRef?.startsWith("session:") ? place.sessionRef : null} machineId={place.machineId ?? null} />
          </div>
        )}
      />
    </EmbedShell>
  );
}

/** Wall clock for the plate's "2m ago" and working window; ticks each 30s. */
function useMinuteClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
}

/**
 * One session by reference: its trace in the conversation grammar, or the
 * Scout conversation it resolves to. `renderConversation` lets a host draw that
 * conversation its own way; `composer={false}` leaves input to the host.
 */
export function SessionRefEmbed({
  sessionRef,
  composer = true,
  renderConversation,
}: {
  sessionRef: string;
  composer?: boolean;
  renderConversation?: (conversationId: string) => ReactNode;
}) {
  const { lookup, loading, error } = useSessionRefLookup(sessionRef);

  if (!sessionRef) {
    return (
      <EmbedNotice
        state="none"
        title="No session reference"
        detail="This embed needs a ?ref=<sessionId> query parameter."
      />
    );
  }

  if (error && !lookup) {
    return <EmbedNotice sessionRef={sessionRef} state="error" title="Session unavailable" detail={error} />;
  }

  if (loading && !lookup) {
    return <EmbedNotice sessionRef={sessionRef} state="loading" title="Resolving session" detail={sessionRef} />;
  }

  if (!lookup) {
    return (
      <EmbedNotice
        sessionRef={sessionRef}
        state="missing"
        title="Session not found"
        detail="This session may have ended or its archive is not on this machine."
      />
    );
  }

  if (lookup.kind === "conversation") {
    return (
      <EmbedShell sessionRef={sessionRef} state="conversation">
        {renderConversation ? renderConversation(lookup.conversationId) : (
          <ConversationScreen
            conversationId={lookup.conversationId}
            navigate={openRouteOutside}
            embedded
            showBackNav={false}
          />
        )}
      </EmbedShell>
    );
  }

  return <SessionEmbedObserveContent lookup={lookup} sessionRef={sessionRef} composer={composer} />;
}

export function SessionEmbedScreen() {
  const ref =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("ref")?.trim() ?? "";
  return <SessionRefEmbed sessionRef={ref} />;
}

export default SessionEmbedScreen;
