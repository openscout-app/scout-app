import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from "react";

import {
  beginFigureDrag,
  DEFAULT_FIGURE_DEFAULTS,
  focusCompanionInput,
  onCompanionAnchors,
  onCompanionFigureDrag,
  SCOUTBOT_FIGURE_ID,
  onCompanionPointer,
  setCompanionFigure,
  unpinFromCompanion,
  type CompanionFigure,
  type CompanionFigureAnchor,
  type CompanionFigureDefaults,
  type CompanionFigureDrag,
} from "../../../lib/companion-host.ts";
import { castSlugForAgent } from "../../../lib/cast-slug.ts";
import type { Agent } from "../../../lib/types.ts";
import type { ClearAll } from "../../requests/clear-requests.ts";
import { CREW_ASSETS_AVAILABLE, crewAssetUrl, edgePoseArt, hasPose, poseAsset } from "../../../lib/crew-registry.ts";
import { dataTransferMayContainFiles, readRoutableFiles, readTransferredFiles } from "../../../lib/media-blobs.ts";
import { EdgeCharacter, HoldMark } from "../CompanionEdge.tsx";
import type { CompanionRoster } from "../companion-roster.ts";
import { nextExpiry, pruneExpired } from "../edge-model.ts";
import {
  FIGURE_FALL_MS,
  FIGURE_LAND_MS,
  clearOfBoard,
  FIGURE_STATE_PLATE_OVERHANG,
  figureBox,
  figureHasPlate,
  figureLabelSpot,
  figureLabelWidth,
  figureMotion,
  figurePose,
  figureSize,
  figureSlot,
  isFigureClick,
  onScreenMove,
  placedPopover,
  type Move,
  type PageEdges,
} from "../figure-model.ts";
import { figureLookOf, pruneFigureLooks, useFigureLookChoice, type FigureLook } from "../led-figure/figure-look.ts";
import { WindowChase } from "../window-chase.ts";
import { chaseStance, useChaseStances } from "../chase-stance.ts";
import type { Variant as ChaseVariant } from "../window-chase-model.ts";
import { faceSeed, figureIdOf, isSessionPin, type CornerThread } from "../system-corner/system-corner-model.ts";
import { FigureMenu, FigureTalk, hasFigureDraft, seedFigureDraft } from "./FigureTalk.tsx";
import { dropOnFigure, type EngageFile } from "./engage-model.ts";
import { attachFiles } from "./tap-in-data.ts";
import { Ident } from "./Ident.tsx";
import { CloseMark } from "./TapInPanel.tsx";
import { plateBox, plateFit, rowName, rowNow, STATUS_WORD } from "./arrivals-model.ts";
import {
  deskFigureHold,
  deskFormFor,
  deskPin,
  deskSpot,
  figureCardState,
  figureSay,
  formOf,
  land,
  prune,
  useDeskFormChoice,
  type DeskSpot,
} from "./desk-form.ts";
import { adoptDeskCharacters, crewHandout, deskCharacterResolve, pruneDeskCharacters, setDeskHandout, useDeskCharacterChoice, type DeskCharacterChoice, type DeskCharacterSource } from "./desk-character.ts";
import { deskLabelInk, deskLabelText, type FigureLabel } from "./figure-labels.ts";
import { projectKey, type ScopeWho } from "./figure-scope-model.ts";
import { useDeskRestLine } from "./desk-rest.ts";
import { HoverSummary, useHoverRest } from "./HoverSummary.tsx";
import { hoverIdOf } from "./hover-summary-model.ts";
import "../edge.css";

/*
 * Attached agents (Studio /studies/companion-desk), the third layer of the
 * storyline, and the one owner of the desk. The board stays home in its
 * corner; a thread pulled off it lands on an app window or the desk in one
 * of two forms, picked per agent (desk-form.ts; the board's settings set
 * the form new ones land as, and each keeps the form it landed as):
 *
 *  - Figure: drawn exactly as the companion draws a placed figure, with
 *    CompanionEdge's own EdgeCharacter and HoldMark: the global look
 *    (character or LED tile), its size, hold and edge pose, the fall when
 *    its window goes, and its idle life (a blink now and then, a glance
 *    toward the pointer; figure-life.ts).
 *  - Strip: at rest, its name and state only (its latest line too when the
 *    board's settings say so, and an ask's line while it asks); on a window
 *    a tab.
 *
 * Either one is something to talk to (FigureTalk.tsx). A click, or Enter or
 * any letter typed while the pointer is on it, opens its engage panel: its
 * open request with that request's actions, its last few turns, and a reply
 * line (with a mic where Scout voice answers) that goes into its session or
 * thread, the answer landing in place. Esc folds one level (the menu, the
 * line, then the card); a click elsewhere closes a figure's card unless it
 * holds a draft, and a draft outlives the card.
 *
 * Either one is a drop target too: a file dragged onto it (a screenshot's
 * thumbnail, a PNG from Finder) draws a thin line round it, and dropped it is
 * uploaded and waits as a chip in its reply line; the panel opens on it.
 *
 * Its Details (⌘I on it, the panel's link, Details in its menu) are the board's
 * Tap in panel, which holds everything else, how it is drawn included
 * (FigureSettings.tsx).
 *
 * Placement is the host's either way: an attached agent is a pinned figure,
 * so it rides its window, keeps its spot per display and drags natively.
 * The page draws it where the host's anchor says, with the figures' own
 * page parts:
 *
 *  - window-chase.ts: a moved window leaves it hanging, then it scurries
 *    back; a closed window drops it; going back to the board is a scurry
 *    into the board.
 *  - While the host drags it, it is drawn at the pointer (a figure by its
 *    feet), even a row just pulled off the board that is still a home pin,
 *    with the host's drop guides (the window edge it will perch on, or
 *    where a ⇧-drop falls).
 *  - Dropped on the board, it goes back, as a figure dropped on the hex.
 *
 * A right-click on either form opens its menu (FigureMenu): Reply, the
 * open request's own answers, Interrupt or Stop work where the runtime can,
 * the ways in Tap in has for it (its session, its terminal, its thread, its
 * work, its pull request), Details, its ref, and back to the board.
 * Only what is backed is offered; Back to the board is how one leaves the
 * desk here, since a hidden figure would have no way back on the board.
 *
 * ⌃⌥Space or Desk hides them all; an asking agent shows regardless. Every
 * draw tells the board (onLayout), which reports the hit regions.
 */

export const PLATE_TAB = { w: 170, h: 24 };
export const PLATE_CARD = { w: 320, h: 28 };
/** A figure's popover is as wide as an open strip. */
const POP_WIDTH = 320;
/** A strip at rest with no line: its name and state. */
export const PLATE_QUIET = { w: 196, h: 28 };
/** A figure's right-click menu: the host's own region for it, so it is never budgeted out. */
const MENU_HIT_ID = "figure-menu";
const MENU_WIDTH = 216;
/** An agent dropped within this of the board goes back to it. */
const BOARD_REACH = 28;
const EMPTY_FIGURES: readonly CompanionFigure[] = [];

type Live = Map<string, CompanionFigureAnchor | null>;
type Rect = { left: number; top: number; right: number; bottom: number };
type Dragging = Extract<CompanionFigureDrag, { workId: string }>;
type Screen = { width: number; height: number };

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const on = () => setReduced(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return reduced;
}

function readScreen(): Screen {
  return typeof window === "undefined" ? { width: 1440, height: 900 } : { width: window.innerWidth, height: window.innerHeight };
}

/** The page covers the display here, so its size is the screen figures are kept on. */
function useScreen(): Screen {
  const [screen, setScreen] = useState(readScreen);
  useEffect(() => {
    const update = () => setScreen((s) => {
      const next = readScreen();
      return next.width === s.width && next.height === s.height ? s : next;
    });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return screen;
}

/** Drops entries once their `until` passes, on a timer to the earliest one. */
function useExpiry<T extends { until: number }>(map: Map<string, T>, set: (update: (prev: Map<string, T>) => Map<string, T>) => void) {
  useEffect(() => {
    const at = nextExpiry(map);
    if (at === null) return;
    const timer = setTimeout(() => set((prev) => pruneExpired(prev, Date.now())), Math.max(0, at - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [map, set]);
}

function nearBoard(b: Rect, x: number, y: number): boolean {
  return x >= b.left - BOARD_REACH && x <= b.right + BOARD_REACH && y >= b.top - BOARD_REACH && y <= b.bottom + BOARD_REACH;
}

/** Back to the board: a session pin is released (it holds a pin slot); work stays pinned at home. */
export function release(id: string): void {
  void (isSessionPin(id) ? unpinFromCompanion(id) : setCompanionFigure(id, { home: true })).catch(() => {});
}

/** A demo desk's drop: the files stay on the page (nothing reaches a host), as chips all the same. */
let demoFileCount = 0;
function demoFiles(files: readonly File[]): Promise<EngageFile[]> {
  if (!files.length) return Promise.reject(new Error("Drop an image, a video, markdown or code."));
  return Promise.resolve(files.map((file) => ({
    id: `demo-file-${(demoFileCount += 1)}`,
    mediaType: file.type || "application/octet-stream",
    fileName: file.name,
    url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "",
    localPath: null,
  })));
}

/**
 * A figure's motion in its settings: the one it moves with now, and that
 * motion for every figure, unless every one already moves so.
 */
export function figureMotionChoice(f: CompanionFigure, pins: readonly CompanionFigure[], defaults: CompanionFigureDefaults) {
  const motion = f.motion ?? defaults.motion;
  const allSame = defaults.motion === motion && pins.every((p) => p.motion === null || p.motion === motion);
  return { motion, everyFigure: allSame ? null : motion };
}

/** A figure label's height: one line of its 10px/12px mono (.arv-figtag). */
export const FIGURE_LABEL_H = 12;

const NO_CHARACTERS: DeskCharacterChoice = { picks: { agents: {}, projects: {} }, legacy: {}, fallback: "sprite" };

/** Who a desk setting is looked up for: the agent by the id it is pinned by, and its project. */
export function scopeWhoOf(t: CornerThread): ScopeWho {
  return { id: figureIdOf(t) ?? t.id, project: projectKey(t.project) };
}

/**
 * Which crew member draws this thread's agent, and where that comes from:
 * its pick, its project's, as the companion's figures resolve theirs, else
 * the desk's default (desk-character-model.ts). Undefined is its own sprite.
 */
export function castFrom(cast: CompanionRoster | null, t: CornerThread, characters: DeskCharacterChoice): { slug: string | undefined; from: DeskCharacterSource } {
  // Its own agent in the roster, by its own id; the handle only when it has none (a handle every session of a harness shares draws none of them).
  const agent = t.identityId ? cast?.agents.find((a) => a.id === t.identityId) : cast?.agents.find((a) => a.handle === t.handle || a.name === t.handle);
  const matched = agent || !t.identityId ? castSlugForAgent(cast, { agent: agent ? { id: agent.id, name: agent.name } : undefined, name: agent?.name ?? t.handle }).castSlug : undefined;
  // Without the crew's art there is nothing to pick from.
  if (!CREW_ASSETS_AVAILABLE) return { slug: matched, from: matched ? "app" : "default" };
  return deskCharacterResolve(characters, { ...scopeWhoOf(t), seed: faceSeed(t) }, matched);
}

export function castOf(cast: CompanionRoster | null, t: CornerThread, characters: DeskCharacterChoice): string | undefined {
  return castFrom(cast, t, characters).slug;
}

type FigureInput = {
  t: CornerThread;
  figure: CompanionFigure;
  at: DeskSpot;
  defaults: CompanionFigureDefaults;
  cast: CompanionRoster | null;
  /** Picks made on the desk and the default for agents with no character. */
  characters?: DeskCharacterChoice;
  /** This figure's look, resolved for it (figureLookOf). */
  look: FigureLook;
  screen: Screen;
  reduced: boolean;
  /** Its roster label (figure-labels.ts): under it, and its code on its chest; absent when labels are off. */
  label?: FigureLabel;
  /** The chase pose, separate from the figure's scope/look identity. */
  stance?: string;
};

/** Size, motion, hold and box for a figure at its spot: the companion's figure model, with the look's hold. */
function figureGeometry({ t, figure, at, defaults, cast, characters = NO_CHARACTERS, look, screen, reduced, stance }: FigureInput) {
  const led = look !== "character";
  const slug = castOf(cast, t, characters);
  const size = figureSize(figure, defaults);
  const motion = figureMotion(figure, defaults, reduced);
  const box = figureSlot(size);
  const hold = deskFigureHold(figure, defaults, slug, led);
  // An LED tile never takes a character's edge art (see deskFigureHold).
  // Mid-chase it may be drawn standing, or in the perch it left (chase-stance.ts).
  const { pose, art, data } = chaseStance({ slug, resting: figurePose(at, figure), stance, size, edge: !led && hold === "edge" });
  const held = figureBox(at, size, screen, hold, art);
  const contact = art ? { pose, art, x: held.bodyOffsetX!, y: held.bodyOffsetY! } : undefined;
  return { slug, size, motion, box, hold, art, held, contact, stanceData: data };
}

/** How much the body grows in the asking pose, about its foot (edge.css .ce-fig.is-needs .ce-fig__body). */
const NEEDS_SCALE = 1.06;

/**
 * Everything a figure draws on the page: its slot, the state plate that
 * overhangs its side, and its label, always below it. The plate is counted
 * at the asking pose's size in every state: the footprint does not depend on
 * what the figure is doing, so it does not shift when it starts or stops
 * asking.
 */
export function figureEdges(input: FigureInput): PageEdges {
  const { size, box, held } = figureGeometry(input);
  const edges = { left: held.left, top: held.top, right: held.left + box.width, bottom: held.top + box.height };
  const take = (r: PageEdges) => {
    edges.left = Math.min(edges.left, r.left); edges.top = Math.min(edges.top, r.top);
    edges.right = Math.max(edges.right, r.right); edges.bottom = Math.max(edges.bottom, r.bottom);
  };
  const led = input.look !== "character";
  const cx = held.left + box.width / 2;
  // The state plate: an LED tile spans the slot, a character its size; held on the right, the plate sits on its left.
  const reach = ((led ? box.width : size) / 2 + size * FIGURE_STATE_PLATE_OVERHANG) * NEEDS_SCALE;
  take(input.at.down === "right" ? { ...edges, left: cx - reach } : { ...edges, right: cx + reach });
  if (input.label) {
    const width = figureLabelWidth(deskLabelText(input.label));
    const spot = figureLabelSpot(held, input.at, size, { width, height: FIGURE_LABEL_H }, input.screen);
    take({ left: spot.left, top: spot.top, right: spot.left + width, bottom: spot.top + FIGURE_LABEL_H });
  }
  return edges;
}

/**
 * Where a figure is drawn: its spot, moved clear of the board panel's frame
 * with everything it draws (clearOfBoard), and never off the screen. Its label
 * always sits below it, so a figure whose label would leave the screen is
 * lifted to make room, never its label flipped above it. A figure standing
 * free comes whole onto the screen first, so a spot saved at the screen's edge
 * (a drop the host clamped to its corner) still shows all of it. One holding
 * an edge keeps to that edge, and only rises off it by its label's room: one
 * standing on the screen's bottom edge stands that much above it. Whatever
 * the board's step, the screen wins: a stepped figure ends fully on it. The
 * same spot when nothing moves.
 */
export function drawnSpot(input: FigureInput, board: PageEdges | null): DeskSpot {
  const free = input.at.down === null;
  let at = input.at;
  const move = ({ dx, dy }: Move) => { if (dx || dy) at = { ...at, x: at.x + dx, y: at.y + dy }; };
  // A few passes: a figure holding a side is kept on the screen by its slot (figureBox), which can take up part of a move.
  const keepOnScreen = (only: (m: Move) => Move) => {
    for (let pass = 0; pass < 4; pass += 1) {
      const m = only(onScreenMove(figureEdges({ ...input, at }), input.screen));
      if (!m.dx && !m.dy) return;
      move(m);
    }
  };
  keepOnScreen(free ? (m) => m : (m) => ({ dx: 0, dy: Math.min(0, m.dy) }));
  if (!board) return at;
  const step = clearOfBoard(figureEdges({ ...input, at }), board, input.screen, at);
  move(step);
  if (step.dx || step.dy) keepOnScreen((m) => m);
  return at;
}

export type DeskFigureProps = FigureInput & {
  dragging?: boolean;
  open?: boolean;
  /** The pointer is on it or its label: its label's plate shows. */
  pointed?: boolean;
  falling?: boolean;
  chased?: boolean;
  settleKey?: number;
  /** Times it sat back down after standing mid-chase. */
  reseat?: number;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  /** The pointer came onto it or left it: a key typed meanwhile talks to it. */
  onHover?: (on: boolean, el: HTMLElement) => void;
  /** A file dragged onto it: a thin line round it while it would take the drop. */
  drop?: DropProps;
  dropping?: boolean;
};

type DropProps = {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

/** An attached agent drawn as a figure: the element, classes and parts of a figure placed on the companion. */
export function DeskFigure({ dragging = false, open = false, pointed = false, falling = false, chased = false, settleKey, reseat, onPointerDown, onClick, onContextMenu, onHover, drop, dropping = false, ...input }: DeskFigureProps) {
  const { t, figure, at, look, label, screen } = input;
  const led = look !== "character";
  const { slug, size, motion, box, hold: effectiveHold, held, contact, stanceData } = figureGeometry(dragging ? { ...input, stance: undefined } : input);
  const id = figure.workId;
  const hold = figureHasPlate(at.down) && !dragging ? at.down : null;
  const covered = at.covered && !open;
  const runs = !led && slug && hasPose(slug, "run-a") && hasPose(slug, "run-b");
  return (
    <button
      type="button"
      data-slot={id}
      data-placed={id}
      data-ax={at.x}
      data-ay={at.y}
      {...stanceData}
      data-run-a={runs ? crewAssetUrl(poseAsset(slug, "run-a")) : undefined}
      data-run-b={runs ? crewAssetUrl(poseAsset(slug, "run-b")) : undefined}
      // Behind a window its clicks belong to that window; mid-chase it is somewhere else than its box.
      data-hit={covered || dragging || chased ? undefined : `plate:${id}`}
      className={`ce-placed${hold ? ` is-hold-${hold} is-${effectiveHold}` : ""}${contact ? " is-edge-pose" : ""}${motion === "still" ? " is-still" : ""}${open ? " is-open" : ""}${pointed && !dragging ? " is-pointed" : ""}${covered ? " is-covered" : ""}${dragging ? " is-dragging" : ""}${falling && !dragging ? " is-falling" : ""}${chased ? " is-chasing" : ""}${dropping ? " is-drop" : ""}`}
      style={{ left: held.left, top: held.top, width: box.width, height: box.height, transformOrigin: `${at.x - held.left}px ${at.y - held.top}px` } as CSSProperties}
      aria-label={`${label ? `${deskLabelText(label)}, ` : ""}${rowName(t)}: ${t.task}. ${STATUS_WORD[t.state].toLowerCase()}. ${figure.label}`}
      aria-expanded={open}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerEnter={onHover ? (e) => onHover(true, e.currentTarget) : undefined}
      onPointerLeave={onHover ? (e) => onHover(false, e.currentTarget) : undefined}
      {...drop}
    >
      {hold && !contact ? <HoldMark side={hold} hold={effectiveHold} slot={box} size={size} /> : null}
      <EdgeCharacter
        slug={slug}
        look={look}
        contact={contact}
        settleKey={settleKey}
        reseat={reseat}
        landing={falling && !dragging}
        name={rowName(t)}
        seed={faceSeed(t)}
        harness={t.harness}
        chest={label?.code}
        state={figureCardState(t.state)}
        offline={false}
        size={size}
        reduced={motion === "still"}
        // Its idle life only while it stands where it is drawn.
        life={!dragging && !chased && !falling}
      />
      {/* Its roster number, quiet below it; inside the figure, so it moves with it. Not mid-chase, when the figure is elsewhere.
        * Its ink follows the desktop picture under it (the host's labelInk); the pointer on it is the pointer on the figure. */}
      {label && !chased && (() => {
        const text = deskLabelText(label);
        const width = figureLabelWidth(text);
        const spot = figureLabelSpot(held, at, size, { width, height: FIGURE_LABEL_H }, screen);
        return (
          <span
            className={`arv-figtag${deskLabelInk(at) === "dark" ? " is-ink-dark" : ""}`}
            data-hit={covered || dragging ? undefined : `plate:${id}`}
            // The host reads the desktop picture under a settled label on the desk, never one on a window.
            data-label-for={covered || dragging || falling || at.frame ? undefined : id}
            aria-hidden="true"
            style={{ left: spot.left - held.left, top: spot.top - held.top, width }}
          >{text}</span>
        );
      })()}
    </button>
  );
}

export function DeskPlates({ threads, figures, figureDefaults, cast, overlay, board, boardFrame = null, onDraft, onLayout, onDetails, machines = null, agents = null, demo = false, onDemoAnswer, clearAll = null, onDemoHome, hush = false, labels = null }: {
  threads: readonly CornerThread[];
  /** The host's pins; null until the host state is known, so no form pick is pruned meanwhile. */
  figures: readonly CompanionFigure[] | null;
  figureDefaults: CompanionFigureDefaults | null;
  /** The roster and cast, so a figure is its agent's own character. */
  cast: CompanionRoster | null;
  overlay: boolean;
  /** Where the board is on the page: put-aways scurry into it, drops on it send an agent back. */
  board: () => Rect | null;
  /** The board panel's frame as last drawn: figures keep clear of it (clearOfBoard). */
  boardFrame?: PageEdges | null;
  onDraft: (busy: boolean) => void;
  /** The desk drew or moved: the board reports the hit regions (it stays their only reporter). */
  onLayout: () => void;
  /** An agent's Details (the board's Tap in panel), by its row's id. */
  onDetails: (rowId: string) => void;
  /** The machine each native row runs on (the board's sessions); this host when absent. */
  machines?: ReadonlyMap<string, string> | null;
  /** The roster's agents: with them, a menu offers Interrupt where the runtime can stop the turn. */
  agents?: readonly Agent[] | null;
  /** The board's demo: replies go nowhere and say so. */
  demo?: boolean;
  onDemoAnswer?: (id: string) => void;
  /** Every open request the runtime can clear: a figure's menu offers Clear all requests. */
  clearAll?: ClearAll | null;
  /** The demo desk: back to the board takes a brought-out demo agent off it (nothing reaches a host). */
  onDemoHome?: (id: string) => void;
  /** A panel of the board's is open (Details, a sheet, a menu): no hover summary on the desk meanwhile. */
  hush?: boolean;
  /** Each figure's roster label (figure-labels.ts), by pin id; null when the board's settings turn labels off. */
  labels?: ReadonlyMap<string, FigureLabel> | null;
}) {
  const reduced = usePrefersReducedMotion();
  const screen = useScreen();
  const looks = useFigureLookChoice();
  const formChoice = useDeskFormChoice();
  const chosen = useDeskCharacterChoice();
  const restLine = useDeskRestLine();
  const pins = figures ?? EMPTY_FIGURES;
  const defaults = figureDefaults ?? DEFAULT_FIGURE_DEFAULTS;
  const [anchors, setAnchors] = useState<Live>(new Map());
  const [drag, setDrag] = useState<Dragging | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** The agent whose right-click menu is up, and where it was asked for. */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The agent a file is being dragged over: it would take the drop. */
  const [dropOn, setDropOn] = useState<string | null>(null);
  /** Bumped to put the keys in the open card's reply line (the menu's Reply, a key typed on its figure). */
  const [focusKey, setFocusKey] = useState(0);
  const talkInput = useRef<HTMLTextAreaElement | null>(null);
  /** The agent the pointer is on, from the page's own events or the host's reports. */
  const hovered = useRef<string | null>(null);
  /** The same, drawn: a figure the pointer is on shows its label's plate. */
  const [pointed, setPointed] = useState<string | null>(null);
  const [chasing, setChasing] = useState<ReadonlySet<string>>(() => new Set());
  const [falling, setFalling] = useState<Map<string, { until: number }>>(new Map());
  const [settles, setSettles] = useState<Map<string, number>>(new Map());
  const { stances, reseats, onStances } = useChaseStances();
  useExpiry(falling, setFalling);
  const rootRef = useRef<HTMLDivElement>(null);
  const ghostsRef = useRef<HTMLDivElement>(null);
  const lastDrag = useRef<{ x: number; y: number } | null>(null);
  const press = useRef<{ id: string; x: number; y: number } | null>(null);
  const byWork = useMemo(() => new Map(threads.flatMap((t) => { const id = figureIdOf(t); return id ? [[id, t] as const] : []; })), [threads]);
  // The crew handed out by default, one member per agent out while the crew lasts, in the order the host pins them.
  const handout = useMemo(() => crewHandout(pins.filter((f) => f.placement.kind !== "home").flatMap((f) => { const t = byWork.get(f.workId); return t ? [faceSeed(t)] : []; })), [pins, byWork]);
  const characters = useMemo(() => ({ ...chosen, handout }), [chosen, handout]);
  useEffect(() => { setDeskHandout(handout); }, [handout]);
  const labelOf = (id: string) => labels?.get(id);
  /** A hover summary's label: a figure's is its number alone, as under it; a strip's is its row's. */
  const peekLabel = (id: string) => {
    const label = labelOf(id);
    return label && deskFormFor(formChoice, whoOf(id)) === "figure" ? { ...label, project: null } : label;
  };
  // The hover summary: an agent the pointer rests on, while nothing else is up and nothing is carried.
  const peek = useHoverRest(hush || open !== null || menu !== null || drag !== null);
  const { enter: peekEnter, leave: peekLeave } = peek;
  const peekThread = peek.shown ? byWork.get(peek.shown.id) ?? null : null;
  const figureById = useMemo(() => new Map(pins.map((f) => [f.workId, f])), [pins]);
  /** Who a pin's settings are looked up for: its id, and the project of its thread when it has one. */
  const whoOf = (id: string): ScopeWho => ({ id, project: projectKey(byWork.get(id)?.project) });
  const whoRef = useRef(whoOf);
  whoRef.current = whoOf;

  // The chase reads the latest page facts through a ref; the controller lives as long as the layer.
  const read = useRef({ reduced, figureById, defaults, board, drag, open });
  read.current = { reduced, figureById, defaults, board, drag, open };
  const chaseRef = useRef<WindowChase | null>(null);
  if (!chaseRef.current) {
    chaseRef.current = new WindowChase({
      root: () => rootRef.current,
      ghosts: () => ghostsRef.current,
      variantOf: (workId): ChaseVariant => {
        const r = read.current;
        const motion = figureMotion(r.figureById.get(workId), r.defaults, r.reduced);
        return motion === "full" ? "scurry" : motion === "calm" ? "float" : "reduced";
      },
      screen: readScreen,
      hex: () => {
        const b = read.current.board();
        const s = readScreen();
        return b ? { x: (b.left + b.right) / 2, y: b.bottom } : { x: s.width - 40, y: s.height - 20 };
      },
      skip: (workId) => read.current.drag?.workId === workId || read.current.open === workId,
      onChasing: setChasing,
      onStances,
    });
  }
  const chase = chaseRef.current;
  useEffect(() => () => chase.dispose(), [chase]);

  /** Scurry into the board, then let the host forget the placement. */
  const sendBack = (id: string) => {
    setOpen(null);
    if (onDemoHome) { onDemoHome(id); return; }
    chase.away(id, "unpin");
    release(id);
  };
  const sendBackRef = useRef(sendBack);
  sendBackRef.current = sendBack;
  /** Open an agent's engage panel, its line taking the keys. */
  const talkTo = (id: string) => {
    setOpen(id);
    setFocusKey((n) => n + 1);
  };
  const close = () => setOpen(null);
  /** Its Details: the board's Tap in panel; the card here closes, unless it holds a draft. */
  const details = (t: CornerThread, id: string) => {
    setMenu(null);
    setOpen((o) => (o === id && !hasFigureDraft(t.id) ? null : o));
    onDetails(t.id);
  };

  // Once the host's pins are known: forget this-agent picks (form, look,
  // character) of pins it let go of, and keep the form each one on the desk
  // landed as. A demo's agents step off and back on as its script loops, so
  // its picks are kept.
  useEffect(() => {
    if (!figures) return;
    const ids = figures.map((f) => f.workId);
    if (!demo) {
      prune(ids);
      pruneDeskCharacters(ids);
      pruneFigureLooks(ids);
    }
    land(figures.filter((f) => f.placement.kind !== "home").map((f) => f.workId));
  }, [figures, demo]);
  // Character picks once kept by handle move to the projects of the agents they drew, as those agents come in sight (never a demo's).
  useEffect(() => {
    if (demo) return;
    adoptDeskCharacters(threads.map((t) => ({ ...scopeWhoOf(t), handle: t.handle })));
  }, [threads, demo]);

  // An agent that left the desk another way (all brought back, unpinned, its thread gone) is not open.
  useEffect(() => {
    if (open === null) return;
    const f = figureById.get(open);
    if (!f || f.hidden || f.placement.kind === "home" || !byWork.has(open)) setOpen(null);
  }, [open, figureById, byWork]);
  useEffect(() => {
    if (menu === null) return;
    const f = figureById.get(menu.id);
    if (!f || f.hidden || f.placement.kind === "home" || !byWork.has(menu.id)) setMenu(null);
  }, [menu, figureById, byWork]);

  useEffect(() => setAnchors(new Map(pins.map((f) => [f.workId, f.anchor]))), [pins]);
  useEffect(() => onCompanionAnchors((update) => {
    // The chase reads the update first; the figures it takes skip the plain fall.
    const chased = chase.anchors(update);
    setAnchors((prev) => {
      const next = new Map(prev);
      for (const [workId, { anchor }] of update.anchors) next.set(workId, anchor);
      return next;
    });
    const fall = update.falling.filter((id) => !chased.has(id));
    if (!fall.length || read.current.reduced) return;
    const until = Date.now() + FIGURE_FALL_MS + FIGURE_LAND_MS;
    setFalling((prev) => new Map([...prev, ...fall.map((id) => [id, { until }] as const)]));
  }), [chase]);

  useEffect(() => onCompanionFigureDrag((event) => {
    // Scoutbot is not one of the desk's agents: DeskScoutbot follows its drag and docks it on the board.
    if (event.workId === SCOUTBOT_FIGURE_ID || (event.workId === null && event.dropped === SCOUTBOT_FIGURE_ID)) {
      if (event.workId === null) { setDrag(null); lastDrag.current = null; }
      return;
    }
    if (event.workId !== null) {
      lastDrag.current = { x: event.x, y: event.y };
      // A drag closes a figure's popover, as on the companion; an open strip travels open.
      setOpen((o) => (o !== null && formOf(o, whoRef.current(o).project) === "figure" ? null : o));
      setMenu(null);
      setDrag(event);
      return;
    }
    setDrag(null);
    const dropped = event.dropped;
    // A figure settles into its new hold.
    if (dropped) setSettles((prev) => new Map(prev).set(dropped, (prev.get(dropped) ?? 0) + 1));
    const at = lastDrag.current;
    lastDrag.current = null;
    const b = read.current.board();
    // Dropped on the board: it goes back, and a row that never left it was not pulled out.
    if (!dropped || !at || !b) return;
    if (nearBoard(b, at.x, at.y)) sendBackRef.current(dropped);
  }), []);

  useEffect(() => {
    if (!open && !menu) return;
    // Ahead of the board's own Esc (capture) and marked handled, so one Esc
    // folds one level: the menu, the line that holds a draft (it stays kept),
    // then the card.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const line = talkInput.current;
      if (menu) setMenu(null);
      else if (line && document.activeElement === line && line.value.trim()) line.blur();
      else setOpen(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, menu]);

  // A key typed while the pointer is on an agent talks to it: Enter opens its
  // card, a letter opens it with that letter in the line. Only while nothing
  // else holds the keys (the panel hears keys once it is key: in the browser,
  // or with a card or menu up).
  const byWorkRef = useRef(byWork);
  byWorkRef.current = byWork;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = hovered.current;
      // ⌘I on it: its Details.
      if (id && !menu && e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "i") {
        const t = byWorkRef.current.get(id);
        if (!t) return;
        e.preventDefault();
        details(t, id);
        return;
      }
      if (!id || menu || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const printable = e.key.length === 1 && e.key.trim() !== "";
      if (e.key !== "Enter" && !printable) return;
      const active = document.activeElement;
      const own = active instanceof HTMLElement && active.dataset.placed === id;
      if (active && active !== document.body && !own) return;
      if (!byWorkRef.current.has(id)) return;
      // Its card is up: the key goes on into its line.
      if (open === id && talkInput.current) { talkInput.current.focus(); return; }
      e.preventDefault();
      if (printable) seedFigureDraft(id, e.key);
      talkTo(id);
    };
    // Ahead of the board's keys (capture), which leave a key the desk answered alone.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // The menu: the panel takes keys while it is up (so Esc lands here), and a
  // press anywhere else on the page closes it, as a native menu does.
  useEffect(() => {
    if (!menu) return;
    focusCompanionInput();
    const down = (e: globalThis.PointerEvent) => {
      if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) setMenu(null);
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [menu]);

  // The panel takes keys only when asked; an open figure asks, as a selected
  // figure does on the companion, so Esc lands here and not in the app below.
  const openFigure = open !== null && deskFormFor(formChoice, whoOf(open)) === "figure" ? open : null;
  useEffect(() => {
    if (openFigure) focusCompanionInput();
  }, [openFigure]);
  // The host reports where the pointer is: which agent it is on, and a click
  // elsewhere on the desktop, which closes a figure's card (as on the
  // companion) unless it holds a draft; an open strip stays open in place.
  useEffect(() => onCompanionPointer(({ id, outside }) => {
    if (id !== null || outside) hovered.current = id?.startsWith("plate:") ? id.slice("plate:".length) : null;
    setPointed(!outside && id?.startsWith("plate:") ? id.slice("plate:".length) : null);
    // Its hover summary: the host's report is the panel's only hover while it is not key.
    const on = outside ? null : hoverIdOf(id, "plate:");
    if (on) peekEnter(on, rootRef.current?.querySelector<HTMLElement>(`[data-hit="plate:${CSS.escape(on)}"]`) ?? null);
    else peekLeave();
    if (!outside) return;
    setOpen((o) => (o !== null && formOf(o, whoRef.current(o).project) === "figure" && !hasFigureDraft(o) ? null : o));
    setMenu(null);
  }), []);

  // Every draw, and every move CSS finishes, can change what takes the pointer.
  const layout = useRef(onLayout);
  layout.current = onLayout;
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => layout.current());
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const report = () => layout.current();
    root.addEventListener("transitionend", report);
    root.addEventListener("animationend", report);
    // An open card or a menu grows from inside (its reads land, an answer comes in) without a draw here.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    const watch = () => root.querySelectorAll<HTMLElement>(".arv-plate.is-open, .cw-menu.is-figure").forEach((el) => resize?.observe(el));
    watch();
    const added = typeof MutationObserver === "undefined" ? null : new MutationObserver(watch);
    added?.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener("transitionend", report);
      root.removeEventListener("animationend", report);
      resize?.disconnect();
      added?.disconnect();
    };
  }, []);

  // A press hands the drag to the host; a press the host tracked as a drag is not also a click.
  const pressOn = (event: PointerEvent<HTMLElement>, id: string) => {
    peek.press();
    if (event.button !== 0) return;
    press.current = { id, x: event.clientX, y: event.clientY };
    beginFigureDrag(id);
  };
  const toggle = (event: MouseEvent<HTMLElement>, id: string) => {
    if (event.detail !== 0 && press.current?.id === id && !isFigureClick(press.current, { x: event.clientX, y: event.clientY })) return;
    if (open === id) close();
    else talkTo(id);
  };
  const hover = (id: string) => (on: boolean, el: HTMLElement) => {
    if (on) hovered.current = id;
    else if (hovered.current === id) hovered.current = null;
    setPointed((p) => (on ? id : p === id ? null : p));
    if (on) peek.enter(id, el);
    else peek.leave(id);
  };
  const menuOn = (event: MouseEvent<HTMLElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ id, x: event.clientX, y: event.clientY });
  };

  /**
   * A file dragged onto an agent: it takes the drop while the drag holds
   * files, with a thin line round it; dropped, the files upload (POST
   * /api/blobs; a demo keeps them on the page) and wait in its reply line,
   * and its panel opens on them.
   */
  const dropFor = (t: CornerThread, id: string): DropProps => ({
    onDragEnter: (e) => { if (dataTransferMayContainFiles(e.dataTransfer)) { e.preventDefault(); setDropOn(id); } },
    onDragOver: (e) => {
      if (!dataTransferMayContainFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (dropOn !== id) setDropOn(id);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn((d) => (d === id ? null : d));
    },
    onDrop: (e) => {
      if (!dataTransferMayContainFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      const files = readRoutableFiles(e.dataTransfer);
      const any = files.length ? files : readTransferredFiles(e.dataTransfer);
      void dropOnFigure(t.id, any, demo ? demoFiles : attachFiles);
      talkTo(id);
    },
  });
  // A drag that ends anywhere (dropped elsewhere, or let go off the page) leaves no line behind.
  useEffect(() => {
    if (dropOn === null) return;
    const end = () => setDropOn(null);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => { window.removeEventListener("dragend", end); window.removeEventListener("drop", end); };
  }, [dropOn]);

  const machineOf = (t: CornerThread) => (demo ? null : machines?.get(t.id) ?? null);
  const quiet = (e: { stopPropagation: () => void }) => e.stopPropagation();

  /**
   * A strip at rest: who and its state; its latest line too when the board's
   * settings say so, and what it asks while it asks. A tab is who and state.
   */
  const rest = (t: CornerThread, id: string, tab: boolean, line: string | null) => (
    <div
      className="arv-plate__row"
      onPointerDown={(e) => pressOn(e, id)}
      onClick={(e) => toggle(e, id)}
      onContextMenu={(e) => menuOn(e, id)}
    >
      <Ident t={t} size={16} label={labelOf(id)} />
      {!tab && line && <span className="arv-plate__now">{line}</span>}
      <span className={`arv-plate__st is-${t.state}`}>{STATUS_WORD[t.state]}</span>
    </div>
  );

  /**
   * An open card's head: who, its state and a close. An open strip still
   * drags by it; in a figure's card the figure is what drags, so there a
   * click on it only closes the card.
   */
  const head = (t: CornerThread, id: string, drags: boolean) => (
    <div
      className="arv-plate__row is-head"
      title={drags ? `${t.task}. Drag to move it; drop it on the board to send it back. Right-click for more.` : t.task}
      onPointerDown={drags ? (e) => pressOn(e, id) : undefined}
      onClick={drags ? (e) => toggle(e, id) : close}
      onContextMenu={(e) => menuOn(e, id)}
    >
      <Ident t={t} size={16} label={labelOf(id)} />
      <span className={`arv-plate__st is-${t.state}`}>{STATUS_WORD[t.state]}</span>
      <button type="button" className="arv-plate__icon" title="Close" aria-label="Close" onPointerDown={quiet} onClick={(e) => { e.stopPropagation(); close(); }}>
        <CloseMark />
      </button>
    </div>
  );

  /** What an open card holds under its head: the engage panel. */
  const talk = (t: CornerThread, f: CompanionFigure) => (
    <FigureTalk
      key={f.workId}
      t={t}
      machineId={machineOf(t)}
      demo={demo}
      agents={agents}
      onDraft={onDraft}
      inputRef={talkInput}
      focusKey={focusKey}
      onDetails={() => details(t, f.workId)}
      onDemoAnswer={onDemoAnswer}
    />
  );

  // The open figure's card, beside it as on the companion.
  const popover = (() => {
    const f = open ? figureById.get(open) : undefined;
    const t = f ? byWork.get(f.workId) : undefined;
    if (!f || !t || deskFormFor(formChoice, whoOf(f.workId)) !== "figure") return null;
    const found = deskSpot(f, anchors.get(f.workId), drag);
    if (!found) return null;
    const input = { t, figure: f, at: found, defaults, cast, characters, look: figureLookOf(looks, whoOf(f.workId)).look, screen, reduced, label: labelOf(f.workId) };
    // Beside the figure where it is drawn: clear of the board, as the figure is.
    const at = drag?.workId === f.workId ? found : drawnSpot(input, boardFrame);
    const g = figureGeometry({ ...input, at });
    const width = Math.min(POP_WIDTH, screen.width - 24);
    const spot = placedPopover(at, g.size, width, screen, g.hold, 12, g.art);
    return (
      // Keyed by agent: moving to another figure starts its own draft, echoes and request state.
      <div
        key={f.workId}
        data-hit={`plate:${f.workId}`}
        className={`arv-plate is-${t.state} is-card is-open is-pop${dropOn === f.workId ? " is-drop" : ""}`}
        role="dialog"
        aria-label={`${rowName(t)}: ${t.task}`}
        style={{ left: Math.round(spot.left), top: spot.top, bottom: spot.bottom, width, maxHeight: spot.maxHeight }}
        {...dropFor(t, f.workId)}
      >
        {head(t, f.workId, false)}
        {talk(t, f)}
      </div>
    );
  })();

  // The right-click menu, at the pointer, grouped as a native menu is.
  const menuView = (() => {
    if (!menu) return null;
    const f = figureById.get(menu.id);
    const t = f ? byWork.get(f.workId) : undefined;
    if (!f || !t) return null;
    const id = f.workId;
    return (
      <FigureMenu
        key={id}
        t={t}
        machineId={machineOf(t)}
        demo={demo}
        agents={agents}
        name={rowName(t)}
        width={MENU_WIDTH}
        at={{ x: menu.x, y: menu.y }}
        hitId={MENU_HIT_ID}
        elRef={menuRef}
        onClose={() => setMenu(null)}
        onTalk={() => talkTo(id)}
        onDetails={() => details(t, id)}
        onHome={() => sendBack(id)}
        clearAll={clearAll}
        onDemoAnswer={onDemoAnswer}
      />
    );
  })();

  const guide = drag?.guide;
  return (
    <div ref={rootRef} className="arv-desk__layer">
      {drag && guide && (
        <svg className="arv-guides" width={screen.width} height={screen.height} aria-hidden="true">
          {guide.kind === "perch" && guide.from && guide.to && <line className="arv-guide__line" x1={guide.from.x} y1={guide.from.y} x2={guide.to.x} y2={guide.to.y} />}
          {guide.kind === "fall" && <line className="arv-guide__fall" x1={drag.x} y1={drag.y} x2={guide.spot.x} y2={guide.spot.y} />}
          <circle className="arv-guide__spot" cx={guide.spot.x} cy={guide.spot.y} r={3} />
        </svg>
      )}
      {pins.map((f) => {
        const t = byWork.get(f.workId);
        if (!t) return null;
        const id = f.workId;
        const isOpen = open === id;
        const pin = deskPin(f, anchors.get(id), drag, { state: t.state, overlay, open: isOpen, form: deskFormFor(formChoice, whoOf(id)) });
        if (!pin) return null;
        const { at, dragging } = pin;
        const chased = chasing.has(id) && !dragging;
        if (pin.form === "figure") {
          const input = { t, figure: f, at, defaults, cast, characters, look: figureLookOf(looks, whoOf(id)).look, screen, reduced, label: labelOf(id) };
          return (
            <DeskFigure
              key={id}
              {...input}
              // Where it stands, whole on the screen and clear of the board's frame (drawnSpot). Under the pointer while dragged.
              at={dragging || chased ? at : drawnSpot(input, boardFrame)}
              dragging={dragging}
              open={isOpen}
              pointed={pointed === id}
              falling={falling.has(id)}
              chased={chased}
              settleKey={settles.get(id)}
              stance={stances.get(id)}
              reseat={reseats.get(id)}
              onPointerDown={(e) => pressOn(e, id)}
              onClick={(e) => toggle(e, id)}
              onContextMenu={(e) => menuOn(e, id)}
              onHover={hover(id)}
              drop={dragging ? undefined : dropFor(t, id)}
              dropping={dropOn === id}
            />
          );
        }
        const tab = f.placement.kind === "window" && !isOpen && !dragging;
        const line = figureSay(t) ?? (restLine ? rowNow(t) : null);
        const size = tab ? PLATE_TAB : line ? PLATE_CARD : PLATE_QUIET;
        // A closed strip is as wide as its text, up to its budget, and keeps its side of the anchor; an open one is the card.
        const fits = !isOpen && !tab;
        const box = dragging ? { left: at.x, top: at.y - size.h - 6, shift: "-50% 0" } : fits ? plateFit(at, size.h) : { ...plateBox(at, size.w, size.h), shift: undefined };
        const covered = at.covered && !isOpen;
        return (
          <div
            key={id}
            data-hit={(covered || dragging || chased) && !isOpen ? undefined : `plate:${id}`}
            data-placed={id}
            data-ax={at.x}
            data-ay={at.y}
            className={`arv-plate is-${t.state}${tab ? " is-tab" : " is-card"}${isOpen ? " is-open" : ""}${dragging ? " is-drag" : ""}${covered ? " is-covered" : ""}${dropOn === id ? " is-drop" : ""}`}
            style={{ left: Math.round(box.left), top: Math.round(box.top), translate: box.shift, ...(fits ? { width: "max-content", maxWidth: size.w } : { width: isOpen ? POP_WIDTH : size.w }) }}
            onPointerEnter={(e) => hover(id)(true, e.currentTarget)}
            onPointerLeave={(e) => hover(id)(false, e.currentTarget)}
            {...(dragging ? {} : dropFor(t, id))}
          >
            {isOpen ? <>{head(t, id, true)}{talk(t, f)}</> : rest(t, id, tab, line)}
          </div>
        );
      })}
      {/* Put-away ghosts: written by window-chase.ts, never by React. */}
      <div ref={ghostsRef} className="arv-ghosts" aria-hidden="true" />
      {popover}
      {menuView}
      {peekThread && peek.shown && <HoverSummary t={peekThread} label={peekLabel(peek.shown.id)} anchor={peek.shown.el} now={Date.now()} />}
    </div>
  );
}
