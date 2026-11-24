import { createContext, useContext, useEffect, useState } from "react";

/** What the host says about the runtime it reads. A host that says nothing leaves both null. */
export type RuntimeInfo = {
  /** The runtime's loopback origin, for display only. The client never calls it directly. */
  url: string | null;
  /** `temporary`: the host started an empty runtime for this run. `existing`: one the operator already runs. */
  kind: "temporary" | "existing" | null;
};

export type RuntimeStatus = "connecting" | "connected" | "unreachable";

export const unknownRuntime: RuntimeInfo = { url: null, kind: null };

/** Reads `<meta name="scout-runtime-url">` and `<meta name="scout-runtime-kind">` from the app document. */
export function readRuntimeInfo(doc: Pick<Document, "querySelector"> | undefined = globalThis.document): RuntimeInfo {
  const meta = (name: string) => doc?.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content.trim() || null;
  const url = meta("scout-runtime-url");
  const kind = meta("scout-runtime-kind");
  return {
    url: url && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/.test(url) ? url : null,
    kind: kind === "temporary" || kind === "existing" ? kind : null,
  };
}

/** A Feed read that answered, changed or not, means the runtime is reachable through the host. */
export function statusFromResponse(status: number): RuntimeStatus {
  return (status >= 200 && status < 300) || status === 304 ? "connected" : "unreachable";
}

const POLL_MS = 15_000;

/**
 * Polls the host's Feed read with the last version it saw, so an unchanged
 * runtime answers 304 with no body. Pauses while the page is hidden.
 */
export function useRuntimeStatus(enabled: boolean): RuntimeStatus {
  const [status, setStatus] = useState<RuntimeStatus>("connecting");
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let version: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const controller = new AbortController();
    const probe = async () => {
      if (stopped) return;
      if (document.visibilityState !== "hidden") {
        try {
          const query = new URLSearchParams({ view: "all" });
          if (version !== null) query.set("since", String(version));
          const res = await fetch("/api/feed?" + query, { cache: "no-store", signal: controller.signal });
          if (res.status === 200) {
            const body = await res.json().catch(() => null) as { version?: unknown } | null;
            if (typeof body?.version === "number") version = body.version;
          } else {
            await res.body?.cancel();
          }
          if (!stopped) setStatus(statusFromResponse(res.status));
        } catch {
          if (!stopped) setStatus("unreachable");
        }
      }
      if (!stopped) timer = setTimeout(probe, POLL_MS);
    };
    void probe();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [enabled]);
  return status;
}

export const RuntimeContext = createContext<{ info: RuntimeInfo; status: RuntimeStatus }>({
  info: unknownRuntime,
  status: "connecting",
});

export function useRuntime() {
  return useContext(RuntimeContext);
}

export const runtimeStatusLabel: Record<RuntimeStatus, string> = {
  connecting: "Connecting",
  connected: "Connected",
  unreachable: "Not reachable",
};
