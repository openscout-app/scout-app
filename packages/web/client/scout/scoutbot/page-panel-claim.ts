import { useSyncExternalStore } from "react";

/**
 * Whether a page draws its own Scoutbot panel (Voice, or a view holding the
 * Local Live call). Each mounted ScoutbotPanel answers the submit and toggle
 * events, so while a page holds one, the corner dock mounts none.
 */
let claims = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Claim the page for a panel; call the returned function to release it. */
export function claimScoutbotPagePanel(): () => void {
  claims += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function scoutbotPagePanelClaimed(): boolean {
  return claims > 0;
}

export function useScoutbotPagePanelClaimed(): boolean {
  return useSyncExternalStore(subscribe, scoutbotPagePanelClaimed, () => false);
}
