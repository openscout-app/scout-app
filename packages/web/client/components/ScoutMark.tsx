import { scoutHexCore, scoutHexRing } from "./scout-mark-paths";

/**
 * The Scout mark: a ring hexagon around a filled one, drawn on the pixel grid
 * so it stays sharp on 1x displays. It is the same drawing as the Mac app's
 * sidebar mark (ScoutSidebarBrandMark in apps/macos/Sources/Scout/
 * ScoutCommsView.swift, #1656).
 *
 * One unit is one CSS pixel, so draw it at 18px. The ring is a 2px stroke
 * centred on x 2 and 16, so it covers 1-3 and 15-17. The core is one solid
 * fill, 4/7 of the ring, whose vertical edges fall on x 5 and 13, which leaves
 * an even 2px of background between them. The old drawing at 22px put both on
 * fractional pixels and stroked the core over a wash, so the ring had grey
 * fringes and the core read as a soft blob. Other sizes still work but scale
 * off the grid.
 *
 * One definition, imported by every surface that draws the brand, so the
 * sidebar and the shell's nav bar cannot drift apart.
 *
 * COLOUR IS INHERITED, always: it paints in `currentColor` and the surface
 * decides, so the mark sits in a rail, a nav bar and a light theme without
 * variants.
 */
export function ScoutMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className} fill="none">
      <path d={scoutHexRing} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d={scoutHexCore} fill="currentColor" />
    </svg>
  );
}
