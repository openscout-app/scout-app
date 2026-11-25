/*
 * Which tail rows are trouble and which are bookkeeping. The Tail view flags issues with this and hides bookkeeping in
 * its work mode; Mission Control's panes leave out bookkeeping that carries no issue.
 */
import type { TailEvent } from "./types.ts";

export type IssueSeverity = "warn" | "error";

const ERROR_TEXT_RE = /\b(error|failed|failure|exception|panic|timeout|timed out|refused|crash|fatal|non[- ]?zero|exit(?:ed)? with code [1-9])\b/i;
const WARN_TEXT_RE = /\b(warn(?:ing)?|deprecated|retry|rate limit|rate-limited|blocked|skipped|interrupted|aborted|stale|conflict|permission denied|denied)\b/i;

export function issueFromText(text: string): IssueSeverity | null {
  const normalized = text.replace(/[_-]+/g, " ");
  if (ERROR_TEXT_RE.test(normalized)) return "error";
  if (WARN_TEXT_RE.test(normalized)) return "warn";
  return null;
}

function isMeaningful(value: unknown): boolean {
  if (value == null) return false;
  if (value === false) return false;
  if (typeof value === "string" && !value.trim()) return false;
  return true;
}

function issueFromRaw(value: unknown, depth = 0): IssueSeverity | null {
  if (value == null || depth > 4) return null;
  if (typeof value === "string") return null;
  if (typeof value !== "object") return null;

  if (Array.isArray(value)) {
    let fallback: IssueSeverity | null = null;
    for (const entry of value.slice(0, 40)) {
      const severity = issueFromRaw(entry, depth + 1);
      if (severity === "error") return "error";
      fallback ??= severity;
    }
    return fallback;
  }

  let fallback: IssueSeverity | null = null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    const lowerKey = key.toLowerCase();
    if ((lowerKey === "is_error" || lowerKey === "failed") && entry === true) {
      return "error";
    }
    if (lowerKey === "error" && isMeaningful(entry)) {
      return "error";
    }
    if ((lowerKey === "warning" || lowerKey === "warn") && isMeaningful(entry)) {
      fallback = "warn";
    }
    if (
      typeof entry === "string" &&
      (lowerKey === "level" ||
        lowerKey === "severity" ||
        lowerKey === "status" ||
        lowerKey === "type" ||
        lowerKey === "subtype")
    ) {
      const severity = issueFromText(entry);
      if (severity === "error") return "error";
      fallback ??= severity;
    }
    const nested = issueFromRaw(entry, depth + 1);
    if (nested === "error") return "error";
    fallback ??= nested;
  }
  return fallback;
}

/** A bare protocol marker (`[token_usage_record]`, `[realtime_item]`): bookkeeping, not work. */
const BOOKKEEPING_SUMMARY_RE = /^\[[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*\]$/;

export function isBookkeepingTailEvent(event: TailEvent): boolean {
  return BOOKKEEPING_SUMMARY_RE.test(event.summary.trim());
}

export function classifyTailIssue(event: TailEvent): IssueSeverity | null {
  const rawSeverity = issueFromRaw(event.raw);
  if (rawSeverity === "error") return "error";
  if (event.kind === "tool-result" || event.kind === "system" || event.kind === "other") {
    const textSeverity = issueFromText(event.summary);
    if (textSeverity === "error") return "error";
    return rawSeverity ?? textSeverity;
  }
  return rawSeverity;
}

/** A bookkeeping marker with nothing wrong in it: what a view of the work leaves out. */
export function isQuietBookkeeping(event: TailEvent): boolean {
  return isBookkeepingTailEvent(event) && classifyTailIssue(event) == null;
}
