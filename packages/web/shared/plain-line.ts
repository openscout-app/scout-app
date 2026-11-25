/*
 * A line a person reads at a glance: no absolute paths, no commit hashes.
 * Titles and captions come from asks and replies agents write, which name
 * files by full path ("Verify the fix in /example/…/demo-app/packages/web/…")
 * and commits by hash ("Review PR #1978 at HEAD 38be0905d9…"). The reader
 * needs the thing's name, not its address.
 *
 *   a path        its last part, or the folder above when the last part is a
 *                 generic file name (index.html, study.md, page.tsx)
 *   a hash        dropped, with the "at HEAD" or "commit" that introduced it
 *   a pull or     its number: "#1985" (other links stay)
 *   issue link
 *
 * Pure; the Feed writer and Home both use it.
 */

/* An absolute or home path, up to whitespace, quotes or brackets. */
const ABSOLUTE = /(?<![\w.:/-])(?:~|\/(?:Users|home|private|tmp|var|opt|Volumes|etc|System|Library|Applications))(?:\/[^\s`'"()<>\[\]{},;]*)+/g;
/* A relative path three folders deep ending in a file: "packages/web/client/x.tsx". Not a URL. */
const RELATIVE = /(?<![\w.:/-])(?:[\w@-][\w.@-]*\/){3,}[\w.@-]*\.[a-z0-9]{1,6}\b/gi;
/* A GitHub pull request or issue link: its number is the name a reader knows. */
const GITHUB_ITEM = /\bhttps?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)(?:\/[\w./#-]*)?/gi;
/* File names that say nothing on their own; the folder above names the thing. */
const GENERIC = /^(?:index|main|page|study|readme|layout|app|mod|default|view|screen)\.[a-z0-9]+$/i;
/* A commit hash, with what introduced it: "at HEAD 38be090", "commit 7053fc9d", "d7fdcb7e1". Has a digit and a letter; not part of an id ("inv-request-5627ab91"). */
const HASH = /(?:[ \t]*\b(?:at[ \t]+(?:(?:HEAD|commit|sha)[ \t]+)?|(?:HEAD|commit|sha)[ \t]+)|[ \t]+)?(?<![\w-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?:\.{2,3}[0-9a-f]{7,40})?(?![\w-])/gi;
/* What a removed hash leaves behind: "(merged as )", "()". */
const EMPTY_ASIDE = /\s*\((?:\s*(?:merged as|at|as|commit|sha|head)\s*)*\)/gi;

function shortPath(path: string): string {
  const trail = /[.:!?]+$/.exec(path)?.[0] ?? "";
  const bare = (trail ? path.slice(0, -trail.length) : path).replace(/\/+$/, "");
  const parts = bare.split("/").filter((p) => p && p !== "~");
  const last = parts[parts.length - 1];
  if (!last) return path;
  const name = GENERIC.test(last) && parts.length > 1 ? parts[parts.length - 2]! : last;
  return name + trail;
}

/** The line with paths shortened to their names and commit hashes dropped. */
export function plainLine(text: string): string {
  return text
    .replace(GITHUB_ITEM, "#$1")
    // "PR #1984: https://…/pull/1984" says its number once.
    .replace(/(#\d+)[:\s]+\1(?!\d)/g, "$1")
    .replace(ABSOLUTE, shortPath)
    .replace(RELATIVE, (path, offset: number, all: string) => (all.slice(Math.max(0, offset - 8), offset).includes("://") ? path : shortPath(path)))
    .replace(HASH, "")
    .replace(EMPTY_ASIDE, "")
    .replace(/,\s*,+/g, ",")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
