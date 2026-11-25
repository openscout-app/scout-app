import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";

/*
 * The page band: one row under the shell's top row, spanning the side rail
 * and the page together, for a control that governs both. Rooms puts its
 * space tabs here, since a space scopes the list in the rail and the room
 * beside it alike.
 *
 * A page asks for the band with `usePageBand(true)` and portals into the
 * element it gets back. While anyone asks, the shell draws the band and
 * starts the rail, the page and the inspector below it; when nobody asks,
 * there is no band and nothing moves.
 */

export const PAGE_BAND_HEIGHT = 36;

let slot: HTMLElement | null = null;
let requests = 0;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** Whether any page wants the band. Read by the shell. */
export function usePageBandRequested(): boolean {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return requests > 0;
}

/** Ask for the band while `active`; returns the element to portal into once the shell has drawn it. */
export function usePageBand(active: boolean): HTMLElement | null {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  useEffect(() => {
    if (!active) return;
    requests += 1;
    emit();
    return () => {
      requests -= 1;
      emit();
    };
  }, [active]);
  return active ? slot : null;
}

/** The band itself, drawn by the shell where the band goes. */
export function PageBand({ style }: { style: CSSProperties }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    slot = element;
    emit();
    return () => {
      if (slot === element) {
        slot = null;
        emit();
      }
    };
  }, []);
  return <div ref={ref} className="scout-page-band" data-scout-page-band="" style={style} />;
}
