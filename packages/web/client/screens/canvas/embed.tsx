/*
 * Canvas › embeds: a live view an agent drives, drawn in the canvas flow as the view itself, large and interactive,
 * so the operator follows the work as it is built without opening anything. An embed has no file chrome: it is
 * titled by what it shows and by the agent driving it, with when it last changed.
 *
 * Arc is the first provider: its source is the agent's `*.arc.json`, read while the embed is on screen
 * (arc-source.ts), with the last valid diagram kept over a save that is not valid yet. Another live view adds its
 * provider to CanvasEmbedProvider (shared/canvas.ts), its name to EMBED_NAME, and a branch to `useEmbed`.
 */
import { createPortal } from "react-dom";
import { type CSSProperties, lazy, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { embedOf, type CanvasAgent, type CanvasEmbed, type CanvasItem } from "../../../shared/canvas.ts";
import type { Who } from "./marks.tsx";
import { ARC_EMPTY, ARC_OPEN_MS, useArcChapter, useArcSource, type ArcState } from "./arc-source.ts";
import { arcOutline, arcTitle, EMBED_NAME, isEditing, liveLine, pastLine } from "./embed-model.ts";
import type { ArcVariant } from "./ArcView.tsx";
import s from "./canvas.module.css";

/** HudsonKit Arc's player, in its own chunk: it loads when an Arc diagram is first on screen (ArcView.tsx). */
const ArcView = lazy(() => import("./ArcView.tsx"));

/** The app's light or dark mode, as the Provider sets it on the page, followed as it changes. */
export function useScoutMode(): "light" | "dark" {
  const read = (): "light" | "dark" => (typeof document !== "undefined" && document.documentElement.dataset.scoutThemeMode === "dark" ? "dark" : "light");
  const [mode, setMode] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scout-theme-mode"] });
    return () => mo.disconnect();
  }, []);
  return mode;
}

/** The clock for a live line: by the second while the last change is under a minute old, else every 15s. */
function useLiveNow(changedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const fresh = changedAt !== null && now - changedAt < 60_000;
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), fresh ? 1000 : 15_000);
    return () => window.clearInterval(t);
  }, [fresh, changedAt]);
  return Math.max(now, changedAt ?? 0);
}

/** One embed's source, followed while it is on screen: what it draws, its own title, and when it last changed. */
export type EmbedSource = {
  embed: CanvasEmbed;
  /** the view's own title; null until its content has been read, or when it has none */
  title: string | null;
  changedAt: number | null;
  /** why the newest save is not drawn, in one line; null when it is */
  problem: string | null;
  /** nothing drawn yet: still reading, or the first read was not valid */
  waiting: boolean;
  /** what the view shows, as an outline for an answer about it (Arc: nodes, connections, views and flows) */
  text: string;
  arc: ArcState;
  /** false: seen from a past window, read once as that window had it, not followed */
  follow: boolean;
  /** a shown item (the runtime keeps its versions), not a file read from disk */
  shown: boolean;
};

/**
 * Follows an embed item's source every `ms` while `on`. With `follow` false (a past window) it reads the item once,
 * as that window listed it. Only Arc exists; another provider is another branch.
 */
export function useEmbed(item: CanvasItem | null, ms: number, on = true, follow = true): EmbedSource | null {
  const embed = item ? embedOf(item) : null;
  const arcOn = on && embed?.provider === "arc";
  const arc = useArcSource(arcOn ? item!.key : "", item?.path ?? "", ms, arcOn, follow);
  const state = arcOn ? arc : ARC_EMPTY;
  const title = useMemo(() => arcTitle(state.data), [state.data]);
  const text = useMemo(() => arcOutline(state.data), [state.data]);
  if (!embed) return null;
  return { embed, title, changedAt: state.changedAt, problem: state.problem, waiting: !state.data, text, arc: state, follow, shown: !!item?.shown };
}

/** An embed's title: the view's own, else what kind of view it is; never its file name. */
export const embedTitle = (src: EmbedSource | null) => src?.title ?? (src ? EMBED_NAME[src.embed.provider] : "");

/** The line an embed shows about itself, and whether its agent is editing it: never editing from a past window. */
function embedLine(src: EmbedSource, agent: CanvasAgent | null, who: Who | null, now: number): { line: string; editing: boolean } {
  if (!src.follow) return { line: pastLine(who?.name ?? null, src.shown, src.changedAt, now), editing: false };
  const state = agent?.state ?? null;
  return { line: liveLine(who?.name ?? null, state, src.changedAt, now), editing: isEditing(state, src.changedAt, now) };
}

/** An embed's live line, on its own clock: who drives it, whether they are editing, when it last changed. */
export function EmbedLiveLine({ src, agent, who, className }: { src: EmbedSource; agent: CanvasAgent | null; who: Who | null; className?: string }) {
  const now = useLiveNow(src.changedAt);
  const { line, editing } = embedLine(src, agent, who, now);
  return (
    <p className={className} role="status">
      <span className={s.embedDot} data-editing={editing || undefined} aria-hidden />
      {line}
    </p>
  );
}

/** An Arc diagram as its source last read valid, and the one line saying why the newest save is not drawn. */
export function ArcDrawing({ arc, chapterKey, variant, label, mode, scale, holding, problemAt = "bottom" }: {
  arc: ArcState;
  /** the item whose chapter this view shares */
  chapterKey: string;
  variant: ArcVariant;
  label: string;
  mode: "light" | "dark";
  scale?: number;
  holding?: boolean;
  problemAt?: "top" | "bottom";
}) {
  const [chapter, setChapter] = useArcChapter(chapterKey);
  const note = variant === "picture" ? s.arcNote : s.lbNote;
  return (
    <>
      {arc.data && arc.version ? (
        <Suspense fallback={<p className={note}>Loading the diagram…</p>}>
          <ArcView
            data={arc.data} prev={arc.prev} version={arc.version} mode={mode} variant={variant} label={label} scale={scale} holding={holding}
            chapter={chapter} onChapter={setChapter}
          />
        </Suspense>
      ) : <p className={note}>{arc.problem ?? "Reading the diagram…"}</p>}
      {arc.data && arc.problem ? (
        <p className={s.arcProblem} data-at={problemAt} role="status" title={arc.problem}>Showing the last valid version. {arc.problem}</p>
      ) : null}
    </>
  );
}

/** A thin 16px glyph, drawn inline: the embed's controls. */
function Glyph16({ d }: { d: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const EXPAND_D = "M2.5 6V2.5H6 M13.5 6V2.5H10 M2.5 10v3.5H6 M13.5 10v3.5H10";
const COLLAPSE_D = "M6 2.5V6H2.5 M10 2.5V6h3.5 M6 13.5V10H2.5 M10 13.5V10h3.5";
const FULL_D = "M2.5 3.5h11v9h-11z M5.5 6.5l5 3 M10.5 6.5l-5 3";
const CLOSE_D = "M4 4l8 8M12 4l-8 8";

/** How the operator is sizing an embed: drag its bottom edge for height, its corner for both. */
export type EmbedResize = "height" | "both";

/**
 * An embed in the canvas flow. Its head is the handle: drag it to move the embed, click it for its details (asking,
 * reacting, sharing). Its body is the live view's own: pan and the view rail work there, and a pinch zooms the view.
 * Its bottom edge resizes it (double-click for its usual size); two quiet controls expand it in place or show it full
 * screen, on the same chapter, following the same source.
 */
export function Embed({
  item, follow = true, style, agent, who, zoom, dragging, resizing, expanded, meta, onOpen, onContextMenu, onPointerDown, onResizeStart, onResetSize, onExpand,
}: {
  item: CanvasItem;
  /** false on a past window: the embed is read once, as that window had it, and not followed */
  follow?: boolean;
  style: CSSProperties;
  agent: CanvasAgent | null;
  who: Who | null;
  zoom: number;
  dragging: boolean;
  /** the operator is dragging its edge: the view is fitted again when they let go */
  resizing: boolean;
  /** expanded in place: the full row, and tall */
  expanded: boolean;
  /** what the operator did with it: on Shared, a reaction sent */
  meta?: ReactNode;
  onOpen: () => void;
  /** the item's right-click menu */
  onContextMenu: (e: ReactMouseEvent) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onResizeStart: (e: ReactPointerEvent, how: EmbedResize) => void;
  onResetSize: () => void;
  onExpand: () => void;
}) {
  // in the flow, an embed reads its source every second: it is how the operator follows the agent's work
  const src = useEmbed(item, ARC_OPEN_MS, true, follow);
  const mode = useScoutMode();
  const now = useLiveNow(src?.changedAt ?? null);
  const [full, setFull] = useState(false);
  const self = useRef<HTMLElement>(null);
  if (!src) return null;
  const title = embedTitle(src);
  const label = `${EMBED_NAME[src.embed.provider]}: ${title}`;
  const { line, editing } = embedLine(src, agent, who, now);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <section ref={self} className={s.embed} style={style} data-dragging={dragging || undefined} data-resizing={resizing || undefined} aria-label={label} onContextMenu={onContextMenu}>
      <header
        className={s.embedHead}
        tabIndex={0}
        title="Drag to move. Click for details."
        onPointerDown={onPointerDown}
        onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      >
        <span className={s.embedDot} data-editing={editing || undefined} aria-hidden />
        <span className={s.embedTitle}>{title}</span>
        <span className={s.embedLine} role="status">{line}</span>
        {item.caption ? <span className={s.embedSaid} title={item.caption}>{item.caption}</span> : null}
        <span className={s.embedMeta}>{meta}</span>
        <button type="button" className={s.embedControl} aria-label={expanded ? "Back to its size" : "Expand in place"} title={expanded ? "Back to its size" : "Expand in place"} onPointerDown={stop} onClick={onExpand}>
          <Glyph16 d={expanded ? COLLAPSE_D : EXPAND_D} />
        </button>
        <button type="button" className={s.embedControl} aria-label="Full screen" title="Full screen" onPointerDown={stop} onClick={() => setFull(true)}>
          <Glyph16 d={FULL_D} />
        </button>
      </header>
      {/* the view's own surface: a press here pans the view, not the canvas or the embed */}
      <div className={s.embedBody} data-embed-live onPointerDown={stop}>
        {full ? <p className={s.lbNote}>Showing full screen.</p> : src.embed.provider === "arc" ? (
          <ArcDrawing arc={src.arc} chapterKey={item.key} variant="live" label={label} mode={mode} scale={zoom} holding={resizing} problemAt="top" />
        ) : null}
      </div>
      <div
        className={s.embedEdge}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize. Double-click for its usual size."
        title="Drag to resize. Double-click for its usual size."
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, "height"); }}
        onDoubleClick={onResetSize}
      />
      <div
        className={s.embedCorner}
        aria-hidden
        title="Drag to resize. Double-click for its usual size."
        onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e, "both"); }}
        onDoubleClick={onResetSize}
      >
        <Glyph16 d="M13.5 8.5l-5 5 M13.5 11.5l-2 2" />
      </div>
      {/*
        * full screen mounts in the app's theme scope, above its frame (the top row and rail draw over anything inside
        * the canvas page) and outside the zoomed world; it carries the page's own tokens itself
        */}
      {full ? createPortal(
        <FullScreen label={label} title={title} line={line} editing={editing} onClose={() => setFull(false)}>
          <ArcDrawing arc={src.arc} chapterKey={item.key} variant="player" label={label} mode={mode} problemAt="top" />
        </FullScreen>,
        self.current?.closest("[data-scout-theme]") ?? document.body,
      ) : null}
    </section>
  );
}

/**
 * The embed filling the window: the same live source and the same chapter, so it is the embed shown bigger, not a
 * copy that loses its place. Esc or the close control returns to the canvas.
 */
function FullScreen({ label, title, line, editing, onClose, children }: {
  label: string; title: string; line: string; editing: boolean; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  // React carries events up through a portal: nothing pressed here reaches the canvas under it
  return (
    <div className={`${s.page} ${s.embedFull}`} role="dialog" aria-modal="true" aria-label={label} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <header className={s.embedHead} data-full>
        <span className={s.embedDot} data-editing={editing || undefined} aria-hidden />
        <span className={s.embedTitle}>{title}</span>
        <span className={s.embedLine} role="status">{line}</span>
        <button type="button" className={s.embedControl} aria-label="Close full screen" title="Close (Esc)" onClick={onClose} style={{ marginLeft: "auto" }}>
          <Glyph16 d={CLOSE_D} />
        </button>
      </header>
      <div className={s.embedBody}>{children}</div>
    </div>
  );
}
