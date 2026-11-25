import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { adjacentPrompt } from "./session-interactions.ts";

function targets(port: HTMLElement) {
  const top = port.getBoundingClientRect().top;
  const max = port.scrollHeight - port.clientHeight;
  return [...port.querySelectorAll<HTMLElement>("[data-session-prompt]")]
    .map((node) => Math.max(0, Math.min(max, node.getBoundingClientRect().top - top + port.scrollTop - 12)));
}

export function SessionPromptNavigation({ portRef, contentRef, revision, pause }: {
  portRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null>; revision: number; pause: () => void;
}) {
  const [available, setAvailable] = useState({ previous: false, next: false, count: 0 });
  const frame = useRef(0);
  useLayoutEffect(() => {
    const port = portRef.current, content = contentRef.current;
    if (!port || !content) return;
    const update = () => {
      const offsets = targets(port);
      const next = { previous: adjacentPrompt(offsets, port.scrollTop, -1) != null, next: adjacentPrompt(offsets, port.scrollTop, 1) != null, count: offsets.length };
      setAvailable((held) => held.previous === next.previous && held.next === next.next && held.count === next.count ? held : next);
    };
    const schedule = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(update); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(port); observer?.observe(content);
    port.addEventListener("scroll", schedule, { passive: true }); update();
    return () => { observer?.disconnect(); port.removeEventListener("scroll", schedule); cancelAnimationFrame(frame.current); };
  }, [portRef, contentRef, revision]);
  const jump = (direction: -1 | 1) => {
    const port = portRef.current;
    if (!port) return;
    const offsets = targets(port), index = adjacentPrompt(offsets, port.scrollTop, direction);
    if (index == null) return;
    pause(); port.scrollTop = offsets[index]!;
  };
  if (!available.count) return null;
  return <div className="s-session-prompt-nav" role="group" aria-label="Prompt navigation">
    <Button size="xs" variant="ghost" aria-label="Previous prompt" title="Previous prompt" disabled={!available.previous} onClick={() => jump(-1)}><ChevronUp size={14} aria-hidden /></Button>
    <Button size="xs" variant="ghost" aria-label="Next prompt" title="Next prompt" disabled={!available.next} onClick={() => jump(1)}><ChevronDown size={14} aria-hidden /></Button>
  </div>;
}
