import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { filesFromObserveEvents } from "../../lib/lane-observe.ts";

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
