import { useEffect, useMemo, useRef } from "react";

import { LED_ROWS, ledColumns, ledScrolls, ledWindow } from "./led-model.ts";
import "./led.css";

/**
 * LedSign — text on a fine-dot LED matrix.
 *
 * Fits: the text is centered and holds still. Too long: it streams right to
 * left as a loop. `flash` pulses the lit dots (a sign asking for you). The
 * dot colors come from CSS (`--led-on`, `--led-off`) on the element, so a
 * surface themes it without props. Reduced motion holds the first frame.
 *
 * `band` adds a still row of finer dots under the text, in the same canvas:
 * a companion figure's roster code. It never streams, flashes or takes the
 * accent.
 */
export type LedBand = {
  /** Dot columns, bit 0 at the top, centred across the sign. */
  cols: readonly number[];
  rows: number;
  /** Its own dot spacing, in CSS px. */
  pitch: number;
  /** Its lit dots' ink. */
  ink: string;
};

export function LedSign({
  text,
  columns,
  pitch = 2,
  speed = 14,
  flash = false,
  tone = "ink",
  reduced = false,
  pad = 1,
  className,
  label,
  band = null,
  width: fixedWidth,
}: {
  text: string;
  /** Window width in dot columns. */
  columns: number;
  /** Dot spacing in CSS px; the dot itself is a little over half of it. */
  pitch?: number;
  /** Columns per second while streaming. */
  speed?: number;
  flash?: boolean;
  tone?: "ink" | "accent";
  reduced?: boolean;
  /** Dark dots around the text, in dots. */
  pad?: number;
  className?: string;
  /** Accessible text; defaults to `text`. */
  label?: string;
  band?: LedBand | null;
  /** The canvas width in CSS px, when it is not the text's own (the text centres in it). */
  width?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cols = useMemo(() => ledColumns(text), [text]);
  const scrolls = ledScrolls(cols, columns);
  const textWidth = (columns + pad * 2) * pitch;
  const width = fixedWidth ?? textWidth;
  const textHeight = (LED_ROWS + pad * 2) * pitch;
  // The band: a dark row, its rows, a dark row, at its own pitch.
  const height = textHeight + (band ? (band.rows + 2) * band.pitch : 0);
  const bandKey = band ? `${band.cols.join(",")}|${band.rows}|${band.pitch}|${band.ink}` : "";

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const style = getComputedStyle(canvas);
    const on = style.getPropertyValue("--led-on").trim() || "#f2efe6";
    const off = style.getPropertyValue("--led-off").trim() || "rgba(242, 239, 230, 0.07)";
    const r = pitch * 0.32;
    const left = (width - textWidth) / 2;
    const drawBand = () => {
      if (!band) return;
      const p = band.pitch;
      const across = Math.floor(width / p);
      const start = Math.round((across - band.cols.length) / 2);
      const x0 = (width - across * p) / 2;
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      for (let x = 0; x < across; x++) {
        const bits = band.cols[x - start] ?? 0;
        for (let y = 0; y < band.rows + 2; y++) {
          const lit = y >= 1 && y <= band.rows && (bits >> (y - 1)) & 1;
          ctx.beginPath();
          ctx.arc(x0 + x * p + p / 2, textHeight + y * p + p / 2, p * 0.32, 0, Math.PI * 2);
          ctx.fillStyle = lit ? band.ink : off;
          ctx.fill();
        }
      }
    };
    const draw = (offset: number, glow: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(left, 0);
      const view = ledWindow(cols, columns, offset);
      for (let x = 0; x < columns + pad * 2; x++) {
        const bits = view[x - pad] ?? 0;
        for (let y = 0; y < LED_ROWS + pad * 2; y++) {
          const lit = x >= pad && x < columns + pad && y >= pad && y < LED_ROWS + pad && (bits >> (y - pad)) & 1;
          ctx.beginPath();
          ctx.arc(x * pitch + pitch / 2, y * pitch + pitch / 2, r, 0, Math.PI * 2);
          if (lit) {
            ctx.globalAlpha = glow;
            ctx.fillStyle = on;
            ctx.shadowColor = on;
            ctx.shadowBlur = pitch * 1.4;
          } else {
            ctx.globalAlpha = 1;
            ctx.fillStyle = off;
            ctx.shadowBlur = 0;
          }
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.translate(-left, 0);
      drawBand();
    };
    // Start a long sign one window in, so it enters from the right edge.
    const start = scrolls ? -columns : 0;
    if (reduced || (!scrolls && !flash)) { draw(scrolls && reduced ? 0 : start, 1); return; }
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      const offset = scrolls ? start + s * speed : 0;
      // Flash: two quick pulses, then a held beat.
      const glow = flash ? (s % 1.6 < 0.9 && Math.floor((s % 1.6) / 0.225) % 2 === 1 ? 0.25 : 1) : 1;
      draw(offset, glow);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bandKey is the band's identity
  }, [cols, columns, pitch, speed, flash, reduced, scrolls, width, height, pad, tone, bandKey, textWidth, textHeight]);

  return (
    <canvas
      ref={ref}
      className={`led-sign is-${tone}${className ? ` ${className}` : ""}`}
      style={{ width, height }}
      role="img"
      aria-label={label ?? text}
    />
  );
}
