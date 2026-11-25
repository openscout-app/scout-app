// POST /api/session-names: the operator's name for one harness session,
// passed through to the runtime's machine-local /v1/session-names route.
// These mirror the runtime's session-name contract (core
// `packages/protocol/src/session-names.ts`) until the app's protocol
// dependency carries it.

/** Where a session's shown name comes from: the operator, its current work item, or the harness. */
export type SessionNameSource = "operator" | "work" | "harness";

/** The runtime refuses longer names. */
export const SESSION_NAME_MAX_LENGTH = 120;

/** Name one session. `name` null or empty clears the operator's name. */
export type SessionNameSetBody = {
  /** A native session id, `<harness>:<id>`, an agent id or a session address. */
  selector: string;
  /** Narrows the selector to one harness. */
  harness?: string;
  name: string | null;
};

export type SessionNameResolution = {
  name: string | null;
  source: SessionNameSource | null;
  operatorName: string | null;
  derivedName: string | null;
  harnessTitle: string | null;
};

export type SessionNameSetResult = {
  ok: true;
  action: "set" | "cleared" | "unchanged";
  session: { harness: string; nativeSessionId: string };
  resolution: SessionNameResolution;
};

/**
 * A refusal, from the runtime or from the web server. `error` is a sentence
 * to show as it is; `code` is the runtime's token (`invalid_session_name`,
 * `session_not_found`, `ambiguous_session`, `local_only`,
 * `runtime_unavailable`).
 */
export type SessionNameRefusal = {
  error: string;
  code: string;
};
