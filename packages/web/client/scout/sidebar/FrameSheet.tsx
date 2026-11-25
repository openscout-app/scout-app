/**
 * The page sheet's outline inside the app frame (see frame.css).
 *
 * The side rail, center and inspector are placed one by one with fixed
 * positions, so no element wraps them to round. This draws the sheet over
 * their outer edge instead: a seam of frame on the right (and below, when no
 * status bar sits there), four corner caps
 * that paint the frame outside the arc, and a 1px edge. The arc follows the
 * theme's corners (--scout-sheet-radius in frame.css): 14px for Rounded, a
 * touch for Near-square, 90 degrees for Square. All of it is
 * pointer-events: none, so the panels under it work as before.
 */
import type { CSSProperties } from "react";

// The seam of frame between the sheet's right edge and the window is three
// frame units (useFrameSpacing().seam, components/hud-grid/frame-spacing.ts).

export function FrameSheet({
  left,
  top,
  right,
  bottom,
  seamBottom = 0,
}: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The frame under the sheet when no status bar sits there. */
  seamBottom?: number;
}) {
  const cap = (corner: "tl" | "tr" | "bl" | "br"): CSSProperties => ({
    ...(corner[0] === "t" ? { top } : { bottom }),
    ...(corner[1] === "l" ? { left } : { right }),
  });
  return (
    <div aria-hidden="true" data-scout-frame-sheet="">
      {right > 0 ? (
        <div className="scout-frame-seam" style={{ top, bottom, right: 0, width: right }} />
      ) : null}
      {seamBottom > 0 ? (
        <div className="scout-frame-seam" style={{ left, right: 0, bottom: 0, height: seamBottom }} />
      ) : null}
      <div className="scout-frame-cap" data-corner="tl" style={cap("tl")} />
      <div className="scout-frame-cap" data-corner="tr" style={cap("tr")} />
      <div className="scout-frame-cap" data-corner="bl" style={cap("bl")} />
      <div className="scout-frame-cap" data-corner="br" style={cap("br")} />
      <div className="scout-frame-edge" style={{ left, top, right, bottom }} />
    </div>
  );
}
