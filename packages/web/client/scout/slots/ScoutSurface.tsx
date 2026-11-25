import type { ReactNode } from "react";

/**
 * The page: paints the content area behind the panes (Hudson Frame is black
 * chrome). Solid by default; a page backdrop sets --scout-page-paint
 * (scout/sidebar/frame.css), fixed to the window so it reads as one wash.
 * Inside the shell's page card the card paints instead, so the frame and the
 * content area are one box (app.css, "The page card").
 */
export function ScoutSurface({ children }: { children: ReactNode }) {
  return (
    <div className="scout-surface">
      <div className="scout-surface-body">
        {children}
      </div>
    </div>
  );
}
