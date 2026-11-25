/** Scoutbot's show-and-hide shortcut: ⌘/ on the Mac, Ctrl+/ elsewhere. */

export const SCOUTBOT_SHORTCUT_MAC = typeof navigator !== "undefined"
  && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function scoutbotShortcutLabel(mac = SCOUTBOT_SHORTCUT_MAC): string {
  return mac ? "⌘/" : "Ctrl+/";
}

export function scoutbotShortcutAria(mac = SCOUTBOT_SHORTCUT_MAC): string {
  return mac ? "Meta+/" : "Control+/";
}

/** Matches on the key alone, so layouts that need Shift to type "/" still
 * work. ⇧⌘/ on a US layout reads "?" and stays the system's Help menu. */
export function isScoutbotShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
  mac = SCOUTBOT_SHORTCUT_MAC,
): boolean {
  if (event.key !== "/" || event.altKey) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
