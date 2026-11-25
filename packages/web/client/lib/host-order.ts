/**
 * The host list's own order.
 *
 * LAN and Tailnet stay separate groups. A move stays inside the group, and a
 * pinned host stays at the top of its group until it is unpinned.
 */

export type HostLayout = {
  order: string[];
  pinned: string[];
};

export function emptyHostLayout(): HostLayout {
  return { order: [], pinned: [] };
}

/** Accepts the original array form and the later `{ order, pinned }` form. */
export function parseHostLayout(raw: string | null): HostLayout {
  if (!raw) return emptyHostLayout();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { order: strings(parsed), pinned: [] };
    if (parsed && typeof parsed === "object") {
      const record = parsed as { order?: unknown; pinned?: unknown };
      return { order: strings(record.order), pinned: strings(record.pinned) };
    }
  } catch {
    // A bad value is the same as no saved order.
  }
  return emptyHostLayout();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The map's two regions: tailnet-only devices, and everything else on the LAN. */
export function hostGroup(reachability: string): "lan" | "tailnet" {
  return reachability === "tailnet" ? "tailnet" : "lan";
}

export function orderIds(ids: readonly string[], stored: readonly string[]): string[] {
  const rank = new Map(stored.map((id, index) => [id, index]));
  return [...ids].sort((a, b) => {
    const ar = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const br = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return ids.indexOf(a) - ids.indexOf(b);
  });
}

/** Pinned hosts first, in pin order, then the rest in the saved order. */
export function arrangeGroup(groupIds: readonly string[], layout: HostLayout): string[] {
  const present = new Set(groupIds);
  const pinned = layout.pinned.filter((id) => present.has(id));
  const pin = new Set(pinned);
  const rest = orderIds(groupIds.filter((id) => !pin.has(id)), layout.order);
  return [...pinned, ...rest];
}

export function pinHost(layout: HostLayout, id: string): HostLayout {
  if (layout.pinned[0] === id) return layout;
  return { ...layout, pinned: [id, ...layout.pinned.filter((item) => item !== id)] };
}

export function unpinHost(layout: HostLayout, id: string): HostLayout {
  if (!layout.pinned.includes(id)) return layout;
  return { ...layout, pinned: layout.pinned.filter((item) => item !== id) };
}

export function placeId(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || from === to) return [...ids];
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(Math.min(Math.max(0, to), next.length), 0, item!);
  return next;
}

/**
 * Move `id` to `to` inside its group. `to` is an index in the current
 * arrangement, and may be the length of that arrangement to mean "after the
 * last row". A pinned host stays inside the pinned run. An unpinned host
 * stays below it.
 */
export function moveInGroup(layout: HostLayout, groupIds: readonly string[], id: string, to: number): HostLayout {
  const visual = arrangeGroup(groupIds, layout);
  const from = visual.indexOf(id);
  if (from < 0) return layout;
  const pin = new Set(layout.pinned);
  const pinnedCount = visual.filter((item) => pin.has(item)).length;
  const pinned = pin.has(id);
  const min = pinned ? 0 : pinnedCount;
  const max = pinned ? Math.max(0, pinnedCount - 1) : visual.length;
  const dest = Math.min(max, Math.max(min, to));
  if (dest === from) return layout;
  const nextVisual = placeId(visual, id, dest);
  if (nextVisual.every((item, index) => item === visual[index])) return layout;
  return {
    order: writeGroupSequence(layout.order, groupIds, nextVisual),
    pinned: replaceGroupPins(layout.pinned, groupIds, nextVisual.filter((item) => pin.has(item))),
  };
}

export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= ids.length) return [...ids];
  return placeId(ids, id, next);
}

/** Write one group's new sequence back into the stored order of every host. */
export function applyGroupMove(
  stored: readonly string[],
  groupIds: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] {
  const moved = moveId(orderIds(groupIds, stored), id, delta);
  return writeGroupSequence(stored, groupIds, moved);
}

function writeGroupSequence(stored: readonly string[], groupIds: readonly string[], sequence: readonly string[]): string[] {
  const group = new Set(groupIds);
  const first = stored.findIndex((item) => group.has(item));
  if (first < 0) return [...stored.filter((item) => !group.has(item)), ...sequence];
  const before = stored.slice(0, first).filter((item) => !group.has(item));
  const after = stored.slice(first).filter((item) => !group.has(item));
  return [...before, ...sequence, ...after];
}

function replaceGroupPins(pinned: readonly string[], groupIds: readonly string[], nextGroupPins: readonly string[]): string[] {
  const group = new Set(groupIds);
  const result: string[] = [];
  let placed = false;
  for (const id of pinned) {
    if (!group.has(id)) result.push(id);
    else if (!placed) {
      result.push(...nextGroupPins);
      placed = true;
    }
  }
  if (!placed) result.push(...nextGroupPins);
  return result;
}
