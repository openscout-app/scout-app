import { promptHeadline } from "@openscout/agent-sessions";
import type { DiscoveredTranscript, TailEvent } from "@openscout/runtime/tail";

import { computerCallCollector } from "./computer-calls.ts";
import type { ObserveData, ObserveEvent, ObserveFile } from "./service.ts";

const GROK_STREAMING_PHASES = new Set([
  "streaming_reasoning",
  "streaming_text",
  "tool_execution",
  "permission_prompt",
]);

const GROK_TOOL_STARTED = /^([A-Za-z][\w-]*) started$/;
const GROK_TOOL_COMPLETED = /^([A-Za-z][\w-]*) completed(?: · (.+))?$/;
const GROK_TOOL_WITH_ARG = /^([A-Za-z][\w-]*) · (.+?)(?: · (success|error|failed))?$/;
const CODEX_TOOL_CALL = /^([A-Za-z_][\w.-]*)\((.*)\)$/s;
const CLEAN_TOOL_CALL = /^([A-Za-z][\w-]*)(?:\s+([\s\S]+))?$/;
const CLEAN_RESULT_PREFIX = /^res:\s*([\s\S]*)$/;
const CLEAN_COMBINED_RESULT = /^([\s\S]+?)\s+->\s+res:\s*([\s\S]+)$/;
const CLEAN_RESULT_ERROR = /\b(?:failed|failure|exception|fatal|denied|traceback)\b|error:/i;

const NATIVE_DISCOVERED_FRESH_MS = 5 * 60_000;

const TAIL_ATTRIBUTION_LABEL = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "native",
} as const;

function tailAttributionLabel(harness: TailEvent["harness"]): string {
  return TAIL_ATTRIBUTION_LABEL[harness] ?? harness;
}

function tailObserveEventDetail(
  event: Pick<TailEvent, "kind" | "source" | "harness" | "project" | "cwd">,
  transcript: DiscoveredTranscript,
): string | undefined {
  if (event.kind === "tool" || event.kind === "tool-result") {
    return undefined;
  }

  const workspace = transcript.project?.trim()
    || transcript.cwd?.trim()
    || event.project?.trim()
    || event.cwd?.trim();
  const origin = tailAttributionLabel(event.harness);
  return workspace ? `${workspace} · ${origin}` : `${event.source} · ${origin}`;
}

function isTailNoiseEvent(event: TailEvent): boolean {
  if (event.source === "cursor") {
    const summary = event.summary.trim().toLowerCase();
    return event.kind === "system"
      && (summary === "process sample" || summary.startsWith("process sample ·"));
  }
  if (event.source !== "grok") return false;

  const summary = event.summary.trim().toLowerCase();
  if (summary === "first token" || summary.startsWith("loop ")) {
    return true;
  }

  if (!summary.startsWith("phase ·")) return false;
  const phase = summary.slice("phase ·".length).trim();
  return GROK_STREAMING_PHASES.has(phase);
}

function filterTailEventsForDisplay(events: TailEvent[]): TailEvent[] {
  return events.filter((event) => !isTailNoiseEvent(event));
}

type TailToolObservation = {
  tool?: string;
  arg?: string;
  path?: string;
  diff?: { add: number; del: number; preview: string };
  stream?: string[];
  result?: Record<string, string>;
};

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function observeStructuredTailToolFields(event: TailEvent): TailToolObservation | null {
  const raw = rawObject(event.raw);
  if (!raw) return null;
  const tool = typeof raw.tool === "string" && raw.tool.trim() ? raw.tool.trim() : undefined;
  if (!tool) return null;
  const arg = typeof raw.arg === "string" && raw.arg.trim()
    ? raw.arg.trim()
    : typeof raw.command === "string" && raw.command.trim()
      ? raw.command.trim()
      : typeof raw.path === "string" && raw.path.trim()
        ? raw.path.trim()
        : undefined;
  const path = typeof raw.path === "string" && raw.path.trim() ? raw.path.trim() : undefined;
  const rawDiff = rawObject(raw.diff);
  const diff = rawDiff && typeof rawDiff.add === "number" && typeof rawDiff.del === "number"
    ? {
        add: rawDiff.add,
        del: rawDiff.del,
        preview: typeof rawDiff.preview === "string" ? rawDiff.preview : "",
      }
    : undefined;
  const description = typeof raw.description === "string" && raw.description.trim()
    ? raw.description.trim()
    : undefined;
  const outcome = typeof raw.outcome === "string" && raw.outcome.trim() ? raw.outcome.trim() : undefined;
  const exitCode = typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode)
    ? String(raw.exitCode)
    : undefined;
  const result = outcome
    ? { outcome, ...(exitCode ? { exitCode } : {}) }
    : undefined;
  const stream = event.kind === "tool-result" && typeof raw.content === "string" && raw.content.trim()
    ? [raw.content.trim()]
    : description && arg && description !== arg
      ? [description]
      : undefined;
  return {
    tool,
    ...(arg ? { arg } : {}),
    ...(path ? { path } : {}),
    ...(diff ? { diff } : {}),
    ...(stream ? { stream } : {}),
    ...(result ? { result } : {}),
  };
}

function observeToolFieldsFromTailEvent(event: TailEvent): TailToolObservation {
  if (event.kind !== "tool" && event.kind !== "tool-result") return {};

  const structured = observeStructuredTailToolFields(event);
  if (structured) return structured;

  const summary = event.summary.trim();
  if (!summary) return {};

  if (event.source === "claude" || event.source === "kimi" || event.source === "antigravity") {
    const combined = summary.match(CLEAN_COMBINED_RESULT);
    if (combined?.[1] && combined[2]) {
      const call = combined[1].trim().match(CLEAN_TOOL_CALL);
      const preview = combined[2].trim();
      if (call?.[1] && /^[A-Z]/u.test(call[1])) {
        return {
          tool: call[1],
          arg: call[2]?.trim() || undefined,
          result: { outcome: CLEAN_RESULT_ERROR.test(preview) ? "error" : "success" },
        };
      }
      return {
        tool: "bash",
        arg: combined[1].trim(),
        result: { outcome: CLEAN_RESULT_ERROR.test(preview) ? "error" : "success" },
      };
    }
    const result = summary.match(CLEAN_RESULT_PREFIX);
    if (result) {
      const preview = result[1].trim();
      return {
        tool: "res",
        arg: preview || undefined,
        result: { outcome: CLEAN_RESULT_ERROR.test(preview) ? "error" : "success" },
      };
    }
    const call = summary.match(CLEAN_TOOL_CALL);
    if (call?.[1] && /^[A-Z]/u.test(call[1])) {
      return { tool: call[1], arg: call[2]?.trim() || undefined };
    }
    return { tool: "bash", arg: summary };
  }

  if (event.source === "grok") {
    const enriched = summary.match(GROK_TOOL_WITH_ARG);
    if (enriched?.[1] && enriched[2]) {
      const fields: { tool?: string; arg?: string; result?: Record<string, string> } = {
        tool: enriched[1],
        arg: enriched[2],
      };
      if (enriched[3]) fields.result = { outcome: enriched[3] };
      return fields;
    }
    const started = summary.match(GROK_TOOL_STARTED);
    if (started?.[1]) {
      return { tool: started[1], arg: "started" };
    }
    const completed = summary.match(GROK_TOOL_COMPLETED);
    if (completed?.[1]) {
      const fields: { tool?: string; arg?: string; result?: Record<string, string> } = {
        tool: completed[1],
        arg: "completed",
      };
      if (completed[2]) fields.result = { outcome: completed[2] };
      return fields;
    }
  }

  const fnCall = summary.match(CODEX_TOOL_CALL);
  if (fnCall?.[1]) {
    return { tool: fnCall[1], arg: fnCall[2]?.trim() || undefined };
  }

  const dotSep = summary.match(/^([A-Za-z_][\w.-]*) · (.+)$/);
  if (dotSep?.[1]) {
    return { tool: dotSep[1], arg: dotSep[2] };
  }

  const first = summary.split(/\s+/)[0];
  if (first && first.toLowerCase() !== event.source.toLowerCase()) {
    return { tool: first };
  }

  return {};
}

function tailEventKindToObserveKind(event: TailEvent): ObserveEvent["kind"] {
  if (
    event.source === "kimi"
    && event.kind === "system"
    && event.summary.trim().startsWith("[thinking] ")
  ) {
    return "think";
  }
  // A turn the harness wrote itself (a task notification, a command echo,
  // injected context) is not the operator asking for anything.
  if (event.kind === "user" && event.prompt?.harnessOnly) return "system";
  switch (event.kind) {
    case "assistant":
      return "message";
    case "tool":
    case "tool-result":
      return "tool";
    case "user":
      return "ask";
    case "system":
      return "system";
    default:
      return "note";
  }
}

const OBSERVE_TEXT_MAX = 200;

/** The event's line: a classified turn reads as its headline (the operator's
 *  words, else what the harness did), never as its raw markup. */
function tailObserveText(event: TailEvent): string {
  if (event.prompt) {
    const flat = promptHeadline(event.prompt).replace(/\s+/gu, " ").trim();
    if (flat) return flat.length <= OBSERVE_TEXT_MAX ? flat : `${flat.slice(0, OBSERVE_TEXT_MAX - 1)}…`;
  }
  return event.source === "kimi"
    ? event.summary.replace(/^\[thinking\]\s+/u, "")
    : event.summary;
}

function recordTailTouchedFile(
  files: Map<string, ObserveFile>,
  tool: string | undefined,
  rawPath: string | undefined,
  t: number,
): void {
  const cleaned = rawPath?.trim().replace(/:\d+(?:-\d+)?$/u, "") ?? "";
  if (!cleaned || (!cleaned.startsWith("/") && !cleaned.startsWith("~/") && !cleaned.includes("/"))) return;
  const lower = (tool ?? "").toLowerCase();
  const state: ObserveFile["state"] | null = lower === "write" || lower === "write_file"
    ? "created"
    : lower === "edit" || lower === "edit_file" || lower === "strreplace" || lower === "apply_patch"
      ? "modified"
      : lower === "read" || lower === "read_file"
        ? "read"
        : null;
  if (!state) return;
  const rank = { read: 1, modified: 2, created: 3 } as const;
  const existing = files.get(cleaned);
  if (!existing) {
    files.set(cleaned, { path: cleaned, state, touches: 1, lastT: t });
    return;
  }
  existing.touches += 1;
  existing.lastT = Math.max(existing.lastT, t);
  if (rank[state] > rank[existing.state]) existing.state = state;
}

export function buildObserveDataFromTail(
  transcript: DiscoveredTranscript,
  events: TailEvent[],
  current: boolean,
): ObserveData {
  const tail = filterTailEventsForDisplay(
    [...events].sort((left, right) => left.ts - right.ts),
  ).slice(-200);
  const sessionStart = tail[0]?.ts ?? transcript.mtimeMs;

  const collector = transcript.source === "codex" ? computerCallCollector("Codex")
    : transcript.source === "claude" ? computerCallCollector("Claude Code") : undefined;
  for (const event of tail) collector?.read(event.raw, event.ts);
  const computerUse = collector?.snapshot();
  const files = new Map<string, ObserveFile>();
  const observeEvents = tail.map((event): ObserveEvent => {
    const toolFields = observeToolFieldsFromTailEvent(event);
    const t = Math.max(0, Math.round((event.ts - sessionStart) / 1000));
    recordTailTouchedFile(files, toolFields.tool, toolFields.path ?? toolFields.arg, t);
    return {
      id: event.id,
      t,
      at: event.ts,
      kind: tailEventKindToObserveKind(event),
      text: tailObserveText(event),
      tool: toolFields.tool,
      arg: toolFields.arg,
      ...(toolFields.diff ? { diff: toolFields.diff } : {}),
      ...(toolFields.stream ? { stream: toolFields.stream } : {}),
      result: toolFields.result,
      detail: tailObserveEventDetail(event, transcript),
      live: current && event.id === tail[tail.length - 1]?.id,
      ...(event.prompt ? { prompt: event.prompt } : {}),
    };
  });

  const placeholderEvents: ObserveEvent[] = observeEvents.length > 0
    ? observeEvents
    : (Date.now() - transcript.mtimeMs <= NATIVE_DISCOVERED_FRESH_MS
        ? [{
            id: `${transcript.source}:${transcript.sessionId ?? "session"}:discovered`,
            t: 0,
            kind: "system",
            text: `Native ${transcript.source} transcript discovered.`,
            detail: transcript.cwd ?? transcript.transcriptPath,
          }]
        : []);

  return {
    events: placeholderEvents,
    ...(computerUse ? { computerUse } : {}),
    files: [...files.values()].sort((left, right) => right.lastT - left.lastT || left.path.localeCompare(right.path)),
    live: current && observeEvents.length > 0,
    metadata: {
      session: {
        adapterType: transcript.source,
        cwd: transcript.cwd ?? undefined,
        externalSessionId: transcript.sessionId ?? undefined,
        sessionStart,
      },
    },
  };
}
