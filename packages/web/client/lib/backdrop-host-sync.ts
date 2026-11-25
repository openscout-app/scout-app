import type { HostSettingKey, HostSettingsSnapshot } from "./host-settings-bridge.ts";

/**
 * The backdrop choices the page hands to a Scout app that paints them too.
 *
 * In the Scout app, Settings › Appearance is this page, and the app paints its
 * own frame (and page) from the same choices, so they are sent over whenever
 * the two differ. Three generations of app answer:
 *
 * - current: reports `frameBackdrop`, `frameSidebarBackdrop` and `pageBackdrop`,
 *   and takes `window.frameBackdrop`, `window.frameSidebarBackdrop` and
 *   `window.pageBackdrop`;
 * - before the Frame › Page vocabulary: reports `backdrop` and
 *   `sidebarBackdrop`, takes `window.backdrop` and `window.sidebarBackdrop`, and
 *   has no page backdrop;
 * - older still: reports none, and the page keeps its backdrops to itself.
 */
export type BackdropChoices = {
  frameBackdrop: string;
  frameSidebarBackdrop: string;
  pageBackdrop: string;
  /** Your own's four corners, "#rrggbb #rrggbb #rrggbb #rrggbb". */
  backdropColors: string;
};

type HostWindow = HostSettingsSnapshot["window"] | null | undefined;

/** True when the Scout app paints a frame backdrop from these choices. */
export function hostPaintsBackdrop(win: HostWindow): boolean {
  return Boolean(win && (win.frameBackdrop ?? win.backdrop) !== undefined);
}

/** The `host.set` calls that bring the Scout app in line with the page. */
export function backdropHostWrites(win: HostWindow, choices: BackdropChoices): Array<[HostSettingKey, string]> {
  if (!win || !hostPaintsBackdrop(win)) return [];
  const current = win.frameBackdrop !== undefined;
  const writes: Array<[HostSettingKey, string]> = [];
  if ((win.frameBackdrop ?? win.backdrop) !== choices.frameBackdrop) {
    writes.push([current ? "window.frameBackdrop" : "window.backdrop", choices.frameBackdrop]);
  }
  if ((win.frameSidebarBackdrop ?? win.sidebarBackdrop) !== choices.frameSidebarBackdrop) {
    writes.push([current ? "window.frameSidebarBackdrop" : "window.sidebarBackdrop", choices.frameSidebarBackdrop]);
  }
  if (win.pageBackdrop !== undefined && win.pageBackdrop !== choices.pageBackdrop) {
    writes.push(["window.pageBackdrop", choices.pageBackdrop]);
  }
  if (win.backdropColors !== choices.backdropColors) {
    writes.push(["window.backdropColors", choices.backdropColors]);
  }
  return writes;
}
