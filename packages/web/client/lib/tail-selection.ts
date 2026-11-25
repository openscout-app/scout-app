/** Select inclusive rows in display order, including when Shift-clicking backwards. */
export function tailSelectionRange(keys: readonly string[], anchor: string | null, target: string): string[] {
  const start = anchor === null ? -1 : keys.indexOf(anchor);
  const end = keys.indexOf(target);
  if (end < 0) return [];
  if (start < 0) return [target];
  return keys.slice(Math.min(start, end), Math.max(start, end) + 1);
}
