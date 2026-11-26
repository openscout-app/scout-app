/**
 * The stream keeps its places within a visit.
 *
 * The server re-ranks a day's picks on every read, sorts by each post's latest
 * turn, and drops what moved elsewhere. Applied as is, a post the operator was
 * reading folds away, jumps, or vanishes on a refresh. So each day's rows keep
 * the order they were first shown in:
 *
 *   a post that is new to the day    arrives at the top
 *   a post still there               keeps its place, with fresh data
 *   a shown post the re-rank folded  stays shown, in its place
 *   a shown post that left           leaves a one-line note in its place
 *   a post the operator removed      goes (Done, Drop and hides are theirs)
 *
 * Notes and places last for the visit: a new view or a reload starts over.
 */

export type DayRow = { id: string; note: boolean; arrived: boolean };

/**
 * One day's rows, given the rows shown before (`prev`, undefined when the day
 * was not shown) and the server's picks and fold now. `first` is the stream's
 * first paint: nothing counts as arrived. Pure.
 */
export function steadyDay(
  prev: readonly string[] | undefined,
  featured: readonly string[],
  folded: readonly string[],
  { first, mine }: { first: boolean; mine: (id: string) => boolean },
): { rows: DayRow[]; folded: string[] } {
  if (!prev) {
    return { rows: featured.map((id) => ({ id, note: false, arrived: !first })), folded: [...folded] };
  }
  const was = new Set(prev);
  const picked = new Set(featured);
  const inFold = new Set(folded);
  const kept = new Set<string>();
  const rows: DayRow[] = featured.filter((id) => !was.has(id)).map((id) => ({ id, note: false, arrived: true }));
  for (const id of prev) {
    if (picked.has(id)) rows.push({ id, note: false, arrived: false });
    else if (inFold.has(id)) { kept.add(id); rows.push({ id, note: false, arrived: false }); }
    else if (!mine(id)) rows.push({ id, note: true, arrived: false });
  }
  return { rows, folded: folded.filter((id) => !kept.has(id)) };
}

/** True when `next` holds a post id that `shown` does not: something new arrived. */
export function hasNewPosts(shown: Iterable<string>, next: Iterable<string>): boolean {
  const have = new Set(shown);
  for (const id of next) if (!have.has(id)) return true;
  return false;
}
