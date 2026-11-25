/**
 * The right panel's width. Until somebody drags it, the panel keeps a share of
 * the window: a quarter, between 360 and 560, so a wide window gives a thread
 * room to read and a laptop keeps the conversation wide. A dragged width is
 * kept as set, between 280 and 600.
 */
export const CHAT_PANEL_MIN = 280;
export const CHAT_PANEL_MAX = 600;
const CHAT_PANEL_SHARE = 0.25;
const CHAT_PANEL_DEFAULT_MIN = 360;
const CHAT_PANEL_DEFAULT_MAX = 560;

/** The width the panel opens at for a window this wide, when nobody has dragged it. */
export function chatPanelDefaultWidth(viewportWidth: number): number {
  const share = Math.round(viewportWidth * CHAT_PANEL_SHARE);
  return Math.max(CHAT_PANEL_DEFAULT_MIN, Math.min(CHAT_PANEL_DEFAULT_MAX, share));
}

/** A dragged width, held to the panel's range. */
export function clampChatPanelWidth(width: number): number {
  return Math.max(CHAT_PANEL_MIN, Math.min(CHAT_PANEL_MAX, Math.round(width)));
}

/** A stored width, or null when nothing usable is stored and the panel follows the window. */
export function parseStoredChatPanelWidth(raw: string | null): number | null {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return clampChatPanelWidth(value);
}
