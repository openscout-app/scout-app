import { formatAbsoluteTimestamp } from "../../lib/time.ts";
import type { WorkDetail } from "../../lib/types.ts";
import { workCaseFacts } from "../views/modules/work-view-model.ts";

/**
 * The cells of the run's Details plate: what ran it, where the work lives,
 * where to find it, and the case. Every cell copies its full value, or opens
 * it when it points at another page.
 */

export type MastAgent = { projectRoot?: string | null; branch?: string | null; model?: string | null } | null | undefined;

export type PlateCell = {
  key: string;
  value: string | null;
  id?: boolean;
  missing?: string;
  /** What the cell copies, when not its value. */
  copy?: string;
  /** Open the value instead of copying it. */
  open?: () => void;
  /** Take two columns: a title or a date that would not fit in one. */
  wide?: boolean;
};

export type PlateTier = { name: string; cells: PlateCell[] };

export function homePath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

/** Copy all: one `Key: value` line per filled cell. */
export function plateText(cells: PlateCell[]): string {
  return cells.filter((cell) => cell.value).map((cell) => `${cell.key}: ${cell.copy ?? cell.value}`).join("\n");
}

/** Where the work lives: its project, branch, owner and id. */
export function placeCells(detail: WorkDetail, agent: MastAgent): PlateCell[] {
  const root = agent?.projectRoot ?? null;
  return [
    { key: "Project", value: root ? homePath(root) : null, id: true, copy: root ?? undefined },
    { key: "Branch", value: agent?.branch ?? null, id: true },
    { key: "Owner", value: detail.ownerName ?? detail.ownerId, copy: detail.ownerId ?? undefined },
    { key: "Work", value: detail.id, id: true },
  ];
}

/**
 * The case: acceptance, priority, signal and routing, children and flights,
 * the parent, and when the record was made and last changed. Phase and owner
 * show elsewhere on the page.
 */
export function caseCells(detail: WorkDetail, openParent: (() => void) | null): PlateCell[] {
  const cells: PlateCell[] = workCaseFacts(detail)
    .filter((fact) => fact.label !== "Phase" && fact.label !== "Owner")
    .map((fact) => ({ key: fact.label, value: fact.value }));
  if (detail.parentId && openParent) cells.push({ key: "Parent", value: detail.parentTitle ?? detail.parentId, open: openParent, wide: true });
  cells.push(
    { key: "Created", value: formatAbsoluteTimestamp(detail.createdAt) || null, wide: true, copy: new Date(detail.createdAt).toISOString() },
    { key: "Updated", value: formatAbsoluteTimestamp(detail.updatedAt) || null, wide: true, copy: new Date(detail.updatedAt).toISOString() },
  );
  return cells;
}
