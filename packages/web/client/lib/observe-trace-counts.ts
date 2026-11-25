import { observeToolIsEdit, observeToolIsRead, observeToolName } from "./tail-display.ts";

/** The trace's counts, as the lane cards, the Lane panel and the session rail
 *  print them. One reading, so the three never disagree. */
export type ObserveTraceCounts = {
  /** Tool calls. An output row (`res:` in the tail) belongs to a call and is not one. */
  tools: number;
  /** Output rows the tail wrote apart from their call. */
  results: number;
  reads: number;
  /** Edits and writes, plus any call that carries a diff. */
  edits: number;
  /** Reasoning blocks, including the bare `[thinking]` marker the tail writes when the text is withheld. */
  thinks: number;
  /** Requests from the operator. */
  requests: number;
};

type CountableEvent = {
  kind: string;
  tool?: string;
  text?: string;
  diff?: unknown;
};

/** A `res:` tail row: the output of a call, written on a line of its own. */
export function observeToolIsResult(tool: string | undefined): boolean {
  return observeToolName(tool) === "res";
}

/** The label a person reads for a tool row: an output row says "output", not "res". */
export function observeToolLabel(tool: string | undefined): string | undefined {
  return observeToolIsResult(tool) ? "output" : tool;
}

function isThinking(event: CountableEvent): boolean {
  if (event.kind === "think") return true;
  if (event.kind !== "message") return false;
  return /^\s*\[thinking\](?:\s|$)/iu.test(event.text ?? "");
}

export function countObserveTrace(events: readonly CountableEvent[]): ObserveTraceCounts {
  const counts: ObserveTraceCounts = { tools: 0, results: 0, reads: 0, edits: 0, thinks: 0, requests: 0 };
  for (const event of events) {
    if (isThinking(event)) {
      counts.thinks += 1;
      continue;
    }
    if (event.kind === "ask") {
      counts.requests += 1;
      continue;
    }
    if (event.kind !== "tool") continue;
    if (observeToolIsResult(event.tool)) {
      counts.results += 1;
      continue;
    }
    counts.tools += 1;
    if (observeToolIsRead(event.tool)) counts.reads += 1;
    if (observeToolIsEdit(event.tool) || Boolean(event.diff)) counts.edits += 1;
  }
  return counts;
}
