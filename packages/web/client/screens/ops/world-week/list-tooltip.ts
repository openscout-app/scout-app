/** Coordinates relative to the panel, never offsetTop (which ignores a list's scroll position). */
export function listTooltipTop(row: { top: number; bottom: number }, panel: { top: number; height: number }, height: number): number {
  const below = row.bottom - panel.top + 2;
  const top = below + height > panel.height - 4 ? row.top - panel.top - height - 2 : below;
  return Math.max(4, Math.min(top, Math.max(4, panel.height - height - 4)));
}
