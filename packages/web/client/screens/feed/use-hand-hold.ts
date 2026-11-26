/**
 * The operator's hand is on the stream: the pointer is over it (mouse or pen,
 * not a touch that ended), or a field in it has focus. While held, a refresh
 * waits. The hold lets go a moment after the hand leaves, so a pass across the
 * stream on the way elsewhere does not apply a refresh under a returning hand.
 *
 * A hand that rests is not reaching for anything: after a while without a
 * move, a scroll or a key, the hold lets go and what waited applies. The next
 * move holds again.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from "react";

const RELEASE_MS = 450;
const STILL_MS = 10_000;

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function useHandHold(): {
  held: boolean;
  bind: {
    onPointerEnter: (event: PointerEvent) => void;
    onPointerLeave: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onWheel: () => void;
    onKeyDown: () => void;
    onFocus: (event: FocusEvent) => void;
    onBlur: (event: FocusEvent) => void;
  };
} {
  const [held, setHeld] = useState(false);
  const hands = useRef({ pointer: false, field: false });
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  const still = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (timer: { current: ReturnType<typeof setTimeout> | null }) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  // The hand moved: hold, and let go again if it then rests.
  const active = useCallback(() => {
    if (!hands.current.pointer && !hands.current.field) return;
    clear(release);
    setHeld(true);
    clear(still);
    still.current = setTimeout(() => { still.current = null; setHeld(false); }, STILL_MS);
  }, []);
  const update = useCallback(() => {
    if (hands.current.pointer || hands.current.field) { active(); return; }
    clear(still);
    clear(release);
    release.current = setTimeout(() => { release.current = null; setHeld(false); }, RELEASE_MS);
  }, [active]);
  useEffect(() => () => { clear(release); clear(still); }, []);
  const bind = useMemo(() => ({
    onPointerEnter: (event: PointerEvent) => { if (event.pointerType === "touch") return; hands.current.pointer = true; update(); },
    onPointerLeave: (event: PointerEvent) => { if (event.pointerType === "touch") return; hands.current.pointer = false; update(); },
    onPointerMove: (event: PointerEvent) => { if (event.pointerType !== "touch") active(); },
    onWheel: active,
    onKeyDown: active,
    onFocus: (event: FocusEvent) => { if (!editable(event.target)) return; hands.current.field = true; update(); },
    onBlur: (event: FocusEvent) => { if (!editable(event.target)) return; hands.current.field = false; update(); },
  }), [update, active]);
  return { held, bind };
}
