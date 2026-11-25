/* Review — canvas helpers. Colors come from the page's CSS, so both canvases follow the app theme. */

export type Pal = {
  panel: string; ink: string; dim: string; faint: string; line: string; pline: string;
  accent: string; accentSoft: string; accentDim: string; mono: string;
  inkA: (a: number) => string; accA: (a: number) => string;
};

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS color (oklch, color-mix, hex) → [r, g, b, a], by painting one pixel. */
function rgbaOf(color: string): [number, number, number, number] {
  if (!probe) { const c = document.createElement("canvas"); c.width = c.height = 1; probe = c.getContext("2d", { willReadFrequently: true }); }
  const p = probe!; p.clearRect(0, 0, 1, 1); p.fillStyle = "#000"; p.fillStyle = color; p.fillRect(0, 0, 1, 1);
  const d = p.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
}
/** A color as the canvas should paint it. The lines are ink at a low alpha: dropping the alpha drew them in solid ink. */
export function cssOf([r, g, b, a]: [number, number, number, number]): string {
  return a >= 0.995 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}
export function readPalette(el: HTMLElement): Pal {
  const cs = getComputedStyle(el);
  const v = (n: string) => { const raw = cs.getPropertyValue(n).trim(); const c = rgbaOf(resolve(el, raw)); return { css: cssOf(c), rgb: `${c[0]},${c[1]},${c[2]}` }; };
  const ink = v("--rw-ink"), acc = v("--rw-accent");
  return {
    panel: v("--rw-panel").css, ink: ink.css, dim: v("--rw-dim").css, faint: v("--rw-faint").css, line: v("--rw-line").css, pline: v("--rw-line-strong").css,
    accent: acc.css, accentSoft: `rgba(${acc.rgb},.12)`, accentDim: `rgba(${acc.rgb},.45)`,
    mono: cs.getPropertyValue("--rw-mono").trim() || "ui-monospace, Menlo, monospace",
    inkA: (a) => `rgba(${ink.rgb},${a})`, accA: (a) => `rgba(${acc.rgb},${a})`,
  };
}
// a custom property can hold var(...) or color-mix(...): let the browser resolve it on a scratch element
function resolve(el: HTMLElement, raw: string) {
  if (!/var\(|color-mix|oklch|lab\(|lch\(/.test(raw)) return raw;
  const s = document.createElement("span"); s.style.color = raw; s.style.display = "none"; el.appendChild(s);
  const out = getComputedStyle(s).color; s.remove(); return out;
}
/**
 * Crisp strokes. `snap` puts a coordinate on the device-pixel grid; `box` strokes a rect whose edges sit
 * inside the snapped rect, so a 1px line covers one row of pixels instead of smearing over two.
 */
export const dprOf = () => window.devicePixelRatio || 1;
export const snap = (v: number, d = dprOf()) => Math.round(v * d) / d;
export function box(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lw: number, d = dprOf()) {
  const x0 = snap(x, d), y0 = snap(y, d), x1 = snap(x + w, d), y1 = snap(y + h, d);
  if (x1 - x0 <= lw || y1 - y0 <= lw) return;
  c.lineWidth = lw; c.strokeRect(x0 + lw / 2, y0 + lw / 2, x1 - x0 - lw, y1 - y0 - lw);
}
/** a vertical stroke `lw` wide, starting on the device-pixel grid */
export function vline(c: CanvasRenderingContext2D, x: number, y0: number, y1: number, lw: number, d = dprOf()) {
  const sx = snap(x, d) + lw / 2; c.lineWidth = lw; c.beginPath(); c.moveTo(sx, y0); c.lineTo(sx, y1); c.stroke();
}
export function sizeCanvas(cv: HTMLCanvasElement, w: number, h: number) {
  const d = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(w * d)); cv.height = Math.max(1, Math.round(h * d));
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const x = cv.getContext("2d")!; x.setTransform(d, 0, 0, d, 0, 0); return x;
}
export function fitText(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (max <= 8) return "";
  if (ctx.measureText(s).width <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + "…").width <= max) lo = m; else hi = m - 1; }
  return lo > 1 ? s.slice(0, lo) + "…" : "";
}
