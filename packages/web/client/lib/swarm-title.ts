/**
 * A lane's asks often open with the lane's own name ("Lane E1: #66, …"). The
 * board draws each ask in its lane's row and names the lane beside every
 * sentence about it, so the title drops the name instead of repeating it.
 */
export function withoutLaneName(title: string, laneName: string): string {
  const name = laneName.trim();
  if (!name) return title;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = title.match(new RegExp(`^${escaped}\\s*[:—–]\\s*`, "iu"));
  const rest = match ? title.slice(match[0].length) : "";
  if (!rest) return title;
  // "the full test run stalls" reads as a title once it leads; "iOS", "e3" and "#66" stay as written.
  return /^\p{Ll}+(?![\p{L}\p{N}])/u.test(rest) ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest;
}
