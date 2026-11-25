/*
 * Markdown to one line of plain text, for a post's caption or a row's
 * excerpt. Pure: the Feed engine on the server and the pages that read its
 * posts share it.
 */

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateExcerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Markdown to a one-line plain excerpt: links and images become their text,
 * emphasis, code, heading, quote and list marks are dropped. Tolerates a
 * body that was cut mid-link upstream.
 */
export function plainTextExcerpt(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  let out = text
    .replace(/```[\w-]*\n?/g, "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:>\s?)+/, "")
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
        .replace(/^\s*(?:[-*_]\s*){3,}$/, "")
        .replace(/^\s*\|(.*)\|\s*$/, (_, cells: string) => cells.split("|").map((c) => c.trim()).filter(Boolean).join(" · ")),
    )
    .join(" ");
  out = out
    // A list already folded onto one line upstream: `intro: - **item**`.
    .replace(/([:;])\s+[-*+•]\s+/g, "$1 ")
    .replace(/\s[-*+•]\s+(?=\*\*|__|\[|`)/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)?/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*\)?/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])/g, "$1")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
    // Leftovers from a body cut mid-markup upstream.
    .replace(/\*\*|__|`/g, "")
    .replace(/\[(?=[^\]]*$)/g, "");
  return truncateExcerpt(collapseSpaces(out), max);
}
