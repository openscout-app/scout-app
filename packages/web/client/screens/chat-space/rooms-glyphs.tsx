/**
 * Small bespoke glyphs for the Rooms places. 16px grid, thin round strokes,
 * `currentColor`. They replace icon-library imports in the Slack place.
 */

import type { ReactNode } from "react";

function Glyph({ size = 16, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CaretGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="M5 6.75 8 9.75l3-3" /></Glyph>;
}

export function CheckGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="m4 8.5 2.75 2.75L12 5.75" /></Glyph>;
}

/** Leaves this place: an arrow out of an open corner. */
export function ExternalGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="M12 9.5v3H3.5V4h3M9.5 3.5h3v3M12.25 3.75 7.5 8.5" /></Glyph>;
}

/** Scout's own place: the hexagon ring of the mark. */
export function ScoutPlaceGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M8 2 13.2 5v6L8 14l-5.2-3V5Z" />
      <circle cx="8" cy="8" r="1.9" />
    </Glyph>
  );
}

/** Every connected place at once: two stacked sheets. */
export function LayersGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="M8 2.75 13.25 5.5 8 8.25 2.75 5.5ZM2.75 8.5 8 11.25l5.25-2.75M2.75 11 8 13.75 13.25 11" /></Glyph>;
}

/** Filter a list: a lens. */
export function SearchGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></Glyph>;
}

/** Posted through an app: a line passing through a gate. */
export function ViaGlyph({ size = 14 }: { size?: number }) {
  return <Glyph size={size}><path d="M2.5 8h7.5M7.75 5.5 10.25 8l-2.5 2.5M13 4v8" /></Glyph>;
}

/**
 * A task's state as posted. Static on purpose: a projection is frozen at the
 * moment Slack stored it, so nothing here spins or pulses.
 */
export function TaskStateGlyph({ state }: { state: string }) {
  switch (state) {
    case "complete":
      return <Glyph><circle cx="8" cy="8" r="5.75" /><path d="m5.6 8.2 1.7 1.7 3.2-3.5" /></Glyph>;
    case "error":
      return <Glyph><circle cx="8" cy="8" r="5.75" /><path d="m6.1 6.1 3.8 3.8m0-3.8-3.8 3.8" /></Glyph>;
    case "in_progress":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "pending":
      return <Glyph><circle cx="8" cy="8" r="5.75" strokeDasharray="2.1 2.4" /></Glyph>;
    default:
      return <Glyph><circle cx="8" cy="8" r="5.75" /></Glyph>;
  }
}

/** Slack's "More actions": three dots stacked. */
export function MoreGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="3.75" r="0.6" fill="currentColor" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
      <circle cx="8" cy="12.25" r="0.6" fill="currentColor" />
    </Glyph>
  );
}

/** Reply in thread: a speech bubble with its tail low on the left. */
export function ThreadGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="M3 4.25A1.25 1.25 0 0 1 4.25 3h7.5A1.25 1.25 0 0 1 13 4.25v5.5A1.25 1.25 0 0 1 11.75 11H7.5L4.5 13.5V11h-.25A1.25 1.25 0 0 1 3 9.75Z" /></Glyph>;
}

/** Add a reaction: a face with a plus at its shoulder. */
export function ReactGlyph({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M13.2 8.6A5.25 5.25 0 1 1 7.4 2.8" />
      <path d="M5.75 9.5c.55.8 1.35 1.25 2.25 1.25s1.7-.45 2.25-1.25" />
      <circle cx="6" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="10" cy="6.5" r="0.5" fill="currentColor" />
      <path d="M12.25 1.75v3.5M10.5 3.5H14" />
    </Glyph>
  );
}

/** Send: a paper plane leaving to the right, as Slack's composer draws it. */
export function SendGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="M2.75 2.9 13.6 7.6a.45.45 0 0 1 0 .8L2.75 13.1a.4.4 0 0 1-.55-.5L3.9 8 2.2 3.4a.4.4 0 0 1 .55-.5ZM3.9 8h4.6" /></Glyph>;
}

export function ChevronGlyph({ size }: { size?: number }) {
  return <Glyph size={size}><path d="m6.25 4.5 3.5 3.5-3.5 3.5" /></Glyph>;
}

/**
 * Vercel's mark: the triangle, as Vercel draws it, solid in the text colour.
 * It stands for the Vercel source and for a Board room in place of "#". The
 * view box is squared so it sits on the same grid as the glyphs above.
 */
export function VercelMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 -5.5 76 76" aria-hidden="true" focusable="false">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor" />
    </svg>
  );
}
