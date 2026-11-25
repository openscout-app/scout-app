import type { ClassifiedPrompt } from "@openscout/agent-sessions";

import type { ObserveEvent } from "./types.ts";

export type LaneAskDisplayField = {
  label: string;
  value: string;
};

/** An injected-context wrapper (`<in-app-browser-context …>`, `<system-reminder …>`)
 *  lifted out of the request prose so it can render as a chip instead of raw markup. */
export type LaneAskContextTag = {
  /** Element name, lower-cased (e.g. "in-app-browser-context"). */
  name: string;
  /** Label from the harness's adapter, when the event carries classified parts. */
  label?: string;
  /** Most identifying attribute value (`source` preferred, else the first one). */
  detail?: string;
  /** Verbatim opening token, for tooltips. */
  raw: string;
};

export type LaneAskDisplayModel = {
  label: string;
  title: string;
  preview: string;
  requestText: string;
  /** What the operator wrote, with context wrappers taken out; "" when the
   *  harness wrote the whole turn (a reminder, a page of context). */
  operatorWords: string;
  fullText: string;
  copyText: string;
  fields: LaneAskDisplayField[];
  contextTags: LaneAskContextTag[];
  answer?: {
    label: string;
    text: string;
  };
};

const ROUTED_TASK_LABEL = /\bask\/Task\s*:\s*([^\n]+)/i;
const TASK_LABEL = /^(?:#+\s*)?(?:task|request|prompt|goal|user goal|user request|ask)\s*:\s*(.+)$/i;
const REQUEST_SECTION_HEADING = /^\s*#{1,4}\s*(?:my request(?:\s+for\s+[^:\n]+)?|request|user request)\s*:?\s*$/i;
const MARKDOWN_FENCE = /^```/;
const ROUTING_PREFIX = /^.+?\bask\/Task\s*:\s*/i;
const SCOUT_ROUTING_HEADER = /^\s*(?:\u2316\s*)?.+?\s+(?:->|\u2192)\s+.+?\s+(?:\u00b7|\.)\s+ask:[\w-]+\s*(?:>|\u203a)\s*/iu;
const CODEX_TASK_PREFIX = /^#?\s*Codex task\s*(?:[-:\u2013\u2014])\s*/i;
const GENERIC_REQUEST_LABEL = /^(?:ask|request|user request|incoming ask)$/i;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function stripLeadingGenericRequestLabels(value: string): string {
  let text = value.trim();
  let changed = true;

  while (changed) {
    changed = false;
    const lines = text.split("\n");
    const first = cleanLine(lines[0] ?? "");
    if (GENERIC_REQUEST_LABEL.test(first) && lines.length > 1) {
      text = lines.slice(1).join("\n").trim();
      changed = true;
    }
  }

  return text;
}

function cleanLine(value: string): string {
  return value
    .trim()
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "")
    .replace(/^>\s*/u, "")
    .replace(SCOUT_ROUTING_HEADER, "")
    .replace(ROUTING_PREFIX, "")
    .replace(CODEX_TASK_PREFIX, "")
    .trim();
}

function isMeaningfulLine(value: string): boolean {
  const line = cleanLine(value);
  if (!line) return false;
  if (MARKDOWN_FENCE.test(line)) return false;
  if (REQUEST_SECTION_HEADING.test(line)) return false;
  if (GENERIC_REQUEST_LABEL.test(line)) return false;
  return /[\p{L}\p{N}]/u.test(line);
}

function firstMeaningfulLine(value: string): string | null {
  for (const raw of value.split("\n")) {
    if (!isMeaningfulLine(raw)) continue;
    return cleanLine(raw);
  }
  return null;
}

function labeledRequest(value: string): string | null {
  const routed = value.match(ROUTED_TASK_LABEL);
  if (routed?.[1]?.trim()) return cleanLine(routed[1]);
  for (const raw of value.split("\n")) {
    const line = cleanLine(raw);
    const match = line.match(TASK_LABEL);
    if (match?.[1]?.trim()) return cleanLine(match[1]);
  }
  return null;
}

function requestSection(value: string): string | null {
  const lines = value.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!REQUEST_SECTION_HEADING.test(lines[index] ?? "")) continue;
    const rest = lines.slice(index + 1).join("\n").trim();
    return rest || null;
  }
  return null;
}

function softClip(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  const clipped = text.slice(0, max).trimEnd();
  const boundary = Math.max(
    clipped.lastIndexOf(" "),
    clipped.lastIndexOf("\n"),
    clipped.lastIndexOf("."),
  );
  const soft = boundary > max * 0.55 ? clipped.slice(0, boundary) : clipped;
  return `${soft.trimEnd()}...`;
}

/* Fallback for a turn from a harness with no classifier: any wrapper element
   (a dash or underscore in its name, so prose like `<Task>` or `<b>` is left
   alone) becomes a chip named in words, and its body is dropped, since
   injected context is never the operator's words. A wrapper that never closes
   runs to the end. A harness's own tags and labels live in its adapter
   (agent-sessions/src/adapters/<harness>/prompt-markup.ts). */
const CONTEXT_BLOCK = /<([a-zA-Z][\w.]*[-_][\w.-]*)(\s[^<>]*?)?\s*(?:\/>|>[\s\S]*?(?:<\/\1\s*>|$))/g;
const STRAY_CLOSE = /<\/[a-zA-Z][\w.]*[-_][\w.-]*\s*>/g;
const TAG_ATTR = /([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** Chip text for a wrapper with no adapter label: its name as words. */
export function laneAskContextTagLabel(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function extractContextTags(value: string): { tags: LaneAskContextTag[]; text: string } {
  const byName = new Map<string, LaneAskContextTag>();
  const text = value
    .replace(CONTEXT_BLOCK, (raw, name: string, attrs?: string) => {
      const key = name.toLowerCase();
      let detail: string | undefined;
      for (const match of (attrs ?? "").matchAll(TAG_ATTR)) {
        const attrValue = match[2] ?? match[3] ?? match[4] ?? "";
        if (match[1]?.toLowerCase() === "source") { detail = attrValue; break; }
        detail ??= attrValue;
      }
      const opening = raw.match(/^<[^>]*>?/)?.[0] ?? raw;
      const existing = byName.get(key);
      if (!existing) byName.set(key, { name: key, raw: opening, ...(detail ? { detail } : {}) });
      else if (!existing.detail && detail) Object.assign(existing, { detail, raw: opening });
      return "";
    })
    .replace(STRAY_CLOSE, "");
  const tidied = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { tags: [...byName.values()], text: tidied };
}

function compactParagraph(value: string): string {
  return value
    .split("\n")
    .map((line) => cleanLine(line))
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function targetLabel(event: Pick<ObserveEvent, "to">): string {
  const to = event.to?.trim();
  if (!to) return "User request";
  if (to === "human") return "To operator";
  return `To ${to}`;
}

function answerDelayLabel(event: Pick<ObserveEvent, "t" | "answerT">): string | null {
  if (typeof event.answerT !== "number" || !Number.isFinite(event.answerT)) return null;
  const seconds = Math.max(0, Math.round(event.answerT - event.t));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

/** Context chips from the adapter's parts: one per wrapper, labelled by the
 *  adapter, so nothing here needs to know a harness's tags. */
function contextTagsFromPrompt(prompt: ClassifiedPrompt): LaneAskContextTag[] {
  const byName = new Map<string, LaneAskContextTag>();
  for (const part of prompt.parts) {
    if (part.kind !== "context" || byName.has(part.name)) continue;
    byName.set(part.name, { name: part.name, label: part.label, raw: part.text ?? part.label, ...(part.detail ? { detail: part.detail } : {}) });
  }
  return [...byName.values()];
}

/** The request as the operator wrote it: words, then any pasted blocks. */
function promptRequestText(prompt: ClassifiedPrompt): string {
  return prompt.parts
    .flatMap((part) => (part.kind === "words" || part.kind === "paste" ? [part.text] : []))
    .join("\n\n");
}

export function buildLaneAskDisplay(event: Pick<ObserveEvent, "text" | "to" | "answer" | "answerT" | "t" | "prompt">): LaneAskDisplayModel {
  // A classified turn arrives already split by its harness's adapter; the
  // text parsing below is for sources that have no classifier yet.
  const classified = event.prompt ? promptRequestText(event.prompt) : "";
  const fullText = normalizeText(classified || event.text);
  const strippedText = stripLeadingGenericRequestLabels(fullText) || fullText;
  const requestText = requestSection(strippedText)
    ?? requestSection(fullText)
    ?? strippedText;
  const extracted = event.prompt ? { tags: contextTagsFromPrompt(event.prompt), text: requestText } : extractContextTags(requestText);
  const { tags: contextTags, text: requestBody } = extracted;
  // Only wrappers and nothing else: name what was attached, never show its body.
  const onlyContext = contextTags.length > 0 && !requestBody;
  const contextOnlyLine = contextTags.map((tag) => tag.label ?? laneAskContextTagLabel(tag.name)).join(", ");
  const displayText = onlyContext ? contextOnlyLine : requestBody || requestText;
  const compactRequest = compactParagraph(displayText) || (onlyContext ? "" : fullText) || "Request";
  const title = labeledRequest(displayText)
    ?? labeledRequest(fullText)
    ?? firstMeaningfulLine(displayText)
    ?? firstMeaningfulLine(fullText)
    ?? "Request";
  const label = targetLabel(event);
  const fields: LaneAskDisplayField[] = [{ label: "route", value: label }];
  const delay = answerDelayLabel(event);
  if (delay) fields.push({ label: "answer", value: delay });

  const answer = normalizeText(event.answer);
  const copyText = answer
    ? `${fullText}\n\nAnswer:\n${answer}`
    : fullText;

  return {
    label,
    title: softClip(title, 180),
    preview: softClip(compactRequest, 520),
    requestText,
    operatorWords: event.prompt?.harnessOnly ? "" : requestBody.trim(),
    fullText,
    copyText,
    fields,
    contextTags,
    answer: answer
      ? {
          label: delay ? `answered after ${delay}` : "answered",
          text: answer,
        }
      : undefined,
  };
}

export function laneAskHeadline(
  event: Pick<ObserveEvent, "text" | "to" | "answer" | "answerT" | "t" | "prompt">,
  full = false,
): string {
  const ask = buildLaneAskDisplay(event);
  return full ? ask.fullText : ask.title;
}

export function laneAskPreview(
  event: Pick<ObserveEvent, "text" | "to" | "answer" | "answerT" | "t" | "prompt">,
): string {
  return buildLaneAskDisplay(event).preview;
}
