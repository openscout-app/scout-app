/**
 * A space's mark: its glyph on a tile of its hue (see `space-identity.ts`).
 *
 * Drawn as a 16px inline glyph, 1.25px strokes, in the space's ink; the tile
 * behind it is the same ink at low strength. Light and dark inks both ride on
 * the element, and the stylesheet picks one by the surface's theme, so a mark
 * never needs to know which theme it is in.
 */

import type { CSSProperties } from "react";

import { spaceIdentity, type SpaceGlyph } from "./space-identity.ts";

export function SpaceGlyphShape({ glyph }: { glyph: SpaceGlyph }) {
  switch (glyph) {
    case "dot":
      return <circle cx="8" cy="8" r="3.25" fill="currentColor" stroke="none" />;
    case "ring":
      return <circle cx="8" cy="8" r="4.25" />;
    case "square":
      return <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1" />;
    case "diamond":
      return <path d="M8 3.5 12.5 8 8 12.5 3.5 8Z" />;
    case "triangle":
      return <path d="M8 4 12.5 11.75H3.5Z" />;
    case "hexagon":
      return <path d="M8 3.25 12.1 5.6v4.8L8 12.75 3.9 10.4V5.6Z" />;
    case "plus":
      return <path d="M8 4v8M4 8h8" />;
    case "bars":
      return <path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h7" />;
  }
}

export function SpaceMark({ slug, size = 18 }: { slug: string; size?: number }) {
  const identity = spaceIdentity(slug);
  const style = {
    "--space-ink-light": identity.hue.light,
    "--space-ink-dark": identity.hue.dark,
    width: size,
    height: size,
  } as CSSProperties;
  return (
    <span className="chat-space-mark" style={style} data-space-hue={identity.hue.name} aria-hidden="true">
      <svg viewBox="0 0 16 16" width={Math.round(size * 0.8)} height={Math.round(size * 0.8)} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
        <SpaceGlyphShape glyph={identity.glyph} />
      </svg>
    </span>
  );
}
