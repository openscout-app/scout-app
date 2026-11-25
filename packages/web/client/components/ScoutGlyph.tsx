/**
 * Scout's own glyphs for the navigation chrome, in place of an icon library.
 * One grid and one hand for every glyph:
 *   - 16 x 16 viewBox, drawn inside a 1.5px safe margin
 *   - 1.25px stroke, round caps and joins, no fills except small dots
 *   - currentColor only, so the row's ink and state set the colour
 * Add to this set rather than importing lucide-react in new chrome. The
 * draft lives in design/studio/views/web-nav-chrome-glyphs.tsx.
 */
import type { ComponentType, ReactNode } from "react";

export type GlyphName =
  | "search"
  | "home"
  | "sessions"
  | "chats"
  | "inbox"
  | "folder"
  | "feed"
  | "canvas"
  | "record"
  | "hosts"
  | "ops"
  | "settings"
  | "plus"
  | "back"
  | "chevronLeft"
  | "chevronRight"
  | "refresh"
  | "panelBottom"
  | "panelLeft"
  | "panelRight";

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r={0.9} fill="currentColor" stroke="none" />;

const GLYPHS: Record<GlyphName, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </>
  ),
  home: (
    <>
      <path d="M2.5 7.25 8 2.75l5.5 4.5" />
      <path d="M4.25 6v7.25h7.5V6" />
    </>
  ),
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
  chats: <path d="M4 2.75h8c.69 0 1.25.56 1.25 1.25v5.5c0 .69-.56 1.25-1.25 1.25H7.5l-3 2.5v-2.5H4c-.69 0-1.25-.56-1.25-1.25V4c0-.69.56-1.25 1.25-1.25z" />,
  /* A tray: what has come in for you. */
  inbox: (
    <>
      <path d="M2.75 9h3l1 1.75h2.5l1-1.75h3" />
      <path d="M4.5 3.25h7l1.75 5.75v3.5c0 .41-.34.75-.75.75h-11c-.41 0-.75-.34-.75-.75V9z" />
    </>
  ),
  folder: <path d="M2.75 4.25c0-.69.56-1.25 1.25-1.25h2.5l1.5 1.5H12c.69 0 1.25.56 1.25 1.25v6c0 .69-.56 1.25-1.25 1.25H4c-.69 0-1.25-.56-1.25-1.25z" />,
  /* The Feed: something made, framed, over the lines that tell it. */
  feed: (
    <>
      <rect x="2.5" y="2.5" width="11" height="6.5" rx="1.25" />
      <path d="M2.5 11.5h11M2.5 13.5h7" />
    </>
  ),
  /* The record: a page of lines already written. */
  /* The canvas: a frame with one block placed in it and a cursor over it. */
  canvas: (
    <>
      <path d="M2.75 3.25h10.5v8.5H2.75z" />
      <path d="M4.75 5.25h3v2.5h-3z" />
      <path d="M9.5 7.5l.9 3.5.8-1.4 1.55-.15z" />
    </>
  ),
  record: (
    <>
      <rect x="3" y="2.5" width="10" height="11" rx="1.25" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </>
  ),
  hosts: (
    <>
      <rect x="2.75" y="2.75" width="10.5" height="4.25" rx="1" />
      <rect x="2.75" y="9" width="10.5" height="4.25" rx="1" />
      {dot(5, 4.875)}
      {dot(5, 11.125)}
    </>
  ),
  /* Ops: an instrument reticle. */
  ops: (
    <>
      <circle cx="8" cy="8" r="4.75" />
      <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2" />
      {dot(8, 8)}
    </>
  ),
  /* Settings as two sliders, not a gear. */
  settings: (
    <>
      <path d="M2.75 5h5.5M11.75 5h1.5M2.75 11h1.5M7.75 11h5.5" />
      <circle cx="10" cy="5" r="1.5" />
      <circle cx="6" cy="11" r="1.5" />
    </>
  ),
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  back: <path d="M13 8H3.25M7 4.25 3.25 8 7 11.75" />,
  chevronLeft: <path d="M9.75 4.25 6 8l3.75 3.75" />,
  chevronRight: <path d="M6.25 4.25 10 8l-3.75 3.75" />,
  refresh: (
    <>
      <path d="M12.75 8a4.75 4.75 0 1 1-1.4-3.36" />
      <path d="M11.75 2.25v2.5h-2.5" />
    </>
  ),
  panelBottom: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 9.75h11" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M6.25 3v10" />
    </>
  ),
  panelRight: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M9.75 3v10" />
    </>
  ),
};


export type GlyphProps = {
  size?: number;
  className?: string;
  /** Accepted so a glyph can stand where a lucide icon was; the set keeps one stroke. */
  strokeWidth?: number;
  "aria-hidden"?: boolean | "true" | "false";
};

/** Any icon component a nav row can draw: a glyph, or a build's own. */
export type NavIcon = ComponentType<GlyphProps>;

export function Glyph({ name, size = 16, className }: GlyphProps & { name: GlyphName }) {
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
      className={className}
      aria-hidden
      data-scout-glyph={name}
    >
      {GLYPHS[name]}
    </svg>
  );
}

function glyph(name: GlyphName): NavIcon {
  const Named = (props: GlyphProps) => <Glyph name={name} {...props} />;
  Named.displayName = `Glyph(${name})`;
  return Named;
}

export const SearchGlyph = glyph("search");
export const HomeGlyph = glyph("home");
export const SessionsGlyph = glyph("sessions");
export const ChatsGlyph = glyph("chats");
export const InboxGlyph = glyph("inbox");
export const FolderGlyph = glyph("folder");
export const FeedGlyph = glyph("feed");
export const CanvasGlyph = glyph("canvas");
export const RecordGlyph = glyph("record");
export const HostsGlyph = glyph("hosts");
export const OpsGlyph = glyph("ops");
export const SettingsGlyph = glyph("settings");
export const PlusGlyph = glyph("plus");
export const BackGlyph = glyph("back");
export const PanelBottomGlyph = glyph("panelBottom");
export const PanelLeftGlyph = glyph("panelLeft");
export const PanelRightGlyph = glyph("panelRight");
