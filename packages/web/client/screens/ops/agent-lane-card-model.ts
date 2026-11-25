import { isHarnessNotice } from "../../lib/harness-notice.ts";
import { deriveContextBudgetGauge, formatContextTokenCount } from "../../lib/context-budget.ts";
import { isAgentBusy } from "../../lib/agent-state.ts";
import { normalizeTimestampMs, timeAgoPast } from "../../lib/time.ts";
import { laneToolArgSnippet, observeEventWallMs } from "../../lib/lane-observe.ts";
import { splitCdPrefix, tildeShortenPath } from "../../lib/bash-format.ts";
import { countObserveTrace } from "../../lib/observe-trace-counts.ts";
import type { ObserveData, ObserveEvent, ObserveFile } from "../../lib/types.ts";
import type { AgentLaneCardModel, LanePopGroup, LanePopRow } from "./AgentLaneCard.tsx";
import { buildAgentLanePreview, filePreviewLabel, hasMeaningfulText } from "./agent-lane-preview.ts";
import { lanePrimaryLabel, type AgentLane } from "./agent-lanes-model.ts";

/** How many rows a tool-use hover popover lists (top-N) before a "+N more" tally. */
const POPOVER_CAP = 14;

/** A compact tool glyph by family, mirroring the trace idiom (no emoji). */
function toolGlyph(tool: string | undefined): string {
  const k = (tool ?? "").toLowerCase();
  if (/bash|shell|exec|run|command|terminal/.test(k)) return "❯";
  if (/edit|write|apply|patch|create|update|str_replace|multiedit/.test(k)) return "✎";
  if (/read|view|cat|open/.test(k)) return "◎";
  if (/grep|search|glob|find|rg|ripgrep/.test(k)) return "⌕";
  if (/fetch|web|browse|url/.test(k)) return "⤓";
  return "▸";
}

/** A recent tool call → a popover row: a family glyph + a tidied arg (or the
 *  tool name when the arg is control/JSON noise). */
function toolRow(event: ObserveEvent): LanePopRow {
  const raw = event.arg?.trim();
  const looksJson = !!raw && (raw.startsWith("{") || raw.startsWith("["));
  let text: string;
  if (!raw || looksJson || raw === "started" || raw === "completed") {
    text = event.tool ?? "tool";
  } else {
    let arg = tildeShortenPath(raw);
    arg = splitCdPrefix(arg).rest || arg;
    text = laneToolArgSnippet(arg, 56);
  }
  return { mark: toolGlyph(event.tool), tone: "tool", text, full: raw || (event.tool ?? text) };
}

/** Last two path segments — "/example/workstation-user/dev/openscout/packages/web" → "packages/web". */
function formatCwd(path: string): string {
  const parts = path.replace(/\/+$/u, "").split(/[\\/]/u).filter(Boolean);
  return parts.length === 0 ? path : parts.slice(-2).join("/");
}

function shortSession(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const leaf = trimmed.split("/").pop() ?? trimmed;
  return leaf.replace(/\.jsonl$/u, "").slice(0, 8);
}

/** Tidy a raw model id into a readable display name.
 *  "claude-opus-5" → "opus-5", "anthropic/claude-sonnet-4-6" → "sonnet-4.6". */
function formatModelName(model: string | null | undefined): string | null {
  const raw = model?.trim();
  if (!raw) return null;
  let m = raw.replace(/^[a-z0-9.]+\//iu, ""); // drop "anthropic/" etc. provider prefix
  m = m.replace(/^(claude|anthropic)-/iu, ""); // drop the claude vendor prefix
  m = m.replace(/-(\d{8})$/u, ""); // drop a trailing yyyymmdd date stamp
  m = m.replace(/-(\d+)-(\d+)(?=$|-)/gu, "-$1.$2"); // "4-8" → "4.8"
  return m || raw;
}

function fileRowState(state: ObserveFile["state"]): "mod" | "new" | "read" {
  if (state === "created") return "new";
  if (state === "read") return "read";
  return "mod";
}

const TOKEN_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact token count for cockpit readouts — "15403083" → "15.4m". */
function fmtCompactTokens(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return TOKEN_COMPACT.format(value).toLowerCase();
}

/** Strip a leading direction arrow (→/←/↳) so it isn't doubled with the card's
 *  own glyph, and trim surrounding space. */
function cleanHeadline(text: string | null | undefined): string {
  return (text ?? "").replace(/^\s*[←→↳⇒➜]+\s*/u, "").trim();
}

/** The operator's words in an ask. A classified turn (split by its harness's
 *  adapter) gives them directly; an unclassified one falls back to its text,
 *  minus Scout's own notices. */
function askWords(event: ObserveEvent): string {
  if (event.prompt) return event.prompt.words;
  return isHarnessNotice(event.text ?? "") ? "" : event.text ?? "";
}

/** A busy lane with no step for this long stops claiming "Working". */
export const LANE_WORKING_QUIET_MS = 5 * 60_000;

/** An operator prompt as a masthead title: scaffolding (`[Image: …]`,
 *  `[Pasted text #1]`, tagged blocks, file links) stripped, whitespace
 *  folded. Empty when nothing human is left. */
export function taskFromPrompt(text: string | null | undefined): string {
  return cleanHeadline(
    (text ?? "")
      .replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/giu, " ")
      .replace(/\[(?:image|pasted|file|attachment)[^\]]*\]/giu, " ")
      .replace(/\bfile:\/\/\S+/giu, " ")
      .replace(/\s+/gu, " ")
      .replace(/([.!?])\s*…$/u, "$1"),
  );
}

/** True when a headline carries no real content — empty, arrow-only, or a bare
 *  "thinking"/"running tool" placeholder — so the status reads as a calm working
 *  state instead of a stray glyph. */
function isPlaceholderHeadline(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[[\]…]/gu, "").trim();
  return t === "" || t === "thinking" || t === "running tool" || t === "turn update";
}

/**
 * Adapt a live AgentLane (+ its preview) into the clean presentational model
 * the AgentLaneCard header / status box render. The trace is handled separately
 * (the card hosts a SessionObserve timeline slot), so this only covers identity,
 * facts, and the current-state summary.
 */
export function agentLaneToCardModel(
  lane: AgentLane,
  opts: { isLive: boolean; nowMs: number },
): AgentLaneCardModel {
  const { agent, observe, source, facts } = lane;
  const preview = buildAgentLanePreview(observe, agent, { isLive: opts.isLive });
  const session = observe?.metadata?.session;

  const cwdRaw = facts?.cwd ?? agent.cwd ?? agent.projectRoot ?? null;
  const cwd = cwdRaw ? formatCwd(cwdRaw) : null;
  const sessionIdFull = agent.harnessSessionId?.trim() || null;
  const authority = agent.agentClass === "operator"
    ? {
        label: "operator",
        title: [
          agent.role ? `Role: ${agent.role}` : "Privileged operator agent",
          agent.authorityProfile
            ? `Reads: ${agent.authorityProfile.readTools.join(", ") || "none"}`
            : null,
          agent.authorityProfile
            ? `Writes: ${agent.authorityProfile.writeTools.join(", ") || "none"}`
            : null,
          agent.authorityProfile
            ? `Shell: ${agent.authorityProfile.shell ? "allowed" : "blocked"}; code writes: ${agent.authorityProfile.codebaseWrites ? "allowed" : "blocked"}`
            : null,
          agent.runtimePolicy?.sandbox ? `Sandbox: ${agent.runtimePolicy.sandbox}` : null,
        ].filter(Boolean).join(" · "),
      }
    : null;

  // The card no longer lists files inline; instead each tool-use pill reveals its
  // own top-N inventory on hover — tools → recent tool calls, edits → files
  // written, reads → files read, files → everything touched.
  const sourceFiles = facts?.touchedFiles.length ? facts.touchedFiles : preview?.files ?? [];
  const meaningfulFiles = sourceFiles.filter((file) => hasMeaningfulText(filePreviewLabel(file)));
  const fileRow = (file: ObserveFile): LanePopRow => {
    const tone = fileRowState(file.state);
    return { mark: tone, tone, text: filePreviewLabel(file), full: file.path };
  };
  const fileGroup = (files: ObserveFile[]): LanePopGroup => {
    const rows = files.map(fileRow);
    return { rows: rows.slice(0, POPOVER_CAP), more: Math.max(0, rows.length - POPOVER_CAP) };
  };
  const toolEvents = (observe?.events ?? []).filter((event) => event.kind === "tool");
  const toolRows = toolEvents.slice(-POPOVER_CAP).reverse().map(toolRow);
  const pops = {
    tools: { rows: toolRows, more: Math.max(0, toolEvents.length - toolRows.length) },
    edits: fileGroup(meaningfulFiles.filter((file) => file.state !== "read")),
    reads: fileGroup(meaningfulFiles.filter((file) => file.state === "read")),
    files: fileGroup(meaningfulFiles),
  };

  // Cockpit session-context instruments — context-window %, context token count, turn.
  const usage = facts?.usage ?? observe?.metadata?.usage ?? null;
  const contextGauge = deriveContextBudgetGauge(usage, {
    model: facts?.model ?? preview?.model ?? agent.model ?? session?.model ?? null,
    adapterType: agent.harness ?? preview?.harness ?? session?.adapterType ?? null,
  });
  const context = contextGauge ? Math.min(100, contextGauge.pct) : null;
  const tokens = contextGauge?.usedLabel ?? formatContextTokenCount(usage?.contextInputTokens);
  const turns = facts?.turn?.index ?? session?.turnCount ?? null;

  const tokenDials = usage
    ? [
        { label: "in", value: usage.inputTokens },
        { label: "out", value: usage.outputTokens },
        { label: "cache rd", value: usage.cacheReadInputTokens },
        { label: "cache wr", value: usage.cacheCreationInputTokens },
        { label: "total", value: usage.totalTokens },
        { label: "reasoning", value: usage.reasoningOutputTokens },
      ].filter((entry): entry is { label: string; value: number } => typeof entry.value === "number")
    : [];
  const tokenUsage: AgentLaneCardModel["tokenUsage"] = tokenDials.length > 0
    ? {
        total: typeof usage?.totalTokens === "number" ? usage.totalTokens : null,
        dials: tokenDials,
      }
    : null;

  // "Working" has to be true at a glance: a turn flag with no step for a while
  // is a stalled or abandoned turn, and reads as idle with its age beside it.
  const lastActiveMs = lane.lastActiveAt ? normalizeTimestampMs(lane.lastActiveAt) : null;
  const quiet = lastActiveMs !== null && opts.nowMs - lastActiveMs > LANE_WORKING_QUIET_MS;
  const stepInFlight = Boolean(observe?.events.some((event) => event.live));
  const working = isAgentBusy(agent.state ?? null, agent) && (!quiet || stepInFlight);

  // The status line shows the last known step. When the current event carries no
  // real content (empty/arrow-only, or a bare "thinking"), render a calm state
  // rather than a stray `❯ →`.
  const headDir: "to" | "from" | null =
    preview?.headlineFrom === "user" ? "from" : preview?.headlineFrom === "agent" ? "to" : null;
  const headText = cleanHeadline(preview?.headline);
  const headPlaceholder = !preview || isPlaceholderHeadline(headText);
  const head = {
    dir: headPlaceholder ? null : headDir,
    text: headPlaceholder ? (working ? "thinking…" : "idle") : headText,
    full:
      headPlaceholder || !preview || preview.headFull === preview.headline
        ? null
        : cleanHeadline(preview.headFull),
    placeholder: headPlaceholder,
  };

  // Masthead: what the lane is about. The session's current task leads; the
  // last real step stands in when no task is known.
  const lastAsk = [...(observe?.events ?? [])].reverse()
    .map((event) => (event.kind === "ask" ? taskFromPrompt(askWords(event)) : ""))
    .find(Boolean);
  const task = lastAsk
    || (facts?.currentTask && !isHarnessNotice(facts.currentTask) ? taskFromPrompt(facts.currentTask) : "")
    || (!headPlaceholder && !isHarnessNotice(head.full || headText) ? taskFromPrompt(head.full || headText) : "")
    || null;
  const projectName = agent.project?.trim()
    || (cwdRaw ? cwdRaw.replace(/\/+$/u, "").split(/[\\/]/u).filter(Boolean).at(-1) : null)
    || lanePrimaryLabel(agent, source);

  return {
    name: lanePrimaryLabel(agent, source),
    project: projectName,
    task,
    authority,
    harness: agent.harness ?? preview?.harness ?? session?.adapterType ?? null,
    model: formatModelName(facts?.model ?? preview?.model ?? agent.model ?? session?.model ?? null),
    effort: facts?.effort ?? session?.effort ?? null,
    cwd,
    cwdFull: cwdRaw,
    branch: facts?.branch ?? preview?.branch ?? agent.branch ?? null,
    sessionId: shortSession(agent.harnessSessionId),
    sessionIdFull,
    parentSessionId: facts?.parentSessionId ?? null,
    parentSessionLabel: facts?.parentSessionId
      ? [facts.parentAgentName, shortSession(facts.parentSessionId)].filter(Boolean).join(" · ")
      : null,
    time: lane.lastActiveAt ? timeAgoPast(lane.lastActiveAt, opts.nowMs) : null,
    working,
    head,
    stats: {
      tools: preview?.stats.tools ?? 0,
      edits: preview?.stats.edits ?? 0,
      reads: preview?.stats.reads ?? 0,
      files: preview?.stats.files ?? 0,
    },
    context,
    tokens,
    turns,
    tokenUsage,
    pops,
  };
}

/**
 * The same masthead for one observed session with no lane behind it (the
 * host's trace drawer): identity, runtime and task come from the session's own
 * metadata and events. `harness` is the canonical id the caller resolved from
 * the session's adapter.
 */
export function observedSessionToCardModel(
  observe: ObserveData,
  opts: {
    harness: string | null;
    name?: string | null;
    sessionId?: string | null;
    /** The session's own title, shown when no request is in the loaded trace. */
    title?: string | null;
    nowMs: number;
  },
): AgentLaneCardModel {
  const session = observe.metadata?.session;
  const cwdRaw = session?.cwd?.trim() || null;
  const project = (cwdRaw ? cwdRaw.replace(/\/+$/u, "").split(/[\\/]/u).filter(Boolean).at(-1) : null) || "Session";
  const sessionIdFull = opts.sessionId?.trim() || session?.externalSessionId?.trim() || null;
  const events = observe.events;

  const lastWallMs = events.reduce<number | null>((latest, event) => {
    const wall = observeEventWallMs(event, session?.sessionStart);
    return wall !== null && (latest === null || wall > latest) ? wall : latest;
  }, null);
  const stepInFlight = events.some((event) => event.live);
  const working = Boolean(observe.live)
    && (stepInFlight || (lastWallMs !== null && opts.nowMs - lastWallMs <= LANE_WORKING_QUIET_MS));

  const meaningfulFiles = (observe.files ?? []).filter((file) => hasMeaningfulText(filePreviewLabel(file)));
  const fileGroup = (files: ObserveFile[]): LanePopGroup => {
    const rows = files.map((file): LanePopRow => {
      const tone = fileRowState(file.state);
      return { mark: tone, tone, text: filePreviewLabel(file), full: file.path };
    });
    return { rows: rows.slice(0, POPOVER_CAP), more: Math.max(0, rows.length - POPOVER_CAP) };
  };
  const toolEvents = events.filter((event) => event.kind === "tool");
  const toolRows = toolEvents.slice(-POPOVER_CAP).reverse().map(toolRow);
  const counts = countObserveTrace(events);

  const usage = observe.metadata?.usage ?? null;
  const contextGauge = deriveContextBudgetGauge(usage, {
    model: session?.model ?? null,
    adapterType: opts.harness ?? session?.adapterType ?? null,
  });

  const task = [...events].reverse()
    .map((event) => (event.kind === "ask" ? taskFromPrompt(askWords(event)) : ""))
    .find(Boolean) || taskFromPrompt(opts.title) || null;

  return {
    name: opts.name?.trim() || project,
    project,
    task,
    authority: null,
    harness: opts.harness,
    model: formatModelName(session?.model ?? null),
    effort: session?.effort ?? null,
    cwd: cwdRaw ? formatCwd(cwdRaw) : null,
    cwdFull: cwdRaw,
    branch: session?.gitBranch?.trim() || null,
    sessionId: shortSession(sessionIdFull),
    sessionIdFull,
    time: lastWallMs !== null ? timeAgoPast(lastWallMs, opts.nowMs) : null,
    working,
    head: null,
    stats: {
      tools: counts.tools,
      edits: counts.edits,
      reads: counts.reads,
      files: meaningfulFiles.length,
    },
    context: contextGauge ? Math.min(100, contextGauge.pct) : null,
    tokens: contextGauge?.usedLabel ?? formatContextTokenCount(usage?.contextInputTokens),
    turns: session?.turnCount ?? null,
    tokenUsage: null,
    pops: {
      tools: { rows: toolRows, more: Math.max(0, toolEvents.length - toolRows.length) },
      edits: fileGroup(meaningfulFiles.filter((file) => file.state !== "read")),
      reads: fileGroup(meaningfulFiles.filter((file) => file.state === "read")),
      files: fileGroup(meaningfulFiles),
    },
  };
}
