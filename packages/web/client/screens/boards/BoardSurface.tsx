import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";

import {
  boundsOf,
  LANE_HEAD,
  SHARED_LAYER,
  type BoardFrame,
  type BoardLayout,
  type LaidFrame,
  type LaidLane,
  type Rect,
  type SharedFrame,
} from "../../../shared/boards.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";

/*
 * The board itself: frames on one pan-and-zoom plane, a lane per layer.
 * Ported from the design studio's canvas (camera, zoom bands, drag to place).
 * Zoomed out, a frame is its title; closer in, its card text.
 */

export type SurfaceFrame = BoardFrame | SharedFrame;

type Camera = { x: number; y: number; z: number };

export type BoardSurfaceHandle = {
  fit: () => void;
  zoom: (k: number) => void;
  /** Pan so this world rectangle sits in the middle of the view, keeping the zoom. */
  reveal: (r: Rect) => void;
  focus: (key: string) => void;
};

const MIN_Z = 0.05;
const MAX_Z = 2;
const SNAP = 16;

const lodFor = (z: number) => (z < 0.22 ? "far" : z < 0.7 ? "mid" : "near");
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));
const snap = (n: number) => Math.round(n / SNAP) * SNAP;

function fitCamera(r: Rect, w: number, h: number, pad: number, maxZ = 1): Camera {
  const z = clampZ(Math.min((w - pad * 2) / Math.max(1, r.width), (h - pad * 2) / Math.max(1, r.height), maxZ));
  return { z, x: (w - r.width * z) / 2 - r.x * z, y: (h - r.height * z) / 2 - r.y * z };
}

/** Below this zoom a card's text is too small to read on first look. */
const OPENING_Z = 0.5;

/** The first view of a board: everything if it fits readably, else its top-left corner at a readable zoom. */
function openingCamera(r: Rect, w: number, h: number, pad: number): Camera {
  const fitted = fitCamera(r, w, h, pad);
  if (fitted.z >= OPENING_Z) return fitted;
  return { z: OPENING_Z, x: pad - r.x * OPENING_Z, y: pad - r.y * OPENING_Z };
}

export function ageLabel(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const s = (now - ms) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 30) return `${Math.floor(s / (86400 * 7))}w`;
  return `${Math.floor(s / (86400 * 30))}mo`;
}

const KIND_LABEL: Record<BoardFrame["kind"], string> = {
  work: "Work",
  flight: "Ask",
  message: "Message",
  material: "File",
  note: "Note",
};

export function kindLabel(frame: BoardFrame): string {
  return KIND_LABEL[frame.kind];
}

export function isShared(frame: SurfaceFrame): frame is SharedFrame {
  return frame.layer === SHARED_LAYER && "sourceKey" in frame;
}

/** Whose work a frame is; a Shared copy names the layer it came from. */
export function layerNameOf(frame: SurfaceFrame, names: ReadonlyMap<string, string>): string {
  const layer = isShared(frame) ? frame.sourceLayer : frame.layer;
  return names.get(layer) ?? layer;
}

/** Calls onMove after the pointer travels 4px, then onUp with the final delta. */
function track(
  e: ReactPointerEvent,
  onMove: (dx: number, dy: number) => void,
  onUp: (moved: boolean, dx: number, dy: number) => void,
) {
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  let last = { dx: 0, dy: 0 };
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    last = { dx, dy };
    onMove(dx, dy);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp(moved, last.dx, last.dy);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/** Dot spacing that stays between 16 and 64 screen px at any zoom. */
function gridSize(z: number): number {
  let step = 32 * z;
  while (step < 16) step *= 4;
  while (step > 64) step /= 4;
  return step;
}

export function BoardSurface({
  boardId,
  layout,
  names,
  hidden,
  selected,
  onSelect,
  onPlace,
  onOpen,
  handleRef,
}: {
  boardId: string;
  layout: BoardLayout<SurfaceFrame>;
  names: ReadonlyMap<string, string>;
  hidden: ReadonlySet<string>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onPlace: (key: string, x: number, y: number) => void;
  onOpen: (frame: SurfaceFrame) => void;
  handleRef?: Ref<BoardSurfaceHandle>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [cam, setCam] = useState<Camera | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const [moving, setMoving] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const byKey = useMemo(() => new Map(layout.frames.map((f) => [f.frame.key, f])), [layout]);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  const everything = useMemo(
    () => boundsOf([...layout.frames, ...layout.lanes.map((l) => ({ ...l, y: l.y - 40, height: l.height + 40 }))]),
    [layout],
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      setView((v) => (v.w === next.w && v.h === next.h ? v : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Camera: the last view of this board, or everything fitted ──
  const cameraKey = `scout-board:camera:${boardId}`;
  useEffect(() => setCam(null), [cameraKey]);
  useEffect(() => {
    if (cam || !view.w || !everything) return;
    try {
      const saved = JSON.parse(localStorage.getItem(cameraKey) ?? "null") as Camera | null;
      if (saved && [saved.x, saved.y, saved.z].every(Number.isFinite)) {
        setCam({ ...saved, z: clampZ(saved.z) });
        return;
      }
    } catch {
      // No storage: start from the fitted view.
    }
    setCam(openingCamera(everything, view.w, view.h, 48));
  }, [cam, view, everything, cameraKey]);

  useEffect(() => {
    if (!cam) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(cameraKey, JSON.stringify(cam));
      } catch {
        // Storage is a convenience here.
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [cam, cameraKey]);

  const zoomAt = useCallback((k: number, px: number, py: number) => {
    setCam((c) => {
      if (!c) return c;
      const z = clampZ(c.z * k);
      const f = z / c.z;
      return { z, x: px - (px - c.x) * f, y: py - (py - c.y) * f };
    });
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      fit: () => {
        const v = viewRef.current;
        if (everything && v.w) setCam(fitCamera(everything, v.w, v.h, 48));
      },
      zoom: (k) => zoomAt(k, viewRef.current.w / 2, viewRef.current.h / 2),
      reveal: (r) => {
        const c = camRef.current;
        const v = viewRef.current;
        if (c && v.w) setCam({ ...c, x: v.w / 2 - (r.x + r.width / 2) * c.z, y: v.h / 2 - (r.y + r.height / 2) * c.z });
      },
      focus: (key) => {
        const f = byKeyRef.current.get(key);
        const v = viewRef.current;
        if (f && v.w) setCam(fitCamera(f, v.w, v.h, 120, 1.2));
      },
    }),
    [everything, zoomAt],
  );

  // ── Wheel: scroll pans, pinch or ⌘/ctrl-scroll zooms at the pointer ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * unit * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        setCam((c) => (c ? { ...c, x: c.x - e.deltaX * unit, y: c.y - e.deltaY * unit } : c));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0 || e.target !== e.currentTarget) return;
      const start = camRef.current;
      if (!start) return;
      track(
        e,
        (dx, dy) => {
          setPanning(true);
          setCam({ ...start, x: start.x + dx, y: start.y + dy });
        },
        (moved) => {
          setPanning(false);
          if (!moved) onSelect(null);
        },
      );
    },
    [onSelect],
  );

  const onFramePointerDown = useCallback(
    (e: ReactPointerEvent, key: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const c = camRef.current;
      const f = byKeyRef.current.get(key);
      if (!c || !f) return;
      track(
        e,
        (dx, dy) => setMoving({ key, dx: dx / c.z, dy: dy / c.z }),
        (moved, dx, dy) => {
          setMoving(null);
          if (moved) onPlace(key, snap(f.x + dx / c.z), snap(f.y + dy / c.z));
        },
      );
    },
    [onPlace],
  );

  const worldStyle = cam
    ? ({ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, "--inv-z": String(1 / cam.z) } as CSSProperties)
    : undefined;
  const step = cam ? gridSize(cam.z) : 32;
  const now = Date.now();

  return (
    <div
      ref={viewportRef}
      className="brd-viewport"
      data-panning={panning || undefined}
      style={{ backgroundSize: `${step}px ${step}px`, backgroundPosition: cam ? `${cam.x}px ${cam.y}px` : undefined }}
      onPointerDown={onBackgroundPointerDown}
    >
      {cam ? (
        <div className="brd-world" style={worldStyle} data-lod={lodFor(cam.z)}>
          {layout.lanes.map((lane) => (
            <LaneView key={lane.layer} lane={lane} name={names.get(lane.layer) ?? lane.layer} dim={hidden.has(lane.layer)} />
          ))}
          {layout.frames.map((f) => {
            const m = moving?.key === f.frame.key ? moving : null;
            return (
              <FrameView
                key={f.frame.key}
                laid={f}
                layerName={layerNameOf(f.frame, names)}
                offsetX={m?.dx ?? 0}
                offsetY={m?.dy ?? 0}
                selected={selected === f.frame.key}
                dim={hidden.has(f.frame.layer)}
                now={now}
                onPointerDown={onFramePointerDown}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const LaneView = memo(function LaneView({ lane, name, dim }: { lane: LaidLane; name: string; dim: boolean }) {
  const pad = 24;
  return (
    <div
      className="brd-lane"
      data-dim={dim || undefined}
      data-shared={lane.layer === SHARED_LAYER || undefined}
      style={{ left: lane.x - pad, top: lane.y + LANE_HEAD - pad, width: lane.width + pad * 2, height: lane.height - LANE_HEAD + pad * 2 }}
    >
      <span className="brd-lane-label">
        {name}
        <span className="brd-lane-count">{lane.count}</span>
      </span>
    </div>
  );
});

const FrameView = memo(function FrameView({
  laid,
  layerName,
  offsetX,
  offsetY,
  selected,
  dim,
  now,
  onPointerDown,
  onSelect,
  onOpen,
}: {
  laid: LaidFrame<SurfaceFrame>;
  layerName: string;
  offsetX: number;
  offsetY: number;
  selected: boolean;
  dim: boolean;
  now: number;
  onPointerDown: (e: ReactPointerEvent, key: string) => void;
  onSelect: (key: string) => void;
  onOpen: (frame: SurfaceFrame) => void;
}) {
  const { frame } = laid;
  const shared = isShared(frame) ? frame : null;
  const markdown = frame.kind === "note" || frame.kind === "message";
  return (
    <div
      className="brd-frame"
      data-kind={frame.kind}
      data-selected={selected || undefined}
      data-placed={laid.placed || undefined}
      data-moving={offsetX || offsetY ? true : undefined}
      data-dim={dim || undefined}
      data-shared={shared ? true : undefined}
      style={{ left: laid.x + offsetX, top: laid.y + offsetY, width: laid.width, height: laid.height }}
      role="button"
      tabIndex={dim ? -1 : 0}
      aria-pressed={selected}
      aria-label={`${kindLabel(frame)}: ${frame.title}`}
      onPointerDown={(e) => onPointerDown(e, frame.key)}
      onClick={() => onSelect(frame.key)}
      onDoubleClick={() => onOpen(frame)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (selected && e.key === "Enter") onOpen(frame);
        else onSelect(frame.key);
      }}
    >
      <div className="brd-frame-head">
        <span className="brd-frame-kind">{kindLabel(frame)}</span>
        {frame.state ? <span className="brd-frame-state">{frame.state.replaceAll("_", " ")}</span> : null}
        <span className="brd-frame-age">{ageLabel(frame.at, now)}</span>
      </div>
      <div className="brd-frame-title">{frame.title}</div>
      <div className="brd-frame-body">
        {markdown ? <MessageMarkup text={frame.summary} /> : frame.summary ? <p>{frame.summary}</p> : null}
      </div>
      {/* The lane already names the agent; only a copy on Shared says where it came from. */}
      {shared ? (
        <div className="brd-frame-foot">
          <span>from {layerName}</span>
          {shared.changed ? <span className="brd-flag">Changed since shared</span> : null}
          {shared.missing ? <span className="brd-flag">Not in this board now</span> : null}
        </div>
      ) : null}
    </div>
  );
});
