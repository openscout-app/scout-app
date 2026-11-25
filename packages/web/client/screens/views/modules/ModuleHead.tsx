import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The panel head's slot for this instance, provided by the view that hosts it. */
export const ModuleHeadSlot = createContext<HTMLElement | null>(null);

/** The head's count slot, on the title's line, provided by the view that hosts it. */
export const ModuleCountSlot = createContext<HTMLElement | null>(null);

/** The folded side strip's slot for this panel, provided by a view that docks it to a side. */
export const ModuleStripSlot = createContext<HTMLElement | null>(null);

/**
 * What this panel shows in its side's folded strip, in place of its name: a
 * column of small marks that each open something. Only a docked panel has a
 * strip; anywhere else this draws nothing.
 */
export function ModuleStrip({ children }: { children?: ReactNode }) {
  const slot = useContext(ModuleStripSlot);
  return slot ? createPortal(children, slot) : null;
}

const isCount = (child: ReactNode) =>
  isValidElement<{ className?: unknown }>(child) && typeof child.props.className === "string" && child.props.className.split(/\s+/).includes("hud-grid-count");

/**
 * Put a count or a few actions in this panel's head, beside its scopes, from
 * inside the module body:
 *
 *   <ModuleHead><span className="hud-grid-count">{rows.length}</span></ModuleHead>
 *
 * A `.hud-grid-count` child goes beside the title, so the count reads with
 * the label it counts; everything else sits with the head's tools. `beside`
 * also goes on the title's line, after any count: a short reading that
 * belongs with the panel's name (the Fleet cockpit's subscription gauges).
 *
 * Outside a view (no slot yet, or a module drawn on its own) it draws nothing,
 * so anything put here must also be reachable some other way, or be a nicety.
 */
export function ModuleHead({ children, beside }: { children?: ReactNode; beside?: ReactNode }) {
  const slot = useContext(ModuleHeadSlot);
  const countSlot = useContext(ModuleCountSlot);
  if (!slot) return null;
  if (!countSlot) return createPortal(<>{beside}{children}</>, slot);
  const all = Children.toArray(children);
  const counts = all.filter(isCount);
  const tools = all.filter((c) => !isCount(c));
  return (
    <>
      {(counts.length > 0 || beside != null) && createPortal(<>{counts}{beside}</>, countSlot)}
      {createPortal(tools, slot)}
    </>
  );
}
