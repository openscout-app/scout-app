import type { WorkDetail } from "../../lib/types.ts";

/** The work page's detail pane: one tab each for Flight, Timeline, Tail and Files. */
export type WorkTab = "flight" | "timeline" | "tail" | "files";

/** Where the detail pane sits: beside the work item (the default) or under it at full width. */
export type WorkArrangement = "side" | "below";

export type WorkTabEntry = { id: WorkTab; label: string; count: number | null };

/** The tabs in order, each with its count once the work item is read (Tail has none). */
export function workDetailTabs(detail: WorkDetail | null | undefined): WorkTabEntry[] {
  return [
    { id: "flight", label: "Flight", count: detail ? detail.allFlights.length : null },
    { id: "timeline", label: "Timeline", count: detail ? detail.timeline.length : null },
    { id: "tail", label: "Tail", count: null },
    { id: "files", label: "Files", count: detail?.inventory ? detail.inventory.materials.length : null },
  ];
}

/** The tab a work item opens on: its live output while it runs, its history otherwise. */
export function defaultWorkTab(detail: WorkDetail | null | undefined): WorkTab {
  return detail?.state === "working" ? "tail" : "timeline";
}

/** Below: the work item's share of the height it and the detail split, as shipped. */
export const BELOW_SHARE_DEFAULT = 0.44;
/** Neither part is dragged smaller than this share. */
const BELOW_SHARE_MIN = 0.15;

const clampShare = (share: number) => Math.min(1 - BELOW_SHARE_MIN, Math.max(BELOW_SHARE_MIN, share));

/** A remembered split, or the shipped one when nothing usable was saved. */
export function parseBelowShare(saved: string | null): number {
  const share = saved == null ? Number.NaN : Number.parseFloat(saved);
  return Number.isFinite(share) ? clampShare(share) : BELOW_SHARE_DEFAULT;
}

/** The item's share after its seam moves `dy` pixels within `height`; a zero height leaves it unchanged. */
export function belowShareAfterDrag(share: number, height: number, dy: number): number {
  if (!(height > 0)) return clampShare(share);
  return Math.round(clampShare(share + dy / height) * 1000) / 1000;
}
