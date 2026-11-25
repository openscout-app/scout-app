/**
 * A folded rail's harness marks: one cell per conversation or session, its
 * harness mark (or # for a channel), a dot while it works or waits, and a
 * label beside the rail on hover or focus with the title, the project and
 * the harness. The Chats rail and the Sessions side strip both draw these.
 */
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HarnessMark, harnessLabel, harnessTint } from "../../components/HarnessMark.tsx";
import "./collapsed-strip.css";

export type HarnessStripItem = {
  id: string;
  title: string;
  harness: string | null;
  project: string | null;
  channel?: boolean;
  state: "working" | "waiting" | null;
  current: boolean;
};

type Hover = { id: string; top: number; left: number };

/** Cells and the one hover label they share. Render `label` once, anywhere. */
export function useHarnessStrip() {
  const [hover, setHover] = useState<Hover | null>(null);
  const seen = useRef(new Map<string, HarnessStripItem>());

  const show = (id: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setHover({ id, top: rect.top + rect.height / 2, left: rect.right + 8 });
  };
  const clear = () => setHover(null);

  const cell = (item: HarnessStripItem, onOpen: () => void): ReactNode => {
    seen.current.set(item.id, item);
    const tint = item.current || item.state === "waiting" ? harnessTint(item.harness) : null;
    return (
      <button
        key={item.id}
        type="button"
        role="listitem"
        className="chat-strip-cell"
        data-current={item.current || undefined}
        data-state={item.state ?? undefined}
        aria-label={item.title}
        aria-current={item.current ? "page" : undefined}
        onClick={() => { clear(); onOpen(); }}
        onMouseEnter={(event) => show(item.id, event.currentTarget)}
        onMouseLeave={clear}
        onFocus={(event) => show(item.id, event.currentTarget)}
        onBlur={clear}
      >
        {item.channel ? (
          <span className="chat-strip-hash" aria-hidden>#</span>
        ) : (
          <span className="chat-strip-mark" style={tint ? { color: tint } : undefined} aria-hidden>
            <HarnessMark harness={item.harness} size={15} title={null} />
          </span>
        )}
        {item.state ? <span className="chat-strip-state" aria-hidden /> : null}
      </button>
    );
  };

  const hovered = hover ? seen.current.get(hover.id) : undefined;
  const label = hover && hovered && typeof document !== "undefined"
    ? createPortal(
      <div className="chat-strip-label" style={{ top: hover.top, left: hover.left }} role="tooltip">
        <span className="chat-strip-label-title">{hovered.title}</span>
        <span className="chat-strip-label-meta">
          {hovered.project ? <span>{hovered.project}</span> : null}
          <span>{hovered.channel ? "Channel" : harnessLabel(hovered.harness)}</span>
        </span>
      </div>,
      document.body,
    )
    : null;

  return { cell, label, clear };
}
