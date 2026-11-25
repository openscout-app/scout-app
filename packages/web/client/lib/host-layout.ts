import { useCallback, useEffect, useState } from "react";
import { emptyHostLayout, parseHostLayout, type HostLayout } from "./host-order.ts";

/** Shared by the Hosts list and the Rack, so a pin shows in both. */
export const HOST_LAYOUT_KEY = "openscout.mesh.hostOrder.v1";
const EVENT = "openscout-host-layout";

function readHostLayout(): HostLayout {
  if (typeof window === "undefined") return emptyHostLayout();
  try {
    return parseHostLayout(window.localStorage.getItem(HOST_LAYOUT_KEY));
  } catch {
    return emptyHostLayout();
  }
}

function writeHostLayout(layout: HostLayout) {
  window.localStorage.setItem(HOST_LAYOUT_KEY, JSON.stringify(layout));
  window.dispatchEvent(new Event(EVENT));
}

export function useHostLayout(): [HostLayout, (next: HostLayout) => void] {
  const [layout, setLayout] = useState<HostLayout>(readHostLayout);
  useEffect(() => {
    const sync = () => setLayout(readHostLayout());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((next: HostLayout) => {
    try {
      writeHostLayout(next);
    } catch {
      // The list still follows the choice for this view of the page.
    }
    setLayout(next);
  }, []);
  return [layout, update];
}
