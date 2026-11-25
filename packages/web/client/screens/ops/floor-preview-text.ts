/** Plain-text presentation only; the original transcript is never modified. */
export function floorPreviewText(value: string | undefined, limit = 220): string {
  const source = value ?? "";
  // Wrapper elements (a hyphen or underscore in the name) carry injected
  // context, never prose: drop each as a block. A truncated one runs to the
  // end. Turns from a classified harness arrive clean already; this covers
  // unclassified sources.
  const presentation = source
    .replace(/<([a-zA-Z][\w.]*[-_][\w.-]*)\b[^>]*(?:>|$)[\s\S]*?(?:<\/\1\s*>|$)/g, " ")
    .replace(/<\/?[a-zA-Z][\w.]*[-_][\w.-]*\b[^>]*>/g, " ");
  const hasImage = /!\[[^\]]*\]\(/.test(presentation);
  const clean = presentation
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(?:STATUS|COMPLETE)\]/g, " ")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ").trim();
  const result = clean || (hasImage ? "Image attached" : "");
  return result.length > limit ? `${result.slice(0, limit - 1).trimEnd()}…` : result;
}
