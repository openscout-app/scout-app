/** Shareable board selection; unrelated query parameters are preserved. */
export function parseBoardSelection(search: string) {
  const params = new URLSearchParams(search);
  const item = params.get("item")?.trim() || undefined;
  return { boardItem: item, boardFull: Boolean(item && params.get("full") === "1") };
}
export function buildBoardSelection(path: string, item?: string, full = false): string {
  const url = new URL(path, "https://scout.local");
  url.searchParams.delete("item");
  url.searchParams.delete("full");
  if (item) url.searchParams.set("item", item);
  if (item && full) url.searchParams.set("full", "1");
  return url.pathname + url.search;
}
