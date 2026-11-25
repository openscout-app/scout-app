import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export const SCOUT_VIEW_HEADER_SLOT_ID = "scout-view-header-slot";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function findViewHeaderHost(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById(SCOUT_VIEW_HEADER_SLOT_ID);
}

/** How a module hands the view a spot in its own head for the Layout control (ViewLayoutSlot). */
export const ViewLayoutSlotRegister = createContext<((el: HTMLElement | null) => void) | null>(null);

/**
 * A spot for the view's Layout control in a module's head, used where the
 * host has no title row (the Mac app's Home). Empty, it takes no room.
 */
export function ViewLayoutSlot() {
  const register = useContext(ViewLayoutSlotRegister);
  return register ? <span className="vw-layout-slot" ref={register} /> : null;
}

/**
 * A composition's Layout control, in the app's title row when it has one, so
 * the view spends no row of its own on it. A host without that row puts it in
 * a module's head (`fallback`), and failing that keeps it above the panels
 * instead of dropping it.
 */
export function ViewHeaderMount({ fallback, children }: { fallback?: HTMLElement | null; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(findViewHeaderHost);

  useBrowserLayoutEffect(() => {
    setHost(findViewHeaderHost());
  }, []);

  const connectedHost = host?.isConnected ? host : fallback?.isConnected ? fallback : null;
  return connectedHost
    ? createPortal(children, connectedHost)
    : <div className="vw-bar vw-bar--layout">{children}</div>;
}
