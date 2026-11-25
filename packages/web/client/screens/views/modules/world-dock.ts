import type { WorldHandle, WorldSlots } from "../../ops/world-week/engine.ts";
import { frameLook, placeColumns, WORLD_SIDES, type WorldPlacement, type WorldSide } from "./world-panels-model.ts";

/**
 * Where the World panels meet. The World panel mounts the HUD (one engine,
 * one per view) with the engine's column seam (engine.ts › WorldSlots); the
 * engine hands each side column over in a `.wm` wrap of its own, and this
 * puts it in the column panel for that side, or back in the HUD's frame where
 * the page draws it: while the view has no panel for that side, and while the
 * World panel is in full view. The elements move; nothing remounts, so the
 * engine's listeners, canvases, inspector trail and stash ride along.
 *
 * A column panel never holds React children in its host: the wrap is the
 * engine's, moved in and out here.
 */

export type WorldDockState = {
  /** World panels mounted now. A view holds one (maxPerView). */
  stages: number;
  /** Column panels mounted now, per side. */
  columns: Readonly<Record<WorldSide, number>>;
  /** The engine has handed that side's column over (it is mounted and ready). */
  ready: Readonly<Record<WorldSide, boolean>>;
  /** The World panel is in full view: both columns draw in its frame. */
  full: boolean;
  placement: WorldPlacement;
};

/** The DOM the dock moves. The stage host holds the HUD; a column host holds that side's wrap while it is out. */
export type WorldDockParts = {
  stageHost: HTMLElement | null;
  world: WorldHandle | null;
  wraps: Record<WorldSide, HTMLElement | null>;
  asides: Record<WorldSide, HTMLElement | null>;
  /** stand-ins holding a column's place in the frame while it is out, so the HUD's
   *  `aside:first-of-type` / `:last-of-type` rules still find the column that stayed */
  gaps: Record<WorldSide, HTMLElement | null>;
  /** the column panels' hosts per side, newest last: the newest holds the column */
  hosts: Record<WorldSide, HTMLElement[]>;
};

export type WorldDock = {
  get: () => WorldDockState;
  subscribe: (listener: () => void) => () => void;
  /** A World panel mounted, drawing into `host`; returns its release. */
  mountStage: (host: HTMLElement) => () => void;
  /** The World panel went into full view, or came back. */
  setFull: (full: boolean) => void;
  /** The engine, as it mounts (and null as it goes): measured again after a column moves. */
  setWorld: (world: WorldHandle | null) => void;
  /** A column panel mounted for one side, drawing into `host`; returns its release. */
  mountColumn: (side: WorldSide, host: HTMLElement) => () => void;
  /** Passed to the engine as `opts.slots`. */
  slots: WorldSlots;
};

const NONE = { left: 0, right: 0 } as const;
const NOT_READY = { left: false, right: false } as const;
const IDLE: WorldDockState = {
  stages: 0,
  columns: NONE,
  ready: NOT_READY,
  full: false,
  placement: placeColumns({ full: false, columns: { left: false, right: false } }),
};

/** The stand-in for a column that is out: an empty `aside.col` the HUD's CSS never shows (world-panels.css). */
function newGap(frame: HTMLElement): HTMLElement {
  const gap = frame.ownerDocument.createElement("aside");
  gap.className = "col vw-world-gap";
  gap.setAttribute("aria-hidden", "true");
  return gap;
}

/** A column's place in the frame, as the markup has it: the left one before the world, the right one after it. */
function putInFrame(frame: HTMLElement, el: HTMLElement, side: WorldSide) {
  const center = frame.querySelector(":scope > main.center");
  if (!center) frame.prepend(el);
  else if (side === "left") center.before(el);
  else center.after(el);
}

/** Moves each column to where `placement` says, and sets the frame's classes to match. */
export function applyWorldDock(parts: WorldDockParts, placement: WorldPlacement): void {
  const frame = parts.stageHost?.querySelector<HTMLElement>(".frame") ?? null;
  if (!frame) return;
  for (const side of WORLD_SIDES) {
    const aside = parts.asides[side];
    const wrap = parts.wraps[side];
    if (!aside || !wrap) continue;
    const gap: HTMLElement = parts.gaps[side] ?? (parts.gaps[side] = newGap(frame));
    const host = parts.hosts[side].at(-1);
    if (placement[side] === "out" && host) {
      // out: the stand-in holds its place, the column goes to its panel in its own .wm wrap
      if (gap.parentElement !== frame) {
        if (aside.parentElement === frame) aside.replaceWith(gap);
        else putInFrame(frame, gap, side);
      }
      if (aside.parentElement !== wrap) wrap.appendChild(aside);
      if (wrap.parentElement !== host) host.appendChild(wrap);
    } else {
      // in: back where the page draws it; the empty wrap leaves the panel
      if (aside.parentElement !== frame) {
        if (gap.parentElement === frame) gap.replaceWith(aside);
        else putInFrame(frame, aside, side);
      } else gap.remove();
      wrap.remove();
    }
  }
  const look = frameLook(placement);
  frame.classList.toggle("slotted", look.slotted);
  frame.classList.toggle("vw-world-out-left", look.outLeft);
  frame.classList.toggle("vw-world-out-right", look.outRight);
  parts.stageHost?.classList.toggle("is-docked", look.container);
}

export function createWorldDock(apply: (parts: WorldDockParts, placement: WorldPlacement) => void = applyWorldDock): WorldDock {
  let state = IDLE;
  const listeners = new Set<() => void>();
  const parts: WorldDockParts = {
    stageHost: null,
    world: null,
    wraps: { left: null, right: null },
    asides: { left: null, right: null },
    gaps: { left: null, right: null },
    hosts: { left: [], right: [] },
  };
  const stageHosts: HTMLElement[] = [];
  const ready = { left: false, right: false };
  let full = false;

  // recompute, move what moved, then tell the panels
  const update = () => {
    parts.stageHost = stageHosts.at(-1) ?? null;
    const columns = { left: parts.hosts.left.length, right: parts.hosts.right.length };
    const placement = placeColumns({ full, columns: { left: columns.left > 0, right: columns.right > 0 } });
    apply(parts, placement);
    parts.world?.relayout();
    const next: WorldDockState = { stages: stageHosts.length, columns, ready: { ...ready }, full, placement };
    if (sameState(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  // A release runs once, so StrictMode's mount, release, mount counts true.
  const registered = <T>(list: T[], item: T) => {
    list.push(item);
    update();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const at = list.lastIndexOf(item);
      if (at >= 0) list.splice(at, 1);
      update();
    };
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mountStage: (host) => registered(stageHosts, host),
    setFull: (next) => {
      if (next === full) return;
      full = next;
      update();
    },
    setWorld: (world) => {
      parts.world = world;
    },
    mountColumn: (side, host) => registered(parts.hosts[side], host),
    slots: {
      attach: (side, node) => {
        parts.wraps[side] = node;
        parts.asides[side] = (node?.firstElementChild as HTMLElement | null) ?? null;
        // a new mount draws a new frame: the old stand-in went with the old one
        parts.gaps[side] = null;
        ready[side] = !!node;
        update();
      },
      // inspect or a preview opened in a column: it is already on screen, in its
      // panel or in the frame. Answering here keeps the engine from opening the
      // shell's inspector, which this view does not have.
      reveal: () => {},
    },
  };
}

function sameState(a: WorldDockState, b: WorldDockState): boolean {
  return (
    a.stages === b.stages &&
    a.full === b.full &&
    WORLD_SIDES.every(
      (s) => a.columns[s] === b.columns[s] && a.ready[s] === b.ready[s] && a.placement[s] === b.placement[s],
    )
  );
}

/** The one dock every World panel in this window shares. */
export const worldDock = createWorldDock();
