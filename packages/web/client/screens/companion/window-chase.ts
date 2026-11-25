/*
 * Companion · When the window moves: the page side.
 *
 * Drives window-chase-model.ts against the live edge page. The host keeps
 * sending each placed figure's anchor (where its window says its feet are);
 * React draws the figure there. This controller keeps one Beat per placed
 * figure and, while a beat is doing something, writes a transform on the
 * figure's button that offsets it from that anchor to where the beat says it
 * is: left hanging where the perch was, worrying, then scurrying back.
 *
 * Put away (Home, Unpin, Hide, Send all home, hiding the panel) has no anchor
 * to chase: the figure's button is cloned into a ghost layer, the real one is
 * hidden, and the ghost scurries to the home row, into the hex, or off the
 * nearest screen edge.
 *
 * Everything here is DOM writes inside one requestAnimationFrame loop that
 * runs only while something moves; React renders nothing per frame.
 */

import type { CompanionAnchorUpdate, CompanionPageRect } from "../../lib/companion-host.ts";
import {
  BEAT,
  createBeat,
  putAway,
  stepBeat,
  windowGone,
  windowMoved,
  windowReturned,
  windowVanished,
  type Beat,
  type Gaze,
  type Pose,
  type Pt,
  type Stance,
  type Variant,
} from "./window-chase-model.ts";

/** How a put-away ends: in the home row, into the hex, or off screen. */
export type ChaseAway = "home" | "unpin" | "hidden" | "leave";

export type ChaseOptions = {
  root: () => HTMLElement | null;
  ghosts: () => HTMLElement | null;
  /** Per figure: scurry (full motion), float (calm) or reduced (still, Reduce Motion). */
  variantOf: (workId: string) => Variant;
  screen: () => { width: number; height: number };
  hex: () => Pt;
  /** Rides along without a chase: being dragged, or its popover is open. */
  skip: (workId: string) => boolean;
  /** The figures mid-chase changed: they drop out of the hit regions meanwhile. */
  onChasing: (workIds: ReadonlySet<string>) => void;
  /**
   * The pose each figure mid-chase is drawn in, when it is not its perch's
   * own: "rest" while it stands (full motion), or the pose of the perch it
   * was on before the host moved its anchor. Changes at beat boundaries only.
   */
  onStances?: (stances: ReadonlyMap<string, string>) => void;
  /**
   * The host moved a figure across its window: squeezed out from under it
   * onto its top ("up"), or back under once there is room ("down"). A squash
   * ghost is left at the old spot; the page pops the figure out at the new one.
   */
  onPop?: (workId: string, dir: "up" | "down") => void;
};

type Live = {
  beat: Beat;
  target: Pt;
  frame: CompanionPageRect | null;
  movedAt: number;
  /** The perch pose it was drawn in while it last rested, and the offset from its contact point to its feet standing. */
  origin: string | null;
  up: Pt;
  stance: Stance;
  /** Sitting on its window's top because there is no room under it (the host's `squeezed`). */
  squeezed: boolean;
};

type Ghost = {
  workId: string;
  el: HTMLElement;
  original: HTMLElement | null;
  beat: Beat;
  start: Pt;
  away: ChaseAway;
  /** Home: the row slot, found once the host's state push renders it. */
  target: HTMLElement | null;
  lookUntil: number;
  delay: number;
  done: (() => void) | null;
};

/** The squash at the spot a squeezed figure leaves: flattened against the screen edge, gone. */
export const SQUASH_MS = 180;

/** A squeezed flip across the window: up onto its top, down back under it, or none. */
export function squeezeFlip(was: boolean, now: boolean): "up" | "down" | null {
  return was === now ? null : now ? "up" : "down";
}

/** How long a ghost waits for its home slot before giving up (the host refused). */
const HOME_WAIT_MS = 600;

/** A pose as a transform on the element drawn at `rendered` (its anchor). */
export function chaseTransform(pose: Pose, rendered: Pt): string {
  const dx = round(pose.x - rendered.x);
  const dy = round(pose.y - rendered.y);
  return `translate(${dx}px, ${dy}px) rotate(${round(pose.rot)}deg) scale(${round(pose.sx, 3)}, ${round(pose.sy, 3)})`;
}

/** Off the nearest side edge of the screen, at the same height. */
export function offEdge(from: Pt, width: number, screenWidth: number): Pt {
  return { x: from.x < screenWidth / 2 ? -width : screenWidth + width, y: from.y };
}

/** Same window, moved: the size held and the anchor shifted. A resize only re-anchors. */
export function isWindowMove(prev: CompanionPageRect | null, next: CompanionPageRect | null, from: Pt, to: Pt): boolean {
  if (!prev || !next) return false;
  if (Math.abs(prev.w - next.w) >= 1 || Math.abs(prev.h - next.h) >= 1) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) > BEAT.START_PX;
}

function round(n: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

function isIdle(beat: Beat): boolean {
  return (beat.phase === "attached" && beat.vanishedAt === null) || beat.phase === "down" || beat.phase === "home";
}

/** What a resting figure's button says about how it is drawn (CompanionEdge sets these). */
function restingDrawing(el: HTMLElement | null): { origin: string | null; up: Pt } {
  const x = parseFloat(el?.dataset.upX ?? "");
  const y = parseFloat(el?.dataset.upY ?? "");
  return { origin: el?.dataset.pose ?? null, up: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 } };
}

/** A gaze as seen on art drawn mirrored: left and right swap. */
export function mirrorGaze(gaze: Gaze): Gaze {
  if (gaze.endsWith("left")) return gaze.replace(/left$/, "right") as Gaze;
  if (gaze.endsWith("right")) return gaze.replace(/right$/, "left") as Gaze;
  return gaze;
}

/**
 * The longest a figure back on its perch keeps standing while its resting
 * drawing decodes. A fresh <img> paints nothing until it has (WebKit), so
 * sitting before then blinks the figure out.
 */
const SEAT_DECODE_MS = 250;

/** Resolves once the drawing at src can paint at once, or after a short wait. */
function decoded(src: string | undefined): Promise<void> {
  if (!src || typeof Image === "undefined") return Promise.resolve();
  const img = new Image();
  img.src = src;
  const wait = new Promise<void>((resolve) => setTimeout(resolve, SEAT_DECODE_MS));
  return Promise.race([img.decode().catch(() => undefined), wait]);
}

const preloaded = new Set<string>();
const EYE_ROLES: Gaze[] = ["blink-half", "look-left", "look-right", "look-up", "look-down", "look-up-left", "look-up-right", "look-down-left", "look-down-right"];

/** Eye frames load ahead of the first look, so a glance never waits on the network. */
function preloadEyes(el: HTMLElement | null): void {
  const dir = el?.dataset.eyes;
  if (!dir || preloaded.has(dir) || typeof Image === "undefined") return;
  preloaded.add(dir);
  for (const role of EYE_ROLES) new Image().src = `${dir}/${role}.webp`;
}

export class WindowChase {
  private live = new Map<string, Live>();
  private ghosts: Ghost[] = [];
  private squashes = new Set<HTMLElement>();
  private raf = 0;
  private last = 0;
  private chasing = "";
  private stances = "";
  /** Figures back on a perch, still drawn standing until their resting drawing can paint. */
  private seating = new Map<string, string>();
  private leaving: { timer: ReturnType<typeof setTimeout>; restore: ReturnType<typeof setTimeout> | null } | null = null;

  constructor(private readonly opts: ChaseOptions) {}

  /**
   * A host anchors push. Returns the figures whose window closed that this
   * controller is animating (the Coyote fall), so the page skips its plain fall.
   */
  anchors(update: CompanionAnchorUpdate): Set<string> {
    const now = performance.now();
    const taken = new Set<string>();
    let stranded = 0;
    for (const [workId, { anchor }] of update.anchors) {
      if (this.opts.skip(workId) || !anchor || anchor.away || this.ghosts.some((g) => g.workId === workId)) {
        this.forget(workId);
        continue;
      }
      const at = { x: anchor.x, y: anchor.y };
      const frame = anchor.frame ?? null;
      let entry = this.live.get(workId);
      if (!entry) {
        entry = { beat: createBeat(0, at, now), target: at, frame, movedAt: -Infinity, origin: null, up: { x: 0, y: 0 }, stance: "contact", squeezed: anchor.squeezed === true };
        this.live.set(workId, entry);
      }
      const { beat } = entry;
      if (isIdle(beat)) {
        // A resting figure is where it was last drawn: its last anchor. Resizes
        // and sub-threshold moves re-anchor it without a beat, so this is the
        // only place its position catches up before a chase starts from it.
        if (beat.phase === "attached") beat.pos = { ...entry.target };
        // React has not drawn this update yet: the button still shows the pose it rests in.
        const el = this.button(workId);
        Object.assign(entry, restingDrawing(el));
        preloadEyes(el);
      }
      const landing = update.landing.get(workId);
      if (landing) {
        // Closed or minimized: the host already moved the anchor to where it fell.
        windowGone(beat, now, at, null);
        entry.target = at;
        entry.frame = frame;
        taken.add(workId);
        continue;
      }
      if (update.falling.includes(workId)) {
        // A ⇧-drop: the page's plain fall; start over at the new spot.
        this.forget(workId);
        continue;
      }
      if (anchor.pending) {
        windowVanished(beat, now);
        continue;
      }
      if (beat.vanishedAt !== null && !beat.dropReady) windowReturned(beat, now);
      const flip = squeezeFlip(entry.squeezed, anchor.squeezed === true);
      if (flip) {
        // Not a window move: the host put it on the other side of the same
        // window. Squash where it is drawn now, then start over at the new spot.
        this.squash(workId);
        this.seating.delete(workId);
        const el = this.button(workId);
        if (el) clearPose(el);
        Object.assign(entry, { beat: createBeat(0, at, now), target: at, frame, movedAt: -Infinity, stance: "contact", squeezed: flip === "up" });
        if (this.opts.variantOf(workId) !== "reduced") this.opts.onPop?.(workId, flip);
        continue;
      }
      if (isWindowMove(entry.frame, frame, entry.target, at)) {
        if (beat.phase === "attached") beat.index = stranded++;
        windowMoved(beat, now);
        entry.movedAt = now;
      }
      entry.target = at;
      entry.frame = frame;
    }
    for (const workId of [...this.live.keys()]) if (!update.anchors.has(workId)) this.forget(workId);
    this.kick();
    return taken;
  }

  /**
   * A copy of the figure, as it is drawn now, flattens and fades where it
   * stands. The figure itself is not hidden: React moves it to its new spot.
   */
  private squash(workId: string): void {
    const layer = this.opts.ghosts();
    const original = this.button(workId);
    if (!layer || !original || original.style.visibility === "hidden" || this.opts.variantOf(workId) === "reduced") return;
    const el = original.cloneNode(true) as HTMLElement;
    for (const attr of ["data-hit", "data-placed", "data-slot", "aria-label", "aria-pressed", "aria-expanded", "title", "id"]) el.removeAttribute(attr);
    el.classList.remove("is-open", "is-falling", "is-chasing", "is-selected");
    el.classList.add("ce-ghost");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.transformOrigin = "50% 100%";
    layer.appendChild(el);
    this.squashes.add(el);
    const end = () => { el.remove(); this.squashes.delete(el); };
    if (typeof el.animate !== "function") { end(); return; }
    const run = el.animate(
      [{ scale: "1 1", opacity: 1 }, { scale: "1.18 0.6", opacity: 1, offset: 0.35 }, { scale: "1.35 0.12", opacity: 0 }],
      { duration: SQUASH_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    );
    run.onfinish = end;
    run.oncancel = end;
  }

  /** Home, Unpin, Hide: the figure scurries away from where it is drawn now. */
  away(workId: string, away: ChaseAway, delay = 0, done: (() => void) | null = null): boolean {
    const root = this.opts.root();
    const layer = this.opts.ghosts();
    const original = root?.querySelector<HTMLElement>(`[data-placed="${CSS.escape(workId)}"]`) ?? null;
    if (!root || !layer || !original || original.style.visibility === "hidden") return false;
    this.forget(workId);
    const left = parseFloat(original.style.left);
    const top = parseFloat(original.style.top);
    const width = original.offsetWidth;
    const height = original.offsetHeight;
    if (![left, top, width, height].every(Number.isFinite)) return false;

    const el = original.cloneNode(true) as HTMLElement;
    for (const attr of ["data-hit", "data-placed", "data-slot", "aria-label", "aria-pressed", "aria-expanded", "title", "id"]) el.removeAttribute(attr);
    el.classList.remove("is-open", "is-falling", "is-chasing");
    el.classList.add("ce-ghost");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.transformOrigin = "50% 100%";
    layer.appendChild(el);
    original.style.visibility = "hidden";

    const now = performance.now();
    const start = { x: left + width / 2, y: top + height };
    const beat = createBeat(this.ghosts.length, start, now);
    const ghost: Ghost = { workId, el, original, beat, start, away, target: null, lookUntil: now + HOME_WAIT_MS, delay, done };
    if (away !== "home") {
      const { width: screenWidth } = this.opts.screen();
      const to = away === "unpin" ? this.opts.hex() : offEdge(start, width, screenWidth);
      putAway(beat, now, to, "gone", delay);
    }
    this.ghosts.push(ghost);
    this.kick();
    return true;
  }

  /**
   * The panel is about to hide: every placed figure dashes off its nearest
   * edge, staggered. `done` runs once they are gone, or at `ms` (the host's cap).
   */
  leave(ms: number, done: () => void): void {
    const root = this.opts.root();
    const ids = [...(root?.querySelectorAll<HTMLElement>("[data-placed]") ?? [])].map((el) => el.dataset.placed!).filter(Boolean);
    let left = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (this.leaving) clearTimeout(this.leaving.timer);
      done();
      // The panel is gone by now; give the figures back for the next show.
      const restore = setTimeout(() => this.restoreHidden(), 1500);
      if (this.leaving) this.leaving.restore = restore;
    };
    this.leaving = { timer: setTimeout(finish, Math.max(0, ms - 60)), restore: null };
    ids.forEach((workId, index) => {
      if (this.away(workId, "leave", index * BEAT.STAGGER_MS, () => { left -= 1; if (left <= 0) finish(); })) left += 1;
    });
    if (left === 0) finish();
  }

  /** Stop every chase and ghost (hidden, offline layout change, unmount). */
  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const workId of [...this.live.keys()]) this.forget(workId);
    for (const ghost of this.ghosts) this.endGhost(ghost, true);
    this.ghosts = [];
    for (const el of this.squashes) el.remove();
    this.squashes.clear();
    if (this.leaving) {
      clearTimeout(this.leaving.timer);
      if (this.leaving.restore) clearTimeout(this.leaving.restore);
      this.leaving = null;
    }
    this.restoreHidden();
    this.report();
  }

  /** Keep drawing a figure that stood as it is until its resting drawing has decoded, then let it sit. */
  private seat(workId: string, drawn: string, src: string | undefined): void {
    this.seating.set(workId, drawn);
    void decoded(src).then(() => {
      if (this.seating.get(workId) !== drawn) return;
      this.seating.delete(workId);
      this.report();
    });
  }

  /** Stop chasing one figure: it rides its anchor again. */
  forget(workId: string): void {
    this.seating.delete(workId);
    if (!this.live.delete(workId)) return;
    const el = this.button(workId);
    if (el) clearPose(el);
  }

  private restoreHidden(): void {
    for (const el of this.opts.root()?.querySelectorAll<HTMLElement>("[data-placed], [data-slot]") ?? []) {
      if (el.style.visibility === "hidden") el.style.visibility = "";
    }
  }

  private button(workId: string): HTMLElement | null {
    return this.opts.root()?.querySelector<HTMLElement>(`[data-placed="${CSS.escape(workId)}"]`) ?? null;
  }

  private kick(): void {
    this.report();
    if (this.raf || (!this.ghosts.length && ![...this.live.values()].some((e) => !isIdle(e.beat)))) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    this.raf = 0;
    const dt = Math.min(50, Math.max(0, t - this.last));
    this.last = t;
    const { height } = this.opts.screen();
    let active = false;

    for (const [workId, entry] of this.live) {
      if (isIdle(entry.beat)) continue;
      const el = this.button(workId);
      if (!el) continue;
      const pose = stepBeat(entry.beat, t, dt, {
        target: entry.target,
        moving: t - entry.movedAt < BEAT.SETTLE_MS,
        variant: this.opts.variantOf(workId),
        gravity: "nano",
        floorY: height - 2,
        cameraLook: "hold",
        runFrames: Boolean(el.dataset.runA && el.dataset.runB),
        up: entry.up,
      });
      if (isIdle(entry.beat)) {
        clearPose(el);
        entry.beat = createBeat(0, entry.target, t);
        const drawn = entry.stance === "upright" ? "rest" : entry.stance === "origin" ? entry.origin : null;
        entry.stance = "contact";
        if (drawn) this.seat(workId, drawn, el.dataset.restArt);
        continue;
      }
      entry.stance = pose.stance;
      const ax = parseFloat(el.dataset.ax ?? "");
      const ay = parseFloat(el.dataset.ay ?? "");
      applyPose(el, pose, Number.isFinite(ax) && Number.isFinite(ay) ? { x: ax, y: ay } : entry.target);
      active = true;
    }

    for (const ghost of [...this.ghosts]) {
      if (ghost.away === "home" && !ghost.target) {
        // Wait for the home row to draw its slot, then scurry to it.
        const root = this.opts.root();
        const slot = root?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(ghost.workId)}"]:not([data-placed])`) ?? null;
        if (slot) {
          // The ghost layer's own page coordinates, like the placed figures'.
          const rect = slot.getBoundingClientRect();
          const origin = this.opts.ghosts()?.getBoundingClientRect() ?? { left: 0, top: 0 };
          ghost.target = slot;
          slot.style.visibility = "hidden";
          putAway(ghost.beat, t, { x: rect.left - origin.left + rect.width / 2, y: rect.bottom - origin.top }, "home", ghost.delay);
        } else if (t > ghost.lookUntil) {
          this.endGhost(ghost, true);
          continue;
        } else {
          active = true;
          continue;
        }
      }
      const pose = stepBeat(ghost.beat, t, dt, {
        target: ghost.beat.dest ?? ghost.start,
        moving: false,
        variant: this.opts.variantOf(ghost.workId) === "reduced" ? "reduced" : "scurry",
        gravity: "hover",
        floorY: height - 2,
      });
      if (ghost.beat.phase === "home" || ghost.beat.phase === "gone") {
        this.endGhost(ghost, ghost.away !== "leave");
        continue;
      }
      applyPose(ghost.el, pose, ghost.start);
      active = true;
    }

    this.report();
    if (active) this.raf = requestAnimationFrame(this.frame);
  };

  private endGhost(ghost: Ghost, restore: boolean): void {
    ghost.el.remove();
    this.ghosts = this.ghosts.filter((g) => g !== ghost);
    if (ghost.target) ghost.target.style.visibility = "";
    // Leaving keeps the real figure hidden until the panel is gone.
    if (restore && ghost.original?.isConnected) ghost.original.style.visibility = "";
    const done = ghost.done;
    ghost.done = null;
    done?.();
  }

  private report(): void {
    const ids = [...this.live].filter(([, e]) => !isIdle(e.beat)).map(([id]) => id).sort();
    const key = ids.join("\n");
    if (key !== this.chasing) {
      this.chasing = key;
      this.opts.onChasing(new Set(ids));
    }
    const stances = new Map<string, string>();
    for (const [id, entry] of this.live) {
      if (isIdle(entry.beat)) {
        const drawn = this.seating.get(id);
        if (drawn) stances.set(id, drawn);
        continue;
      }
      this.seating.delete(id);
      if (entry.stance === "upright") stances.set(id, "rest");
      else if (entry.stance === "origin" && entry.origin) stances.set(id, entry.origin);
    }
    const stanceKey = [...stances].map(([id, pose]) => `${id}=${pose}`).sort().join("\n");
    if (stanceKey === this.stances) return;
    this.stances = stanceKey;
    this.opts.onStances?.(stances);
  }
}

function applyPose(el: HTMLElement, pose: Pose, rendered: Pt): void {
  // Where it looks: crew with eye frames move their eyes (standing only: the
  // frames are cut for the standing drawing); the rest lean their head that way.
  const eyes = pose.stance === "upright" ? el.querySelector<HTMLImageElement>(".ce-fig__eyes") : null;
  const dir = el.dataset.eyes;
  if (eyes && dir) {
    const role = pose.gaze === "rest" ? null : pose.facing < 0 ? mirrorGaze(pose.gaze) : pose.gaze;
    const src = role ? `${dir}/${role}.webp` : "";
    if (eyes.dataset.role !== (role ?? "")) {
      eyes.dataset.role = role ?? "";
      if (src) eyes.setAttribute("src", src);
      eyes.style.visibility = src ? "visible" : "hidden";
    }
  } else if (pose.stance === "upright" && pose.gaze !== "rest" && pose.gaze !== "blink-half") {
    pose = { ...pose, ...lean(pose) };
  }
  el.style.transform = chaseTransform(pose, rendered);
  el.style.opacity = pose.opacity >= 0.999 ? "" : String(round(pose.opacity, 3));
  el.style.setProperty("--chase-flip", String(pose.facing));
  // Sprout has run frames: the legs go while it scurries.
  const img = el.querySelector<HTMLImageElement>(".ce-fig__art");
  const run = pose.stride === null ? null : el.dataset[pose.stride ? "runB" : "runA"];
  if (img) {
    if (run) {
      if (!img.dataset.restSrc) img.dataset.restSrc = img.getAttribute("src") ?? "";
      if (img.getAttribute("src") !== run) img.setAttribute("src", run);
    } else if (img.dataset.restSrc) {
      img.setAttribute("src", img.dataset.restSrc);
      delete img.dataset.restSrc;
    }
  }
}

/** A look without eyes to move: the head tips toward it, a nod for down. */
function lean(pose: Pose): Pick<Pose, "rot" | "sy" | "y"> {
  const side = pose.gaze.endsWith("left") ? -1 : pose.gaze.endsWith("right") ? 1 : 0;
  const down = pose.gaze.includes("down") ? 1 : pose.gaze.includes("up") ? -1 : 0;
  return { rot: pose.rot + side * 3, sy: pose.sy * (1 - 0.025 * down), y: pose.y + 0.5 * down };
}

function clearPose(el: HTMLElement): void {
  const eyes = el.querySelector<HTMLImageElement>(".ce-fig__eyes");
  if (eyes) {
    eyes.style.visibility = "hidden";
    eyes.dataset.role = "";
  }
  el.style.transform = "";
  el.style.opacity = "";
  el.style.removeProperty("--chase-flip");
  const img = el.querySelector<HTMLImageElement>(".ce-fig__art");
  if (img?.dataset.restSrc) {
    img.setAttribute("src", img.dataset.restSrc);
    delete img.dataset.restSrc;
  }
}
