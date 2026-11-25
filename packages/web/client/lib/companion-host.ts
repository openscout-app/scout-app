/**
 * The bridge between Scout web pages and the Mac app's desktop companion.
 *
 * The companion is a native panel, so the Mac app owns its state: which work
 * items are pinned (in pin order), where the panel sits, whether it is shown
 * or minimized. That state lives in the app's preferences, never in the broker
 * — pins are operator chrome, not coordination records. Two pages talk to it:
 * the companion itself (`/embed/companion`) and the work page when the Mac app
 * hosts it. In a plain browser there is no handler, `companionHostAvailable()`
 * is false, and pages leave out every companion control.
 *
 * Wire format (same shape as host-settings-bridge)
 *   page → host   postMessage({ kind: "companion-request", id, method, params })
 *   host → page   window.__scoutCompanionReply(id, { ok: true, value } | { ok: false, error })
 *   host → page   window.dispatchEvent(new CustomEvent("scout:companion", { detail: CompanionHostState }))
 *                 whenever pins, placement, presence or visibility change.
 *
 * Methods
 *   state                                   → CompanionHostState
 *   pin        { workId, machineId? }       → CompanionHostState  (also shows the panel)
 *   unpin      { workId }                   → CompanionHostState
 *   reorder    { workIds }                  → CompanionHostState  (must be the same set)
 *   minimize   { minimized }                → CompanionHostState
 *   layout     { width, height }            → null   (companion only: size the panel to its content)
 *   drag       { source: "grip" | "mark" }  → null   (companion only: pointer went down; host tracks the
 *                                                    mouse, throws to a corner, and treats an unmoved press
 *                                                    on the mark as the click that expands it)
 *   open       { target, workId, machineId?, conversationId? } → null
 *   open       { target: "session", sessionRef, machineId? } → null  (companion only: a native
 *                                                    session in its own window; see `openSessionInScout`)
 *   hide                                    → CompanionHostState
 *   preferences { restingOpacity?, alwaysOn?, preview?, mode?, originPins?, edgeAnchor?, edgeFloat? }
 *                                           → CompanionHostState  (companion only)
 *   regions    { regions: [{ id, x, y, width, height }] } → null  (companion only, edge mode: the
 *                                                    page rectangles that take the pointer; the
 *                                                    rest of the band passes through to the desktop)
 *   engage     { engaged }                  → null   (companion only: a menu is open; do not fade)
 *   notch      { edge: top|right|bottom|left|null } → CompanionHostState  (companion only, edge mode:
 *                                                    the board is a notch on this edge; on top the
 *                                                    panel draws over the menu bar, `edge.aboveMenuBar`)
 *   allow      { kind, id, label? }         → CompanionHostState  (operator grant to surface work here)
 *   disallow   { kind, id }                 → CompanionHostState
 *   figureDrag { workId }                   → null   (companion only, edge mode: pointer went down on a
 *                                                    pinned figure; the host tracks the mouse and places
 *                                                    it on release by the modifier held then)
 *   figure     { workId, size?, motion?, hidden?, home? } → CompanionHostState  (one pinned figure's
 *                                                    settings; size 16–96 or "default", motion
 *                                                    full|calm|still or "default", home: true only)
 *   figureNudge { workId, dx, dy }          → CompanionHostState  (arrow keys, |d| ≤ 100pt, page +y down)
 *   figurePlace { workId, x, y }            → CompanionHostState  (pop out from a menu: stand a pinned
 *                                                    figure free, feet at this page point)
 *   figureDefaults { size?, motion?, hold? } → CompanionHostState  (hold edge|iso|latch)
 *   figuresHome                             → CompanionHostState  ("Send all home")
 *   talk       { threadId }                 → { thread, control, listening }  (companion only: open this
 *                                                    Codex thread in the ChatGPT app and press its own
 *                                                    "Start voice chat"; refuses unless that thread shows)
 *   left                                    → null   (companion only: the put-away dash that a
 *                                                    `scout:companion-leave` asked for is done)
 *
 * Surfacing grants are operator choices. They let matching broker work
 * appear in the companion's Surfaced list with a badge; they never show the
 * panel, focus it, or answer anything. Default: no grants.
 *
 * Edge mode only, host → page:
 *   window.dispatchEvent(new CustomEvent("scout:companion-pointer", { detail: { id, outside } }))
 *   — which reported region the pointer is over (WebKit runs no hover in a
 *   panel that is not key), or that a click landed outside every region.
 *   window.dispatchEvent(new CustomEvent("scout:companion-figure-drag", { detail }))
 *   — during a figure drag `{ workId, x, y, mod, guide }` (page points, feet
 *   at the pointer; mod "alt" | "shift" | null; guide where that modifier
 *   would put it), then `{ workId: null, dropped, fall }` when it ends.
 *   window.dispatchEvent(new CustomEvent("scout:companion-anchors", { detail: { figures, falling, landing } }))
 *   — placed figures moved with their windows, hid, ghosted or fell; up to
 *   15 times a second while one rides on a window. Each anchor may carry
 *   `frame` (its window's page rect, so the page can tell a move from a
 *   resize) and `pending` (the window just left the screen; the host has not
 *   decided yet whether it closed). `landing` { workId: "window" | "edge" }
 *   marks the falling figures whose window closed or minimized, and what
 *   they fell onto; a shift-drop fall is in `falling` alone.
 *   window.dispatchEvent(new CustomEvent("scout:companion-leave", { detail: { ms } }))
 *   — the panel is about to hide: dash the placed figures off, then call
 *   `left`. The host hides after `ms` anyway.
 *   window.dispatchEvent(new CustomEvent("scout:companion-retract", { detail: { ms } }))
 *   — the notch is on and the panel is about to hide: slide the notch into
 *   its edge over `ms`. The host hides when that time is up; nothing answers.
 *
 * The host validates every field again; this module only keeps honest pages
 * from sending junk.
 */

export type CompanionCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type CompanionPin = {
  workId: string;
  machineId?: string | null;
};

export type CompanionScopeKind = "work" | "agent" | "project";

export type CompanionScope = {
  kind: CompanionScopeKind;
  /** Work id, agent id, or absolute project root. */
  id: string;
  label: string | null;
};

export type CompanionMode = "stack" | "edge";
export type CompanionEdgeAnchor = "left" | "right" | "floating";

/** An unknown anchor is the right end, as before floating existed. */
export function parseCompanionEdgeAnchor(value: unknown): CompanionEdgeAnchor {
  return value === "left" || value === "floating" ? value : "right";
}

/** A floating home row's position: a share of the edge's width from its left end, centred when unknown. */
export function clampEdgeFloat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}
export type CompanionDockEdge = "bottom" | "left" | "right" | "hidden";

/**
 * Edge placement the Mac app read from macOS: the band's size, which edge the
 * Dock holds (from the screen's visible-frame insets), and spans of Scout's
 * own windows that reach the edge. Other apps' windows are never in here.
 */
export type CompanionEdgeGeometry = {
  width: number;
  height: number;
  /** The panel covers the whole display; these are page rectangles in it. */
  band: CompanionRect | null;
  visible: CompanionRect | null;
  screen: { width: number; height: number } | null;
  /** The camera housing on a notched display, in page points; null elsewhere. */
  housing: CompanionRect | null;
  /** Scout Desk's notch while it is out on this display (its dictation, a question), in page points; null otherwise. */
  deskNotch: CompanionRect | null;
  /** The panel draws over the menu bar (the board is a notch on the top edge). */
  aboveMenuBar: boolean;
  anchor: CompanionEdgeAnchor;
  dock: CompanionDockEdge;
  obstacles: { start: number; end: number; label: string }[];
};

export type CompanionRect = { x: number; y: number; width: number; height: number };

export type CompanionSide = "bottom" | "top" | "left" | "right";
export type CompanionFigureMotion = "full" | "calm" | "still";
/** How figures attach: authored edge poses, or the original upright platform/latch. */
export type CompanionFigureHold = "edge" | "iso" | "latch";

/** Where the operator put a pinned figure. Fractions are of the visible frame. */
export type CompanionFigurePlacement =
  | { kind: "home" }
  | { kind: "free"; x: number; y: number }
  | { kind: "edge"; edge: CompanionSide; t: number }
  | { kind: "window"; side: CompanionSide; t: number };

/**
 * Where the host resolved a placed figure's contact, in page points. `down` is
 * the side its feet point to (null: upright, placed freely); `covered`: a
 * window in front hides its spot, so it ghosts; `away`: its window is on
 * another Space, hidden until it returns.
 */
export type CompanionFigureAnchor = {
  x: number;
  y: number;
  down: CompanionSide | null;
  covered: boolean;
  away: boolean;
  /** Explicit contact mode from the host; legacy hosts can omit it. */
  attachment?: "hang" | "sit" | "grip" | "stand";
  /** The window just left the screen; still drawn while the host waits to see if it closed. */
  pending?: boolean;
  /**
   * Placed under a window that has no room under it on the screen: the host
   * sits the figure on the window's top until there is room again.
   */
  squeezed?: boolean;
  /** The perch window's page rect, when the figure rides on one. */
  frame?: CompanionPageRect | null;
  /**
   * The ink its label reads in over the desktop picture under it, from the
   * host's sample of that picture. Absent on a window, or from an older
   * host: the page then draws light ink (figure-labels.ts deskLabelInk).
   */
  labelInk?: "dark" | "light";
};

export type CompanionPageRect = { x: number; y: number; w: number; h: number };

export type CompanionFigure = {
  workId: string;
  /** Saved hold; omitted/null follows the current default. */
  hold?: CompanionFigureHold | null;
  /** Window top: explicit underside hang or above-edge seat. */
  windowTop?: "hang" | "sit" | null;
  /** null follows the companion default. */
  size: number | null;
  motion: CompanionFigureMotion | null;
  hidden: boolean;
  placement: CompanionFigurePlacement;
  /** Edge mode only; null at home or while the host has not found its spot. */
  anchor: CompanionFigureAnchor | null;
  /** "Home row", "Standing on the Safari window", … */
  label: string;
};

export type CompanionFigureDefaults = { size: number; motion: CompanionFigureMotion; hold: CompanionFigureHold };

export const FIGURE_SIZE_MIN = 16;
export const FIGURE_SIZE_MAX = 96;
export const DEFAULT_FIGURE_DEFAULTS: CompanionFigureDefaults = { size: 24, motion: "full", hold: "edge" };

export type CompanionHitRegion = { id: string; x: number; y: number; width: number; height: number };

export type CompanionHostState = {
  pins: CompanionPin[];
  corner: CompanionCorner;
  minimized: boolean;
  /** Whether the companion panel is on screen. */
  visible: boolean;
  /** Panel opacity at rest, 0.25–1. */
  restingOpacity: number;
  /** Keep the mark on screen across launches even with nothing pinned. */
  alwaysOn: boolean;
  scopes: CompanionScope[];
  mode: CompanionMode;
  /** Edge mode: group characters by the conversation that launched them. */
  originPins: boolean;
  edgeAnchor: CompanionEdgeAnchor;
  /** Floating anchor: where the home row stands, 0 (left end) to 1 (right end). */
  edgeFloat: number;
  /** Native-read placement while in edge mode; null otherwise. */
  edge: CompanionEdgeGeometry | null;
  /** One per pin, in pin order. */
  figures: CompanionFigure[];
  /** Scoutbot's figure: no pin, always there, placed by the same rules. */
  scoutbot?: CompanionFigure;
  figureDefaults: CompanionFigureDefaults;
};

export const COMPANION_MAX_PINS = 200;
/** Same id as `ScoutCompanionState.scoutbotId`: Scoutbot's figure, which has no pin. */
export const SCOUTBOT_FIGURE_ID = "scoutbot";
/** Room for every figure (200 pins + surfaced), every origin pin, the
 *  controls and the popover, with headroom. The host enforces the same cap. */
export const COMPANION_MAX_REGIONS = 512;
/** Regions that must survive any trim: what the operator is reading or using. */
const PRIORITY_REGIONS = new Set(["popover", "home", "scoutbot", "scoutbot-card", "scoutbot-drag", "figure-menu"]);
export const DEFAULT_RESTING_OPACITY = 0.55;
export const RESTING_OPACITY_MIN = 0.25;

/** `session` opens a native session by its ref; see `openSessionInScout`. */
export type CompanionOpenTarget = "work" | "thread" | "session";

type Reply = { ok: true; value: unknown } | { ok: false; error: string };

type HandlerWindow = Window & {
  webkit?: { messageHandlers?: { scoutCompanion?: { postMessage: (body: unknown) => void } } };
  __scoutCompanionReply?: (id: string, reply: Reply) => void;
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CORNERS: readonly CompanionCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const SCOPE_KINDS: readonly CompanionScopeKind[] = ["work", "agent", "project"];
export const COMPANION_EVENT = "scout:companion";
export const COMPANION_POINTER_EVENT = "scout:companion-pointer";
export const COMPANION_FIGURE_DRAG_EVENT = "scout:companion-figure-drag";
export const COMPANION_ANCHORS_EVENT = "scout:companion-anchors";
export const COMPANION_LEAVE_EVENT = "scout:companion-leave";
/** The panel is about to hide with the notch on: put the notch away in its edge. */
export const COMPANION_RETRACT_EVENT = "scout:companion-retract";
/** The hotkey brought the panel in: the notch puts itself away when it is done with. */
export const COMPANION_SUMMONED_EVENT = "scout:companion-summoned";
/** The overlay chord (⌃⌥Space) went down: show or hide the attached agents. */
export const COMPANION_OVERLAY_EVENT = "scout:companion-overlay";
const SIDES: readonly CompanionSide[] = ["bottom", "top", "left", "right"];
const MOTIONS: readonly CompanionFigureMotion[] = ["full", "calm", "still"];
const DOCK_EDGES: readonly CompanionDockEdge[] = ["bottom", "left", "right", "hidden"];

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function parseRect(value: unknown): CompanionRect | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = finite(raw.x, -20_000, 20_000);
  const y = finite(raw.y, -20_000, 20_000);
  const width = finite(raw.width, 1, 20_000);
  const height = finite(raw.height, 1, 20_000);
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height };
}

function parseSize(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const width = finite(raw.width, 1, 20_000);
  const height = finite(raw.height, 1, 20_000);
  return width === null || height === null ? null : { width, height };
}

export function isFigureSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= FIGURE_SIZE_MIN && value <= FIGURE_SIZE_MAX;
}

function isMotion(value: unknown): value is CompanionFigureMotion {
  return MOTIONS.includes(value as CompanionFigureMotion);
}

export const FIGURE_HOLDS: readonly CompanionFigureHold[] = ["edge", "iso", "latch"];

function isHold(value: unknown): value is CompanionFigureHold {
  return FIGURE_HOLDS.includes(value as CompanionFigureHold);
}

function isSide(value: unknown): value is CompanionSide {
  return SIDES.includes(value as CompanionSide);
}

/** Narrow a placement; window ids and display ids stay with the host. */
export function parseCompanionFigurePlacement(value: unknown): CompanionFigurePlacement {
  if (!value || typeof value !== "object") return { kind: "home" };
  const raw = value as Record<string, unknown>;
  const unit = (n: unknown) => finite(n, 0, 1);
  if (raw.kind === "free" && unit(raw.x) !== null && unit(raw.y) !== null) return { kind: "free", x: raw.x as number, y: raw.y as number };
  if (raw.kind === "edge" && isSide(raw.edge) && unit(raw.t) !== null) return { kind: "edge", edge: raw.edge, t: raw.t as number };
  if (raw.kind === "window" && isSide(raw.side) && unit(raw.t) !== null) return { kind: "window", side: raw.side, t: raw.t as number };
  return { kind: "home" };
}

export function parseCompanionFigureAnchor(value: unknown): CompanionFigureAnchor | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = finite(raw.x, -20_000, 20_000);
  const y = finite(raw.y, -20_000, 20_000);
  if (x === null || y === null) return null;
  const anchor: CompanionFigureAnchor = { x, y, down: isSide(raw.down) ? raw.down : null, covered: raw.covered === true, away: raw.away === true };
  if (["hang", "sit", "grip", "stand"].includes(raw.attachment as string)) anchor.attachment = raw.attachment as NonNullable<CompanionFigureAnchor["attachment"]>;
  if (raw.pending === true) anchor.pending = true;
  if (raw.squeezed === true) anchor.squeezed = true;
  if ("frame" in raw) anchor.frame = parsePageRect(raw.frame);
  if (raw.labelInk === "dark" || raw.labelInk === "light") anchor.labelInk = raw.labelInk;
  return anchor;
}

function parsePageRect(value: unknown): CompanionPageRect | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = finite(raw.x, -20_000, 20_000);
  const y = finite(raw.y, -20_000, 20_000);
  const w = finite(raw.w, 0, 40_000);
  const h = finite(raw.h, 0, 40_000);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

function cleanLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

/** One figure per pin, in pin order; a missing or malformed entry is a default figure. */
export function parseCompanionFigures(value: unknown, pins: readonly CompanionPin[]): CompanionFigure[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (isCompanionId(raw.workId) && !byId.has(raw.workId)) byId.set(raw.workId, raw);
  }
  return pins.map(({ workId }) => {
    const raw = byId.get(workId) ?? {};
    const placement = parseCompanionFigurePlacement(raw.placement);
    return {
      workId,
      ...(isHold(raw.hold) ? { hold: raw.hold } : {}),
      ...(raw.windowTop === "hang" || raw.windowTop === "sit" ? { windowTop: raw.windowTop } : {}),
      size: isFigureSize(raw.size) ? raw.size : null,
      motion: isMotion(raw.motion) ? raw.motion : null,
      hidden: raw.hidden === true,
      placement,
      anchor: placement.kind === "home" ? null : parseCompanionFigureAnchor(raw.anchor),
      label: cleanLabel(raw.label, placement.kind === "home" ? "Home row" : "Placed"),
    };
  });
}

export function parseCompanionFigureDefaults(value: unknown): CompanionFigureDefaults {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    size: isFigureSize(raw.size) ? raw.size : DEFAULT_FIGURE_DEFAULTS.size,
    motion: isMotion(raw.motion) ? raw.motion : DEFAULT_FIGURE_DEFAULTS.motion,
    hold: isHold(raw.hold) ? raw.hold : DEFAULT_FIGURE_DEFAULTS.hold,
  };
}

/** Narrow the host's edge geometry; anything malformed becomes null. */
export function parseCompanionEdgeGeometry(value: unknown): CompanionEdgeGeometry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const width = finite(raw.width, 1, 20_000);
  const height = finite(raw.height, 1, 20_000);
  if (width === null || height === null) return null;
  const obstacles: CompanionEdgeGeometry["obstacles"] = [];
  for (const entry of Array.isArray(raw.obstacles) ? raw.obstacles.slice(0, 12) : []) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const start = finite(o.start, 0, width);
    const end = finite(o.end, 0, width);
    if (start === null || end === null || end <= start) continue;
    obstacles.push({ start, end, label: typeof o.label === "string" ? o.label.slice(0, 80) : "Scout window" });
  }
  return {
    width,
    height,
    band: parseRect(raw.band),
    visible: parseRect(raw.visible),
    screen: parseSize(raw.screen),
    housing: parseRect(raw.housing),
    deskNotch: parseRect(raw.deskNotch),
    aboveMenuBar: raw.aboveMenuBar === true,
    anchor: parseCompanionEdgeAnchor(raw.anchor),
    dock: DOCK_EDGES.includes(raw.dock as CompanionDockEdge) ? raw.dock as CompanionDockEdge : "hidden",
    obstacles,
  };
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let sequence = 0;

export function isCompanionId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function handler() {
  if (typeof window === "undefined") return null;
  return (window as HandlerWindow).webkit?.messageHandlers?.scoutCompanion ?? null;
}

/** Same rule as `ScoutCompanionRequest.isValidProjectRoot`. */
export function isCompanionProjectRoot(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/")
    && value.length >= 2
    && new TextEncoder().encode(value).length <= 512
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isCompanionScopeId(kind: CompanionScopeKind, id: unknown): id is string {
  return kind === "project" ? isCompanionProjectRoot(id) : isCompanionId(id);
}

export function companionHostAvailable(): boolean {
  return handler() !== null;
}

/** Narrow an untrusted host payload; anything malformed becomes null. */
export function parseCompanionHostState(value: unknown): CompanionHostState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.pins)) return null;
  const pins: CompanionPin[] = [];
  const seen = new Set<string>();
  for (const entry of raw.pins) {
    if (!entry || typeof entry !== "object") continue;
    const pin = entry as Record<string, unknown>;
    if (!isCompanionId(pin.workId) || seen.has(pin.workId)) continue;
    seen.add(pin.workId);
    pins.push({ workId: pin.workId, machineId: isCompanionId(pin.machineId) ? pin.machineId : null });
  }
  const corner = CORNERS.includes(raw.corner as CompanionCorner) ? raw.corner as CompanionCorner : "bottom-right";
  const opacity = typeof raw.restingOpacity === "number" && Number.isFinite(raw.restingOpacity)
    ? Math.min(1, Math.max(RESTING_OPACITY_MIN, raw.restingOpacity))
    : DEFAULT_RESTING_OPACITY;
  const scopes: CompanionScope[] = [];
  const seenScopes = new Set<string>();
  for (const entry of Array.isArray(raw.scopes) ? raw.scopes : []) {
    if (!entry || typeof entry !== "object") continue;
    const scope = entry as Record<string, unknown>;
    const kind = scope.kind as CompanionScopeKind;
    if (!SCOPE_KINDS.includes(kind) || !isCompanionScopeId(kind, scope.id)) continue;
    const key = `${kind}:${scope.id}`;
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    scopes.push({ kind, id: scope.id, label: typeof scope.label === "string" && scope.label.trim() ? scope.label.trim().slice(0, 80) : null });
  }
  return {
    pins,
    corner,
    minimized: raw.minimized === true,
    visible: raw.visible !== false,
    restingOpacity: opacity,
    alwaysOn: raw.alwaysOn === true,
    scopes,
    mode: raw.mode === "edge" ? "edge" : "stack",
    originPins: raw.originPins !== false,
    edgeAnchor: parseCompanionEdgeAnchor(raw.edgeAnchor),
    edgeFloat: clampEdgeFloat(raw.edgeFloat),
    edge: raw.mode === "edge" ? parseCompanionEdgeGeometry(raw.edge) : null,
    figures: parseCompanionFigures(raw.figures, pins),
    scoutbot: parseCompanionFigures(raw.figures, [{ workId: SCOUTBOT_FIGURE_ID }])[0],
    figureDefaults: parseCompanionFigureDefaults(raw.figureDefaults),
  };
}

function installReply() {
  const w = window as HandlerWindow;
  if (w.__scoutCompanionReply) return;
  w.__scoutCompanionReply = (id, reply) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (reply?.ok) entry.resolve(reply.value);
    else entry.reject(new Error(reply?.error || "The Scout app could not do that."));
  };
}

function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const h = handler();
  if (!h) return Promise.reject(new Error("The desktop companion needs the Scout app."));
  installReply();
  const id = `c${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("The Scout app did not answer."));
    }, 8000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    h.postMessage({ kind: "companion-request", id, method, params: params ?? {} });
  });
}

async function callState(method: string, params?: Record<string, unknown>): Promise<CompanionHostState> {
  const state = parseCompanionHostState(await call<unknown>(method, params));
  if (!state) throw new Error("The Scout app sent an unreadable companion state.");
  return state;
}

export function readCompanionState(): Promise<CompanionHostState> {
  return callState("state");
}

export function pinToCompanion(workId: string, machineId?: string | null): Promise<CompanionHostState> {
  if (!isCompanionId(workId)) return Promise.reject(new Error("That work id cannot be pinned."));
  return callState("pin", isCompanionId(machineId) ? { workId, machineId } : { workId });
}

export function unpinFromCompanion(workId: string): Promise<CompanionHostState> {
  if (!isCompanionId(workId)) return Promise.reject(new Error("That work id cannot be unpinned."));
  return callState("unpin", { workId });
}

export function reorderCompanion(workIds: readonly string[]): Promise<CompanionHostState> {
  return callState("reorder", { workIds: workIds.filter(isCompanionId) });
}

export function setCompanionMinimized(minimized: boolean): Promise<CompanionHostState> {
  return callState("minimize", { minimized });
}

/** The board is a notch on this edge, or none. A host without notch support refuses; the slot then stays under the menu bar. */
export function setCompanionNotch(edge: "top" | "right" | "bottom" | "left" | null): Promise<CompanionHostState> {
  return callState("notch", { edge });
}

export function hideCompanion(): Promise<CompanionHostState> {
  return callState("hide");
}

export function reportCompanionLayout(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  void call("layout", { width: Math.ceil(width), height: Math.ceil(height) }).catch(() => {});
}

export function beginCompanionDrag(source: "grip" | "mark" = "grip"): void {
  void call("drag", { source }).catch(() => {});
}

export type CompanionPreferences = {
  restingOpacity?: number;
  alwaysOn?: boolean;
  preview?: boolean;
  mode?: CompanionMode;
  originPins?: boolean;
  edgeAnchor?: CompanionEdgeAnchor;
  edgeFloat?: number;
};

export function setCompanionPreferences(prefs: CompanionPreferences): Promise<CompanionHostState> {
  const params: Record<string, unknown> = {};
  if (prefs.mode === "stack" || prefs.mode === "edge") params.mode = prefs.mode;
  if (typeof prefs.originPins === "boolean") params.originPins = prefs.originPins;
  if (prefs.edgeAnchor === "left" || prefs.edgeAnchor === "right" || prefs.edgeAnchor === "floating") params.edgeAnchor = prefs.edgeAnchor;
  if (typeof prefs.edgeFloat === "number" && Number.isFinite(prefs.edgeFloat)) params.edgeFloat = clampEdgeFloat(prefs.edgeFloat);
  if (typeof prefs.restingOpacity === "number" && Number.isFinite(prefs.restingOpacity)) {
    params.restingOpacity = Math.min(1, Math.max(RESTING_OPACITY_MIN, prefs.restingOpacity));
  }
  if (typeof prefs.alwaysOn === "boolean") params.alwaysOn = prefs.alwaysOn;
  if (prefs.preview) params.preview = true;
  return callState("preferences", params);
}

/** The page re-sends its last report this often; the host lets a report lapse after about three missed (`regionLifetime`). */
export const COMPANION_REGION_RENEW_MS = 3000;

/**
 * Each report's number. The host drops a report older than one it already took. It starts at the clock, so a
 * reloaded page counts on from the one before it.
 */
let regionGeneration = Date.now();
let lastRegions: CompanionHitRegion[] = [];
let renewTimer: ReturnType<typeof setInterval> | null = null;

function sendRegions(): void {
  regionGeneration += 1;
  void call("regions", { regions: lastRegions, generation: regionGeneration }).catch(() => {});
}

/**
 * Edge mode: the rectangles that take the pointer, in page points. Anything
 * outside them passes through to the desktop. Invalid entries are dropped
 * here; the host refuses the whole report if one slips through. Each report
 * is numbered and renewed while it holds anything: a page that stops
 * running stops renewing, and the host lets its regions go.
 */
export function reportCompanionHitRegions(regions: readonly CompanionHitRegion[]): void {
  lastRegions = budgetHitRegions(regions)
    .map((r) => ({ id: r.id, x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }));
  sendRegions();
  if (lastRegions.length > 0 && !renewTimer) renewTimer = setInterval(sendRegions, COMPANION_REGION_RENEW_MS);
  else if (lastRegions.length === 0) stopCompanionRegionRenewal();
}

/** Stop re-sending the last report (the page is going, or a test is over). */
export function stopCompanionRegionRenewal(): void {
  if (renewTimer) clearInterval(renewTimer);
  renewTimer = null;
}

/**
 * Valid regions, at most `max`, in their original order (the host treats a
 * later region as drawn on top). Over budget, the popover and home always
 * stay; the rest are kept first to last.
 */
export function budgetHitRegions(regions: readonly CompanionHitRegion[], max = COMPANION_MAX_REGIONS): CompanionHitRegion[] {
  const valid = regions.filter((r) => isCompanionId(r.id)
    && [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n) && Math.abs(n) <= 20_000)
    && r.width > 0 && r.height > 0);
  if (valid.length <= max) return valid;
  const priority = valid.filter((r) => PRIORITY_REGIONS.has(r.id)).slice(0, max);
  let room = max - priority.length;
  return valid.filter((r) => {
    if (PRIORITY_REGIONS.has(r.id)) return priority.includes(r);
    if (room <= 0) return false;
    room -= 1;
    return true;
  });
}

/** A desk figure's label, where the page draws it, so the host can read the desktop picture under it. */
export type CompanionLabelRect = { workId: string; x: number; y: number; width: number; height: number };

/** Edge mode: where each desk figure's label is drawn. The host answers with `labelInk` on the anchors. */
export function reportCompanionLabels(labels: readonly CompanionLabelRect[]): void {
  const clean = labels
    .filter((l) => isCompanionId(l.workId)
      && [l.x, l.y, l.width, l.height].every((n) => Number.isFinite(n) && Math.abs(n) <= 20_000)
      && l.width > 0 && l.height > 0)
    .slice(0, COMPANION_MAX_REGIONS)
    .map((l) => ({ id: l.workId, x: Math.round(l.x), y: Math.round(l.y), width: Math.round(l.width), height: Math.round(l.height) }));
  void call("labels", { labels: clean }).catch(() => {});
}

/** Edge mode: the host's pointer reports. Returns the unsubscribe function. */
export function onCompanionPointer(listener: (event: { id: string | null; outside: boolean }) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent).detail as { id?: unknown; outside?: unknown } | null;
    if (!detail || typeof detail !== "object") return;
    listener({ id: isCompanionId(detail.id) ? detail.id : null, outside: detail.outside === true });
  };
  window.addEventListener(COMPANION_POINTER_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_POINTER_EVENT, onEvent);
}

/** A reply field opened: ask the host to make the panel key so typing lands. */
export function focusCompanionInput(): void {
  void call("focusInput").catch(() => {});
}

let engagedNow = false;

/** Tell the host a menu or sheet is open, so the panel does not fade under it. */
export function setCompanionEngaged(engaged: boolean): void {
  engagedNow = engaged;
  void call("engage", { engaged }).catch(() => {});
}

/** Whether the page last told the host a menu or sheet is open. */
export function companionEngaged(): boolean {
  return engagedNow;
}

export function allowCompanionScope(kind: CompanionScopeKind, id: string, label?: string | null): Promise<CompanionHostState> {
  if (!isCompanionScopeId(kind, id)) return Promise.reject(new Error("That source cannot be allowed."));
  const params: Record<string, unknown> = { kind, id };
  if (label?.trim()) params.label = label.trim().slice(0, 80);
  return callState("allow", params);
}

export function disallowCompanionScope(kind: CompanionScopeKind, id: string): Promise<CompanionHostState> {
  if (!isCompanionScopeId(kind, id)) return Promise.reject(new Error("That source cannot be removed."));
  return callState("disallow", { kind, id });
}

export function openFromCompanion(
  target: Exclude<CompanionOpenTarget, "session">,
  ids: { workId: string; machineId?: string | null; conversationId?: string | null },
): Promise<unknown> {
  if (!isCompanionId(ids.workId)) return Promise.reject(new Error("That work id cannot be opened."));
  const params: Record<string, unknown> = { target, workId: ids.workId };
  if (isCompanionId(ids.machineId)) params.machineId = ids.machineId;
  if (isCompanionId(ids.conversationId)) params.conversationId = ids.conversationId;
  return call("open", params);
}

/** A native session ref as the board carries it (`formatSessionRouteRef`):
 *  `session:<harness>:<id>`, e.g. `session:claude:<uuid>`, or the bare `<id>`
 *  for a row whose harness is unknown; the session viewer resolves either
 *  (`/api/session-ref/:id`). Same rule as `ScoutCompanionRequest.isValidSessionRef`. */
const SESSION_REF_PATTERN = /^(?:session:[a-z][a-z0-9-]{0,31}:)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isCompanionSessionRef(value: unknown): value is string {
  return typeof value === "string" && SESSION_REF_PATTERN.test(value);
}

/** Open session: a native session (Claude, Codex…) in its own Scout window,
 *  the session viewer; an open one comes to the front. Resolves true when the
 *  host opened it, false without the Mac host, for a ref the host would refuse,
 *  or from an app build without the `session` target. Never rejects. */
export async function openSessionInScout(sessionRef: string, machineId?: string | null): Promise<boolean> {
  if (!companionHostAvailable() || !isCompanionSessionRef(sessionRef)) return false;
  const params: Record<string, unknown> = { target: "session", sessionRef };
  if (isCompanionId(machineId)) params.machineId = machineId;
  try {
    await call("open", params);
    return true;
  } catch {
    return false;
  }
}

export type CompanionTalk = { thread: string; control: string | null; listening: boolean };

/** A figure's Talk: Codex's own voice chat, in the ChatGPT app, in this thread. */
export function talkInCodex(threadId: string): Promise<CompanionTalk> {
  if (!isCompanionId(threadId)) return Promise.reject(new Error("That thread cannot be talked to."));
  return call<CompanionTalk>("talk", { threadId });
}

/** Codex voice in the ChatGPT app: on at all, which of the asked threads has
 *  it, and its microphone and speakers (absent when the app shows no toggle). */
export type CompanionVoiceState = { active: boolean; thread: string | null; micMuted?: boolean; speakersMuted?: boolean };
export type CompanionVoiceControl = "microphone" | "speakers" | "stop";

const voiceListeners = new Set<(state: CompanionVoiceState) => void>();

/** Every voice reading, polled or after a press. Returns the unsubscribe function. */
export function onCodexVoiceState(listener: (state: CompanionVoiceState) => void): () => void {
  voiceListeners.add(listener);
  return () => voiceListeners.delete(listener);
}

function announceVoice(state: CompanionVoiceState): CompanionVoiceState {
  for (const listener of [...voiceListeners]) listener(state);
  return state;
}

export function codexVoiceState(threadIds: readonly string[]): Promise<CompanionVoiceState> {
  const ids = threadIds.filter(isCompanionId);
  return call<CompanionVoiceState>("voiceState", { threadIds: ids }).then(announceVoice);
}

/** Press the running voice chat's own control. `muted` is the state wanted. */
export function pressCodexVoice(control: CompanionVoiceControl, options: { muted?: boolean; threadIds?: readonly string[] } = {}): Promise<CompanionVoiceState> {
  const threadIds = (options.threadIds ?? []).filter(isCompanionId);
  return call<CompanionVoiceState>("voicePress", { control, threadIds, ...(options.muted === undefined ? {} : { muted: options.muted }) }).then(announceVoice);
}

/** Subscribe to host-pushed state. Returns the unsubscribe function. */
export function onCompanionState(listener: (state: CompanionHostState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const state = parseCompanionHostState((event as CustomEvent).detail);
    if (state) listener(state);
  };
  window.addEventListener(COMPANION_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_EVENT, onEvent);
}

// ── Figures you place (edge mode) ─────────────────────────────────────

/** Pointer went down on a pinned figure: the host takes the drag from here. */
export function beginFigureDrag(workId: string): void {
  if (!isCompanionId(workId)) return;
  void call("figureDrag", { workId }).catch(() => {});
}

export type CompanionFigurePatch = {
  hold?: CompanionFigureHold | "default";
  windowTop?: "hang" | "sit";
  size?: number | "default";
  motion?: CompanionFigureMotion | "default";
  hidden?: boolean;
  home?: true;
};

export function setCompanionFigure(workId: string, patch: CompanionFigurePatch): Promise<CompanionHostState> {
  if (!isCompanionId(workId)) return Promise.reject(new Error("That figure cannot be changed."));
  const params: Record<string, unknown> = { workId };
  if (patch.hold === "default" || isHold(patch.hold)) params.hold = patch.hold;
  if (patch.windowTop === "hang" || patch.windowTop === "sit") params.windowTop = patch.windowTop;
  if (patch.size === "default" || isFigureSize(patch.size)) params.size = patch.size;
  if (patch.motion === "default" || isMotion(patch.motion)) params.motion = patch.motion;
  if (typeof patch.hidden === "boolean") params.hidden = patch.hidden;
  if (patch.home === true) params.home = true;
  if (Object.keys(params).length === 1) return Promise.reject(new Error("Nothing to change."));
  return callState("figure", params);
}

export const FIGURE_NUDGE_MAX = 100;

export function nudgeCompanionFigure(workId: string, dx: number, dy: number): Promise<CompanionHostState> {
  const ok = (n: number) => Number.isFinite(n) && Math.abs(n) <= FIGURE_NUDGE_MAX;
  if (!isCompanionId(workId) || !ok(dx) || !ok(dy)) return Promise.reject(new Error("That figure cannot be moved."));
  return callState("figureNudge", { workId, dx, dy });
}

/** Pop out from a menu, with no drag to carry it: the host stands the pinned figure, upright and free, feet at this page point. */
export function placeCompanionFigure(workId: string, x: number, y: number): Promise<CompanionHostState> {
  const ok = (n: number) => Number.isFinite(n) && Math.abs(n) <= 100_000;
  if (!isCompanionId(workId) || !ok(x) || !ok(y)) return Promise.reject(new Error("That figure cannot be placed."));
  return callState("figurePlace", { workId, x, y });
}

export function setCompanionFigureDefaults(patch: Partial<CompanionFigureDefaults>): Promise<CompanionHostState> {
  const params: Record<string, unknown> = {};
  if (isFigureSize(patch.size)) params.size = patch.size;
  if (isMotion(patch.motion)) params.motion = patch.motion;
  if (isHold(patch.hold)) params.hold = patch.hold;
  if (!Object.keys(params).length) return Promise.reject(new Error("Nothing to change."));
  return callState("figureDefaults", params);
}

export function sendCompanionFiguresHome(): Promise<CompanionHostState> {
  return callState("figuresHome");
}

/** Where the board lands after the host moved the panel to another display: its box and that display's size, in page points. */
export type CompanionDisplayMove = { rect: { left: number; top: number; width: number; height: number }; width: number; height: number };

export function parseCompanionDisplayMove(value: unknown): CompanionDisplayMove | null {
  const v = value as { moved?: unknown; rect?: Record<string, unknown>; width?: unknown; height?: unknown } | null;
  if (!v || v.moved !== true || !v.rect) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const left = n(v.rect.x), top = n(v.rect.y), width = n(v.rect.width), height = n(v.rect.height), w = n(v.width), h = n(v.height);
  if (left === null || top === null || width === null || height === null || !w || !h) return null;
  return { rect: { left, top, width, height }, width: w, height: h };
}

/**
 * Edge mode: the board's pointer is off this display, mid-move or let go. The
 * host moves the panel to the display under the pointer and answers where the
 * board's box is on the new page; null when it stayed.
 */
export async function moveCompanionToPointerDisplay(box: { left: number; top: number; width: number; height: number }): Promise<CompanionDisplayMove | null> {
  if (![box.left, box.top, box.width, box.height].every(Number.isFinite)) return null;
  return parseCompanionDisplayMove(await call<unknown>("toPointerDisplay", { x: box.left, y: box.top, width: box.width, height: box.height }));
}

/**
 * The box the operator last pressed in the page, and when: Scout's pointer
 * leaves from it (`pointCompanionAt`). A row, a button or a choice card, not
 * the whole board, so the curve starts at the thing that was clicked.
 */
let pressed: { left: number; top: number; width: number; height: number; at: number } | null = null;
/** An older press is not where this jump came from. */
const PRESS_FRESH_MS = 15_000;

/** Remember a pressed box, in page points. An empty or broken box is ignored. */
export function noteCompanionPress(box: { left: number; top: number; width: number; height: number }, at = Date.now()): void {
  const parts = [box.left, box.top, box.width, box.height];
  if (!parts.every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
  pressed = { left: box.left, top: box.top, width: box.width, height: box.height, at };
}

function recordPress(event: Event): void {
  const target = typeof Element !== "undefined" && event.target instanceof Element ? event.target : null;
  const box = (target?.closest("button, a, li, [role='button']") ?? target)?.getBoundingClientRect();
  if (box) noteCompanionPress(box);
}

// The companion's message handler is in place before its page loads.
if (typeof document !== "undefined" && companionHostAvailable()) document.addEventListener("pointerdown", recordPress, true);

type PageBox = { left: number; top: number; width: number; height: number };

function goodBox(box: PageBox | null | undefined): box is PageBox {
  return Boolean(box) && [box!.left, box!.top, box!.width, box!.height].every(Number.isFinite) && box!.width > 0 && box!.height > 0;
}

/**
 * A pop-out: a terminal window the server opened on a session's attach
 * command. `token` is the one open-terminal returned; `clear` is what the host
 * places the window clear of (`companionKeepClear`).
 */
export type CompanionPopOut = { token: string; clear: PageBox | null };

/** A pop-out token as the server mints it: 32 lowercase hex characters. */
export function isPopOutToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}

/**
 * Jump brought this app's window to the front: ask the host to dim the rest
 * and point at it, from what the operator pressed. The app is the one the
 * server verified for the session; the host checks it again. Quiet outside the
 * companion, and when the host points at nothing.
 *
 * With `popOut`, the window is one the server just opened: the host first
 * moves it beside the board, clear of `popOut.clear`, and gives it a Done tab
 * (`onCompanionPopOutDone`).
 */
export function pointCompanionAt(app: { pid: number; bundleId: string }, popOut?: CompanionPopOut): void {
  if (!companionHostAvailable() || !Number.isInteger(app.pid) || app.pid <= 0 || !app.bundleId) return;
  const from = pressed && Date.now() - pressed.at < PRESS_FRESH_MS
    ? { x: pressed.left, y: pressed.top, width: pressed.width, height: pressed.height }
    : {};
  const out = popOut && isPopOutToken(popOut.token)
    ? { popOut: popOut.token, ...(goodBox(popOut.clear) ? { clear: { x: popOut.clear.left, y: popOut.clear.top, width: popOut.clear.width, height: popOut.clear.height } } : {}) }
    : {};
  void call("point", { pid: app.pid, bundleId: app.bundleId, ...from, ...out }).catch(() => {});
}

/**
 * The page is about to ask the server for a pop-out. The host notes the
 * moment, so the only window it later moves is one opened after it. Quiet
 * outside the companion.
 */
export function noteCompanionPopOutOpening(): void {
  if (!companionHostAvailable()) return;
  void call("popOutOpening").catch(() => {});
}

/**
 * A pop-out's attach is gone (Done hung it up, or it had already ended): the
 * host closes its window if the terminal app left it open, so Done is one
 * press. Quiet outside the companion.
 */
export function noteCompanionPopOutClosed(token: string): void {
  if (!companionHostAvailable() || !isPopOutToken(token)) return;
  void call("popOutClosed", { popOut: token }).catch(() => {});
}

/** The smallest box holding every good box; null when there is none. */
export function unionBoxes(boxes: readonly PageBox[]): PageBox | null {
  const good = boxes.filter(goodBox);
  if (good.length === 0) return null;
  const left = Math.min(...good.map((b) => b.left));
  const top = Math.min(...good.map((b) => b.top));
  const right = Math.max(...good.map((b) => b.left + b.width));
  const bottom = Math.max(...good.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** What a pop-out is placed clear of: the board and any panel open beside it, in page points. */
export function companionKeepClear(root: ParentNode | null = typeof document === "undefined" ? null : document): PageBox | null {
  if (!root) return null;
  return unionBoxes([...root.querySelectorAll(".arv-board, .tap-panel")].map((el) => el.getBoundingClientRect()));
}

const COMPANION_POPOUT_EVENT = "scout:companion-popout";

/** Done was pressed on a pop-out's tab: `listener` gets its token. Returns the unsubscribe function. */
export function onCompanionPopOutDone(listener: (token: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const token = ((event as CustomEvent).detail as Record<string, unknown> | null)?.popOut;
    if (isPopOutToken(token)) listener(token);
  };
  window.addEventListener(COMPANION_POPOUT_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_POPOUT_EVENT, onEvent);
}

/** The leave dash is done: the host may hide the panel now. */
export function reportCompanionLeft(): void {
  void call("left").catch(() => {});
}

/** The panel is about to hide (`ms`: how long the host waits). Returns the unsubscribe function. */
export function onCompanionLeave(listener: (ms: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent).detail as Record<string, unknown> | null;
    listener(finite(detail?.ms, 0, 5_000) ?? 700);
  };
  window.addEventListener(COMPANION_LEAVE_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_LEAVE_EVENT, onEvent);
}

/** The notch is about to hide (`ms`: how long its slide into the edge has). Returns the unsubscribe function. */
export function onCompanionRetract(listener: (ms: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent).detail as Record<string, unknown> | null;
    listener(finite(detail?.ms, 0, 1_000) ?? 160);
  };
  window.addEventListener(COMPANION_RETRACT_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_RETRACT_EVENT, onEvent);
}

/** The hotkey showed the panel (not the menu). Returns the unsubscribe function. */
export function onCompanionSummoned(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = () => listener();
  window.addEventListener(COMPANION_SUMMONED_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_SUMMONED_EVENT, onEvent);
}

type PagePoint = { x: number; y: number };
export type CompanionFigureGuide =
  | { kind: "perch"; spot: PagePoint; from: PagePoint | null; to: PagePoint | null; horizontal: boolean }
  | { kind: "fall"; spot: PagePoint; horizontal: boolean };

export type CompanionFigureDrag =
  | { workId: string; x: number; y: number; mod: "alt" | "shift" | null; guide: CompanionFigureGuide | null }
  | { workId: null; dropped: string | null; fall: boolean };

function parsePoint(value: unknown): PagePoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = finite(raw.x, -20_000, 20_000);
  const y = finite(raw.y, -20_000, 20_000);
  return x === null || y === null ? null : { x, y };
}

export function parseCompanionFigureDrag(value: unknown): CompanionFigureDrag | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.workId === null) {
    return { workId: null, dropped: isCompanionId(raw.dropped) ? raw.dropped : null, fall: raw.fall === true };
  }
  if (!isCompanionId(raw.workId)) return null;
  const at = parsePoint(raw);
  if (!at) return null;
  const mod = raw.mod === "alt" || raw.mod === "shift" ? raw.mod : null;
  let guide: CompanionFigureGuide | null = null;
  if (raw.guide && typeof raw.guide === "object") {
    const g = raw.guide as Record<string, unknown>;
    const spot = parsePoint(g.spot);
    const horizontal = g.horizontal !== false;
    if (spot && g.kind === "perch") guide = { kind: "perch", spot, from: parsePoint(g.from), to: parsePoint(g.to), horizontal };
    else if (spot && g.kind === "fall") guide = { kind: "fall", spot, horizontal };
  }
  return { workId: raw.workId, x: at.x, y: at.y, mod, guide };
}

/** Figure drags tracked by the host. Returns the unsubscribe function. */
export function onCompanionFigureDrag(listener: (drag: CompanionFigureDrag) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const drag = parseCompanionFigureDrag((event as CustomEvent).detail);
    if (drag) listener(drag);
  };
  window.addEventListener(COMPANION_FIGURE_DRAG_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_FIGURE_DRAG_EVENT, onEvent);
}

export type CompanionAnchorUpdate = {
  anchors: Map<string, { anchor: CompanionFigureAnchor | null; label: string | null }>;
  falling: string[];
  /** Falling because the window closed or minimized: what each landed on. */
  landing: Map<string, "window" | "edge">;
};

export function parseCompanionAnchors(value: unknown): CompanionAnchorUpdate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const anchors: CompanionAnchorUpdate["anchors"] = new Map();
  for (const entry of Array.isArray(raw.figures) ? raw.figures.slice(0, COMPANION_MAX_PINS + 1) : []) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    if (!isCompanionId(f.workId)) continue;
    anchors.set(f.workId, { anchor: parseCompanionFigureAnchor(f.anchor), label: typeof f.label === "string" ? cleanLabel(f.label, "") || null : null });
  }
  const falling = (Array.isArray(raw.falling) ? raw.falling : []).filter(isCompanionId);
  const landing: CompanionAnchorUpdate["landing"] = new Map();
  if (raw.landing && typeof raw.landing === "object") {
    for (const [workId, kind] of Object.entries(raw.landing as Record<string, unknown>)) {
      if (falling.includes(workId) && (kind === "window" || kind === "edge")) landing.set(workId, kind);
    }
  }
  return { anchors, falling, landing };
}

/** Placed figures riding on windows. Returns the unsubscribe function. */
export function onCompanionAnchors(listener: (update: CompanionAnchorUpdate) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (event: Event) => {
    const update = parseCompanionAnchors((event as CustomEvent).detail);
    if (update) listener(update);
  };
  window.addEventListener(COMPANION_ANCHORS_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_ANCHORS_EVENT, onEvent);
}

/** The host's overlay chord. Returns the unsubscribe function. */
export function onCompanionOverlay(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = () => listener();
  window.addEventListener(COMPANION_OVERLAY_EVENT, onEvent);
  return () => window.removeEventListener(COMPANION_OVERLAY_EVENT, onEvent);
}
