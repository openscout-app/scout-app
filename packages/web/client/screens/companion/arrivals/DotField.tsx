/**
 * An agent's activity as a field of dots that thinks (Studio
 * /studies/companion-board-cells, E, picked 2026-10-16): a seeded share of the
 * dots is lit by intensity, and the lit ones breathe in a slow wave across the
 * columns, quicker and brighter as the agent does more. Unlit dots stay as a
 * faint grid, so the field keeps its shape at rest. Reduce Motion holds it
 * still at its level (arrivals.css).
 */

import type { CSSProperties } from "react";

export { fieldIntensity } from "./dot-field.ts";


export function DotField({ seedKey, intensity, cols = 9, rows = 3, pitch = 4 }: { seedKey: string; intensity: number; cols?: number; rows?: number; pitch?: number }) {
  let h = 2166136261;
  for (const c of seedKey) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const seed = (n: number) => {
    let x = (h ^ Math.imul(n + 1, 2654435761)) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822507) >>> 0;
    x ^= x >>> 13;
    return (x >>> 0) / 4294967296;
  };
  const lit = 0.12 + 0.78 * intensity;
  const dur = 2.6 - 1.7 * intensity;
  const w = cols * pitch - (pitch - 2.2);
  const hgt = rows * pitch - (pitch - 2.2);
  // nothing done lately: the field rests and breathes, never a blank grid
  const resting = intensity <= 0;
  return (
    <svg className={`arv-dots${resting ? " is-resting" : ""}`} width={w} height={hgt} viewBox={`0 0 ${w} ${hgt}`} aria-hidden style={{ "--arv-dots-dur": `${dur.toFixed(2)}s` } as CSSProperties}>
      {Array.from({ length: cols * rows }, (_, n) => {
        const x = n % cols;
        const y = Math.floor(n / cols);
        const s = seed(n);
        const on = intensity > 0 && s < lit;
        return (
          <circle
            key={n}
            cx={x * pitch + 1.1}
            cy={y * pitch + 1.1}
            r={1.1}
            className={on ? "is-on" : undefined}
            style={on ? ({ animationDelay: `${(-(x * 0.11 + s * dur)).toFixed(2)}s`, "--arv-dots-peak": (0.55 + 0.45 * Math.min(1, intensity + s * 0.3)).toFixed(2) } as CSSProperties) : undefined}
          />
        );
      })}
    </svg>
  );
}
