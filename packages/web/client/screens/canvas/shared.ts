import { isShowPath, type CanvasItem } from "../../../shared/canvas.ts";
import type { PromotedCopy } from "../../../shared/boards.ts";

export type SharedEntry = { key: string; copy: PromotedCopy; live: CanvasItem | null; at: number; changed: boolean };

/** A Shared copy whose file is no longer in the window, as a card. */
export function copyItem(x: SharedEntry): CanvasItem {
  const kind = x.copy.state === "video" || x.copy.state === "doc" || x.copy.state === "embed" ? x.copy.state : "image";
  const path = x.copy.ref.path ?? "";
  return { key: x.key, path, name: x.copy.title, kind, agent: -1, at: x.copy.at, mt: Number(x.copy.revision) || 0, how: isShowPath(path) ? "shown" : "named" };
}

/**
 * Keep the shared snapshot while it is listed. If it was evicted or left the window,
 * use the newest listed version; the entry still says "Changed since shared".
 * Other files are read as they are now.
 */
export function sharedItem(x: SharedEntry): CanvasItem {
  const path = x.copy.ref.path ?? "";
  if (!x.live) return copyItem(x);
  if (!isShowPath(path) || path === x.live.path || !x.live.shown?.listedIds.includes(path.slice("show:".length))) return x.live;
  const { caption: _said, ...rest } = x.live;
  return { ...rest, path, mt: Number(x.copy.revision) || x.live.mt, shown: { ...x.live.shown!, id: path.slice("show:".length) } };
}

/** Missing only when no version of the item is listed in the current window. */
export const sharedMissing = (x: SharedEntry) => !x.live;
