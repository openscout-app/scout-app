import { useEffect, useRef, type ReactNode, type TransitionEvent } from "react";

export function chatPanelTransitionMs(value: string): number {
  return Math.max(0, ...value.split(",").map((part) => {
    const duration = part.trim();
    const amount = Number.parseFloat(duration);
    if (!Number.isFinite(amount)) return 0;
    return duration.endsWith("ms") ? amount : amount * 1000;
  }));
}

export function ChatPanelFrame({
  "aria-label": label,
  overlay,
  closing = false,
  onCloseComplete,
  children,
}: {
  "aria-label": string;
  overlay: boolean;
  closing?: boolean;
  onCloseComplete?: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const completeRef = useRef(onCloseComplete);
  completeRef.current = onCloseComplete;

  useEffect(() => {
    if (!closing || !panelRef.current) return;
    const duration = chatPanelTransitionMs(window.getComputedStyle(panelRef.current).transitionDuration);
    if (duration === 0) {
      completeRef.current?.();
      return;
    }
    const fallback = window.setTimeout(() => completeRef.current?.(), duration + 50);
    return () => window.clearTimeout(fallback);
  }, [closing]);

  const onTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (closing && event.target === event.currentTarget && event.propertyName === "clip-path") {
      completeRef.current?.();
    }
  };

  return (
    <aside
      ref={panelRef}
      className="chat-rpanel"
      data-overlay={overlay}
      data-state={closing ? "closing" : "open"}
      aria-label={label}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
    </aside>
  );
}


export function ChatPanelGlyph({ glyph, children }: { glyph: string; children: ReactNode }) {
  return (
    <>
      <span aria-hidden style={{ display: "var(--hc-panel-glyph-display, inline)" }}>{glyph}</span>
      <span aria-hidden style={{ display: "var(--hc-panel-icon-display, none)" }}>{children}</span>
    </>
  );
}
