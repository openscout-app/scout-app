import { isScoutFlagEnabled } from "./scout-flags.ts";

// Legacy shim. The web's ops gate is now the `ops.control` feature flag
// (see lib/scout-flags.ts). This keeps the old name/signature so non-React
// route-resolution callsites (lib/router.ts) need no change; React components
// should prefer `useOptionalFlag("ops.control", true)` for live reactivity.
export function isOpsEnabled(): boolean {
  return isScoutFlagEnabled("ops.control");
}

export function isReviewEnabled(): boolean {
  return isScoutFlagEnabled("surface.review");
}

export function isCanvasEnabled(): boolean {
  return false; // Canvas belongs to the hosted platform.
}

export function isFeedEnabled(): boolean {
  return isScoutFlagEnabled("surface.feed");
}
