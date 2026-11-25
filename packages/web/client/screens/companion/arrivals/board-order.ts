/**
 * The board's order (the bar's Project · Time · State switch). Pure, so the
 * rules are testable without a host.
 *
 *  - State: asks, then what came back, what ended, then what is still out
 *    (arrivals-model SLOT). Within a state, rows keep the order they came in.
 *  - Time: the row whose state began last comes first.
 *  - Project: one group per project, by name, sessions with no project last.
 *    Within a project, by state, then by time.
 *
 * The open board reads its rows on a pass, so its order holds still between
 * passes whichever is picked.
 */

import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { remarkSlot, sinceOf, type Remark } from "./arrivals-model.ts";

export type BoardOrder = "project" | "time" | "state";
export const BOARD_ORDERS: readonly BoardOrder[] = ["project", "time", "state"];
export const BOARD_ORDER_LABEL: Record<BoardOrder, string> = { project: "Project", time: "Time", state: "State" };
export const BOARD_ORDER_TITLE: Record<BoardOrder, string> = {
  project: "Group by project",
  time: "Latest first",
  state: "Asks first, then what came back, then what is still out",
};
export const BOARD_ORDER_KEY = "scout:companion:board-order";
/** The heading of a group of sessions with no project. */
export const NO_PROJECT = "No project";

export function parseBoardOrder(v: string | null | undefined): BoardOrder {
  return v === "project" || v === "time" ? v : "state";
}

type Orderable = { id: string; thread: Pick<CornerThread, "project" | "at" | "since">; remark: Remark };

/** The project a row groups under: its project's name, or null. */
export function rowProject(t: Pick<CornerThread, "project">): string | null {
  return t.project?.trim() || null;
}

const byState = (a: Orderable, b: Orderable) => remarkSlot(a.remark) - remarkSlot(b.remark);
const byTime = (a: Orderable, b: Orderable) => sinceOf(b.thread) - sinceOf(a.thread);
function byProject(a: Orderable, b: Orderable): number {
  const pa = rowProject(a.thread), pb = rowProject(b.thread);
  if (pa === pb) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return pa.localeCompare(pb, undefined, { sensitivity: "base" }) || pa.localeCompare(pb);
}

/** The rows in the order picked. Ties keep the order given, so nothing swaps without a reason. */
export function orderRows<T extends Orderable>(rows: readonly T[], order: BoardOrder): T[] {
  const keys: ((a: T, b: T) => number)[] =
    order === "project" ? [byProject, byState, byTime] : order === "time" ? [byTime] : [byState];
  const at = new Map(rows.map((r, i) => [r.id, i]));
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const d = k(a, b);
      if (d) return d;
    }
    return at.get(a.id)! - at.get(b.id)!;
  });
}

/**
 * Grouped by project: the first row of each group, with its heading. Empty
 * for the other orders, which have no groups.
 */
export function groupHeads(rows: readonly Orderable[], order: BoardOrder): Map<string, string> {
  const heads = new Map<string, string>();
  if (order !== "project") return heads;
  let last: string | null | undefined;
  for (const r of rows) {
    const p = rowProject(r.thread);
    if (p !== last) heads.set(r.id, p ?? NO_PROJECT);
    last = p;
  }
  return heads;
}
