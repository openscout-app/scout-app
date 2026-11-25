/** A clock cell, not elapsed hours since midnight. Missing spring hours normalize forward;
 * repeated fall hours choose the earlier occurrence, as Date.setHours specifies. */
export function rhythmTime(day: number, hour: number): number {
  const date = new Date(day);
  date.setHours(hour, 30, 0, 0);
  return date.getTime();
}

/** Both occurrences of a repeated hour belong to the same clock cell. */
export function rhythmCurrent(day: number, hour: number, time: number): boolean {
  const d = new Date(day), t = new Date(time);
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth()
    && d.getDate() === t.getDate() && t.getHours() === hour;
}
