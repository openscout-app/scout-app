import { useEffect, useRef, useState } from "react";
import { isScoutSurfaceVisible } from "../lib/surface-activity.ts";
import { ScoutbotFigure } from "../screens/companion/Scoutbot.tsx";
import "./scoutbot-thinking.css";

/** A breathing current traces Scoutbot's face while a reply is pending. */
export function ScoutbotThinking({ size = 28, decorative = false }: { size?: number; decorative?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    let onscreen = typeof IntersectionObserver === "undefined";
    const update = () => setActive(onscreen && isScoutSurfaceVisible());
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      onscreen = Boolean(entry?.isIntersecting); update();
    });
    if (element.current) observer?.observe(element.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  return <span ref={element} className="scoutbot-thinking" data-active={active || undefined} role={decorative ? undefined : "status"} aria-hidden={decorative || undefined}>
    <ScoutbotFigure look="graphite" mood="rest" size={size} working />
    {!decorative && <span className="sr-only">Scoutbot is thinking</span>}
  </span>;
}
