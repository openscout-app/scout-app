/**
 * How often the companion's Summary names are renamed (Settings › Names ›
 * Renamed). Every rename is one call to a cheap model on the operator's own
 * plan, so the default is never: a session is named once and keeps it.
 *
 *   never        name each session once
 *   turns:N      again after N more finished turns
 *   minutes:N    again after N minutes, if a turn finished since
 *
 * Either way a working session keeps its name until its turn ends.
 *
 * The board sends it with each read (`?rename=turns:10`); the server's naming
 * desk (server/session-titles.ts) decides from it when a name is due.
 */

export type RenamePolicy =
  | { every: "never" }
  | { every: "turns"; n: number }
  | { every: "minutes"; n: number };

export const RENAME_NEVER: RenamePolicy = { every: "never" };
/** The choices the settings sheet offers. A name reads at most ten turns, so ten is the most turns can be. */
export const RENAME_TURNS = [3, 5, 10] as const;
export const RENAME_MINUTES = [10, 30, 60] as const;
const MAX_TURNS = 10;
const MAX_MINUTES = 24 * 60;

/** `never`, `turns:N` or `minutes:N`; anything else reads as never. */
export function parseRenamePolicy(value: string | null | undefined): RenamePolicy {
  const match = /^(turns|minutes):(\d{1,4})$/u.exec(value?.trim() ?? "");
  if (!match) return RENAME_NEVER;
  const n = Number(match[2]);
  if (match[1] === "turns") return n >= 1 && n <= MAX_TURNS ? { every: "turns", n } : RENAME_NEVER;
  return n >= 1 && n <= MAX_MINUTES ? { every: "minutes", n } : RENAME_NEVER;
}

export function formatRenamePolicy(policy: RenamePolicy): string {
  return policy.every === "never" ? "never" : `${policy.every}:${policy.n}`;
}
