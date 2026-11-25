import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
// Content portalled here can use the shell rail's own toolbar, tabs and rows.
import "../../scout/slots/ctx-panel.css";
import "../../scout/slots/rail-row.css";

/*
 * Rooms portals channel-family navigation into the shell's side rail and keeps
 * its room list beside the conversation. Hosted Chat uses the same slot for its
 * own room list. With no spot, each surface keeps its navigation inline.
 */

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

function publish(next: HTMLElement | null) {
  if (slot === next) return;
  slot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The side rail's slot for the host's Rooms navigation, or null when absent. */
export function useRoomsRailSlot(enabled: boolean): HTMLElement | null {
  const current = useSyncExternalStore(subscribe, () => slot, () => null);
  return enabled ? current : null;
}

/** Marks the spot in the side rail. Rendered by the side rail for /rooms. */
export function RoomsRail() {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    publish(element);
    // A later rail may already have taken over; only clear our own spot.
    return () => {
      if (slot === element) publish(null);
    };
  }, []);
  return <div ref={ref} className="chat-rail-slot" />;
}
