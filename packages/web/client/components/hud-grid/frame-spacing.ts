import { useEffect, useState } from "react";
import { GRID_GAP } from "./hud-grid-layout.ts";

/**
 * The frame's spacing as the stylesheet sets it (styles/appearance.css, Frame
 * spacing). One parameter, --frame-unit, set by Density, drives it: the gap
 * between panels and the room around a view are one unit, and the seam of
 * frame between the sheet and the window is FRAME_SEAM_UNITS of it. The
 * grid's layout math and the shell's insets have to use the same numbers the
 * CSS draws with, or a filled grid ends short of the pane or snaps a drag off
 * its cells.
 */
export type FrameSpacing = { gap: number; edgeY: number; seam: number };

/** The sheet's seam to the window, in frame units. */
export const FRAME_SEAM_UNITS = 3;

/** What the frame used before Density set it; also the answer outside a browser. */
export const FRAME_SPACING_FALLBACK: FrameSpacing = { gap: GRID_GAP, edgeY: 12, seam: 6 };

export function parseFrameSpacing(read: (name: string) => string): FrameSpacing {
  const px = (name: string, fallback: number) => {
    const value = Number.parseFloat(read(name));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const unit = px("--frame-unit", Number.NaN);
  return {
    gap: px("--frame-gap", FRAME_SPACING_FALLBACK.gap),
    edgeY: px("--frame-edge-y", FRAME_SPACING_FALLBACK.edgeY),
    seam: Number.isNaN(unit) ? FRAME_SPACING_FALLBACK.seam : unit * FRAME_SEAM_UNITS,
  };
}

function readFrameSpacing(): FrameSpacing {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return FRAME_SPACING_FALLBACK;
  const style = getComputedStyle(document.documentElement);
  return parseFrameSpacing((name) => style.getPropertyValue(name));
}

/** The frame's spacing, read again whenever Density, Panels or Edges changes. */
export function useFrameSpacing(): FrameSpacing {
  const [spacing, setSpacing] = useState<FrameSpacing>(readFrameSpacing);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const update = () =>
      setSpacing((prev) => {
        const next = readFrameSpacing();
        return prev.gap === next.gap && prev.edgeY === next.edgeY && prev.seam === next.seam ? prev : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scout-avatar-size", "data-scout-panels", "data-scout-edges"] });
    return () => observer.disconnect();
  }, []);
  return spacing;
}
