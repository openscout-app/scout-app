/**
 * Markup a harness puts around its words (a `<notification>` envelope, a
 * `<system-reminder>`, an HTML comment) never reaches the board: tags go,
 * the words between them stay. Code in backticks keeps its angle brackets,
 * so `Map<string, number>` still reads as written.
 */
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const ELEMENT = /<\/?[A-Za-z][\w:.-]*(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>/g;
/** A tag cut off by truncation at the very end. */
const OPEN_TAIL = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?$/;

export function stripMarkup(text: string): string {
  return text
    .replace(COMMENT, " ")
    .split(/(`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(ELEMENT, " ").replace(OPEN_TAIL, " ")))
    .join("");
}
