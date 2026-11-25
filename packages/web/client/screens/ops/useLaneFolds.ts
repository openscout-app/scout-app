import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FoldHolds } from "../../components/hud-grid/hud-grid-fold.ts";
import {
  laneFold,
  laneFoldContent,
  noteLanesSeen,
  readLaneFolds,
  toggleLaneFold,
  writeLaneFolds,
  type LaneFold,
} from "./agent-lane-fold.ts";
import type { AgentLane } from "./agent-lanes-model.ts";

function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The deck's lane folds (agent-lane-fold.ts): which lanes draw folded, and the
 * operator's hand folds, saved per lane for this deck. `signature` changes when
 * a lane folds or opens, for useFoldScrollAnchor.
 */
export function useLaneFolds(profileId: string, lanes: readonly AgentLane[], nowMs: number, windowMs: number) {
  const [holds, setHolds] = useState<FoldHolds>(() => readLaneFolds(localStore(), profileId));
  const seenProfile = useRef(profileId);
  useEffect(() => {
    if (seenProfile.current === profileId) return;
    seenProfile.current = profileId;
    setHolds(readLaneFolds(localStore(), profileId));
  }, [profileId]);
  const save = useCallback(
    (next: FoldHolds) => {
      setHolds(next);
      writeLaneFolds(localStore(), profileId, next);
    },
    [profileId],
  );
  const contents = useMemo(
    () => new Map(lanes.map((lane) => [lane.id, laneFoldContent(lane, nowMs, windowMs)] as const)),
    [lanes, nowMs, windowMs],
  );
  useEffect(() => {
    const next = noteLanesSeen(holds, contents);
    if (next !== holds) save(next);
  }, [contents, holds, save]);
  const folds = useMemo(() => {
    const out = new Map<string, LaneFold>();
    for (const lane of lanes) out.set(lane.id, laneFold(contents.get(lane.id), holds, lane.id));
    return out;
  }, [contents, holds, lanes]);
  const toggle = useCallback((laneId: string) => save(toggleLaneFold(holds, laneId, contents.get(laneId))), [contents, holds, save]);
  const signature = lanes.map((lane) => (folds.get(lane.id)?.folded ? "1" : "0")).join("");
  return { folds, toggle, signature };
}

type Anchor = { id: string; left: number; top: number };

/**
 * A lane folding or opening resizes the lanes before the ones in view, and
 * would move them. Keep the first lane in view where it was: after each
 * render note it, and when the folds change put it back. Nothing takes focus.
 */
export function useFoldScrollAnchor(root: RefObject<HTMLElement | null>, signature: string) {
  const anchors = useRef(new Map<HTMLElement, Anchor>());
  const capture = useCallback(() => {
    const el = root.current;
    const next = new Map<HTMLElement, Anchor>();
    if (el) {
      for (const scroller of el.querySelectorAll<HTMLElement>(".s-agent-lanes-scroll, .s-agent-lanes-grid")) {
        // unscrolled: anything that moves is past the start, nothing to hold
        if (scroller.scrollLeft === 0 && scroller.scrollTop === 0) continue;
        const box = scroller.getBoundingClientRect();
        for (const lane of scroller.querySelectorAll<HTMLElement>("[data-lane-id]")) {
          const r = lane.getBoundingClientRect();
          if (r.right > box.left + 1 && r.bottom > box.top + 1) {
            next.set(scroller, { id: lane.dataset.laneId ?? "", left: r.left - box.left, top: r.top - box.top });
            break;
          }
        }
      }
    }
    anchors.current = next;
  }, [root]);
  const lastSignature = useRef(signature);
  useLayoutEffect(() => {
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      for (const [scroller, anchor] of anchors.current) {
        if (!scroller.isConnected || !anchor.id) continue;
        const lane = [...scroller.querySelectorAll<HTMLElement>("[data-lane-id]")].find((node) => node.dataset.laneId === anchor.id);
        if (!lane) continue;
        const box = scroller.getBoundingClientRect();
        const r = lane.getBoundingClientRect();
        const dx = r.left - box.left - anchor.left;
        const dy = r.top - box.top - anchor.top;
        if (dx) scroller.scrollLeft += dx;
        if (dy) scroller.scrollTop += dy;
      }
    }
    capture();
  });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.addEventListener("scroll", capture, { capture: true, passive: true });
    return () => el.removeEventListener("scroll", capture, { capture: true });
  }, [root, capture]);
}
