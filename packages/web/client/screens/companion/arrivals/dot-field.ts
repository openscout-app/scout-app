/** The dot field's level (DotField.tsx), apart from its JSX so tests load it plain. */

/** 0..1 from what it did in its last passes: log-scaled, so a light agent stays calm and a busy one bursts. */
export function fieldIntensity(counts: readonly number[], recent = 3, full = 24): number {
  const tail = counts.slice(-recent);
  const sum = tail.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  return Math.min(1, Math.log1p(sum) / Math.log1p(full));
}
