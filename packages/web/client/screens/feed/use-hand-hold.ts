/**
 * The operator's hand is on the stream: the pointer is over it (mouse or pen,
 * not a touch that ended), or a field in it has focus. While held, a refresh
 * waits. The hold lets go a moment after the hand leaves, so a pass across the
 * stream on the way elsewhere does not apply a refresh under a returning hand.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from "react";

const RELEASE_MS = 450;

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function useHandHold(): {
  held: boolean;
  bind: {
    onPointerEnter: (event: PointerEvent) => void;
    onPointerLeave: (event: PointerEvent) => void;
    onFocus: (event: FocusEvent) => void;
    onBlur: (event: FocusEvent) => void;
  };
} {
  const [held, setHeld] = useState(false);
  const hands = useRef({ pointer: false, field: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (hands.current.pointer || hands.current.field) { setHeld(true); return; }
    timer.current = setTimeout(() => { timer.current = null; setHeld(false); }, RELEASE_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const bind = useMemo(() => ({
    onPointerEnter: (event: PointerEvent) => { if (event.pointerType === "touch") return; hands.current.pointer = true; update(); },
    onPointerLeave: (event: PointerEvent) => { if (event.pointerType === "touch") return; hands.current.pointer = false; update(); },
    onFocus: (event: FocusEvent) => { if (!editable(event.target)) return; hands.current.field = true; update(); },
    onBlur: (event: FocusEvent) => { if (!editable(event.target)) return; hands.current.field = false; update(); },
  }), [update]);
  return { held, bind };
}
