import "./slide-panel.css";

import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { useRailSlot, type RailSide } from "./useRailSlot.ts";

export type SlidePanelProps = {
  /**
   * Whether the panel is visible. Caller controls the open state; the panel
   * fires `onClose` for backdrop clicks, escape, and rail-slot preemption.
   */
  open: boolean;
  /** Called after the visual exit. Focus, input and rail ownership release immediately. */
  onClose: () => void;
  /** Side to slide in from. Defaults to "right". */
  side?: RailSide;
  /**
   * Stable identifier for this panel instance — used by the rail-slot honor
   * system so cross-app collisions can be coordinated. Format suggestion:
   * "<app>.<surface>" (e.g. "openscout.tail").
   */
  owner: string;
  /** Initial size in pixels. Defaults to 620 (right) / 360 (bottom). */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** Show a resize handle on the inner edge (left for right, top for bottom). */
  resizable?: boolean;
  /** Show a backdrop that dims the rest of the surface. Default true. */
  backdrop?: boolean;
  /** Lock body scroll while open. Default false (matches Hudson's parity). */
  scrollLock?: boolean;
  /** Trap focus inside the panel while open. Default false. */
  focusTrap?: boolean;
  /** Accessible label for the dialog. */
  ariaLabel?: string;
  /** Extra className applied to the panel container. */
  className?: string;
  /** Stack above the default slide layer (e.g. a sheet opened from another sheet). */
  layer?: "default" | "elevated";
  /** Render-function children can route their close controls through the exit. */
  children: ReactNode | ((dismiss: () => void) => ReactNode);
};

const DEFAULT_RIGHT_SIZE = 620;
const DEFAULT_BOTTOM_SIZE = 360;
const DEFAULT_MIN = 280;
const DEFAULT_MAX_RIGHT = 900;
const DEFAULT_MAX_BOTTOM = 720;

/** localStorage-backed panel size, keyed by owner+side, clamped to the current
 *  [min,max] on read so a stale stored value (e.g. saved at a larger maxSize)
 *  can never wedge the panel. SSR-safe. */
function readStoredSize(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  } catch {
    // Safari private mode / sandboxed iframes can throw on access.
    return fallback;
  }
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function SlidePanel({
  open: requestedOpen,
  onClose,
  side = "right",
  owner,
  defaultSize,
  minSize = DEFAULT_MIN,
  maxSize,
  resizable = false,
  backdrop = true,
  scrollLock = false,
  focusTrap = false,
  ariaLabel,
  className,
  layer = "default",
  children,
}: SlidePanelProps) {
  const reduceMotion = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const open = requestedOpen && !dismissed;
  useLayoutEffect(() => { if (!requestedOpen) setDismissed(false); }, [requestedOpen]);
  // Presentation may outlive open; ownership, focus and input never do.
  const [retained, setRetained] = useState(open);
  useLayoutEffect(() => { if (open) setRetained(true); }, [open]);
  const initialSize = defaultSize ?? (side === "right" ? DEFAULT_RIGHT_SIZE : DEFAULT_BOTTOM_SIZE);
  const resolvedMax = maxSize ?? (side === "right" ? DEFAULT_MAX_RIGHT : DEFAULT_MAX_BOTTOM);

  // Remember the user's dragged size per panel instance (owner) and side, so a
  // panel reopens at the size they left it — and the right/bottom variants are
  // remembered separately. Restored once on mount; persisted on drag-end.
  const sizeStorageKey = `slidepanel.size.${owner}.${side}`;
  const [size, setSize] = useState(() =>
    readStoredSize(sizeStorageKey, initialSize, minSize, resolvedMax),
  );
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => setDismissed(true), []);

  const renderedChildren = typeof children === "function" ? children(handleClose) : children;
  const lastChildren = useRef(renderedChildren);
  if (open) lastChildren.current = renderedChildren;

  useRailSlot(side, owner, open, handleClose);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  // Body scroll lock.
  useEffect(() => {
    if (!open || !scrollLock) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, scrollLock]);

  // Focus management.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const node = panelRef.current;
    if (!node) return;
    const target = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (target ?? node).focus();
    return () => {
      if (node.contains(document.activeElement)) previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  // Resize via pointer drag.
  useEffect(() => {
    if (!open || !resizing) return;
    const onMove = (event: PointerEvent) => {
      if (side === "right") {
        const next = window.innerWidth - event.clientX;
        setSize(Math.min(resolvedMax, Math.max(minSize, next)));
      } else {
        const next = window.innerHeight - event.clientY;
        setSize(Math.min(resolvedMax, Math.max(minSize, next)));
      }
    };
    const onUp = () => {
      setResizing(false);
      // Persist once, on release (not per pointermove). sizeRef holds the final
      // dragged value committed by the last onMove.
      try {
        window.localStorage.setItem(sizeStorageKey, String(sizeRef.current));
      } catch {
        /* ignore private-mode / quota failures */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [open, resizing, side, minSize, resolvedMax, sizeStorageKey]);

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!focusTrap) return;
    if (event.key !== "Tab") return;
    const node = panelRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !node.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  useEffect(() => { if (!open) setResizing(false); }, [open]);

  if (!open && !retained) return null;

  const sizeStyle: CSSProperties = side === "right" ? { width: size } : { height: size };
  const elevated = layer === "elevated";

  return (
    <>
      {backdrop && (
        <motion.div
          initial={{ opacity: reduceMotion ? 1 : 0 }}
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.12 }}
          style={{ pointerEvents: open ? undefined : "none" }}
          className={`s-slide-backdrop${elevated ? " s-slide-backdrop--elevated" : ""}`}
          data-side={side}
          onClick={handleClose}
          aria-hidden="true"
        />
      )}
      <motion.aside
        initial={{ opacity: reduceMotion ? 1 : 0, x: !reduceMotion && side === "right" ? 24 : 0, y: !reduceMotion && side === "bottom" ? 24 : 0 }}
        animate={{ opacity: open ? 1 : 0, x: !open && !reduceMotion && side === "right" ? 24 : 0, y: !open && !reduceMotion && side === "bottom" ? 24 : 0 }}
        transition={{ duration: reduceMotion ? 0 : open ? 0.18 : 0.12, ease: [0.16, 1, 0.3, 1] }}
        onAnimationComplete={() => {
          if (!open) {
            setRetained(false);
            if (dismissed) onClose();
          }
        }}
        inert={!open}
        aria-hidden={!open || undefined}
        data-state={open ? "open" : "closing"}
        ref={panelRef}
        className={[
          "s-slide",
          `s-slide--${side}`,
          resizing ? "s-slide--resizing" : "",
          elevated ? "s-slide--elevated" : "",
          className,
        ].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal={open && focusTrap ? true : undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        style={{ ...sizeStyle, pointerEvents: open ? undefined : "none" }}
      >
        {resizable && (
          <div
            className={`s-slide-resize s-slide-resize--${side}`}
            onPointerDown={(event) => {
              event.preventDefault();
              setResizing(true);
            }}
            role="separator"
            aria-orientation={side === "right" ? "vertical" : "horizontal"}
            aria-label="Resize panel"
          />
        )}
        {open ? renderedChildren : lastChildren.current}
      </motion.aside>
    </>
  );
}
