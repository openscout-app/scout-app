import { useLayoutEffect, useRef, useSyncExternalStore, type ReactElement } from "react";

/*
 * Spots in a frame's top row that the rooms surface fills itself.
 *
 * Hosted Chat draws the Scout frame around Rooms with no local runtime behind
 * it, so nothing in the frame knows how to search the rooms or who is signed
 * in. The surface does: it portals its jump field into the search spot and its
 * account menu (with Preferences) into the identity spot. The local shell
 * marks neither, because its own top row carries search and the operator.
 */

type Slot = {
  use: (enabled: boolean) => HTMLElement | null;
  Mark: (props: { className?: string }) => ReactElement;
};

function createSlot(): Slot {
  let slot: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: HTMLElement | null) => {
    if (slot === next) return;
    slot = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  function use(enabled: boolean): HTMLElement | null {
    const current = useSyncExternalStore(subscribe, () => slot, () => null);
    return enabled ? current : null;
  }
  function Mark({ className }: { className?: string }) {
    const ref = useRef<HTMLSpanElement | null>(null);
    useLayoutEffect(() => {
      const element = ref.current;
      if (!element) return;
      publish(element);
      return () => {
        if (slot === element) publish(null);
      };
    }, []);
    return <span ref={ref} className={className} />;
  }
  return { use, Mark };
}

const search = createSlot();
const identity = createSlot();

/** The frame's spot for the rooms jump field, or null when there is none. */
export const useTopRowSearchSlot = search.use;
/** The frame's spot for the account menu, or null when there is none. */
export const useTopRowIdentitySlot = identity.use;
/** Marks the search spot. Rendered by a frame that has no search of its own. */
export const TopRowSearchSlot = search.Mark;
/** Marks the identity spot. Rendered by a frame that has no operator of its own. */
export const TopRowIdentitySlot = identity.Mark;
