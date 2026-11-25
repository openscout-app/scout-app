/*
 * The canvas minimap, bottom left: agent areas as outlines, cards and file strips as blocks, agents at work as dots,
 * and the view as a frame. Click to go somewhere, drag the frame to pan, scroll to zoom. Same moves as the
 * Observatory's map (screens/ops/observatory/SceneMinimap.tsx).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { harnessLabel, harnessTint } from "../../components/HarnessMark.tsx";
import { timeAgoWithSuffix } from "../../lib/time.ts";
import { Mark } from "../feed/sources.tsx";
import { areaAt, blockName, type Glance, type GlanceArea } from "./glance.ts";
import { camCenteredOn, minimapFrame, seenBox, type Cam, type Size } from "./minimap-frame.ts";
import type { Box } from "./scene.ts";
import s from "./canvas.module.css";

export type MinimapDot = { x: number; y: number; asks: boolean };

export function CanvasMinimap({
  bounds, frames, strips, cards, dots, cam, view, onCam, onZoom,
}: {
  bounds: Box;
  /** Shared and each agent's area */
  frames: Box[];
  strips: Box[];
  cards: Box[];
  dots: MinimapDot[];
  cam: Cam;
  view: Size;
  onCam: (cam: Cam) => void;
  /** zoom about the middle of the view */
  onZoom: (f: number) => void;
}) {
  const map = useMemo(() => minimapFrame(bounds), [bounds]);
  const seen = map.toMap(seenBox(cam, view));
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const latest = useRef({ cam, view, onCam, onZoom, map });
  latest.current = { cam, view, onCam, onZoom, map };

  const pointAt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (map.w / r.width), y: (e.clientY - r.top) * (map.h / r.height) };
  };
  const goTo = (x: number, y: number) => {
    const { cam, view, onCam, map } = latest.current;
    onCam(camCenteredOn(cam, view, map.toWorld(x, y)));
  };

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (drag.current) return;
      const unit = e.deltaMode === 1 ? 16 : 1;
      /* a mouse wheel's notch (about 100) is a 1.3× step; a trackpad's small deltas are gentle */
      latest.current.onZoom(Math.exp(-Math.max(-100, Math.min(100, e.deltaY * unit)) * 0.0026));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    const p = pointAt(e);
    const inside = p.x >= seen.x && p.x <= seen.x + seen.w && p.y >= seen.y && p.y <= seen.y + seen.h;
    /* grabbing the frame keeps the grip where it was taken; anywhere else, the view jumps there first */
    drag.current = { id: e.pointerId, dx: inside ? seen.x + seen.w / 2 - p.x : 0, dy: inside ? seen.y + seen.h / 2 - p.y : 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!inside) goTo(p.x, p.y);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = pointAt(e);
    goTo(p.x + d.dx, p.y + d.dy);
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const key = (e: ReactKeyboardEvent) => {
    const step = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (step) {
      e.preventDefault();
      onCam({ ...cam, x: cam.x + step[0] * view.w / 4, y: cam.y + step[1] * view.h / 4 });
    } else if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      onZoom(e.key === "-" ? 0.8 : 1.25);
    }
  };

  const rect = (b: Box, className: string, i: number) => {
    const r = map.toMap(b);
    return <rect key={i} className={className} x={r.x} y={r.y} width={Math.max(0.5, r.w)} height={Math.max(0.5, r.h)} />;
  };
  return (
    <div
      ref={ref}
      className={s.minimap}
      style={{ width: map.w, height: map.h }}
      tabIndex={0}
      role="group"
      aria-label="Canvas map. Arrow keys pan, plus and minus zoom."
      title="Click to go there, drag the frame to pan, scroll to zoom"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={key}
    >
      <svg width={map.w} height={map.h} viewBox={`0 0 ${map.w} ${map.h}`} aria-hidden>
        {frames.map((b, i) => rect(b, s.mapFrame, i))}
        {strips.map((b, i) => rect(b, s.mapStrip, i))}
        {cards.map((b, i) => rect(b, s.mapCard, i))}
        {dots.map((d, i) => {
          const p = map.toMap({ x: d.x, y: d.y, w: 0, h: 0 });
          return <circle key={i} className={s.mapDot} data-asks={d.asks || undefined} cx={p.x} cy={p.y} r={2} />;
        })}
        <rect className={s.mapView} x={seen.x} y={seen.y} width={seen.w} height={seen.h} />
      </svg>
    </div>
  );
}

/**
 * The canvas as a minimap, for a slot outside it (Home's Feed): each agent's area as an outline under a one-line label
 * (the session, its project, the copy or branch it works on), the files it touched as faint blocks, its cursor in its
 * harness's colour with the harness's mark beside it, gliding to the file it is on, and a brief ring where something
 * ships. No camera. A click picks the area under it.
 */
export function CanvasGlance({ glance, size, paused, nowMs, onPick }: {
  glance: Glance;
  size: Size;
  /** off screen or in a hidden tab: rings and glides hold still */
  paused?: boolean;
  /** the clock the hover card's "5m ago" reads against */
  nowMs?: number;
  onPick: (area: GlanceArea | null) => void;
}) {
  const map = useMemo(() => minimapFrame(glance.bounds, size), [glance.bounds, size]);
  // The area under the pointer: outlined, with a card of what its session is doing.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hovered = hoverId ? glance.areas.find((a) => a.id === hoverId) ?? null : null;
  const hover = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const area = areaAt(glance, map.toWorld((e.clientX - r.left) * (map.w / r.width), (e.clientY - r.top) * (map.h / r.height)));
    setHoverId(area?.id ?? null);
  };
  const rect = (b: Box, className: string, key: string) => {
    const r = map.toMap(b);
    return <rect key={key} className={className} x={r.x} y={r.y} width={Math.max(0.5, r.w)} height={Math.max(0.5, r.h)} />;
  };
  const pick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // a click with no place (a keyboard's, a script's) opens the canvas as it is
    const placed = e.detail > 0 && r.width > 0 && r.height > 0;
    onPick(placed ? areaAt(glance, map.toWorld((e.clientX - r.left) * (map.w / r.width), (e.clientY - r.top) * (map.h / r.height))) : null);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onPick(null);
  };
  // The labels and marks are HTML over the drawing, placed in percent so they follow it as it scales.
  const at = (x: number, y: number) => ({ left: `${(x / map.w) * 100}%`, top: `${(y / map.h) * 100}%` });
  return (
    <div className={s.glance} data-paused={paused || undefined} role="link" tabIndex={0} aria-label="Open the canvas" onClick={pick} onKeyDown={key} onMouseMove={hover} onMouseLeave={() => setHoverId(null)}>
    <div className={s.glanceOver} aria-hidden>
      {/* Each block names its file, so it reads as the work and not as an empty box; the cursor's file is brighter. */}
      {glance.areas.flatMap((a) => a.blocks.map((b) => {
        const r = map.toMap(b.box);
        return (
          <span key={`n:${a.id}:${b.key}`} className={s.glanceFile} data-here={b.key === a.file || undefined} style={{ ...at(r.x, r.y), width: `${(r.w / map.w) * 100}%`, height: `${(r.h / map.h) * 100}%` }}>
            {blockName(b.key)}
          </span>
        );
      }))}
      {hovered ? <GlanceCard area={hovered} box={map.toMap(hovered.box)} map={map} nowMs={nowMs ?? Date.now()} /> : null}
      {glance.areas.map((a) => {
        const r = map.toMap(a.box);
        // The title and, room permitting, the project; the copy is on the hover card.
        const parts = [a.title || a.name, a.project].filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i);
        return (
          <span key={`l:${a.id}`} className={s.glanceLabel} style={{ ...at(r.x, r.y), width: `${(r.w / map.w) * 100}%` }} title={parts.join(" · ")}>
            {parts.map((p, i) => <span key={i} data-part={i === 0 ? "title" : undefined}>{p}</span>)}
          </span>
        );
      })}
      {glance.areas.map((a) => {
        const p = map.toMap({ x: a.cursor.x, y: a.cursor.y, w: 0, h: 0 });
        return a.harness ? <span key={`m:${a.id}`} className={s.glanceMark} style={at(p.x, p.y)}><Mark harness={a.harness} size={11} /></span> : null;
      })}
    </div>
    <svg width={map.w} height={map.h} viewBox={`0 0 ${map.w} ${map.h}`} aria-hidden>
      {glance.areas.map((a) => rect(a.box, a.id === hoverId ? `${s.mapFrame} ${s.glanceHot}` : s.mapFrame, `f:${a.id}`))}
      {glance.areas.flatMap((a) => a.blocks.map((b) => rect(b.box, s.mapStrip, `b:${a.id}:${b.key}`)))}
      {glance.ships.map((ship) => {
        const p = map.toMap({ x: ship.x, y: ship.y, w: 0, h: 0 });
        const tint = harnessTint(glance.areas.find((a) => a.id === ship.area)?.harness) ?? undefined;
        return <circle key={ship.id} className={s.glanceShip} cx={p.x} cy={p.y} r={14} style={tint ? { stroke: tint } : undefined} />;
      })}
      {glance.areas.map((a) => {
        const p = map.toMap({ x: a.cursor.x, y: a.cursor.y, w: 0, h: 0 });
        const tint = harnessTint(a.harness) ?? undefined;
        return (
          <g key={`c:${a.id}`} className={s.glanceCursor} data-asks={a.asks || undefined} style={{ transform: `translate(${p.x}px, ${p.y}px)`, color: tint }}>
            <path d="M0 0 L0 11 L3 8.2 L5.4 13 L7.2 12.2 L4.9 7.5 L8.6 7.5 Z" />
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/**
 * What a session in the glance is doing, while the pointer is on its area: its harness and title, the project and
 * copy it works in, and its newest calls as the tail summarizes them. Laid over the area's blocks, under its label,
 * held to the side the area is on so it stays inside the slot's width.
 */
function GlanceCard({ area, box, map, nowMs }: { area: GlanceArea; box: Box; map: ReturnType<typeof minimapFrame>; nowMs: number }) {
  const right = box.x + box.w / 2 > map.w / 2;
  const top = `${((box.y + 22) / map.h) * 100}%`;
  const side = right ? { right: `${(1 - (box.x + box.w) / map.w) * 100}%` } : { left: `${(box.x / map.w) * 100}%` };
  const where = [area.harness ? harnessLabel(area.harness) : null, area.project, area.place].filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i);
  return (
    <div className={s.glanceCard} style={{ ...side, top }}>
      <div className={s.glanceCardHead}>
        {area.harness ? <Mark harness={area.harness} size={12} /> : null}
        <span className={s.glanceCardTitle}>{area.title || area.name}</span>
        {area.asks ? <span className={s.glanceCardAsks}>Waiting</span> : null}
      </div>
      {where.length ? <div className={s.glanceCardWhere}>{where.join(" · ")}</div> : null}
      {area.recent.length ? (
        <ol className={s.glanceCardCalls}>
          {area.recent.map((call) => (
            <li key={call.id}>
              <span className={s.glanceCardCall}>{call.summary}</span>
              <time>{timeAgoWithSuffix(call.ts, nowMs)}</time>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
