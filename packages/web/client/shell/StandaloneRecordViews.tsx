import { useEffect, useRef, useState, type ReactNode } from "react";
import { HarnessMark, harnessLabel } from "../components/HarnessMark.tsx";
import { api } from "../lib/api.ts";
import { navigateBrowser, useBrowserLocation } from "../lib/browser-location.ts";
import type { ObserveData } from "../lib/types.ts";
import { ScoutActionButton } from "../primitives/ScoutActionButton.tsx";
import { ObservedThread } from "../screens/sessions/ObservedThread.tsx";
import { observedSessionWorking } from "../screens/sessions/session-turns.ts";
import type { ScoutRail, ScoutSkeletonVariant } from "./boot-html.ts";
import { ScoutPageSkeleton } from "./ScoutPageSkeleton.tsx";

export interface StandaloneSessionLookup {
  refId: string;
  source?: string | null;
  project?: string | null;
  sessionId?: string | null;
  updatedAt?: number;
  fidelity?: "timestamped" | "synthetic";
  data: ObserveData;
}

export function normalizeStandaloneSessionResponse(raw: unknown, id: string): StandaloneSessionLookup | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("observe" in obj && obj.observe && typeof obj.observe === "object") {
    const obs = obj.observe as Record<string, unknown>;
    if (obs.data && typeof obs.data === "object") {
      const data = obs.data as ObserveData;
      return {
        refId: typeof obs.refId === "string" ? obs.refId : id,
        source: data.metadata?.session?.adapterType ?? (typeof obs.source === "string" ? obs.source : null),
        project: typeof obs.project === "string" ? obs.project : (data.metadata?.session?.cwd ?? null),
        sessionId: typeof obs.sessionId === "string" ? obs.sessionId : id,
        updatedAt: typeof obs.updatedAt === "number" ? obs.updatedAt : undefined,
        fidelity: obs.fidelity === "timestamped" ? "timestamped" : "synthetic",
        data,
      };
    }
  }
  if ("data" in obj && obj.data && typeof obj.data === "object") {
    const data = obj.data as ObserveData;
    return {
      refId: typeof obj.refId === "string" ? obj.refId : id,
      source: typeof obj.source === "string" ? obj.source : data.metadata?.session?.adapterType ?? null,
      project: typeof obj.project === "string" ? obj.project : data.metadata?.session?.cwd ?? null,
      sessionId: typeof obj.sessionId === "string" ? obj.sessionId : id,
      updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : undefined,
      fidelity: obj.fidelity === "timestamped" ? "timestamped" : "synthetic",
      data,
    };
  }
  return null;
}

export function StandaloneSessionDetail({
  sessionId,
  backLabel = "Back",
  rail = "wide",
  skeletonVariant = "sessions",
  onBack,
}: {
  sessionId: string;
  backLabel?: string;
  rail?: ScoutRail;
  skeletonVariant?: ScoutSkeletonVariant;
  onBack: () => void;
}) {
  const [lookup, setLookup] = useState<StandaloneSessionLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api<unknown>(`/api/session-ref/${encodeURIComponent(sessionId)}`, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        const parsed = normalizeStandaloneSessionResponse(res, sessionId);
        if (!parsed) {
          setError("Session transcript could not be parsed.");
        } else {
          setLookup(parsed);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not read session transcript.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId]);

  const sessionMeta = lookup?.data.metadata?.session as Record<string, unknown> | undefined;
  const harness = lookup?.source ?? (typeof sessionMeta?.adapterType === "string" ? sessionMeta.adapterType : "unknown");
  const hLabel = harnessLabel(harness);
  const model = typeof sessionMeta?.model === "string" ? sessionMeta.model : null;
  const branch = typeof sessionMeta?.branch === "string" ? sessionMeta.branch : null;
  const rawProject = lookup?.project ? lookup.project.split(/[\\/]/).filter(Boolean).at(-1) ?? null : null;
  const projectLabel =
    rawProject && rawProject.toLowerCase() !== harness.toLowerCase() && rawProject.toLowerCase() !== hLabel.toLowerCase()
      ? rawProject
      : null;
  const working = lookup ? observedSessionWorking({ agentTurn: null, data: lookup.data }) : false;

  return (
    <div className="s-standalone-record s-surface-rail" data-rail={rail}>
      <div className="s-standalone-record-head">
        <ScoutActionButton quiet onClick={onBack}>
          ← {backLabel}
        </ScoutActionButton>
        <div className="s-standalone-meta">
          {lookup ? (
            <>
              <HarnessMark harness={harness} size={15} title={null} />
              <span>{hLabel}</span>
              {projectLabel ? <span>· {projectLabel}</span> : null}
              {branch ? <span>· {branch}</span> : null}
              {model ? <span>· {model}</span> : null}
            </>
          ) : (
            <span>{sessionId.slice(0, 12)}</span>
          )}
        </div>
      </div>

      {loading ? (
        <ScoutPageSkeleton variant={skeletonVariant} inline label="Loading session turns" />
      ) : error ? (
        <p role="alert">{error}</p>
      ) : lookup ? (
        <ObservedThread
          data={lookup.data}
          working={working}
          timestamped={lookup.fidelity === "timestamped"}
        />
      ) : null}
    </div>
  );
}

interface DiscussionMessage {
  id: string;
  actorId: string;
  actorName?: string | null;
  body: string;
  createdAt: number;
}

export function StandaloneConversationExchange({
  conversationId,
  workId,
  backLabel = "Back",
  rail = "reading",
  onBack,
}: {
  conversationId: string;
  workId: string | null;
  backLabel?: string;
  rail?: ScoutRail;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<DiscussionMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ conversationId });
    if (workId) params.set("workId", workId);
    api<DiscussionMessage[]>(`/api/messages?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setMessages(res);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Could not read conversation.");
        }
      });
    return () => controller.abort();
  }, [conversationId, workId]);

  return (
    <div className="s-standalone-record s-surface-rail" data-rail={rail}>
      <div className="s-standalone-record-head">
        <ScoutActionButton quiet onClick={onBack}>
          ← {backLabel}
        </ScoutActionButton>
        <span className="s-standalone-meta">
          {workId ? "Recorded exchange" : "Conversation messages"}
        </span>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !messages ? (
        <ScoutPageSkeleton variant="feed" inline label="Loading messages" />
      ) : messages.length === 0 ? (
        <p>No messages recorded in this conversation.</p>
      ) : (
        <div className="fd-exchangeList">
          {messages.map((msg) => (
            <article key={msg.id} className="fd-exchangeMessage">
              <header className="fd-exchangeHead">
                <strong>{msg.actorName || msg.actorId}</strong>
                <time dateTime={new Date(msg.createdAt).toISOString()}>
                  {new Date(msg.createdAt).toLocaleString()}
                </time>
              </header>
              <div className="fd-exchangeBody">{msg.body}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function StandaloneRecordRouter({
  product,
  rail,
  navigate = navigateBrowser,
  children,
}: {
  product: string;
  rail: ScoutRail;
  navigate?: (href: string) => void;
  children: ReactNode;
}) {
  const { pathname, searchStr } = useBrowserLocation();
  const lastHomeHrefRef = useRef<string>("/");
  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(pathname);
  const chatMatch = /^\/c\/([^/]+)$/.exec(pathname);

  if (!sessionMatch && !chatMatch) {
    lastHomeHrefRef.current = `${pathname}${searchStr}`;
  }

  const goBack = () => {
    navigate(lastHomeHrefRef.current || "/");
  };

  if (sessionMatch?.[1]) {
    return (
      <StandaloneSessionDetail
        sessionId={decodeURIComponent(sessionMatch[1])}
        backLabel={product}
        rail={rail}
        onBack={goBack}
      />
    );
  }

  if (chatMatch?.[1]) {
    const params = new URLSearchParams(searchStr);
    return (
      <StandaloneConversationExchange
        conversationId={decodeURIComponent(chatMatch[1])}
        workId={params.get("workId")}
        backLabel={product}
        rail={rail}
        onBack={goBack}
      />
    );
  }

  return <>{children}</>;
}
