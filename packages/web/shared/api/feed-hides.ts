/**
 * An item the operator hid from Home and the Feed: its id, and its own time
 * (`at`) when it was hidden. The item shows again once its time is newer.
 */
export type FeedHide = { id: string; at: number };

/** Whether an item is hidden: a hide covers it until the item has something newer. */
export function hiddenBy(hides: ReadonlyMap<string, number>, id: string, at: number): boolean {
  const hiddenAt = hides.get(id);
  return hiddenAt !== undefined && at <= hiddenAt;
}
