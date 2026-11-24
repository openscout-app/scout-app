/**
 * Scout's own marks for the app chrome. No icon library and no third-party
 * artwork: the hex mark and a small glyph set drawn in one hand.
 *   - 16 x 16 viewBox inside a 1.5px safe margin, 1.25px stroke, round caps
 *   - currentColor only, so the row's ink and state set the colour
 */
import type { ReactNode } from "react";

/** The Scout mark: a ring hexagon around a filled one, on the pixel grid at 18px. */
export function ScoutMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true" className={className}>
      <path d="M9 1 16 5v8l-7 4-7-4V5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 4.43 13 6.71v4.58L9 13.57 5 11.29V6.71Z" fill="currentColor" />
    </svg>
  );
}

export type GlyphName = "feed" | "chats" | "sessions" | "board" | "control" | "tool" | "appearance" | "panelLeft";

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r={0.9} fill="currentColor" stroke="none" />;

const GLYPHS: Record<GlyphName, ReactNode> = {
  /* Something made, framed, over the lines that tell it. */
  feed: (
    <>
      <rect x="2.5" y="2.5" width="11" height="6.5" rx="1.25" />
      <path d="M2.5 11.5h11M2.5 13.5h7" />
    </>
  ),
  chats: <path d="M4 2.75h8c.69 0 1.25.56 1.25 1.25v5.5c0 .69-.56 1.25-1.25 1.25H7.5l-3 2.5v-2.5H4c-.69 0-1.25-.56-1.25-1.25V4c0-.69.56-1.25 1.25-1.25z" />,
  /* Running work: three lines in progress, each with its head. */
  sessions: (
    <>
      {dot(3.25, 4)}
      <path d="M6 4h7" />
      {dot(3.25, 8)}
      <path d="M6 8h5" />
      {dot(3.25, 12)}
      <path d="M6 12h3" />
    </>
  ),
  board: <path d="M2.75 4.25c0-.69.56-1.25 1.25-1.25h2.5l1.5 1.5H12c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H4c-.69 0-1.25-.56-1.25-1.25z" />,
  /* An instrument reticle. */
  control: (
    <>
      <circle cx="8" cy="8" r="4.75" />
      <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2" />
      {dot(8, 8)}
    </>
  ),
  /* A connected tool: a window with a prompt. Never the tool's own logo. */
  tool: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5 7l1.75 1.5L5 10M8.5 10.25h2.5" />
    </>
  ),
  /* Two sliders. */
  appearance: (
    <>
      <path d="M2.75 5h5.5M11.75 5h1.5M2.75 11h1.5M7.75 11h5.5" />
      <circle cx="10" cy="5" r="1.5" />
      <circle cx="6" cy="11" r="1.5" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M6.25 3v10" />
    </>
  ),
};

export function Glyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-glyph={name}
    >
      {GLYPHS[name]}
    </svg>
  );
}
