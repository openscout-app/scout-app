/**
 * Provider identity tiles for Rooms. Scout and external workspace records keep
 * their own source, space, and room addresses even in the aggregate view.
 */

import { ScoutPlaceGlyph } from "./rooms-glyphs.tsx";

/** First letter of a workspace name, for its tile. Team icons need `team:read`. */
export function workspaceMonogram(name: string): string {
  const letter = name.trim().match(/\p{L}|\p{N}/u)?.[0];
  return letter ? letter.toUpperCase() : "S";
}

/**
 * A foreign workspace is a neutral tile with chamfered corners, cut like
 * Scout's signal frame: it reads as "another place" without borrowing that
 * provider's colors. Scout's own place keeps its mark.
 */
export function PlaceTile({ kind, name, size = 22 }: { kind: "scout" | "slack"; name: string; size?: number }) {
  return (
    <span className="rooms-place-tile" data-kind={kind} style={{ width: size, height: size }} aria-hidden="true">
      {kind === "scout" ? <ScoutPlaceGlyph size={Math.round(size * 0.68)} /> : workspaceMonogram(name)}
    </span>
  );
}
