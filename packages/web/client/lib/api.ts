type ApiTextResponse = {
  text: string;
  contentType: string | null;
};

const inFlightGets = new Map<string, Promise<ApiTextResponse>>();
let inFlightAuthRefresh: Promise<boolean> | null = null;

function resolveBootstrapPath(): string {
  const custom = (globalThis as unknown as {
    __OPENSCOUT_WEB_BOOTSTRAP__?: { routes?: { bootstrapScriptPath?: string } };
  })?.__OPENSCOUT_WEB_BOOTSTRAP__?.routes?.bootstrapScriptPath;
  return custom?.trim() || "/api/bootstrap.js";
}

export async function refreshSessionAuth(): Promise<boolean> {
  if (inFlightAuthRefresh) {
    return inFlightAuthRefresh;
  }
  const bootstrapPath = resolveBootstrapPath();
  inFlightAuthRefresh = (async () => {
    try {
      const res = await fetch(bootstrapPath, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      inFlightAuthRefresh = null;
    }
  })();
  return inFlightAuthRefresh;
}

function formatResponsePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "empty body";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function parseApiResponse<T>(path: string, text: string, contentType: string | null): T {
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const label = contentType?.trim() || "non-JSON";
    throw new Error(`Expected JSON from ${path} but received ${label}: ${formatResponsePreview(text)}`);
  }
}

function normalizeHeaders(headers?: HeadersInit): string {
  if (!headers) return "";
  return JSON.stringify([...new Headers(headers).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function requestKey(path: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  return `${method}:${path}:${normalizeHeaders(init?.headers)}`;
}

async function fetchApiText(path: string, init?: RequestInit): Promise<ApiTextResponse> {
  const performFetch = async () =>
    fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    });

  let res = await performFetch();
  if (res.status === 401 && !path.includes("/bootstrap.js")) {
    const refreshed = await refreshSessionAuth();
    if (refreshed) {
      res = await performFetch();
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = JSON.parse(text);
      if (typeof body?.error === "string") message = body.error;
      if (typeof body?.code === "string") code = body.code;
    } catch {
      /* plain text */
    }
    // The status rides on the error so callers can tell a refusal (4xx)
    // from a delivery that may or may not have landed (5xx, network).
    throw Object.assign(new Error(message), { status: res.status, code });
  }
  const text = await res.text();
  return {
    text,
    contentType: res.headers.get("content-type"),
  };
}

/** Typed fetch wrapper for Scout API endpoints. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  // A signal owns its request lifetime; never share it with unrelated consumers.
  const dedupeGet = method === "GET" && !init?.body && !init?.signal;

  if (!dedupeGet) {
    const response = await fetchApiText(path, init);
    return parseApiResponse<T>(path, response.text, response.contentType);
  }

  const key = requestKey(path, init);
  const existing = inFlightGets.get(key);
  if (existing) {
    const response = await existing;
    return parseApiResponse<T>(path, response.text, response.contentType);
  }

  const request = fetchApiText(path, init);
  inFlightGets.set(key, request);

  try {
    const response = await request;
    return parseApiResponse<T>(path, response.text, response.contentType);
  } finally {
    inFlightGets.delete(key);
  }
}
