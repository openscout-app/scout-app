/**
 * The letters an Initials avatar shows.
 *
 * The mark answers "which project is this", so it reads the project when one
 * is known and the name otherwise. One word gives one letter ("scout" → S);
 * two or more give the first letter of the first two ("demo-app" → SA), so
 * Scout and Demo app stay apart. An owner prefix ("arach/scout") and a
 * trailing reference ("#154 at f2c9a5c") are not part of the name.
 */
export function avatarInitials(label: string | null | undefined): string {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "?";
  const lastSegment = trimmed.split("/").map((part) => part.trim()).filter(Boolean).pop() ?? trimmed;
  const name = lastSegment.split(/\s#|\sat\s/u)[0] ?? lastSegment;
  const words = name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[\s\-_.:#@]+/u)
    .filter((word) => /^\p{L}/u.test(word));
  if (words.length === 0) {
    const fallback = [...trimmed].find((ch) => /[\p{L}\p{N}]/u.test(ch));
    return fallback ? fallback.toUpperCase() : "?";
  }
  const first = [...words[0]!][0]!;
  if (words.length === 1) return first.toUpperCase();
  return `${first}${[...words[1]!][0]!}`.toUpperCase();
}

/** The last path segment of a project root, for callers that only have the path. */
export function projectNameFromRoot(root: string | null | undefined): string | null {
  const segment = (root ?? "").split(/[\\/]/u).filter(Boolean).pop();
  return segment ?? null;
}
