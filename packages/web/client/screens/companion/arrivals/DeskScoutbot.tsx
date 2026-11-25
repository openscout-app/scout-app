import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import {
  beginFigureDrag,
  onCompanionAnchors,
  onCompanionFigureDrag,
  SCOUTBOT_FIGURE_ID,
  setCompanionFigure,
  type CompanionFigure,
  type CompanionFigureAnchor,
  type CompanionFigureDefaults,
} from "../../../lib/companion-host.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import { figureBox, figureHold, figureSlot, isFigureClick, type PageEdges } from "../figure-model.ts";
import { ScoutbotCard, ScoutbotFigure } from "../Scoutbot.tsx";
import { ScoutbotBeside } from "./BoardSettings.tsx";

/**
 * Scoutbot off the board. On the board it stands on the top edge (the widget's
 * perch); a press there hands the drag to the host, as for any desk figure, and
 * the host places it where it drops: the desk, an edge, a window. Dropped back
 * on the board, it docks on the edge again (placement home). Its figure is the
 * host's `scoutbot` figure, so the spot survives a reload.
 */

/** How far around the board a drop still docks Scoutbot on it; above the top edge there is more room, where it stands. */
const DOCK_REACH = 28;
const DOCK_ABOVE = 72;
const PANEL_WIDTH = 360;

type Point = { x: number; y: number };

/** A drop here puts Scoutbot back on the board's edge: over the board, beside it, or in the room above it. */
export function docksOnBoard(board: PageEdges | null, at: Point): boolean {
  return Boolean(board) && at.x >= board!.left - DOCK_REACH && at.x <= board!.right + DOCK_REACH
    && at.y >= board!.top - DOCK_ABOVE && at.y <= board!.bottom + DOCK_REACH;
}

export type DeskScoutbot = {
  /** It stands on the desk, or is in a drag: the board's perch is empty. */
  out: boolean;
  /** Where it stands or is dragged, in page points; null on the board. */
  at: Pick<CompanionFigureAnchor, "x" | "y" | "down"> | null;
  dragging: boolean;
  /** The perch's (or the figure's) press: the host takes the drag from here. */
  press: (e: PointerEvent<HTMLElement>) => void;
  /** A click that ended a drag is not a click. */
  dragged: (e: MouseEvent<HTMLElement>) => boolean;
};

export function useDeskScoutbot({ figure, on, board }: {
  figure: CompanionFigure | null;
  /** Edge mode, with Scoutbot on and a host to drag it. */
  on: boolean;
  board: () => PageEdges | null;
}): DeskScoutbot {
  const down = useRef<Point | null>(null);
  const last = useRef<Point | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const [drag, setDrag] = useState<Point | null>(null);
  // The host's anchor updates (a window it rides moved); the next host state supersedes them.
  const [live, setLive] = useState<CompanionFigureAnchor | null | undefined>(undefined);
  useEffect(() => setLive(undefined), [figure]);
  useEffect(() => {
    if (!on) return;
    return onCompanionAnchors((update) => {
      const next = update.anchors.get(SCOUTBOT_FIGURE_ID);
      if (next) setLive(next.anchor);
    });
  }, [on]);
  useEffect(() => {
    if (!on) return;
    return onCompanionFigureDrag((event) => {
      if (event.workId === SCOUTBOT_FIGURE_ID) {
        last.current = { x: event.x, y: event.y };
        setDrag({ x: event.x, y: event.y });
        return;
      }
      if (event.workId !== null) return;
      setDrag(null);
      const at = last.current;
      last.current = null;
      if (event.dropped !== SCOUTBOT_FIGURE_ID || !at) return;
      if (docksOnBoard(boardRef.current(), at)) void setCompanionFigure(SCOUTBOT_FIGURE_ID, { home: true }).catch(() => {});
    });
  }, [on]);

  const placed = on && figure && figure.placement.kind !== "home" && !figure.hidden ? (live === undefined ? figure.anchor : live) : null;
  const at = drag ? { ...drag, down: null } : placed && !placed.away ? placed : null;
  return {
    out: on && (drag !== null || (figure !== null && figure.placement.kind !== "home" && !figure.hidden)),
    at,
    dragging: drag !== null,
    press: (e) => {
      if (!on || e.button !== 0) return;
      down.current = { x: e.clientX, y: e.clientY };
      beginFigureDrag(SCOUTBOT_FIGURE_ID);
    },
    dragged: (e) => e.detail !== 0 && down.current !== null && !isFigureClick(down.current, { x: e.clientX, y: e.clientY }),
  };
}

/** Scoutbot standing on the desk: the figure, its newest request beside it, and its panel when open. */
export function DeskScoutbotFigure({ bot, figure, defaults, requests, open, now, waiting, asking, working, onToggle }: {
  bot: DeskScoutbot;
  figure: CompanionFigure | null;
  defaults: CompanionFigureDefaults;
  requests: readonly OperatorAttentionItem[];
  open: boolean;
  now: number;
  waiting: number;
  asking: boolean;
  working: boolean;
  onToggle: () => void;
}) {
  const at = bot.at;
  if (!at) return null;
  const size = figure?.size ?? defaults.size;
  const slot = figureSlot(size);
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const box = figureBox(at, size, screen, figureHold(figure ?? undefined, defaults));
  const roomRight = box.left + slot.width / 2 < screen.width / 2;
  const below = box.top < screen.height / 2;
  const newest = requests[requests.length - 1];
  const panelLeft = Math.min(screen.width - PANEL_WIDTH - 12, Math.max(12, roomRight ? box.left + slot.width + 8 : box.left - 8 - PANEL_WIDTH));
  const panel: CSSProperties = below
    ? { left: panelLeft, top: box.top, width: PANEL_WIDTH }
    : { left: panelLeft, bottom: screen.height - (box.top + slot.height), width: PANEL_WIDTH };
  const card: CSSProperties = roomRight
    ? { position: "fixed", left: box.left + slot.width + 6, top: box.top }
    : { position: "fixed", right: screen.width - box.left + 6, top: box.top };
  return (
    <div className="arv-bot is-desk">
      <button type="button" className={`arv-deskbot${bot.dragging ? " is-dragging" : ""}${at && "covered" in at && at.covered ? " is-covered" : ""}`}
        data-hit={bot.dragging ? undefined : "scoutbot"}
        style={{ left: box.left, top: box.top, width: slot.width, height: slot.height }}
        aria-pressed={open}
        aria-label={waiting ? `Scoutbot, ${waiting} waiting` : "Scoutbot"}
        title="Scoutbot · Drag to move it; drop it on the board to dock it there."
        onPointerDown={bot.press}
        onClick={(e) => { if (!bot.dragged(e)) onToggle(); }}>
        <span className="arv-deskbot__body" style={{ top: box.bodyTop - box.top, width: size, height: size, marginLeft: -size / 2 }}>
          <ScoutbotFigure look="bone" mood={asking || waiting ? "ask" : "rest"} working={working} size={size} />
        </span>
      </button>
      {newest && !open && !bot.dragging && (
        <ScoutbotCard item={newest} more={requests.length - 1} side={roomRight ? "right" : "left"} style={card} onOpen={onToggle} />
      )}
      {open && !bot.dragging && (
        <div className="arv-deskbot__panel" data-hit="popover" style={panel}>
          <ScoutbotBeside requests={requests as OperatorAttentionItem[]} now={now} style={{ width: "100%", maxHeight: "60vh" }} />
        </div>
      )}
    </div>
  );
}
