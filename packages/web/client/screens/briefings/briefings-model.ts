import type { Route } from "../../lib/types.ts";

/*
 * Briefings without React: what the archive and one briefing carry, and how
 * their parts read. The Briefings page and every Briefings panel draw from
 * these; briefings-model.test.ts holds them.
 */

export type BriefingKind = "fleet-home" | "tour";

/** One row of the archive: GET /api/briefings. */
export type BriefingSummary = {
  id: string;
  kind: BriefingKind;
  title: string;
  summary: string;
  recommendation: string | null;
  preparedAt: number;
  ttlMs: number;
  observationCount: number;
  createdAt: number;
};

/** One briefing, whole: GET /api/briefings/:id. */
export type BriefingDetail = {
  id: string;
  kind: BriefingKind;
  title: string;
  summary: string;
  recommendation: string | null;
  preparedAt: number;
  ttlMs: number;
  brief: BriefBody | null;
  observations: ObservationItem[];
  snapshot: SnapshotBody | null;
  call: CallBody | null;
  /** SCO-037: canonical markdown body. Null for rows persisted before the markdown pipeline. */
  markdown: string | null;
  createdAt: number;
};

export type BriefBody = {
  id: string;
  title: string;
  summary: string;
  recommendation: string;
  steps: BriefStep[];
  actions: BriefAction[];
  presented?: PresentedBody | null;
};

export type PresentedBody = {
  sentences: string[];
  voiceSpec: { targetWords: number; persona: string };
  model: string;
  responseId: string | null;
};

export type BriefStep = {
  id: string;
  label: string;
  route?: Record<string, unknown>;
  narration: string;
  observations?: ObservationItem[];
};

export type BriefAction = {
  label: string;
  route?: Record<string, unknown>;
  prompt?: string;
};

export type ObservationItem = {
  text: string;
  tone?: string;
  references: ReferenceItem[];
};

export type ReferenceItem = {
  label: string;
  kind: string;
  route?: Record<string, unknown>;
  detail?: string;
};

export type SnapshotBody = {
  generatedAt?: string;
  currentDirectory?: string;
  currentRoute?: unknown;
  state?: Record<string, unknown>;
};

export type CallBody = {
  model: string;
  systemPrompt: string;
  operatorRequest: string;
  responseId: string | null;
  telemetry?: CallTelemetry | null;
  presenter?: PresenterTelemetry | null;
};

export type CallTelemetry = {
  elapsedMs: number;
  usage: TokenUsage | null;
};

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type PresenterTelemetry = CallTelemetry & {
  model: string;
  responseId: string | null;
  skipped: "rate-guard" | "error" | null;
  errorMessage?: string;
};

// ── Reads ───────────────────────────────────────────────────────────────────

/** The archive as the page always read it: the newest 50 (the server keeps 100). */
export const BRIEFINGS_LIST_PATH = "/api/briefings?limit=50";

export function briefingDetailPath(id: string): string {
  return `/api/briefings/${encodeURIComponent(id)}`;
}

/** A briefing's own page, or the archive. */
export function briefingRoute(id?: string): Route {
  return id ? { view: "briefings", briefingId: id } : { view: "briefings" };
}

/** The newest briefing the archive holds (the server lists newest first), or null when it is empty. */
export function latestBriefingId(items: readonly BriefingSummary[] | null): string | null {
  return items?.[0]?.id ?? null;
}

/**
 * Whether a briefing as shown is older than the archive row for it: the
 * server writes a briefing again under the same id, and the row moves first.
 */
export function detailIsStale(summary: Pick<BriefingSummary, "preparedAt"> | null | undefined, detail: Pick<BriefingDetail, "preparedAt"> | null): boolean {
  return Boolean(summary && detail && summary.preparedAt !== detail.preparedAt);
}

// ── How the parts read ──────────────────────────────────────────────────────

/** The kind, short (a list row) and long (a briefing's own header). */
export const KIND_SHORT: Record<BriefingKind, string> = {
  "fleet-home": "fleet",
  tour: "tour",
};

export const KIND_LONG: Record<BriefingKind, string> = {
  "fleet-home": "fleet briefing",
  tour: "tour briefing",
};

/** An unknown kind (a newer server) reads as itself rather than blank. */
export function kindLabel(kind: string, long = false): string {
  const labels: Record<string, string> = long ? KIND_LONG : KIND_SHORT;
  return labels[kind] ?? kind;
}

/** An observation's tone, when it is one worth marking: a warning or an error. */
export function observationTone(tone: string | undefined): "warn" | "err" | null {
  if (tone === "warn") return "warn";
  if (tone === "err" || tone === "error") return "err";
  return null;
}

export const TONE_LABEL: Record<"warn" | "err", string> = {
  warn: "Warning",
  err: "Error",
};

/** A reference chip's text: the label, and its detail when it has one. */
export function referenceLabel(reference: Pick<ReferenceItem, "label" | "detail">): string {
  return reference.detail ? `${reference.label} · ${reference.detail}` : reference.label;
}

/** What the presenter call's row adds when it did not run. */
export function presenterNote(presenter: Pick<PresenterTelemetry, "skipped" | "errorMessage">): string | null {
  if (presenter.skipped === "rate-guard") return "skipped — rate-guard hit";
  if (presenter.skipped === "error") return `failed — ${presenter.errorMessage ?? "unknown"}`;
  return null;
}

/** A call's time in seconds, or a dash when it was not measured. */
export function elapsedLabel(telemetry: CallTelemetry | null): string {
  return telemetry && telemetry.elapsedMs > 0 ? `${(telemetry.elapsedMs / 1000).toFixed(2)}s` : "—";
}

/** Whether the briefing has call telemetry to show. */
export function hasTelemetry(call: CallBody | null): call is CallBody {
  return Boolean(call && (call.telemetry || call.presenter));
}

/** What the read snapshot held: a count per list it carried, in the page's order. */
export function deriveSnapshotCounts(
  snapshot: SnapshotBody | null,
): Array<{ label: string; value: number }> {
  if (!snapshot?.state) return [];
  const state = snapshot.state;
  const counts: Array<{ label: string; value: number }> = [];
  const tryCount = (label: string, value: unknown) => {
    if (Array.isArray(value)) counts.push({ label, value: value.length });
  };
  tryCount("agents", state.agents);
  if (state.fleet && typeof state.fleet === "object") {
    const fleet = state.fleet as Record<string, unknown>;
    tryCount("active requests", fleet.activeAsks);
    tryCount("attention", fleet.needsAttention);
    tryCount("recent", fleet.recentCompleted);
  }
  if (state.broker && typeof state.broker === "object") {
    const broker = state.broker as Record<string, unknown>;
    tryCount("broker msgs", broker.recentMessages);
  }
  tryCount("scout chatter", state.scoutChatter);
  tryCount("tail events", state.agentLogMessages);
  if (state.operatorAttention && typeof state.operatorAttention === "object") {
    const op = state.operatorAttention as Record<string, unknown>;
    tryCount("operator items", op.items);
  }
  return counts;
}
