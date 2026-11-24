import type { ObserveEvent } from "./types.ts";

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isOutputRow(event: Pick<ObserveEvent, "kind" | "tool">): boolean {
  return event.kind === "tool" && normalized(event.tool).toLowerCase() === "res";
}

/** The other half of a serialized visible call/result. Observe has no call
 *  correlation id, so concurrent outstanding calls form an unknown group:
 *  no result in that group is attributed until all of them have completed.
 *  Inline-output calls are not waiting for a separate row. */
export function laneToolPartner(
  events: readonly ObserveEvent[],
  eventId: string,
): { call?: ObserveEvent; output?: ObserveEvent } {
  let outstanding = 0;
  let pending: ObserveEvent | undefined;
  let ambiguous = false;
  for (const event of events) {
    if (event.kind !== "tool") continue;
    if (isOutputRow(event)) {
      if (outstanding === 1 && pending && !ambiguous) {
        if (pending.id === eventId) return { output: event };
        if (event.id === eventId) return { call: pending };
      }
      if (event.id === eventId) return {};
      outstanding = Math.max(0, outstanding - 1);
      if (outstanding === 0) { pending = undefined; ambiguous = false; }
      continue;
    }
    // Another call is a barrier even if it already carries inline output.
    if (outstanding > 0) ambiguous = true;
    if ((event.stream?.length ?? 0) > 0) continue;
    outstanding += 1;
    pending = event;
  }
  return {};
}

/** An output row's text: its stream, else the preview the tail kept as its arg. */
export function laneToolOutputText(event: Pick<ObserveEvent, "stream" | "arg">): string {
  const stream = event.stream?.join("\n").trim();
  return stream || normalized(event.arg);
}
