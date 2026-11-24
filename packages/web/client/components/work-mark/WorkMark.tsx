import { useState, type CSSProperties } from "react";

import { WORK_MARK_GRID, WORK_MARK_PERIOD_MS, workMarkDots, workMarkPhase, type WorkMarkState } from "./work-mark-model.ts";
import "./work-mark.css";

const PITCH = 3;
const RADIUS = 1.05;
const DOTS: Record<WorkMarkState, ReturnType<typeof workMarkDots>> = {
  working: workMarkDots("working"),
  waiting: workMarkDots("waiting"),
  idle: workMarkDots("idle"),
};

/**
 * WorkMark: where a session stands, as a small dot matrix in the state's
 * colour (work-mark-model.ts has the patterns). Only working moves: one CSS
 * loop, in step across the page; reduced motion holds a still frame.
 * Without `label` it is decoration and hidden from a screen reader.
 */
export function WorkMark({ state, size = 12, label, className }: { state: WorkMarkState; size?: number; label?: string; className?: string }) {
  const [phase] = useState(() => workMarkPhase(typeof performance === "undefined" ? 0 : performance.now()));
  const span = WORK_MARK_GRID * PITCH;
  const style = { "--wm-phase": `${phase}ms`, "--wm-period": `${WORK_MARK_PERIOD_MS}ms` } as CSSProperties;
  return (
    <svg
      className={className ? `wm ${className}` : "wm"}
      data-state={state}
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      style={style}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {DOTS[state].map((dot) => (
        <circle
          key={`${dot.x},${dot.y}`}
          className={dot.ring !== null ? "wm-dot wm-ring" : "wm-dot"}
          cx={dot.x * PITCH + PITCH / 2}
          cy={dot.y * PITCH + PITCH / 2}
          r={RADIUS}
          data-lit={dot.lit || undefined}
          style={dot.ring !== null ? ({ "--wm-i": dot.ring, "--wm-held": dot.held ?? undefined } as CSSProperties) : undefined}
          data-held={dot.held !== null || undefined}
        />
      ))}
    </svg>
  );
}
