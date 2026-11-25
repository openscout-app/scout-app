import { useEffect, useState } from "react";
import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { navigateBrowser, useBrowserLocation } from "../../lib/browser-location.ts";
import type { ObserveData, Route } from "../../lib/types.ts";
import { ScoutPageSkeleton } from "../../shell/ScoutPageSkeleton.tsx";
import { ObservedThread } from "./ObservedThread.tsx";
import { RawSessionsTable } from "./RawSessionsTable.tsx";
import { observedSessionWorking } from "./session-turns.ts";

export interface StandaloneSessionLookup {
  refId: string;
  source?: string | null;
  project?: string | null;
  sessionId?: string | null;
  updatedAt?: number;
  fidelity?: "timestamped" | "synthetic";
  data: ObserveData;
}

function normalizeSessionResponse(raw: unknown, id: string): StandaloneSessionLookup | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("observe" in obj && obj.observe && typeof obj.observe === "object") {
    const obs = obj.observe as Record<string, unknown>;
    if (obs.data && typeof obs.data === "object") {
      const data = obs.data as ObserveData;
      return {
        refId: typeof obs.refId === "string" ? obs.refId : id,
        source: data.metadata?.session?.adapterType ?? (typeof obs.source === "string" ? obs.source : null),
        project: data.metadata?.session?.cwd ?? null,
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

function StandaloneSessionDetail({
  sessionId,
  onBack,
}: {
  sessionId: string;
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
        const parsed = normalizeSessionResponse(res, sessionId);
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

  const harness = lookup?.source ?? lookup?.data.metadata?.session?.adapterType ?? "unknown";
  const model = lookup?.data.metadata?.session?.model ?? null;
  const working = lookup ? observedSessionWorking({ agentTurn: null, data: lookup.data }) : false;

  return (
    <div className="s-standalone-record s-surface-rail" data-rail="wide">
      <div className="s-standalone-record-head">
        <button type="button" className="s-standalone-back" onClick={onBack}>
          ← Sessions
        </button>
        <div className="s-standalone-meta">
          {lookup ? (
            <>
              <HarnessMark harness={harness} size={14} title={null} />
              <span>{harnessLabel(harness)}</span>
              {lookup.project ? <span>· {lookup.project.split(/[\\/]/).filter(Boolean).at(-1)}</span> : null}
              {model ? <span>· {model}</span> : null}
            </>
          ) : (
            <span>{sessionId.slice(0, 12)}</span>
          )}
        </div>
      </div>

      {loading ? (
        <ScoutPageSkeleton variant="sessions" inline label="Loading session turns" />
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

export function SessionsStandaloneSurface({
  navigate = navigateBrowser,
}: {
  navigate?: (href: string) => void;
}) {
  const { pathname } = useBrowserLocation();
  const match = /^\/sessions\/([^/]+)$/.exec(pathname);

  const handleRouteNavigate = (route: Route) => {
    if (route.view === "sessions" && route.sessionId) {
      navigate(`/sessions/${encodeURIComponent(route.sessionId)}`);
      return;
    }
    navigate("/");
  };

  if (match?.[1]) {
    return (
      <StandaloneSessionDetail
        sessionId={decodeURIComponent(match[1])}
        onBack={() => navigate("/")}
      />
    );
  }

  return <RawSessionsTable navigate={handleRouteNavigate} />;
}
