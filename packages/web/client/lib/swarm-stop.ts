/*
 * An ask the lane answered by stopping. Lanes say so in their first words:
 * "Blocked before implementation: …", "Blocked by the file boundary: …",
 * "Stopped at the brief's boundary: …", "Stopped as instructed.",
 * "HOLD: the cold placement audit failed." Or they first
 * say what they delivered and then stop in a bold status line: "Draft #87,
 * stacked on #86." then "**Blocked at transport qualification. …**", or a
 * line that opens in bold and gives its reason after: "Draft #113, head
 * `a16c930a`." then "**HOLD:** full Darwin qualification fails …". The
 * runtime records such an ask as done, because the lane replied, so the board
 * reads the lane's own words instead of guessing from later lines. A stop
 * holds until the lane is asked again. Pure and React-free, like swarm-model.ts.
 */

import type { SwarmAsk } from "./swarm-model.ts";

/**
 * A stop word counts only with where or why the lane stopped ("Stopped under
 * Fable's cost gate."): "Stopped the watcher" is work done, "Blocked paths: …"
 * names a test's fixtures, and "Hold times fell" is a measurement.
 */
const STOP = /^(?:blocked|blocker|stopped|(?:on\s+)?hold)(?=$|[.:;,!—–]|\s+[—–-]\s|\s+(?:at|as|before|by|on|short|here|pending|until|because|for|after|when|while|without|under|per)\b)/iu;

/** A stop word the lane wrote in capitals, at the start of its words. */
const SHOUTED_STOP = /^(?:ON\s+HOLD|HOLD|BLOCKED|BLOCKER|STOPPED)\b/u;

/** A line wholly in bold, list mark allowed: the lane's own status line. */
const BOLD_LINE = /^\s*(?:[-*+]\s+)?\*\*([^*]+?)\*\*\s*$/u;

/** The list mark before a line that opens in bold: "**HOLD:** the audit failed." */
const BOLD_LEAD = /^\s*(?:[-*+]\s+)?(?=\*\*[^*]+?\*\*)/u;

/** How far down the reply a status line can stand: under what the lane delivered first. */
const STATUS_LINES = 4;

/** A stop in capitals reads calmly in a quote: "HOLD: the audit failed." reads "Hold: the audit failed." */
export function calmStop(words: string): string {
  return words.replace(SHOUTED_STOP, (word) => word.charAt(0) + word.slice(1).toLowerCase());
}

/** Whether a reply's opening sentence says the lane stopped. */
export function headlineStops(headline: string | null | undefined): boolean {
  return headline ? STOP.test(headline.trimStart()) : false;
}

/** The bold status line in which the lane says it stopped, among the reply's first lines, without its bold marks. */
export function statusStopLine(reply: string | null | undefined): string | null {
  for (const line of (reply ?? "").split("\n").filter((text) => text.trim()).slice(0, STATUS_LINES)) {
    const status = line.match(BOLD_LINE)?.[1]?.trim() ?? boldLead(line);
    if (status && headlineStops(status)) return status;
  }
  return null;
}

/** A line that opens in bold, read whole without its marks: "**HOLD:** the audit failed." reads "HOLD: the audit failed." */
function boldLead(line: string): string | null {
  const mark = line.match(BOLD_LEAD);
  return mark ? line.slice(mark[0].length).replaceAll("**", "").trim() : null;
}

type StopRead = Pick<SwarmAsk, "state" | "replyHeadline"> & { reply?: string | null };

/** Whether the lane answered this ask by stopping. A failed or cancelled ask keeps that state. */
export function askStops(ask: StopRead): boolean {
  return ask.state === "done" && (headlineStops(ask.replyHeadline) || statusStopLine(ask.reply) !== null);
}

/** Whether the reply opens with its stop, so the lane delivered nothing it names. */
export function opensWithStop(ask: Pick<SwarmAsk, "state" | "replyHeadline">): boolean {
  return ask.state === "done" && headlineStops(ask.replyHeadline);
}
