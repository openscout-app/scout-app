import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { filesFromObserveEvents } from "../../lib/lane-observe.ts";
import { shellCommandFromArg } from "../../lib/code-mode-command.ts";

export type ObservedSessionTurn = {
  id: string;
  /** "prompt": opened by the operator's words; "turn": a harness turn whose prompt is not in the
   * trace; "window": what the trace holds from before its first turn or prompt. */
  boundary: "prompt" | "turn" | "window";
  /** The harness turn id its events carry, when they carry one. */
  turnId?: string;
  prompt: ObserveEvent[];
  steps: ObserveEvent[];
  messages: ObserveEvent[];
  /** Steps and messages in the order they happened, without the prompt. */
  work: ObserveEvent[];
  start: number;
  end: number;
  working: boolean;
  fileCount: number;
};
/**
 * Whether a session is in a turn. When its agent holds this session, the
 * agent's own state says. Otherwise a live source says. A recorded trace
 * cannot: a session that ended mid-turn or mid-call leaves that turn open in
 * its transcript for good, so an open turn or call counts only while the board
 * still has the session working.
 */
export function observedSessionWorking({ agentTurn, data, source, rowWorking }: {
  /** The agent's own state, when the agent holds this session; null otherwise. */
  agentTurn: boolean | null;
  data: Pick<ObserveData, "live" | "events"> | null | undefined;
  /** Where the trace came from. Only a live source reports a turn as it runs. */
  source?: string | null;
  /** The board row's state, when the board has the session. */
  rowWorking?: boolean;
}): boolean {
  if (agentTurn !== null) return agentTurn;
  if (!data) return Boolean(rowWorking);
  if (data.live && source === "live") return true;
  // Discovery can know a turn is active before the history reader marks an
  // event live. Use the board's bounded activity evidence in both surfaces.
  if (rowWorking !== undefined) return rowWorking;
  return Boolean(data.live || data.events.some((event) => event.live));
}

/** Observed user requests delimit turns. Never invent broker turn ids or import
 * harness text into Scout records. An incomplete leading window stays labelled
 * as observed context; synthetic timestamps must not be advertised as duration. */
export function observedSessionTurns(data: ObserveData, working: boolean): ObservedSessionTurn[] {
  const turns: ObservedSessionTurn[] = [];
  let current: ObservedSessionTurn | null = null;
  for (const event of data.events) {
    const isPrompt = event.kind === "ask" && !event.to;
    // The transcript's own turn ids split turns too, so a turn whose prompt the trace lacks
    // still ends where its harness ended it.
    const nextTurn = !isPrompt && current?.turnId != null && event.turn != null && event.turn !== current.turnId;
    if (!current || isPrompt || nextTurn) {
      current = { id: event.id, boundary: isPrompt ? "prompt" : event.turn ? "turn" : "window", prompt: [], steps: [], messages: [], work: [], start: event.t, end: event.t, working: false, fileCount: 0 };
      turns.push(current);
    }
    if (event.turn && current.turnId == null) current.turnId = event.turn;
    current.end = Math.max(current.end, event.t);
    if (isPrompt) current.prompt.push(event);
    else if (event.kind === "message" || event.kind === "ask") current.messages.push(event);
    else current.steps.push(event);
    if (!isPrompt) current.work.push(event);
  }
  for (const turn of turns) {
    // Generic shell/agent arguments can contain prose that resembles a path.
    // Count only the Observe inventory or explicit file-tool/diff evidence.
    const fileSteps = turn.steps.filter((event) => event.diff || /^(read|edit|write|read_file|edit_file|write_file)$/iu.test(event.tool ?? ""));
    turn.fileCount = new Set([
      ...filesFromObserveEvents(fileSteps).map((file) => file.path),
      ...data.files.filter((file) => file.lastT >= turn.start && file.lastT <= turn.end).map((file) => file.path),
    ]).size;
    turn.working = working && turn === turns.at(-1);
  }
  return turns;
}
/**
 * A turn's trace and its answer. The last messages the agent wrote are the
 * answer and stay in the conversation; the narration before them is the
 * trace's spine. A turn cut off mid-call ends on that call, not on words: its
 * answer is still the last thing the agent said, and the calls after it stay
 * in the trace. A turn still running has no answer yet.
 */
export function splitObservedTurn(turn: Pick<ObservedSessionTurn, "work" | "working">): { trace: ObserveEvent[]; answer: ObserveEvent[] } {
  if (turn.working) return { trace: turn.work, answer: [] };
  const said = (event: ObserveEvent) => event.kind === "message" || event.kind === "ask";
  let end = turn.work.length;
  while (end > 0 && !said(turn.work[end - 1]!)) end -= 1;
  let start = end;
  while (start > 0 && said(turn.work[start - 1]!)) start -= 1;
  return { trace: [...turn.work.slice(0, start), ...turn.work.slice(end)], answer: turn.work.slice(start, end) };
}
/** How long a turn may write nothing before the thread stops calling it Working. */
export const QUIET_AFTER_MS = 10 * 60_000;

/**
 * When a session that is said to be in a turn last wrote anything, if that is
 * longer ago than QUIET_AFTER_MS; otherwise null. A turn that stalls (its
 * harness died mid-turn, or the runtime never heard it end) would otherwise
 * read as Working for good. The time is observed, so the thread can say it.
 */
export function quietSince(events: readonly Pick<ObserveEvent, "at">[], working: boolean, now: number): number | null {
  if (!working) return null;
  let last = -Infinity;
  for (const event of events) if (event.at != null && event.at > last) last = event.at;
  return Number.isFinite(last) && now - last > QUIET_AFTER_MS ? last : null;
}

export function observedStepCount(turn: ObservedSessionTurn): number {
  return turn.steps.filter((event) => event.kind === "tool" && event.tool !== "res" || event.kind === "think").length;
}
export function observedTurnDuration(turn: ObservedSessionTurn): string {
  const seconds = Math.max(0, Math.round(turn.end - turn.start));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Activity wording mirrors the Codex thread, without inventing tool results. */
export function sessionWorkLabel(event: ObserveEvent): string {
  const tool = (event.tool ?? "").toLowerCase();
  const arg = event.arg || event.text;
  if (event.kind === "think") return event.live ? "Thinking" : "Thought";
  if (event.kind !== "tool") return event.text;
  if (tool === "res") return "Output";
  if (/^(read|read_file|view_image)$/u.test(tool)) return `Read ${arg}`;
  if (/^(edit|write|edit_file|write_file|apply_patch|multiedit)$/u.test(tool)) return `Edited ${arg}`;
  if (/^(search|grep|glob|rg|web_search|web|find|web\.run)$/u.test(tool)) return `Searched ${arg}`;
  if (/^(bash|shell|exec_command|run|terminal|command)$/u.test(tool)) return `Ran ${shellCommandFromArg(arg)}`;
  return `${event.tool || "Tool"} ${arg}`;
}

/** Counts only explicit per-file diff evidence. Multi-file aggregate patches
 * cannot be attributed to one file; missing counts stay missing, not zero. */
export function observedFileEdits(events: ObserveEvent[]): Map<string, { add: number; del: number }> {
  const counts = new Map<string, { add: number; del: number }>();
  for (const event of events) {
    if (!event.diff) continue;
    const files = filesFromObserveEvents([event]);
    if (files.length !== 1) continue;
    const path = files[0]!.path, previous = counts.get(path) ?? { add: 0, del: 0 };
    counts.set(path, { add: previous.add + event.diff.add, del: previous.del + event.diff.del });
  }
  return counts;
}
