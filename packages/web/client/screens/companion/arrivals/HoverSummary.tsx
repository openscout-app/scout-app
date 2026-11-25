import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { figureLabelText, type FigureLabel } from "./figure-labels.ts";
import { HOVER_REST_MS, hoverSpot, hoverSummary } from "./hover-summary-model.ts";

/*
 * The hover summary (hover-summary-model.ts) and the rest that shows it. The
 * desk and the board each keep one: the pointer rests on an agent (the DOM's
 * hover in the browser, the host's report of the region in the companion)
 * for HOVER_REST_MS, and its summary shows until the pointer leaves. A
 * press, a drag or an open panel puts it away; it comes back only when the
 * pointer rests on an agent anew.
 */

export type HoverRest = {
  /** The agent the pointer rests on and the element it rests on, once it has rested. */
  shown: { id: string; el: HTMLElement } | null;
  /** The pointer came onto this agent; the same agent on the same element again changes nothing. */
  enter: (id: string, el: HTMLElement | null) => void;
  /** The pointer left this agent (or, with no id, whichever it was on). */
  leave: (id?: string) => void;
  /** A press on it: put the summary away until the pointer comes back. */
  press: () => void;
};

export function useHoverRest(blocked: boolean): HoverRest {
  const [shown, setShown] = useState<{ id: string; el: HTMLElement } | null>(null);
  const on = useRef<{ id: string; el: HTMLElement } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(blocked);
  held.current = blocked;
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const enter = useCallback((id: string, el: HTMLElement | null) => {
    // A row re-drawn under a still pointer is a new element: rest on it anew.
    if (!el || (on.current?.id === id && on.current.el === el && el.isConnected)) return;
    on.current = { id, el };
    stop();
    setShown(null);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      if (!held.current && el.isConnected) setShown({ id, el });
    }, HOVER_REST_MS);
  }, []);
  const leave = useCallback((id?: string) => {
    if (id !== undefined && on.current?.id !== id) return;
    on.current = null;
    stop();
    setShown(null);
  }, []);
  const press = useCallback(() => {
    stop();
    setShown(null);
  }, []);
  useEffect(() => {
    if (!blocked) return;
    stop();
    setShown(null);
  }, [blocked]);
  useEffect(() => stop, []);
  return { shown: blocked || !shown?.el.isConnected ? null : shown, enter, leave, press };
}

/**
 * One agent's summary, in two lines at most: who, where, its state and since
 * when; then its open ask, or its latest line. Fixed in the view, beside the
 * board for a row or a chip (under a top notch, over a bottom one), above (or
 * below) a figure or a strip. It takes no pointer.
 */
export function HoverSummary({ t, anchor, beside = null, hangFrom = null, now, label, name }: { t: CornerThread; anchor: HTMLElement; beside?: HTMLElement | null; hangFrom?: "top" | "bottom" | null; now: number; /** Its roster label (figure-labels.ts). */ label?: FigureLabel; /** The name its board row wears, when the namer gave one. */ name?: string | null }) {
  const v = hoverSummary(t, now, name);
  const second = v.ask ? <><b>{v.ask.verb}</b> {v.ask.subject}</> : v.line;
  return (
    <HoverCard anchor={anchor} beside={beside} hangFrom={hangFrom}>
      <p className="arv-hover__head">
        {label && <span className="arv-hover__tag">{figureLabelText(label)}</span>}
        <span className="arv-hover__name">{v.name}</span>
        {v.where && <span className="arv-hover__where">{v.where}</span>}
        <span className={`arv-hover__st${v.asking ? " is-asking" : ""}`}>{v.state.toLowerCase()}{v.since && <i> · {v.since}</i>}</span>
      </p>
      {second && <p className="arv-hover__line">{second}</p>}
    </HoverCard>
  );
}

/** Place a non-interactive hover card outside the board's clipping area. */
export function HoverCard({ anchor, beside = null, hangFrom = null, className, children }: {
  anchor: HTMLElement;
  beside?: HTMLElement | null;
  /** The edge the board hangs from, on a top or bottom notch: the card goes under (or over) it, not beside. */
  hangFrom?: "top" | "bottom" | null;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  // Placed before it paints, then kept in place each frame while it shows: the board grows, folds and
  // changes size, and rows move under a still pointer.
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const el = ref.current;
      if (el && anchor.isConnected) {
        const next = hoverSpot(anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, beside?.getBoundingClientRect() ?? null, hangFrom);
        setSpot((s) => (s && s.left === next.left && s.top === next.top ? s : next));
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [anchor, beside, hangFrom]);
  return (
    <div ref={ref} className={className ? `arv-hover ${className}` : "arv-hover"} role="tooltip" style={spot ?? { left: 0, top: 0, visibility: "hidden" }}>
      {children}
    </div>
  );
}
