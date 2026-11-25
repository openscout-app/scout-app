/*
 * Words the swarm's views share: times, an ask's state, an agent's runtime,
 * tile letters. Kept out of SwarmSurface.tsx so the canvas, the picker and
 * the panels read them without importing the page.
 */

import { harnessLabel } from "../../components/HarnessMark.tsx";
import { boardCandidates } from "../../components/ProjectMark.tsx";
import { spanWords, type SwarmAgent, type SwarmAsk } from "../../lib/swarm-model.ts";
import { askStops } from "../../lib/swarm-stop.ts";

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export const clock = (at: number) => clockFormat.format(at);

/** A day: "Oct 17". */
export const dayLabel = (at: number) => dateFormat.format(at);

/** A moment, with its day when that is not today: "16:23", "yesterday 16:23", "Oct 17 16:23". */
export function stampWithDay(at: number, now: number): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return clock(at);
  if (day(at) === day(now - 86_400_000)) return `yesterday ${clock(at)}`;
  return `${dateFormat.format(at)} ${clock(at)}`;
}

/** A time today, else the day: "09:12", "Oct 17". */
export function shortStamp(at: number, now: number): string {
  return new Date(at).toDateString() === new Date(now).toDateString() ? clock(at) : dateFormat.format(at);
}

export function letters(name: string): string {
  return boardCandidates(name)[0] ?? "?";
}

/** An ask's state as drawn: a working ask whose session went silent reads as silent. */
export function askTone(ask: SwarmAsk): SwarmAsk["state"] | "silent" {
  return ask.silence ? "silent" : ask.state;
}

/** One sentence for an ask's state, with how long it took or has taken. */
export function askSentence(ask: SwarmAsk, now: number): string {
  const since = ask.startedAt ?? ask.askedAt;
  if (ask.silence) {
    return ask.silence.finished
      ? `Finished ${spanWords(now - ask.silence.since)} ago; the reply has not reached the runtime`
      : `Silent for ${spanWords(now - ask.silence.since)}`;
  }
  switch (ask.state) {
    case "working":
      return `Working for ${spanWords(now - since)}`;
    case "queued":
      return `Queued for ${spanWords(now - ask.askedAt)}`;
    case "waiting":
      return `Waiting for ${spanWords(now - since)}`;
    case "review":
      return `Replied after ${spanWords((ask.endedAt ?? now) - ask.askedAt)}; review requested`;
    case "failed":
      return `Failed after ${spanWords((ask.endedAt ?? now) - ask.askedAt)}${ask.failure ? `: ${ask.failure}` : ""}`;
    case "cancelled":
      return `Cancelled after ${spanWords((ask.endedAt ?? now) - ask.askedAt)}`;
    case "done":
      return `${askStops(ask) ? "Stopped" : "Replied"} after ${spanWords((ask.endedAt ?? now) - ask.askedAt)}`;
    default:
      return "State unknown";
  }
}

export function runtimePhrase(who: Pick<SwarmAgent, "harness" | "model" | "effort">): string | null {
  if (!who.harness && !who.model) return null;
  const harness = who.harness ? harnessLabel(who.harness) : "Unknown harness";
  const model = who.model ? ` on ${who.model}` : "";
  const effort = who.effort ? `, ${who.effort} effort` : "";
  return `${harness}${model}${effort}`;
}

/** When an initiative ran: "Since 09:12", "Today, 09:12 to 11:40", "Yesterday 16:23 to today 09:12", "Oct 17 to Oct 19". */
export function whenWords(start: number, last: number, open: boolean, now: number): string {
  const day = (at: number) => new Date(at).toDateString();
  const today = day(now);
  const yesterday = day(now - 86_400_000);
  const stamp = (at: number) => (day(at) === today ? `today ${clock(at)}` : day(at) === yesterday ? `yesterday ${clock(at)}` : dateFormat.format(at));
  let words: string;
  if (open) words = `Since ${day(start) === today ? clock(start) : stamp(start)}`;
  else if (day(start) === day(last)) {
    const on = day(last) === today ? "Today" : day(last) === yesterday ? "Yesterday" : dateFormat.format(last);
    words = `${on}, ${clock(start)} to ${clock(last)}`;
  } else words = `${stamp(start)} to ${stamp(last)}`;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
