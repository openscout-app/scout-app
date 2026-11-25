import { useLayoutEffect, useState, type RefObject } from "react";

import { blinkPaths } from "./blink-model.ts";
import "./blink.css";

/*
 * Blink (Studio: /studies/companion-blink), a signal layer under a companion
 * surface. It draws only when the surface can cover the screen: the Mac
 * app's edge mode, or a browser preview. Nothing dims and nothing takes the
 * pointer, and nothing glows: no light is held at the anchor.
 *
 *  - `fire` changes once per new ask: one thin light runs the edge to the anchor.
 */

type Shot = { key: number; w: number; h: number; paths: [string, string] };

export function BlinkLayer({ fire, anchor, place }: { fire: number; anchor: RefObject<HTMLElement | null>; /** Where the anchor sits (a corner); a change measures again. */ place?: string }) {
  const [shot, setShot] = useState<Shot | null>(null);

  // Measure the anchor when a light runs to it.
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!el || !fire) return;
    const r = el.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setShot({ key: fire, w, h, paths: blinkPaths(w, h, center) });
  }, [fire, anchor, place]);

  return (
    <div className="blk" aria-hidden>
      {shot && (
        <svg key={shot.key} className="blk-trace" width={shot.w} height={shot.h} viewBox={`0 0 ${shot.w} ${shot.h}`} onAnimationEnd={() => setShot(null)}>
          <path d={shot.paths[0]} pathLength={1} />
          <path d={shot.paths[1]} pathLength={1} />
        </svg>
      )}
    </div>
  );
}
