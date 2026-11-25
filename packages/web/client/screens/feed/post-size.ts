/*
 * One Feed item, three sizes. Every placement draws the same item from the
 * same head (FeedPostHead); only the size changes what it shows.
 *
 *   s  tweet     the mark, name and time, two lines of title, the gist, and
 *                the picture as a thumbnail (a film's first frame). It reads
 *                on its own. Folds, a session's run of updates.
 *   m  post      the stream's post: the lead at full width, the outcome, the
 *                agent line; its moves on hover.
 *   l  lightbox  the post above the stream, wider than the column, the Feed
 *                dimmed behind; rich enough that the operator rarely leaves
 *                it. Its extras load when it opens.
 *
 * Enter grows an item one size; Escape shrinks it one size. In the stream,
 * Escape instead puts an opened post straight back (dismissTarget).
 */

export type PostSize = "s" | "m" | "l";

const ORDER: readonly PostSize[] = ["s", "m", "l"];

export function grow(size: PostSize): PostSize {
  return ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(size) + 1)]!;
}

export function shrink(size: PostSize): PostSize {
  return ORDER[Math.max(0, ORDER.indexOf(size) - 1)]!;
}

/**
 * In the stream, the post Escape puts back to its place's size: the focused
 * post when it is one that was opened, else the newest opened one still on
 * the page; null when nothing is open, so the key is left to the page.
 */
export function dismissTarget(focusedId: string | null, opened: readonly string[], shown: (id: string) => boolean): string | null {
  if (focusedId && opened.includes(focusedId) && shown(focusedId)) return focusedId;
  return opened.filter(shown).at(-1) ?? null;
}

/** The size a key asks for, or null when the key does not size. */
export function sizeForKey(key: string, size: PostSize): PostSize | null {
  const next = key === "Enter" ? grow(size) : key === "Escape" ? shrink(size) : null;
  return next && next !== size ? next : null;
}

/**
 * The word budget for each part at each size; null shows every word. S
 * keeps two lines of title and a line of gist. M keeps the whole outcome. L
 * shows everything.
 */
export const WORDS: Record<PostSize, { title: number | null; caption: number | null }> = {
  s: { title: 24, caption: 16 },
  m: { title: 64, caption: 48 },
  l: { title: null, caption: null },
};

/** `text` cut to `words` words, with an ellipsis when cut. Zero words is nothing. */
export function clip(text: string | null | undefined, words: number | null): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (words == null || !flat) return flat;
  if (words <= 0) return "";
  const parts = flat.split(" ");
  if (parts.length <= words) return flat;
  return `${parts.slice(0, words).join(" ").replace(/[\s,;:.–—-]+$/, "")}…`;
}
